/**
 * sites.js — 多站点费率与规则数据层
 *
 * 费率参考亚马逊官方公开费率（2024–2025 年区间）。亚马逊会不定期调价，
 * 因此本文件的所有数值都只作为"默认基准值"，用户可在 popup 设置页按站点覆盖。
 *
 * 数据结构说明：
 *  - marketplace : 站点标识
 *  - label       : 展示名
 *  - currency    : 本币代码
 *  - symbol      : 本币符号
 *  - fxToCNY     : 1 单位本币 ≈ 多少人民币（用于跨币种统一口径，可覆盖）
 *  - vatRate     : 增值税/销售税率（欧洲为 VAT，日本为消费税，美国为 0，由售价内含处理）
 *  - vatInclusive: 售价是否含税。欧洲/日本 listing 价格含税 → true；美国 false
 *  - referral    : 佣金。default 为默认比例，categories 为分类费率
 *  - fba         : FBA 配送费尺寸分段表 [{ maxLb, fee }] 或 [{ maxKg, fee }]
 *  - monthlyStorage : 月度仓储费（每立方英尺/每立方米，按淡旺季）
 *  - closingFee  : 媒介类目固定成交费（书籍/音像等）
 */

const FBA_SITES = {
  US: {
    marketplace: 'US',
    label: '美国站 (amazon.com)',
    hostPattern: 'amazon.com',
    currency: 'USD',
    symbol: '$',
    fxToCNY: 7.15,
    vatRate: 0,
    vatInclusive: false,
    importDutyDefault: 0.075,
    referral: {
      default: 0.15,
      categories: {
        'Amazon Device Accessories': 0.45,
        'Automotive & Powersports': 0.12,
        'Baby Products': 0.15,
        'Beauty, Health & Personal Care': 0.15,
        'Books': 0.15,
        'Camera & Photo': 0.08,
        'Cell Phone Devices': 0.08,
        'Clothing & Accessories': 0.17,
        'Computers': 0.08,
        'Consumer Electronics': 0.08,
        'Electronics Accessories': 0.15,
        'Furniture': 0.15,
        'Grocery & Gourmet Food': 0.15,
        'Health & Household': 0.15,
        'Home & Kitchen': 0.15,
        'Industrial & Scientific': 0.12,
        'Jewelry': 0.20,
        'Kitchen': 0.15,
        'Music': 0.15,
        'Office Products': 0.15,
        'Outdoors': 0.15,
        'Pet Products': 0.15,
        'Shoes, Handbags & Sunglasses': 0.15,
        'Software': 0.15,
        'Sports & Outdoors': 0.15,
        'Tools & Home Improvement': 0.15,
        'Toys & Games': 0.15,
        'Video Games': 0.15,
        'Watches': 0.16
      }
    },
    // FBA 配送费（标准尺寸，按商品重量磅计；单位 USD）
    fba: {
      sizeTiers: [
        { name: '小号标准 (≤1 lb)', maxLb: 1, fee: 3.06 },
        { name: '标准 1–2 lb', maxLb: 2, fee: 4.75 },
        { name: '标准 2–3 lb', maxLb: 3, fee: 5.68 },
        { name: '大号标准 3–20 lb（每 lb 递增）', maxLb: 20, fee: 6.10, perLb: 0.16, baseLb: 3 },
        { name: '大件 20–50 lb（每 lb 递增）', maxLb: 50, fee: 9.61, perLb: 0.38, baseLb: 20 },
        { name: '大件 50 lb 以上（每 lb 递增）', maxLb: 999, fee: 26.33, perLb: 0.75, baseLb: 50 }
      ],
      currency: 'USD',
      // 月度仓储费：1–9 月为标准季，10–12 月为旺季（每立方英尺）
      storageStandard: 0.78,
      storagePeak: 2.40,
      storageUnit: 'cuft',
      lowInventoryFee: 0
    },
    closingFee: 1.80,
    sizeSystem: 'imperial'
  },

  UK: {
    marketplace: 'UK',
    label: '英国站 (amazon.co.uk)',
    hostPattern: 'amazon.co.uk',
    currency: 'GBP',
    symbol: '£',
    fxToCNY: 9.05,
    vatRate: 0.20,
    vatInclusive: true,
    importDutyDefault: 0.04,
    referral: { default: 0.15, categories: { 'Consumer Electronics': 0.08, 'Computers': 0.08, 'Clothing & Accessories': 0.15, 'Jewelry': 0.20 } },
    fba: {
      sizeTiers: [
        { name: '轻小标准 (≤200g)', maxKg: 0.2, fee: 1.63 },
        { name: '标准 200–400g', maxKg: 0.4, fee: 1.86 },
        { name: '标准 400g–1kg', maxKg: 1, fee: 2.30 },
        { name: '标准 1–2kg', maxKg: 2, fee: 3.20 },
        { name: '标准 2–5kg', maxKg: 5, fee: 4.30 },
        { name: '大件 5–15kg', maxKg: 15, fee: 7.50 },
        { name: '大件 15kg 以上', maxKg: 999, fee: 12.00, perKg: 0.30, baseKg: 15 }
      ],
      currency: 'GBP',
      storageStandard: 0.75,
      storagePeak: 2.00,
      storageUnit: 'cuft',
      lowInventoryFee: 0
    },
    closingFee: 0,
    sizeSystem: 'metric'
  },

  DE: {
    marketplace: 'DE',
    label: '德国站 (amazon.de)',
    hostPattern: 'amazon.de',
    currency: 'EUR',
    symbol: '€',
    fxToCNY: 7.75,
    vatRate: 0.19,
    vatInclusive: true,
    importDutyDefault: 0.04,
    referral: { default: 0.15, categories: { 'Consumer Electronics': 0.08, 'Computers': 0.08, 'Games': 0.08 } },
    fba: {
      sizeTiers: [
        { name: '轻小标准 (≤200g)', maxKg: 0.2, fee: 1.80 },
        { name: '标准 200–400g', maxKg: 0.4, fee: 2.10 },
        { name: '标准 400g–1kg', maxKg: 1, fee: 2.60 },
        { name: '标准 1–2kg', maxKg: 2, fee: 3.60 },
        { name: '标准 2–5kg', maxKg: 5, fee: 4.90 },
        { name: '大件 5–15kg', maxKg: 15, fee: 8.30 },
        { name: '大件 15kg 以上', maxKg: 999, fee: 13.00, perKg: 0.33, baseKg: 15 }
      ],
      currency: 'EUR',
      storageStandard: 0.83,
      storagePeak: 2.20,
      storageUnit: 'cuft',
      lowInventoryFee: 0
    },
    closingFee: 0,
    sizeSystem: 'metric'
  },

  FR: {
    marketplace: 'FR',
    label: '法国站 (amazon.fr)',
    hostPattern: 'amazon.fr',
    currency: 'EUR',
    symbol: '€',
    fxToCNY: 7.75,
    vatRate: 0.20,
    vatInclusive: true,
    importDutyDefault: 0.04,
    referral: { default: 0.15, categories: { 'Consumer Electronics': 0.08, 'Computers': 0.08, 'Books': 0.15 } },
    fba: {
      sizeTiers: [
        { name: '轻小标准 (≤200g)', maxKg: 0.2, fee: 1.86 },
        { name: '标准 200–400g', maxKg: 0.4, fee: 2.16 },
        { name: '标准 400g–1kg', maxKg: 1, fee: 2.66 },
        { name: '标准 1–2kg', maxKg: 2, fee: 3.66 },
        { name: '标准 2–5kg', maxKg: 5, fee: 4.96 },
        { name: '大件 5–15kg', maxKg: 15, fee: 8.40 },
        { name: '大件 15kg 以上', maxKg: 999, fee: 13.20, perKg: 0.33, baseKg: 15 }
      ],
      currency: 'EUR',
      storageStandard: 0.83,
      storagePeak: 2.20,
      storageUnit: 'cuft',
      lowInventoryFee: 0
    },
    closingFee: 0,
    sizeSystem: 'metric'
  },

  IT: {
    marketplace: 'IT',
    label: '意大利站 (amazon.it)',
    hostPattern: 'amazon.it',
    currency: 'EUR',
    symbol: '€',
    fxToCNY: 7.75,
    vatRate: 0.22,
    vatInclusive: true,
    importDutyDefault: 0.04,
    referral: { default: 0.15, categories: { 'Consumer Electronics': 0.08, 'Computers': 0.08 } },
    fba: {
      sizeTiers: [
        { name: '轻小标准 (≤200g)', maxKg: 0.2, fee: 1.90 },
        { name: '标准 200–400g', maxKg: 0.4, fee: 2.20 },
        { name: '标准 400g–1kg', maxKg: 1, fee: 2.70 },
        { name: '标准 1–2kg', maxKg: 2, fee: 3.70 },
        { name: '标准 2–5kg', maxKg: 5, fee: 5.00 },
        { name: '大件 5–15kg', maxKg: 15, fee: 8.50 },
        { name: '大件 15kg 以上', maxKg: 999, fee: 13.30, perKg: 0.34, baseKg: 15 }
      ],
      currency: 'EUR',
      storageStandard: 0.83,
      storagePeak: 2.20,
      storageUnit: 'cuft',
      lowInventoryFee: 0
    },
    closingFee: 0,
    sizeSystem: 'metric'
  },

  ES: {
    marketplace: 'ES',
    label: '西班牙站 (amazon.es)',
    hostPattern: 'amazon.es',
    currency: 'EUR',
    symbol: '€',
    fxToCNY: 7.75,
    vatRate: 0.21,
    vatInclusive: true,
    importDutyDefault: 0.04,
    referral: { default: 0.15, categories: { 'Consumer Electronics': 0.08, 'Computers': 0.08 } },
    fba: {
      sizeTiers: [
        { name: '轻小标准 (≤200g)', maxKg: 0.2, fee: 1.88 },
        { name: '标准 200–400g', maxKg: 0.4, fee: 2.18 },
        { name: '标准 400g–1kg', maxKg: 1, fee: 2.68 },
        { name: '标准 1–2kg', maxKg: 2, fee: 3.68 },
        { name: '标准 2–5kg', maxKg: 5, fee: 4.98 },
        { name: '大件 5–15kg', maxKg: 15, fee: 8.45 },
        { name: '大件 15kg 以上', maxKg: 999, fee: 13.25, perKg: 0.33, baseKg: 15 }
      ],
      currency: 'EUR',
      storageStandard: 0.83,
      storagePeak: 2.20,
      storageUnit: 'cuft',
      lowInventoryFee: 0
    },
    closingFee: 0,
    sizeSystem: 'metric'
  },

  JP: {
    marketplace: 'JP',
    label: '日本站 (amazon.co.jp)',
    hostPattern: 'amazon.co.jp',
    currency: 'JPY',
    symbol: '¥',
    fxToCNY: 0.0475,
    vatRate: 0.10,
    vatInclusive: true,
    importDutyDefault: 0.03,
    referral: { default: 0.15, categories: { 'Consumer Electronics': 0.08, 'Computers': 0.08, 'Books': 0.15, 'Video Games': 0.08 } },
    fba: {
      sizeTiers: [
        { name: '小型 (≤250g)', maxKg: 0.25, fee: 292 },
        { name: '标准 250–500g', maxKg: 0.5, fee: 380 },
        { name: '标准 500g–1kg', maxKg: 1, fee: 466 },
        { name: '标准 1–2kg', maxKg: 2, fee: 592 },
        { name: '标准 2–5kg', maxKg: 5, fee: 806 },
        { name: '大件 5–10kg', maxKg: 10, fee: 1250 },
        { name: '大件 10–20kg', maxKg: 20, fee: 1980 },
        { name: '大件 20kg 以上', maxKg: 999, fee: 2800, perKg: 90, baseKg: 20 }
      ],
      currency: 'JPY',
      storageStandard: 7.4,
      storagePeak: 8.9,
      storageUnit: 'cuft',
      lowInventoryFee: 0
    },
    closingFee: 0,
    sizeSystem: 'metric'
  },

  CA: {
    marketplace: 'CA',
    label: '加拿大站 (amazon.ca)',
    hostPattern: 'amazon.ca',
    currency: 'CAD',
    symbol: 'C$',
    fxToCNY: 5.25,
    vatRate: 0.05,
    vatInclusive: false,
    importDutyDefault: 0.06,
    referral: { default: 0.15, categories: { 'Consumer Electronics': 0.08, 'Computers': 0.08 } },
    fba: {
      sizeTiers: [
        { name: '小号标准 (≤0.5 lb)', maxLb: 0.5, fee: 2.79 },
        { name: '标准 0.5–2 lb', maxLb: 2, fee: 4.05 },
        { name: '标准 2–5 lb', maxLb: 5, fee: 5.10 },
        { name: '大件 5–20 lb', maxLb: 20, fee: 6.86, perLb: 0.18, baseLb: 5 },
        { name: '大件 20 lb 以上', maxLb: 999, fee: 12.60, perLb: 0.55, baseLb: 20 }
      ],
      currency: 'CAD',
      storageStandard: 0.71,
      storagePeak: 2.18,
      storageUnit: 'cuft',
      lowInventoryFee: 0
    },
    closingFee: 1.70,
    sizeSystem: 'imperial'
  }
};

