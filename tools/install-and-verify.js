/**
 * install-and-verify.js — Chrome 安装引导 + 安装后自动验证
 *
 * 背景：Chrome 155 起，稳定版 Google Chrome 已禁用命令行侧载：
 *   "--load-extension is not allowed in Google Chrome, ignoring."
 * 因此无法用脚本自动装入扩展，必须由用户在 chrome://extensions 手动「加载已解压的扩展程序」。
 *
 * 本脚本负责：
 *   1) 安装前体检（清单/文件/图标/语法完整性）
 *   2) 启动本地仿亚马逊页（真实域名 www.amazon.com，走本机 HTTPS）
 *   3) 提示用户手动加载扩展 -> 脚本轮询检测面板是否注入成功
 *   4) 输出验证结论 + 截图
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (u) => new Promise((res, rej) =>
  http.get(u, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTTPS_PORT = 8870 + Math.floor(Math.random() * 60);
const PORT = 9520 + Math.floor(Math.random() * 180);
const PROFILE = 'C:/Users/16778/AppData/Local/Temp/fba-install-' + Date.now();

const MOCK_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Amazon.com : Test Product</title></head>
<body>
<div id="dp-container"><div id="centerCol">
  <span id="productTitle">Wireless Bluetooth Headphones, Over-Ear Noise Cancelling</span>
  <div id="corePriceDisplay_desktop_feature_div">
    <span class="a-price"><span class="a-offscreen">$29.99</span>
    <span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole">29<span class="a-price-decimal">.</span></span><span class="a-price-fraction">99</span></span></span>
  </div>
</div><div id="detailBullets_feature_div"><ul>
  <li><span class="a-list-item"><span class="a-text-bold">Item Weight:</span> <span>12.8 ounces</span></span></li>
  <li><span class="a-list-item"><span class="a-text-bold">Product Dimensions:</span> <span>8.7 x 6.9 x 3.5 inches</span></span></li>
  <li><span class="a-list-item"><span class="a-text-bold">ASIN:</span> <span>B08TEST001</span></span></li>
</ul></div></div>
</body></html>`;

/* ---------- 阶段 1：安装前体检 ---------- */
function preflight() {
  const checks = [];
  const ok = (n, c, e) => checks.push({ n, c: !!c, e });
  const mf = path.join(SRC, 'manifest.json');
  ok('manifest.json 存在', fs.existsSync(mf), mf);

  let m = null;
  try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { }
  ok('manifest.json 语法合法', !!m);
  if (m) {
    ok('Manifest 版本为 3', m.manifest_version === 3, 'mv' + m.manifest_version);
    ok('声明了 service worker', !!(m.background && m.background.service_worker));
    ok('声明了 popup', !!(m.action && m.action.default_popup));
    ok('声明了 content_scripts', Array.isArray(m.content_scripts) && m.content_scripts.length > 0);
    const js = (m.content_scripts && m.content_scripts[0] && m.content_scripts[0].js) || [];
    ok('content_scripts 共 6 个脚本', js.length === 6, js.length + ' 个');
    js.forEach((f) => ok('脚本存在: ' + f, fs.existsSync(path.join(SRC, f))));
    const ic = m.icons || {};
    Object.keys(ic).forEach((s) => ok('图标 ' + s + 'px 存在', fs.existsSync(path.join(SRC, ic[s]))));
    ok('亚马逊匹配规则 ≥ 20 条',
      (m.content_scripts[0].matches || []).length >= 20, (m.content_scripts[0].matches || []).length + ' 条');
  }
  ['popup/popup.html', 'popup/popup.css', 'popup/popup.js', 'popup/welcome.html', 'background.js']
    .forEach((f) => ok('文件存在: ' + f, fs.existsSync(path.join(SRC, f))));

  const vm = require('vm');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : (e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  walk(SRC).forEach((f) => {
    try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); ok('语法检查: ' + path.relative(SRC, f), true); }
    catch (e) { ok('语法检查: ' + path.relative(SRC, f), false, e.message.slice(0, 70)); }
  });
  return checks;
}

