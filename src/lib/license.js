/**
 * license.js — 一次性激活码门禁（v1 硬编码版）
 *
 * 设计说明：
 *  - v1 采用本地硬编码激活码，校验通过后在 chrome.storage 写入激活状态，一次激活永久有效。
 *  - 校验使用加盐哈希比对，明文不直接出现在比较逻辑里（避免在 DevTools 里一眼看到明文常量）。
 *    注意：这是**防误用**而非**防破解**。前端扩展的校验逻辑对懂技术的人始终可绕过，
 *    v1 定位是"让普通用户需要授权才能用"，不承担强安全职责。
 *  - 后续若要接服务端，只需把 verify() 换成一次网络请求，其余调用方无需改动。
 */

(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // 激活码存储形式：仅存哈希，不存明文
  // 默认激活码明文为 123456aB!
  // ------------------------------------------------------------------
  const SALT = 'fba::2026::v1';

  /**
   * 简单但足够的一次性哈希（FNV-1a 变体 + 多轮混淆）
   * 目的只是让明文不出现在源码字符串里，不作为密码学保证。
   */
  function hash(input) {
    const s = SALT + '|' + String(input) + '|' + SALT;
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;

    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (h2 + Math.imul(c, 0x85ebca6b)) >>> 0;
      h2 ^= h2 >>> 13;
    }

    // 再压两轮，降低碰撞可预测性
    for (let r = 0; r < 3; r++) {
      h1 ^= h2 >>> ((r + 1) * 5);
      h1 = Math.imul(h1, 0x27d4eb2f) >>> 0;
      h2 ^= h1 >>> 7;
      h2 = Math.imul(h2, 0x165667b1) >>> 0;
    }

    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  // 预计算的合法激活码指纹（对应 123456aB!）
  // 由 hash('123456aB!') 生成，见 tests/selftest.js 的断言
  // 生成方式：node -e "..."（见 README「激活码」章节）
  const VALID_FINGERPRINTS = [
    '3b65584d7ab911f6'
  ];

  const LICENSE_VERSION = 1;
  const KEY_ACTIVATED = 'licenseActivated';
  const KEY_CODE = 'licenseCodeMask';
  const KEY_AT = 'licenseActivatedAt';
  const KEY_VERSION = 'licenseVersion';

  /**
   * 校验激活码是否合法（只做比对，不写状态）
   * @returns {{ok:boolean, reason?:string}}
   */
  function verify(code) {
    if (code === undefined || code === null) {
      return { ok: false, reason: '请输入激活码' };
    }
    const raw = String(code).trim();
    if (!raw) return { ok: false, reason: '激活码不能为空' };
    if (raw.length < 6) return { ok: false, reason: '激活码长度不足' };
    if (raw.length > 64) return { ok: false, reason: '激活码长度过长' };

    const fp = hash(raw);
    if (VALID_FINGERPRINTS.indexOf(fp) === -1) {
      return { ok: false, reason: '激活码无效，请核对后重试' };
    }
    return { ok: true };
  }

  /** 激活码脱敏展示：保留首尾各 2 位 */
  function mask(code) {
    const s = String(code || '');
    if (s.length <= 4) return '****';
    return s.slice(0, 2) + '****' + s.slice(-2);
  }

  // ------------------------------------------------------------------
  // 激活状态读写
  // ------------------------------------------------------------------
  function areaGet(keys) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keys, (res) => resolve(res || {}));
      } else {
        const out = {};
        const list = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const k of list) {
          try { out[k] = JSON.parse(localStorage.getItem('fba_lic_' + k)); } catch (e) { out[k] = undefined; }
        }
        resolve(out);
      }
    });
  }

  function areaSet(patch) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(patch, () => resolve(true));
      } else {
        for (const [k, v] of Object.entries(patch)) {
          try { localStorage.setItem('fba_lic_' + k, JSON.stringify(v)); } catch (e) {}
        }
        resolve(true);
      }
    });
  }

  /** 查询是否已激活 */
  async function isActivated() {
    const res = await areaGet([KEY_ACTIVATED, KEY_VERSION]);
    if (res[KEY_ACTIVATED] !== true) return false;
    // 版本不匹配视为失效（便于将来强制重新激活）
    if (res[KEY_VERSION] !== undefined && res[KEY_VERSION] !== LICENSE_VERSION) return false;
    return true;
  }

  /** 获取激活详情（用于展示） */
  async function getStatus() {
    const res = await areaGet([KEY_ACTIVATED, KEY_AT, KEY_CODE, KEY_VERSION]);
    return {
      activated: res[KEY_ACTIVATED] === true &&
        (res[KEY_VERSION] === undefined || res[KEY_VERSION] === LICENSE_VERSION),
      activatedAt: res[KEY_AT] || null,
      codeMask: res[KEY_CODE] || null,
      version: res[KEY_VERSION] || null
    };
  }

  /**
   * 尝试激活：校验通过则写入状态
   * @returns {{ok:boolean, reason?:string}}
   */
  async function activate(code) {
    const v = verify(code);
    if (!v.ok) return v;

    const at = new Date().toISOString();
    await areaSet({
      [KEY_ACTIVATED]: true,
      [KEY_AT]: at,
      [KEY_CODE]: mask(code),
      [KEY_VERSION]: LICENSE_VERSION
    });
    return { ok: true, activatedAt: at };
  }

  /** 撤销激活（仅本地，用于切换设备或测试） */
  async function deactivate() {
    await areaSet({
      [KEY_ACTIVATED]: false,
      [KEY_AT]: null,
      [KEY_CODE]: null,
      [KEY_VERSION]: null
    });
    return true;
  }

  const api = {
    verify,
    activate,
    isActivated,
    getStatus,
    deactivate,
    mask,
    hash,
    LICENSE_VERSION
  };

  if (typeof window !== 'undefined') root.FbaLicense = api;
  if (typeof self !== 'undefined' && self !== root) self.FbaLicense = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
