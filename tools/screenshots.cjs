'use strict';
// README 화면 캡처를 다시 만든다. 합성 결과지와 합성 원장님 틀만 쓴다(실제 환자·실제 TEMO 화면 없음).
// 실행: 저장소 폴더에서 python3 build.py && node tools/screenshots.cjs
//
// 크롬 사이드 패널은 웹 페이지 밖(크롬 화면)이라 그대로 찍을 수 없다. 그래서 빌드한 확장의 패널 화면을
// 패널 폭(380px)으로 열어 찍고, 합성 결과지 화면 오른쪽에 붙여 ‘결과지 옆 사이드 패널’ 모습으로 만든다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { startExtensionBrowser, pause } = require('../tests/extension-browser.cjs');
const { DOCTOR_B, DOCTOR_C, DOCTOR_W } = require('../tests/fixtures.cjs');
const { viewerInputs, page } = require('../tests/temo-fixture.cjs');

const ROOT = path.join(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
const EXT_DIR = path.join(ROOT, 'dist', `edi-ttalkkak-v${MANIFEST.version}`);
const OUT = path.join(ROOT, 'docs', 'images');
const PANEL_W = 380;
const PAGE_W = 900;
const H = 860;
const PANEL_READY = "!!document.getElementById('edi-text') && document.getElementById('edi-text').textContent.length > 0 && document.body.dataset.frames !== 'loading'";
const day = 86400000;

if (!fs.existsSync(EXT_DIR)) throw new Error('먼저 python3 build.py를 실행하세요: ' + EXT_DIR);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'edi-shots-'));

