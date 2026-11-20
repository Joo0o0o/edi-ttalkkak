'use strict';
// UI-01~21: 확장 패널과 같은 소스로 만든 시험용 단독 HTML을 격리 Chrome에서 실제 클릭·입력으로 검수한다.
// 실행: 이 업무 폴더에서 node --test --test-concurrency=1 tests/ui.test.cjs
// OS 클립보드는 건드리지 않는다: navigator.clipboard 를 기록용 대역으로 바꿔 '전달된 문구'를 확인한다.
// 차팅 틀(EDI-18): 단독 HTML은 틀을 메모리에만 둔다. 대부분의 시험은 합성 원장님 틀(DOCTOR_A)을 저장된 상태로 넣고 시작한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { startBrowser } = require('./browser.cjs');
const { Core, temoText, FIRST, SECOND, firstState, secondState, DOCTOR_A, DOCTOR_B, DOCTOR_C, DOCTOR_W } = require('./fixtures.cjs');

const ROOT = path.join(__dirname, '..');
// 화면은 확장 패널과 같은 소스(index.html·app.js·styles.css·edi-core.js)로 만든 시험용 단독 HTML에서 검수한다.
const HTML_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'edi-standalone-'));
const HTML = path.join(HTML_DIR, 'edi-standalone.html');
require('node:child_process').execFileSync('python3', [path.join(ROOT, 'build.py'), '--standalone', HTML], { encoding: 'utf8' });
const URL = pathToFileURL(HTML).href;
// EDI_QA_OUT 을 주면 캡처·결과를 그 폴더에 쓴다. 기본은 저장소의 qa/(Git에 올리지 않음).
const OUT = process.env.EDI_QA_OUT ? path.resolve(process.env.EDI_QA_OUT) : path.join(ROOT, 'qa');
const SHOTS = path.join(OUT, 'screens');
const RESULTS = path.join(OUT, 'results');
const RUN = process.env.EDI_QA_RUN || 'r01';
const DAY = (d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'))(new Date()); // 캡처 날짜(로컬)
const shot = name => path.join(SHOTS, `${DAY}-${RUN}-${name}.png`);
const C = code => String.fromCharCode(code);

// 틀은 저장 후 30일이 지나면 지워지므로(EDI-20) 저장 시각은 시험할 때 기준으로 넣는다.
const SEED = 'window.__EDI_TEST_FRAMES = ' + JSON.stringify({ v: 1, frames: DOCTOR_A, savedAt: new Date(Date.now() - 60000).toISOString() }) + ';';
const STUB = "window.__writes = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__writes.push(text); } } });";
const CAPTURE = SEED + STUB;
const NO_API = SEED + "window.__exec = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); document.execCommand = function (cmd) { const a = document.activeElement; window.__exec.push([cmd, a && a.value]); return true; };";
const FAIL_ALL = SEED + "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); document.execCommand = function () { return false; };";
const PENDING = SEED + "window.__writes = []; window.__finish = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => new Promise(resolve => { window.__finish = () => { window.__writes.push(text); resolve(); }; }) } });";

// 저장된 원장님 틀(DOCTOR_A)로 만든 기대 문구
const FIRST_TEXT = Core.compose(firstState(), { frames: DOCTOR_A }).text;
const SECOND_TEXT = Core.compose(secondState(), { frames: DOCTOR_A }).text;

let b;
const passed = [];
const text = () => b.evaluate("document.getElementById('edi-text').textContent");
const value = sel => b.evaluate(`document.querySelector(${JSON.stringify(sel)}).value`);
const pressed = sel => b.evaluate(`document.querySelector(${JSON.stringify(sel)}).getAttribute('aria-pressed') === 'true'`);
const codes = sel => b.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(sel + ' li')})).map(li => li.dataset.code)`);
const items = sel => b.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(sel + ' li')})).map(li => li.textContent)`);
const hidden = id => b.evaluate(`document.getElementById(${JSON.stringify(id)}).hidden`);
const status = () => b.evaluate("document.getElementById('copy-status').textContent");

async function fillFirst() {
  await b.type('#paste1', FIRST);
  await b.setDate('#injuryDate', '2026-10-01');
  await b.click('[data-part="neck"]');
  await b.click('[data-part="shoulder"]');
  await b.click('.part-row[data-row="shoulder"] [data-side="우측"]');
  await b.click('.part-row[data-row="neck"] [data-nrs="6"]');
  await b.click('.part-row[data-row="shoulder"] [data-nrs="5"]');
  for (const tx of ['acu', 'pharm', 'moxa', 'chuna']) await b.click(`[data-tx-group="planTx"][data-tx="${tx}"]`);
  await b.click('[data-next="4주 후"]');
}

async function fillSecond() {
  await b.click('[data-cycle="2"]');
  await b.type('#paste2', SECOND);
  await b.setDate('#firstExamDate', '2026-10-20');
  await b.click('.part-row[data-row="neck"] [data-nrs="4"]');
  await b.click('.part-row[data-row="shoulder"] [data-nrs="3"]');
  for (const tx of ['acu', 'pharm', 'moxa', 'chuna']) await b.click(`[data-tx-group="priorTx"][data-tx="${tx}"]`);
  await b.type('#opinion', '어깨 수평 차이 감소, 좌우 등고선 차이 1개로 감소.');
  await b.click('[data-judgement="호전"]');
  await b.click('[data-continuation="continue"]');
}

test.before(async () => {
  assert.ok(fs.existsSync(HTML), '시험용 단독 HTML 빌드 실패');
  b = await startBrowser();
});

test.after(async () => {
  const html = fs.readFileSync(HTML);
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, `ui-${RUN}.json`), JSON.stringify({
    run: RUN, synthetic: true, os_clipboard_touched: false,
    html: 'standalone test harness (build.py --standalone)', html_sha256: crypto.createHash('sha256').update(html).digest('hex'),
    chrome: b && b.version, node: process.version, passed, expected: 21,
    errors: b ? b.errors : null, requests: b ? Array.from(new Set(b.requests)) : null, dialogs: b ? b.dialogs : null,
    note: '날짜 칸은 DOM 값+input 이벤트로 입력했다. 나머지는 CDP 마우스 클릭·insertText 입력이다. 차팅 틀은 합성 원장님 틀(DOCTOR_A·B·C·W)이다. 30일 시험은 저장 시각과 페이지 시계(Date.now)를 바꿔 확인했다.'
  }, null, 2) + '\n');
  if (b) await b.close();
  fs.rmSync(HTML_DIR, { recursive: true, force: true }); // 시험용 단독 HTML 임시 폴더 정리(RV6 참고)
});

test('UI-01 열기: 보안 맥락·실제 클립보드 API 존재·네트워크 0·브라우저 저장소 미사용·CSP·틀 없으면 복사 막힘', async () => {
  await b.open(URL, null);
  assert.equal(await b.evaluate('document.title'), '아이밸런스 EDI 차트생성기');
  assert.equal(await b.evaluate('window.isSecureContext'), true);
  assert.equal(await b.evaluate("typeof (navigator.clipboard && navigator.clipboard.writeText)"), 'function');
  assert.match(await b.evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content"), /default-src 'none'/);
  const html = fs.readFileSync(HTML, 'utf8');
  for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'http://', 'https://']) {
    assert.equal(html.includes(api), false, api + ' must not appear in the deliverable');
  }
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'missing');
  assert.equal(await hidden('frame-setup'), false, '틀이 없으면 설정 화면이 열려 있다');
  assert.deepEqual(await codes('#blocks'), ['FRAME_MISSING', 'PASTE1_EMPTY']);
  assert.equal(await b.evaluate("document.getElementById('copy').getAttribute('aria-disabled')"), 'true');
  passed.push('UI-01');
});

