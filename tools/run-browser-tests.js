/**
 * run-browser-tests.js — 在真实 Chrome 中打开验证页并读取断言结果
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (u) => new Promise((res, rej) =>
  http.get(u, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'tests', 'fixtures', 'panel-verify.html');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const PROFILE = 'C:/Users/16778/AppData/Local/Temp/fba-bt-' + Date.now();

async function main() {
  if (!fs.existsSync(PAGE)) { console.error('验证页不存在: ' + PAGE); process.exit(1); }
  const fileUrl = 'file:///' + PAGE.replace(/\\/g, '/');

  const chrome = spawn(CHROME, [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--window-size=1500,1000', '--window-position=20,20',
    fileUrl
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let err = '';
  chrome.stderr.on('data', (d) => { err += d.toString(); });

  let v = null;
  for (let i = 0; i < 70; i++) { await sleep(400); try { v = await getJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) {} }
  if (!v) { console.error('Chrome 未就绪\n' + err.slice(-300)); chrome.kill(); process.exit(1); }
  console.log('Chrome:', v.Browser);

  const ws = new WebSocket(v.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); });

  let id = 0; const pend = new Map(); const events = [];
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.id !== undefined && pend.has(m.id)) { const cb = pend.get(m.id); pend.delete(m.id); cb(m); return; }
    if (m.method) events.push(m);
  });
  const send = (method, params = {}, sid) => new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => { pend.delete(i); rej(new Error('timeout ' + method)); }, 30000);
    pend.set(i, (m) => { clearTimeout(t); res(m); });
    ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }));
  });

  // 找到页面
  await sleep(2500);
  let ti = (await send('Target.getTargets')).result.targetInfos;
  let page = ti.find((t) => t.type === 'page' && String(t.url).includes('panel-verify'));
  if (!page) page = ti.find((t) => t.type === 'page');
  if (!page) { console.error('未找到页面 target'); chrome.kill(); process.exit(1); }

  const { sessionId } = (await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).result;
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId).catch(() => {});
  await send('Network.enable', {}, sessionId).catch(() => {});

  console.log('页面:', page.url.slice(0, 100));
  console.log('\n等待断言自动运行...\n');

  // 等待测试完成
  let testRes = null;
  for (let i = 0; i < 40; i++) {
    await sleep(800);
    const r = await send('Runtime.evaluate', {
      expression: 'window.__TEST_RESULT__ ? JSON.stringify(window.__TEST_RESULT__) : null',
      returnByValue: true
    }, sessionId);
    const val = r.result && r.result.result ? r.result.result.value : null;
    if (val) { testRes = JSON.parse(val); break; }
  }

  // 读取日志内容
  const logR = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({ text: document.getElementById("log").innerText, href: location.href })',
    returnByValue: true
  }, sessionId);
  const logData = JSON.parse((logR.result.result || {}).value || '{}');
  console.log(logData.text || '(无日志)');

  // 页面错误
  const errs = events.filter((e) => e.sessionId === sessionId && e.method === 'Runtime.exceptionThrown');
  if (errs.length) {
    console.log('\n--- 页面异常 (' + errs.length + ') ---');
    errs.slice(0, 5).forEach((e) => console.log('  ', JSON.stringify(e.params).slice(0, 300)));
  }

  // 截图保存
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    if (shot.result && shot.result.data) {
      const outPath = path.join(ROOT, 'tests', 'fixtures', 'verify-screenshot.png');
      fs.writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
      console.log('\n截图已保存: ' + outPath);
    }
  } catch (e) {}

  console.log('\n' + '='.repeat(46));
  if (testRes) {
    console.log(`浏览器端断言：${testRes.pass}/${testRes.total} 通过` + (testRes.fail ? `，${testRes.fail} 失败` : ''));
  } else {
    console.log('未能获取断言结果（测试可能仍在运行）');
  }
  console.log('='.repeat(46));

  await sleep(2000);
  chrome.kill();
  process.exit(testRes && testRes.fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('异常:', e.message); process.exit(1); });
