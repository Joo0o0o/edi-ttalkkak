'use strict';
// 격리된 headless Chrome + CDP. 사용자 Chrome 프로필·OS 클립보드를 쓰지 않는다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startBrowser({ width = 1440, height = 1000 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ibalance-edi-chrome-'));
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-sync', '--metrics-recording-only',
    '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let port;
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (port) break; } catch { /* 기다림 */ }
    if (child.exitCode !== null) break;
    await pause(60);
  }
  if (!port) { child.kill(); throw new Error('isolated Chrome did not start'); }
  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  const target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page');
  if (!target) throw new Error('page target unavailable');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });

  let seq = 0;
  const pending = new Map();
  const errors = [];
  const requests = [];
  const dialogs = [];
  let dialogAccept = true;
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 30000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || ''));
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map(a => a.value || a.description).join(' '));
    else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('log: ' + msg.params.entry.text);
    else if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
    else if (msg.method === 'Page.javascriptDialogOpening') {
      dialogs.push({ type: msg.params.type, message: msg.params.message, accepted: dialogAccept });
      cdp('Page.handleJavaScriptDialog', { accept: dialogAccept }).catch(() => {});
    }
  });

  async function evaluate(expression) {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('browser evaluation failed: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async function wait(expression, timeout = 10000) {
    const ends = Date.now() + timeout;
    while (Date.now() < ends) { if (await evaluate(expression)) return; await pause(40); }
    throw new Error('condition timeout: ' + expression);
  }
  async function center(selector) {
    return evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('selector unavailable: ' + ${JSON.stringify(selector)});
      e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  }
  async function click(selector) {
    const p = await center(selector);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
  async function type(selector, text, { replace = true } = {}) {
    await center(selector);
    await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); ${replace ? 'e.select && e.select();' : 'e.setSelectionRange && e.setSelectionRange(e.value.length, e.value.length);'} })()`);
    await cdp('Input.insertText', { text: String(text) });
  }
  async function key(name, code, keyCode, text) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, ...(text ? { text, unmodifiedText: text } : {}) });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  }
  // 날짜 칸은 CDP 타이핑이 OS 위젯에 의존하므로 DOM 값 + input 이벤트로 넣는다(QA 기록에 명시).
  async function setDate(selector, value) {
    await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  async function viewport(w, h) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  }
  async function screenshot(file, { full = true } = {}) {
    let params = { format: 'png' };
    if (full) {
      const m = await cdp('Page.getLayoutMetrics');
      const size = m.cssContentSize || m.contentSize;
      params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 } };
    }
    const r = await cdp('Page.captureScreenshot', params);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  let initScriptId = null;
  const EDI_READY = `!!document.getElementById('edi-text') && document.getElementById('edi-text').textContent.length > 0 && document.body.dataset.frames !== 'loading'`;
  async function open(url, initScript, ready = EDI_READY) {
    if (initScriptId) { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: initScriptId }); initScriptId = null; }
    if (initScript) initScriptId = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source: initScript })).identifier;
    await evaluate('window.__navMarker = 1');
    await cdp('Page.navigate', { url });
    await wait(`!window.__navMarker && document.readyState === 'complete' && (${ready})`);
  }
  async function close() {
    try { await cdp('Browser.close'); } catch { /* 이미 닫힘 */ }
    ws.close();
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('browser closed')); }
    pending.clear();
    if (child.exitCode === null) await new Promise(resolve => { const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); child.once('exit', () => { clearTimeout(t); resolve(); }); });
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Network.enable');
  await viewport(width, height);
  return {
    cdp, evaluate, wait, click, type, key, setDate, viewport, screenshot, open, close, errors, requests, dialogs,
    version: version.Browser,
    setDialogAccept(value) { dialogAccept = value; }
  };
}

module.exports = { startBrowser, pause };