test('UI-02 1차: 붙여넣기→클릭→원장님 틀 문구→복사 전달값 일치', async () => {
  await b.open(URL, CAPTURE);
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'saved');
  assert.equal(await hidden('frame-setup'), true, '저장된 틀이 있으면 설정 화면은 접혀 있다');
  await fillFirst();
  assert.equal(await value('#paste1'), FIRST);
  assert.equal(await text(), FIRST_TEXT);
  assert.equal(await b.evaluate("document.getElementById('count').textContent"), FIRST_TEXT.length + ' / 350자');
  assert.deepEqual(await codes('#blocks'), []);
  assert.deepEqual(await codes('#notes'), []);
  assert.equal(await b.evaluate("document.getElementById('frame-badge').textContent"), '원장님 틀로 만든 문구');
  assert.equal(await b.evaluate("Array.from(document.querySelectorAll('#parsed1 li .v')).map(n => n.textContent).join('|')"), '1.2º|-0.8º|6mm|12개|10개|2개|0.85cm|1.08:1|1:1.1');
  assert.equal(await b.evaluate("Array.from(document.querySelectorAll('#edi-text b')).map(n => n.textContent).join('|')"), '[검사시행 사유]|[환자평가·판독결과]|[치료계획]');
  await b.click('#copy');
  await b.wait("document.getElementById('copy-status').textContent.startsWith('복사했습니다')");
  assert.deepEqual(await b.evaluate('window.__writes'), [FIRST_TEXT]);
  assert.equal(await b.evaluate("document.getElementById('copy').dataset.copiedBy"), 'clipboard');
  assert.equal(await status(), '복사했습니다 · ' + FIRST_TEXT.length + '자 · 350자 제한 꺼짐');
  await b.screenshot(shot('ui-first-copied'));
  await b.click('.part-row[data-row="neck"] [data-nrs="7"]');
  assert.equal(await status(), '', '문구가 바뀌면 복사됨 표시를 지운다');
  assert.equal(await b.evaluate("localStorage.length + sessionStorage.length"), 0);
  passed.push('UI-02');
});

test('UI-03 2차: 1차·2차 붙여넣기, 350자 초과는 기본 경고만·복사, 제한을 켜면 차단, 회차 전환 보존', async () => {
  await b.open(URL, CAPTURE);
  await fillFirst();
  await fillSecond();
  assert.equal(await b.evaluate("document.getElementById('paste1-label').textContent"), '1차 검사 결과 (이전 1차 검사일)');
  assert.equal(await b.evaluate("document.getElementById('paste2-label').textContent"), '2차 검사 결과 (이번 검사)');
  assert.equal(await b.evaluate("document.getElementById('plan-title').textContent"), '치료 후 평가');
  assert.equal(await value('#purpose'), '경과 확인');
  assert.equal(await text(), SECOND_TEXT);
  assert.ok(SECOND_TEXT.length > 350);
  assert.equal(await b.evaluate("document.getElementById('count').textContent"), SECOND_TEXT.length + ' / 350자');
  // 350자를 넘어도 기본은 복사할 수 있다(2026-11-19 사용자: “350자 제한 넘어도 일단 복사는 가능하게”). 경고만 보인다.
  assert.equal(await b.evaluate("document.getElementById('limitOn').checked"), false);
  assert.equal(await b.evaluate("document.getElementById('limit-state').textContent"), '꺼짐');
  assert.deepEqual(await codes('#blocks'), []);
  assert.deepEqual(await codes('#notes'), ['OVER_LIMIT_OFF']);
  assert.match((await items('#notes')).join(' '), /EDI 프로그램에서 뒷부분이 잘리거나 막힐 수 있으니/);
  await b.click('#copy');
  await b.wait("document.getElementById('copy-status').textContent.startsWith('복사했습니다')");
  assert.deepEqual(await b.evaluate('window.__writes'), [SECOND_TEXT]);
  assert.equal(await status(), '복사했습니다 · ' + SECOND_TEXT.length + '자(350자 초과) · 350자 제한 꺼짐');
  await b.screenshot(shot('ui-second-limit-off-copied'));
  // 제한을 켜면 넘을 때 막는다
  await b.click('#limitOn');
  assert.equal(await b.evaluate("document.getElementById('limit-state').textContent"), '켜짐');
  assert.deepEqual(await codes('#blocks'), ['OVER_LIMIT']);
  assert.equal(await b.evaluate("document.getElementById('copy').getAttribute('aria-disabled')"), 'true');
  await b.screenshot(shot('ui-second-over-limit-blocked'));
  await b.click('#copy');
  assert.deepEqual(await b.evaluate('window.__writes'), [SECOND_TEXT], '켜진 상태에서 넘으면 더 전달하지 않는다');
  await b.click('#limitOn');
  await b.click('[data-cycle="1"]');
  assert.equal(await value('#paste1'), FIRST);
  assert.equal(await value('#purpose'), Core.DEFAULTS.purpose1);
  assert.equal(await b.evaluate("document.querySelector('[data-only=\"2\"]').hidden"), true);
  await b.click('[data-cycle="2"]');
  assert.equal(await value('#paste2'), SECOND);
  assert.equal(await value('#opinion'), '어깨 수평 차이 감소, 좌우 등고선 차이 1개로 감소.');
  passed.push('UI-03');
});

test('UI-04 차단: 읽지 못한 값·좌우 미선택·2차 붙여넣기 누락', async () => {
  await b.open(URL, CAPTURE);
  await b.type('#paste1', temoText({ left: null }));
  assert.deepEqual(await codes('#blocks'), ['PASTE1_UNREADABLE']);
  assert.match(await b.evaluate("document.querySelector('#blocks li').textContent"), /좌측 등고선 개수/);
  assert.equal(await b.evaluate("Array.from(document.querySelectorAll('#parsed1 li.bad .k')).map(n => n.textContent).join('|')"), '좌측 등고선 개수|좌우측 등고선 개수 차이');
  assert.ok((await text()).includes('좌 미확인'));
  await b.click('[data-part="shoulder"]');
  assert.deepEqual(await codes('#blocks'), ['PASTE1_UNREADABLE', 'SIDE_MISSING']);
  await b.screenshot(shot('ui-blocked-unreadable-side'));
  await b.click('#copy');
  assert.deepEqual(await b.evaluate('window.__writes'), []);
  await b.type('#paste1', FIRST);
  await b.click('.part-row[data-row="shoulder"] [data-side="양측"]');
  assert.deepEqual(await codes('#blocks'), []);
  await b.click('[data-cycle="2"]');
  assert.deepEqual(await codes('#blocks'), ['PASTE2_EMPTY']);
  passed.push('UI-04');
});

