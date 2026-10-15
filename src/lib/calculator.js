/**
 * calculator.js — FBA 利润计算引擎（纯函数，无 DOM 依赖）
 *
 * 计算口径（关键，务必理解）：
 *  售价 Revenue（本币，含税则先剥离 VAT）
 *  ├─ 平台佣金 Referral Fee   = 售价 × 佣金率（多数站点按含税价计，欧洲按含税价计）
 *  ├─ FBA 配送费 Fulfillment  = 按重量分段查表
 *  ├─ 月度仓储费 Storage      = 体积 × 单价 × 周转月数
 *  ├─ 关税 Duty              = 采购成本(含头程) × 关税率
 *  ├─ 采购成本 COGS           = 采购价 + 头程运费（按本币折算，按数量分摊）
 *  └─ 增值税 VAT             = 售价含税时需上缴的部分（销项 - 进项，简化为净额）
 *  = 净利润 Net Profit
 *
 * 说明：
 *  - 欧洲/日本 listing 价格含 VAT/消费税，平台代扣代缴，因此从售价中剔除税是不算作卖家收入的。
 *    但很多卖家习惯按"含税售价 vs 成本"直接算，所以本引擎提供 vatInclusive 开关。
 *  - 关税与 VAT 的进项抵扣在本模型中做简化：关税不可抵扣（计入成本），VAT 按净销项处理。
 */

