'use strict';
// 합성 TEMO 모아레 결과지 페이지. 실제 환자 값이 아니다.
// '복사하기' 버튼과 복사 처리는 공개 화면 코드(2026-11-18 확인)를 같은 형태로 옮겼다.
// - 신버전 화면: 문구 → 임시 textarea → execCommand('copy') → 2초 동안 다시 누름 무시
// - 구버전 화면: 같은 처리, shoulderInfo/pelvisInfo가 없으면 0
// 문구의 값(i,o,a,s,l,d,h)은 TEMO와 같은 계산 방식으로 시험 쪽에서 넣는다.
const { temo, raw } = require('./fixtures.cjs');

// TEMO 계산과 같은 방식의 입력값(시험 기대값은 temo-copy-format.cjs moireMetrics의 copy_text).
function viewerInputs(options) {
  const r = raw(options);
  const metrics = temo.moireMetrics(r);
  const text = key => metrics.rows.find(row => row.key === key).text;
  const count = value => (isNaN(value) ? 0 : parseFloat(Math.abs(value).toFixed(0)));
  return {
    input: {
      i: r.shoulderInfo.angle_xy.toFixed(1),
      o: r.pelvisInfo.angle_xy.toFixed(1),
      a: count(r.shoulderInfo.moireCountLeft),
      s: count(r.shoulderInfo.moireCountRight),
      l: 100 * r.shoulderInfo.verticalDistanceDiff,
      d: text('shoulder_ratio'),
      h: text('pelvis_ratio')
    },
    expected: metrics.copy_text
  };
}

// viewers: [{ input, mode: 'exec' | 'clipboard' }] — 결과지 화면 하나에 보이는 뷰어들
function page({ title = '합성 TEMO 결과지', viewers = [], note = '' } = {}) {
  const data = JSON.stringify(viewers).replace(/</g, '\\x3c');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;margin:24px}.viewer{border:1px solid #ccc;padding:12px;margin:12px 0;max-width:520px}button{width:100%;padding:12px;background:#c2a980;color:#fff;border:0;border-radius:10px;font-size:20px}</style>
</head><body>
<h1>${title}</h1><p>${note}</p>
<div id="root"></div>
<script>
(function () {
  var DEG = String.fromCharCode(0xBA);
  var viewers = ${data};
  window.__lastCopyTexts = [];
  viewers.forEach(function (viewer, index) {
    var v = viewer.input;
    var A = '0.00' === v.l.toString() ? 0 : parseFloat(v.l.toFixed(2));
    var f = '기준점 수평도\\n어깨 : ' + v.i + DEG + ' / 골반 : ' + v.o + DEG + '\\n          \\n등고선 비교\\n등고선 간격 : 6mm\\n1. 좌측 등고선 개수 : ' + v.a + '개\\n2. 우측 등고선 개수 : ' + v.s + '개      \\n3. 좌우측 등고선 개수 차이 : ' + Math.abs(v.a - v.s) + '개\\n\\n어깨 높이 차이 : ' + A + 'cm\\n어깨 좌우측 길이 비율 : ' + v.d + '\\n골반 좌우측 길이 비율 : ' + v.h;
    var box = document.createElement('div');
    box.className = 'viewer';
    box.innerHTML = '<p>어깨 높이 차이 :   ' + A + 'cm</p>';
    var button = document.createElement('button');
    button.type = 'button';
    var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    button.appendChild(icon);
    button.appendChild(document.createTextNode(' 복사하기'));
    var copied = false;
    var message = document.createElement('div');
    button.addEventListener('click', async function () {
      if (copied) return;
      window.__lastCopyTexts[index] = f;
      if (viewer.mode === 'clipboard') {
        try { await navigator.clipboard.writeText(f); } catch (error) { console.warn('복사 실패:', error && error.name); }
      } else {
        var e = document.createElement('textarea');
        e.value = f; document.body.appendChild(e); e.focus(); e.select();
        try { document.execCommand('copy'); } catch (error) { console.warn('복사 실패:', error && error.name); }
        document.body.removeChild(e);
      }
      copied = true; message.textContent = '복사되었습니다.';
      setTimeout(function () { copied = false; message.textContent = ''; }, 2000);
    });
    box.appendChild(button); box.appendChild(message);
    document.getElementById('root').appendChild(box);
  });
})();
</script></body></html>`;
}

module.exports = { viewerInputs, page };