test('UI-05 최종 문구 직접 수정: 수치 대조·미반영 안내·되돌리기·회차별 보관', async () => {
  await b.open(URL, CAPTURE);
  await fillFirst();
  await b.click('#text-edit');
  assert.equal(await hidden('edi-manual'), false);
  assert.equal(await hidden('edi-text'), true);
  assert.equal(await value('#edi-manual'), FIRST_TEXT);
  assert.equal(await b.evaluate('document.activeElement.id'), 'edi-manual');
  const edited = FIRST_TEXT.replace('모아레 1차 검사함.', '모아레 1차\n검사를 시행함.');
  await b.type('#edi-manual', edited);
  assert.equal(await text(), edited.replace('\n', ' '), '복사될 문구는 한 문단');
  assert.deepEqual(await codes('#blocks'), []);
  assert.equal(await b.evaluate("document.getElementById('frame-badge').textContent"), '원장님 틀로 만든 문구 · 직접 고침');
  await b.click('.part-row[data-row="neck"] [data-nrs="7"]');
  assert.ok((await codes('#notes')).includes('TEXT_STALE'));
  assert.equal(await value('#edi-manual'), edited.replace('\n', ' '), '칸을 떠나면 한 문단으로 맞춘다');
  await b.type('#edi-manual', edited.replace('1.2º', '1.3º'));
  assert.deepEqual(await codes('#blocks'), ['VALUE_MISMATCH']);
  assert.match(await b.evaluate("document.querySelector('#blocks li').textContent"), /1\.2º/);
  assert.equal(await b.evaluate("document.getElementById('copy').getAttribute('aria-disabled')"), 'true');
  await b.screenshot(shot('ui-manual-value-mismatch'));
  await b.click('#copy');
  assert.deepEqual(await b.evaluate('window.__writes'), [], '바뀐 수치는 복사하지 않는다');
  await b.click('#text-revert');
  assert.equal(await hidden('edi-manual'), true);
  assert.ok((await text()).includes('(NRS 목 7, 우측 어깨 5)'), '되돌리면 바뀐 입력이 반영된다');
  assert.deepEqual(await codes('#notes'), []);
  assert.deepEqual(await codes('#blocks'), []);
  await b.click('#text-edit');
  await b.type('#edi-manual', FIRST_TEXT.replace('(NRS 목 6, 우측 어깨 5)', '(NRS 목 7, 우측 어깨 5)').replace('다시 검사', '재평가'));
  await b.click('[data-cycle="2"]');
  assert.equal(await hidden('edi-manual'), true, '직접 수정은 회차별로 보관');
  await b.click('[data-cycle="1"]');
  assert.equal(await hidden('edi-manual'), false);
  assert.ok((await value('#edi-manual')).endsWith('4주 후 재평가.'));
  passed.push('UI-05');
});

test('UI-06 새 환자: 확인 취소는 보존, 확인은 초기화(350자 제한 기본값 꺼짐 복귀·틀 유지), 빈 상태는 묻지 않음', async () => {
  await b.open(URL, CAPTURE);
  await fillFirst();
  await b.click('#limitOn');
  const before = b.dialogs.length;
  b.setDialogAccept(false);
  await b.click('#reset');
  assert.equal(b.dialogs.length, before + 1);
  assert.equal(b.dialogs.at(-1).message, '입력한 내용을 모두 지우고 새 환자로 시작할까요?');
  assert.equal(await text(), FIRST_TEXT);
  b.setDialogAccept(true);
  await b.click('#reset');
  assert.equal(b.dialogs.length, before + 2);
  assert.equal(await value('#paste1'), '');
  assert.equal(await value('#accident'), '교통사고');
  assert.equal(await b.evaluate("document.getElementById('limitOn').checked"), false, '새 환자는 350자 제한 기본값(꺼짐)으로');
  assert.equal(await b.evaluate("document.querySelectorAll('.part-row').length"), 0);
  assert.equal(await pressed('[data-next="4주 후"]'), false);
  assert.equal(await text(), Core.compose(Core.blankState(), { frames: DOCTOR_A }).text);
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'saved', '새 환자는 차팅 틀을 지우지 않는다');
  await b.click('#reset');
  assert.equal(b.dialogs.length, before + 2, '빈 상태에서는 확인 창을 띄우지 않는다');
  passed.push('UI-06');
});

test('UI-07 복사 대체 경로·실패 안내·복사 중 변경', async () => {
  await b.open(URL, NO_API);
  await fillFirst();
  await b.click('#copy');
  await b.wait("document.getElementById('copy-status').textContent.startsWith('복사했습니다')");
  assert.equal(await b.evaluate("document.getElementById('copy').dataset.copiedBy"), 'fallback');
  assert.deepEqual(await b.evaluate('window.__exec'), [['copy', FIRST_TEXT]]);
  assert.equal(await b.evaluate("document.querySelectorAll('.copy-buffer').length"), 0);

  await b.open(URL, FAIL_ALL);
  await fillFirst();
  await b.click('#copy');
  await b.wait("document.getElementById('copy-status').textContent.startsWith('복사하지 못했습니다')");
  assert.equal(await b.evaluate('window.getSelection().toString()'), FIRST_TEXT);
  await b.screenshot(shot('ui-copy-failed-select'));

  await b.open(URL, PENDING);
  await fillFirst();
  await b.click('#copy');
  await b.wait("typeof window.__finish === 'function'");
  await b.click('.part-row[data-row="neck"] [data-nrs="8"]');
  await b.evaluate('window.__finish()');
  await b.wait("document.getElementById('copy-status').textContent.startsWith('복사하는 동안 내용이 바뀌었습니다')");
  passed.push('UI-07');
});

test('UI-08 좁은 화면 390px·키보드 조작', async () => {
  await b.viewport(390, 844);
  await b.open(URL, CAPTURE);
  await fillFirst();
  assert.equal(await text(), FIRST_TEXT);
  assert.ok(await b.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '가로 넘침 없음');
  await b.screenshot(shot('ui-390-first'));
  await b.viewport(1440, 1000);
  await b.open(URL, CAPTURE);
  await b.evaluate("document.querySelector('[data-part=\"neck\"]').focus()");
  await b.key('Enter', 'Enter', 13, '\r');
  assert.equal(await pressed('[data-part="neck"]'), true);
  await b.key(' ', 'Space', 32, ' ');
  assert.equal(await pressed('[data-part="neck"]'), false);
  passed.push('UI-08');
});

test('UI-09 콘솔 오류 0·외부 요청 0·dist = 소스 빌드', async () => {
  // data: 는 Chrome 내장 날짜 칸 아이콘처럼 메모리 안의 자원이다(네트워크 아님). 외부 요청만 0이어야 한다.
  const urls = Array.from(new Set(b.requests));
  const external = urls.filter(u => !(u === URL || u.startsWith('data:')));
  assert.deepEqual(external, [], 'external requests: ' + external.join(', '));
  assert.ok(urls.includes(URL));
  assert.deepEqual(b.errors, []);
  const { execFileSync } = require('node:child_process');
  const out = execFileSync('python3', [path.join(ROOT, 'build.py'), '--check'], { encoding: 'utf8' });
  assert.match(out, /^SAME /);
  passed.push('UI-09');
});

