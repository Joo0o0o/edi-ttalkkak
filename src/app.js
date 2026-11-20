/* 아이밸런스 EDI 차트생성기 — 화면.
 * 환자 입력은 메모리에만 있고 저장·전송하지 않는다(EDI-01).
 * 원장님 차팅 틀만 이 PC에 저장한다(EDI-18: 확장은 chrome.storage.local, 시험용 단독 HTML은 메모리). */
(function () {
  'use strict';
  const Core = window.EdiCore;
  const $ = id => document.getElementById(id);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  // 미리보기에서 [머리말]을 굵게 보여 준다. 머리말 표기는 원장님 틀마다 다르다.
  const HEADER_SPLIT = /(\[[^[\]\n]{1,20}\])/;
  const HEADER_ONLY = /^\[[^[\]\n]{1,20}\]$/;

  let state = Core.blankState();
  let statusFor = null; // 상태 문구가 가리키는 EDI 문구
  let copySeq = 0;

  const el = {
    paste1: $('paste1'), paste2: $('paste2'), paste1Label: $('paste1-label'),
    parsed1: $('parsed1'), parsed2: $('parsed2'),
    injuryDate: $('injuryDate'), accident: $('accident'), purpose: $('purpose'),
    firstExamDate: $('firstExamDate'), goal: $('goal'), nextCustom: $('nextCustom'), opinion: $('opinion'),
    partRows: $('part-rows'), planTitle: $('plan-title'), nextGroup: $('next-group'),
    limitOn: $('limitOn'), limitState: $('limit-state'),
    count: $('count'), meter: $('meter-bar'), text: $('edi-text'), manual: $('edi-manual'),
    textEdit: $('text-edit'), textRevert: $('text-revert'), textReword: $('text-reword'), badge: $('frame-badge'),
    blocks: $('blocks'), notes: $('notes'), copy: $('copy'), status: $('copy-status'), reset: $('reset')
  };

  // ---------- 원장님 차팅 틀 저장소 (EDI-18, 사용자 결정: 이 PC에만 저장) ----------
  const FRAME_KEY = 'ediChartFrames';
  const chromeLocal = typeof chrome === 'object' && chrome && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
  const frameStore = chromeLocal ? {
    load: () => chromeLocal.get(FRAME_KEY).then(got => got[FRAME_KEY] || null),
    save: record => chromeLocal.set({ [FRAME_KEY]: record }),
    // 30일이 지난 틀: 틀과 벌 차례를 함께 지운다.
    remove: () => chromeLocal.remove([FRAME_KEY, 'ediFrameTurn'])
  } : (() => {
    // 시험용 단독 HTML: 메모리에만 둔다. 화면 시험은 window.__EDI_TEST_FRAMES로 저장된 틀을 미리 넣는다.
    let memory = window.__EDI_TEST_FRAMES || null;
    return {
      load: () => Promise.resolve(memory),
      save: record => { memory = record; return Promise.resolve(); },
      remove: () => { memory = null; window.__EDI_TEST_REMOVED = (window.__EDI_TEST_REMOVED || 0) + 1; return Promise.resolve(); }
    };
  })();

  // 바꿔 쓸 말을 고르는 수: 환자마다(패널을 열 때·새 환자·‘다른 표현으로’) 새로 정한다. 저장하지 않는다.
  // 시험용 단독 HTML은 window.__EDI_TEST_WORDING(수 목록)을 차례로 쓴다.
  const testWording = !chromeLocal && Array.isArray(window.__EDI_TEST_WORDING) ? window.__EDI_TEST_WORDING.slice() : null;
  function newWording() {
    if (testWording) return testWording.length ? testWording.shift() >>> 0 : 0;
    try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch (error) { return Math.floor(Math.random() * 4294967296); }
  }
  // 회차마다 따로 고른다(한 회차에서 ‘다른 표현으로’를 눌러도 다른 회차 문구는 그대로, RV7-06).
  function patientWording() { return { 1: newWording(), 2: newWording() }; }
  state.wording = patientWording();

  // 틀 벌 차례: 새 환자마다 다음 벌을 쓴다(A→B→C→A…). 여러 벌을 저장한 때만 이 PC에 다음 차례 숫자 하나를 남긴다(환자 정보 아님).
  const TURN_KEY = 'ediFrameTurn';
  const turnStore = chromeLocal ? {
    load: () => chromeLocal.get(TURN_KEY).then(got => Number(got[TURN_KEY]) || 0),
    save: value => chromeLocal.set({ [TURN_KEY]: value })
  } : (() => {
    // 시험용 단독 HTML: 메모리에만 둔다(window.__EDI_TEST_TURN으로 시작 차례를 넣을 수 있음).
    let memory = Number(window.__EDI_TEST_TURN) || 0;
    return { load: () => Promise.resolve(memory), save: value => { memory = value; return Promise.resolve(); } };
  })();
  let turn = 0;

  let frames = null; // 저장된 틀 {1: [A, B, C], 2: [A, B, C]}(있는 벌만)
  let framesSavedAt = '';
  let framesStatus = 'loading'; // loading | missing | expired | invalid | saved
  let setupOpen = false;
  let draftDirty = false; // 설정 화면의 틀 칸을 고쳤고 아직 저장하지 않음
  let lastCheckSummary = '';

  // 저장값(v1: 회차마다 틀 하나, v2: 회차마다 1~3벌)을 {1: [...], 2: [...]}로 읽는다.
  function recordFrames(record) {
    if (!record || typeof record !== 'object' || !record.frames || (record.v !== 1 && record.v !== 2)) return null;
    const one = Core.frameList(record.frames[1]);
    const two = Core.frameList(record.frames[2]);
    return one.length && two.length ? { 1: one, 2: two } : null;
  }

  // 저장한 지 30일이 지났는지(2026-11-19 사용자: 매달 새로 만들게 하고 30일이 되면 지움).
  function expiredRecord(record) {
    return Boolean(recordFrames(record)) && Core.frameTimeLeft(record.savedAt) <= 0;
  }

  // 저장값을 상태로 옮긴다(화면은 바꾸지 않음). 30일이 지난 틀은 쓰지 않고 지운다.
  function setRecord(record, expiredHint) {
    const expired = expiredRecord(record) || Boolean(expiredHint && !record);
    frames = expired ? null : recordFrames(record);
    framesSavedAt = frames && typeof record.savedAt === 'string' ? record.savedAt : '';
    framesStatus = expired ? 'expired' : !frames ? 'missing' : Core.checkFrameSet(frames[1], 1).ok && Core.checkFrameSet(frames[2], 2).ok ? 'saved' : 'invalid';
    if (expired && record) frameStore.remove().catch(() => {});
  }

  // 패널을 연 채 30일이 지나면(새 환자·복사·패널을 다시 볼 때 확인) 틀을 지우고 설정 화면을 연다.
  function checkExpiry() {
    // ‘문제 있음’ 상태로 남은 저장 틀도 30일이 지나면 지운다(AST-R5-02).
    if ((framesStatus !== 'saved' && framesStatus !== 'invalid') || !framesSavedAt || Core.frameTimeLeft(framesSavedAt) > 0) return false;
    frames = null;
    framesSavedAt = '';
    framesStatus = 'expired';
    // 새 틀을 만들던 중이면(설정 화면에서 고친 초안) 초안은 그대로 두고 지웠다고 알린다(RV7-04).
    if (setupOpen && draftDirty) setFrameStatus('frame-save-status', '저장한 지 30일이 지나 틀을 지웠습니다. 여기서 고치던 틀은 그대로 두었습니다. 다 고친 뒤 ‘틀 저장’을 누르세요.', 'warn');
    else fillDrafts(null);
    setupOpen = true;
    frameStore.remove().catch(() => {});
    afterFramesChanged();
    return true;
  }

  // 지금 차례에 맞춰 회차마다 쓸 벌을 정한다.
  function assignVariants() {
    state.variant = { 1: frames ? turn % frames[1].length : 0, 2: frames ? turn % frames[2].length : 0 };
  }

  function manySets() {
    return Boolean(frames && (frames[1].length > 1 || frames[2].length > 1));
  }

  // 패널을 열면 저장된 차례를 쓰고 그다음 차례를 남긴다(‘새 환자’는 nextPatientTurn).
  async function takeTurn() {
    if (manySets()) {
      try { turn = (await turnStore.load()) >>> 0; } catch (error) { turn = (turn + 1) >>> 0; }
      turnStore.save((turn + 1) >>> 0).catch(() => {});
    }
    assignVariants();
  }

  // 여러 벌일 때만 차례를 센다(틀을 저장하기 전의 ‘새 환자’로 차례가 미리 넘어가지 않게, LIVE05).
  function nextPatientTurn() {
    if (manySets()) {
      turn = (turn + 1) >>> 0;
      turnStore.save((turn + 1) >>> 0).catch(() => {});
    }
    assignVariants();
  }

  // 틀을 새로 저장하면 A부터 쓴다.
  function restartTurn() {
    turn = 0;
    if (manySets()) turnStore.save(1).catch(() => {});
  }

  function applyRecord(record, expiredHint) {
    setRecord(record, expiredHint);
    setupOpen = framesStatus !== 'saved';
    if (setupOpen) fillDrafts(frames);
  }

  // 틀이 바뀌면 이전 틀(또는 예시 틀)로 고친 문구는 쓰지 않는다(RV5-03). 되돌린 회차 수를 돌려준다.
  function dropStaleManual() {
    let dropped = 0;
    for (const cycle of [1, 2]) {
      const m = state.manual[cycle];
      if (m.text !== null && (!frames || !frames[cycle].includes(m.frame))) {
        state.manual[cycle] = { text: null, base: null, frame: null };
        dropped += 1;
      }
    }
    if (dropped) el.manual.value = '';
    return dropped;
  }

  // 틀을 불러오거나 저장·변경한 뒤: 낡은 직접 수정 정리, 버튼 상태·틀 카드·문구를 다시 그린다.
  function afterFramesChanged() {
    const dropped = dropStaleManual();
    assignVariants();
    renderControls();
    renderFrameCard();
    const r = render();
    if (dropped) setStatus('차팅 틀이 바뀌어 직접 고친 문구를 자동 문구로 되돌렸습니다.', 'warn', keyOf(r));
  }

  function compose(s) { return Core.compose(s || state, { frames, requireFrame: true }); }

  function press(button, on) { button.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function manualText() { return state.manual[state.cycle].text; }

  // ---------- 상태 → 입력 칸 (초기화·회차 전환 때) ----------
  function syncInputs() {
    el.paste1.value = state.paste1;
    el.paste2.value = state.paste2;
    el.injuryDate.value = state.injuryDate;
    el.accident.value = state.accident;
    el.purpose.value = state.cycle === 2 ? state.purpose2 : state.purpose1;
    el.firstExamDate.value = state.firstExamDate;
    el.goal.value = state.goal;
    el.nextCustom.value = state.next.custom;
    el.opinion.value = state.opinion;
    el.limitOn.checked = state.limitOn;
    el.manual.value = manualText() === null ? '' : manualText();
    renderControls();
    renderParts(true);
    render();
  }

  // 회차별 표시와 버튼 눌림 상태
  function renderControls() {
    const cycle = state.cycle;
    $$('[data-cycle]').forEach(b => press(b, Number(b.dataset.cycle) === cycle));
    $$('[data-only]').forEach(node => { node.hidden = Number(node.dataset.only) !== cycle; });
    el.paste1Label.textContent = cycle === 2 ? '1차 검사 결과 (이전 1차 검사일)' : '검사 결과';
    el.planTitle.textContent = cycle === 2 ? '치료 후 평가' : '치료계획';
    $$('[data-part]').forEach(b => press(b, state.parts[b.dataset.part].on));
    $$('[data-tx-group]').forEach(b => press(b, !!state[b.dataset.txGroup][b.dataset.tx]));
    $$('[data-judgement]').forEach(b => press(b, state.judgement === b.dataset.judgement));
    $$('[data-continuation]').forEach(b => press(b, state.continuation === b.dataset.continuation));
    const stop = cycle === 2 && state.continuation === 'stop';
    $$('[data-next]').forEach(b => { press(b, state.next.preset === b.dataset.next); b.disabled = stop; });
    el.nextCustom.hidden = state.next.preset !== 'custom';
    el.nextCustom.disabled = stop;
    renderVariantBar();
    const editing = manualText() !== null;
    el.text.hidden = editing;
    el.manual.hidden = !editing;
    el.textEdit.hidden = editing;
    el.textRevert.hidden = !editing;
    // 바꿔 쓸 말이 있는 틀이면 ‘다른 표현으로’(직접 고치는 동안은 숨김).
    const template = framesStatus === 'saved' && frames ? frames[state.cycle][Math.min(state.variant[state.cycle], frames[state.cycle].length - 1)] : '';
    el.textReword.hidden = editing || !template.includes('<<');
    // 직접 수정은 원장님 틀을 저장한 뒤에만(예시 틀 문구를 고쳐 복사하는 길을 막음, RV5-03).
    const locked = framesStatus !== 'saved';
    el.textEdit.disabled = locked;
    $('text-edit-hint').hidden = !locked || editing;
    if (locked) el.textEdit.setAttribute('aria-describedby', 'text-edit-hint'); else el.textEdit.removeAttribute('aria-describedby');
  }

  // 선택한 통증 부위의 좌우·NRS 줄. 선택 목록이 바뀔 때만 다시 만든다(입력 중 포커스 보존).
  function renderParts(force) {
    const keys = Core.PARTS.filter(def => state.parts[def.key].on).map(def => def.key).join(',');
    if (force || el.partRows.dataset.keys !== keys) {
      el.partRows.dataset.keys = keys;
      el.partRows.replaceChildren(...Core.PARTS.filter(def => state.parts[def.key].on).map(buildPartRow));
    }
    for (const row of el.partRows.children) {
      const key = row.dataset.row, p = state.parts[key];
      row.querySelectorAll('[data-side]').forEach(b => press(b, p.side === b.dataset.side));
      const seg = row.querySelector('.seg');
      if (seg) seg.classList.toggle('missing', !Core.SIDES.includes(p.side));
      row.querySelectorAll('[data-nrs]').forEach(b => press(b, p.nrs === Number(b.dataset.nrs)));
      const chosen = Array.isArray(p.points) ? p.points : (Core.POINTS[key] || []);
      row.querySelectorAll('[data-point]').forEach(b => press(b, chosen.includes(b.dataset.point)));
      const extra = row.querySelector('.point-extra');
      if (extra && document.activeElement !== extra) extra.value = p.extra || '';
      const other = row.querySelector('.other-name');
      if (other && document.activeElement !== other) other.value = p.text;
    }
  }

  function buildPartRow(def) {
    const row = document.createElement('div');
    row.className = 'part-row';
    row.dataset.row = def.key;
    const name = document.createElement('div');
    name.className = 'part-name';
    name.textContent = def.name;
    row.append(name);
    if (def.sided) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', def.name + ' 좌우');
      for (const side of Core.SIDES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.side = side;
        b.textContent = side;
        press(b, false);
        seg.append(b);
      }
      row.append(seg);
    } else if (def.custom) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'other-name';
      input.maxLength = 30;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = '예: 좌측 손목';
      input.setAttribute('aria-label', '기타 부위 이름');
      row.append(input);
    } else {
      row.append(document.createElement('span'));
    }
    const nrs = document.createElement('div');
    nrs.className = 'nrs';
    nrs.setAttribute('role', 'group');
    nrs.setAttribute('aria-label', def.name + ' NRS 0~10');
    const label = document.createElement('span');
    label.className = 'nrs-label';
    label.textContent = 'NRS';
    nrs.append(label);
    for (let n = 0; n <= 10; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.nrs = String(n);
      b.textContent = String(n);
      b.setAttribute('aria-label', def.name + ' NRS ' + n);
      press(b, false);
      nrs.append(b);
    }
    row.append(nrs);
    // EDI-17: 혈자리(초기값 선택됨, 클릭으로 빼거나 직접 추가)
    const points = document.createElement('div');
    points.className = 'points';
    points.setAttribute('role', 'group');
    points.setAttribute('aria-label', def.name + ' 혈자리');
    const pointsLabel = document.createElement('span');
    pointsLabel.className = 'nrs-label';
    pointsLabel.textContent = '혈자리';
    points.append(pointsLabel);
    for (const pointName of (Core.POINTS[def.key] || [])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'point';
      b.dataset.point = pointName;
      b.textContent = pointName;
      b.setAttribute('aria-label', def.name + ' 혈자리 ' + pointName);
      press(b, false);
      points.append(b);
    }
    const extra = document.createElement('input');
    extra.type = 'text';
    extra.className = 'point-extra';
    extra.maxLength = 60;
    extra.autocomplete = 'off';
    extra.spellcheck = false;
    extra.placeholder = def.custom ? '혈자리 (예: 양계, 합곡)' : '추가 혈자리 (예: 곡지)';
    extra.setAttribute('aria-label', def.name + ' 혈자리 직접 입력');
    points.append(extra);
    row.append(points);
    return row;
  }

  function renderParsed(list, parsed) {
    if (parsed.empty) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '아직 붙여넣지 않았습니다.';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...parsed.items.map(item => {
      const li = document.createElement('li');
      if (!item.ok) li.className = 'bad';
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = item.label;
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = item.ok ? item.raw : unreadableText(item);
      li.append(k, v);
      return li;
    }));
  }

  // 읽지 못한 값은 원래 글자를 함께 보여 준다(개선 IMP-02). 길면 줄인다.
  function unreadableText(item) {
    if (item.reason === 'duplicate') return '미확인(중복)';
    if (item.raw === null || item.raw === '' || item.raw.startsWith('미확인')) return '미확인';
    // 보이지 않는 서식 문자가 있으면 원문을 그대로 보여 주지 않는다(보이는 모양이 실제 글자와 다를 수 있음, REV-06).
    if (/\p{Cf}/u.test(item.raw)) return '미확인 (특수 문자 포함)';
    const raw = Array.from(item.raw);
    return '미확인 (' + (raw.length > 12 ? raw.slice(0, 12).join('') + '…' : item.raw) + ')';
  }

  function renderPreviewText(text) {
    el.text.replaceChildren(...text.split(HEADER_SPLIT).filter(part => part !== '').map(part => {
      if (!HEADER_ONLY.test(part)) return document.createTextNode(part);
      const b = document.createElement('b');
      b.textContent = part;
      return b;
    }));
  }

  function fillMessages(list, items, idPrefix) {
    list.replaceChildren(...items.map((item, index) => {
      const li = document.createElement('li');
      if (idPrefix) li.id = idPrefix + index;
      li.dataset.code = item.code;
      li.textContent = item.message;
      return li;
    }));
  }

  function fillList(list, messages, idPrefix) {
    list.replaceChildren(...messages.map((message, index) => {
      const li = document.createElement('li');
      if (idPrefix) li.id = idPrefix + index;
      li.textContent = message;
      return li;
    }));
  }

  // 상태 문구는 그 문구·제한 상태·복사 가능 여부가 그대로일 때만 남긴다(개선 IMP-01).
  function keyOf(r) { return r.text + '|' + r.limitOn + '|' + r.canCopy; }

  function setStatus(message, kind, forKey) {
    el.status.textContent = message;
    el.status.className = 'copy-status' + (kind ? ' ' + kind : '');
    statusFor = message ? forKey : null;
  }

  // 회차에 저장된 벌이 둘 이상이면 A·B·C 단추로 이번 환자에게 쓸 벌을 보여 주고 바꿀 수 있게 한다.
  function renderVariantBar() {
    const bar = $('variant-bar');
    const count = framesStatus === 'saved' && frames ? frames[state.cycle].length : 0;
    bar.hidden = count < 2;
    if (count < 2) return;
    if (bar.dataset.count !== String(count)) {
      bar.dataset.count = String(count);
      const label = document.createElement('span');
      label.className = 'variant-label';
      label.textContent = '틀';
      const buttons = Array.from({ length: count }, (_, k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.variant = String(k);
        b.textContent = 'ABC'[k];
        b.setAttribute('aria-label', '틀 ' + 'ABC'[k]);
        return b;
      });
      const hint = document.createElement('span');
      hint.className = 'variant-hint';
      hint.textContent = '환자마다 돌아가며 씀';
      bar.replaceChildren(label, ...buttons, hint);
    }
    const current = Math.min(state.variant[state.cycle], count - 1);
    bar.querySelectorAll('[data-variant]').forEach(b => press(b, Number(b.dataset.variant) === current));
  }

  function badgeText() {
    const many = framesStatus === 'saved' && frames && frames[state.cycle].length > 1;
    const which = many ? ' ' + 'ABC'[Math.min(state.variant[state.cycle], frames[state.cycle].length - 1)] : '';
    if (framesStatus === 'saved') return { text: '원장님 틀' + which + '로 만든 문구' + (manualText() !== null ? ' · 직접 고침' : ''), kind: '' };
    if (framesStatus === 'invalid') return { text: '저장된 차팅 틀에 문제가 있습니다. 위에서 틀을 다시 저장해 주세요.', kind: 'warn' };
    if (framesStatus === 'loading') return { text: '차팅 틀을 불러오는 중입니다.', kind: '' };
    return { text: '예시 틀로 만든 미리보기입니다.', kind: 'warn' };
  }

  // ---------- 상태 → 미리보기 ----------
  function render() {
    const r = compose();
    renderPreviewText(r.text);
    el.count.textContent = r.length + ' / ' + r.limit + '자';
    el.count.classList.toggle('is-over', r.over > 0);
    el.meter.style.width = Math.min(100, (r.length / r.limit) * 100) + '%';
    el.meter.classList.toggle('is-over', r.over > 0);
    el.limitState.textContent = r.limitOn ? '켜짐' : '꺼짐';
    const badge = badgeText();
    el.badge.textContent = badge.text;
    el.badge.className = 'frame-badge' + (badge.kind ? ' ' + badge.kind : '');
    fillMessages(el.blocks, r.blocks, 'block-');
    fillMessages(el.notes, r.notes);
    el.copy.setAttribute('aria-disabled', r.canCopy ? 'false' : 'true');
    // 막힌 이유(보이는 차단 목록의 각 항목)를 복사 버튼의 접근성 설명으로 연결한다(REV-04, 숨긴 중복 문장 없이).
    const reasons = Array.from(el.blocks.children).map(li => li.id).join(' ');
    if (reasons) el.copy.setAttribute('aria-describedby', reasons); else el.copy.removeAttribute('aria-describedby');
    renderParsed(el.parsed1, r.parsed.first);
    if (r.parsed.second) renderParsed(el.parsed2, r.parsed.second);
    if (statusFor !== null && statusFor !== keyOf(r)) setStatus('', '', null);
    return r;
  }

  function update(mutate) {
    mutate();
    renderControls();
    renderParts(false);
    render();
  }

  // ---------- 입력 칸 → 상태 ----------
  const textBindings = [
    ['paste1', v => { state.paste1 = v; }], ['paste2', v => { state.paste2 = v; }],
    ['injuryDate', v => { state.injuryDate = v; }], ['accident', v => { state.accident = v; }],
    ['purpose', v => { if (state.cycle === 2) state.purpose2 = v; else state.purpose1 = v; }],
    ['firstExamDate', v => { state.firstExamDate = v; }], ['goal', v => { state.goal = v; }],
    ['nextCustom', v => { state.next.custom = v; }], ['opinion', v => { state.opinion = v; }]
  ];
  for (const [id, set] of textBindings) {
    const node = $(id);
    const handler = () => update(() => set(node.value));
    node.addEventListener('input', handler);
    node.addEventListener('change', handler);
  }

  document.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.cycle) {
      update(() => { state.cycle = Number(d.cycle) === 2 ? 2 : 1; });
      syncInputs();
    } else if (d.part) {
      update(() => { const p = state.parts[d.part]; p.on = !p.on; });
    } else if (d.side) {
      const key = b.closest('.part-row').dataset.row;
      update(() => { const p = state.parts[key]; p.side = p.side === d.side ? '' : d.side; });
    } else if (d.nrs !== undefined) {
      const key = b.closest('.part-row').dataset.row;
      const n = Number(d.nrs);
      update(() => { const p = state.parts[key]; p.nrs = p.nrs === n ? null : n; });
    } else if (d.point) {
      const key = b.closest('.part-row').dataset.row;
      update(() => {
        const p = state.parts[key];
        const current = Array.isArray(p.points) ? p.points.slice() : (Core.POINTS[key] || []).slice();
        const at = current.indexOf(d.point);
        if (at >= 0) current.splice(at, 1); else current.push(d.point);
        p.points = current;
      });
    } else if (d.txGroup) {
      update(() => { const group = state[d.txGroup]; group[d.tx] = !group[d.tx]; });
    } else if (d.judgement) {
      update(() => { state.judgement = state.judgement === d.judgement ? '' : d.judgement; });
    } else if (d.continuation) {
      update(() => { state.continuation = state.continuation === d.continuation ? '' : d.continuation; });
    } else if (d.next) {
      update(() => { state.next.preset = state.next.preset === d.next ? '' : d.next; });
      if (state.next.preset === 'custom') el.nextCustom.focus();
    } else if (d.variant !== undefined) {
      update(() => { state.variant[state.cycle] = Number(d.variant); });
    } else if (d.tabCycle) {
      switchDraftTab(Number(d.tabCycle), Number(d.tabIndex));
    }
  });

  el.partRows.addEventListener('input', event => {
    const value = event.target.value;
    if (event.target.classList.contains('other-name')) {
      update(() => { state.parts.other.text = value; });
    } else if (event.target.classList.contains('point-extra')) {
      const key = event.target.closest('.part-row').dataset.row;
      update(() => { state.parts[key].extra = value; });
    }
  });

  el.limitOn.addEventListener('change', () => update(() => { state.limitOn = el.limitOn.checked; }));

  // ---------- 최종 문구 직접 수정 (EDI-18: 회차별 최종 문구 전체) ----------
  el.textEdit.addEventListener('click', () => {
    if (framesStatus !== 'saved') return;
    const r = compose();
    update(() => { state.manual[state.cycle] = { text: r.text, base: r.autoText, frame: r.frameText }; });
    el.manual.value = r.text;
    el.manual.focus();
  });
  el.textRevert.addEventListener('click', () => {
    update(() => { state.manual[state.cycle] = { text: null, base: null, frame: null }; });
    el.manual.value = '';
    el.textEdit.focus();
  });
  el.manual.addEventListener('input', () => update(() => { state.manual[state.cycle].text = el.manual.value; }));
  // 칸을 떠나면 복사될 모양(한 문단)으로 맞춰 보여 준다.
  el.manual.addEventListener('change', () => {
    const tidy = Core.free(el.manual.value);
    if (tidy !== el.manual.value && manualText() !== null) {
      el.manual.value = tidy;
      update(() => { state.manual[state.cycle].text = tidy; });
    }
  });

  // ---------- 복사 (EDI-15) ----------
  async function writeClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return 'clipboard';
      } catch (error) { /* 아래 대체 경로 */ }
    }
    const active = document.activeElement;
    try {
      const buffer = document.createElement('textarea');
      buffer.value = text;
      buffer.setAttribute('readonly', '');
      buffer.className = 'copy-buffer';
      document.body.append(buffer);
      buffer.select();
      buffer.setSelectionRange(0, buffer.value.length);
      const ok = document.execCommand('copy');
      buffer.remove();
      if (active && typeof active.focus === 'function') active.focus();
      if (ok) return 'fallback';
    } catch (error) { /* 직접 선택 안내 */ }
    return null;
  }

  function selectPreview() {
    if (manualText() !== null) {
      el.manual.focus();
      el.manual.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el.text);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    el.text.focus();
  }

  el.textReword.addEventListener('click', () => {
    update(() => { state.wording = Object.assign({}, state.wording, { [state.cycle]: newWording() }); });
  });

  el.copy.addEventListener('click', async () => {
    if (checkExpiry()) {
      setStatus('틀을 저장한 지 30일이 지나 지웠습니다. 위에서 새 틀을 만들어 저장한 뒤 복사하세요.', 'error', keyOf(compose()));
      return;
    }
    const r = render();
    if (!r.canCopy) return;
    const text = r.text;
    const seq = ++copySeq;
    setStatus('복사하는 중…', 'pending', keyOf(r));
    const how = await writeClipboard(text);
    if (seq !== copySeq) return;
    const now = compose();
    if (!how) {
      setStatus('복사하지 못했습니다. 위 문구를 직접 선택해 복사하세요.', 'error', keyOf(now));
      selectPreview();
      return;
    }
    if (now.text !== text) {
      setStatus('복사하는 동안 내용이 바뀌었습니다. 다시 복사하세요.', 'warn', keyOf(now));
      return;
    }
    // 복사를 기다리는 동안 제한 설정 등으로 막힘 상태가 되면 성공으로 표시하지 않는다(Astra 검수 AST-01).
    if (!now.canCopy) {
      setStatus('복사는 되었지만 지금 설정에서는 복사할 수 없는 문구입니다. 막힌 이유를 확인한 뒤 붙여넣으세요.', 'warn', keyOf(now));
      return;
    }
    el.copy.dataset.copiedBy = how;
    setStatus('복사했습니다 · ' + now.length + '자' + (now.over > 0 ? '(350자 초과)' : '') + ' · 350자 제한 ' + (now.limitOn ? '켜짐' : '꺼짐'), 'ok', keyOf(now));
  });

  // ---------- 차팅 틀 설정 화면 (EDI-18) ----------
  // AI 요청문: 패널을 열 때마다 문체 조건을 무작위로 정한다. 예시 문구가 없어도 병원마다 다른 틀이 나온다.
  const promptSeed = (() => {
    try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch (error) { return Math.floor(Math.random() * 4294967296); }
  })();
  const promptText = Core.framePrompt({ seed: promptSeed });
  function setFrameStatus(id, message, kind) {
    const node = $(id);
    node.textContent = message;
    node.className = 'frame-status' + (kind ? ' ' + kind : '');
  }

  function when(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderFrameCard() {
    document.body.dataset.frames = framesStatus;
    const saved = framesSavedAt ? when(framesSavedAt) : '';
    const labels = {
      loading: '불러오는 중…',
      missing: '설정 필요 · 저장하기 전에는 복사할 수 없습니다',
      expired: '저장한 지 30일이 지나 틀을 지웠습니다 · 새로 만들어 저장해 주세요',
      invalid: '저장된 틀에 문제가 있어 다시 저장해야 합니다',
      saved: '원장님 틀 사용 중' + (saved ? ' · ' + saved + ' 저장' : '')
    };
    if (framesStatus === 'saved' && frames && (frames[1].length > 1 || frames[2].length > 1)) {
      labels.saved = '원장님 틀 사용 중(1차 ' + frames[1].length + '벌·2차 ' + frames[2].length + '벌)' + (saved ? ' · ' + saved + ' 저장' : '');
    }
    const node = $('frame-state');
    node.textContent = labels[framesStatus];
    node.className = 'frame-state ' + framesStatus;
    // 매달 새로 만들기 안내와 지워지는 날(마지막 7일은 경고).
    const expiry = $('frame-expiry');
    if (framesStatus === 'saved' && framesSavedAt) {
      const left = Core.frameTimeLeft(framesSavedAt);
      const days = Math.max(1, Math.ceil(left / 86400000));
      const end = new Date(Date.parse(framesSavedAt) + Core.FRAME_DAYS * 86400000);
      expiry.textContent = '틀은 매달 새로 만들어 쓰세요. 이 틀은 ' + (end.getMonth() + 1) + '월 ' + end.getDate() + '일에 자동으로 지워집니다(' + days + '일 남음).';
      expiry.className = 'frame-expiry' + (days <= 7 ? ' warn' : '');
      expiry.hidden = false;
    } else if (framesStatus === 'expired') {
      expiry.textContent = '같은 틀을 오래 쓰면 병원 문구가 굳어집니다. 새 AI 요청문으로 틀을 다시 만들어 저장하세요.';
      expiry.className = 'frame-expiry error';
      expiry.hidden = false;
    } else {
      expiry.hidden = true;
    }
    $('frame-setup').hidden = !setupOpen;
    $('frame-edit').hidden = setupOpen || framesStatus === 'loading';
    $('frame-cancel').hidden = !(setupOpen && framesStatus === 'saved');
  }

  // 설정 화면의 틀 초안: 회차마다 A·B·C 세 칸, 한 번에 한 칸을 고친다.
  let drafts = { 1: ['', '', ''], 2: ['', '', ''] };
  let draftTab = { 1: 0, 2: 0 };

  function fillDrafts(source) {
    drafts = { 1: [0, 1, 2].map(k => (source && source[1][k]) || ''), 2: [0, 1, 2].map(k => (source && source[2][k]) || '') };
    draftTab = { 1: 0, 2: 0 };
    $('frame1').value = drafts[1][0];
    $('frame2').value = drafts[2][0];
    draftDirty = false;
    renderDrafts();
  }

  function switchDraftTab(cycle, index) {
    draftTab[cycle] = index;
    $('frame' + cycle).value = drafts[cycle][index];
    renderDrafts();
    $('frame' + cycle).focus();
  }

  // 벌마다 검사하고(회차마다 한 벌 이상, 채운 벌은 모두 통과해야 저장), 고르고 있는 벌의 결과와 가상 환자 미리보기를 보여 준다.
  function renderDrafts() {
    let allOk = true;
    const counts = [];
    for (const cycle of [1, 2]) {
      const other = cycle === 1 ? 2 : 1;
      const tab = draftTab[cycle];
      const results = drafts[cycle].map(text => Core.free(text) ? Core.checkFrame(text, cycle) : null);
      const cycleOk = results.some(r => r !== null) && results.every(r => r === null || r.ok);
      if (!cycleOk) allOk = false;
      document.querySelectorAll('[data-tab-cycle="' + cycle + '"]').forEach(b => {
        const k = Number(b.dataset.tabIndex);
        const r = results[k];
        press(b, k === tab);
        b.dataset.state = r === null ? 'empty' : r.ok ? 'ok' : 'error';
        b.textContent = 'ABC'[k] + (r === null ? '' : r.ok ? ' ✓' : ' !');
        b.setAttribute('aria-label', cycle + '차 틀 ' + 'ABC'[k] + (r === null ? ' (비어 있음)' : r.ok ? ' (저장 가능)' : ' (고칠 항목 ' + r.errors.length + '개)'));
      });
      const draft = drafts[cycle][tab];
      const filled = Core.free(draft) !== '';
      // 화면낭독기에서도 지금 칸이 어느 벌인지 알 수 있게 한다.
      $('frame' + cycle).setAttribute('aria-label', cycle + '차 틀 ' + 'ABC'[tab]);
      const check = results[tab] || Core.checkFrame(draft, cycle);
      const warnings = check.warnings.concat(Core.checkFrameSet(drafts[cycle], cycle).warnings);
      // 미리보기는 고르고 있는 벌로만 만든다(다른 회차 칸이 비어 있으면 예시 틀로 채워 둔다. 그 회차 문구는 쓰지 않음).
      const otherDraft = drafts[other][draftTab[other]] || drafts[other][0];
      const previewFrames = { [cycle]: draft, [other]: Core.free(otherDraft) ? otherDraft : Core.EXAMPLE_FRAMES[other] };
      let preview = '';
      let length = 0;
      if (filled) {
        const r = Core.compose(Core.sampleState(cycle), { frames: previewFrames });
        preview = r.text;
        length = r.length;
        if (length > Core.LIMIT) warnings.push('가상 환자 기준 ' + length + '자로 350자를 넘습니다. 복사는 되지만 EDI 프로그램에서 뒷부분이 잘릴 수 있으니 짧게 줄이면 좋습니다(350자 제한을 켜면 복사가 막힙니다).');
      }
      // 다른 벌에 고칠 항목이 있으면 지금 칸에도 알려 저장이 막힌 이유가 보이게 한다.
      const elsewhere = results.map((r, k) => k !== tab && r && !r.ok ? 'ABC'[k] : '').filter(Boolean);
      const errors = (filled ? check.errors : []).concat(elsewhere.length ? [cycle + '차 틀 ' + elsewhere.join('·') + '에 고칠 항목이 있습니다. 위의 ' + elsewhere.join('·') + ' 단추를 눌러 확인하세요.'] : []);
      fillList($('frame' + cycle + '-errors'), errors, 'frame' + cycle + '-error-');
      fillList($('frame' + cycle + '-warnings'), filled ? warnings : []);
      $('frame' + cycle + '-preview').textContent = filled ? preview : '틀을 넣으면 여기에 미리보기가 보입니다.';
      $('frame' + cycle + '-count').textContent = filled ? length + '자' : '';
      // 값이 빈 가상 환자: [[ ]]가 빠질 때 문장이 어떻게 되는지(RV5-06).
      const sparse = filled ? Core.compose(Core.sampleState(cycle, 'sparse'), { frames: previewFrames }) : null;
      $('frame' + cycle + '-preview-sparse').textContent = sparse ? sparse.text : '';
      $('frame' + cycle + '-count-sparse').textContent = sparse ? sparse.length + '자' : '';
      const filledCount = results.filter(r => r !== null).length;
      const errorCount = results.reduce((sum, r) => sum + (r && !r.ok ? r.errors.length : 0), 0);
      counts.push(cycle + '차 틀: ' + (filledCount === 0 ? '비어 있음' : cycleOk ? '저장 가능' + (filledCount > 1 ? '(' + filledCount + '벌)' : '') : '고칠 항목 ' + errorCount + '개'));
    }
    const save = $('frame-save');
    save.setAttribute('aria-disabled', allOk ? 'false' : 'true');
    // 막힌 이유(보이는 오류 목록)를 저장 버튼 설명으로 연결하고, 요약이 바뀔 때만 화면낭독기에 알린다(RV5-14).
    // 목록(ul)이 아니라 오류 항목(li)을 가리켜야 실제 이유가 읽힌다(REV-04 방식, RV6-01).
    const reasons = Array.from(document.querySelectorAll('#frame1-errors li, #frame2-errors li')).map(li => li.id);
    if (!allOk && reasons.length) save.setAttribute('aria-describedby', reasons.join(' ')); else save.removeAttribute('aria-describedby');
    const summary = counts.join(' · ');
    if (summary !== lastCheckSummary) {
      lastCheckSummary = summary;
      $('frame-check-live').textContent = summary;
    }
    return allOk;
  }

  function fillVars() {
    const cyclesText = v => v.cycles.length === 2 ? '1·2차' : v.cycles[0] + '차';
    const items = Core.FRAME_VARS.filter(v => !(v.measure && v.from)).map(v => {
      const li = document.createElement('li');
      let text = '{' + v.name + '} ' + v.help + ' (' + cyclesText(v) + ')';
      if (v.measure) text += ' · 2차 틀에서는 {1차' + v.name + '} {2차' + v.name + '}';
      li.textContent = text;
      return li;
    });
    $('frame-vars').replaceChildren(...items);
  }

  $('frame-edit').addEventListener('click', () => {
    setupOpen = true;
    fillDrafts(frames);
    $('frame-response').value = '';
    for (const id of ['prompt-status', 'response-status', 'frame-save-status']) setFrameStatus(id, '', '');
    renderFrameCard();
    $('prompt-copy').focus();
  });

  $('frame-cancel').addEventListener('click', () => {
    setupOpen = false;
    renderFrameCard();
    $('frame-edit').focus();
  });

  $('prompt-copy').addEventListener('click', async () => {
    const text = promptText;
    $('prompt-text').value = text;
    setFrameStatus('prompt-status', '복사하는 중…', 'pending');
    const how = await writeClipboard(text);
    if (how) {
      setFrameStatus('prompt-status', '요청문을 복사했습니다. AI 대화창에 붙여넣어 보내세요(평소 쓰신 EDI 문구가 있으면 맨 아래에 붙여도 됩니다).', 'ok');
      return;
    }
    $('prompt-box').open = true;
    $('prompt-text').focus();
    $('prompt-text').select();
    setFrameStatus('prompt-status', '복사하지 못했습니다. ‘요청문 보기’의 내용을 직접 선택해 복사하세요.', 'error');
  });

  $('frame-response').addEventListener('input', () => {
    const value = $('frame-response').value;
    if (Core.free(value) === '') { setFrameStatus('response-status', '', ''); return; }
    const sets = Core.splitFrameSets(value, { examples: Core.exampleFrames(promptSeed) });
    if (!sets) {
      setFrameStatus('response-status', '‘=== 1차 틀 A ===’·‘=== 2차 틀 A ===’ 같은 표시를 찾지 못했습니다. AI에게 요청문의 출력 형식대로 다시 답해 달라고 하거나, 아래 칸에 틀을 직접 붙여넣으세요.', 'error');
      return;
    }
    drafts = { 1: [0, 1, 2].map(k => sets[1][k] || ''), 2: [0, 1, 2].map(k => sets[2][k] || '') };
    draftTab = { 1: 0, 2: 0 };
    $('frame1').value = drafts[1][0];
    $('frame2').value = drafts[2][0];
    draftDirty = true;
    const ok = renderDrafts();
    const count = n => drafts[n].filter(text => Core.free(text)).length;
    const empty = [1, 2].filter(n => !count(n));
    const what = count(1) > 1 || count(2) > 1 ? '1차 ' + count(1) + '벌·2차 ' + count(2) + '벌 틀을' : '1차·2차 틀을';
    if (empty.length) setFrameStatus('response-status', empty.join('·') + '차 틀 내용을 찾지 못했습니다. 표시 아래에 틀 문장이 있는지 확인하거나, 아래 칸에 직접 붙여넣으세요.', 'error');
    else setFrameStatus('response-status', ok ? what + ' 채웠습니다. 미리보기를 확인하고 저장하세요.' : what + ' 채웠습니다. 빨간 항목을 고친 뒤 저장하세요.', ok ? 'ok' : 'warn');
    setFrameStatus('frame-save-status', '', '');
  });

  for (const n of [1, 2]) {
    $('frame' + n).addEventListener('input', () => {
      drafts[n][draftTab[n]] = $('frame' + n).value;
      draftDirty = true;
      renderDrafts();
      setFrameStatus('response-status', '', '');
      setFrameStatus('frame-save-status', '', '');
    });
  }

  $('frame-save').addEventListener('click', async () => {
    if (!renderDrafts()) {
      setFrameStatus('frame-save-status', '저장할 수 없습니다. 빨간 항목을 고쳐 주세요.', 'error');
      return;
    }
    const pack = cycle => drafts[cycle].map(text => Core.free(text)).filter(Boolean);
    const record = { v: 2, frames: { 1: pack(1), 2: pack(2) }, savedAt: new Date().toISOString() };
    // 같은 틀을 다시 저장해도 30일은 처음 저장한 날부터 센다(새로 만들어야 기간이 늘어난다).
    const unchanged = framesStatus === 'saved' && frames && JSON.stringify(record.frames) === JSON.stringify(frames);
    if (unchanged) record.savedAt = framesSavedAt;
    setFrameStatus('frame-save-status', '저장하는 중…', 'pending');
    try {
      await frameStore.save(record);
    } catch (error) {
      setFrameStatus('frame-save-status', '저장하지 못했습니다(' + String(error && error.message || error).slice(0, 60) + ').', 'error');
      return;
    }
    draftDirty = false;
    applyRecord(record);
    if (!unchanged) restartTurn();
    setFrameStatus('frame-save-status', '', '');
    afterFramesChanged();
    $('frame-edit').focus();
  });

  // 다른 창의 패널에서 틀을 저장하면 이 패널에도 반영한다(같은 PC·같은 확장).
  if (chromeLocal && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[FRAME_KEY]) return;
      const record = changes[FRAME_KEY].newValue || null;
      // 다른 창이 30일 지난 틀을 지웠으면 ‘지웠음’으로 보여 준다.
      const expiredHint = !record && expiredRecord(changes[FRAME_KEY].oldValue);
      // 다른 창에서 새 틀을 저장했으면 이 창도 A부터 쓴다(EDI-18u, RV7-05). 같은 틀이면 차례를 그대로 둔다.
      const incoming = recordFrames(record);
      const renewed = Boolean(incoming) && JSON.stringify(incoming) !== JSON.stringify(frames);
      if (setupOpen && draftDirty) {
        // 이 창에서 고치던 틀은 그대로 두고, 저장된 틀만 바꾼다(RV5-13). 지운 경우는 지웠다고 알린다(RV7-04).
        setRecord(record, expiredHint);
        const message = expiredHint || expiredRecord(record)
          ? '저장한 지 30일이 지나 틀을 지웠습니다. 여기서 고치던 틀은 그대로 두었습니다. 다 고친 뒤 ‘틀 저장’을 누르세요.'
          : record
            ? '다른 창에서 틀이 저장되었습니다. 여기서 고치던 틀은 그대로 두었습니다. 이 틀로 바꾸려면 ‘틀 저장’을 누르세요.'
            : '다른 창에서 틀을 지웠습니다. 여기서 고치던 틀은 그대로 두었습니다. 다 고친 뒤 ‘틀 저장’을 누르세요.';
        setFrameStatus('frame-save-status', message, 'warn');
      } else {
        applyRecord(record, expiredHint);
      }
      if (renewed) turn = 0;
      afterFramesChanged();
    });
  }

  // ---------- 새 환자 ----------
  function same(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => same(a[k], b[k]));
  }

  el.reset.addEventListener('click', () => {
    const blank = Core.blankState();
    blank.limitOn = state.limitOn;
    blank.variant = state.variant; // 틀 벌 차례와 바꿔 쓸 말 수는 입력이 아니다
    blank.wording = state.wording;
    if (!same(blank, state) && !window.confirm('입력한 내용을 모두 지우고 새 환자로 시작할까요?')) return;
    state = Core.blankState();
    state.wording = patientWording();
    checkExpiry();
    nextPatientTurn();
    copySeq++;
    setStatus('', '', null);
    syncInputs();
    document.dispatchEvent(new CustomEvent('edi:reset'));
    el.paste1.focus();
  });

  // 확장 사이드 패널(panel.js)이 결과지에서 받은 문구를 붙여넣기 칸에 넣는 입구. 다른 상태는 바꾸지 않는다.
  window.EdiApp = Object.freeze({
    setPaste(n, text) {
      if (n !== 1 && n !== 2) return;
      state['paste' + n] = String(text);
      syncInputs();
    },
    cycle() { return state.cycle; }
  });

  $('prompt-text').value = promptText;
  $('prompt-text').dataset.seed = String(promptSeed);
  fillVars();
  syncInputs();
  renderFrameCard();
  frameStore.load().then(record => applyRecord(record), () => applyRecord(null)).then(takeTurn).then(afterFramesChanged);
  // 패널을 다시 볼 때와 10분마다 30일이 지났는지 확인한다.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkExpiry(); });
  setInterval(checkExpiry, 600000);
}());