(function (root) {
  'use strict';

  const UNIT = root.FBA_UNIT || {
    LB_PER_KG: 2.20462,
    CUFT_PER_CBM: 35.3147,
    IN3_PER_CUFT: 1728,
    CM3_PER_CUFT: 28316.8466
  };

  /** 数值安全化 */
  function num(v, fallback = 0) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function round2(v) {
    return Math.round((num(v) + Number.EPSILON) * 100) / 100;
  }

  /**
   * 按重量查 FBA 配送费
   * @param {object} fbaTiers 站点的 fba.sizeTiers
   * @param {number} weight 重量，单位由 sizeSystem 决定（imperial=lb, metric=kg）
   */
  function lookupFbaFee(fbaTiers, weight) {
    const w = Math.max(0, num(weight));
    if (!Array.isArray(fbaTiers) || fbaTiers.length === 0) return { fee: 0, tier: '未知', weight: w };

    for (const tier of fbaTiers) {
      const limit = num(tier.maxLb !== undefined ? tier.maxLb : tier.maxKg, Infinity);
      if (w <= limit) {
        let fee = num(tier.fee);
        const perLb = num(tier.perLb, 0);
        const perKg = num(tier.perKg, 0);
        const baseLb = num(tier.baseLb, NaN);
        const baseKg = num(tier.baseKg, NaN);

        if (perLb > 0 && Number.isFinite(baseLb) && w > baseLb) {
          fee += (w - baseLb) * perLb;
        }
        if (perKg > 0 && Number.isFinite(baseKg) && w > baseKg) {
          fee += (w - baseKg) * perKg;
        }
        return { fee: round2(fee), tier: tier.name, weight: w };
      }
    }
    const last = fbaTiers[fbaTiers.length - 1];
    return { fee: round2(num(last.fee)), tier: last.name, weight: w };
  }

  /**
   * 计算月度仓储费（按体积与周转月数）
   * storageUnit 恒为 cuft。用户输入体积为 cm³（长×宽×高）。
   */
  function calcStorage(site, volumeCm3, months, monthIndex) {
    if (!site || !site.fba) return 0;
    const cuft = num(volumeCm3) / UNIT.CM3_PER_CUFT;
    const isPeak = num(monthIndex, new Date().getMonth() + 1) >= 10;
    const unitFee = isPeak ? num(site.fba.storagePeak) : num(site.fba.storageStandard);
    return round2(cuft * unitFee * Math.max(0, num(months)));
  }

  /**
   * 主计算
   * @param {object} input
   *  - site: 站点 marketplace key（'US' | 'UK' | 'JP' ...）
   *  - salePrice: 售价（站点本币，含税站点为含税价）
   *  - quantity: 单件售出数量（默认 1）
   *  - cogsPerUnit: 单件采购价（本币）
   *  - firstLegPerUnit: 单件头程运费（本币）
   *  - category: 佣金类目名（可选，默认站点的 referral.default）
   *  - referralOverride: 手动佣金率覆盖（0–1），优先级最高
   *  - weight: 单件重量（imperial=lb / metric=kg）
   *  - lengthCm,widthCm,heightCm: 单件尺寸（cm），用于仓储费
   *  - storageMonths: 平均仓储周转月数（默认 1）
   *  - dutyRate: 关税率（0–1），默认取站点 importDutyDefault
   *  - vatRate: VAT/消费税率覆盖（0–1）
   *  - includeStorage: 是否计入仓储费（默认 true）
   *  - extraFee: 其他杂费（广告分摊、测评等，本币/件）
   *  - extras: 附加费用数组 [{ name, value, type: 'fixed'|'percent' }]
   */
  function calculate(input, sitesMap) {
    const SITES = sitesMap || root.FBA_SITES || {};
    const site = SITES[input.site] || SITES.US;
    const errors = [];
    const warnings = [];

    const salePrice = num(input.salePrice);
    const qty = Math.max(1, num(input.quantity, 1));
    const cogs = num(input.cogsPerUnit);
    const firstLeg = num(input.firstLegPerUnit);
    const extraFee = num(input.extraFee);

    if (salePrice <= 0) errors.push('售价必须大于 0');
    if (cogs < 0) errors.push('采购价不能为负');

    // ---- 1. 税率处理：剥离 VAT（含税站点）----
    const vatRate = input.vatRate !== undefined && input.vatRate !== ''
      ? num(input.vatRate)
      : num(site.vatRate);
    const taxInclusive = site.vatInclusive && salePrice > 0;
    const vatAmount = taxInclusive ? round2(salePrice - salePrice / (1 + vatRate)) : 0;
    const netRevenue = round2(salePrice - vatAmount); // 卖家实际可留存的不含税收入

    // ---- 2. 平台佣金 ----
    let referralRate;
    if (input.referralOverride !== undefined && input.referralOverride !== '' && num(input.referralOverride) > 0) {
      referralRate = num(input.referralOverride);
    } else if (input.category && site.referral.categories && site.referral.categories[input.category] !== undefined) {
      referralRate = site.referral.categories[input.category];
    } else {
      referralRate = num(site.referral.default, 0.15);
    }
    // 佣金基数：亚马逊多数站点按含税售价计（欧洲/日本按含增值税售价）
    const referralBase = salePrice;
    let referralFee = round2(referralBase * referralRate);
    // 最低佣金（美国站 $0.30 起，其余站点类似小额下限），此处仅在美国站应用
    if (site.marketplace === 'US' && referralFee > 0 && referralFee < 0.30) {
      referralFee = 0.30;
    }

    // ---- 3. FBA 配送费 ----
    const fbaResult = lookupFbaFee(
      site.fba && site.fba.sizeTiers,
      num(input.weight)
    );
    let fulfillmentFee = fbaResult.fee;

    // ---- 4. 月度仓储费 ----
    const volumeCm3 =
      num(input.lengthCm) * num(input.widthCm) * num(input.heightCm);
    let storageFee = 0;
    if (input.includeStorage !== false && volumeCm3 > 0) {
      storageFee = calcStorage(site, volumeCm3, num(input.storageMonths, 1), input.monthIndex);
    }

    // ---- 5. 关税（按采购 + 头程 CIF 价计征）----
    const dutyRate = input.dutyRate !== undefined && input.dutyRate !== ''
      ? num(input.dutyRate)
      : num(site.importDutyDefault);
    const dutiableValue = cogs + firstLeg;
    const dutyFee = round2(dutiableValue * dutyRate);

    // ---- 6. 附加费用 ----
    let extrasFee = extraFee;
    const extrasDetail = [];
    if (Array.isArray(input.extras)) {
      for (const ex of input.extras) {
        const v = num(ex.value);
        const amt = ex.type === 'percent' ? round2(salePrice * v) : round2(v);
        extrasFee += amt;
        extrasDetail.push({ name: ex.name || '其他费用', amount: amt, type: ex.type || 'fixed', raw: v });
      }
    }

    // ---- 7. 合计 ----
    const totalCost = round2(
      cogs + firstLeg + referralFee + fulfillmentFee + storageFee + dutyFee + extrasFee
    );
    const netProfit = round2(netRevenue - totalCost);
    const margin = netRevenue > 0 ? netProfit / netRevenue : (salePrice > 0 ? netProfit / salePrice : 0);
    const roi = (cogs + firstLeg) > 0 ? netProfit / (cogs + firstLeg) : 0;

    // ---- 8. 盈亏平衡售价（使净利润 = 0 的售价，按含税售价口径反解）----
    // 设售价 P：净收入 = P - P*vat/(1+vat)；成本 = cogs+firstLeg+duty+fulfill+storage+extras + P*referralRate
    // 令净收入 - 成本 = 0 求 P
    const vatFactor = taxInclusive ? (1 - vatRate / (1 + vatRate)) : 1;
    const fixedCosts = cogs + firstLeg + dutyFee + fulfillmentFee + storageFee;
    const denom = vatFactor - referralRate;
    let breakEven = 0;
    if (denom > 0.0001) {
      breakEven = round2(fixedCosts / denom);
    }

    // ---- 9. 诊断提示 ----
    if (salePrice > 0 && referralFee > salePrice * 0.45) {
      warnings.push('佣金占比超过售价 45%，请确认类目费率是否正确');
    }
    if (netProfit < 0) {
      warnings.push('当前定价处于亏损状态，建议提价或降本');
    }
    if (fulfillmentFee === 0 && num(input.weight) > 0) {
      warnings.push('未能匹配到 FBA 分段费率，请检查重量单位');
    }
    if (storageFee === 0 && volumeCm3 === 0 && input.includeStorage !== false) {
      warnings.push('未填写商品尺寸，仓储费按 0 计（可忽略以简化）');
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      site: site.marketplace,
      currency: site.currency,
      symbol: site.symbol,
      breakdown: {
        salePrice: round2(salePrice),
        vatRate,
        vatAmount,
        netRevenue,
        cogs: round2(cogs),
        firstLeg: round2(firstLeg),
        referralRate,
        referralFee,
        fulfillmentFee,
        fulfillmentTier: fbaResult.tier,
        storageFee,
        dutyRate,
        dutyFee,
        extrasFee: round2(extrasFee),
        extrasDetail,
        totalCost
      },
      result: {
        netProfit,
        margin,
        marginPercent: round2(margin * 100),
        roi,
        roiPercent: round2(roi * 100),
        breakEvenPrice: breakEven,
        maxCogsForTarget: null
      }
    };
  }

  /**
   * 反解：给定目标利润率，求可承受的最高采购价
   */
  function solveMaxCogs(input, sitesMap, targetMargin) {
    const SITES = sitesMap || root.FBA_SITES || {};
    const site = SITES[input.site] || SITES.US;
    const salePrice = num(input.salePrice);
    const goal = num(targetMargin);
    if (salePrice <= 0) return 0;

    const base = calculate({ ...input, cogsPerUnit: 0, firstLegPerUnit: 0, dutyRate: 0 }, SITES);
    const otherCosts =
      base.breakdown.referralFee +
      base.breakdown.fulfillmentFee +
      base.breakdown.storageFee +
      base.breakdown.extrasFee;
    const targetProfit = base.breakdown.netRevenue * goal;
    const allowedCogsPlusFirstLeg = base.breakdown.netRevenue - otherCosts - targetProfit;
    if (allowedCogsPlusFirstLeg <= 0) return 0;

    // 若含关税，成本还要除以 (1+dutyRate)（因为 duty 按 cogs+firstLeg 计）
    const dutyRate = input.dutyRate !== undefined && input.dutyRate !== ''
      ? num(input.dutyRate)
      : num(site.importDutyDefault);
    const max = allowedCogsPlusFirstLeg / (1 + dutyRate);
    return round2(Math.max(0, max));
  }

  const api = {
    calculate,
    solveMaxCogs,
    lookupFbaFee,
    calcStorage,
    round2,
    num
  };

  if (typeof window !== 'undefined') {
    window.FbaCalculator = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