test('UI-10 독립 검수 r1 지적 수정: 줄 구분 문자·상태 문구·미확인 원문·맞춤법 전송 차단·접근성', async () => {
  await b.open(URL, CAPTURE);
  await fillFirst();
  await fillSecond();
  // REV-01/02: 소견의 줄 구분 문자(U+2028)는 한 칸으로 정리되고 수치 불일치로 막지 않는다(350자 제한은 기본 꺼짐).
  await b.type('#opinion', '어깨 수평 차이 감소.' + C(0x2028) + '좌우 차이 감소.');
  assert.deepEqual(await codes('#blocks'), []);
  assert.ok((await text()).includes('소견 어깨 수평 차이 감소. 좌우 차이 감소. [치료 후 평가]'));
  const separators = [0x0B, 0x0C, 0x85, 0x2028, 0x2029].map(C);
  const shown = await text();
  assert.equal(separators.some(ch => shown.includes(ch)), false);
  await b.screenshot(shot('ui-rev01-u2028-not-blocked'));
  // IMP-01: 복사 뒤 350자 제한을 바꾸면 복사 상태 문구를 지운다.
  await b.click('#copy');
  await b.wait("document.getElementById('copy-status').textContent.startsWith('복사했습니다')");
  await b.click('#limitOn');
  assert.equal(await status(), '');
  assert.equal(await b.evaluate("document.getElementById('copy').getAttribute('aria-disabled')"), 'true');
  // 접근성: 막힌 복사 버튼도 포커스할 수 있고 막힌 이유를 설명으로 연결한다.
  assert.equal(await b.evaluate("document.getElementById('copy').disabled"), false);
  assert.match(await b.evaluate("document.getElementById('copy').getAttribute('aria-describedby')"), /^block-0( block-\d+)*$/);
  // IMP-02: 읽지 못한 값은 원래 글자를 함께 보여 준다.
  await b.click('[data-cycle="1"]');
  await b.type('#paste1', FIRST.replace('0.85cm', '0.85 cm'));
  assert.equal(await b.evaluate("document.querySelector('#parsed1 li.bad .v').textContent"), '미확인 (0.85 cm)');
  // IMP-06: 자유 입력칸은 브라우저 맞춤법 검사로 내용이 나가지 않게 spellcheck=false.
  const spell = await b.evaluate("Array.from(document.querySelectorAll('input[type=text], textarea')).filter(e => e.spellcheck !== false).map(e => e.id || e.className)");
  assert.deepEqual(spell, []);
  // IMP-05: 포커스 표시는 브랜드 갈색(대비 확보).
  assert.match(fs.readFileSync(HTML, 'utf8'), /:focus-visible[^{]*\{\s*outline: 3px solid var\(--primary\)/);
  passed.push('UI-10');
});

test('UI-11 독립 재검수 r2 지적 수정: 상단 포커스·막힌 이유 설명·조작된 값 차단·긴 미확인 원문 배치', async () => {
  await b.viewport(1440, 1000);
  await b.open(URL, CAPTURE);
  // REV-03: Tab 첫 포커스('새 환자')의 테두리가 상단 막대 배경과 구분되어야 한다.
  await b.key('Tab', 'Tab', 9);
  assert.equal(await b.evaluate('document.activeElement.id'), 'reset');
  const ring = await b.evaluate("getComputedStyle(document.getElementById('reset')).outlineColor");
  const bar = await b.evaluate("getComputedStyle(document.querySelector('.topbar')).backgroundColor");
  assert.notEqual(await b.evaluate("getComputedStyle(document.getElementById('reset')).outlineStyle"), 'none');
  assert.notEqual(ring, bar, 'outline ' + ring + ' vs bar ' + bar);
  await b.screenshot(shot('ui-rev03-reset-focus'), { full: false });
  // REV-04: 막힌 복사 버튼의 접근성 설명에 실제 차단 사유가 들어간다.
  await b.cdp('DOM.enable');
  await b.cdp('Accessibility.enable');
  const describe = async () => {
    const { root } = await b.cdp('DOM.getDocument', { depth: 0 });
    const { nodeId } = await b.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '#copy' });
    const ax = await b.cdp('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const node = ax.nodes.find(n => !n.ignored) || ax.nodes[0];
    return node.description ? String(node.description.value) : '';
  };
  assert.match(await describe(), /검사 결과를 붙여넣어 주세요/);
  assert.equal(await b.evaluate("document.getElementById('copy-reason')"), null, '숨긴 중복 문장 없이 보이는 차단 목록을 설명으로 쓴다');
  await fillFirst();
  assert.doesNotMatch(await describe(), /붙여넣어 주세요|복사를 막는 항목/);
  assert.equal(await b.evaluate("document.getElementById('copy').getAttribute('aria-describedby')"), null);
  // REV-06: 방향 제어 문자로 감싼 값은 화면과 다른 값으로 읽지 않고 미확인으로 막는다.
  const RLO = C(0x202E), PDF = C(0x202C);
  await b.type('#paste1', FIRST.replace('0.85cm', RLO + '58.0' + PDF + 'cm'));
  assert.ok((await codes('#blocks')).includes('PASTE1_UNREADABLE'));
  assert.equal((await text()).includes('58.0cm'), false);
  assert.equal(await b.evaluate("document.querySelector('#parsed1 li.bad .v').textContent"), '미확인 (특수 문자 포함)');
  // REV-07: 긴 미확인 원문이 있어도 항목 이름이 무너지지 않고 옆 칸을 침범하지 않는다.
  await b.type('#paste1', FIRST.replace('0.85cm', '0.85cm (측정 오차 가능성이 있어 재측정 권장)'));
  const measure = () => b.evaluate("Array.from(document.querySelectorAll('#parsed1 li')).map(li => { const k = li.querySelector('.k').getBoundingClientRect(); const v = li.querySelector('.v').getBoundingClientRect(); const r = li.getBoundingClientRect(); return { kw: Math.round(k.width), over: Math.round(Math.max(0, v.right - r.right, r.left - v.left)) }; })");
  for (const width of [1440, 1080]) {
    await b.viewport(width, 1000);
    const layout = await measure();
    assert.ok(layout.every(x => x.kw >= 56 && x.over <= 1), width + ' ' + JSON.stringify(layout));
  }
  await b.viewport(1440, 1000);
  await b.screenshot(shot('ui-rev07-long-raw'));
  passed.push('UI-11');
});

test('UI-12 Astra 지적 AST-01: 복사를 기다리는 동안 문구가 막힘 상태가 되면 성공으로 표시하지 않는다', async () => {
  await b.viewport(1440, 1000);
  await b.open(URL, PENDING);
  await fillFirst();
  await fillSecond();
  assert.deepEqual(await codes('#blocks'), [], '350자 제한 기본 꺼짐');
  await b.click('#copy');
  await b.wait("typeof window.__finish === 'function'");
  await b.click('#limitOn');
  assert.deepEqual(await codes('#blocks'), ['OVER_LIMIT']);
  await b.evaluate('window.__finish()');
  await b.wait("document.getElementById('copy-status').textContent !== '' && !document.getElementById('copy-status').textContent.startsWith('복사하는 중')");
  const st = await status();
  assert.equal(st.startsWith('복사했습니다'), false, st);
  assert.match(st, /복사할 수 없는 문구/);
  assert.equal(await b.evaluate("document.getElementById('copy-status').className"), 'copy-status warn');
  passed.push('UI-12');
});

test('UI-13 혈자리: 초기값이 눌린 상태로 보이고, 클릭으로 빼고 직접 추가하면 문구에 바로 반영된다', async () => {
  await b.viewport(1440, 1000);
  await b.open(URL, CAPTURE);
  await fillFirst();
  const pressedPoints = () => b.evaluate("Array.from(document.querySelectorAll('.part-row[data-row=\"neck\"] [data-point]')).filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.dataset.point).join('|')");
  assert.equal(await pressedPoints(), '견외수|대추|풍지|견정(GB21)');
  await b.click('.part-row[data-row="neck"] [data-point="견외수"]');
  await b.click('.part-row[data-row="neck"] [data-point="견정(GB21)"]');
  assert.equal(await pressedPoints(), '대추|풍지');
  await b.type('.part-row[data-row="neck"] .point-extra', '곡지, 합곡');
  await b.click('.part-row[data-row="shoulder"] [data-point="견료"]');
  assert.ok((await text()).includes('[치료계획] 목(대추·풍지·곡지·합곡)·우측 어깨(견우·천종·견정(GB21)) 부위 침, 약침, 뜸 및 추나 치료 시행,'));
  await b.click('[data-part="neck"]');
  await b.click('[data-part="neck"]');
  assert.equal(await pressedPoints(), '대추|풍지', '부위를 다시 골라도 뺀 혈자리는 되살아나지 않는다');
  assert.equal(await b.evaluate("document.querySelector('.part-row[data-row=\"neck\"] .point-extra').value"), '곡지, 합곡');
  await b.screenshot(shot('ui-points'));
  passed.push('UI-13');
});

test('UI-14 차팅 틀 설정: 요청문 복사→AI 답 붙여넣기→검사·미리보기→저장, 틀 바꾸기·닫기', async () => {
  await b.viewport(1440, 1000);
  await b.open(URL, STUB);
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'missing');
  assert.equal(await b.evaluate("document.getElementById('frame-state').textContent"), '설정 필요 · 저장하기 전에는 복사할 수 없습니다');
  assert.equal(await hidden('frame-edit'), true);
  assert.equal(await hidden('frame-cancel'), true, '처음 설정은 닫을 수 없다');
  assert.equal(await b.evaluate("document.getElementById('frame-save').getAttribute('aria-disabled')"), 'true');
  // 1) AI 요청문 복사
  await b.click('#prompt-copy');
  await b.wait("document.getElementById('prompt-status').textContent.startsWith('요청문을 복사했습니다')");
  // 요청문은 패널마다 무작위 문체 조건으로 만든다(seed는 요청문 칸에 남김).
  const seed = Number(await b.evaluate("document.getElementById('prompt-text').dataset.seed"));
  assert.ok(Number.isInteger(seed));
  assert.deepEqual(await b.evaluate('window.__writes'), [Core.framePrompt({ seed })]);
  assert.equal(await value('#prompt-text'), Core.framePrompt({ seed }));
  assert.match(await value('#prompt-text'), /\[이번 문체 조건\]/);
  // 2) 표시 없는 답은 안내하고, 형식대로 온 답은 1·2차 칸을 채운다
  await b.type('#frame-response', '틀을 만들려면 예시가 더 필요합니다.');
  assert.match(await b.evaluate("document.getElementById('response-status').textContent"), /표시를 찾지 못했습니다/);
  assert.equal(await value('#frame1'), '');
  await b.type('#frame-response', '```\n=== 1차 틀 ===\n' + Core.EXAMPLE_FRAMES[1] + '\n=== 2차 틀 ===\n' + Core.EXAMPLE_FRAMES[2] + '\n```');
  assert.match(await b.evaluate("document.getElementById('response-status').textContent"), /빨간 항목을 고친 뒤/);
  assert.match((await items('#frame1-errors')).join(' '), /예시 틀과 너무 비슷합니다\(본문 100%\)/, '예시를 그대로 베낀 틀은 저장할 수 없다');
  assert.equal(await b.evaluate("document.getElementById('frame-save').getAttribute('aria-disabled')"), 'true');
  await b.click('#frame-save');
  assert.match(await b.evaluate("document.getElementById('frame-save-status').textContent"), /저장할 수 없습니다/);
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'missing');
  await b.type('#frame-response', '=== 1차 틀 ===\n' + DOCTOR_B[1] + '\n=== 2차 틀 ===\n' + DOCTOR_A[2]);
  assert.match(await b.evaluate("document.getElementById('response-status').textContent"), /미리보기를 확인하고 저장하세요/);
  assert.equal(await value('#frame1'), DOCTOR_B[1]);
  assert.equal(await value('#frame2'), DOCTOR_A[2]);
  const drafts = { 1: DOCTOR_B[1], 2: DOCTOR_A[2] };
  assert.equal(await b.evaluate("document.getElementById('frame1-preview').textContent"), Core.compose(Core.sampleState(1), { frames: drafts }).text);
  const sample2 = Core.compose(Core.sampleState(2), { frames: drafts });
  assert.equal(await b.evaluate("document.getElementById('frame2-count').textContent"), sample2.length + '자');
  assert.match((await items('#frame2-warnings')).join(' '), /가상 환자 기준 \d+자로 350자를 넘습니다/, '긴 틀은 미리 알려 준다');
  // 3) 틀을 고치다 수치 변수를 지우면 저장할 수 없고, 되돌리면 저장된다
  await b.type('#frame1', DOCTOR_B[1].replace(', 골반비 {골반길이비}', ''));
  assert.match((await items('#frame1-errors')).join(' '), /\{골반길이비\}/);
  assert.equal(await b.evaluate("document.getElementById('frame-save').getAttribute('aria-disabled')"), 'true');
  await b.type('#frame1', DOCTOR_B[1]);
  assert.deepEqual(await items('#frame1-errors'), []);
  await b.screenshot(shot('ui-frame-setup'));
  await b.click('#frame-save');
  await b.wait("document.body.dataset.frames === 'saved'");
  assert.equal(await hidden('frame-setup'), true);
  assert.match(await b.evaluate("document.getElementById('frame-state').textContent"), /^원장님 틀 사용 중 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} 저장$/);
  assert.equal(await b.evaluate("document.activeElement.id"), 'frame-edit');
  // 저장한 틀로 바로 문구를 만든다
  await fillFirst();
  assert.equal(await text(), Core.compose(firstState(), { frames: drafts }).text);
  assert.deepEqual(await codes('#blocks'), []);
  // 틀 바꾸기 → 저장된 틀이 칸에 들어 있고, 바꾸지 않고 닫을 수 있다
  await b.click('#frame-edit');
  assert.equal(await hidden('frame-setup'), false);
  assert.equal(await value('#frame1'), DOCTOR_B[1]);
  assert.equal(await hidden('frame-cancel'), false);
  await b.type('#frame1', DOCTOR_A[1]);
  await b.click('#frame-cancel');
  assert.equal(await hidden('frame-setup'), true);
  assert.equal(await text(), Core.compose(firstState(), { frames: drafts }).text, '닫으면 저장된 틀 그대로');
  await b.viewport(390, 844);
  await b.click('#frame-edit');
  assert.ok(await b.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '설정 화면 가로 넘침 없음');
  await b.screenshot(shot('ui-frame-setup-390'));
  await b.viewport(1440, 1000);
  passed.push('UI-14');
});