// 시험용 사본에만 127.0.0.1 주소 권한을 미리 넣는다(권한 창은 자동으로 누를 수 없음).
const extCopy = path.join(TMP, 'ext');
fs.cpSync(EXT_DIR, extCopy, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(extCopy, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
fs.writeFileSync(path.join(extCopy, 'manifest.json'), JSON.stringify(manifest));

// 합성 결과지: 값 9개를 보여 주고 ‘복사하기’ 버튼은 실제 뷰어와 같은 방식으로 문구를 복사한다.
const FIRST = viewerInputs();
// 복사 문구의 “어깨 : 1.2º / 골반 : -0.8º” 줄은 두 줄로 나눠 보여 준다.
const rows = FIRST.expected.split('\n').map(line => line.trim()).filter(line => line.includes(' : '))
  .flatMap(line => line.includes(' / ') ? line.split(' / ').map(part => part.replace(/^(어깨|골반) :/, '$1 수평도 :')) : [line])
  .map(line => line.split(' : '));
const table = '<style>button svg{width:0;height:0}</style>' +
  '<table style="border-collapse:collapse;font-size:17px;margin:8px 0 18px">' +
  rows.map(([k, v]) => `<tr><td style="padding:7px 18px 7px 0;color:#555">${k.replace(/^\d\.\s*/, '')}</td><td style="padding:7px 0;font-weight:700">${v}</td></tr>`).join('') +
  '</table><p style="color:#888;font-size:14px">가상 환자 · 합성 예시 화면입니다(실제 결과지 화면이 아님).</p>';
const RESULT = page({ title: '모아레 결과지 (합성 예시)', viewers: [{ input: FIRST.input, mode: 'exec' }], note: table });

const server = http.createServer((req, res) => {
  res.writeHead(req.url.startsWith('/result') ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.url.startsWith('/result') ? RESULT : 'not found');
});

const answer = ['1', '2'].map(n => [['A', DOCTOR_W], ['B', DOCTOR_C], ['C', DOCTOR_B]].map(([v, d]) => `=== ${n}차 틀 ${v} ===\n${d[n]}`).join('\n')).join('\n');
const sets = { 1: [DOCTOR_W[1], DOCTOR_C[1], DOCTOR_B[1]], 2: [DOCTOR_W[2], DOCTOR_C[2], DOCTOR_B[2]] };

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const b = await startExtensionBrowser({ headless: true });
  const shots = {};
  const shot = async (p, name) => { const file = path.join(TMP, name + '.png'); await p.screenshot(file); shots[name] = file; return file; };
  // 잘라 보여 줄 위치: 요소 위쪽(여백 12px). 문서 끝을 넘지 않게 한다.
  const top = (p, selector) => p.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const y = Math.round(e.getBoundingClientRect().top + window.scrollY) - 12; return Math.max(0, Math.min(y, document.documentElement.scrollHeight - ${H})); })()`);
  try {
    const id = await b.loadUnpacked(extCopy);
    const result = await b.newPage(base + '/result', { ready: "!!document.querySelector('#root button')" });
    await result.viewport(PAGE_W, H);
    const panel = await b.newPage(`chrome-extension://${id}/sidepanel.html`, { ready: PANEL_READY });
    await panel.viewport(PANEL_W, H);
    // 캡처에 스크롤 막대가 끼지 않게 한다(사이드 패널의 실제 폭과 같게).
    const noScrollbar = "(() => { const s = document.createElement('style'); s.textContent = '::-webkit-scrollbar{display:none}html{scrollbar-width:none}'; document.head.appendChild(s); })()";
    await panel.evaluate(noScrollbar);

    // 1) 처음 한 번: 틀 설정 화면
    await shot(panel, 'setup');
    // 2) AI 답을 붙여넣으면 A·B·C 세 벌
    await panel.type('#frame-response', answer);
    await panel.wait("document.getElementById('response-status').textContent.includes('3벌')");
    await pause(300);
    const setsTop = await top(panel, "label[for='frame1']");
    await shot(panel, 'sets');
    await panel.click('#frame-save');
    await panel.wait("document.body.dataset.frames === 'saved'");

    // 3) 결과지 옆에서 가져오기
    await b.activate(result);
    await panel.click('#import1');
    await panel.wait("document.getElementById('import1-status').textContent.startsWith('결과지에서 가져왔습니다')", 15000);
    await pause(2300); // 결과지의 “복사되었습니다.” 표시가 사라진 뒤 찍는다
    await shot(result, 'result');
    await b.activate(panel);
    await pause(300);
    const pasteTop = await top(panel, "section[aria-labelledby='h-paste']");
    await shot(panel, 'imported');

    // 4) 진료 내용을 고르면 원장님 틀로 문구가 만들어진다
    await panel.setDate('#injuryDate', '2026-10-01');
    await panel.click('[data-part="neck"]');
    await panel.click('[data-part="shoulder"]');
    await panel.click('.part-row[data-row="shoulder"] [data-side="우측"]');
    await panel.click('.part-row[data-row="neck"] [data-nrs="6"]');
    await panel.click('.part-row[data-row="shoulder"] [data-nrs="5"]');
    for (const tx of ['acu', 'pharm', 'moxa', 'chuna']) await panel.click(`[data-tx-group="planTx"][data-tx="${tx}"]`);
    await panel.click('[data-next="4주 후"]');
    await pause(400);
    const textTop = await top(panel, 'aside.preview');
    await shot(panel, 'text');

    // 5) 30일 안내(25일 전에 저장한 틀)
    const old = new Date(Date.now() - 25 * day).toISOString();
    await panel.evaluate(`chrome.storage.local.set({ ediChartFrames: { v: 2, frames: ${JSON.stringify(sets)}, savedAt: '${old}' } })`);
    await panel.navigate(`chrome-extension://${id}/sidepanel.html`, PANEL_READY);
    await panel.evaluate(noScrollbar);
    await panel.wait("document.getElementById('frame-expiry').className.includes('warn')");
    await shot(panel, 'expiry');

    // 결과지(왼쪽) + 패널(오른쪽)을 한 장으로 합친다. 패널은 사이드 패널 높이만큼 잘라 보여 준다.
    const url = file => pathToFileURL(file).href;
    const compose = async (name, panelFile, panelTop, withResult) => {
      const width = (withResult ? PAGE_W + 1 : 0) + PANEL_W;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;background:#fff}.wrap{display:flex;width:${width}px;height:${H}px;overflow:hidden}
        .page{width:${PAGE_W}px;height:${H}px;overflow:hidden;border-right:1px solid #c9c9c9}
        .panel{width:${PANEL_W}px;height:${H}px;overflow:hidden;position:relative}
        .panel img{position:absolute;left:0;top:-${panelTop}px}
      </style></head><body><div class="wrap">${withResult ? `<div class="page"><img src="${url(shots.result)}" width="${PAGE_W}"></div>` : ''}
      <div class="panel"><img src="${url(panelFile)}"></div></div></body></html>`;
      const file = path.join(TMP, name + '.html');
      fs.writeFileSync(file, html);
      const view = await b.newPage(url(file), { ready: "Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)" });
      await view.viewport(width, H);
      await view.screenshot(path.join(OUT, name + '.png'));
    };
    fs.mkdirSync(OUT, { recursive: true });
    await compose('00-side-panel', shots.imported, pasteTop, true);
    await compose('01-frame-setup', shots.setup, 0, false);
    await compose('02-frame-sets', shots.sets, setsTop, false);
    await compose('03-edi-text', shots.text, textTop, true);
    await compose('05-expiry-warning', shots.expiry, 0, false);
    if (b.errors.length) console.warn('콘솔 오류:', b.errors);
    console.log('wrote', ['00-side-panel', '01-frame-setup', '02-frame-sets', '03-edi-text', '05-expiry-warning'].map(n => n + '.png').join(', '));
  } finally {
    await b.close();
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
