/**
 * cn.js — 中国卖家用得上的本地化工具层
 *
 * 核心能力：
 *  1. 汇率表集中管理，支持用户覆盖
 *  2. 本币 ⇄ 人民币双向折算
 *  3. 人民币口径展示格式化（¥ 前缀、千分位、中文习惯）
 *  4. 中文类目名映射（把英文费率类目翻译成中文，便于中国卖家阅读）
 */

(function (root) {
  'use strict';

  // 默认汇率：1 单位外币 = ? 人民币。v1 硬编码，用户可在设置页覆盖。
  const DEFAULT_FX = {
    USD: 7.15,
    GBP: 9.05,
    EUR: 7.75,
    JPY: 0.0475,
    CAD: 5.25,
    AUD: 4.70,
    CNY: 1
  };

  // 类目英文 → 中文（覆盖费率表里出现的所有类目）
  const CATEGORY_CN = {
    'Amazon Device Accessories': '亚马逊设备配件',
    'Automotive & Powersports': '汽车与动力运动',
    'Baby Products': '母婴用品',
    'Beauty, Health & Personal Care': '美妆个护与健康',
    'Books': '图书',
    'Camera & Photo': '相机与摄影',
    'Cell Phone Devices': '手机整机',
    'Clothing & Accessories': '服装与配饰',
    'Computers': '电脑',
    'Consumer Electronics': '消费电子',
    'Electronics Accessories': '电子配件',
    'Furniture': '家具',
    'Games': '游戏',
    'Grocery & Gourmet Food': '食品与美食',
    'Health & Household': '健康与家居日用',
    'Home & Kitchen': '家居与厨房',
    'Industrial & Scientific': '工业与科学',
    'Jewelry': '珠宝首饰',
    'Kitchen': '厨房用品',
    'Music': '音乐',
    'Office Products': '办公用品',
    'Outdoors': '户外',
    'Pet Products': '宠物用品',
    'Shoes, Handbags & Sunglasses': '鞋包与太阳镜',
    'Software': '软件',
    'Sports & Outdoors': '运动与户外',
    'Tools & Home Improvement': '工具与家居改造',
    'Toys & Games': '玩具与游戏',
    'Video Games': '电子游戏',
    'Watches': '手表'
  };

  // 站点中文名（用于人民币口径的说明文案）
  const SITE_CN = {
    US: '美国', UK: '英国', DE: '德国', FR: '法国',
    IT: '意大利', ES: '西班牙', JP: '日本', CA: '加拿大'
  };

  function categoryCn(en) {
    return CATEGORY_CN[en] || en;
  }

  function siteCn(mp) {
    return SITE_CN[mp] || mp;
  }

  /** 取某币种兑人民币汇率，overrides 优先 */
  function rateOf(currency, overrides) {
    if (currency === 'CNY') return 1;
    if (overrides && Number.isFinite(parseFloat(overrides[currency]))) {
      return parseFloat(overrides[currency]);
    }
    return DEFAULT_FX[currency] !== undefined ? DEFAULT_FX[currency] : 1;
  }

  /** 外币 → 人民币 */
  function toCNY(amount, currency, overrides) {
    const r = rateOf(currency, overrides);
    return (parseFloat(amount) || 0) * r;
  }

  /** 人民币 → 外币 */
  function fromCNY(amount, currency, overrides) {
    const r = rateOf(currency, overrides);
    if (r === 0) return 0;
    return (parseFloat(amount) || 0) / r;
  }

  /** 人民币金额格式化：¥1,234.56 */
  function fmtCNY(v, opts) {
    const n = parseFloat(v) || 0;
    const abs = Math.abs(n);
    const o = opts || {};
    let digits = o.digits;
    if (digits === undefined) digits = abs >= 1000 ? 0 : 2;
    const body = abs.toLocaleString('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    return '¥' + body;
  }

  /** 带正负号的净利润格式化 */
  function fmtSigned(v, formatter) {
    const n = parseFloat(v) || 0;
    const f = formatter || ((x) => String(x));
    return (n >= 0 ? '+' : '-') + f(Math.abs(n));
  }

  /** 汇率表快照（用于设置页展示与重置） */
  function allRates(overrides) {
    const out = {};
    for (const c of Object.keys(DEFAULT_FX)) {
      out[c] = {
        default: DEFAULT_FX[c],
        current: rateOf(c, overrides),
        overridden: !!(overrides && overrides[c] !== undefined)
      };
    }
    return out;
  }

  const api = {
    DEFAULT_FX,
    CATEGORY_CN,
    SITE_CN,
    categoryCn,
    siteCn,
    rateOf,
    toCNY,
    fromCNY,
    fmtCNY,
    fmtSigned,
    allRates
  };

  if (typeof window !== 'undefined') root.FbaCN = api;
  if (typeof self !== 'undefined' && self !== root) self.FbaCN = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