test('UI-15 차팅 틀 안내: 변수 목록·요청문 보기·저장 안 된 틀 미리보기 표시', async () => {
  await b.open(URL, null);
  const vars = await items('#frame-vars');
  for (const name of ['수상일', '사고내용', '부위', 'NRS', '확인목적', '치료목표', '다음평가', '치료', '어깨수평', '골반길이비', '1차검사일', '1차이후치료', '수치비교', '소견', '판정', '치료여부']) {
    assert.ok(vars.some(line => line.startsWith('{' + name + '}')), name);
  }
  assert.ok(vars.some(line => line.includes('{1차어깨수평} {2차어깨수평}')));
  await b.click('#prompt-box summary');
  assert.equal(await b.evaluate("document.getElementById('prompt-box').open"), true);
  assert.equal(await value('#prompt-text'), Core.framePrompt({ seed: Number(await b.evaluate("document.getElementById('prompt-text').dataset.seed")) }));
  assert.match(await b.evaluate("document.getElementById('frame-badge').textContent"), /예시 틀로 만든 미리보기입니다/);
  await fillFirst();
  assert.equal(await text(), Core.compose(firstState()).text, '틀이 없으면 예시 틀로 미리보기만');
  assert.deepEqual(await codes('#blocks'), ['FRAME_MISSING']);
  await b.click('#copy');
  assert.equal(await status(), '', '막힌 상태에서는 복사하지 않는다');
  passed.push('UI-15');
});

