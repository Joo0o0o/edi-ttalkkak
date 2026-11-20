'use strict';
// CAP-01~07: 결과지 '복사하기' 문구 가져오기(captureMoireCopy)를 합성 TEMO 결과지에서 검수한다.
// 실행: 이 업무 폴더에서 node --test --test-concurrency=1 tests/capture.test.cjs
// OS 클립보드는 쓰지 않는다. 확장 없이 같은 함수를 페이지에서 직접 실행한다(확장 연결은 extension.test.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startBrowser, pause } = require('./browser.cjs');
const { Core } = require('./fixtures.cjs');
const { viewerInputs, page } = require('./temo-fixture.cjs');
const { captureMoireCopy } = require('../src/capture.js');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'edi-capture-'));
const write = (name, html) => { const file = path.join(DIR, name); fs.writeFileSync(file, html); return pathToFileURL(file).href; };
const READY = "!!document.getElementById('root')";
const CAPTURE = `(${captureMoireCopy.toString()})()`;
const FIRST = viewerInputs();
const SECOND = viewerInputs({ shoulder: 0.61, pelvis: -0.33, left: 11, right: 10, height: 0.004, xs: [-0.2, 0.2, -0.16, 0.165] });
const EDGE = viewerInputs({ shoulder: -0.04, left: 0, right: 0 });

let b;
test.before(async () => { b = await startBrowser(); });
test.after(async () => { if (b) await b.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

test('CAP-01 신버전 형태: 뷰어가 만드는 문구를 글자 그대로 받고, 가로채기를 되돌린다', async () => {
  await b.open(write('one.html', page({ viewers: [{ input: FIRST.input, mode: 'exec' }] })), null, READY);
  const r = await b.evaluate(CAPTURE);
  assert.equal(r.status, 'OK');
  assert.equal(r.count, 1);
  assert.equal(r.results[0], FIRST.expected, '공개 코드와 같은 형식(core.js 재현)');
  assert.equal(r.results[0], await b.evaluate('window.__lastCopyTexts[0]'), '페이지가 복사하려던 문구와 같다');
  assert.equal(await b.evaluate("Object.prototype.hasOwnProperty.call(document, 'execCommand')"), false);
  assert.equal(await b.evaluate("typeof document.execCommand"), 'function');
  const parsed = Core.parseMoire(r.results[0]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.values.shoulder_height_diff, '0.85cm');
  assert.equal(await b.evaluate("document.querySelector('.viewer div').textContent"), '복사되었습니다.', '뷰어 자체 안내는 그대로 뜬다');
});

test('CAP-02 복사 직후 2초 동안은 뷰어가 누름을 무시한다: NOTHING 뒤 다시 시도하면 받는다', async () => {
  const again = await b.evaluate(CAPTURE);
  assert.equal(again.status, 'NOTHING');
  assert.deepEqual(again.results, [null]);
  await pause(2200);
  const later = await b.evaluate(CAPTURE);
  assert.equal(later.status, 'OK');
  assert.equal(later.results[0], FIRST.expected);
});

test('CAP-03 결과지가 아니면(버튼 없음) NO_BUTTON', async () => {
  await b.open(write('none.html', page({ title: '환자 목록', viewers: [] })), null, READY);
  assert.deepEqual(await b.evaluate(CAPTURE), { status: 'NO_BUTTON', count: 0, results: [] });
});

test('CAP-04 한 화면에 뷰어가 둘이면 둘 다 받아 고르게 한다', async () => {
  await b.open(write('two.html', page({ viewers: [{ input: FIRST.input, mode: 'exec' }, { input: SECOND.input, mode: 'exec' }] })), null, READY);
  const r = await b.evaluate(CAPTURE);
  assert.equal(r.status, 'OK');
  assert.equal(r.count, 2);
  assert.deepEqual(r.results, [FIRST.expected, SECOND.expected]);
});

test('CAP-05 클립보드 API로 복사하는 뷰어도 같은 문구를 받고 원래대로 되돌린다', async () => {
  await b.open(write('clip.html', page({ viewers: [{ input: SECOND.input, mode: 'clipboard' }] })), null, READY);
  const r = await b.evaluate(CAPTURE);
  assert.equal(r.status, 'OK');
  assert.equal(r.results[0], SECOND.expected);
  assert.equal(await b.evaluate("Object.prototype.hasOwnProperty.call(navigator.clipboard, 'writeText')"), false);
});

test('CAP-06 OS 클립보드에 쓰지 않는다: 원래 복사 명령·클립보드 API를 부르지 않는다', async () => {
  const spy = "window.__orig = { exec: 0, write: 0 };"
    + "Document.prototype.execCommand = function () { window.__orig.exec++; return false; };"
    + "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function () { window.__orig.write++; return Promise.resolve(); } } });";
  await b.open(write('spy.html', page({ viewers: [{ input: FIRST.input, mode: 'exec' }, { input: SECOND.input, mode: 'clipboard' }] })), spy, READY);
  const r = await b.evaluate(CAPTURE);
  assert.deepEqual(r.results, [FIRST.expected, SECOND.expected]);
  assert.deepEqual(await b.evaluate('window.__orig'), { exec: 0, write: 0 });
  await b.open(write('blank.html', page({ viewers: [] })), null, READY);
});

test('CAP-07 -0.0·0개 같은 값도 뷰어 문구 그대로', async () => {
  await b.open(write('edge.html', page({ viewers: [{ input: EDGE.input, mode: 'exec' }] })), null, READY);
  const r = await b.evaluate(CAPTURE);
  assert.equal(r.results[0], EDGE.expected);
  const values = Core.parseMoire(r.results[0]).values;
  assert.equal(values.shoulder_angle, '-0.0º');
  assert.equal(values.contour_left, '0개');
  assert.deepEqual(b.errors, []);
});