// 单位换算常量
const UNIT = {
  LB_PER_KG: 2.20462,
  CUFT_PER_CBM: 35.3147,
  IN3_PER_CUFT: 1728,
  CM3_PER_CUFT: 28316.8466
};

// 站点识别：根据 location.hostname 匹配
function detectSiteFromHost(hostname) {
  const host = (hostname || '').toLowerCase().replace(/^www\./, '');
  // 严格后缀匹配：host 必须等于 hostPattern，或以 "." + hostPattern 结尾
  // 例如 amazon.co.jp 命中 JP；amazon.com.mx 命中 MX 而非 US（因为不满足 .amazon.com 结尾）
  const ordered = Object.values(FBA_SITES).sort(
    (a, b) => b.hostPattern.length - a.hostPattern.length
  );
  for (const site of ordered) {
    if (host === site.hostPattern || host.endsWith('.' + site.hostPattern)) {
      return site.marketplace;
    }
  }
  return null;
}

function getSite(marketplace) {
  return FBA_SITES[marketplace] || FBA_SITES.US;
}

function listSites() {
  return Object.values(FBA_SITES).map((s) => ({
    marketplace: s.marketplace,
    label: s.label,
    currency: s.currency,
    symbol: s.symbol
  }));
}

// 导出（content_scripts 与 popup 均通过全局对象访问）
if (typeof window !== 'undefined') {
  window.FBA_SITES = FBA_SITES;
  window.FBA_UNIT = UNIT;
  window.detectSiteFromHost = detectSiteFromHost;
  window.getFbaSite = getSite;
  window.listFbaSites = listSites;
}
