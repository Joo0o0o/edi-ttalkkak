/* 아이밸런스 EDI 차트생성기 — Chrome 확장 사이드 패널 연결부(EXT 요구사항, 구현계약.md).
 * 패널이 붙은 창의 결과지 탭에서 '복사하기'가 만드는 문구를 받아(capture.js) 붙여넣기 칸에 넣는다.
 * - 클립보드·저장소·네트워크를 쓰지 않는다.
 * - 지금 탭의 주소는 'tabs' 권한으로 읽는다. 결과지 주소 접근은 처음 한 번 그 주소만 사용자에게 허용받는다.
 *   (activeTab만으로는 아이콘을 누른 탭·그 순간에만 주소를 알 수 있어, 로그인·이동 뒤 가져오기가 막혔다: LIVE-20261119-01)
 * - 페이지에서 받은 값은 믿지 않고 형식과 길이를 검사한 뒤 일반 붙여넣기와 같은 해석·차단을 거친다. */
(function () {
  'use strict';
  const api = typeof chrome === 'object' && chrome && chrome.scripting && chrome.tabs && chrome.windows && chrome.permissions ? chrome : null;
  if (!api || !window.EdiApp || typeof captureMoireCopy !== 'function') return;

  const $ = id => document.getElementById(id);
  const OWN = location.origin;
  const MAX_TEXT = 4000;
  const imported = { 1: null, 2: null };
  let target = { tabId: null, origin: null, granted: false };
  let busy = false;

  document.querySelectorAll('[data-ext-only]').forEach(node => { node.hidden = false; });
  document.querySelectorAll('[data-standalone-only]').forEach(node => { node.hidden = true; });

  function setStatus(n, message, kind) {
    const node = $('import' + n + '-status');
    node.textContent = message;
    node.className = 'import-status' + (kind ? ' ' + kind : '');
  }

  function clearChoices(n) {
    const box = $('import' + n + '-choices');
    box.replaceChildren();
    box.hidden = true;
  }

  function webOrigin(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.protocol + '//' + u.hostname : null;
    } catch (error) {
      return null;
    }
  }

  function isOwn(tab) { return String(tab.url || tab.pendingUrl || '').startsWith(OWN); }

  // 패널이 붙은 창의 활성 탭. 그 탭이 이 확장 화면이면 같은 창에서 가장 최근에 본 다른 탭.
  async function findTarget() {
    const win = await api.windows.getCurrent({ populate: true });
    const tabs = (win && win.tabs) || [];
    const active = tabs.find(tab => tab.active);
    let tab = active && !isOwn(active) ? active : null;
    if (!tab) tab = tabs.filter(t => !isOwn(t)).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
    if (!tab) return { tabId: null, origin: null, granted: false };
    const origin = webOrigin(tab.url || '');
    const granted = origin ? await api.permissions.contains({ origins: [origin + '/*'] }) : false;
    return { tabId: tab.id, origin, granted, known: Boolean(tab.url) };
  }

  async function refresh() {
    try { target = await findTarget(); } catch (error) { target = { tabId: null, origin: null, granted: false }; }
  }

  function summary(text) {
    const v = window.EdiCore.parseMoire(text).values;
    const show = value => value === null ? '미확인' : value;
    return '어깨 ' + show(v.shoulder_angle) + ' · 골반 ' + show(v.pelvis_angle) + ' · 등고선 좌 ' + show(v.contour_left) + '/우 ' + show(v.contour_right) + ' · 어깨높이차 ' + show(v.shoulder_height_diff);
  }

  function host(origin) { return origin ? origin.replace(/^https?:\/\//, '') : ''; }

  function accept(n, text, origin) {
    clearChoices(n);
    imported[n] = text;
    window.EdiApp.setPaste(n, text);
    const now = new Date();
    const pad = number => String(number).padStart(2, '0');
    const time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    setStatus(n, '결과지에서 가져왔습니다 · ' + time + (origin ? ' · ' + host(origin) : ''), 'ok');
  }

  function choose(n, texts, origin) {
    const box = $('import' + n + '-choices');
    box.replaceChildren(...texts.map((text, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = (index + 1) + '번째 결과: ' + summary(text);
      button.addEventListener('click', () => accept(n, text, origin));
      return button;
    }));
    box.hidden = false;
    setStatus(n, '이 화면에 결과가 ' + texts.length + '개 있습니다. 넣을 결과를 고르세요.', 'warn');
  }

  function checked(result) {
    if (!result || typeof result !== 'object') return { status: 'ERROR', texts: [] };
    const texts = Array.isArray(result.results)
      ? result.results.filter(text => typeof text === 'string' && text.length > 0 && text.length <= MAX_TEXT)
      : [];
    return { status: typeof result.status === 'string' ? result.status : 'ERROR', texts };
  }

  async function capture(tabId) {
    const [frame] = await api.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: captureMoireCopy });
    return checked(frame && frame.result);
  }

  function failureText(error) {
    const message = String(error && error.message || error || '');
    if (/user gesture/i.test(message)) return '주소 허용 창을 열지 못했습니다. 버튼을 한 번 더 눌러 주세요.';
    if (/permission|Cannot access/i.test(message)) return '이 탭에 접근할 수 없습니다. 결과지 주소의 접근을 ‘허용’했는지 확인하고 다시 눌러 주세요.';
    if (/No tab|closed/i.test(message)) return '결과지 탭을 찾지 못했습니다.';
    return '가져오지 못했습니다(' + message.slice(0, 80) + ').';
  }

  async function run(n, grantedNow) {
    busy = true;
    $('import' + n).disabled = true;
    clearChoices(n);
    setStatus(n, '결과지에서 가져오는 중…', 'pending');
    try {
      if (!grantedNow) {
        setStatus(n, '이 주소의 접근을 허용해야 가져올 수 있습니다. 다시 눌러 ‘허용’을 선택하세요.', 'error');
        return;
      }
      await refresh();
      if (target.tabId === null) { setStatus(n, '결과지 탭을 찾지 못했습니다. TEMO 결과지를 연 창에서 패널을 열어 주세요.', 'error'); return; }
      const origin = target.origin;
      let result = await capture(target.tabId);
      // 뷰어는 복사 직후 2초 동안 누름을 무시한다. 탭이 가려져 타이머가 늦어질 수 있어 짧게 여러 번 다시 시도한다(최대 약 5초).
      for (let attempt = 0; result.status === 'NOTHING' && attempt < 6; attempt++) {
        setStatus(n, '뷰어가 방금 복사를 처리했습니다. 잠시 뒤 다시 가져옵니다…', 'pending');
        await new Promise(resolve => setTimeout(resolve, 850));
        result = await capture(target.tabId);
      }
      if (result.status === 'NO_BUTTON') { setStatus(n, '이 화면에서 모아레 결과지의 ‘복사하기’ 버튼을 찾지 못했습니다. 모아레 결과지를 연 상태에서 눌러 주세요.', 'error'); return; }
      if (!result.texts.length) { setStatus(n, '결과지 문구를 받지 못했습니다. 잠시 뒤 다시 누르거나 직접 붙여넣어 주세요.', 'error'); return; }
      if (result.texts.length > 1) { choose(n, result.texts, origin); return; }
      accept(n, result.texts[0], origin);
    } catch (error) {
      setStatus(n, failureText(error), 'error');
    } finally {
      busy = false;
      $('import' + n).disabled = false;
      refresh();
    }
  }

  // 누를 때마다 지금 탭 주소를 다시 읽고, 처음 쓰는 주소면 같은 클릭 안에서(사용자 동작 직후) 그 주소만 허용을 묻는다.
  async function onImport(n) {
    if (busy) return;
    busy = true;
    $('import' + n).disabled = true;
    clearChoices(n);
    setStatus(n, '결과지 주소를 확인하는 중…', 'pending');
    let granted = false;
    try {
      await refresh();
      if (target.tabId === null) { setStatus(n, '결과지 탭을 찾지 못했습니다. TEMO 결과지를 연 창에서 패널을 열어 주세요.', 'error'); return; }
      if (!target.origin) { setStatus(n, '결과지(웹 페이지) 탭에서만 가져올 수 있습니다. TEMO 결과지 탭을 앞에 두고 눌러 주세요.', 'error'); return; }
      granted = target.granted;
      if (!granted) {
        setStatus(n, '처음 쓰는 결과지 주소입니다. Chrome 창에서 이 주소의 접근 ‘허용’을 눌러 주세요.', 'pending');
        granted = await api.permissions.request({ origins: [target.origin + '/*'] });
      }
    } catch (error) {
      setStatus(n, failureText(error), 'error');
      return;
    } finally {
      busy = false;
      $('import' + n).disabled = false;
    }
    run(n, granted);
  }

  $('import1').addEventListener('click', () => onImport(1));
  $('import2').addEventListener('click', () => onImport(2));

  // 가져온 뒤 붙여넣기 칸을 직접 고치면 알린다(‘그대로’ 확인용).
  for (const n of [1, 2]) {
    $('paste' + n).addEventListener('input', () => {
      if (imported[n] === null) return;
      if ($('paste' + n).value !== imported[n]) setStatus(n, '가져온 뒤 직접 고쳤습니다. 결과지 값과 같은지 확인하세요.', 'warn');
    });
  }

  document.addEventListener('edi:reset', () => {
    for (const n of [1, 2]) { imported[n] = null; setStatus(n, '', ''); clearChoices(n); }
  });

  if (api.tabs.onActivated) api.tabs.onActivated.addListener(() => refresh());
  if (api.tabs.onUpdated) api.tabs.onUpdated.addListener(() => refresh());
  window.addEventListener('focus', () => refresh());
  refresh();
}());