/* ---------- 自签证书 ---------- */
function makeCert() {
  const tmp = path.join(require('os').tmpdir(), 'fba-crt-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem'), '-days', '2',
      '-subj', '/CN=www.amazon.com',
      '-addext', 'subjectAltName=DNS:www.amazon.com,DNS:amazon.com,DNS:localhost'],
      { stdio: 'ignore' });
    return { key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) };
  } catch (e) { return null; }
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║      FBA 利润速算器 · Chrome 安装与验证                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('【第 1 步】安装前体检');
  const checks = preflight();
  let pf = 0, pp = 0;
  checks.forEach((c) => { console.log((c.c ? '  ✓ ' : '  ✗ ') + c.n + (c.e ? ' — ' + c.e : '')); c.c ? pp++ : pf++; });
  console.log(`  → 体检：${pp} 通过 / ${pf} 失败`);
  if (pf) { console.log('\n体检未通过，请先修复再安装。'); process.exit(1); }
  console.log('');

  const cert = makeCert();
  if (!cert) { console.error('openssl 不可用，无法建立本地 HTTPS 站点'); process.exit(1); }

  console.log('【第 2 步】启动本地仿亚马逊商品页');
  const server = https.createServer(cert, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MOCK_HTML);
  });
  server.on('clientError', () => {});
  await new Promise((r) => server.listen(HTTPS_PORT, '127.0.0.1', r));
  console.log(`  站点: https://www.amazon.com/dp/B08TEST001  (→ 127.0.0.1:${HTTPS_PORT})`);
  console.log('');

  console.log('【第 3 步】启动 Chrome');
  const chrome = spawn(CHROME, [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    '--no-first-run', '--no-default-browser-check',
    '--host-resolver-rules=MAP www.amazon.com 127.0.0.1:' + HTTPS_PORT,
    '--ignore-certificate-errors',
    '--window-size=1480,980', '--window-position=40,40',
    'chrome://extensions/',
    'https://www.amazon.com/dp/B08TEST001'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let v = null;
  for (let i = 0; i < 70; i++) { await sleep(400); try { v = await getJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) {} }
  if (!v) { console.error('Chrome 启动失败'); server.close(); chrome.kill(); process.exit(1); }
  console.log('  Chrome:', v.Browser);
  console.log('');

  console.log('┌──────────────────────────────────────────────────────────┐');
  console.log('│  【第 4 步】请在打开的 Chrome 窗口里手动安装扩展         │');
  console.log('│                                                          │');
  console.log('│   1. 已自动打开 chrome://extensions 页面                 │');
  console.log('│   2. 打开右上角「开发者模式 / Developer mode」开关        │');
  console.log('│   3. 点左上角「加载已解压的扩展程序 / Load unpacked」     │');
  console.log('│   4. 选择下面这个文件夹（复制粘贴到地址栏）：             │');
  console.log('│                                                          │');
  console.log('│      ' + SRC.replace(/\\/g, '/'));
  console.log('│                                                          │');
  console.log('│   安装后会弹出欢迎页，输入激活码：  123456aB!            │');
  console.log('└──────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  脚本将自动检测安装结果（最多等待 180 秒）...');
  console.log('');

  const ws = new WebSocket(v.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.id !== undefined && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const i = ++id; const t = setTimeout(() => { pend.delete(i); rej(new Error('to ' + method)); }, 25000);
    pend.set(i, (m) => { clearTimeout(t); res(m); });
    ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }));
  });

  const getTargets = async () => { try { return (await send('Target.getTargets')).result.targetInfos; } catch (e) { return []; } };

  let injected = false, extId = null, detail = null, sawExtension = false;
  for (let round = 0; round < 90 && !injected; round++) {
    await sleep(2000);
    const targets = await getTargets();

    if (!extId) {
      const swTargets = targets.filter((t) => t.type === 'service_worker' && String(t.url).includes('background.js'));
      for (const st of swTargets) {
        try {
          const s = (await send('Target.attachToTarget', { targetId: st.targetId, flatten: true })).result.sessionId;
          await send('Runtime.enable', {}, s);
          const r = await send('Runtime.evaluate', {
            expression: '(chrome.runtime.getManifest().name || "") + "|" + chrome.runtime.getManifest().version',
            returnByValue: true
          }, s);
          const val = (r.result && r.result.result && r.result.result.value) || '';
          if (/FBA/.test(val)) {
            extId = String(st.url).split('/')[2]; sawExtension = true;
            console.log('  ✓ 检测到扩展已装入：' + val + '  (id ' + extId + ')');
          }
        } catch (e) {}
      }
    }

    const page = targets.find((t) => t.type === 'page' && String(t.url).includes('amazon.com'));
    if (!page) continue;
    try {
      const { sessionId } = (await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).result;
      await send('Runtime.enable', {}, sessionId);
      const r = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
          host: location.hostname,
          hostDom: !!document.getElementById('fba-profit-calculator-host'),
          shadow: (function(){ var h=document.getElementById('fba-profit-calculator-host');
            if(!h||!h.shadowRoot) return null; var s=h.shadowRoot;
            return { lock:!!s.getElementById('lockScreen'), code:!!s.getElementById('lockCode'),
                     chips:s.querySelectorAll('#siteChips span').length }; })(),
          sites: Object.keys(window.FBA_SITES||{}).length,
          calc: !!window.FbaCalculator, lic: !!window.FbaLicense,
          store: !!window.FbaStorage, cn: !!window.FbaCN
        })`,
        returnByValue: true
      }, sessionId);
      const d = JSON.parse((r.result && r.result.result || {}).value || '{}');
      if (d.hostDom && d.shadow && d.shadow.lock) {
        injected = true; detail = { ...d, sessionId };
      } else if (d.sites > 0) {
        detail = { ...d, sessionId };
      }
    } catch (e) {}
    if (round % 5 === 4 && !injected) process.stdout.write('.');
  }
  console.log('');

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  if (extId) console.log('扩展 ID  : ' + extId);
  if (injected && detail) {
    console.log('');
    console.log('【安装成功 ✓】面板已在真实亚马逊域名下自动注入');
    console.log('');
    console.log('  页面域名        : ' + detail.host);
    console.log('  注入宿主 DOM    : ' + (detail.hostDom ? '✓ 已创建' : '✗'));
    console.log('  Shadow DOM 锁屏 : ' + (detail.shadow && detail.shadow.lock ? '✓ 已渲染' : '✗'));
    console.log('  激活输入框      : ' + (detail.shadow && detail.shadow.code ? '✓ 可交互' : '✗'));
    console.log('  FBA_SITES 站点数: ' + detail.sites);
    console.log('  FbaCalculator   : ' + (detail.calc ? '✓' : '✗'));
    console.log('  FbaLicense      : ' + (detail.lic ? '✓' : '✗'));
    console.log('  FbaStorage      : ' + (detail.store ? '✓' : '✗'));
    console.log('  FbaCN           : ' + (detail.cn ? '✓' : '✗'));
    console.log('');
    console.log('  输入激活码 123456aB! 即可解锁全部功能。');

    try {
      const shot = await send('Page.captureScreenshot', { format: 'png' }, detail.sessionId);
      if (shot.result && shot.result.data) {
        const out = path.join(ROOT, 'tests', 'fixtures', 'install-screenshot.png');
        fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
        console.log('\n  截图已保存: ' + out);
      }
    } catch (e) {}
  } else if (sawExtension || extId) {
    console.log('【扩展已装入，但未检测到面板注入】');
    console.log('  请确认亚马逊页面已刷新（Ctrl+R），或将页面重开。');
    if (detail) console.log('  页面探测: ' + JSON.stringify(detail));
  } else {
    console.log('【未检测到扩展安装】');
    console.log('  请按上面第 4 步手动加载未打包扩展。');
    console.log('  文件夹路径: ' + SRC.replace(/\\/g, '/'));
  }
  console.log('══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Chrome 窗口保持打开，可继续手动体验。按 Ctrl+C 结束脚本。');
  console.log('');

  process.on('SIGINT', () => { chrome.kill(); server.close(); process.exit(0); });
  await new Promise(() => {});
}

main().catch((e) => { console.error('异常:', e.message); process.exit(1); });