test('UI-16 독립 검수 RV5-03: 틀 저장 전에는 직접 수정을 막고, 틀을 바꾸면 고친 문구를 되돌린다', async () => {
  await b.viewport(1440, 1000);
  await b.open(URL, STUB);
  await fillFirst();
  assert.equal(await b.evaluate("document.getElementById('text-edit').disabled"), true);
  assert.equal(await hidden('text-edit-hint'), false);
  assert.equal(await b.evaluate("document.getElementById('text-edit').getAttribute('aria-describedby')"), 'text-edit-hint');
  await b.click('#text-edit');
  assert.equal(await hidden('edi-manual'), true, '틀이 없으면 직접 수정이 열리지 않는다');
  await b.type('#frame-response', '=== 1차 틀 ===\n' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n' + DOCTOR_A[2]);
  await b.click('#frame-save');
  await b.wait("document.body.dataset.frames === 'saved'");
  assert.equal(await b.evaluate("document.getElementById('text-edit').disabled"), false);
  assert.equal(await hidden('text-edit-hint'), true);
  assert.equal(await text(), FIRST_TEXT);
  await b.click('#text-edit');
  await b.type('#edi-manual', FIRST_TEXT.replace('다시 검사', '재검'));
  assert.deepEqual(await codes('#blocks'), []);
  await b.click('#frame-edit');
  await b.type('#frame-response', '=== 1차 틀 ===\n' + DOCTOR_B[1] + '\n=== 2차 틀 ===\n' + DOCTOR_B[2]);
  await b.click('#frame-save');
  await b.wait("document.getElementById('copy-status').textContent.includes('직접 고친 문구를 자동 문구로 되돌렸습니다')");
  assert.equal(await hidden('edi-manual'), true);
  assert.equal(await text(), Core.compose(firstState(), { frames: DOCTOR_B }).text, '새 틀로 만든 자동 문구');
  assert.deepEqual(await codes('#blocks'), []);
  passed.push('UI-16');
});

test('UI-17 독립 검수 RV5-06·14: 빈 값 미리보기, 저장 막힘 이유 연결, 요약 알림, 변수 목록 순서', async () => {
  await b.viewport(1440, 1000);
  await b.open(URL, STUB);
  assert.equal(await b.evaluate("!!(document.querySelector('details.vars').compareDocumentPosition(document.getElementById('frame1')) & Node.DOCUMENT_POSITION_FOLLOWING)"), true, '변수 목록이 틀 칸·저장 버튼보다 앞');
  await b.type('#frame-response', '=== 1차 틀 ===\n' + DOCTOR_A[1].replace('{골반길이비}', '') + '\n=== 2차 틀 ===\n' + DOCTOR_A[2]);
  assert.match(await b.evaluate("document.getElementById('frame-save').getAttribute('aria-describedby')"), /^frame1-error-0( frame1-error-\d+)*$/);
  // RV6-01: 저장 버튼의 접근성 설명으로 실제 막힌 이유가 읽힌다(목록 이름이 아님).
  await b.cdp('DOM.enable');
  await b.cdp('Accessibility.enable');
  const { root } = await b.cdp('DOM.getDocument', { depth: 0 });
  const { nodeId } = await b.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '#frame-save' });
  const ax = await b.cdp('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const node = ax.nodes.find(n => !n.ignored) || ax.nodes[0];
  const description = node.description ? String(node.description.value) : '';
  assert.match(description, /\{골반길이비\}/);
  assert.doesNotMatch(description, /저장을 막는 항목/);
  assert.match(await b.evaluate("document.getElementById('frame-check-live').textContent"), /^1차 틀: 고칠 항목 \d+개 · 2차 틀: 저장 가능$/);
  await b.type('#frame1', DOCTOR_A[1]);
  assert.equal(await b.evaluate("document.getElementById('frame-save').getAttribute('aria-describedby')"), null);
  assert.equal(await b.evaluate("document.getElementById('frame-check-live').textContent"), '1차 틀: 저장 가능 · 2차 틀: 저장 가능');
  assert.equal(await b.evaluate("document.getElementById('frame1-preview-sparse').textContent"), Core.compose(Core.sampleState(1, 'sparse'), { frames: DOCTOR_A }).text);
  assert.ok((await b.evaluate("document.getElementById('frame2-preview-sparse').textContent")).endsWith('[치료 후 평가] 호전, 치료 종료.'));
  await b.screenshot(shot('ui-frame-setup-sparse'));
  passed.push('UI-17');
});

