/* 아이밸런스 EDI 차트생성기 — 결과지 문구 가져오기(페이지 안에서 실행).
 *
 * TEMO 모아레 결과지의 '복사하기' 버튼은 문구를 임시 입력칸에 넣고 document.execCommand('copy')로 복사한다
 * (214 신버전 main.fce101b8.js의 Dde, 171 구버전 main.2e4729dd.js의 CAe에서 확인, 2026-11-18).
 * 이 함수는 버튼을 누르는 동안에만 복사 명령을 가로채 그 문구를 그대로 돌려준다.
 * - 클립보드에 쓰지 않는다(원래 명령을 부르지 않음). 끝나면 가로채기를 되돌린다.
 * - 수치를 다시 계산하지 않는다: 뷰어가 만든 문구 그대로다.
 * chrome.scripting.executeScript({ world: 'MAIN', func: captureMoireCopy })로 직렬화되어 실행되므로
 * 바깥 변수를 쓰지 않는다. */
function captureMoireCopy() {
  var LABEL = '복사하기';
  var MAX = 4000;
  var buttons = Array.prototype.filter.call(document.querySelectorAll('button'), function (button) {
    return String(button.textContent || '').replace(/\s+/g, ' ').trim() === LABEL;
  });
  if (!buttons.length) return { status: 'NO_BUTTON', count: 0, results: [] };

  var doc = document;
  var hadOwnExec = Object.prototype.hasOwnProperty.call(doc, 'execCommand');
  var ownExec = doc.execCommand;
  var clip = navigator.clipboard || null;
  var hadOwnWrite = clip ? Object.prototype.hasOwnProperty.call(clip, 'writeText') : false;
  var ownWrite = clip ? clip.writeText : null;
  var results = [];
  try {
    buttons.forEach(function (button) {
      var captured = null;
      doc.execCommand = function (command) {
        if (String(command).toLowerCase() === 'copy') {
          var active = doc.activeElement;
          var text = active && typeof active.value === 'string' ? active.value : String(window.getSelection ? window.getSelection() : '');
          captured = text.slice(0, MAX);
          return true;
        }
        return ownExec.apply(doc, arguments);
      };
      // 뷰어가 앞으로 클립보드 API로 바뀌어도 같은 방식으로 받는다.
      if (clip) clip.writeText = function (text) { captured = String(text).slice(0, MAX); return Promise.resolve(); };
      button.click();
      results.push(captured);
    });
  } finally {
    if (hadOwnExec) doc.execCommand = ownExec; else delete doc.execCommand;
    if (clip) { if (hadOwnWrite) clip.writeText = ownWrite; else delete clip.writeText; }
  }
  var got = results.some(function (text) { return text !== null; });
  // 뷰어는 복사 직후 2초 동안 다시 누름을 무시한다. 그때는 아무것도 받지 못한다.
  return { status: got ? 'OK' : 'NOTHING', count: buttons.length, results: results };
}

if (typeof module === 'object' && module.exports) module.exports = { captureMoireCopy: captureMoireCopy };
