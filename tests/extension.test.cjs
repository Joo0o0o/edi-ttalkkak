'use strict';
// EXT-01~17: 빌드한 확장(dist/)을 격리 Chrome에 설치해 사이드 패널 → 결과지에서 가져오기 → 문구 복사를 실제로 검수한다.
// 실행: 저장소 폴더에서 python3 build.py && node --test --test-concurrency=1 tests/extension.test.cjs (시험은 dist/를 다시 쓰지 않고 소스와 같은지만 확인한다)
// 합성 결과지는 로컬 HTTP(127.0.0.1)로 띄운다. 실제 TEMO·환자·OS 클립보드는 쓰지 않는다.
// 시험용 사본에만 127.0.0.1 주소 권한을 미리 넣는다(권한 창은 자동 시험에서 누를 수 없음).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { startExtensionBrowser, pause } = require('./extension-browser.cjs');
const { Core, secondState, DOCTOR_A, DOCTOR_B, DOCTOR_C } = require('./fixtures.cjs');
const { viewerInputs, page } = require('./temo-fixture.cjs');

const ROOT = path.join(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'dist');
const EXT_NAME = `edi-ttalkkak-v${MANIFEST.version}`;
const EXT_DIR = path.join(OUT_DIR, EXT_NAME);
const RUN = process.env.EDI_QA_RUN || 'x01';
const QA_OUT = process.env.EDI_QA_OUT ? path.resolve(process.env.EDI_QA_OUT) : path.join(ROOT, 'qa');
const DAY = (d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'))(new Date()); // 캡처 날짜(로컬)
const shot = name => path.join(QA_OUT, 'screens', `${DAY}-${RUN}-${name}.png`);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'edi-ext-test-'));

const FIRST = viewerInputs();
const SECOND = viewerInputs({ shoulder: 0.61, pelvis: -0.33, left: 11, right: 10, height: 0.004, xs: [-0.2, 0.2, -0.16, 0.165] });
const PAGES = {
  '/first.html': page({ title: '합성 결과지 1차', viewers: [{ input: FIRST.input, mode: 'exec' }] }),
  '/second.html': page({ title: '합성 결과지 2차', viewers: [{ input: SECOND.input, mode: 'exec' }] }),
  '/two.html': page({ title: '합성 비교 화면', viewers: [{ input: FIRST.input, mode: 'exec' }, { input: SECOND.input, mode: 'exec' }] }),
  '/none.html': page({ title: '합성 환자 목록', viewers: [] })
};
// 매니페스트 key로 고정한 확장 ID(폴더를 바꿔 새 버전을 불러와도 같은 ID → 저장한 틀 유지).
const FIXED_ID = 'nhohloniafmoeepfeegecppeicomdedc';
const CAPTURE_STUB = "window.__writes = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__writes.push(text); } } });";

let server, base, b, extId, panel, temoTab;
const passed = [];

