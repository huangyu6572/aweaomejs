/**
 * selftest.js — 计算引擎自检
 * 用 node 运行： node tests/selftest.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'src', 'lib');
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.self = ctx;
// 内存版 localStorage / chrome.storage 桩
const memStore = {};
ctx.localStorage = {
  getItem: (k) => (memStore[k] === undefined ? null : memStore[k]),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: (k) => { delete memStore[k]; }
};
ctx.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        (Array.isArray(keys) ? keys : Object.keys(keys || {})).forEach((k) => {
          out[k] = memStore['fba_lic_' + k] !== undefined ? JSON.parse(memStore['fba_lic_' + k]) : undefined;
        });
        cb(out);
      },
      set: (patch, cb) => {
        for (const [k, v] of Object.entries(patch)) memStore['fba_lic_' + k] = JSON.stringify(v);
        cb && cb();
      }
    }
  }
};
vm.createContext(ctx);

for (const f of ['sites.js', 'cn.js', 'license.js', 'calculator.js', 'storage.js']) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
}

const SITES = ctx.FBA_SITES;
const Calc = ctx.FbaCalculator;
const Lic = ctx.FbaLicense;
const CN = ctx.FbaCN;

let pass = 0, fail = 0;
function eq(name, actual, expected, tol = 0.02) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { pass++; console.log(`  ✓ ${name}: ${actual}`); }
  else { fail++; console.log(`  ✗ ${name}: 期望 ${expected}, 实际 ${actual}`); }
}
function truthy(name, v) {
  if (v) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} (false)`); }
}

console.log('\n=== 1. 站点识别 ===');
eq('amazon.com -> US', (ctx.detectSiteFromHost('www.amazon.com') === 'US' ? 1 : 0), 1, 0);
eq('amazon.co.jp -> JP', (ctx.detectSiteFromHost('www.amazon.co.jp') === 'JP' ? 1 : 0), 1, 0);
eq('amazon.de -> DE', (ctx.detectSiteFromHost('www.amazon.de') === 'DE' ? 1 : 0), 1, 0);
eq('amazon.com.mx 不应误判为 US', (ctx.detectSiteFromHost('www.amazon.com.mx') === 'US' ? 1 : 0), 0, 0);

console.log('\n=== 2. 美国站手算校验 ===');
// 售价 $29.99, 采购 $5, 头程 $2, 重 0.5 lb -> 小号标准 $3.06, 佣金 15% = 4.4985 -> 4.50
// 关税 0（不填则用默认 7.5% -> (5+2)*0.075 = 0.525）
{
  const r = Calc.calculate({
    site: 'US', salePrice: 29.99, cogsPerUnit: 5, firstLegPerUnit: 2,
    weight: 0.5, storageMonths: 0, includeStorage: false
  }, SITES);
  console.log('  明细:', JSON.stringify(r.breakdown, null, 0));
  eq('佣金 15%', r.breakdown.referralFee, 4.50);
  eq('FBA 配送费 (小号标准)', r.breakdown.fulfillmentFee, 3.06);
  eq('关税 (5+2)*7.5%', r.breakdown.dutyFee, 0.525);
  eq('无 VAT', r.breakdown.vatAmount, 0);
  // 净利润 = 29.99 - (5+2+4.50+3.06+0.525) = 29.99 - 15.085 = 14.905
  eq('净利润', r.result.netProfit, 14.91);
  truthy('利润率 > 0.4', r.result.margin > 0.4);
}

console.log('\n=== 3. 德国站含 VAT 处理 ===');
// 售价 €30 含 19% VAT -> 净收入 = 30/1.19 = 25.21
{
  const r = Calc.calculate({
    site: 'DE', salePrice: 30, cogsPerUnit: 5, firstLegPerUnit: 2,
    weight: 0.5, storageMonths: 0, includeStorage: false
  }, SITES);
  eq('VAT 占比', r.breakdown.vatAmount, 30 - 30 / 1.19, 0.01);
  eq('不含税净收入', r.breakdown.netRevenue, 30 / 1.19, 0.01);
  eq('佣金按含税售价 15%', r.breakdown.referralFee, 4.50);
}

console.log('\n=== 4. 日本站分段费 ===');
{
  const r1 = Calc.calculate({ site: 'JP', salePrice: 3000, cogsPerUnit: 500, firstLegPerUnit: 100, weight: 0.2, includeStorage: false }, SITES);
  eq('JP 0.2kg -> 小型 292', r1.breakdown.fulfillmentFee, 292);
  const r2 = Calc.calculate({ site: 'JP', salePrice: 3000, cogsPerUnit: 500, firstLegPerUnit: 100, weight: 3, includeStorage: false }, SITES);
  eq('JP 3kg -> 标准 2-5kg 806', r2.breakdown.fulfillmentFee, 806);
}

console.log('\n=== 5. 美国站递增段位 ===');
{
  const r = Calc.calculate({ site: 'US', salePrice: 50, cogsPerUnit: 10, firstLegPerUnit: 3, weight: 5, includeStorage: false }, SITES);
  // 大号标准 3-20lb: 6.10 + (5-3)*0.16 = 6.42
  eq('US 5lb 大号标准', r.breakdown.fulfillmentFee, 6.42);
}

console.log('\n=== 6. 仓储费计算 ===');
{
  // 30x20x10 cm = 6000 cm³ = 0.2119 cuft; 标准季 0.78/cuft * 2 月
  const r = Calc.calculate({
    site: 'US', salePrice: 30, cogsPerUnit: 5, firstLegPerUnit: 2, weight: 0.5,
    lengthCm: 30, widthCm: 20, heightCm: 10, storageMonths: 2, monthIndex: 5
  }, SITES);
  const expect = (6000 / 28316.8466) * 0.78 * 2;
  eq('仓储费 (标准季 2 月)', r.breakdown.storageFee, expect, 0.02);
  // 旺季
  const r2 = Calc.calculate({
    site: 'US', salePrice: 30, cogsPerUnit: 5, firstLegPerUnit: 2, weight: 0.5,
    lengthCm: 30, widthCm: 20, heightCm: 10, storageMonths: 2, monthIndex: 11
  }, SITES);
  truthy('旺季仓储费 > 标准季', r2.breakdown.storageFee > r.breakdown.storageFee);
}

console.log('\n=== 7. 盈亏平衡价反解 ===');
{
  const r = Calc.calculate({
    site: 'US', salePrice: 30, cogsPerUnit: 5, firstLegPerUnit: 2, weight: 0.5,
    storageMonths: 0, includeStorage: false
  }, SITES);
  const be = r.result.breakEvenPrice;
  const check = Calc.calculate({
    site: 'US', salePrice: be, cogsPerUnit: 5, firstLegPerUnit: 2, weight: 0.5,
    storageMonths: 0, includeStorage: false
  }, SITES);
  eq('盈亏平衡价处净利润≈0', check.result.netProfit, 0, 0.03);
  truthy('盈亏平衡价 < 当前售价', be < 30);
}

console.log('\n=== 8. 负利润预警 ===');
{
  const r = Calc.calculate({
    site: 'US', salePrice: 8, cogsPerUnit: 5, firstLegPerUnit: 2, weight: 0.5,
    storageMonths: 0, includeStorage: false
  }, SITES);
  truthy('低价高成本被判为亏损', r.result.netProfit < 0);
  truthy('产生亏损告警', r.warnings.some((w) => w.includes('亏损')));
}

console.log('\n=== 9. 目标利润率反解最高采购价 ===');
{
  const input = { site: 'US', salePrice: 30, cogsPerUnit: 5, firstLegPerUnit: 2, weight: 0.5, storageMonths: 0, includeStorage: false };
  const maxCogs = Calc.solveMaxCogs(input, SITES, 0.20);
  const check = Calc.calculate({ ...input, cogsPerUnit: maxCogs, firstLegPerUnit: 0 }, SITES);
  eq('按最高采购价计算利润率≈20%', check.result.margin, 0.20, 0.005);
}

console.log('\n=== 10. 边界与异常 ===');
{
  const r = Calc.calculate({ site: 'US', salePrice: 0, cogsPerUnit: 5, firstLegPerUnit: 2 }, SITES);
  truthy('售价为 0 报错', !r.ok && r.errors.length > 0);
  const r2 = Calc.calculate({ site: 'US', salePrice: -5, cogsPerUnit: 5 }, SITES);
  truthy('负售价报错', !r2.ok);
  const r3 = Calc.calculate({ site: 'US', salePrice: '29.99', cogsPerUnit: '5', firstLegPerUnit: '2', weight: '0.5', includeStorage: false }, SITES);
  truthy('字符串输入可正常解析', r3.ok && r3.result.netProfit > 0);
  const r4 = Calc.calculate({ site: 'UNKNOWN_SITE', salePrice: 30, cogsPerUnit: 5, includeStorage: false }, SITES);
  truthy('未知站点回退 US', r4.site === 'US');
}

console.log('\n=== 11. 最低佣金下限 (US $0.30) ===');
{
  const r = Calc.calculate({ site: 'US', salePrice: 1.5, cogsPerUnit: 0.5, firstLegPerUnit: 0, weight: 0.1, includeStorage: false, dutyRate: 0 }, SITES);
  eq('佣金不低于 0.30', r.breakdown.referralFee, 0.30);
}

console.log('\n=== 12. 激活码校验 ===');
{
  truthy('正确激活码通过', Lic.verify('123456aB!').ok);
  truthy('大小写敏感 (123456ab! 拒绝)', !Lic.verify('123456ab!').ok);
  truthy('缺末尾 ! 拒绝', !Lic.verify('123456aB').ok);
  truthy('多一位拒绝', !Lic.verify('1234567aB!').ok);
  truthy('空串拒绝', !Lic.verify('').ok);
  truthy('null 拒绝', !Lic.verify(null).ok);
  truthy('undefined 拒绝', !Lic.verify(undefined).ok);
  truthy('空白串拒绝', !Lic.verify('   ').ok);
  truthy('超长串拒绝', !Lic.verify('x'.repeat(100)).ok);
  truthy('首尾空格被容忍', Lic.verify('  123456aB!  ').ok);
  eq('脱敏保留首尾 2 位', (Lic.mask('123456aB!') === '12****B!') ? 1 : 0, 1, 0);
}

console.log('\n=== 13. 激活状态持久化 ===');
(async () => {
  truthy('初始未激活', !(await Lic.isActivated()));

  const bad = await Lic.activate('wrongcode');
  truthy('错误码激活失败', !bad.ok);
  truthy('错误码后仍未激活', !(await Lic.isActivated()));

  const good = await Lic.activate('123456aB!');
  truthy('正确码激活成功', good.ok);
  truthy('激活状态已写入', await Lic.isActivated());

  const st = await Lic.getStatus();
  truthy('状态含激活时间', !!st.activatedAt);
  truthy('状态含脱敏码', st.codeMask === '12****B!');

  truthy('再次激活仍成功（幂等）', (await Lic.activate('123456aB!')).ok);
  truthy('激活状态保持', await Lic.isActivated());

  await Lic.deactivate();
  truthy('撤销后未激活', !(await Lic.isActivated()));

  console.log('\n=== 14. 人民币折算 ===');
  eq('USD→CNY 汇率 7.15', CN.rateOf('USD', null), 7.15);
  eq('JPY→CNY 汇率 0.0475', CN.rateOf('JPY', null), 0.0475);
  eq('CNY→CNY 恒为 1', CN.rateOf('CNY', null), 1);
  eq('$10 → ¥71.5', CN.toCNY(10, 'USD', null), 71.5);
  eq('¥71.5 → $10', CN.fromCNY(71.5, 'USD', null), 10, 0.001);
  eq('汇率覆盖生效', CN.rateOf('USD', { USD: 7.30 }), 7.30);
  eq('覆盖后 $10 → ¥73', CN.toCNY(10, 'USD', { USD: 7.30 }), 73);
  truthy('¥ 格式化带符号', CN.fmtCNY(1234.5) === '¥1,235');
  truthy('小额保留 2 位', CN.fmtCNY(12.34) === '¥12.34');
  truthy('类目中文映射', CN.categoryCn('Consumer Electronics') === '消费电子');
  truthy('未映射类目原样返回', CN.categoryCn('Unknown Cat') === 'Unknown Cat');

  // 端到端：美国站计算 + 人民币折算
  const r = Calc.calculate({
    site: 'US', salePrice: 29.99, cogsPerUnit: 5, firstLegPerUnit: 2,
    weight: 0.5, storageMonths: 0, includeStorage: false
  }, SITES);
  const cnyProfit = CN.toCNY(r.result.netProfit, 'USD', null);
  truthy(`端到端：净利润 ${r.result.netProfit} USD ≈ ¥${cnyProfit.toFixed(0)}`, cnyProfit > 100);

  // 站点覆盖 + 汇率覆盖联动
  const merged = ctx.FbaStorage.applyOverrides(SITES.US, {}, { USD: 7.30 });
  eq('全局汇率覆盖注入站点对象', merged.fxToCNY, 7.30);
  const merged2 = ctx.FbaStorage.applyOverrides(SITES.US, { US: { fxToCNY: 7.40 } }, { USD: 7.30 });
  eq('站点级汇率优先于全局', merged2.fxToCNY, 7.40);

  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