test('UI-18 틀 여러 벌: AI 답의 A·B·C를 칸별로 확인·저장하고, 새 환자마다 돌아가며 쓰며, 이번 환자 벌을 바꿀 수 있다', async () => {
  await b.viewport(1440, 1000);
  await b.open(URL, STUB);
  const tab = (cycle, k) => `[data-tab-cycle="${cycle}"][data-tab-index="${k}"]`;
  const tabText = cycle => b.evaluate(`Array.from(document.querySelectorAll('[data-tab-cycle="${cycle}"]')).map(x => x.textContent)`);
  const saveOff = () => b.evaluate("document.getElementById('frame-save').getAttribute('aria-disabled')");
  const answer = ['1', '2'].map(n => ['A', 'B', 'C'].map(v => `=== ${n}차 틀 ${v} ===\n` + { A: DOCTOR_A, B: DOCTOR_B, C: DOCTOR_C }[v][n]).join('\n')).join('\n');
  await b.type('#frame-response', '```\n' + answer + '\n```');
  assert.equal(await b.evaluate("document.getElementById('response-status').textContent"), '1차 3벌·2차 3벌 틀을 채웠습니다. 미리보기를 확인하고 저장하세요.');
  assert.deepEqual(await tabText(1), ['A ✓', 'B ✓', 'C ✓']);
  assert.deepEqual(await tabText(2), ['A ✓', 'B ✓', 'C ✓']);
  assert.equal(await pressed(tab(1, 0)), true);
  assert.equal(await value('#frame1'), DOCTOR_A[1]);
  assert.equal(await b.evaluate("document.getElementById('frame-check-live').textContent"), '1차 틀: 저장 가능(3벌) · 2차 틀: 저장 가능(3벌)');
  // B 칸으로 바꾸면 그 벌의 틀과 미리보기가 보인다(다른 회차는 고르고 있는 벌 A로 채움)
  await b.click(tab(1, 1));
  assert.equal(await pressed(tab(1, 1)), true);
  assert.equal(await value('#frame1'), DOCTOR_B[1]);
  assert.equal(await b.evaluate("document.getElementById('frame1').getAttribute('aria-label')"), '1차 틀 B', '칸 이름에 지금 벌을 담는다');
  assert.equal(await b.evaluate("document.getElementById('frame1-preview').textContent"), Core.compose(Core.sampleState(1), { frames: { 1: DOCTOR_B[1], 2: DOCTOR_A[2] } }).text);
  // C 칸을 망가뜨리면 저장이 막히고, A 칸에서도 막힌 이유가 보인다
  await b.click(tab(1, 2));
  await b.type('#frame1', DOCTOR_C[1].replace('{골반길이비}', ''));
  assert.deepEqual(await tabText(1), ['A ✓', 'B ✓', 'C !']);
  assert.equal(await saveOff(), 'true');
  await b.click(tab(1, 0));
  assert.equal(await value('#frame1'), DOCTOR_A[1], '다른 칸으로 옮겨도 고친 내용이 섞이지 않는다');
  assert.deepEqual(await items('#frame1-errors'), ['1차 틀 C에 고칠 항목이 있습니다. 위의 C 단추를 눌러 확인하세요.']);
  assert.equal(await b.evaluate("document.getElementById('frame-save').getAttribute('aria-describedby')"), 'frame1-error-0');
  assert.match(await b.evaluate("document.getElementById('frame-check-live').textContent"), /^1차 틀: 고칠 항목 \d+개 · 2차 틀: 저장 가능\(3벌\)$/);
  await b.click(tab(1, 2));
  assert.equal(await value('#frame1'), DOCTOR_C[1].replace('{골반길이비}', ''));
  await b.type('#frame1', DOCTOR_C[1]);
  assert.equal(await saveOff(), 'false');
  // 거의 같은 벌은 경고만(저장은 됨)
  await b.click(tab(2, 1));
  await b.type('#frame2', DOCTOR_A[2].replace('다친 뒤', '다친 후'));
  assert.match((await items('#frame2-warnings')).join(' '), /틀 A와 B가 거의 같습니다/);
  await b.type('#frame2', DOCTOR_B[2]);
  await b.screenshot(shot('ui-frame-sets'));
  // LIVE05: 틀을 저장하기 전에 ‘새 환자’를 눌러도 저장한 뒤 첫 환자는 A다.
  await b.click('#reset');
  await b.click('#frame-save');
  await b.wait("document.body.dataset.frames === 'saved'");
  assert.match(await b.evaluate("document.getElementById('frame-state').textContent"), /^원장님 틀 사용 중\(1차 3벌·2차 3벌\) · \d{4}-\d{2}-\d{2} \d{2}:\d{2} 저장$/);
  const sets = { 1: [DOCTOR_A[1], DOCTOR_B[1], DOCTOR_C[1]], 2: [DOCTOR_A[2], DOCTOR_B[2], DOCTOR_C[2]] };
  const make = (k, s = firstState()) => Core.compose(Object.assign(s, { variant: { 1: k, 2: k } }), { frames: sets }).text;
  // 첫 환자는 A. 아래 A·B·C 단추로 이번 환자의 벌을 바꿀 수 있다
  assert.equal(await hidden('variant-bar'), false);
  assert.equal(await pressed('#variant-bar [data-variant="0"]'), true, '틀을 저장하면 A부터');
  await fillFirst();
  assert.equal(await text(), make(0));
  assert.equal(await text(), FIRST_TEXT, 'A 벌 = DOCTOR_A');
  assert.equal(await b.evaluate("document.getElementById('frame-badge').textContent"), '원장님 틀 A로 만든 문구');
  await b.click('#variant-bar [data-variant="1"]');
  assert.equal(await text(), make(1));
  assert.equal(await text(), Core.compose(firstState(), { frames: DOCTOR_B }).text);
  assert.equal(await b.evaluate("document.getElementById('frame-badge').textContent"), '원장님 틀 B로 만든 문구');
  assert.deepEqual(await codes('#blocks'), []);
  await b.click('#copy');
  await b.wait("document.getElementById('copy-status').textContent.startsWith('복사했습니다')");
  assert.deepEqual(await b.evaluate('window.__writes.slice(-1)'), [make(1)]);
  // 직접 고친 뒤 다른 벌을 고르면 막고, 원래 벌로 돌아오면 고친 문구가 그대로 있다
  await b.click('#text-edit');
  await b.type('#edi-manual', make(1).replace('재검', '다시 검사'));
  assert.deepEqual(await codes('#blocks'), []);
  await b.click('#variant-bar [data-variant="2"]');
  assert.deepEqual(await codes('#blocks'), ['TEXT_FRAME_CHANGED']);
  await b.click('#variant-bar [data-variant="1"]');
  assert.deepEqual(await codes('#blocks'), []);
  assert.equal(await value('#edi-manual'), make(1).replace('재검', '다시 검사'));
  // 새 환자마다 다음 벌: B(1번째 다음) → C → A
  b.setDialogAccept(true);
  await b.click('#reset');
  assert.equal(await pressed('#variant-bar [data-variant="1"]'), true, '두 번째 환자는 B');
  await fillFirst();
  assert.equal(await text(), make(1));
  await b.click('#reset');
  assert.equal(await pressed('#variant-bar [data-variant="2"]'), true, '세 번째 환자는 C');
  await fillFirst();
  assert.equal(await text(), make(2));
  // 2차로 바꿔도 같은 차례의 벌을 쓴다
  await fillSecond();
  assert.equal(await pressed('#variant-bar [data-variant="2"]'), true);
  assert.equal(await text(), Core.compose(secondState({ variant: { 1: 2, 2: 2 } }), { frames: sets }).text);
  assert.deepEqual(await codes('#blocks'), [], '350자를 넘어도 기본은 복사 가능');
  assert.ok((await codes('#notes')).includes('OVER_LIMIT_OFF'), '넘으면 경고');
  await b.click('#reset');
  assert.equal(await pressed('#variant-bar [data-variant="0"]'), true, '네 번째 환자는 다시 A');
  await b.viewport(390, 844);
  assert.ok(await b.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '벌 단추가 있어도 가로 넘침 없음');
  await b.screenshot(shot('ui-frame-variant-390'));
  await b.viewport(1440, 1000);
  // 패널을 다시 열면 저장된 다음 차례로 시작한다(시험용 단독 HTML은 __EDI_TEST_TURN으로 흉내)
  const record = { v: 2, frames: sets, savedAt: new Date().toISOString() };
  await b.open(URL, STUB + 'window.__EDI_TEST_FRAMES = ' + JSON.stringify(record) + '; window.__EDI_TEST_TURN = 7;');
  assert.equal(await pressed('#variant-bar [data-variant="1"]'), true, '7번째 차례 → 7 % 3 = B');
  // 한 벌만 저장한 원장님은 벌 단추를 보이지 않는다(예전 저장 형식 v1도 그대로 읽음)
  await b.open(URL, CAPTURE);
  assert.equal(await hidden('variant-bar'), true);
  assert.equal(await b.evaluate("document.getElementById('frame-badge').textContent"), '원장님 틀로 만든 문구');
  // 벌 수가 다른 회차: 1차 2벌, 2차 1벌 → 2차에서는 단추가 숨는다
  await b.open(URL, STUB + 'window.__EDI_TEST_FRAMES = ' + JSON.stringify({ v: 2, frames: { 1: [DOCTOR_A[1], DOCTOR_C[1]], 2: [DOCTOR_A[2]] }, savedAt: new Date().toISOString() }) + '; window.__EDI_TEST_TURN = 1;');
  assert.equal(await pressed('#variant-bar [data-variant="1"]'), true);
  assert.match(await b.evaluate("document.getElementById('frame-state').textContent"), /^원장님 틀 사용 중\(1차 2벌·2차 1벌\)/);
  await b.click('[data-cycle="2"]');
  assert.equal(await hidden('variant-bar'), true);
  assert.equal(await b.evaluate("document.getElementById('frame-badge').textContent"), '원장님 틀로 만든 문구');
  passed.push('UI-18');
});

test('UI-19 틀 30일: 남은 날짜 안내, 마지막 7일 경고, 30일이 지나면 지우고 다시 만들게 한다', async () => {
  await b.viewport(1440, 1000);
  const day = 86400000;
  const record = ago => 'window.__EDI_TEST_FRAMES = ' + JSON.stringify({ v: 2, frames: { 1: [DOCTOR_A[1]], 2: [DOCTOR_A[2]] }, savedAt: new Date(Date.now() - ago).toISOString() }) + ';';
  const expiry = () => b.evaluate("document.getElementById('frame-expiry').textContent");
  const expiryClass = () => b.evaluate("document.getElementById('frame-expiry').className");
  // 2일 전 저장: 28일 남음
  await b.open(URL, STUB + record(2 * day));
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'saved');
  assert.match(await expiry(), /^틀은 매달 새로 만들어 쓰세요\. 이 틀은 \d+월 \d+일에 자동으로 지워집니다\(28일 남음\)\.$/);
  assert.equal(await expiryClass(), 'frame-expiry');
  // 25일 전: 5일 남음 → 경고
  await b.open(URL, STUB + record(25 * day));
  assert.match(await expiry(), /\(5일 남음\)/);
  assert.equal(await expiryClass(), 'frame-expiry warn');
  await b.screenshot(shot('ui-frame-expiry-warn'));
  // 같은 틀을 다시 저장해도 기간은 늘지 않는다(처음 저장한 날부터 30일)
  const before = await b.evaluate("document.getElementById('frame-state').textContent");
  await b.click('#frame-edit');
  await b.click('#frame-save');
  await b.wait("document.getElementById('frame-setup').hidden");
  assert.equal(await b.evaluate("document.getElementById('frame-state').textContent"), before, '저장 시각 그대로');
  assert.match(await expiry(), /\(5일 남음\)/);
  // 31일 전: 열자마자 지우고 설정 화면, 복사 막힘
  await b.open(URL, STUB + record(31 * day));
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'expired');
  assert.equal(await b.evaluate("document.getElementById('frame-state').textContent"), '저장한 지 30일이 지나 틀을 지웠습니다 · 새로 만들어 저장해 주세요');
  assert.match(await expiry(), /새 AI 요청문으로 틀을 다시 만들어 저장하세요/);
  assert.equal(await hidden('frame-setup'), false);
  assert.equal(await value('#frame1'), '', '지운 틀은 칸에도 남기지 않는다');
  assert.equal(await b.evaluate('window.__EDI_TEST_REMOVED'), 1, '저장소에서 지움');
  await fillFirst();
  assert.deepEqual(await codes('#blocks'), ['FRAME_MISSING']);
  await b.screenshot(shot('ui-frame-expired'));
  // 새로 만들어 저장하면 다시 30일
  await b.type('#frame-response', '=== 1차 틀 ===\n' + DOCTOR_B[1] + '\n=== 2차 틀 ===\n' + DOCTOR_B[2]);
  await b.click('#frame-save');
  await b.wait("document.body.dataset.frames === 'saved'");
  assert.match(await expiry(), /\(30일 남음\)/);
  // 패널을 연 채 30일이 지나면: 복사·새 환자 때 확인해 지운다(페이지 시계를 앞으로 돌려 확인)
  await b.open(URL, STUB + record(10 * day) + 'window.__shift = 0; (function () { const real = Date.now; Date.now = function () { return real() + window.__shift; }; }());');
  await fillFirst();
  assert.deepEqual(await codes('#blocks'), []);
  await b.evaluate('window.__shift = ' + (21 * day));
  await b.click('#copy');
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'expired');
  assert.deepEqual(await b.evaluate('window.__writes'), [], '지운 뒤에는 복사하지 않는다');
  assert.equal(await status(), '틀을 저장한 지 30일이 지나 지웠습니다. 위에서 새 틀을 만들어 저장한 뒤 복사하세요.');
  assert.deepEqual(await codes('#blocks'), ['FRAME_MISSING']);
  // AST-R5-02: ‘문제 있음’ 상태로 남은 저장 틀도 패널을 연 채 30일이 지나면 지운다
  const invalid = 'window.__EDI_TEST_FRAMES = ' + JSON.stringify({ v: 2, frames: { 1: [DOCTOR_A[1].replace('통증이 계속됨', '통증이 다소 계속됨')], 2: [DOCTOR_A[2]] }, savedAt: new Date(Date.now() - 10 * day).toISOString() }) + ';';
  await b.open(URL, STUB + invalid + 'window.__shift = 0; (function () { const real = Date.now; Date.now = function () { return real() + window.__shift; }; }());');
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'invalid');
  await b.evaluate('window.__shift = ' + (21 * day));
  await b.click('#reset');
  assert.equal(await b.evaluate('document.body.dataset.frames'), 'expired');
  assert.equal(await b.evaluate('window.__EDI_TEST_REMOVED'), 1, '문제 있는 틀도 저장소에서 지움');
  passed.push('UI-19');
});

