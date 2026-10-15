/**
 * popup.js — 主控台逻辑
 */
(function () {
  'use strict';

  const SITES = window.FBA_SITES || {};
  const Calc = window.FbaCalculator;
  const Storage = window.FbaStorage;
  const Lic = window.FbaLicense;
  const CN = window.FbaCN;

  let settings = { ...Storage.DEFAULTS };
  let activeTabUrl = '';
  let detectedSite = null;

  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------
  // 工具
  // ------------------------------------------------------------------
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => t.classList.remove('on'), 1800);
  }

  function fmtMoney(v, symbol) {
    const s = Math.abs(v) >= 1000
      ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : v.toFixed(2);
    return `${symbol}${s}`;
  }

  /** 人民币折算金额文本，未开启返回空串 */
  function cnyText(amount, site) {
    if (!CN || !settings.showCNY || site.currency === 'CNY') return '';
    const fx = (settings.fxOverrides && settings.fxOverrides[site.currency] !== undefined)
      ? parseFloat(settings.fxOverrides[site.currency])
      : (site.fxToCNY || CN.rateOf(site.currency, null));
    if (!fx) return '';
    return CN.fmtCNY((parseFloat(amount) || 0) * fx);
  }

  // ------------------------------------------------------------------
  // 激活门禁
  // ------------------------------------------------------------------
  async function initGate() {
    if (!Lic) return true;

    const ok = await Lic.isActivated();
    if (ok) {
      $('gate').classList.remove('on');
      return true;
    }

    $('gate').classList.add('on');
    setTimeout(() => $('gateCode').focus(), 150);

    const doActivate = async () => {
      const code = $('gateCode').value;
      const btn = $('gateBtn');
      if (!code || !code.trim()) {
        $('gateMsg').textContent = '请输入激活码';
        $('gateMsg').className = 'gate-msg err';
        $('gateCode').classList.add('err');
        return;
      }
      btn.disabled = true;
      btn.textContent = '校验中…';
      const res = await Lic.activate(code);
      if (res.ok) {
        $('gateMsg').textContent = '激活成功';
        $('gateMsg').className = 'gate-msg ok';
        setTimeout(() => {
          $('gate').classList.remove('on');
          refreshLicenseStatus();
        }, 450);
      } else {
        btn.disabled = false;
        btn.textContent = '激活';
        $('gateMsg').textContent = res.reason || '激活码无效';
        $('gateMsg').className = 'gate-msg err';
        $('gateCode').classList.add('err');
        $('gateCode').select();
      }
    };

    $('gateBtn').addEventListener('click', doActivate);
    $('gateCode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doActivate();
    });
    $('gateCode').addEventListener('input', () => {
      $('gateCode').classList.remove('err');
      $('gateMsg').textContent = '';
      $('gateMsg').className = 'gate-msg';
    });

    return false;
  }

  async function refreshLicenseStatus() {
    if (!Lic) return;
    const st = await Lic.getStatus();
    const el = $('licStatus');
    if (st.activated) {
      el.textContent = `已激活 · ${st.codeMask || ''}`;
      el.className = 'lic-badge';
    } else {
      el.textContent = '未激活';
      el.className = 'lic-badge off';
    }
  }

  // ------------------------------------------------------------------
  // 汇率网格
  // ------------------------------------------------------------------
  function renderFxGrid() {
    if (!CN) return;
    const rates = CN.allRates(settings.fxOverrides || {});
    $('fxGrid').innerHTML = Object.entries(rates)
      .filter(([c]) => c !== 'CNY')
      .map(([c, info]) => `
        <div class="fx-item ${info.overridden ? 'overridden' : ''}" data-cur="${c}">
          <span class="cur">${c}</span>
          <input type="number" step="0.0001" min="0" value="${info.current}" data-fx="${c}" title="默认 ${info.default}">
        </div>
      `).join('');
  }

  async function saveFx() {
    const inputs = $('fxGrid').querySelectorAll('input[data-fx]');
    const overrides = {};
    for (const inp of inputs) {
      const cur = inp.getAttribute('data-fx');
      const v = parseFloat(inp.value);
      if (Number.isFinite(v) && v > 0 && Math.abs(v - CN.DEFAULT_FX[cur]) > 1e-9) {
        overrides[cur] = v;
      }
    }
    await persistSetting({ fxOverrides: overrides });
    renderFxGrid();
    recompute();
  }

  async function resetFx() {
    await persistSetting({ fxOverrides: {} });
    renderFxGrid();
    recompute();
  }

  function pct(v) {
    return `${(v * 100).toFixed(1)}%`;
  }

  function fillSiteSelect(el) {
    el.innerHTML = Object.values(SITES)
      .map((s) => `<option value="${s.marketplace}">${s.label}</option>`)
      .join('');
  }

  // ------------------------------------------------------------------
  // 标签页切换
  // ------------------------------------------------------------------
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
      document.querySelectorAll('.tabpage').forEach((p) => p.classList.remove('on'));
      tab.classList.add('on');
      $('page-' + tab.dataset.tab).classList.add('on');
    });
  });

  // ------------------------------------------------------------------
  // 速算页
  // ------------------------------------------------------------------
  function currentCalcSite() {
    return SITES[$('site').value] || SITES.US;
  }

  function syncCalcCurrency() {
    const site = currentCalcSite();
    $('curLabel').textContent = site.currency;
    ['p1', 'p2', 'p3', 'p4'].forEach((id) => { $(id).textContent = site.symbol; });
    $('wUnit').textContent = site.sizeSystem === 'imperial' ? 'lb' : 'kg';
    $('dutyRate').placeholder = (site.importDutyDefault * 100).toFixed(1);
  }

  function syncCategories() {
    const site = currentCalcSite();
    const cats = site.referral.categories || {};
    const opts = [`<option value="">默认 ${(site.referral.default * 100).toFixed(0)}%</option>`];
    for (const [k, v] of Object.entries(cats)) {
      opts.push(`<option value="${k}">${k} · ${(v * 100).toFixed(0)}%</option>`);
    }
    $('category').innerHTML = opts.join('');
    $('category').value = settings.lastCategory || '';
  }

  function readCalcInputs() {
    return {
      site: $('site').value,
      salePrice: $('salePrice').value,
      cogsPerUnit: $('cogs').value,
      firstLegPerUnit: $('firstLeg').value,
      extraFee: $('extraFee').value,
      weight: $('weight').value,
      lengthCm: $('dimsL').value,
      widthCm: $('dimsW').value,
      heightCm: $('dimsH').value,
      storageMonths: $('storageMonths').value || settings.storageMonths,
      includeStorage: settings.includeStorage,
      dutyRate: $('dutyRate').value,
      referralOverride: $('referralRate').value,
      category: $('category').value
    };
  }

  function recompute() {
    const input = readCalcInputs();
    const site = currentCalcSite();

    if (!input.salePrice || parseFloat(input.salePrice) <= 0) {
      $('outProfit').textContent = '—';
      $('outProfit').className = 'res-profit';
      $('outMargin').textContent = '—';
      $('kpiRoi').textContent = '—';
      $('kpiBreak').textContent = '—';
      $('kpiCost').textContent = '—';
      $('detail').innerHTML = '<div class="drow" style="color:#97a0ad">请输入售价开始计算</div>';
      return;
    }

    const res = Calc.calculate(input, SITES);
    if (!res.ok) {
      $('detail').innerHTML = `<div class="drow" style="color:#c62828">${res.errors.join('；')}</div>`;
      return;
    }

    const b = res.breakdown;
    const r = res.result;
    const sym = res.symbol;

    $('outProfit').textContent = (r.netProfit >= 0 ? '+' : '-') + fmtMoney(Math.abs(r.netProfit), sym);
    $('outProfit').className = 'res-profit ' + (r.netProfit >= 0 ? 'pos' : 'neg');
    $('outMargin').textContent = pct(r.margin);
    $('outMargin').style.color = r.netProfit >= 0 ? '#d92b2b' : '#12924f';
    $('kpiRoi').textContent = pct(r.roi);
    $('kpiRoi').style.color = r.roi >= 0 ? '#d92b2b' : '#12924f';
    $('kpiBreak').textContent = r.breakEvenPrice > 0 ? fmtMoney(r.breakEvenPrice, sym) : '—';
    $('kpiCost').textContent = fmtMoney(b.totalCost, sym);

    // 人民币折算行（中国卖家最关心）
    const cnyProfit = cnyText(r.netProfit, site);
    const cnyCost = cnyText(b.totalCost, site);
    const cnyBreak = r.breakEvenPrice > 0 ? cnyText(r.breakEvenPrice, site) : '';

    const maxCogs = Calc.solveMaxCogs(input, SITES, settings.targetMargin);
    const rows = [
      ['采购成本', b.cogs],
      ['头程运费', b.firstLeg],
      [`关税 (${(b.dutyRate * 100).toFixed(1)}%)`, b.dutyFee],
      [`平台佣金 (${(b.referralRate * 100).toFixed(1)}%)`, b.referralFee],
      [`FBA 配送 · ${b.fulfillmentTier}`, b.fulfillmentFee],
      ['月度仓储费', b.storageFee],
      ['其他费用', b.extrasFee],
      ['成本合计', b.totalCost]
    ];
    let html = rows.map(([n, v], i) => {
      const cny = cnyText(v, site);
      const last = i === rows.length - 1;
      return `<div class="drow ${last ? 'total' : ''}"><span>${n}</span><b>${fmtMoney(v, sym)}${cny ? ` <span style="color:#aab2bd;font-weight:500">≈${cny}</span>` : ''}</b></div>`;
    }).join('');

    if (b.vatAmount > 0) {
      html += `<div class="drow"><span>售价中增值税 (${(b.vatRate * 100).toFixed(0)}%)</span><b>-${fmtMoney(b.vatAmount, sym)}</b></div>`;
      html += `<div class="drow"><span>不含税净收入</span><b>${fmtMoney(b.netRevenue, sym)}</b></div>`;
    }
    if (cnyProfit) {
      html += `<div class="drow" style="background:#f5f9ff;border-radius:7px;padding:7px 8px;margin-top:4px">
        <span style="font-weight:600">人民币口径</span>
        <b style="color:${r.netProfit >= 0 ? '#d92b2b' : '#12924f'}">净利润 ≈ ${cnyProfit}${cnyCost ? ` · 成本 ≈ ${cnyCost}` : ''}${cnyBreak ? ` · 平衡价 ≈ ${cnyBreak}` : ''}</b>
      </div>`;
    }
    if (maxCogs > 0) {
      html += `<div class="drow" style="color:#1b5fa8"><span>维持 ${pct(settings.targetMargin)} 利润的最高采购+头程</span><b>${fmtMoney(maxCogs, sym)}</b></div>`;
    }
    html += `<div class="drow total"><span>净利润</span><b style="color:${r.netProfit >= 0 ? '#d92b2b' : '#12924f'}">${(r.netProfit >= 0 ? '+' : '-') + fmtMoney(Math.abs(r.netProfit), sym)}</b></div>`;
    if (res.warnings.length) {
      html += `<div class="drow" style="color:#b26a00;display:block">⚠ ${res.warnings.join('；')}</div>`;
    }
    $('detail').innerHTML = html;

    // 缓存本次结果以供复制
    $('result').__last = { res, input };
  }

  function copyResult() {
    const data = $('result').__last;
    if (!data) return toast('还没有可复制的结果');
    const { res, input } = data;
    const b = res.breakdown, r = res.result, sym = res.symbol;
    const lines = [
      `【FBA 利润速算】站点 ${res.site} (${res.currency})`,
      `售价：${fmtMoney(b.salePrice, sym)}`,
      `采购价：${fmtMoney(b.cogs, sym)}  头程：${fmtMoney(b.firstLeg, sym)}`,
      `平台佣金(${(b.referralRate * 100).toFixed(1)}%)：${fmtMoney(b.referralFee, sym)}`,
      `FBA 配送费：${fmtMoney(b.fulfillmentFee, sym)}（${b.fulfillmentTier}）`,
      `关税(${(b.dutyRate * 100).toFixed(1)}%)：${fmtMoney(b.dutyFee, sym)}`,
      `仓储费：${fmtMoney(b.storageFee, sym)}  其他：${fmtMoney(b.extrasFee, sym)}`,
      `总成本：${fmtMoney(b.totalCost, sym)}`,
      `净利润：${(r.netProfit >= 0 ? '+' : '-') + fmtMoney(Math.abs(r.netProfit), sym)}  利润率：${pct(r.margin)}  ROI：${pct(r.roi)}`,
      `盈亏平衡售价：${fmtMoney(r.breakEvenPrice, sym)}`
    ];
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => toast('结果已复制到剪贴板'))
      .catch(() => toast('复制失败，请手动选择'));
  }

  // ------------------------------------------------------------------
  // 设置页
  // ------------------------------------------------------------------
  function fillSettingsForm() {
    $('setEnabled').checked = !!settings.enabled;
    $('setAutoDetect').checked = !!settings.autoDetectSite;
    $('setStorage').checked = !!settings.includeStorage;
    $('setShowCny').checked = settings.showCNY !== false;
    $('setFab').checked = !!settings.collapseToFab;
    $('setPosition').value = settings.panelPosition;
    $('setDefaultSite').value = settings.defaultSite;
    $('setTarget').value = Math.round(settings.targetMargin * 100);
    $('setMonths').value = settings.storageMonths;
  }

  async function persistSetting(patch, silent) {
    settings = { ...settings, ...patch };
    await Storage.set(patch);
    if (!silent) toast('已保存');
  }

  function bindSettings() {
    $('setEnabled').addEventListener('change', (e) => {
      persistSetting({ enabled: e.target.checked }, true);
      $('enabled').checked = e.target.checked;
    });
    $('setAutoDetect').addEventListener('change', (e) => persistSetting({ autoDetectSite: e.target.checked }, true));
    $('setStorage').addEventListener('change', (e) => { persistSetting({ includeStorage: e.target.checked }, true); recompute(); });
    $('setShowCny').addEventListener('change', (e) => { persistSetting({ showCNY: e.target.checked }, true); recompute(); });
    $('setFab').addEventListener('change', (e) => persistSetting({ collapseToFab: e.target.checked }, true));
    $('setPosition').addEventListener('change', (e) => persistSetting({ panelPosition: e.target.value }, true));
    $('setDefaultSite').addEventListener('change', (e) => persistSetting({ defaultSite: e.target.value }, true));
    $('setTarget').addEventListener('change', (e) => { persistSetting({ targetMargin: (parseFloat(e.target.value) || 0) / 100 }, true); recompute(); });
    $('setMonths').addEventListener('change', (e) => persistSetting({ storageMonths: parseFloat(e.target.value) || 1 }, true));

    // 顶部总开关同步
    $('enabled').addEventListener('change', (e) => {
      persistSetting({ enabled: e.target.checked }, true);
      $('setEnabled').checked = e.target.checked;
      toast(e.target.checked ? '已在商品页启用面板' : '已关闭商品页面板');
    });
  }

  // ---- 站点覆盖 ----
  function loadOverrideForm() {
    const mp = $('ovSite').value;
    const site = SITES[mp];
    const ov = (settings.siteOverrides && settings.siteOverrides[mp]) || {};
    $('ovReferral').placeholder = (site.referral.default * 100).toFixed(1);
    $('ovDuty').placeholder = (site.importDutyDefault * 100).toFixed(1);
    $('ovVat').placeholder = (site.vatRate * 100).toFixed(1);
    $('ovReferral').value = ov.referralRate !== undefined ? Math.round(ov.referralRate * 10000) / 100 : '';
    $('ovDuty').value = ov.dutyRate !== undefined ? Math.round(ov.dutyRate * 10000) / 100 : '';
    $('ovVat').value = ov.vatRate !== undefined ? Math.round(ov.vatRate * 10000) / 100 : '';
  }

  async function saveOverride() {
    const mp = $('ovSite').value;
    const overrides = { ...(settings.siteOverrides || {}) };
    const obj = {};
    const rv = $('ovReferral').value;
    const dv = $('ovDuty').value;
    const vv = $('ovVat').value;
    if (rv !== '') obj.referralRate = (parseFloat(rv) || 0) / 100;
    if (dv !== '') obj.dutyRate = (parseFloat(dv) || 0) / 100;
    if (vv !== '') obj.vatRate = (parseFloat(vv) || 0) / 100;
    if (Object.keys(obj).length) overrides[mp] = obj;
    else delete overrides[mp];
    await persistSetting({ siteOverrides: overrides });
    recompute();
  }

  async function clearOverride() {
    const mp = $('ovSite').value;
    const overrides = { ...(settings.siteOverrides || {}) };
    delete overrides[mp];
    await persistSetting({ siteOverrides: overrides });
    loadOverrideForm();
    recompute();
  }

  // ---- 导入导出 ----
  function exportConfig() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fba-calculator-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('配置已导出');
  }

  function importConfig() {
    $('fileImport').click();
  }

  $('fileImport').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const obj = JSON.parse(reader.result);
        const patch = {};
        for (const k of Object.keys(Storage.DEFAULTS)) {
          if (obj[k] !== undefined) patch[k] = obj[k];
        }
        await Storage.set(patch);
        settings = await Storage.get();
        fillSettingsForm();
        loadOverrideForm();
        recompute();
        toast('配置已导入');
      } catch (err) {
        toast('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  async function resetAll() {
    if (!confirm('确定恢复所有默认设置？此操作不可撤销。')) return;
    const patch = {};
    for (const [k, v] of Object.entries(Storage.DEFAULTS)) patch[k] = v;
    await Storage.set(patch);
    settings = await Storage.get();
    fillSettingsForm();
    loadOverrideForm();
    syncCalcCurrency();
    syncCategories();
    recompute();
    toast('已恢复默认设置');
  }

  // ------------------------------------------------------------------
  // 费率速查页
  // ------------------------------------------------------------------
  function renderRates() {
    const site = SITES[$('rateSite').value] || SITES.US;
    const rowsTier = (site.fba.sizeTiers || []).map((t) => {
      const limit = t.maxLb !== undefined ? `${t.maxLb} lb` : `${t.maxKg} kg`;
      let fee = t.fee;
      if (t.perLb) fee += ` + ${t.perLb}/lb (超出 ${t.baseLb} lb)`;
      if (t.perKg) fee += ` + ${t.perKg}/kg (超出 ${t.baseKg} kg)`;
      return `<tr><td>${t.name}</td><td>≤ ${limit}</td><td>${site.symbol}${fee}</td></tr>`;
    }).join('');

    const rowsCat = Object.entries(site.referral.categories || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<tr><td colspan="2">${k}</td><td>${(v * 100).toFixed(0)}%</td></tr>`)
      .join('');

    $('ratesBody').innerHTML = `
      <div class="tagline">${site.label} · 货币 ${site.currency}${site.fxToCNY ? ' · 1 ' + site.currency + ' ≈ ' + site.fxToCNY + ' CNY' : ''}</div>

      <div class="rate-sec">
        <h3>基础税率</h3>
        <table class="rate-tbl">
          <tr><th>项目</th><th></th><th>数值</th></tr>
          <tr><td colspan="2">平台默认佣金</td><td>${(site.referral.default * 100).toFixed(1)}%</td></tr>
          <tr><td colspan="2">VAT / 消费税</td><td>${(site.vatRate * 100).toFixed(1)}%${site.vatInclusive ? '（售价含税）' : ''}</td></tr>
          <tr><td colspan="2">默认进口关税</td><td>${(site.importDutyDefault * 100).toFixed(1)}%</td></tr>
          <tr><td colspan="2">月度仓储（标准季 / 旺季）</td><td>${site.symbol}${site.fba.storageStandard} / ${site.symbol}${site.fba.storagePeak} 每 cuft</td></tr>
          ${site.closingFee ? `<tr><td colspan="2">媒介类固定成交费</td><td>${site.symbol}${site.closingFee}</td></tr>` : ''}
        </table>
      </div>

      <div class="rate-sec">
        <h3>FBA 配送费分段</h3>
        <table class="rate-tbl">
          <tr><th>尺寸段</th><th>重量上限</th><th>费用</th></tr>
          ${rowsTier}
        </table>
      </div>

      <div class="rate-sec">
        <h3>分类佣金率</h3>
        <table class="rate-tbl">
          <tr><th colspan="2">类目</th><th>费率</th></tr>
          ${rowsCat || '<tr><td colspan="3">该站点使用统一默认费率</td></tr>'}
        </table>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // 初始化
  // ------------------------------------------------------------------
  async function init() {
    settings = await Storage.get();

    // 站点下拉
    fillSiteSelect($('site'));
    fillSiteSelect($('setDefaultSite'));
    fillSiteSelect($('ovSite'));
    fillSiteSelect($('rateSite'));

    // 绑定（先绑定，保证门禁解锁后立即可用）
    $('enabled').checked = !!settings.enabled;
    fillSettingsForm();
    bindSettings();
    renderFxGrid();
    refreshLicenseStatus();

    $('site').addEventListener('change', () => { afterSiteReady(); });
    $('category').addEventListener('change', (e) => {
      settings.lastCategory = e.target.value;
      Storage.set({ lastCategory: e.target.value });
      recompute();
    });

    ['salePrice', 'cogs', 'firstLeg', 'extraFee', 'weight', 'dimsL', 'dimsW', 'dimsH',
      'storageMonths', 'dutyRate', 'referralRate'].forEach((id) => {
      $(id).addEventListener('input', recompute);
      $(id).addEventListener('change', recompute);
    });

    $('btnCalc').addEventListener('click', recompute);
    $('btnCopy').addEventListener('click', copyResult);

    $('ovSite').addEventListener('change', loadOverrideForm);
    $('btnSaveOv').addEventListener('click', saveOverride);
    $('btnClearOv').addEventListener('click', clearOverride);
    $('btnSaveFx').addEventListener('click', saveFx);
    $('btnResetFx').addEventListener('click', resetFx);
    $('btnExport').addEventListener('click', exportConfig);
    $('btnImport').addEventListener('click', importConfig);
    $('btnReset').addEventListener('click', resetAll);

    $('btnDeactivate').addEventListener('click', async () => {
      if (!confirm('撤销激活后需要重新输入激活码才能使用，确定继续？')) return;
      await Lic.deactivate();
      await refreshLicenseStatus();
      $('gate').classList.add('on');
      window.location.reload();
    });

    $('rateSite').addEventListener('change', renderRates);
    $('openDocs').href = 'https://sell.amazon.com/pricing';

    // ---- 激活门禁：先渲染界面，再决定是否遮挡 ----
    await initGate();

    // 当前标签页识别
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' }, (info) => {
      if (!info) { afterSiteReady(); return; }
      activeTabUrl = info.url || '';
      try {
        const u = new URL(activeTabUrl);
        detectedSite = window.detectSiteFromHost(u.hostname);
      } catch (e) { detectedSite = null; }

      if (detectedSite) {
        $('pageInfo').textContent = `检测到 ${SITES[detectedSite].label} · 已同步站点`;
        $('site').value = detectedSite;
        $('rateSite').value = detectedSite;
      } else if (/amazon\./.test(activeTabUrl)) {
        $('pageInfo').textContent = '未识别的亚马逊站点，使用默认费率';
        $('site').value = settings.defaultSite;
      } else {
        $('pageInfo').textContent = '独立速算模式 · 可手动选择站点';
        $('site').value = settings.defaultSite;
      }
      afterSiteReady();
    });

    // 设置变化时同步
    Storage.onChange((patch) => {
      settings = { ...settings, ...patch };
      fillSettingsForm();
      recompute();
    });
  }

  function afterSiteReady() {
    syncCalcCurrency();
    syncCategories();
    loadOverrideForm();
    renderRates();
    recompute();
  }

  init();
})();
