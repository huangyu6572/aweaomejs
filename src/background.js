/**
 * background.js — Service Worker
 *
 * 职责很轻：
 *  1. 首次安装时写入默认设置
 *  2. 点击扩展图标时若无 popup 场景，仍由 manifest 处理
 *  3. 提供内容脚本按需注入（应对 SPA 跳转后未注入的情况）
 */

const DEFAULTS = {
  enabled: true,
  autoDetectSite: true,
  defaultSite: 'US',
  targetMargin: 0.2,
  includeStorage: true,
  storageMonths: 1,
  panelPosition: 'right',
  panelCollapsed: false,
  collapseToFab: true,
  siteOverrides: {},
  savedInputs: {},
  lastCategory: ''
};

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.get(Object.keys(DEFAULTS), (res) => {
    const patch = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (res[k] === undefined) patch[k] = v;
    }
    if (Object.keys(patch).length) chrome.storage.sync.set(patch);
  });

  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/welcome.html') }).catch(() => {});
  }
});

// 支持 popup 请求当前标签页信息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      sendResponse({
        url: tab ? tab.url : '',
        title: tab ? tab.title : '',
        id: tab ? tab.id : null
      });
    });
    return true; // 异步
  }
  return false;
});
