/**
 * storage.js — 设置持久化层（chrome.storage.sync + local 回退）
 *
 * 统一封装，使 content script 与 popup 都能以相同方式读写配置。
 */

(function (root) {
  'use strict';

  const DEFAULTS = {
    enabled: true,                 // 是否在商品页注入面板
    autoDetectSite: true,          // 是否按域名自动识别站点
    defaultSite: 'US',             // 手动模式默认站点
    targetMargin: 0.20,            // 目标利润率（用于预警与反解）
    includeStorage: true,          // 是否计入仓储费
    storageMonths: 1,              // 平均周转月数
    panelPosition: 'right',        // 'right' | 'left'
    panelCollapsed: false,
    collapseToFab: true,           // 折叠后是否变成一个悬浮小按钮
    // ---- 中国卖家本地化 ----
    showCNY: true,                 // 人民币口径：是否同时显示 ¥ 折算金额
    cnyPrimary: false,             // 是否以人民币为主显示（本币为辅）
    fxOverrides: {},               // 汇率覆盖 { USD: 7.2, ... }
    // 按站点的覆盖项： { US: { referralRate, dutyRate, vatRate, fxToCNY }, ... }
    siteOverrides: {},
    // 记忆的商品页输入： { [asin]: {...inputs} }
    savedInputs: {},
    lastCategory: ''
  };

  const AREA = 'sync';

  function hasChrome() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
  }

  function get(keys) {
    return new Promise((resolve) => {
      if (!hasChrome()) {
        const out = {};
        const list = Array.isArray(keys) ? keys : Object.keys(DEFAULTS);
        for (const k of list) {
          try {
            const raw = localStorage.getItem('fba_' + k);
            out[k] = raw === null ? DEFAULTS[k] : JSON.parse(raw);
          } catch (e) {
            out[k] = DEFAULTS[k];
          }
        }
        return resolve(out);
      }
      chrome.storage[AREA].get(keys, (res) => {
        const out = {};
        for (const k of Object.keys(DEFAULTS)) {
          out[k] = res[k] === undefined ? DEFAULTS[k] : res[k];
        }
        resolve(out);
      });
    });
  }

  function set(patch) {
    return new Promise((resolve) => {
      if (!hasChrome()) {
        for (const [k, v] of Object.entries(patch)) {
          try { localStorage.setItem('fba_' + k, JSON.stringify(v)); } catch (e) {}
        }
        return resolve(true);
      }
      chrome.storage[AREA].set(patch, () => resolve(true));
    });
  }

  function onChange(cb) {
    if (!hasChrome() || !chrome.storage.onChanged) return () => {};
    const handler = (changes, area) => {
      if (area !== AREA) return;
      const patch = {};
      for (const [k, v] of Object.entries(changes)) patch[k] = v.newValue;
      cb(patch);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  /** 应用站点覆盖项到站点对象（不修改原对象） */
  function applyOverrides(site, overrides, fxOverrides) {
    if (!site) return site;
    const ov = (overrides && overrides[site.marketplace]) || {};
    const merged = JSON.parse(JSON.stringify(site));
    if (ov.referralRate !== undefined && ov.referralRate !== '' && !isNaN(parseFloat(ov.referralRate))) {
      merged.referral.default = parseFloat(ov.referralRate);
    }
    if (ov.dutyRate !== undefined && ov.dutyRate !== '' && !isNaN(parseFloat(ov.dutyRate))) {
      merged.importDutyDefault = parseFloat(ov.dutyRate);
    }
    if (ov.vatRate !== undefined && ov.vatRate !== '' && !isNaN(parseFloat(ov.vatRate))) {
      merged.vatRate = parseFloat(ov.vatRate);
    }
    // 汇率优先级：站点级覆盖 > 全局汇率覆盖 > 站点默认
    if (ov.fxToCNY !== undefined && ov.fxToCNY !== '' && !isNaN(parseFloat(ov.fxToCNY))) {
      merged.fxToCNY = parseFloat(ov.fxToCNY);
    } else if (fxOverrides && fxOverrides[merged.currency] !== undefined &&
               !isNaN(parseFloat(fxOverrides[merged.currency]))) {
      merged.fxToCNY = parseFloat(fxOverrides[merged.currency]);
    }
    return merged;
  }

  /**
   * 过滤汇率覆盖，仅保留与站点默认值不同的项（用于导出时精简）
   */
  function diffFxOverrides(fxOverrides, defaults) {
    const out = {};
    for (const [c, v] of Object.entries(fxOverrides || {})) {
      if (defaults && parseFloat(defaults[c]) !== parseFloat(v)) out[c] = v;
    }
    return out;
  }

  root.FbaStorage = {
    DEFAULTS, get, set, onChange, applyOverrides, diffFxOverrides
  };
})(typeof window !== 'undefined' ? window : self);
