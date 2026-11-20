'use strict';
// 압축해제 확장을 설치한 격리 Chrome(파이프 CDP). 사용자 프로필·OS 클립보드를 쓰지 않는다.
// Chrome 137부터 --load-extension이 막혀 CDP Extensions.loadUnpacked를 쓴다(temo 딸깍 e2e와 같은 방식).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startExtensionBrowser({ headless = true } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edi-ext-chrome-'));
  const args = ['--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check',
    '--disable-sync', '--use-mock-keychain', '--disable-background-networking', '--disable-component-update', '--force-device-scale-factor=1',
    '--user-data-dir=' + profile, '--window-size=1280,900'];
  if (headless) args.push('--headless=new');
  args.push('about:blank');
  const child = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const writer = child.stdio[3], reader = child.stdio[4];
  let seq = 0, buffer = '';
  const pending = new Map();
  const listeners = new Set();
  const errors = [];
  reader.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(p.method + ': ' + msg.error.message)); else p.resolve(msg.result);
      } else if (msg.method) {
        if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + msg.params.exceptionDetails.text + ' ' + ((msg.params.exceptionDetails.exception || {}).description || ''));
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map(a => a.value || a.description).join(' '));
        for (const listener of listeners) listener(msg);
      }
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 30000);
      pending.set(id, { resolve, reject, timer, method });
      writer.write(JSON.stringify(Object.assign({ id, method, params }, sessionId ? { sessionId } : {})) + '\0');
    });
  }

  function pageApi(targetId, sessionId) {
    async function evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error('browser evaluation failed: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
      return r.result.value;
    }
    async function wait(expression, timeout = 10000) {
      const ends = Date.now() + timeout;
      while (Date.now() < ends) { if (await evaluate(expression)) return; await pause(50); }
      throw new Error('condition timeout: ' + expression);
    }
    async function center(selector) {
      return evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('selector unavailable: ' + ${JSON.stringify(selector)});
        e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    }
    async function click(selector) {
      const p = await center(selector);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }, sessionId);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }, sessionId);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }, sessionId);
    }
    async function type(selector, text) {
      await center(selector);
      await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select && e.select(); })()`);
      await send('Input.insertText', { text: String(text) }, sessionId);
    }
    async function setDate(selector, value) {
      await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    }
    async function navigate(url, ready = 'true', timeout = 10000) {
      await evaluate('window.__navMarker = 1').catch(() => {});
      await send('Page.navigate', { url }, sessionId);
      await wait(`!window.__navMarker && document.readyState === 'complete' && (${ready})`, timeout);
    }
    async function viewport(width, height) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    }
    async function screenshot(file) {
      const m = await send('Page.getLayoutMetrics', {}, sessionId);
      const size = m.cssContentSize || m.contentSize;
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 } }, sessionId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    }
    return { targetId, sessionId, evaluate, wait, click, type, setDate, navigate, viewport, screenshot };
  }

  async function newPage(url, { initScript = null, ready = 'true', timeout = 10000 } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    if (initScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript }, sessionId);
    const page = pageApi(targetId, sessionId);
    await page.navigate(url, ready, timeout);
    return page;
  }

  async function loadUnpacked(dir) { return (await send('Extensions.loadUnpacked', { path: dir })).id; }
  async function activate(page) { await send('Target.activateTarget', { targetId: page.targetId }); }
  const version = (await send('Browser.getVersion')).product;

  async function close() {
    try { await send('Browser.close'); } catch { /* 이미 닫힘 */ }
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('browser closed')); }
    pending.clear();
    if (child.exitCode === null) await new Promise(resolve => { const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); child.once('exit', () => { clearTimeout(t); resolve(); }); });
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }

  return { send, newPage, loadUnpacked, activate, close, errors, version, listeners };
}

module.exports = { startExtensionBrowser, pause };
