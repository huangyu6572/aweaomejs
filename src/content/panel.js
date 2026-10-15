/**
 * panel.js — 商品页侧边注入面板
 *
 * 技术要点：
 *  1. 使用 Shadow DOM 完全隔离样式，避免被亚马逊页面 CSS 污染，也不污染页面。
 *  2. 自动从商品页抓取：售价、ASIN、标题、类目、重量/尺寸（尽力而为）。
 *  3. 面板可拖拽、可折叠为悬浮球、可切换左右。
 *  4. 实时计算：任一输入变化立即重算。
 */

(function () {
  'use strict';

  if (window.__FBA_PANEL_LOADED__) return;
  window.__FBA_PANEL_LOADED__ = true;

  const SITES = window.FBA_SITES || {};
  const Calc = window.FbaCalculator;
  const Storage = window.FbaStorage;
  const Lic = window.FbaLicense;
  const CN = window.FbaCN;
  if (!Calc || !Storage) {
    console.warn('[FBA 速算器] 依赖未加载，面板中止');
    return;
  }

  let settings = { ...Storage.DEFAULTS };
  let currentSite = 'US';
  let hostEl = null;
  let shadow = null;
  let els = {};
  let dragged = false;

  // ------------------------------------------------------------------
  // 页面数据抓取
  // ------------------------------------------------------------------
  function pickText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = (el.textContent || '').trim();
        if (t) return t;
      }
    }
    return '';
  }

  function extractPrice() {
    const raw = pickText([
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#corePrice_feature_div .a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '.a-price .a-offscreen',
      '#price_inside_buybox',
      '#tp_price_block_total_price_ww .a-offscreen'
    ]);
    let v = parseFloat(String(raw).replace(/[^0-9.,]/g, '').replace(/,/g, ''));
    if (!Number.isFinite(v)) {
      // 欧洲站点用逗号做小数点的兜底
      const m = String(raw).match(/[\d.,]+/);
      if (m) {
        const cleaned = m[0].replace(/\./g, '').replace(',', '.');
        const alt = parseFloat(cleaned);
        if (Number.isFinite(alt)) v = alt;
      }
    }
    return Number.isFinite(v) ? v : 0;
  }

  function extractAsin() {
    const m = location.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    if (m) return m[1].toUpperCase();
    const el = document.querySelector('input#ASIN, input[name="ASIN"]');
    if (el && el.value) return el.value.toUpperCase();
    const byData = document.querySelector('[data-asin]');
    if (byData) {
      const a = byData.getAttribute('data-asin');
      if (a && a.length === 10) return a.toUpperCase();
    }
    return '';
  }

  function extractTitle() {
    return pickText(['#productTitle', '#title', 'h1.a-size-large']) || document.title;
  }

  function extractCategory() {
    const crumbs = Array.from(document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a, .a-breadcrumb a'))
      .map((a) => (a.textContent || '').trim())
      .filter(Boolean);
    if (!crumbs.length) return '';
    // 取最末级类目，尝试映射到费率表里的类目名
    const last = crumbs[crumbs.length - 1];
    const table = (SITES[currentSite] && SITES[currentSite].referral.categories) || {};
    for (const key of Object.keys(table)) {
      if (key.toLowerCase().includes(last.toLowerCase()) || last.toLowerCase().includes(key.toLowerCase())) {
        return key;
      }
    }
    // 常见中文/英文关键词模糊匹配
    const guessMap = [
      [/electronics|电子/i, 'Consumer Electronics'],
      [/computers|电脑|计算机/i, 'Computers'],
      [/clothing|apparel|服装|衣/i, 'Clothing & Accessories'],
      [/home|kitchen|家居|厨房/i, 'Home & Kitchen'],
      [/toy|玩具/i, 'Toys & Games'],
      [/book|图书|书籍/i, 'Books'],
      [/beauty|美容|美妆/i, 'Beauty, Health & Personal Care'],
      [/sport|outdoor|运动|户外/i, 'Sports & Outdoors'],
      [/pet|宠物/i, 'Pet Products'],
      [/jewel|珠宝|首饰/i, 'Jewelry'],
      [/watches|手表/i, 'Watches'],
      [/office|办公/i, 'Office Products'],
      [/tools|五金|工具/i, 'Tools & Home Improvement']
    ];
    const hay = crumbs.join(' ');
    for (const [re, cat] of guessMap) {
      if (re.test(hay) && table[cat] !== undefined) return cat;
    }
    return '';
  }

  function extractWeightAndDims() {
    const out = { weight: 0, lengthCm: 0, widthCm: 0, heightCm: 0 };
    const detailText = Array.from(document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .a-keyvalue tr, table.a-normal tr'))
      .map((tr) => (tr.textContent || '').replace(/\s+/g, ' ').trim())
      .join(' | ');
    const hay = detailText + ' | ' + (document.querySelector('#detailBullets_feature_div') || {}).textContent;

    // 重量
    let w = 0;
    const wMatch = hay.match(/(?:item weight|product weight|shipping weight|商品重量|净重|重量)\D{0,25}?([\d.,]+)\s*(kilograms|kilogram|kgs|kg|grams|gram|g|pounds|pound|lbs|lb|ounces|ounce|oz|斤)/i);
    if (wMatch) {
      const val = parseFloat(wMatch[1].replace(/,/g, ''));
      const unit = wMatch[2].toLowerCase();
      if (Number.isFinite(val)) {
        if (unit.startsWith('kg') || unit.startsWith('kilo')) w = val * 2.20462;       // kg -> lb
        else if (unit === 'g' || unit.startsWith('gram')) w = (val / 1000) * 2.20462;  // g -> lb
        else if (unit.startsWith('oz') || unit.startsWith('ounce')) w = val / 16;      // oz -> lb
        else w = val;                                                                  // 已是 lb
      }
    }
    out.weightLb = w;
    out.weightKg = w / 2.20462;

    // 尺寸（常见形如 "10 x 8 x 6 inches" / "25 x 20 x 15 cm"）
    const dMatch = hay.match(/([\d.]+)\s*(?:x|×|\*)\s*([\d.]+)\s*(?:x|×|\*)\s*([\d.]+)\s*(inches|inch|in\b|centimeters|centimetres|cm|millimeters|millimetres|mm)/i);
    if (dMatch) {
      const a = parseFloat(dMatch[1]), b = parseFloat(dMatch[2]), c = parseFloat(dMatch[3]);
      const u = dMatch[4].toLowerCase();
      let factor = 1;
      if (u.startsWith('in')) factor = 2.54;
      else if (u.startsWith('mm') || u.startsWith('millim')) factor = 0.1;
      out.lengthCm = +(a * factor).toFixed(1);
      out.widthCm = +(b * factor).toFixed(1);
      out.heightCm = +(c * factor).toFixed(1);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // 样式与模板
  // ------------------------------------------------------------------
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }

  .root {
    position: fixed; top: 96px; right: 16px; width: 330px; max-height: calc(100vh - 130px);
    background: #ffffff; border: 1px solid #e3e6ea; border-radius: 14px;
    box-shadow: 0 10px 30px rgba(15,23,42,.14), 0 2px 6px rgba(15,23,42,.06);
    z-index: 2147483600; display: flex; flex-direction: column; overflow: hidden;
    color: #1a2029; font-size: 13px; line-height: 1.5;
  }
  .root.left { right: auto; left: 16px; }

  .hd {
    display: flex; align-items: center; gap: 8px; padding: 11px 12px;
    background: linear-gradient(135deg, #1f6feb 0%, #2f8af5 100%); color: #fff; cursor: grab;
    user-select: none; flex: 0 0 auto;
  }
  .hd:active { cursor: grabbing; }
  .hd .ttl { font-weight: 600; font-size: 13px; flex: 1; letter-spacing: .2px; }
  .hd .site-chip {
    background: rgba(255,255,255,.22); border-radius: 999px; padding: 2px 8px;
    font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;
  }
  .hd .site-chip:hover { background: rgba(255,255,255,.34); }
  .hd .btns { display: flex; gap: 4px; }
  .hd button {
    all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1;
    color: #fff; background: rgba(255,255,255,.16);
  }
  .hd button:hover { background: rgba(255,255,255,.32); }

  .bd { overflow-y: auto; padding: 12px; flex: 1 1 auto; }
  .bd::-webkit-scrollbar { width: 8px; }
  .bd::-webkit-scrollbar-thumb { background: #d6dbe2; border-radius: 4px; }

  .sec { margin-bottom: 12px; }
  .sec-hd {
    font-size: 11px; font-weight: 700; color: #6b7684; text-transform: uppercase;
    letter-spacing: .6px; margin-bottom: 7px; display: flex; align-items: center; gap: 6px;
  }
  .sec-hd::after { content: ""; flex: 1; height: 1px; background: #eef0f3; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }

  .fld { display: flex; flex-direction: column; gap: 3px; }
  .fld label { font-size: 11px; color: #6b7684; font-weight: 500; }
  .inp-wrap { position: relative; display: flex; align-items: center; }
  .inp-wrap .sym {
    position: absolute; left: 8px; font-size: 11px; color: #97a0ad; pointer-events: none;
  }
  .inp-wrap.has-sym input { padding-left: 20px; }
  input[type="number"], input[type="text"], select {
    width: 100%; border: 1px solid #dfe3e8; border-radius: 8px; padding: 7px 8px;
    font-size: 13px; color: #1a2029; background: #fff; outline: none; transition: border-color .15s, box-shadow .15s;
  }
  input:focus, select:focus { border-color: #2f8af5; box-shadow: 0 0 0 3px rgba(47,138,245,.13); }
  input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }

  .chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #4a5563; cursor: pointer; }
  .chk input { width: 14px; height: 14px; accent-color: #2f8af5; cursor: pointer; }

  /* 结果卡 */
  .result {
    border-radius: 12px; padding: 12px; background: #f7f9fc; border: 1px solid #e8ecf1; margin-bottom: 12px;
  }
  .res-main { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
  .res-profit { display: flex; flex-direction: column; }
  .res-profit .lbl { font-size: 11px; color: #6b7684; font-weight: 500; }
  .res-profit .val { font-size: 26px; font-weight: 700; line-height: 1.15; letter-spacing: -.5px; }
  .res-profit .val.pos { color: #d92b2b; }  /* 中国习惯：盈利为红 */
  .res-profit .val.neg { color: #12924f; }  /* 亏损为绿 */
  .res-margin { text-align: right; }
  .res-margin .lbl { font-size: 11px; color: #6b7684; font-weight: 500; }
  .res-margin .val { font-size: 17px; font-weight: 700; }
  .badge {
    display: inline-block; margin-top: 8px; padding: 3px 9px; border-radius: 999px;
    font-size: 11px; font-weight: 600;
  }
  .badge.good { background: #fdecec; color: #c62828; }
  .badge.mid  { background: #fff4e5; color: #b26a00; }
  .badge.bad  { background: #e8f5ee; color: #0f7a44; }

  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
  .kpi { background: #fff; border: 1px solid #e8ecf1; border-radius: 9px; padding: 7px 8px; }
  .kpi .k { font-size: 10px; color: #808b99; font-weight: 500; white-space: nowrap; }
  .kpi .v { font-size: 13px; font-weight: 700; color: #1a2029; margin-top: 1px; }
  .kpi .v.pos { color: #d92b2b; }
  .kpi .v.neg { color: #12924f; }

  /* 费用明细 */
  .bar { display: flex; height: 10px; border-radius: 6px; overflow: hidden; background: #eef0f3; margin: 4px 0 9px; }
  .bar > div { height: 100%; }
  .legend { display: flex; flex-direction: column; gap: 5px; }
  .lg { display: flex; align-items: center; font-size: 12px; color: #3d4653; }
  .lg .dot { width: 9px; height: 9px; border-radius: 3px; margin-right: 7px; flex: 0 0 auto; }
  .lg .nm { flex: 1; color: #4a5563; }
  .lg .amt { font-variant-numeric: tabular-nums; font-weight: 600; color: #1a2029; }
  .lg.total { border-top: 1px dashed #e3e6ea; margin-top: 3px; padding-top: 6px; font-weight: 700; }
  .lg.total .nm { color: #1a2029; font-weight: 700; }

  .hint {
    font-size: 11.5px; padding: 8px 10px; border-radius: 8px; margin-bottom: 8px; line-height: 1.45;
  }
  .hint.warn { background: #fff8e6; color: #8a6100; border: 1px solid #ffe9b3; }
  .hint.err  { background: #fdecec; color: #b71c1c; border: 1px solid #f8d0d0; }
  .hint.info { background: #eef5ff; color: #1b5fa8; border: 1px solid #d3e4fb; }

  .ft {
    padding: 8px 12px; border-top: 1px solid #eef0f3; background: #fbfcfd;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    font-size: 11px; color: #8b95a3; flex: 0 0 auto;
  }
  .ft a { color: #2f8af5; text-decoration: none; cursor: pointer; }
  .ft a:hover { text-decoration: underline; }

  .cf-sel { display: flex; flex-wrap: wrap; gap: 5px; }
  .cf-sel span {
    font-size: 11.5px; padding: 4px 9px; border-radius: 999px; background: #f2f5f9;
    color: #55606e; cursor: pointer; border: 1px solid transparent; transition: all .12s;
  }
  .cf-sel span:hover { background: #e8eef7; }
  .cf-sel span.on { background: #e8f1ff; color: #1f6feb; border-color: #b9d6fb; font-weight: 600; }

  /* 类目列表：限高可滚动，避免面板过高 */
  .cf-sel.scroll {
    max-height: 96px; overflow-y: auto; padding-right: 3px;
  }
  .cf-sel.scroll::-webkit-scrollbar { width: 6px; }
  .cf-sel.scroll::-webkit-scrollbar-thumb { background: #d6dbe2; border-radius: 3px; }

  /* 人民币折算展示 */
  .cny {
    font-size: 11px; color: #8b95a3; margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .cny b { color: #55606e; font-weight: 600; }
  .res-profit-cny { font-size: 13px; color: #808b99; margin-top: 1px; font-variant-numeric: tabular-nums; }
  .res-profit-cny.pos { color: #e06868; }
  .res-profit-cny.neg { color: #4fa87a; }
  .kpi .v .sub { font-size: 10.5px; color: #97a0ad; font-weight: 500; display: block; margin-top: 1px; }
  .lg .cny-mini { font-size: 10px; color: #aab2bd; margin-left: 6px; font-weight: 500; }

  /* 激活锁屏 */
  .lock {
    padding: 22px 18px; text-align: center;
  }
  .lock .lock-ico {
    width: 48px; height: 48px; border-radius: 14px; margin: 0 auto 14px;
    background: linear-gradient(135deg, #1f6feb, #2f8af5); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 22px;
    box-shadow: 0 6px 16px rgba(31,111,235,.3);
  }
  .lock h3 { font-size: 15px; font-weight: 700; margin-bottom: 6px; color: #1a2029; }
  .lock p { font-size: 12px; color: #6b7684; line-height: 1.65; margin-bottom: 16px; }
  .lock .code-inp {
    width: 100%; border: 1px solid #dfe3e8; border-radius: 9px; padding: 10px 12px;
    font-size: 14px; text-align: center; letter-spacing: 2px; outline: none;
    font-family: ui-monospace, Menlo, Consolas, monospace; transition: all .15s;
  }
  .lock .code-inp:focus { border-color: #2f8af5; box-shadow: 0 0 0 3px rgba(47,138,245,.13); }
  .lock .code-inp.err { border-color: #e5484d; box-shadow: 0 0 0 3px rgba(229,72,77,.12); }
  .lock .msg { font-size: 11.5px; margin-top: 9px; min-height: 16px; }
  .lock .msg.err { color: #c62828; }
  .lock .msg.ok { color: #0f7a44; }
  .lock button {
    width: 100%; margin-top: 12px; padding: 11px; border-radius: 10px; border: none;
    background: linear-gradient(135deg, #1f6feb, #2f8af5); color: #fff;
    font-size: 13.5px; font-weight: 700; cursor: pointer; font-family: inherit;
    transition: all .15s;
  }
  .lock button:hover { filter: brightness(1.06); box-shadow: 0 4px 14px rgba(31,111,235,.3); }
  .lock button:disabled { opacity: .55; cursor: not-allowed; filter: none; box-shadow: none; }
  .lock .foot-note {
    margin-top: 14px; padding-top: 12px; border-top: 1px dashed #eef0f3;
    font-size: 11px; color: #97a0ad; line-height: 1.6;
  }

  /* 悬浮球 */
  .fab {
    position: fixed; z-index: 2147483600; width: 52px; height: 52px; border-radius: 50%;
    background: linear-gradient(135deg, #1f6feb 0%, #2f8af5 100%); color: #fff;
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    box-shadow: 0 6px 18px rgba(31,111,235,.4); font-size: 20px; font-weight: 700;
    border: none; outline: none; transition: transform .15s;
  }
  .fab:hover { transform: scale(1.07); }
  .fab .tag {
    position: absolute; top: -4px; right: -4px; background: #fff; color: #1f6feb;
    border-radius: 999px; padding: 1px 5px; font-size: 10px; font-weight: 700;
    box-shadow: 0 1px 4px rgba(0,0,0,.18); border: 1px solid #dbe7f8;
  }
  .fab.locked { background: linear-gradient(135deg, #8b95a3, #a8b1bd); box-shadow: 0 6px 18px rgba(139,149,163,.35); }
  .fab.locked .tag { color: #6b7684; border-color: #e3e6ea; }
  .dim { display: none !important; }
  `;

  const COLORS = {
    cogs: '#5b6b7f',
    firstLeg: '#7d8ca0',
    duty: '#a3b0c2',
    referral: '#f2994a',
    fulfillment: '#2f8af5',
    storage: '#9b7ff0',
    extras: '#d4d9e0',
    profit: '#e5484d'
  };

  function fmtMoney(v, symbol) {
    const n = Math.abs(v) >= 1000
      ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : v.toFixed(2);
    return `${symbol}${n}`;
  }

  function fmtPct(v) {
    return `${(v * 100).toFixed(1)}%`;
  }

  /** 人民币折算：把本币金额换算成 ¥ 并格式化。未开启或已是人民币时返回空串 */
  function cnyOf(amount, site) {
    if (!CN || !settings.showCNY) return '';
    if (site.currency === 'CNY') return '';
    const fx = settings.fxOverrides && settings.fxOverrides[site.currency] !== undefined
      ? parseFloat(settings.fxOverrides[site.currency])
      : (site.fxToCNY || CN.rateOf(site.currency, null));
    if (!fx) return '';
    return CN.fmtCNY((parseFloat(amount) || 0) * fx);
  }

  // ------------------------------------------------------------------
  // Shadow DOM 构建
  // ------------------------------------------------------------------
  function buildPanel() {
    if (hostEl) return;
    hostEl = document.createElement('div');
    hostEl.id = 'fba-profit-calculator-host';
    // 防止页面样式影响宿主
    hostEl.style.all = 'initial';
    document.documentElement.appendChild(hostEl);
    shadow = hostEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;

    const wrap = document.createElement('div');
    wrap.innerHTML = templateHTML();

    shadow.appendChild(style);
    shadow.appendChild(wrap);

    els.root = shadow.querySelector('.root');
    els.fab = shadow.querySelector('.fab');
    els.salePrice = shadow.getElementById('salePrice');
    els.cogs = shadow.getElementById('cogs');
    els.firstLeg = shadow.getElementById('firstLeg');
    els.extraFee = shadow.getElementById('extraFee');
    els.weight = shadow.getElementById('weight');
    els.dimsL = shadow.getElementById('dimsL');
    els.dimsW = shadow.getElementById('dimsW');
    els.dimsH = shadow.getElementById('dimsH');
    els.storageMonths = shadow.getElementById('storageMonths');
    els.dutyRate = shadow.getElementById('dutyRate');
    els.referralRate = shadow.getElementById('referralRate');
    els.includeStorage = shadow.getElementById('includeStorage');
    els.catSel = shadow.getElementById('catSel');
    els.outProfit = shadow.getElementById('outProfit');
    els.outProfitCny = shadow.getElementById('outProfitCny');
    els.outMargin = shadow.getElementById('outMargin');
    els.badge = shadow.getElementById('badge');
    els.kpiRoi = shadow.getElementById('kpiRoi');
    els.kpiBreak = shadow.getElementById('kpiBreak');
    els.kpiCost = shadow.getElementById('kpiCost');
    els.bar = shadow.getElementById('bar');
    els.legend = shadow.getElementById('legend');
    els.hint = shadow.getElementById('hint');
    els.siteChip = shadow.getElementById('siteChip');
    els.asinLabel = shadow.getElementById('asinLabel');
    els.lockScreen = shadow.getElementById('lockScreen');
    els.bd = shadow.getElementById('bd');
    els.lockCode = shadow.getElementById('lockCode');
    els.btnActivate = shadow.getElementById('btnActivate');
    els.lockMsg = shadow.getElementById('lockMsg');

    wireEvents();
    wireLicense();
    applyPosition();
  }

  // ------------------------------------------------------------------
  // 激活码门禁
  // ------------------------------------------------------------------
  function showLock() {
    els.lockScreen.classList.remove('dim');
    els.bd.classList.add('dim');
    els.root.classList.remove('dim');
    els.fab.classList.add('dim');
    els.root.style.top = '';
    els.root.style.left = '';
    els.root.classList.add('left');
    setTimeout(() => {
      if (els.lockCode) els.lockCode.focus();
    }, 120);
  }

  function hideLock() {
    els.lockScreen.classList.add('dim');
    els.bd.classList.remove('dim');
    els.root.classList.remove('left');
  }

  function wireLicense() {
    if (!Lic) return;

    els.btnActivate.addEventListener('click', tryActivate);
    els.lockCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryActivate();
    });
    els.lockCode.addEventListener('input', () => {
      els.lockCode.classList.remove('err');
      els.lockMsg.textContent = '';
      els.lockMsg.className = 'msg';
    });
  }

  async function tryActivate() {
    const code = els.lockCode.value;
    if (!code || !code.trim()) {
      els.lockMsg.textContent = '请输入激活码';
      els.lockMsg.className = 'msg err';
      els.lockCode.classList.add('err');
      return;
    }

    els.btnActivate.disabled = true;
    els.btnActivate.textContent = '校验中…';

    const res = await Lic.activate(code);

    if (res.ok) {
      els.lockMsg.textContent = '激活成功，正在解锁…';
      els.lockMsg.className = 'msg ok';
      setTimeout(() => {
        hideLock();
        bootPanelContent();
      }, 500);
    } else {
      els.btnActivate.disabled = false;
      els.btnActivate.textContent = '激活';
      els.lockMsg.textContent = res.reason || '激活码无效';
      els.lockMsg.className = 'msg err';
      els.lockCode.classList.add('err');
      els.lockCode.select();
    }
  }

  function templateHTML() {
    const siteOptions = Object.values(SITES)
      .map((s) => `<option value="${s.marketplace}">${s.label}</option>`)
      .join('');

    return `
      <button class="fab dim" title="打开 FBA 利润速算器">FBA<span class="tag">¥</span></button>

      <div class="root">
        <div class="hd" id="hd">
          <span class="ttl">FBA 利润速算器</span>
          <span class="site-chip" id="siteChip">US</span>
          <span class="btns">
            <button id="btnCollapse" title="折叠为悬浮球">—</button>
            <button id="btnClose" title="关闭面板">✕</button>
          </span>
        </div>

        <!-- 未激活锁屏 -->
        <div class="bd dim" id="lockScreen">
          <div class="lock">
            <div class="lock-ico">🔒</div>
            <h3>需要激活码</h3>
            <p>本工具为一次性授权使用。<br>请输入激活码后解锁全部功能。</p>
            <input type="password" class="code-inp" id="lockCode" placeholder="请输入激活码" autocomplete="off" spellcheck="false">
            <button id="btnActivate">激活</button>
            <div class="msg" id="lockMsg"></div>
            <div class="foot-note">
              激活码可在扩展弹窗中查看状态<br>激活后在本机永久有效
            </div>
          </div>
        </div>

        <div class="bd" id="bd">
          <div id="hint"></div>

          <div class="sec">
            <div class="sec-hd">站点</div>
            <div class="fld">
              <select id="siteSelect" style="display:none">${siteOptions}</select>
              <div class="cf-sel" id="siteChips"></div>
            </div>
            <div style="margin-top:7px;font-size:11px;color:#8b95a3" id="asinLabel"></div>
          </div>

          <div class="sec">
            <div class="sec-hd">核心输入</div>
            <div class="fld" style="margin-bottom:8px">
              <label>售价（含税/页面价）</label>
              <div class="inp-wrap has-sym"><span class="sym" id="symSale">$</span>
                <input type="number" id="salePrice" step="0.01" min="0" placeholder="0.00"></div>
            </div>
            <div class="grid2">
              <div class="fld"><label>采购价/件</label>
                <div class="inp-wrap has-sym"><span class="sym" id="symCogs">$</span>
                  <input type="number" id="cogs" step="0.01" min="0" placeholder="0.00"></div></div>
              <div class="fld"><label>头程运费/件</label>
                <div class="inp-wrap has-sym"><span class="sym" id="symLeg">$</span>
                  <input type="number" id="firstLeg" step="0.01" min="0" placeholder="0.00"></div></div>
            </div>
            <div class="grid2" style="margin-top:8px">
              <div class="fld"><label>其他费用/件</label>
                <div class="inp-wrap has-sym"><span class="sym" id="symExtra">$</span>
                  <input type="number" id="extraFee" step="0.01" min="0" placeholder="广告分摊等"></div></div>
              <div class="fld"><label>关税率 %</label>
                <div class="inp-wrap has-sym"><span class="sym">%</span>
                  <input type="number" id="dutyRate" step="0.1" min="0" placeholder="7.5"></div></div>
            </div>
          </div>

          <div class="sec">
            <div class="sec-hd">商品规格（选填，影响 FBA 费与仓储费）</div>
            <div class="grid2">
              <div class="fld"><label>重量（<span id="wUnit">lb</span>）</label>
                <input type="number" id="weight" step="0.01" min="0" placeholder="0.00"></div>
              <div class="fld"><label>平均仓储月数</label>
                <input type="number" id="storageMonths" step="1" min="0" placeholder="1"></div>
            </div>
            <div class="grid3" style="margin-top:8px">
              <div class="fld"><label>长 cm</label><input type="number" id="dimsL" step="0.1" min="0"></div>
              <div class="fld"><label>宽 cm</label><input type="number" id="dimsW" step="0.1" min="0"></div>
              <div class="fld"><label>高 cm</label><input type="number" id="dimsH" step="0.1" min="0"></div>
            </div>
            <label class="chk" style="margin-top:8px"><input type="checkbox" id="includeStorage" checked> 计入月度仓储费</label>
          </div>

          <div class="sec">
            <div class="sec-hd">佣金类目</div>
            <div class="cf-sel scroll" id="catSel"></div>
            <div class="grid2" style="margin-top:8px">
              <div class="fld"><label>佣金率覆盖 %（留空用类目值）</label>
                <div class="inp-wrap has-sym"><span class="sym">%</span>
                  <input type="number" id="referralRate" step="0.1" min="0" placeholder="自动"></div></div>
            </div>
          </div>

          <div class="result">
            <div class="res-main">
              <div class="res-profit">
                <span class="lbl">净利润 / 件</span>
                <span class="val" id="outProfit">—</span>
                <span class="res-profit-cny" id="outProfitCny"></span>
              </div>
              <div class="res-margin">
                <span class="lbl">利润率</span>
                <span class="val" id="outMargin">—</span>
              </div>
            </div>
            <div id="badge"></div>
            <div class="kpis">
              <div class="kpi"><div class="k">ROI</div><div class="v" id="kpiRoi">—</div></div>
              <div class="kpi"><div class="k">盈亏平衡价</div><div class="v" id="kpiBreak">—</div></div>
              <div class="kpi"><div class="k">总成本</div><div class="v" id="kpiCost">—</div></div>
            </div>
          </div>

          <div class="sec">
            <div class="sec-hd">费用拆解</div>
            <div class="bar" id="bar"></div>
            <div class="legend" id="legend"></div>
          </div>
        </div>

        <div class="ft">
          <span id="ftSite">费率基准：2024–2025</span>
          <a id="ftReset">重置输入</a>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // 事件与渲染
  // ------------------------------------------------------------------
  function wireEvents() {
    // 折叠 / 关闭
    shadow.getElementById('btnCollapse').addEventListener('click', () => {
      setCollapsed(true);
    });
    shadow.getElementById('btnClose').addEventListener('click', async () => {
      els.root.classList.add('dim');
      els.fab.classList.add('dim');
      await Storage.set({ enabled: false });
    });
    els.fab.addEventListener('click', () => setCollapsed(false));

    // 拖拽
    const hd = shadow.getElementById('hd');
    let startX, startY, startTop, startLeft, moved;
    hd.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const rect = els.root.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startTop = rect.top; startLeft = rect.left;
      moved = false;
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        els.root.style.top = Math.max(4, startTop + dy) + 'px';
        els.root.style.left = Math.max(4, startLeft + dx) + 'px';
        els.root.style.right = 'auto';
        els.root.classList.remove('left');
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 输入监听：实时计算
    const inputs = ['salePrice', 'cogs', 'firstLeg', 'extraFee', 'weight',
      'dimsL', 'dimsW', 'dimsH', 'storageMonths', 'dutyRate', 'referralRate'];
    for (const id of inputs) {
      els[id].addEventListener('input', () => recompute());
      els[id].addEventListener('change', () => recompute());
    }
    els.includeStorage.addEventListener('change', () => recompute());

    // 站点切换
    shadow.getElementById('siteChips').addEventListener('click', (e) => {
      const chip = e.target.closest('span[data-site]');
      if (chip) switchSite(chip.getAttribute('data-site'));
    });
    els.siteChip.addEventListener('click', () => {
      const chips = shadow.getElementById('siteChips');
      chips.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    shadow.getElementById('ftReset').addEventListener('click', () => resetInputs());
  }

  function buildSiteChips() {
    const container = shadow.getElementById('siteChips');
    container.innerHTML = Object.values(SITES)
      .map((s) => `<span data-site="${s.marketplace}" class="${s.marketplace === currentSite ? 'on' : ''}">${s.marketplace}</span>`)
      .join('');
  }

  function buildCategoryChips() {
    const site = SITES[currentSite];
    const cats = site && site.referral.categories ? site.referral.categories : {};
    const entries = Object.entries(cats);
    els.catSel.innerHTML =
      `<span data-cat="" class="${!settings.lastCategory ? 'on' : ''}">默认 ${(site.referral.default * 100).toFixed(0)}%</span>` +
      entries.map(([k]) => `<span data-cat="${k}" class="${settings.lastCategory === k ? 'on' : ''}">${k} ${(SITES[currentSite].referral.categories[k] * 100).toFixed(0)}%</span>`).join('');

    if (!els.catSel.__bound) {
      els.catSel.addEventListener('click', async (e) => {
        const chip = e.target.closest('span[data-cat]');
        if (!chip) return;
        const cat = chip.getAttribute('data-cat');
        els.catSel.querySelectorAll('span').forEach((s) => s.classList.remove('on'));
        chip.classList.add('on');
        els.catSel.__cat = cat;
        settings.lastCategory = cat;
        await Storage.set({ lastCategory: cat });
        recompute();
      });
      els.catSel.__bound = true;
    }
    els.catSel.__cat = settings.lastCategory || '';
  }

  function switchSite(mp) {
    if (!SITES[mp]) return;
    currentSite = mp;
    const site = SITES[mp];
    // 更新符号
    els.siteChip.textContent = mp;
    shadow.getElementById('symSale').textContent = site.symbol;
    shadow.getElementById('symCogs').textContent = site.symbol;
    shadow.getElementById('symLeg').textContent = site.symbol;
    shadow.getElementById('symExtra').textContent = site.symbol;
    shadow.getElementById('wUnit').textContent = site.sizeSystem === 'imperial' ? 'lb' : 'kg';
    // 更新税率默认值
    els.dutyRate.placeholder = (site.importDutyDefault * 100).toFixed(1);
    // 更新站点 chips
    shadow.querySelectorAll('#siteChips span').forEach((s) => {
      s.classList.toggle('on', s.getAttribute('data-site') === mp);
    });
    buildCategoryChips();
    recompute();
    Storage.set({ defaultSite: mp });
  }

  function setCollapsed(collapsed) {
    els.root.classList.toggle('dim', collapsed);
    els.fab.classList.toggle('dim', !collapsed);
    // 悬浮球位置
    if (collapsed) {
      els.fab.style.top = '140px';
      els.fab.style.right = settings.panelPosition === 'left' ? 'auto' : '16px';
      els.fab.style.left = settings.panelPosition === 'left' ? '16px' : 'auto';
    }
    Storage.set({ panelCollapsed: collapsed });
  }

  function applyPosition() {
    els.root.classList.toggle('left', settings.panelPosition === 'left');
    if (settings.panelCollapsed && settings.collapseToFab) {
      setCollapsed(true);
    }
  }

  function resetInputs() {
    for (const id of ['salePrice', 'cogs', 'firstLeg', 'extraFee', 'weight', 'dimsL', 'dimsW', 'dimsH', 'referralRate']) {
      els[id].value = '';
    }
    els.storageMonths.value = settings.storageMonths || 1;
    els.dutyRate.value = '';
    const asin = extractAsin();
    const pagePrice = extractPrice();
    if (pagePrice > 0) els.salePrice.value = pagePrice;
    recompute();
  }

  function readInputs() {
    return {
      site: currentSite,
      salePrice: els.salePrice.value,
      cogsPerUnit: els.cogs.value,
      firstLegPerUnit: els.firstLeg.value,
      extraFee: els.extraFee.value,
      weight: els.weight.value,
      lengthCm: els.dimsL.value,
      widthCm: els.dimsW.value,
      heightCm: els.dimsH.value,
      storageMonths: els.storageMonths.value,
      includeStorage: els.includeStorage.checked,
      dutyRate: els.dutyRate.value,
      referralOverride: els.referralRate.value,
      category: (els.catSel.__cat || '')
    };
  }

  function recompute() {
    const input = readInputs();
    const site = SITES[currentSite];

    if (input.salePrice === '' || parseFloat(input.salePrice) <= 0) {
      renderEmptyState('请输入售价开始计算');
      return;
    }

    const res = Calc.calculate(input, SITES);
    if (!res.ok) {
      renderEmptyState(res.errors.join('；'), true);
      return;
    }

    const b = res.breakdown;
    const r = res.result;
    const sym = res.symbol;

    // 主结果
    els.outProfit.textContent = (r.netProfit >= 0 ? '+' : '-') + fmtMoney(Math.abs(r.netProfit), sym);
    els.outProfit.className = 'val ' + (r.netProfit >= 0 ? 'pos' : 'neg');
    els.outMargin.textContent = fmtPct(r.margin);
    els.outMargin.style.color = r.netProfit >= 0 ? '#d92b2b' : '#12924f';

    // 人民币折算（中国卖家最关心的数字）
    const cnyProfit = cnyOf(r.netProfit, site);
    if (cnyProfit) {
      els.outProfitCny.textContent = `≈ ${cnyProfit} / 件`;
      els.outProfitCny.className = 'res-profit-cny ' + (r.netProfit >= 0 ? 'pos' : 'neg');
    } else {
      els.outProfitCny.textContent = '';
    }

    // 徽章
    const tm = settings.targetMargin;
    let cls = 'good', txt = '';
    if (r.margin >= tm) { cls = 'good'; txt = `达标 · 高于目标 ${fmtPct(tm)}`; }
    else if (r.margin > 0) { cls = 'mid'; txt = `偏低 · 目标 ${fmtPct(tm)}，差 ${(tm * 100 - r.margin * 100).toFixed(1)} 个点`; }
    else { cls = 'bad'; txt = '亏损 · 需要提价或降本'; }
    els.badge.innerHTML = `<span class="badge ${cls}">${txt}</span>`;

    // KPI
    els.kpiRoi.textContent = fmtPct(r.roi);
    els.kpiRoi.className = 'v ' + (r.roi >= 0 ? 'pos' : 'neg');
    els.kpiBreak.textContent = r.breakEvenPrice > 0 ? fmtMoney(r.breakEvenPrice, sym) : '—';
    els.kpiCost.textContent = fmtMoney(b.totalCost, sym);
    const cnyCost = cnyOf(b.totalCost, site);
    if (cnyCost) {
      els.kpiCost.innerHTML = `${fmtMoney(b.totalCost, sym)}<span class="sub">≈${cnyCost}</span>`;
      els.kpiCost.className = 'v';
    }

    // 费用条
    const parts = [
      ['cogs', b.cogs],
      ['firstLeg', b.firstLeg],
      ['duty', b.dutyFee],
      ['referral', b.referralFee],
      ['fulfillment', b.fulfillmentFee],
      ['storage', b.storageFee],
      ['extras', b.extrasFee]
    ];
    const profitForBar = Math.max(0, r.netProfit);
    const total = parts.reduce((s, [, v]) => s + v, 0) + profitForBar;
    if (total > 0) {
      els.bar.innerHTML =
        parts.filter(([, v]) => v > 0).map(([k, v]) =>
          `<div style="width:${(v / total * 100).toFixed(2)}%;background:${COLORS[k]}" title="${k}: ${v.toFixed(2)}"></div>`
        ).join('') +
        (profitForBar > 0
          ? `<div style="width:${(profitForBar / total * 100).toFixed(2)}%;background:${COLORS.profit}" title="profit"></div>`
          : '');
    }

    // 明细
    const rows = [
      ['采购成本', COLORS.cogs, b.cogs],
      ['头程运费', COLORS.firstLeg, b.firstLeg],
      ['关税 (' + (b.dutyRate * 100).toFixed(1) + '%)', COLORS.duty, b.dutyFee],
      [`平台佣金 (${(b.referralRate * 100).toFixed(1)}%)`, COLORS.referral, b.referralFee],
      [`FBA 配送费 · ${b.fulfillmentTier}`, COLORS.fulfillment, b.fulfillmentFee],
      ['月度仓储费', COLORS.storage, b.storageFee],
      ['其他费用', COLORS.extras, b.extrasFee]
    ];
    let html = rows.map(([nm, c, v]) => {
      const mini = cnyOf(v, site);
      return `<div class="lg"><span class="dot" style="background:${c}"></span><span class="nm">${nm}</span><span class="amt">${fmtMoney(v, sym)}${mini ? `<span class="cny-mini">≈${mini}</span>` : ''}</span></div>`;
    }).join('');
    html += `<div class="lg"><span class="dot" style="background:transparent"></span><span class="nm">含税售价</span><span class="amt">${fmtMoney(b.salePrice, sym)}</span></div>`;
    if (b.vatAmount > 0) {
      html += `<div class="lg"><span class="dot" style="background:transparent"></span><span class="nm">其中增值税 (${(b.vatRate * 100).toFixed(0)}%)</span><span class="amt">-${fmtMoney(b.vatAmount, sym)}</span></div>`;
    }
    html += `<div class="lg"><span class="dot" style="background:transparent"></span><span class="nm">不含税净收入</span><span class="amt">${fmtMoney(b.netRevenue, sym)}</span></div>`;
    html += `<div class="lg total"><span class="dot" style="background:${COLORS.profit}"></span><span class="nm">净利润</span><span class="amt" style="color:${r.netProfit >= 0 ? '#d92b2b' : '#12924f'}">${(r.netProfit >= 0 ? '+' : '-') + fmtMoney(Math.abs(r.netProfit), sym)}</span></div>`;
    els.legend.innerHTML = html;

    // 提示
    const hints = [];
    if (res.warnings.length) {
      for (const w of res.warnings) hints.push(`<div class="hint warn">${w}</div>`);
    }
    if (r.netProfit < 0 && r.breakEvenPrice > 0) {
      hints.push(`<div class="hint info">盈亏平衡售价约为 ${fmtMoney(r.breakEvenPrice, sym)}，当前售价低于该值。</div>`);
    } else if (r.netProfit > 0) {
      const maxCogs = Calc.solveMaxCogs(input, SITES, tm);
      if (maxCogs > 0) {
        hints.push(`<div class="hint info">若要保持 ${fmtPct(tm)} 利润率，采购+头程合计不应超过 <b>${fmtMoney(maxCogs, sym)}</b>。</div>`);
      }
    }
    els.hint.innerHTML = hints.join('');

    // ASIN 与货币提示
    const asin = extractAsin();
    els.asinLabel.textContent = asin
      ? `ASIN ${asin} · 计算货币 ${res.currency}`
      : `计算货币 ${res.currency}（未识别到 ASIN）`;
  }

  function renderEmptyState(msg, isErr) {
    els.outProfit.textContent = '—';
    els.outProfit.className = 'val';
    els.outMargin.textContent = '—';
    els.badge.innerHTML = '';
    els.kpiRoi.textContent = '—';
    els.kpiBreak.textContent = '—';
    els.kpiCost.textContent = '—';
    els.bar.innerHTML = '';
    els.legend.innerHTML = '';
    els.hint.innerHTML = msg ? `<div class="hint ${isErr ? 'err' : 'info'}">${msg}</div>` : '';
  }

  // ------------------------------------------------------------------
  // 自动抓取填充
  // ------------------------------------------------------------------
  function autoFill() {
    const price = extractPrice();
    if (price > 0 && !els.salePrice.value) els.salePrice.value = price;

    const spec = extractWeightAndDims();
    const site = SITES[currentSite];
    if (spec.weightLb > 0 && !els.weight.value) {
      els.weight.value = site.sizeSystem === 'imperial'
        ? spec.weightLb.toFixed(2)
        : spec.weightKg.toFixed(2);
    }
    if (spec.lengthCm > 0 && !els.dimsL.value) {
      els.dimsL.value = spec.lengthCm;
      els.dimsW.value = spec.widthCm;
      els.dimsH.value = spec.heightCm;
    }

    const cat = extractCategory();
    if (cat) {
      settings.lastCategory = cat;
      buildCategoryChips();
    }
  }

  // ------------------------------------------------------------------
  // 启动
  // ------------------------------------------------------------------
  async function init() {
    settings = await Storage.get();

    if (!settings.enabled) return;

    // 站点识别
    const detected = window.detectSiteFromHost(location.hostname);
    currentSite = settings.autoDetectSite && detected ? detected : settings.defaultSite;

    // 等待核心 DOM（SPA 商品页可能延迟加载）
    await waitForPrice(6000);

    buildPanel();

    // ---- 激活门禁 ----
    const activated = Lic ? await Lic.isActivated() : true;
    if (!activated) {
      showLock();
      return;
    }

    bootPanelContent();
  }

  /** 面板主体内容初始化（激活后调用） */
  let contentBooted = false;
  function bootPanelContent() {
    if (contentBooted) return;
    contentBooted = true;

    hideLock();

    buildSiteChips();
    const site = SITES[currentSite];
    shadow.getElementById('siteSelect').value = currentSite;
    els.siteChip.textContent = currentSite;
    shadow.getElementById('symSale').textContent = site.symbol;
    shadow.getElementById('symCogs').textContent = site.symbol;
    shadow.getElementById('symLeg').textContent = site.symbol;
    shadow.getElementById('symExtra').textContent = site.symbol;
    shadow.getElementById('wUnit').textContent = site.sizeSystem === 'imperial' ? 'lb' : 'kg';
    els.dutyRate.placeholder = (site.importDutyDefault * 100).toFixed(1);
    els.storageMonths.value = settings.storageMonths || 1;
    els.includeStorage.checked = settings.includeStorage !== false;

    buildCategoryChips();
    autoFill();
    recompute();

    // 监听设置变化（popup 修改后实时同步）
    Storage.onChange((patch) => {
      const prevEnabled = settings.enabled;
      const prevShowCny = settings.showCNY;
      settings = { ...settings, ...patch };
      if (settings.enabled === false) {
        if (hostEl) hostEl.style.display = 'none';
      } else if (prevEnabled === false) {
        if (hostEl) {
          hostEl.style.display = '';
          recompute();
        } else {
          init();
        }
      }
      if (patch.targetMargin !== undefined || patch.includeStorage !== undefined ||
          patch.showCNY !== undefined || patch.fxOverrides !== undefined) {
        if (patch.includeStorage !== undefined) els.includeStorage.checked = patch.includeStorage;
        recompute();
      }
      if (patch.panelPosition) applyPosition();
    });

    // SPA 路由变化时重新抓取价格
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (/\/(dp|gp\/product)\//.test(location.pathname)) {
          setTimeout(() => { autoFill(); recompute(); }, 1500);
        }
      }
    }, 1200);
  }

  function waitForPrice(timeout) {
    return new Promise((resolve) => {
      if (extractPrice() > 0) return resolve();
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (extractPrice() > 0 || Date.now() - t0 > timeout) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  }

  // 仅在商品详情页注入
  function isProductPage() {
    return /\/(dp|gp\/product|gp\/aw\/d)\//.test(location.pathname) ||
      !!document.querySelector('#productTitle');
  }

  function boot() {
    if (isProductPage()) {
      init();
    } else {
      // 非商品页监听跳转
      let last = location.href;
      setInterval(() => {
        if (location.href !== last) {
          last = location.href;
          if (isProductPage() && !window.__FBA_PANEL_LOADED_INIT__) {
            window.__FBA_PANEL_LOADED_INIT__ = true;
            init();
          }
        }
      }, 1200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