// withHost: 127.0.0.1 권한을 미리 넣은 시험용 사본(key 유지 → 고정 ID). 아니면 key를 빼 별도 ID의 권한 없는 사본.
function testCopy(withHost, version) {
  const dir = fs.mkdtempSync(path.join(TMP, withHost ? 'ext-host-' : 'ext-plain-'));
  fs.cpSync(EXT_DIR, dir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (withHost) manifest.host_permissions = ['http://127.0.0.1/*'];
  else delete manifest.key;
  if (version) manifest.version = version;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}
const status = n => panel.evaluate(`document.getElementById('import${n}-status').textContent`);
const value = sel => panel.evaluate(`document.querySelector(${JSON.stringify(sel)}).value`);
const preview = () => panel.evaluate("document.getElementById('edi-text').textContent");
const blockCodes = () => panel.evaluate("Array.from(document.querySelectorAll('#blocks li')).map(li => li.dataset.code)");
const PANEL_READY = "!!document.getElementById('edi-text') && document.getElementById('edi-text').textContent.length > 0 && document.body.dataset.frames !== 'loading'";
async function importInto(n) {
  await panel.click('#import' + n);
  await panel.wait(`(() => { const t = document.getElementById('import${n}-status').textContent; return t.startsWith('결과지에서 가져왔습니다') || /못했|찾지|없습니다|허용|눌러 주세요|고르세요/.test(t); })()`, 15000);
  return status(n);
}

test.before(async () => {
  // dist/를 다시 쓰지 않는다(읽기 전용으로 돌릴 수 있게). dist/가 소스와 다르면 먼저 python3 build.py를 실행한다.
  let check = '';
  try { check = execFileSync('python3', [path.join(ROOT, 'build.py'), '--check'], { encoding: 'utf8' }); } catch (error) { check = String(error.stdout || error.message); }
  assert.match(check, /^SAME /, 'dist/가 현재 소스 빌드와 다릅니다. 먼저 python3 build.py를 실행하세요.');
  server = http.createServer((req, res) => {
    const body = PAGES[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body || 'not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  b = await startExtensionBrowser({ headless: true });
  extId = await b.loadUnpacked(testCopy(true));
  temoTab = await b.newPage(base + '/first.html', { ready: "!!document.getElementById('root')" });
  panel = await b.newPage(`chrome-extension://${extId}/sidepanel.html`, { initScript: CAPTURE_STUB, ready: PANEL_READY });
});

test.after(async () => {
  fs.mkdirSync(path.join(QA_OUT, 'results'), { recursive: true });
  const zip = path.join(OUT_DIR, EXT_NAME + '.zip');
  fs.writeFileSync(path.join(QA_OUT, 'results', `ext-${RUN}.json`), JSON.stringify({
    run: RUN, synthetic: true, os_clipboard_touched: false, real_temo_accessed: false,
    extension: path.relative(path.join(ROOT, '..', '..'), EXT_DIR), zip_sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'),
    chrome: b && b.version, node: process.version, headless: true, passed, expected: 17, errors: b ? b.errors : null,
    note: '합성 TEMO 결과지(공개 코드와 같은 복사 방식)를 127.0.0.1에서 띄워 확인했다. 실제 사이드 패널 창 대신 패널 화면을 같은 창의 탭으로 열어 검수했다.'
  }, null, 2) + '\n');
  if (b) await b.close();
  if (server) server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('EXT-01 매니페스트: 최소 권한(사이드 패널·스크립트·이 PC 저장소·탭 주소 읽기)과 주소별 선택 권한, 네트워크 차단 CSP, 고정 ID', () => {
  const m = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  // activeTab 대신 tabs: 지금 탭 주소를 늘 읽어 처음 가져올 때 그 주소만 허용을 묻는다(LIVE-20261119-01).
  assert.deepEqual(m.permissions, ['sidePanel', 'scripting', 'storage', 'tabs']);
  const digest = crypto.createHash('sha256').update(Buffer.from(m.key, 'base64')).digest('hex').slice(0, 32);
  assert.equal(Array.from(digest, c => String.fromCharCode(97 + parseInt(c, 16))).join(''), FIXED_ID);
  assert.equal(extId, FIXED_ID, '설치된 확장 ID가 매니페스트 key로 고정된다');
  assert.equal(m.host_permissions, undefined, '설치 때 모든 주소 권한을 받지 않는다');
  assert.deepEqual(m.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(m.side_panel.default_path, 'sidepanel.html');
  assert.match(m.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(m.content_security_policy.extension_pages, /^default-src 'self';/);
  assert.match(m.content_security_policy.extension_pages, /script-src 'self'/);
  for (const name of ['sidepanel.html', 'sw.js', 'edi-core.js', 'app.js', 'capture.js', 'panel.js', 'styles.css', 'icons/icon-128.png']) {
    assert.ok(fs.existsSync(path.join(EXT_DIR, name)), name);
  }
  const all = fs.readdirSync(EXT_DIR).filter(f => f.endsWith('.js') || f.endsWith('.html')).map(f => fs.readFileSync(path.join(EXT_DIR, f), 'utf8')).join('\n');
  for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'storage.sync', 'storage.session', 'document.cookie', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'eval(', 'new Function']) {
    assert.equal(all.includes(api), false, api);
  }
  // 저장소는 app.js의 차팅 틀 저장(chrome.storage.local)에서만 쓴다(계정 동기화 저장소 미사용 = 이 PC에만).
  const users = fs.readdirSync(EXT_DIR).filter(f => f.endsWith('.js') && fs.readFileSync(path.join(EXT_DIR, f), 'utf8').includes('chrome.storage'));
  assert.deepEqual(users, ['app.js']);
  assert.equal(/<script>/.test(fs.readFileSync(path.join(EXT_DIR, 'sidepanel.html'), 'utf8')), false, '패널에 인라인 스크립트 없음');
  passed.push('EXT-01');
});

test('EXT-02 설치·패널: 아이콘을 누르면 패널이 열리게 설정되고, 패널 전용 화면이 보인다', async () => {
  assert.deepEqual(await panel.evaluate('chrome.sidePanel.getPanelBehavior()'), { openPanelOnActionClick: true });
  assert.equal(await panel.evaluate("document.getElementById('import1').hidden"), false);
  assert.equal(await panel.evaluate("document.querySelector('[data-standalone-only]').hidden"), true);
  assert.equal(await panel.evaluate("document.querySelector('.ver').textContent"), 'v' + MANIFEST.version);
  passed.push('EXT-02');
});

test('EXT-12 차팅 틀: 저장 전에는 복사를 막고, 요청문 복사→AI 답 붙여넣기→저장하면 패널을 다시 열어도 유지된다', async () => {
  assert.equal(await panel.evaluate('document.body.dataset.frames'), 'missing');
  assert.equal(await panel.evaluate("document.getElementById('frame-setup').hidden"), false);
  assert.ok((await blockCodes()).includes('FRAME_MISSING'));
  assert.deepEqual(await panel.evaluate('chrome.storage.local.get(null)'), {}, '처음에는 저장된 것이 없다');
  await panel.click('#prompt-copy');
  await panel.wait("document.getElementById('prompt-status').textContent.startsWith('요청문을 복사했습니다')");
  const seed = Number(await panel.evaluate("document.getElementById('prompt-text').dataset.seed"));
  assert.deepEqual(await panel.evaluate('window.__writes'), [Core.framePrompt({ seed })]);
  const answer = '네, 원장님 문체로 만들었습니다.\n```\n=== 1차 틀 ===\n' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n' + DOCTOR_A[2] + '\n```\n더 고칠 부분이 있으면 말씀해 주세요.';
  await panel.type('#frame-response', answer);
  assert.equal(await value('#frame1'), DOCTOR_A[1]);
  assert.equal(await value('#frame2'), DOCTOR_A[2]);
  assert.match(await panel.evaluate("document.getElementById('response-status').textContent"), /채웠습니다/);
  assert.equal(await panel.evaluate("document.getElementById('frame1-preview').textContent"), Core.compose(Core.sampleState(1), { frames: DOCTOR_A }).text);
  assert.equal(await panel.evaluate("document.getElementById('frame2-preview').textContent"), Core.compose(Core.sampleState(2), { frames: DOCTOR_A }).text);
  assert.equal(await panel.evaluate("document.getElementById('frame-save').getAttribute('aria-disabled')"), 'false');
  await panel.viewport(360, 1400);
  await panel.screenshot(shot('ext-frame-setup-360'));
  await panel.viewport(1280, 900);
  await panel.click('#frame-save');
  await panel.wait("document.body.dataset.frames === 'saved'");
  assert.equal(await panel.evaluate("document.getElementById('frame-setup').hidden"), true);
  assert.match(await panel.evaluate("document.getElementById('frame-state').textContent"), /^원장님 틀 사용 중 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} 저장$/);
  const stored = await panel.evaluate('chrome.storage.local.get(null)');
  assert.deepEqual(Object.keys(stored), ['ediChartFrames'], '틀 말고는 아무것도 저장하지 않는다');
  assert.deepEqual(stored.ediChartFrames.frames, { 1: [DOCTOR_A[1]], 2: [DOCTOR_A[2]] }, '회차마다 벌 목록으로 저장(한 벌)');
  assert.equal(stored.ediChartFrames.v, 2);
  await panel.navigate(`chrome-extension://${extId}/sidepanel.html`, PANEL_READY);
  assert.equal(await panel.evaluate('document.body.dataset.frames'), 'saved', '패널을 다시 열어도 틀이 남아 있다');
  assert.equal(await panel.evaluate("document.getElementById('frame-setup').hidden"), true);
  assert.equal((await blockCodes()).includes('FRAME_MISSING'), false);
  passed.push('EXT-12');
});

test('EXT-03 1차: 결과지 탭의 복사하기 문구를 그대로 가져와 칸에 넣는다', async () => {
  const s = await importInto(1);
  assert.match(s, /^결과지에서 가져왔습니다 · \d{2}:\d{2}:\d{2} · 127\.0\.0\.1$/);
  assert.equal(await value('#paste1'), FIRST.expected);
  assert.equal(await panel.evaluate("Array.from(document.querySelectorAll('#parsed1 li .v')).map(n => n.textContent).join('|')"), '1.2º|-0.8º|6mm|12개|10개|2개|0.85cm|1.08:1|1:1.1');
  assert.equal(await temoTab.evaluate("Object.prototype.hasOwnProperty.call(document, 'execCommand')"), false, '결과지 페이지의 복사 명령은 원래대로');
  await panel.screenshot(shot('ext-first-imported'));
  passed.push('EXT-03');
});

test('EXT-04 바로 다시 누르면(뷰어 2초 대기) 기다렸다가 가져온다', async () => {
  await panel.click('#import1');
  await panel.wait("document.getElementById('import1-status').textContent.includes('잠시 뒤 다시')", 5000);
  await panel.wait("document.getElementById('import1-status').textContent.startsWith('결과지에서 가져왔습니다')", 10000);
  assert.equal(await value('#paste1'), FIRST.expected);
  passed.push('EXT-04');
});

test('EXT-05 2차: 1차·2차를 각각 결과지에서 가져와 기대 문구와 같고, 복사 전달값도 같다', async () => {
  await panel.click('[data-cycle="2"]');
  await temoTab.navigate(base + '/second.html', "!!document.getElementById('root')");
  await pause(2200);
  assert.match(await importInto(2), /^결과지에서 가져왔습니다/);
  assert.equal(await value('#paste2'), SECOND.expected);
  await panel.setDate('#injuryDate', '2026-10-01');
  await panel.click('[data-part="neck"]');
  await panel.click('[data-part="shoulder"]');
  await panel.click('.part-row[data-row="shoulder"] [data-side="우측"]');
  await panel.click('.part-row[data-row="neck"] [data-nrs="4"]');
  await panel.click('.part-row[data-row="shoulder"] [data-nrs="3"]');
  await panel.setDate('#firstExamDate', '2026-10-20');
  for (const tx of ['acu', 'pharm', 'moxa', 'chuna']) await panel.click(`[data-tx-group="priorTx"][data-tx="${tx}"]`);
  await panel.type('#opinion', '어깨 수평 차이 감소, 좌우 등고선 차이 1개로 감소.');
  await panel.click('[data-judgement="호전"]');
  await panel.click('[data-continuation="continue"]');
  await panel.click('[data-next="4주 후"]');
  assert.equal(await panel.evaluate("document.getElementById('limitOn').checked"), false, '350자 제한 기본 꺼짐(넘어도 복사 가능)');
  const expected = Core.compose(secondState({ limitOn: false }), { frames: DOCTOR_A }).text;
  assert.equal(await preview(), expected, '저장한 원장님 틀로 만든 문구');
  await panel.click('#copy');
  await panel.wait("document.getElementById('copy-status').textContent.startsWith('복사했습니다')");
  assert.deepEqual(await panel.evaluate('window.__writes'), [expected]);
  assert.deepEqual(Object.keys(await panel.evaluate('chrome.storage.local.get(null)')), ['ediChartFrames'], '환자 입력은 저장하지 않는다');
  await panel.screenshot(shot('ext-second-copied'));
  passed.push('EXT-05');
});

test('EXT-06 가져온 뒤 붙여넣기 칸을 직접 고치면 알린다', async () => {
  await panel.type('#paste2', SECOND.expected.replace('0.4cm', '0.5cm'));
  assert.equal(await status(2), '가져온 뒤 직접 고쳤습니다. 결과지 값과 같은지 확인하세요.');
  passed.push('EXT-06');
});

test('EXT-07 한 화면에 결과가 둘이면 고르게 하고, 고른 문구를 넣는다', async () => {
  await temoTab.navigate(base + '/two.html', "!!document.getElementById('root')");
  assert.match(await importInto(2), /2개 있습니다/);
  assert.equal(await panel.evaluate("document.querySelectorAll('#import2-choices button').length"), 2);
  assert.match(await panel.evaluate("document.querySelector('#import2-choices button:nth-child(2)').textContent"), /^2번째 결과: 어깨 0\.6º · 골반 -0\.3º/);
  await panel.click('#import2-choices button:nth-child(2)');
  assert.equal(await value('#paste2'), SECOND.expected);
  assert.equal(await panel.evaluate("document.getElementById('import2-choices').hidden"), true);
  passed.push('EXT-07');
});

test('EXT-08 결과지가 아닌 화면에서는 이유를 알리고 칸을 바꾸지 않는다', async () => {
  await temoTab.navigate(base + '/none.html', "!!document.getElementById('root')");
  const before = await value('#paste2');
  assert.match(await importInto(2), /‘복사하기’ 버튼을 찾지 못했습니다/);
  assert.equal(await value('#paste2'), before);
  passed.push('EXT-08');
});

test('EXT-09 새 환자는 가져오기 상태도 지운다', async () => {
  await b.send('Page.setInterceptFileChooserDialog', { enabled: false }, panel.sessionId).catch(() => {});
  b.listeners.add(msg => { if (msg.method === 'Page.javascriptDialogOpening' && msg.sessionId === panel.sessionId) b.send('Page.handleJavaScriptDialog', { accept: true }, panel.sessionId).catch(() => {}); });
  await panel.click('#reset');
  await panel.wait("document.getElementById('paste1').value === ''");
  assert.equal(await status(1), '');
  assert.equal(await status(2), '');
  assert.equal(await panel.evaluate('document.body.dataset.frames'), 'saved', '새 환자는 차팅 틀을 지우지 않는다');
  passed.push('EXT-09');
});

test('EXT-10 주소 권한이 없으면 누를 때 그 결과지 주소만 허용을 묻고, 거절하면 가져오지 않는다', async () => {
  const plainId = await b.loadUnpacked(testCopy(false));
  await temoTab.navigate(base + '/first.html', "!!document.getElementById('root')");
  // 실제 사용처럼 결과지 탭을 마지막으로 본 탭으로 만든다(패널 탭을 연 뒤 대상은 가장 최근에 본 결과지 탭).
  await b.activate(temoTab);
  await pause(200);
  // 자동 시험에서는 Chrome 권한 창을 누를 수 없으므로, 요청 내용을 기록하고 ‘거절’로 답하는 대역을 쓴다.
  const denyStub = "window.__requested = []; Object.defineProperty(chrome.permissions, 'request', { configurable: true, writable: true, value: async request => { window.__requested.push(request); return false; } });";
  const plain = await b.newPage(`chrome-extension://${plainId}/sidepanel.html`, { initScript: denyStub, ready: "!!document.getElementById('import1')" });
  await plain.click('#import1');
  await plain.wait("document.getElementById('import1-status').textContent.length > 0 && !document.getElementById('import1-status').textContent.endsWith('…')");
  assert.deepEqual(await plain.evaluate('window.__requested'), [{ origins: ['http://127.0.0.1/*'] }], '아이콘을 따로 누르지 않아도 지금 탭 주소로 허용을 묻는다');
  assert.match(await plain.evaluate("document.getElementById('import1-status').textContent"), /접근을 허용해야 가져올 수 있습니다/);
  assert.equal(await plain.evaluate("document.getElementById('paste1').value"), '');
  passed.push('EXT-10');
});

test('EXT-11 패널 폭(360px)에서 가로 넘침 없음·콘솔 오류 없음', async () => {
  await panel.viewport(360, 800);
  await pause(200);
  assert.ok(await panel.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await panel.screenshot(shot('ext-panel-360'));
  assert.deepEqual(b.errors, []);
  passed.push('EXT-11');
});

test('EXT-14 독립 검수 RV5-13: 다른 창에서 틀을 저장해도 이 창에서 고치던 틀은 그대로 둔다', async () => {
  await panel.click('#frame-edit');
  await panel.wait("!document.getElementById('frame-setup').hidden");
  await panel.type('#frame1', DOCTOR_B[1]);
  const other = await b.newPage(`chrome-extension://${extId}/sidepanel.html`, { ready: PANEL_READY });
  await other.evaluate("chrome.storage.local.set({ ediChartFrames: { v: 1, frames: { 1: " + JSON.stringify(DOCTOR_B[1]) + ", 2: " + JSON.stringify(DOCTOR_B[2]) + " }, savedAt: new Date().toISOString() } })");
  await panel.wait("document.getElementById('frame-save-status').textContent.startsWith('다른 창에서 틀이 저장되었습니다')");
  assert.equal(await panel.evaluate("document.getElementById('frame-setup').hidden"), false, '설정 화면이 닫히지 않는다');
  assert.equal(await value('#frame1'), DOCTOR_B[1], '고치던 1차 틀이 남아 있다');
  assert.equal(await value('#frame2'), DOCTOR_A[2], '고치지 않은 칸도 그대로');
  await other.wait("document.body.dataset.frames === 'saved' && document.getElementById('frame-setup').hidden");
  // 원래 틀로 되돌려 다음 시험(EXT-13)을 이어간다.
  await other.evaluate("chrome.storage.local.set({ ediChartFrames: { v: 1, frames: { 1: " + JSON.stringify(DOCTOR_A[1]) + ", 2: " + JSON.stringify(DOCTOR_A[2]) + " }, savedAt: new Date().toISOString() } })");
  await panel.click('#frame-cancel');
  await panel.wait("document.getElementById('frame-setup').hidden");
  assert.deepEqual(b.errors, []);
  passed.push('EXT-14');
});

test('EXT-13 업데이트: 다른 폴더의 새 버전을 불러와도 같은 확장 ID라 저장한 틀이 그대로 있다', async () => {
  const newer = testCopy(true, '9.9.9');
  const id = await b.loadUnpacked(newer);
  assert.equal(id, FIXED_ID);
  await pause(300);
  const fresh = await b.newPage(`chrome-extension://${id}/sidepanel.html`, { ready: PANEL_READY });
  assert.equal(await fresh.evaluate("chrome.runtime.getManifest().version"), '9.9.9', '새 폴더의 내용이 적용됨');
  assert.equal(await fresh.evaluate('document.body.dataset.frames'), 'saved');
  assert.deepEqual((await fresh.evaluate('chrome.storage.local.get(null)')).ediChartFrames.frames, { 1: DOCTOR_A[1], 2: DOCTOR_A[2] });
  passed.push('EXT-13');
});

test('EXT-15 틀 여러 벌: 저장한 3벌을 패널을 열 때·새 환자마다 돌아가며 쓰고, 차례 숫자 하나만 더 저장한다', async () => {
  const sets = { 1: [DOCTOR_A[1], DOCTOR_B[1], DOCTOR_C[1]], 2: [DOCTOR_A[2], DOCTOR_B[2], DOCTOR_C[2]] };
  const url = `chrome-extension://${FIXED_ID}/sidepanel.html`;
  const current = p => p.evaluate("(document.querySelector('#variant-bar [aria-pressed=\"true\"]') || {}).textContent || ''");
  const setter = await b.newPage(url, { ready: PANEL_READY });
  await setter.evaluate("chrome.storage.local.set({ ediChartFrames: { v: 2, frames: " + JSON.stringify(sets) + ", savedAt: new Date().toISOString() } })");
  await setter.wait("!document.getElementById('variant-bar').hidden");
  assert.match(await setter.evaluate("document.getElementById('frame-state').textContent"), /^원장님 틀 사용 중\(1차 3벌·2차 3벌\)/);
  const seen = [];
  for (let k = 0; k < 4; k += 1) {
    const opened = await b.newPage(url, { ready: PANEL_READY });
    await opened.wait("!document.getElementById('variant-bar').hidden");
    // 다음 패널이 열리기 전에 다음 차례가 저장되었는지 확인한다(시험 순서 고정).
    await opened.wait(`chrome.storage.local.get('ediFrameTurn').then(g => g.ediFrameTurn === ${k + 1})`);
    seen.push(await current(opened));
  }
  assert.deepEqual(seen, ['A', 'B', 'C', 'A'], '패널을 열 때마다 다음 벌');
  const last = await b.newPage(url, { ready: PANEL_READY });
  await last.wait("!document.getElementById('variant-bar').hidden");
  assert.equal(await current(last), 'B');
  await last.wait("chrome.storage.local.get('ediFrameTurn').then(g => g.ediFrameTurn === 5)");
  await last.click('#reset');
  assert.equal(await current(last), 'C', '새 환자도 다음 벌');
  await last.wait("chrome.storage.local.get('ediFrameTurn').then(g => g.ediFrameTurn === 6)");
  const stored = await last.evaluate('chrome.storage.local.get(null)');
  assert.deepEqual(Object.keys(stored).sort(), ['ediChartFrames', 'ediFrameTurn'], '틀과 차례 숫자만 저장한다(환자 입력 없음)');
  assert.equal(stored.ediFrameTurn, 6);
  assert.deepEqual(stored.ediChartFrames.frames, sets);
  await last.viewport(360, 900);
  await last.screenshot(shot('ext-frame-variant-360'));
  assert.deepEqual(b.errors, []);
  passed.push('EXT-15');
});

test('EXT-16 틀 30일: 30일 지난 틀은 저장소에서 틀과 차례를 지우고, 열린 패널은 다시 만들게 한다', async () => {
  const url = `chrome-extension://${FIXED_ID}/sidepanel.html`;
  const page = await b.newPage(url, { ready: PANEL_READY });
  await page.wait("document.body.dataset.frames === 'saved'");
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  await page.evaluate("chrome.storage.local.set({ ediChartFrames: { v: 2, frames: { 1: [" + JSON.stringify(DOCTOR_A[1]) + "], 2: [" + JSON.stringify(DOCTOR_A[2]) + "] }, savedAt: '" + old + "' }, ediFrameTurn: 4 })");
  await page.wait("document.body.dataset.frames === 'expired'");
  await page.wait("chrome.storage.local.get(null).then(all => Object.keys(all).length === 0)");
  assert.equal(await page.evaluate("document.getElementById('frame-state').textContent"), '저장한 지 30일이 지나 틀을 지웠습니다 · 새로 만들어 저장해 주세요');
  assert.equal(await page.evaluate("document.getElementById('frame-setup').hidden"), false, '설정 화면을 연다');
  assert.equal(await page.evaluate("document.getElementById('frame1').value"), '');
  const fresh = await b.newPage(url, { ready: PANEL_READY });
  assert.equal(await fresh.evaluate('document.body.dataset.frames'), 'missing', '지운 뒤 새로 연 패널은 설정 필요');
  await page.viewport(360, 900);
  await page.screenshot(shot('ext-frame-expired-360'));
  assert.deepEqual(b.errors, []);
  passed.push('EXT-16');
});

test('EXT-17 독립 검수 RV7-04·05: 다른 창이 새 틀을 저장하면 이 창도 A부터, 틀을 고치던 중 30일이 지나면 지웠다고 알린다', async () => {
  const url = `chrome-extension://${FIXED_ID}/sidepanel.html`;
  const current = p => p.evaluate("(document.querySelector('#variant-bar [aria-pressed=\"true\"]') || {}).textContent || ''");
  const sets = { 1: [DOCTOR_A[1], DOCTOR_B[1], DOCTOR_C[1]], 2: [DOCTOR_A[2], DOCTOR_B[2], DOCTOR_C[2]] };
  const p1 = await b.newPage(url, { ready: PANEL_READY });
  await p1.evaluate("chrome.storage.local.set({ ediChartFrames: { v: 2, frames: " + JSON.stringify(sets) + ", savedAt: new Date().toISOString() } })");
  await p1.wait("!document.getElementById('variant-bar').hidden");
  await p1.click('#reset');
  await p1.click('#reset');
  assert.equal(await current(p1), 'C');
  // RV7-05: 다른 창이 새 틀을 저장하면 이 창도 A부터
  const p2 = await b.newPage(url, { ready: PANEL_READY });
  const other = { 1: [DOCTOR_C[1], DOCTOR_A[1]], 2: [DOCTOR_C[2], DOCTOR_A[2]] };
  await p2.evaluate("chrome.storage.local.set({ ediChartFrames: { v: 2, frames: " + JSON.stringify(other) + ", savedAt: new Date().toISOString() } })");
  await p1.wait("document.getElementById('frame-state').textContent.includes('1차 2벌')");
  assert.equal(await current(p1), 'A', '다른 창에서 새로 저장한 틀은 A부터');
  // RV7-04: 틀을 고치던 중 30일이 지나 지워지면 ‘저장되었습니다’가 아니라 지웠다고 알린다(고치던 틀은 그대로)
  await p1.click('#frame-edit');
  await p1.wait("!document.getElementById('frame-setup').hidden");
  await p1.type('#frame1', DOCTOR_B[1]);
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  await p2.evaluate("chrome.storage.local.set({ ediChartFrames: { v: 2, frames: " + JSON.stringify(other) + ", savedAt: '" + old + "' } })");
  await p1.wait("document.body.dataset.frames === 'expired'");
  await p1.wait("chrome.storage.local.get(null).then(all => !all.ediChartFrames)");
  assert.equal(await p1.evaluate("document.getElementById('frame-save-status').textContent"), '저장한 지 30일이 지나 틀을 지웠습니다. 여기서 고치던 틀은 그대로 두었습니다. 다 고친 뒤 ‘틀 저장’을 누르세요.');
  assert.equal(await p1.evaluate("document.getElementById('frame1').value"), DOCTOR_B[1], '고치던 틀은 그대로');
  assert.deepEqual(b.errors, []);
  passed.push('EXT-17');
});