test('UI-20 바꿔 쓸 말: 환자마다 다른 표현, ‘다른 표현으로’(그 회차만, RV7-06), 직접 고칠 때는 숨김', async () => {
  await b.viewport(1440, 1000);
  const rec = { v: 2, frames: { 1: [DOCTOR_W[1], DOCTOR_B[1]], 2: [DOCTOR_W[2], DOCTOR_B[2]] }, savedAt: new Date().toISOString() };
  const first = w1 => Core.compose(Object.assign(firstState(), { wording: { 1: w1, 2: 0 }, variant: { 1: 0, 2: 0 } }), { frames: rec.frames }).text;
  const second = w2 => Core.compose(Object.assign(secondState(), { wording: { 1: 0, 2: w2 }, variant: { 1: 0, 2: 0 } }), { frames: rec.frames }).text;
  assert.notEqual(first(11), first(33), '시험에 쓰는 두 수는 다른 표현을 고른다');
  // 수 차례: 패널을 열 때 1차 11·2차 22 → 1차 ‘다른 표현으로’ 33 → 1차 다시 44 → 새 환자 1차 55·2차 66
  await b.open(URL, STUB + 'window.__EDI_TEST_FRAMES = ' + JSON.stringify(rec) + '; window.__EDI_TEST_WORDING = [11, 22, 33, 44, 55, 66];');
  await fillFirst();
  assert.equal(await text(), first(11));
  assert.equal(await hidden('text-reword'), false);
  await b.click('#text-reword');
  assert.equal(await text(), first(33), '다른 표현으로');
  assert.deepEqual(await codes('#blocks'), []);
  await b.screenshot(shot('ui-reword'));
  // 직접 고치는 동안은 숨김
  await b.click('#text-edit');
  assert.equal(await hidden('text-reword'), true);
  await b.click('#text-revert');
  assert.equal(await hidden('text-reword'), false);
  // 복사 전달값도 고른 표현 그대로
  await b.click('#copy');
  await b.wait("document.getElementById('copy-status').textContent.startsWith('복사했습니다')");
  assert.deepEqual(await b.evaluate('window.__writes.slice(-1)'), [first(33)]);
  // RV7-06: 2차 문구를 직접 고친 뒤 1차에서 ‘다른 표현으로’를 눌러도 2차 문구·안내는 그대로
  await fillSecond();
  assert.equal(await text(), second(22));
  await b.click('#text-edit');
  await b.click('[data-cycle="1"]');
  await b.click('#text-reword');
  // 2차 입력 뒤라 통증 점수 등은 2차 값이다(같은 환자 입력을 공유). 1차 문구는 그 상태에서 수 44로 고른 표현.
  assert.equal(await text(), Core.compose(Object.assign(secondState(), { cycle: 1, wording: { 1: 44, 2: 22 }, variant: { 1: 0, 2: 0 } }), { frames: rec.frames }).text);
  await b.click('[data-cycle="2"]');
  assert.equal(await value('#edi-manual'), second(22));
  assert.ok(!(await codes('#notes')).includes('TEXT_STALE'), '다른 회차 표현을 바꿔도 입력 변경 안내가 뜨지 않는다');
  await b.click('#text-revert');
  await b.click('[data-cycle="1"]');
  // 새 환자: 다음 벌(B, 바꿔 쓸 말 없음) → 단추 숨김
  b.setDialogAccept(true);
  await b.click('#reset');
  assert.equal(await pressed('#variant-bar [data-variant="1"]'), true);
  assert.equal(await hidden('text-reword'), true);
  // A로 바꾸면 새 환자의 수(55)로 고른 표현
  await b.click('#variant-bar [data-variant="0"]');
  await fillFirst();
  assert.equal(await text(), first(55));
  assert.equal(await hidden('text-reword'), false);
  passed.push('UI-20');
});

test('UI-21 독립 검수 RV7-08: AI 답의 벌 이름 1·2·3과 4번째 벌, 답 끝에 다시 붙인 이 요청문의 예시', async () => {
  await b.viewport(1440, 1000);
  await b.open(URL, STUB);
  const seed = Number(await b.evaluate("document.getElementById('prompt-text').dataset.seed"));
  const ex = Core.exampleFrames(seed);
  const tabText = cycle => b.evaluate(`Array.from(document.querySelectorAll('[data-tab-cycle="${cycle}"]')).map(x => x.textContent)`);
  const answer = ['=== 1차 틀 1 ===', DOCTOR_A[1], '=== 1차 틀 2 ===', DOCTOR_B[1], '=== 1차 틀 4 ===', DOCTOR_C[1],
    '=== 2차 틀 1 ===', DOCTOR_A[2], '', '참고로 요청하신 예시도 붙입니다.', '=== 1차 틀 A ===', ex[1], '=== 2차 틀 A ===', ex[2]].join('\n');
  await b.type('#frame-response', answer);
  assert.equal(await b.evaluate("document.getElementById('response-status').textContent"), '1차 2벌·2차 1벌 틀을 채웠습니다. 미리보기를 확인하고 저장하세요.');
  assert.deepEqual(await tabText(1), ['A ✓', 'B ✓', 'C']);
  assert.equal(await value('#frame1'), DOCTOR_A[1], '다시 붙인 요청문 예시는 A로 쓰지 않는다');
  assert.equal(await value('#frame2'), DOCTOR_A[2]);
  passed.push('UI-21');
});

