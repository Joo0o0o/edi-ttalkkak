/* 아이밸런스 EDI 차트생성기 — 순수 로직 (브라우저 window.EdiCore · Node require 공용).
 * DOM·네트워크·저장소를 쓰지 않는다. 요구사항 ID는 구현계약.md를 따른다. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EdiCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.3.0';
  const LIMIT = 350;

  const DEFAULTS = Object.freeze({
    accident: '교통사고',
    purpose1: '척추·골반 정렬 및 좌우 균형 확인',
    purpose2: '경과 확인',
    goal: '척추·골반 정렬 교정 및 통증 완화'
  });

  // EDI-06: 해부학 순서. 어깨·무릎만 좌우 필수.
  const PARTS = Object.freeze([
    Object.freeze({ key: 'neck', name: '목', sided: false }),
    Object.freeze({ key: 'shoulder', name: '어깨', sided: true }),
    Object.freeze({ key: 'waist', name: '허리', sided: false }),
    Object.freeze({ key: 'knee', name: '무릎', sided: true }),
    Object.freeze({ key: 'other', name: '기타', sided: false, custom: true })
  ]);
  const SIDES = Object.freeze(['좌측', '우측', '양측']);
  const TREATMENTS = Object.freeze([
    Object.freeze({ key: 'acu', name: '침', local: true }),
    Object.freeze({ key: 'pharm', name: '약침', local: true }),
    Object.freeze({ key: 'moxa', name: '뜸', local: true }),
    Object.freeze({ key: 'chuna', name: '추나', local: false })
  ]);
  const NEXT_PRESETS = Object.freeze(['2주 후', '3주 후', '4주 후']);
  const JUDGEMENTS = Object.freeze(['호전', '유지', '악화']);

  // EDI-03: 값 토큰 형식. 형식이 맞을 때만 사용하고, 토큰 자체는 바꾸지 않는다.
  const VALUE = Object.freeze({
    angle: /^-?\d+(?:\.\d+)?[º°]$/,
    mm: /^\d+(?:\.\d+)?mm$/,
    count: /^\d+개$/,
    cm: /^-?\d+(?:\.\d+)?cm$/,
    ratio: /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/
  });

  const SP = '[ \\t]*';
  const CAP = '(.*?)';
  const lineRe = body => new RegExp('^' + SP + body + SP + '$', 'gm');
  const label = (...words) => words.join(SP) + SP + ':' + SP + CAP;
  const ANGLES_RE = lineRe('어깨' + SP + ':' + SP + CAP + SP + '\\/' + SP + '골반' + SP + ':' + SP + CAP);

  // TEMO 3.3.3.temo 뷰어 복사 형식(2026-11-03 공개 함수 대조 재현) 기준.
  const ITEMS = Object.freeze([
    Object.freeze({ key: 'shoulder_angle', label: '어깨 수평도', kind: 'angle', angleIndex: 1 }),
    Object.freeze({ key: 'pelvis_angle', label: '골반 수평도', kind: 'angle', angleIndex: 2 }),
    Object.freeze({ key: 'contour_interval', label: '등고선 간격', kind: 'mm', re: lineRe(label('등고선', '간격')) }),
    Object.freeze({ key: 'contour_left', label: '좌측 등고선 개수', kind: 'count', re: lineRe('(?:1\\.' + SP + ')?' + label('좌측', '등고선', '개수')) }),
    Object.freeze({ key: 'contour_right', label: '우측 등고선 개수', kind: 'count', re: lineRe('(?:2\\.' + SP + ')?' + label('우측', '등고선', '개수')) }),
    Object.freeze({ key: 'contour_diff', label: '좌우측 등고선 개수 차이', kind: 'count', re: lineRe('(?:3\\.' + SP + ')?' + label('좌우측', '등고선', '개수', '차이')) }),
    Object.freeze({ key: 'shoulder_height_diff', label: '어깨 높이 차이', kind: 'cm', re: lineRe(label('어깨', '높이', '차이')) }),
    Object.freeze({ key: 'shoulder_ratio', label: '어깨 좌우측 길이 비율', kind: 'ratio', re: lineRe(label('어깨', '좌우측', '길이', '비율')) }),
    Object.freeze({ key: 'pelvis_ratio', label: '골반 좌우측 길이 비율', kind: 'ratio', re: lineRe(label('골반', '좌우측', '길이', '비율')) })
  ]);
  const KEYS = ITEMS.map(item => item.key);

  function codePoints(text) { return Array.from(String(text)).length; }

  // 붙여넣기 정리: 보이는 글자를 바꾸지 않는 폭 없는 문자(ZWSP·ZWNJ·ZWJ·WJ·BOM)만 지우고 줄바꿈 형식을 맞춘다.
  // 방향 제어·보이는 서식 문자는 지우지 않는다: 화면에 보이는 값과 다른 값을 읽지 않도록 그 값은 미확인으로 남긴다(독립 재검수 REV-06).
  // 특수 문자는 소스에 직접 쓰지 않고 코드값으로 만든다: 0x85 NEL, 0x2028/0x2029 줄·문단 구분 문자.
  const ZERO_WIDTH = new RegExp('[' + String.fromCharCode(0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF) + ']', 'g');
  const LINE_BREAKS = new RegExp('[' + String.fromCharCode(0x85, 0x2028, 0x2029) + ']', 'g');
  function cleanPaste(text) {
    return String(text == null ? '' : text)
      .replace(ZERO_WIDTH, '')
      .replace(/\r\n?/g, '\n')
      .replace(LINE_BREAKS, '\n')
      .replace(/[^\S\n]/g, ' ');
  }

  // EDI-11: 직접 입력 문장은 한 문단으로. \s 는 탭·줄바꿈·VT·FF·NBSP·EM SPACE·줄/문단 구분 문자·전각 공백을 포함하고
  // NEL(0x85)은 따로 넣는다. 폭 없는 공백·방향 표시·BOM 같은 서식 문자(\p{Cf})는 지운다(독립 검수 REV-01·02).
  function free(text) {
    return String(text == null ? '' : text)
      .replace(/\p{Cf}/gu, '')
      .replace(/[\s\x85]+/g, ' ')
      .trim();
  }

  // 짧은 입력 칸은 끝 마침표·쉼표만 정리하고 나머지 글자는 그대로 쓴다.
  function clip(text) { return free(text).replace(/[.,\s]+$/, ''); }


  function parseMoire(text) {
    const src = cleanPaste(text);
    const empty = src.trim() === '';
    const angles = [...src.matchAll(ANGLES_RE)];
    const items = ITEMS.map(item => {
      const values = item.angleIndex ? angles.map(m => m[item.angleIndex]) : [...src.matchAll(item.re)].map(m => m[1]);
      if (values.length === 0) return { key: item.key, label: item.label, raw: null, ok: false, reason: 'missing' };
      if (values.length > 1) return { key: item.key, label: item.label, raw: values[0], ok: false, reason: 'duplicate' };
      const raw = values[0];
      const ok = VALUE[item.kind].test(raw);
      return { key: item.key, label: item.label, raw, ok, reason: ok ? null : 'invalid' };
    });
    const problems = items.filter(item => !item.ok);
    const values = {};
    for (const item of items) values[item.key] = item.ok ? item.raw : null;
    return { empty, items, values, ok: !empty && problems.length === 0, problems: problems.length };
  }

  function blankTx() { return { acu: false, pharm: false, moxa: false, chuna: false }; }
  // 회차별 직접 수정: 고친 문구, 그때의 자동 문구(base), 그때의 차팅 틀(frame).
  function blankManual() { return { text: null, base: null, frame: null }; }

  function blankState() {
    return {
      cycle: 1,
      paste1: '',
      paste2: '',
      injuryDate: '',
      accident: DEFAULTS.accident,
      purpose1: DEFAULTS.purpose1,
      purpose2: DEFAULTS.purpose2,
      parts: {
        neck: { on: false, nrs: null, points: null, extra: '' },
        shoulder: { on: false, side: '', nrs: null, points: null, extra: '' },
        waist: { on: false, nrs: null, points: null, extra: '' },
        knee: { on: false, side: '', nrs: null, points: null, extra: '' },
        other: { on: false, text: '', nrs: null, extra: '' }
      },
      firstExamDate: '',
      priorTx: blankTx(),
      planTx: blankTx(),
      goal: DEFAULTS.goal,
      next: { preset: '', custom: '' },
      opinion: '',
      judgement: '',
      continuation: '',
      manual: { 1: blankManual(), 2: blankManual() },
      variant: { 1: 0, 2: 0 }, // 회차별로 쓸 틀 벌(A=0, B=1, C=2). 패널이 환자마다 돌려 정한다
      wording: { 1: 0, 2: 0 }, // 바꿔 쓸 말을 고르는 수(회차별). 패널이 환자마다 새로 정한다(저장하지 않음, RV7-06)
      limitOn: false // 350자 제한: 기본 꺼짐(넘어도 경고만, 2026-11-19 사용자 결정). 켜면 넘을 때 복사를 막는다
    };
  }

  // 누락 필드를 기본값으로 채운 사본을 만든다(입력 객체는 바꾸지 않는다).
  function normalizeState(input) {
    const base = blankState();
    const s = input || {};
    const out = Object.assign({}, base, s);
    out.cycle = s.cycle === 2 ? 2 : 1;
    out.parts = {};
    for (const def of PARTS) out.parts[def.key] = Object.assign({}, base.parts[def.key], (s.parts || {})[def.key] || {});
    out.priorTx = Object.assign(blankTx(), s.priorTx || {});
    out.planTx = Object.assign(blankTx(), s.planTx || {});
    out.next = Object.assign({ preset: '', custom: '' }, s.next || {});
    const manual = s.manual || {};
    out.manual = { 1: Object.assign(blankManual(), manual[1] || {}), 2: Object.assign(blankManual(), manual[2] || {}) };
    out.limitOn = s.limitOn === true;
    const variant = s.variant || {};
    out.variant = { 1: Math.max(0, Math.floor(Number(variant[1]) || 0)), 2: Math.max(0, Math.floor(Number(variant[2]) || 0)) };
    // 수 하나(예전 형식)면 두 회차에 같이 쓴다.
    const wording = s.wording;
    out.wording = wording && typeof wording === 'object'
      ? { 1: Number(wording[1]) >>> 0, 2: Number(wording[2]) >>> 0 }
      : { 1: Number(wording) >>> 0, 2: Number(wording) >>> 0 };
    return out;
  }

  function validNrs(value) { return Number.isInteger(value) && value >= 0 && value <= 10; }

  // EDI-17: 부위별 혈자리 초기값. 자보 환자관리 시안 R12 표(원장님 제공 예시 + 한의표준임상진료지침 참고 구성)를 쓴다.
  // 화면 초기값일 뿐 처방이 아니다. 원장님이 실제 시술한 혈자리만 남기고, 필요하면 직접 추가한다.
  const POINTS = Object.freeze({
    neck: Object.freeze(['견외수', '대추', '풍지', '견정(GB21)']),
    shoulder: Object.freeze(['견우', '견료', '천종', '견정(GB21)']),
    waist: Object.freeze(['신수', '대장수', '협척혈']),
    knee: Object.freeze(['내슬안', '독비', '족삼리', '혈해'])
  });

  // 선택한 기본 혈자리(표 순서) + 직접 추가한 혈자리(쉼표·가운뎃점·빗금으로 구분), 중복 없이.
  function partPoints(def, p) {
    const defaults = POINTS[def.key] || [];
    const chosen = Array.isArray(p.points) ? defaults.filter(name => p.points.includes(name)) : defaults.slice();
    const extra = free(p.extra).split(/[,，·、/]+/).map(name => clip(name)).filter(Boolean);
    const out = [];
    for (const name of chosen.concat(extra)) if (!out.includes(name)) out.push(name);
    return out;
  }

  function partsInfo(st) {
    const selected = PARTS.filter(def => st.parts[def.key].on).map(def => {
      const p = st.parts[def.key];
      let text;
      if (def.custom) text = clip(p.text);
      else text = def.sided && SIDES.includes(p.side) ? p.side + ' ' + def.name : def.name;
      return { def, p, text, points: partPoints(def, p) };
    });
    const named = selected.filter(x => x.text !== '');
    const partsStr = named.map(x => x.text).join('·');
    // 치료 문장용: 부위별 한 묶음 — 목(견외수·대추)·우측 어깨(견우) (사용자 결정 2026-11-18)
    const pointsStr = named.map(x => x.points.length ? x.text + '(' + x.points.join('·') + ')' : x.text).join('·');
    const scored = named.filter(x => validNrs(x.p.nrs));
    let nrsStr = '';
    if (scored.length) nrsStr = 'NRS ' + (named.length === 1 ? String(scored[0].p.nrs) : scored.map(x => x.text + ' ' + x.p.nrs).join(', '));
    return { selected, named, partsStr, pointsStr, nrsStr };
  }

  // EDI-09/10: 침·약침·뜸은 부위와 연결, 추나는 부위 없음.
  function txPhrase(tx, partsStr) {
    const t = tx || {};
    const local = TREATMENTS.filter(x => x.local && t[x.key]).map(x => x.name);
    if (!local.length && !t.chuna) return '';
    let s = local.length ? (partsStr ? partsStr + ' 부위 ' : '') + local.join(', ') : '';
    if (t.chuna) s += (s ? ' 및 ' : '') + '추나';
    return s + ' 치료';
  }

  function anyTx(tx) { return TREATMENTS.some(x => tx && tx[x.key]); }

  function nextText(next) {
    if (!next) return '';
    if (next.preset === 'custom') return clip(next.custom);
    return NEXT_PRESETS.includes(next.preset) ? next.preset : '';
  }

  function show(value) { return value === null || value === undefined ? '미확인' : value; }

  // 2차 판독 비교 한 줄(틀 변수 {수치비교}). 끝 마침표는 틀이 붙인다.
  // marks: 줄 안에서 결과지 수치가 놓인 자리(직접 수정 대조에 씀, 독립 검수 RV5-01).
  function compareLine(a, b) {
    const segments = [];
    const lit = s => segments.push(s);
    const val = v => segments.push({ v });
    const both = (x, y) => { val(x); lit('→'); val(y); };
    lit('1차→2차 어깨수평 '); both(a.shoulder_angle, b.shoulder_angle);
    lit(', 골반수평 '); both(a.pelvis_angle, b.pelvis_angle);
    lit(', 등고선(');
    if (a.contour_interval !== null && a.contour_interval === b.contour_interval) val(a.contour_interval);
    else both(a.contour_interval, b.contour_interval);
    lit(') 좌 '); both(a.contour_left, b.contour_left);
    lit('·우 '); both(a.contour_right, b.contour_right);
    lit('·차 '); both(a.contour_diff, b.contour_diff);
    lit(', 어깨높이차 '); both(a.shoulder_height_diff, b.shoulder_height_diff);
    lit(', 길이비 어깨 '); both(a.shoulder_ratio, b.shoulder_ratio);
    lit('·골반 '); both(a.pelvis_ratio, b.pelvis_ratio);
    let text = '';
    const marks = [];
    for (const s of segments) {
      if (typeof s === 'string') { text += s; continue; }
      if (s.v !== null && s.v !== undefined) marks.push({ offset: text.length, token: s.v });
      text += show(s.v);
    }
    return { text, marks };
  }

  // ---------- 원장님별 차팅 틀 (EDI-18, 2026-11-19 사용자 결정) ----------
  // 원장님 AI가 원장님 문체로 만든 문장에 값 자리만 {변수}로 표시한 틀. [[ … ]] 안의 변수가 비면 그 부분 전체가 빠진다.
  // 모든 병원이 같은 문장을 쓰지 않도록 틀은 처음 한 번 꼭 저장해야 복사할 수 있다(앱이 requireFrame으로 막음).
  const MEASURES = Object.freeze([
    ['어깨수평', 'shoulder_angle'], ['골반수평', 'pelvis_angle'], ['등고선간격', 'contour_interval'],
    ['좌측등고선', 'contour_left'], ['우측등고선', 'contour_right'], ['등고선차이', 'contour_diff'],
    ['어깨높이차', 'shoulder_height_diff'], ['어깨길이비', 'shoulder_ratio'], ['골반길이비', 'pelvis_ratio']
  ]);
  const FRAME_VARS = Object.freeze([
    { name: '수상일', cycles: [1, 2], help: '수상일(비어 있으면 빠짐)' },
    { name: '사고내용', cycles: [1, 2], help: '사고 내용(예: 교통사고)' },
    { name: '부위', cycles: [1, 2], help: '통증 부위(예: 목·우측 어깨)' },
    { name: 'NRS', cycles: [1, 2], help: '통증 점수(예: NRS 목 6, 우측 어깨 5 / 부위가 하나면 NRS 6)' },
    { name: '확인목적', cycles: [1, 2], help: '이번 검사로 확인하려는 것' },
    { name: '치료목표', cycles: [1, 2], help: '치료 목표' },
    { name: '다음평가', cycles: [1, 2], help: '다음 평가 시점(예: 4주 후)' },
    { name: '치료', cycles: [1], help: '1차 치료계획(예: 목(풍지·대추) 부위 침, 약침, 뜸 및 추나 치료)' }
  ].concat(
    MEASURES.map(([name, key]) => ({ name, cycles: [1], measure: key, help: '1차 결과지 수치' })),
    [
      { name: '1차검사일', cycles: [2], help: '1차 검사일(비어 있으면 빠짐)' },
      { name: '1차이후치료', cycles: [2], help: '1차 이후 받은 치료(예: 목(풍지) 부위 침, 뜸 치료)' },
      { name: '수치비교', cycles: [2], compare: true, help: '1차→2차 수치 9개를 나란히 쓴 한 줄' }
    ],
    MEASURES.map(([name, key]) => ({ name: '1차' + name, cycles: [2], measure: key, from: 1, help: '1차 결과지 수치' })),
    MEASURES.map(([name, key]) => ({ name: '2차' + name, cycles: [2], measure: key, from: 2, help: '2차 결과지 수치' })),
    [
      { name: '소견', cycles: [2], help: '원장님이 쓴 판독 소견' },
      { name: '판정', cycles: [2], help: '호전·유지·악화' },
      { name: '치료여부', cycles: [2], help: '치료 지속 또는 치료 종료' }
    ]
  ).map(Object.freeze));

  // 예시 틀: 이전 고정 문장과 같은 결과를 낸다. AI 요청문에 형식 예시로만 넣고, 이 틀 그대로는 저장할 수 없다.
  const EXAMPLE_FRAMES = Object.freeze({
    1: '[검사시행 사유] [[{수상일} ]][[{사고내용} ]]수상 후 4주 이상 경과에도 [[{부위} ]]통증 지속[[({NRS})]]하여 [[{확인목적} 위해 ]]1차 검사 시행. [환자평가·판독결과] 어깨수평 {어깨수평}, 골반수평 {골반수평}, 등고선({등고선간격}) 좌 {좌측등고선}·우 {우측등고선}·차 {등고선차이}, 어깨높이차 {어깨높이차}, 길이비 어깨 {어깨길이비}·골반 {골반길이비}. [치료계획] [[{치료}로 ]][[{치료목표} 목표, ]][[{다음평가} 재평가]].',
    2: '[검사시행 사유] [[{수상일} ]][[{사고내용} ]]수상 후 4주 이상 경과에도 [[{부위} ]]통증 지속[[({NRS})]]하여 1차 검사[[({1차검사일})]] 후 [[{1차이후치료} ]][[{확인목적} 위해 ]]2차 검사 시행. [환자평가·판독결과] {수치비교}.[[ 소견: {소견}.]] [치료 후 평가] [[{판정}. ]][[{치료목표} 위해 ]][[{치료여부}]][[, {다음평가} 재평가]].'
  });

  const VAR_RE = /\{([^{}\s]+)\}/g;
  const OPTIONAL_RE = /\[\[([\s\S]*?)\]\]/g;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  // 바꿔 쓸 말: <<그리고|또한|아울러>>. 환자마다 정한 수(wording)로 후보 하나를 골라 쓴다(2026-11-19 사용자: 부사·접속사·조사가
  // 환자마다 다르게). 후보에는 숫자·부호·변수·[[ ]]를 넣을 수 없어 결과지 수치와 수치 대조에 영향을 주지 않는다.
  const CHOICE_RE = /<<([^<>]*)>>/g;
  const CHOICE_MAX = 20; // 틀 하나의 묶음 수
  const OPTIONS_MAX = 4; // 묶음 하나의 후보 수
  const OPTION_LENGTH = 16; // 후보 하나의 글자 수
  // 같은 틀과 같은 수면 같은 문장이다(같은 환자는 입력을 바꿔도 표현이 그대로).
  function wordFrame(frame, seed) {
    const text = String(frame == null ? '' : frame);
    if (!text.includes('<<')) return text;
    const next = seededRandom(Number.isFinite(seed) ? seed : 0);
    return text.replace(CHOICE_RE, (whole, inner) => {
      const options = inner.split('|');
      return options[Math.floor(next() * options.length)];
    });
  }
  // 묶음마다 k번째 후보(후보가 모자라면 마지막)를 쓴 틀. 검사에서 모든 후보가 한 번 이상 들어가게 펼칠 때 쓴다.
  function nthWording(text, k) {
    return text.replace(CHOICE_RE, (whole, inner) => {
      const options = inner.split('|');
      return options[Math.min(k, options.length - 1)];
    });
  }

  // 틀을 채운 뒤 생기는 빈 괄호·겹친 마침표/쉼표·남는 쉼표·띄어쓰기를 정리한다.
  // renderFrame은 값 자리를 표시 글자로 바꿔 둔 틀 글자에만 이 정리를 적용한다. 원장님 입력·결과지 수치는 그대로다(RV5-11).
  function tidy(text) {
    let t = free(text);
    t = t.replace(/\(\s*\)/g, '');
    t = t.replace(/\.(?:\s+\.)+/g, '.');
    t = t.replace(/(^|[^.])\.\.(?!\.)/g, '$1.');
    t = t.replace(/,(?:\s*,)+/g, ',');
    t = t.replace(/([.:])\s*,\s*/g, '$1 ');
    t = t.replace(/,\s*(?=[.)]|$)/g, '');
    t = t.replace(/\s+([.,)])/g, '$1');
    // 내용이 빠진 머리말 뒤 구두점: “[치료계획] .” 처럼 다음 머리말이나 끝이 바로 올 때만 지운다.
    t = t.replace(/(\])\s*[.,](?=\s*(?:\[|$))/g, '$1');
    return t.replace(/ {2,}/g, ' ').trim();
  }

  // 틀의 연결어가 입력 끝말과 겹치면 틀 쪽 연결어를 뺀다. 입력 글자는 지우지 않는다(독립 검수 REV-05·08을 틀 방식으로 옮김).
  // 예: 입력 “기능 회복을 목표로” + 틀 “{치료목표} 목표,” → “기능 회복을 목표로,”
  const CONNECTORS = Object.freeze([
    [['수상'], /수상$/],
    [['위해', '위해서', '위하여', '하고자'], /(?:위해|위해서|위하여|위함|하고자|목표로|목표로 함)$/],
    [['목표', '목표로'], /(?:목표|목표로|목표로 함|목표로 한다|위해|위해서|위하여|위함)$/],
    [['재평가'], /재평가(?:\s*예정)?$/]
  ]);
  const CONNECTOR_WORDS = Object.freeze(CONNECTORS.flatMap(([words]) => words));
  function absorbs(value, word) {
    const v = free(value);
    if (v.split(' ').pop() === word) return true;
    return CONNECTORS.some(([words, end]) => words.includes(word) && end.test(v));
  }

  // 변수 바로 뒤에 붙은 조사는 값의 받침에 맞춘다: 낙상+로 → 낙상으로, 정렬 교정+를 → 정렬 교정을(RV5-10).
  const PARTICLE_PAIRS = Object.freeze({ 을: ['을', '를'], 를: ['을', '를'], 이: ['이', '가'], 가: ['이', '가'], 은: ['은', '는'], 는: ['은', '는'], 과: ['과', '와'], 와: ['과', '와'] });
  // 숫자를 읽을 때의 받침: 영·일·이·삼·사·오·육·칠·팔·구
  const DIGIT_SOUND = Object.freeze(['other', 'rieul', 'none', 'other', 'none', 'none', 'other', 'rieul', 'rieul', 'none']);
  const CLOSERS = Object.freeze({ ')': '(', ']': '[', '）': '（', '】': '【' });
  function finalSound(value) {
    let s = String(value).replace(/[\s"'”’」』>}]+$/u, '');
    // 괄호로 끝나면 괄호 앞말에 맞춘다: 교통사고(낙상)로, 견정(GB21)을(RV6-05).
    while (s && CLOSERS[s[s.length - 1]]) {
      const close = s[s.length - 1];
      const open = CLOSERS[close];
      let depth = 0;
      let i = s.length - 1;
      for (; i >= 0; i -= 1) {
        if (s[i] === close) depth += 1;
        else if (s[i] === open && --depth === 0) break;
      }
      s = i > 0 ? s.slice(0, i).replace(/\s+$/, '') : s.slice(0, -1);
    }
    const chars = Array.from(s);
    const last = chars[chars.length - 1];
    if (!last) return null;
    const code = last.codePointAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const jong = (code - 0xAC00) % 28;
      return jong === 0 ? 'none' : jong === 8 ? 'rieul' : 'other';
    }
    if (/[0-9]/.test(last)) return DIGIT_SOUND[Number(last)];
    return null;
  }
  function particleFor(value, particle) {
    const sound = finalSound(value);
    if (sound === null) return particle;
    const ro = particle.match(/^으?로(.*)$/);
    if (ro) return (sound === 'other' ? '으로' : '로') + ro[1];
    const pair = PARTICLE_PAIRS[particle];
    return sound === 'none' ? pair[1] : pair[0];
  }
  const PARTICLE = '(?:으로부터|로부터|으로서|로서|으로써|로써|으로|을|를|이|가|은|는|와|과|로)';
  const JOIN_WORD_RE = new RegExp('^(' + PARTICLE + '?)(\\s+)([가-힣]+)(?=$|[\\s.,)])');
  const JOIN_PARTICLE_RE = new RegExp('^(' + PARTICLE + ')(?=$|[\\s.,)\\]:;!?·])');

  // 값 바로 뒤 틀 글자를 다듬는다: 겹치는 연결어는 틀 쪽을 빼고, 붙은 조사는 받침에 맞춘다.
  function joinAfter(value, next) {
    const word = next.match(JOIN_WORD_RE);
    if (word && absorbs(value, word[3])) {
      // 입력 끝말이 틀 연결어의 앞부분이면 남는 부분만 붙인다: “단기 목표” + “를 목표로” → “단기 목표로”.
      const v = free(value);
      const base = CONNECTOR_WORDS.filter(w => w !== word[3] && word[3].startsWith(w) && v.endsWith(w)).sort((a, b) => b.length - a.length)[0];
      if (base) return word[3].slice(base.length) + next.slice(word[0].length);
      return word[2] + next.slice(word[0].length);
    }
    const particle = next.match(JOIN_PARTICLE_RE);
    if (particle) return particleFor(value, particle[1]) + next.slice(particle[1].length);
    return next;
  }

  // 값 자리 표시 글자(사용자 영역 문자). 틀 글자에 섞인 같은 범위 문자는 지운다.
  const SLOT_BASE = 0xE000;
  const SLOT_RE = new RegExp('[' + String.fromCharCode(0xE000) + '-' + String.fromCharCode(0xF8FF) + ']', 'g');

  // 틀을 채운다. 반환: text(완성 문구), spans(결과지 수치가 들어간 자리 {index, token, name}).
  // 값은 표시 글자로 바꿔 둔 채 틀 글자만 정리(tidy)한 뒤 마지막에 그대로 넣는다.
  function renderTracked(frame, values, marks) {
    const flat = String(frame == null ? '' : frame).replace(OPTIONAL_RE, (whole, inner) => {
      const names = Array.from(inner.matchAll(VAR_RE), m => m[1]);
      return names.some(name => !own(values, name) || !values[name]) ? '' : inner;
    });
    const pieces = flat.split(VAR_RE); // 글자, 변수 이름, 글자, 변수 이름, … 순서
    const slots = [];
    let skeleton = pieces[0].replace(SLOT_RE, '');
    for (let i = 1; i < pieces.length; i += 2) {
      const name = pieces[i];
      const value = own(values, name) && values[name] != null ? String(values[name]) : '';
      let next = pieces[i + 1].replace(SLOT_RE, '');
      if (value) {
        next = joinAfter(value, next);
        skeleton += String.fromCharCode(SLOT_BASE + slots.length);
        slots.push({ name, value });
      }
      skeleton += next;
    }
    let text = '';
    const spans = [];
    for (const ch of tidy(skeleton)) {
      const slot = ch.length === 1 ? slots[ch.charCodeAt(0) - SLOT_BASE] : undefined;
      if (!slot) { text += ch; continue; }
      for (const mark of (marks && marks[slot.name]) || []) spans.push({ index: text.length + mark.offset, token: mark.token, name: slot.name });
      text += slot.value;
    }
    return { text, spans };
  }

  function renderFrame(frame, values, marks) { return renderTracked(frame, values, marks).text; }

  // 틀 변수의 값과, 결과지 수치가 값 안의 어디에 있는지(marks).
  function frameValues(st, info, first, second) {
    const cycle = st.cycle;
    const v = {
      수상일: free(st.injuryDate), 사고내용: clip(st.accident), 부위: info.partsStr, NRS: info.nrsStr,
      확인목적: clip(cycle === 2 ? st.purpose2 : st.purpose1), 치료목표: clip(st.goal), 다음평가: nextText(st.next)
    };
    const marks = {};
    const measure = (name, raw) => {
      v[name] = show(raw);
      if (raw !== null && raw !== undefined) marks[name] = [{ offset: 0, token: raw }];
    };
    if (cycle === 1) {
      v.치료 = txPhrase(st.planTx, info.pointsStr);
      for (const [name, key] of MEASURES) measure(name, first.values[key]);
    } else {
      v['1차검사일'] = free(st.firstExamDate);
      v['1차이후치료'] = txPhrase(st.priorTx, info.pointsStr);
      const line = compareLine(first.values, second.values);
      v.수치비교 = line.text;
      marks.수치비교 = line.marks;
      for (const [name, key] of MEASURES) {
        measure('1차' + name, first.values[key]);
        measure('2차' + name, second.values[key]);
      }
      v.소견 = clip(st.opinion);
      v.판정 = JUDGEMENTS.includes(st.judgement) ? st.judgement : '';
      v.치료여부 = st.continuation === 'continue' ? '치료 지속' : st.continuation === 'stop' ? '치료 종료' : '';
      if (st.continuation !== 'continue') v.치료목표 = '';
      if (st.continuation === 'stop') v.다음평가 = '';
    }
    return { values: v, marks };
  }

  // 틀에 숫자로 적힌 결과지 수치(전각 숫자·㎜·㎝·“도” 포함).
  // ‘N개’는 기본으로 수치로 보고, 분명히 다른 뜻인 표현(N개소·N개월·N개 이상/이하/미만/부위/혈/항목/씩, 부위·혈자리·치료 N개)만 허용한다(AST-03).
  const MEASURE_HINT = [
    /-?\p{Nd}+(?:\.\p{Nd}+)?\s*(?:[º°]|도(?![가-힣]))/u,
    /\p{Nd}+(?:\.\p{Nd}+)?\s*(?:cm|㎝)/iu,
    /\p{Nd}+(?:\.\p{Nd}+)?\s*(?:mm|㎜)/iu,
    /(?<!\p{Nd}|\p{Nd}\.)(?<!(?:부위|혈자리|혈|치료|항목)\s*)\p{Nd}+\s*개(?!\s*(?:소|월|이상|이하|미만|부위|혈|항목|씩))/u
  ];
  // 비율은 모두 수치로 본다(“2:1” 포함). 단, “1:1 비교·대비”만 허용한다(AST-03, RV5-09 오탐).
  function ratioLiteral(literal) {
    // 앞뒤로 숫자(또는 “.숫자”)가 이어지지 않는 비율. 문장 끝 마침표는 괜찮다.
    for (const m of literal.matchAll(/(?<!\p{Nd}|\p{Nd}\.)\p{Nd}+(?:\.\p{Nd}+)?\s*:\s*\p{Nd}+(?:\.\p{Nd}+)?(?!\p{Nd}|\.\p{Nd})/gu)) {
      if (/^1\s*:\s*1$/.test(m[0]) && /^\s*(?:비교|대비)/.test(literal.slice(m.index + m[0].length))) continue;
      return m[0];
    }
    return null;
  }
  // 특정 환자의 사실(날짜·통증 점수)을 틀에 적은 경우(RV5-09).
  const PATIENT_HINT = [
    [/\p{Nd}{4}\s*[-./년]\s*\p{Nd}{1,2}\s*[-./월]\s*\p{Nd}{1,2}|\p{Nd}{1,2}\s*월\s*\p{Nd}{1,2}\s*일/u, '특정 날짜가 적혀 있습니다', '날짜는 {수상일}·{1차검사일}로만 씁니다'],
    // 척도 설명(“NRS 0~10”, “VAS 10점 만점”)은 허용한다(RV6-03).
    [/(?:NRS|VAS)\s*[:(]?\s*\p{Nd}{1,2}(?!\s*(?:[~\-–]|점\s*(?:만점|척도))|\p{Nd})/iu, '통증 점수가 숫자로 적혀 있습니다', '통증 점수는 {NRS}로만 씁니다']
  ];
  // AI 답의 서식·설명 기호가 틀에 섞인 경우(RV5-04). ※는 원장님 문체일 수 있어 허용한다(RV6-03).
  const ARTIFACT_RE = /\*\*|__|##|```|===|^\s*[-*>]\s/m;
  // AI 답의 인사·안내 문장(RV6-02).
  const CLOSING_RE = /말씀해\s*주세요|필요하시면|원하시면|도움이\s*되|다듬어\s*드리|수정해\s*드리|드리겠습니다|드릴게요|참고하세요|사용하시면\s*됩니다/;

  // 예시 틀과 얼마나 같은지(0~1). 변수·머리말·문장부호·띄어쓰기를 뺀 본문 글자의 두 글자 묶음 겹침 비율이다.
  // 머리말이나 문장부호만 바꾼 틀은 같은 문구로 본다(RV5-07). 병원마다 문구가 같아지는 것을 막는 기준.
  function bodyText(text) {
    return String(text)
      .replace(CHOICE_RE, (whole, inner) => inner.split('|')[0])
      .replace(VAR_RE, ' ')
      .replace(/\[\[|\]\]/g, ' ')
      .replace(/\[[^[\]]{1,20}\]/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }
  function bigrams(text) {
    const s = bodyText(text);
    const out = new Map();
    for (let i = 0; i < s.length - 1; i += 1) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
    return out;
  }
  function similarity(a, b) {
    const x = bigrams(a);
    const y = bigrams(b);
    let both = 0;
    let total = 0;
    for (const [g, n] of x) { both += Math.min(n, y.get(g) || 0); total += n; }
    for (const n of y.values()) total += n;
    return total ? (2 * both) / total : 1;
  }
  // 본문 기준: 머리말·문장부호만 바꾼 예시는 100%, 구절 하나만 바꾼 예시는 약 96%, 두 구절은 약 79%.
  // 원장님 문체로 만든 합성 틀(DOCTOR_A·B)은 24~42%다(2026-11-19 측정).
  const SAME_LIMIT = 0.75;
  const NEAR_LIMIT = 0.55;
  // 심평원 기재 항목이 틀에 드러나는지(경고만). 표기는 원장님마다 다를 수 있다.
  const SECTION_WORDS = Object.freeze({ 1: ['사유', '판독', '계획'], 2: ['사유', '판독', '평가'] });

  const MEASURE_VARS = new Set(FRAME_VARS.filter(v => v.measure || v.compare).map(v => v.name));
  // 통증 점수·소견·판정은 다른 변수와 같은 [[ ]]에 넣으면 그 변수가 빌 때 함께 빠진다(RV5-08).
  const ALONE_VARS = Object.freeze(['NRS', '소견', '판정']);

  // [[ ]]가 차례대로 열리고 닫히는지(겹침·닫힘 먼저 없음).
  function bracketsBalanced(text) {
    let depth = 0;
    for (const m of text.matchAll(/\[\[|\]\]/g)) {
      depth += m[0] === '[[' ? 1 : -1;
      if (depth < 0 || depth > 1) return false;
    }
    return depth === 0;
  }

  // 수치 변수 바로 앞뒤 글자: 숫자·부호·다른 변수가 붙으면 값이 달라 보인다(RV5-01).
  function adjacencyProblems(text) {
    const out = [];
    for (const m of text.matchAll(VAR_RE)) {
      if (!MEASURE_VARS.has(m[1])) continue;
      const before = pointBefore(text, m.index);
      const b1 = before.ch;
      const b2 = pointBefore(text, before.start).ch;
      const end = m.index + m[0].length;
      const a1 = pointAt(text, end);
      const a2 = a1 ? pointAt(text, end + a1.length) : '';
      let bad = '';
      if (b1 === '}' || a1 === '{') bad = '다른 변수와 바로 붙어 있음';
      else if (b1 && (isDigit(b1) || isSign(b1) || ONE_LIKE.has(b1))) bad = '앞에 “' + b1 + '”';
      else if ((b1 === '.' || b1 === ':') && isDigit(b2)) bad = '앞에 “' + b2 + b1 + '”';
      else if (a1 && (isDigit(a1) || (isSign(a1) && a1 !== '~'))) bad = '뒤에 “' + a1 + '”';
      else if ((a1 === '.' || a1 === ':') && isDigit(a2)) bad = '뒤에 “' + a1 + a2 + '”';
      if (bad) out.push('{' + m[1] + '} ' + bad);
    }
    return out;
  }

  // 가상 환자 값(회차별, 한 번만 계산). 틀 검사에서 실제로 채워 보고 수치 경계를 확인한다.
  const sampleCache = {};
  function sampleValues(cycle) {
    if (!sampleCache[cycle]) {
      const st = normalizeState(sampleState(cycle));
      sampleCache[cycle] = frameValues(st, partsInfo(st), parseMoire(st.paste1), cycle === 2 ? parseMoire(st.paste2) : null);
    }
    return sampleCache[cycle];
  }

  // 환자마다 다른 판단을 틀에 고정하는 말(2026-11-19, 자연스러운 문장 요청과 함께 추가).
  // 정도를 판단하는 말은 저장 불가, 호전·악화는 경고만(“호전 여부”처럼 쓰는 경우가 있어서).
  const DEGREE_RE = /현저|뚜렷|확연|상당히|크게|많이|매우|다소|약간|조금|미세하게|심하게|극심|완전히|훨씬|확실히/u;
  const JUDGE_RE = /호전(?!\s*(?:여부|정도|양상))|악화(?!\s*(?:여부|정도|양상|방지|예방))/u;

  // 바꿔 쓸 말 묶음의 모양을 검사한다.
  function choiceProblems(text) {
    let depth = 0;
    let broken = false;
    for (const m of text.matchAll(/<<|>>/g)) {
      depth += m[0] === '<<' ? 1 : -1;
      if (depth < 0 || depth > 1) broken = true;
    }
    if (broken || depth !== 0 || /<<|>>/.test(text.replace(CHOICE_RE, ''))) return ['<< >> 짝이 맞지 않거나 겹쳐 있습니다. 바꿔 쓸 말은 <<그리고|또한>>처럼 씁니다.'];
    const errors = [];
    const groups = Array.from(text.matchAll(CHOICE_RE));
    if (groups.length > CHOICE_MAX) errors.push('바꿔 쓸 말 묶음이 너무 많습니다(' + groups.length + '곳, ' + CHOICE_MAX + '곳까지).');
    // 놓인 자리(RV7-01·02): 변수 {…} 안, 빈 후보가 있는데 양쪽이 같은 괄호([·[ 또는 ]·])인 자리(빈 후보면 [[·]]가 새로 생김),
    // 다른 묶음에 맞닿은 자리는 후보 조합에 따라 변수·[[ ]]·낱말이 바뀌므로 막는다. [[ ]]·변수에 붙은 것
    // (예: [[{부위} ]]<<통증이 지속됨|…>>[[({NRS})]], {골반수평}<<로 확인함|로 확인됨>>)은 괜찮다:
    // 후보에 숫자·부호·괄호가 없어 [[ ]]와 값의 경계가 바뀌지 않는다.
    let inBrace = false;
    let at = 0;
    for (const m of groups) {
      for (; at < m.index; at += 1) {
        if (text[at] === '{') inBrace = true;
        else if (text[at] === '}') inBrace = false;
      }
      const shown = '<<' + m[1] + '>>';
      const end = m.index + m[0].length;
      if (inBrace) errors.push('바꿔 쓸 말은 변수 {…} 안에 넣을 수 없습니다: “' + shown + '”.');
      else if (m[1].split('|').includes('') && '[]'.includes(text[m.index - 1] || 'x') && text[m.index - 1] === text[end]) errors.push('빈 후보가 있는 바꿔 쓸 말을 같은 괄호 사이([…[·]…])에 둘 수 없습니다(빈 후보면 [[ ]]가 바뀜): “' + shown + '”.');
      else if (text.startsWith('<<', end)) errors.push('바꿔 쓸 말 묶음 두 개를 붙여 쓸 수 없습니다(하나로 합치거나 사이에 글자를 넣으세요): “' + shown + '”.');
    }
    for (const m of groups) {
      const inner = m[1];
      const shown = '<<' + inner + '>>';
      const options = inner.split('|');
      if (options.length < 2) errors.push('바꿔 쓸 말에는 후보가 둘 이상 있어야 합니다: “' + shown + '”.');
      else if (options.length > OPTIONS_MAX) errors.push('바꿔 쓸 말 후보는 ' + OPTIONS_MAX + '개까지입니다: “' + shown + '”.');
      else if (options.every(option => free(option) === '')) errors.push('바꿔 쓸 말 후보가 모두 비어 있습니다: “' + shown + '”.');
      // 후보는 접속어·부사·조사·끝말이다: 한글·띄어쓰기·쉼표·가운뎃점만 쓴다(숫자·부호 닮은꼴·변수·괄호 차단, RV7-03).
      if (!options.every(option => /^[가-힣 ,·]*$/u.test(option))) errors.push('바꿔 쓸 말 후보에는 한글·띄어쓰기·쉼표(,)·가운뎃점(·)만 쓸 수 있습니다(숫자·부호·영문·변수·괄호 불가): “' + shown + '”.');
      const long = options.find(option => codePoints(option.trim()) > OPTION_LENGTH);
      if (long) errors.push('바꿔 쓸 말 후보가 너무 깁니다(' + OPTION_LENGTH + '자까지): “' + long.trim() + '”.');
    }
    return Array.from(new Set(errors));
  }

  // 같은 틀은 결과를 기억해 다시 쓴다(입력할 때마다 저장된 여러 벌을 검사하므로).
  const checkCache = new Map();
  function checkFrame(frame, cycle) {
    const key = cycle + '|' + String(frame == null ? '' : frame);
    if (checkCache.has(key)) return checkCache.get(key);
    const result = checkFrameNow(frame, cycle);
    if (checkCache.size > 200) checkCache.clear();
    checkCache.set(key, result);
    return result;
  }

  // 저장 전에 틀을 검사한다. errors가 있으면 저장할 수 없다.
  // 바꿔 쓸 말이 있으면 모든 후보가 한 번 이상 들어가게 펼친 틀(후보 수만큼)을 모두 검사한다.
  function checkFrameNow(frame, cycle) {
    const text = String(frame == null ? '' : frame);
    if (!/<<|>>/.test(text)) return checkPlain(text, cycle, false);
    const used = Array.from(new Set(Array.from(text.matchAll(VAR_RE), m => m[1])));
    const problems = choiceProblems(text);
    if (problems.length) return { ok: false, errors: problems, warnings: [], used, similarity: 0 };
    const rounds = Math.max(1, ...Array.from(text.matchAll(CHOICE_RE), m => m[1].split('|').length));
    const errors = new Set();
    const warnings = new Set();
    let same = 0;
    for (let k = 0; k < rounds; k += 1) {
      const r = checkPlain(nthWording(text, k), cycle, true);
      r.errors.forEach(e => errors.add(e));
      r.warnings.forEach(w => warnings.add(w));
      same = Math.max(same, r.similarity);
    }
    const percent = Math.round(same * 100);
    if (same >= SAME_LIMIT) errors.add('예시 틀과 너무 비슷합니다(본문 ' + percent + '%). 병원마다 같은 문구가 되지 않도록 원장님 문체로 바꿔 주세요.');
    else if (same >= NEAR_LIMIT) warnings.add('예시 틀과 비슷합니다(본문 ' + percent + '%). 원장님이 평소 쓰는 표현이 더 드러나게 바꾸면 좋습니다.');
    return { ok: errors.size === 0, errors: Array.from(errors), warnings: Array.from(warnings), used, similarity: same };
  }

  // 바꿔 쓸 말이 없는 틀 하나를 검사한다(skipSame: 예시 유사도 판정은 부르는 쪽에서 한 번만).
  function checkPlain(text, cycle, skipSame) {
    const errors = [];
    const warnings = [];
    const allowed = new Set(FRAME_VARS.filter(v => v.cycles.includes(cycle)).map(v => v.name));
    if (!free(text)) return { ok: false, errors: ['틀이 비어 있습니다.'], warnings, used: [], similarity: 0 };
    if (!bracketsBalanced(text)) errors.push('[[ ]] 짝이 맞지 않거나 겹쳐 있습니다.');
    const leftover = text.replace(VAR_RE, '').replace(/\[\[|\]\]/g, '');
    const stray = leftover.match(/.{0,6}[{}｛｝].{0,6}/u);
    if (stray) errors.push('중괄호가 짝이 맞지 않거나 변수 이름에 띄어쓰기·전각 괄호가 있습니다: “' + stray[0].trim() + '”.');
    if (/\p{Co}/u.test(text)) errors.push('틀에 쓸 수 없는 특수 문자가 있습니다.');
    const artifact = text.match(ARTIFACT_RE);
    if (artifact) errors.push('AI 답의 서식·설명 기호가 틀에 섞였습니다: “' + artifact[0].trim() + '”. 틀 문장만 남기고 지워 주세요.');
    const remark = text.match(CLOSING_RE);
    if (remark) errors.push('AI 답의 인사·안내 문장이 틀에 섞인 것 같습니다: “' + remark[0] + '”. 틀 문장만 남기고 지워 주세요.');
    const used = Array.from(text.matchAll(VAR_RE), m => m[1]);
    const unknown = Array.from(new Set(used.filter(name => !allowed.has(name))));
    if (unknown.length) errors.push((cycle === 2 ? '2차' : '1차') + ' 틀에 쓸 수 없는 변수: ' + unknown.map(n => '{' + n + '}').join(' ') + '.');
    const outside = Array.from(text.replace(OPTIONAL_RE, '').matchAll(VAR_RE), m => m[1]);
    if (cycle === 1) {
      const missing = MEASURES.map(([name]) => name).filter(name => !outside.includes(name));
      if (missing.length) errors.push('수치 변수가 없거나 [[ ]] 안에 있습니다: ' + missing.map(n => '{' + n + '}').join(' ') + '.');
    } else {
      const eighteen = MEASURES.flatMap(([name]) => ['1차' + name, '2차' + name]);
      if (!outside.includes('수치비교') && eighteen.some(name => !outside.includes(name))) errors.push('{수치비교}를 넣거나 1차·2차 수치 변수 18개를 모두 [[ ]] 밖에 넣어야 합니다.');
      for (const name of ['소견', '판정']) if (!used.includes(name)) errors.push('{' + name + '} 변수가 없습니다.');
    }
    if (!used.includes('NRS')) errors.push('{NRS} 변수가 없습니다(통증 점수 누락은 삭감 사유가 될 수 있습니다).');
    for (const m of text.matchAll(OPTIONAL_RE)) {
      const inside = Array.from(new Set(Array.from(m[1].matchAll(VAR_RE), v => v[1])));
      for (const name of ALONE_VARS) {
        if (inside.includes(name) && inside.length > 1) errors.push('{' + name + '} 변수가 다른 변수와 같은 [[ ]] 안에 있어, 그 변수가 비면 함께 빠집니다. {NRS}·{소견}·{판정}은 따로 [[ ]]로 감싸 주세요.');
      }
    }
    if (/NRS[\s:(（]*\{NRS\}/i.test(text)) errors.push('{NRS} 값에는 이미 ‘NRS’가 들어 있습니다(예: NRS 6). 바로 앞의 ‘NRS’ 글자를 지워 주세요.');
    const touching = adjacencyProblems(text);
    if (touching.length) {
      errors.push('수치 변수 바로 앞뒤에 숫자·부호·다른 변수가 붙어 값이 달라 보일 수 있습니다: ' + touching.join(', ') + '. 띄어 쓰거나 → · / 같은 구분 기호를 쓰세요.');
    } else if (!errors.length) {
      // 가상 환자로 채워 보고, 들어간 수치가 앞뒤 글자와 섞이지 않는지 확인한다([[ ]]·다른 값과 맞닿는 경우).
      const sample = sampleValues(cycle);
      const rendered = renderTracked(text, sample.values, sample.marks);
      const blurred = blurredSpans(rendered.text, rendered.spans);
      if (blurred.length) errors.push('채워 보면 수치가 앞뒤 글자와 붙어 값이 달라 보입니다: ' + blurred.join(' ') + '. 수치 변수 앞뒤를 띄어 써 주세요.');
    }
    const literal = text.replace(VAR_RE, ' ');
    const measured = MEASURE_HINT.map(pattern => (literal.match(pattern) || [null])[0]).find(Boolean) || ratioLiteral(literal);
    if (measured) errors.push('틀에 수치가 숫자로 적혀 있습니다: “' + measured.trim() + '”. 결과지 수치는 변수로만 씁니다.');
    for (const [pattern, what, how] of PATIENT_HINT) {
      const hit = literal.match(pattern);
      if (hit) errors.push('틀에 ' + what + ': “' + hit[0].trim() + '”. ' + how + '.');
    }
    const degree = literal.match(DEGREE_RE);
    if (degree) errors.push('정도를 판단하는 말이 틀에 고정되어 있습니다: “' + degree[0] + '”. 환자마다 다른 판단은 {판정}·{소견}으로만 씁니다.');
    const judged = literal.match(JUDGE_RE);
    if (judged) warnings.push('판정 말 “' + judged[0] + '”이 틀에 고정되어 있습니다. 환자마다 다른 판정은 {판정}으로 넣으세요(‘호전 여부’처럼 쓰는 것은 괜찮습니다).');
    const same = similarity(text, EXAMPLE_FRAMES[cycle]);
    const percent = Math.round(same * 100);
    if (skipSame) { /* 부르는 쪽에서 판정 */ } else if (same >= SAME_LIMIT) errors.push('예시 틀과 너무 비슷합니다(본문 ' + percent + '%). 병원마다 같은 문구가 되지 않도록 원장님 문체로 바꿔 주세요.');
    else if (same >= NEAR_LIMIT) warnings.push('예시 틀과 비슷합니다(본문 ' + percent + '%). 원장님이 평소 쓰는 표현이 더 드러나게 바꾸면 좋습니다.');
    const wording = free(text.replace(VAR_RE, ' '));
    const absent = SECTION_WORDS[cycle].filter(word => !wording.includes(word));
    if (absent.length) warnings.push('심평원 기재 항목(' + (cycle === 1 ? '검사시행 사유·환자평가·판독결과·치료계획' : '검사시행 사유·환자평가·판독결과·치료 후 평가') + ')이 드러나는지 확인하세요. 없는 말: ' + absent.join(', ') + '.');
    const bare = Array.from(new Set(outside.filter(name => allowed.has(name) && !MEASURE_VARS.has(name))));
    if (bare.length) warnings.push('값이 빌 수 있는 변수가 [[ ]] 밖에 있습니다: ' + bare.map(n => '{' + n + '}').join(' ') + '. 값이 없으면 문장이 어색해지니 [[ ]]로 감싸 주세요.');
    const recommended = cycle === 1 ? ['부위', '치료', '다음평가'] : ['부위', '1차이후치료', '치료여부', '다음평가'];
    const missingRecommended = recommended.filter(name => !used.includes(name));
    if (missingRecommended.length) warnings.push('넣으면 좋은 변수: ' + missingRecommended.map(n => '{' + n + '}').join(' ') + '.');
    return { ok: errors.length === 0, errors, warnings, used: Array.from(new Set(used)), similarity: same };
  }

  // 표시 줄: “=== 1차 틀 ===”. 앞뒤 마크다운(**, ##, >, -)과 표시 안의 덧말(예: 1차 틀(문장형))은 표시로 본다(RV5-04).
  const MARKER_LINE_RE = /^[ \t>#*_`-]*=+[ \t]*([12])[ \t]*차[ \t]*틀[^=\n]*=+[ \t*_`#]*(.*)$/;
  // 제목형 표시: “1차 틀:”, “[1차 틀]”, “## 1차 틀”, “**1차 틀**”, “1차 틀 (문장형):”(RV6-02). “1차 틀을 …” 같은 문장은 아니다.
  const HEAD_LINE_RE = /^[ \t>#*_`\-[]*([12])[ \t]*차[ \t]*틀(?:[ \t]*[(（[\-]?[ \t]*[A-Za-z1-9](?![A-Za-z0-9])[ \t]*[)）\]]?)?(?:[ \t]*[(（][^)）\n]*[)）])?(?=[ \t]*(?:[:：]|\]|\*|#|`|$))[ \t\]*_`#]*[:：]?[ \t]*(.*)$/;
  // 표시에 붙은 벌 이름: “1차 틀 B”, “1차 틀(C)”, “1차 틀 - A”. 없으면 A.
  // 벌 이름: A~C, 1~3(“버전 B”·“2벌” 같은 앞말 허용). 없으면 A(0). D 이후·4 이후는 -1(쓰지 않음, RV7-08).
  const VARIANT_TOKEN_RE = /(?:^|[\s(（[\-])(?:버전|벌|안|세트|set|version|ver\.?)?[ \t]*([A-Za-z0-9])(?![A-Za-z0-9])/i;
  function markerVariant(line) {
    const at = line.indexOf('틀');
    const rest = at >= 0 ? line.slice(at + 1).replace(/=+[ \t*_`#]*$/, '') : '';
    const m = rest.match(VARIANT_TOKEN_RE);
    if (!m) return 0;
    const ch = m[1].toUpperCase();
    const index = /[0-9]/.test(ch) ? Number(ch) - 1 : ch.charCodeAt(0) - 65;
    return index >= 0 && index <= 2 ? index : -1;
  }
  const NOTE_LINE_RE = /^\s*(?:※|[*•>#-]\s|(?:주|참고|설명|비고|노트|Note|NB)\s*[:：])/i;
  const BULLET_RE = /^\s*[*•>-]\s+/;
  const PAREN_LINE_RE = /^\s*[(（][^{}]*[)）]\s*$/;
  const FRAME_BITS_RE = /\{[^{}\s]+\}|\[\[|\]\]|<<|>>/;

  // 표시 뒤의 틀 한 개. 여는 코드 블록·앞쪽 괄호 부제·설명 줄은 건너뛰고,
  // 닫는 코드 블록, 설명 줄(※·목록·참고 등), 빈 줄 뒤의 변수 없는 문단이 나오면 끝낸다.
  function framePiece(lines) {
    const out = [];
    let gap = false;
    let bullets = false; // 틀을 목록 기호로 시작했으면 이어지는 목록 줄도 틀이다(RV6-02)
    for (const raw of lines) {
      // 굵게 표시(**, __)는 EDI 문구에 쓰지 않으므로 지운다.
      const line = raw.replace(/\*\*|__/g, '');
      if (/^\s*```/.test(line)) { if (out.length) break; continue; }
      if (line.trim() === '') { if (out.length) gap = true; continue; }
      const framey = FRAME_BITS_RE.test(line);
      if (BULLET_RE.test(line) && framey && (bullets || !out.length)) {
        bullets = true;
        gap = false;
        out.push(line.replace(BULLET_RE, ''));
        continue;
      }
      if (NOTE_LINE_RE.test(line)) { if (out.length) break; continue; }
      // 변수 없는 괄호 한 줄(부제·설명)과 AI 인사·안내 문장은 틀이 아니다.
      if (!framey && (PAREN_LINE_RE.test(line) || CLOSING_RE.test(line))) { if (out.length) break; continue; }
      if (gap && !framey) break;
      gap = false;
      out.push(line);
    }
    return free(out.join(' '));
  }

  // AI 응답에서 “=== 1차 틀 A ===” … “=== 2차 틀 C ===” 아래 내용을 꺼낸다. 벌 이름이 없으면 A로 본다.
  // 순서가 바뀌어도 되고, 같은 표시가 여러 번이면(초안 뒤 수정본) 마지막 것을 쓴다. 반환: { 1: [A, B, C], 2: [A, B, C] }(있는 벌만).
  // options.examples: 이 요청문에 넣은 형식 예시 {1, 2}. AI가 답 끝에 다시 붙인 예시는 틀로 쓰지 않는다(RV7-08).
  function splitFrameSets(response, options) {
    const lines = String(response == null ? '' : response).replace(/\r\n?/g, '\n').split('\n');
    const markers = [];
    lines.forEach((line, index) => {
      const m = line.match(MARKER_LINE_RE) || line.match(HEAD_LINE_RE);
      if (m) markers.push({ cycle: Number(m[1]), variant: markerVariant(line), index, rest: m[2] });
    });
    const piece = marker => {
      const next = markers.find(m => m.index > marker.index);
      const body = lines.slice(marker.index + 1, next ? next.index : lines.length);
      return framePiece(marker.rest.trim() ? [marker.rest].concat(body) : body);
    };
    // 마지막 표시를 쓰되, 예시 틀을 그대로 다시 붙인 것(“참고”)은 건너뛴다(RV6-02).
    const pick = (cycle, variant) => {
      const list = markers.filter(m => m.cycle === cycle && m.variant === variant);
      if (!list.length) return null;
      const examples = [EXAMPLE_FRAMES[cycle], options && options.examples ? options.examples[cycle] : ''].map(free).filter(Boolean);
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const text = piece(list[i]);
        if (text && !examples.includes(text)) return text;
      }
      return piece(list[list.length - 1]);
    };
    const sets = {};
    for (const cycle of [1, 2]) {
      const found = [0, 1, 2].map(variant => pick(cycle, variant));
      if (found.every(text => text === null)) return null;
      sets[cycle] = found.filter((text, k) => text !== null && (k === 0 || text !== ''));
    }
    return sets;
  }

  // 회차마다 첫 벌만 꺼낸다(이전 형식과 같은 반환).
  function splitFrames(response, options) {
    const sets = splitFrameSets(response, options);
    return sets ? { 1: sets[1][0], 2: sets[2][0] } : null;
  }

  // 저장값·입력의 틀 목록 정리: 문자열 하나 또는 배열, 빈 칸 제외, 최대 3벌.
  function frameList(value) {
    return (Array.isArray(value) ? value : [value]).filter(f => typeof f === 'string' && free(f) !== '').slice(0, 3);
  }

  // 같은 회차의 여러 벌: 벌마다 검사하고, 서로 거의 같으면 알린다(환자마다 돌려쓰는 뜻이 없어짐).
  const VARIANT_NEAR = 0.85;
  // 회차의 틀 여러 벌을 검사한다. 빈 칸은 건너뛰고, 경고의 A·B·C는 받은 목록의 원래 자리를 쓴다.
  function checkFrameSet(list, cycle) {
    const entries = (Array.isArray(list) ? list : [list]).slice(0, 3).map((frame, index) => ({ frame, index }))
      .filter(entry => typeof entry.frame === 'string' && free(entry.frame) !== '');
    const items = entries.map(entry => checkFrame(entry.frame, cycle));
    const warnings = [];
    for (let a = 0; a < entries.length; a += 1) {
      for (let b = a + 1; b < entries.length; b += 1) {
        const same = similarity(entries[a].frame, entries[b].frame);
        if (same >= VARIANT_NEAR) warnings.push('틀 ' + 'ABC'[entries[a].index] + '와 ' + 'ABC'[entries[b].index] + '가 거의 같습니다(본문 ' + Math.round(same * 100) + '%). 다르게 만들면 환자마다 문장이 달라집니다.');
      }
    }
    return { ok: entries.length > 0 && items.every(item => item.ok), items, warnings };
  }

  // 틀 미리보기용 가상 환자(합성값, 실제 환자 아님). 1차·2차 결과지 복사문은 TEMO 3.3.3 형식.
  const SAMPLE_PASTES = Object.freeze({
    1: ['기준점 수평도', '어깨 : 1.2º / 골반 : -0.8º', '등고선 비교', '등고선 간격 : 6mm', '1. 좌측 등고선 개수 : 12개', '2. 우측 등고선 개수 : 10개', '3. 좌우측 등고선 개수 차이 : 2개', '어깨 높이 차이 : 0.85cm', '어깨 좌우측 길이 비율 : 1.08:1', '골반 좌우측 길이 비율 : 1:1.1'].join('\n'),
    2: ['기준점 수평도', '어깨 : 0.6º / 골반 : -0.3º', '등고선 비교', '등고선 간격 : 6mm', '1. 좌측 등고선 개수 : 11개', '2. 우측 등고선 개수 : 10개', '3. 좌우측 등고선 개수 차이 : 1개', '어깨 높이 차이 : 0.4cm', '어깨 좌우측 길이 비율 : 1.01:1', '골반 좌우측 길이 비율 : 1:1.02'].join('\n')
  });
  // kind 'sparse': 값이 빌 수 있는 칸을 비운 가상 환자(수상일·사고 내용·확인 목적·목표·다음 평가·NRS·소견 없음, 2차는 치료 종료).
  // 설정 화면에서 [[ ]]가 빠질 때 문장이 어떻게 되는지 보여 준다(RV5-06).
  function sampleState(cycle, kind) {
    const s = blankState();
    const second = cycle === 2;
    s.cycle = second ? 2 : 1;
    s.paste1 = SAMPLE_PASTES[1];
    s.paste2 = SAMPLE_PASTES[2];
    s.injuryDate = '2026-10-01';
    s.firstExamDate = '2026-10-20';
    s.parts.neck = { on: true, nrs: second ? 4 : 6, points: null, extra: '' };
    s.parts.shoulder = { on: true, side: '우측', nrs: second ? 3 : 5, points: null, extra: '' };
    s.planTx = { acu: true, pharm: true, moxa: true, chuna: true };
    s.priorTx = { acu: true, pharm: true, moxa: true, chuna: true };
    s.next = { preset: '4주 후', custom: '' };
    s.opinion = '어깨 수평 차이 감소, 좌우 등고선 차이 1개로 감소.';
    s.judgement = '호전';
    s.continuation = 'continue';
    if (kind === 'sparse') {
      s.injuryDate = '';
      s.firstExamDate = '';
      s.accident = '';
      s.purpose1 = '';
      s.purpose2 = '';
      s.goal = '';
      s.next = { preset: '', custom: '' };
      s.parts.shoulder = { on: false, side: '', nrs: null, points: null, extra: '' };
      s.parts.neck = { on: true, nrs: null, points: null, extra: '' };
      s.planTx = { acu: false, pharm: false, moxa: false, chuna: true };
      s.priorTx = { acu: false, pharm: false, moxa: false, chuna: true };
      s.opinion = '';
      s.continuation = 'stop';
    }
    return s;
  }

  // 예시 문구가 없을 때 쓸 문체 조건. 요청문마다 무작위로 골라 병원마다 틀이 겹치지 않게 한다(2026-11-19 사용자: 예시 없이도).
  // 항목 이름은 모두 심평원 기재 항목 말(사유·판독·계획/평가)을 담는다.
  const STYLE_CHOICES = Object.freeze({
    form: Object.freeze([
      '문장형: 항목 이름을 대괄호로 쓰고 이어지는 문장으로 씁니다. 예: [검사 사유] …',
      '항목형: 항목 이름 뒤에 쌍점을 쓰고, 내용은 이어지는 문장으로 씁니다. 예: 사유: …',
      '번호형: 항목마다 번호를 붙이고 문장으로 씁니다. 예: 1) 검사 사유 …',
      '머리표형: 항목 앞에 ○를 붙이고 문장으로 씁니다. 예: ○ 검사 사유: …'
    ]),
    headers: Object.freeze([
      Object.freeze({ 1: '검사시행 사유 / 판독 결과 / 치료 계획', 2: '검사시행 사유 / 판독 결과 / 치료 후 평가' }),
      Object.freeze({ 1: '검사 사유 / 환자 평가 및 판독 / 향후 치료 계획', 2: '검사 사유 / 환자 평가 및 판독 / 치료 후 경과 평가' }),
      Object.freeze({ 1: '사유 / 판독 / 계획', 2: '사유 / 판독 / 평가' }),
      Object.freeze({ 1: '시행 사유 / 판독 소견 / 치료 계획', 2: '시행 사유 / 판독 소견 / 치료 후 평가' })
    ]),
    ending: Object.freeze([
      '명사형으로 끝냅니다(예: 검사 시행, 재평가 예정).',
      '“~함”으로 끝냅니다(예: 검사함, 재평가함).',
      '“~하였음”으로 끝냅니다(예: 검사하였음).',
      '“~임”·“~됨”으로 끝냅니다(예: 지속됨, 필요함).'
    ]),
    order: Object.freeze([
      '어깨·골반 기울기 → 등고선 → 어깨높이차 → 길이비',
      '어깨높이차 → 어깨·골반 기울기 → 등고선 → 길이비',
      '등고선 → 어깨·골반 기울기 → 길이비 → 어깨높이차',
      '어깨 수치(기울기·높이차·길이비) → 골반 수치(기울기·길이비) → 등고선'
    ]),
    separator: Object.freeze(['쉼표(,)', '가운뎃점(·)', '세미콜론(;)', '빗금(/)']),
    compare: Object.freeze([
      '{수치비교} 한 줄을 씁니다.',
      '1차·2차 수치 18개 변수로 “1차값→2차값”처럼 씁니다.',
      '1차·2차 수치 18개 변수로 “1차값/2차값”처럼 씁니다.'
    ]),
    length: Object.freeze(['간결하게: 가상 환자 기준 1차 250자, 2차 320자 안팎', '보통: 가상 환자 기준 1차 300자, 2차 340자 안팎'])
  });

  // 같은 seed면 같은 조건(시험·기록용). 앱은 패널을 열 때마다 무작위 seed를 쓴다.
  function seededRandom(seed) {
    let a = (Number.isFinite(seed) ? seed : 0) >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 문체 조건으로 만드는 형식 예시 틀의 조각(요청문마다 달라짐, 2026-11-19 사용자: 요청문 예시 다양화).
  // 어떤 조합이든 틀 검사를 통과하는 모양만 둔다(EDI-18m 시험).
  const EXAMPLE_POOLS = Object.freeze({
    accident: Object.freeze(['[[{사고내용} ]]수상 후', '[[{사고내용}로 ]]다친 뒤', '[[{사고내용} ]]부상 이후', '[[{사고내용}로 ]]<<수상한|다친>> 뒤']),
    duration: Object.freeze(['4주 이상 <<지났으나|경과하였으나>>', '4주가 <<넘었으나|지났으나>>', '4주 경과 후에도', '4주 넘게 지난 <<지금도|현재도>>']),
    pain: Object.freeze(['<<통증이 지속됨|통증이 계속됨>>', '통증 잔존', '<<통증을 호소함|통증 호소 중>>', '통증이 <<이어짐|남아 있음>>']),
    nrs: Object.freeze(['[[({NRS})]]', '[[, {NRS}]]', '[[ {NRS}]]']),
    purpose: Object.freeze(['[[{확인목적} 위해 ]]', '[[{확인목적} <<목적으로|차원에서>> ]]', '[[{확인목적}을 위하여 ]]']),
    prior: Object.freeze(['1차 검사[[({1차검사일})]] 후 [[{1차이후치료} 시행 뒤 ]]', '1차 검사[[ {1차검사일}]] <<이후|뒤>> [[{1차이후치료} 받았으며 ]]', '[[{1차검사일} ]]1차 검사 뒤 [[{1차이후치료} 진행 후 ]]']),
    shoulderAngle: Object.freeze(['어깨 기울기', '어깨 수평']),
    pelvisAngle: Object.freeze(['골반 기울기', '골반 수평']),
    height: Object.freeze(['어깨 높이 차', '양 어깨 높이 차']),
    shoulderRatio: Object.freeze(['어깨 길이비', '어깨 좌우 길이비']),
    pelvisRatio: Object.freeze(['골반 길이비', '골반 좌우 길이비']),
    contour: Object.freeze([
      Object.freeze(['등고선 간격 ', ' 기준 좌 ', '우 ', '차이 ']),
      Object.freeze(['등고선(간격 ', ') 좌측 ', '우측 ', '좌우 차 '])
    ]),
    opinion: Object.freeze(['[[ 소견: {소견}.]]', '[[ 판독 소견 {소견}.]]', '[[ 소견상 {소견}.]]']),
    plan: Object.freeze([
      '[[{치료} 시행, ]][[{치료목표} 목표로 ]][[{다음평가} <<재평가 예정|다시 평가할 예정>>]].',
      '[[{치료} <<진행하며|시행하며>> ]][[{치료목표} 위해 ]][[{다음평가} 다시 검사]].',
      '[[{치료}로 ]][[{치료목표}를 도모하고 ]][[{다음평가} <<추적 검사|추적 관찰>>]].'
    ]),
    evaluation: Object.freeze([
      '[[{판정}, ]][[{치료목표} 위해 ]][[{치료여부}]][[, {다음평가} <<재평가|다시 평가>>]].',
      '[[경과 {판정}. ]][[{치료여부}]][[, {다음평가} 다시 검사]].',
      '[[{판정} 상태로 ]][[{치료목표} 위해 ]][[{치료여부}]][[; {다음평가} <<추적 검사|추적 관찰>>]].'
    ])
  });
  const EXAM_WORDS = Object.freeze([n => '모아레 ' + n + '차 검사 <<시행|실시>>', n => n + '차 모아레 검사<<함|를 시행함>>', n => '모아레 ' + n + '차 검사<<하였음|를 시행하였음>>', n => n + '차 검사 <<시행됨|실시됨>>']);
  const FINDING_ENDS = Object.freeze(['.', '<<로 확인함|로 확인됨>>.', '<<로 측정하였음|로 확인하였음>>.', '<<로 관찰됨|로 확인됨>>.']);
  const SEPARATORS = Object.freeze([', ', '·', '; ', ' / ']);
  const ORDERS = Object.freeze([['angles', 'contour', 'height', 'ratios'], ['height', 'angles', 'contour', 'ratios'], ['contour', 'angles', 'ratios', 'height'], ['shoulder', 'pelvis', 'contour']]);

  // 낱말 끝 글자에 받침이 있는지(예시 틀의 은/는·이/가 고르기용).
  function hasFinal(word) {
    const code = String(word).trim().slice(-1).charCodeAt(0) - 0xAC00;
    return code >= 0 && code < 11172 && code % 28 !== 0;
  }

  // 문체 조건(글)과 그 번호(index), 예시 조각(pools)을 seed로 정한다.
  function styleRecipe(seed) {
    const next = seededRandom(seed);
    const index = {};
    const pools = {};
    const recipe = { index, pools };
    for (const key of Object.keys(STYLE_CHOICES)) {
      index[key] = Math.floor(next() * STYLE_CHOICES[key].length);
      recipe[key] = STYLE_CHOICES[key][index[key]];
    }
    for (const key of Object.keys(EXAMPLE_POOLS)) pools[key] = EXAMPLE_POOLS[key][Math.floor(next() * EXAMPLE_POOLS[key].length)];
    return recipe;
  }

  // 요청문에 넣을 형식 예시 틀(1차·2차). 문체 조건 그대로 조립하므로 요청문마다 다르다.
  function exampleFrames(seed) {
    const r = styleRecipe(seed);
    const i = r.index;
    const p = r.pools;
    const sep = SEPARATORS[i.separator];
    const sections = cycle => r.headers[cycle].split(' / ').map((h, k) => ['[' + h + '] ', h + ': ', (k + 1) + ') ' + h + ': ', '○ ' + h + ': '][i.form]);
    const value = (cycle, name) => cycle === 1 ? '{' + name + '}' : i.compare === 2 ? '{1차' + name + '}/{2차' + name + '}' : '{1차' + name + '}→{2차' + name + '}';
    // 쉼표·세미콜론으로 이을 때는 문장처럼 쓴다: 항목 이름에 은/는·이/가, 첫 묶음 뒤 “~로 측정되었고”, 마지막 묶음 앞 이어 주는 말
    // (2026-11-19 사용자: 데이터만 늘어놓지 말고 사람이 쓴 것처럼). 모두 바꿔 쓸 말로 둔다.
    const natural = i.separator === 0 || i.separator === 2;
    const label = word => natural ? word + (hasFinal(word) ? '<<은|이>>' : '<<는|가>>') : word;
    const findings = cycle => {
      if (cycle === 2 && i.compare === 0) return '{수치비교}.';
      const v = name => value(cycle, name);
      const c = p.contour;
      const groups = {
        angles: label(p.shoulderAngle) + ' ' + v('어깨수평') + sep + label(p.pelvisAngle) + ' ' + v('골반수평'),
        contour: c[0] + v('등고선간격') + c[1] + v('좌측등고선') + sep + c[2] + v('우측등고선') + sep + c[3] + v('등고선차이'),
        height: label(p.height) + ' ' + v('어깨높이차'),
        ratios: label(p.shoulderRatio) + ' ' + v('어깨길이비') + sep + label(p.pelvisRatio) + ' ' + v('골반길이비'),
        shoulder: label(p.shoulderAngle) + ' ' + v('어깨수평') + sep + label(p.height) + ' ' + v('어깨높이차') + sep + label(p.shoulderRatio) + ' ' + v('어깨길이비'),
        pelvis: label(p.pelvisAngle) + ' ' + v('골반수평') + sep + label(p.pelvisRatio) + ' ' + v('골반길이비')
      };
      const parts = ORDERS[i.order].map(key => groups[key]);
      if (!natural) return parts.join(sep) + FINDING_ENDS[i.ending];
      const last = parts.length - 1;
      return parts[0] + '<<로 측정되었고|로 확인되었고>>' + sep + parts.slice(1, last).map(part => part + sep).join('') + '<<그리고 |또한 |>>' + parts[last] + FINDING_ENDS[i.ending];
    };
    const reason = cycle => (cycle === 1 ? '[[{수상일} ]]' : '') + p.accident + ' ' + p.duration + ' [[{부위} ]]' + p.pain + p.nrs + '. ' +
      (cycle === 2 ? p.prior : '') + p.purpose + EXAM_WORDS[i.ending](cycle) + '.';
    const build = cycle => {
      const s = sections(cycle);
      return s[0] + reason(cycle) + ' ' + s[1] + findings(cycle) + (cycle === 2 ? p.opinion : '') + ' ' + s[2] + (cycle === 1 ? p.plan : p.evaluation);
    };
    return { 1: build(1), 2: build(2) };
  }

  // 틀은 저장 후 30일 동안 쓴다(2026-11-19 사용자: 매달 새로 만들게 하고, 30일이 되면 지움).
  const FRAME_DAYS = 30;
  const DAY_MS = 86400000;
  // 남은 시간(ms). 0 이하면 다 썼다. 저장 시각을 읽을 수 없거나 하루 넘게 미래면 다 쓴 것으로 본다.
  function frameTimeLeft(savedAt, now) {
    const saved = Date.parse(savedAt);
    const at = Number.isFinite(now) ? now : Date.now();
    if (!Number.isFinite(saved) || saved - at > DAY_MS) return 0;
    return saved + FRAME_DAYS * DAY_MS - at;
  }

  // 원장님 AI에 붙여넣을 요청문. 평소 EDI 문구(예시)가 있으면 그 문체를, 없으면 [이번 문체 조건]을 따른다.
  // options.seed: 문체 조건을 고르는 수(없으면 0).
  function framePrompt(options) {
    const seed = options && Number.isFinite(options.seed) ? options.seed : 0;
    const style = styleRecipe(seed);
    const examples = exampleFrames(seed);
    const list = cycle => FRAME_VARS.filter(v => v.cycles.length === 1 && v.cycles[0] === cycle && !v.measure)
      .map(v => '{' + v.name + '} ' + v.help).join('\n');
    const common = FRAME_VARS.filter(v => v.cycles.length === 2).map(v => '{' + v.name + '} ' + v.help).join('\n');
    return [
      '당신은 한의원 원장의 자동차보험 EDI 특정내역 문구 ‘틀’을 만드는 도우미입니다.',
      '환자마다 바뀌는 부분을 {변수}로 표시한 틀을 1차 검사용 3벌(A·B·C), 2차 검사용 3벌(A·B·C) 만들어 주세요. 묻지 말고 바로 만들어 주세요.',
      '세 벌은 같은 문체와 같은 규칙을 지키되, 문장 순서·연결 표현·수치를 늘어놓는 방식을 서로 다르게 만듭니다(환자마다 돌아가며 씁니다).',
      '맨 아래 [원장님 예시]에 문구가 있으면 그 문체·순서·표현을 살립니다. 예시가 없으면 [이번 문체 조건]대로 새로 만듭니다.',
      '',
      '[이번 문체 조건] (병원마다 문구가 겹치지 않도록 이 요청문마다 무작위로 정한 조건입니다)',
      '- 형식: ' + style.form,
      '- 항목 이름: 1차 “' + style.headers[1] + '”, 2차 “' + style.headers[2] + '”',
      '- 문장 끝: ' + style.ending,
      '- 판독 수치 순서: ' + style.order,
      '- 수치 사이 구분: ' + style.separator,
      '- 2차 수치 비교: ' + style.compare,
      '- 길이: ' + style.length,
      '',
      '규칙',
      '1. 변수는 아래 목록에 있는 이름만 중괄호로 씁니다. 예: {어깨수평}',
      '2. 측정 수치(각도·개수·cm·mm·비율)는 숫자로 적지 말고 반드시 수치 변수로 씁니다.',
      '3. 1차 틀에는 수치 변수 9개(' + MEASURES.map(([n]) => '{' + n + '}').join(' ') + ')를 모두 넣습니다.',
      '4. 2차 틀에는 {수치비교} 하나를 넣거나, {1차어깨수평}…{2차골반길이비} 18개를 모두 넣습니다. 원장님 예시에 1차·2차 수치를 비교하는 표현이 있으면 18개 변수로 그 표현을 살리고, 예시가 없으면 [이번 문체 조건]의 비교 방식을 따릅니다. {소견}과 {판정}도 넣습니다.',
      '5. 두 틀 모두 {NRS}를 넣습니다(통증 점수 누락은 삭감 사유가 될 수 있습니다).',
      '6. 심평원 기재 항목이 모두 드러나야 합니다. 1차: 검사시행 사유, 환자평가·판독결과, 치료계획. 2차: 검사시행 사유, 환자평가·판독결과, 치료 후 평가. 항목 표기는 원장님 예시를, 예시가 없으면 [이번 문체 조건]을 따릅니다.',
      '7. 수치 변수와 {수치비교}를 뺀 모든 변수는 값이 빌 수 있습니다(' + FRAME_VARS.filter(v => !v.measure && !v.compare).map(v => '{' + v.name + '}').join(' ') + '). 이 변수가 들어간 구절은 [[ ]]로 감쌉니다. 그 안의 변수가 비면 [[ ]] 전체가 빠집니다. 예: [[({NRS})]] [[{치료목표} 위해 ]]',
      '8. {NRS}·{소견}·{판정}은 다른 변수와 같은 [[ ]]에 넣지 않습니다. 수치 변수는 [[ ]] 안에 넣지 않고, 수치 변수 바로 앞뒤에 숫자·부호(-, +)를 붙이지 않습니다(띄어 쓰거나 → / 를 씁니다. 문장 끝 마침표는 괜찮습니다). {NRS} 앞에 ‘NRS’를 또 쓰지 않습니다.',
      '9. 사람이 쓴 차트처럼 자연스럽게 이어 씁니다. 수치를 쉼표로 늘어놓기만 하지 말고 “~으로 측정되었고”, “~이며”, “~로 확인되어”처럼 문장 안에 넣습니다. 한 문단으로, 350자 제한을 고려해 간결하게 씁니다. 틀 안에 설명·마크다운(**, ##, ※)을 넣지 않습니다.',
      '10. 바꿔 쓸 말: 뜻이 같은 접속어·부사·조사·끝말은 <<후보1|후보2|후보3>>처럼 후보를 2~3개 적습니다(벌마다 4~8곳). 패널이 환자마다 후보 하나를 골라 써서, 같은 틀이라도 환자마다 문장이 조금씩 달라집니다. 예: <<그리고|또한|아울러>>, <<통증이|통증은>>, <<확인됨|관찰됨>>. 후보는 2~4개, 하나에 16자까지, 한글·띄어쓰기·쉼표·가운뎃점만 씁니다(숫자·부호·영문·변수·괄호 불가). 후보끼리 뜻이 같아야 합니다. 묶음을 변수 {…} 안에 넣거나, 묶음 두 개를 붙여 쓰거나, 빈 후보가 있는 묶음을 [·] 사이에 끼우지 않습니다.',
      '11. 정도를 판단하는 말(현저·뚜렷·확연·상당히·크게·많이·매우·다소·약간·조금·미세하게·심하게·극심·완전히·훨씬·확실히)과 고정된 판정(호전·악화)은 틀에 쓰지 않습니다. 환자마다 다른 판단은 {판정}·{소견}으로만 들어갑니다.',
      '12. 환자 이름·주민번호·차트번호·특정 날짜·통증 점수 같은 개인정보나 특정 환자의 사실은 틀에 넣지 않습니다.',
      '13. 아래 [1차 예시]·[2차 예시]는 이 요청문의 문체 조건으로 만든 형식 참고용입니다. 병원마다 문구가 같아지지 않도록 그대로 베끼지 말고, 세 벌 모두 원장님 예시(없으면 [이번 문체 조건])의 문체로 표현을 바꿔 쓰세요.',
      '14. 답하기 전에 벌마다 확인합니다: 1차 틀에 수치 변수 9개가 모두 [[ ]] 밖에 있는지, 모든 틀에 {NRS}가 있는지, 2차 틀에 {소견}·{판정}이 있는지, 숫자로 적은 수치·날짜가 없는지, 바꿔 쓸 말 후보에 숫자·변수가 없는지.',
      '',
      '변수 목록',
      '(공통)',
      common,
      '(1차 틀만)',
      list(1),
      '{어깨수평} {골반수평} {등고선간격} {좌측등고선} {우측등고선} {등고선차이} {어깨높이차} {어깨길이비} {골반길이비} 1차 결과지 수치',
      '(2차 틀만)',
      list(2),
      '{1차어깨수평}~{1차골반길이비}, {2차어깨수평}~{2차골반길이비} 1차·2차 결과지 수치(이름은 위 9개 앞에 1차/2차를 붙임)',
      '',
      '출력 형식(이 형식 그대로, 설명 없이)',
      '=== 1차 틀 A ===', '(1차 틀 A)', '=== 1차 틀 B ===', '(1차 틀 B)', '=== 1차 틀 C ===', '(1차 틀 C)',
      '=== 2차 틀 A ===', '(2차 틀 A)', '=== 2차 틀 B ===', '(2차 틀 B)', '=== 2차 틀 C ===', '(2차 틀 C)',
      '',
      '[1차 예시]',
      examples[1],
      '',
      '[2차 예시]',
      examples[2],
      '',
      '[원장님 예시] (선택: 평소 쓰신 EDI 문구가 있으면 3~5개를 이 아래에 붙여넣으세요. 환자 이름·주민번호·차트번호·날짜는 지우고 붙여넣으세요. 없으면 비워 두고 그대로 보내세요.)',
      ''
    ].join('\n');
  }

  // EDI-13(틀 방식): 틀이 쓰는 결과지 수치 글자(중복 없이).
  function valueTokens(frame, first, second) {
    const tokens = [];
    for (const m of String(frame == null ? '' : frame).matchAll(VAR_RE)) {
      const def = FRAME_VARS.find(v => v.name === m[1]);
      if (!def) continue;
      if (def.measure) {
        const source = def.from === 2 ? second : first;
        if (source) tokens.push(source.values[def.measure]);
      }
      if (def.compare && second) for (const [, key] of MEASURES) tokens.push(first.values[key], second.values[key]);
    }
    return Array.from(new Set(tokens.filter(token => typeof token === 'string' && token !== '')));
  }

  // 숫자로 보이는 글자(전각 숫자 등 모든 십진 숫자)와 부호로 보이는 글자(모든 대시, 빼기·더하기·± 기호).
  // 부호처럼 보이는 글자: 빼기·더하기·± 기호, 위·아래 첨자 부호, 수식 기호, 한글 ㅡ·가나 ー·한자 一·가로줄 등(RV6-06).
  const SIGN_CHARS = new Set(['+', 0x2212, 0x00B1, 0x2213, 0xFF0B, 0x207A, 0x207B, 0x208A, 0x208B, 0x02D6, 0x02D7, 0x2795, 0x2796, 0x2043, 0xFE62, 0x3161, 0x30FC, 0xFF70, 0x4E00, 0x23AF, 0x2500, 0x2501,
    // 빼기처럼 보이는 글자 더(RV7-03): ⼀ ㇐ ᅳ ￚ _ ¯ ~ ═ ╴ ⏤
    0x2F00, 0x31D0, 0x1173, 0xFFDA, 0x005F, 0x00AF, 0x007E, 0x2550, 0x2574, 0x23E4].map(c => typeof c === 'number' ? String.fromCharCode(c) : c));
  // 숫자 1처럼 보이는 글자(RV7-03): l I ǀ 丨 ㅣ. 값 바로 앞에 오면 다른 값(예: l0.8º → 10.8º)으로 읽힌다.
  const ONE_LIKE = new Set(['l', 'I', 0x01C0, 0x4E28, 0x3163].map(c => typeof c === 'number' ? String.fromCharCode(c) : c));
  // 숫자처럼 보이는 글자: 모든 숫자(전각·위첨자·원 숫자·로마 숫자 포함, RV6-06).
  function isDigit(ch) { return /\p{N}/u.test(ch); }
  function isSign(ch) { return /\p{Pd}/u.test(ch) || SIGN_CHARS.has(ch); }

  // 그 자리의 글자가 수치 그대로인지: 앞에 숫자·부호가 붙거나(“11.2º”·“-1.2º”·“–1.2º”), 숫자 뒤의 “.”·“:”가
  // 앞에 오거나, 뒤에 숫자·결합 문자·“.숫자”·“:숫자”가 붙으면(“1.2º5”·“1:1.1５”) 다른 값으로 본다.
  // “기울기:1.2º”처럼 글자 뒤의 “:”·“.”는 괜찮다(RV5-01·02).
  // 앞뒤 글자는 코드 포인트 단위로 읽는다: 보조 평면 숫자(𝟙 등)도 한 글자로 본다(AST-02).
  function pointBefore(text, index) {
    if (index <= 0) return { ch: '', start: 0 };
    let start = index - 1;
    const low = text.charCodeAt(start);
    if (low >= 0xDC00 && low <= 0xDFFF && start > 0) {
      const high = text.charCodeAt(start - 1);
      if (high >= 0xD800 && high <= 0xDBFF) start -= 1;
    }
    return { ch: text.slice(start, index), start };
  }
  function pointAt(text, index) {
    return index < text.length ? String.fromCodePoint(text.codePointAt(index)) : '';
  }
  function tokenAt(text, index, token) {
    if (!text.startsWith(token, index)) return false;
    const before = pointBefore(text, index);
    const b1 = before.ch;
    const b2 = pointBefore(text, before.start).ch;
    if (b1 && (isDigit(b1) || isSign(b1) || ONE_LIKE.has(b1))) return false;
    if ((b1 === '.' || b1 === ':') && b2 && isDigit(b2)) return false;
    const end = index + token.length;
    const a1 = pointAt(text, end);
    const a2 = a1 ? pointAt(text, end + a1.length) : '';
    // 값 뒤의 부호는 여기서 보지 않는다: 직접 고친 문구에서 “1.2º-”를 값으로 세지 않으면 수치를 더 넣어도 통과한다(AST-R5-01).
    // 값 두 개가 맞닿는 경우는 blurredSpans(자동 문구)와 VALUE_TOUCHING(직접 고친 문구)이 막는다.
    if (a1 && (isDigit(a1) || /\p{M}/u.test(a1))) return false;
    if ((a1 === '.' || a1 === ':') && a2 && isDigit(a2)) return false;
    return true;
  }
  // 틀이 넣은 결과지 수치 가운데 수치로 읽히지 않는 것(앞뒤 글자와 섞임)과, 다른 수치와 사이 글자 없이 맞닿은 것(RV7-02).
  function blurredSpans(text, spans) {
    const names = new Set(spans.filter(s => !tokenAt(text, s.index, s.token)).map(s => '{' + s.name + '}'));
    const sorted = spans.slice().sort((x, y) => x.index - y.index);
    for (let k = 1; k < sorted.length; k += 1) {
      const prev = sorted[k - 1];
      if (prev.index + prev.token.length === sorted[k].index) { names.add('{' + prev.name + '}'); names.add('{' + sorted[k].name + '}'); }
    }
    return Array.from(names);
  }
  // 문구에서 결과지 수치로 읽히는 글자를 차례대로 찾는다(자리 포함).
  function tokenHits(text, tokens) {
    const src = String(text == null ? '' : text);
    const longestFirst = tokens.slice().sort((a, b) => b.length - a.length);
    const out = [];
    for (let i = 0; i < src.length; i += 1) {
      const hit = longestFirst.find(token => tokenAt(src, i, token));
      if (hit) { out.push({ token: hit, index: i }); i += hit.length - 1; }
    }
    return out;
  }
  function tokenSequence(text, tokens) { return tokenHits(text, tokens).map(hit => hit.token); }

  // 직접 수정 대조: 최종 문구 속 결과지 수치의 차례가 자동 문구의 차례와 정확히 같아야 한다.
  // 빠짐(missing)·더 들어감(extra, 중복·끼워 넣기)·순서 바뀜(ordered=false)을 따로 알려 준다(AST-01).
  function verifyValues(text, tokens, reference) {
    const expected = tokenSequence(reference, tokens);
    const hits = tokenHits(text, tokens);
    const actual = hits.map(hit => hit.token);
    // 결과지 수치 두 개가 사이 글자 없이 붙어 있으면(“1.2º-0.8º”) 섞여 보인다(직접 고친 문구, RV7-02·AST-R5-01).
    const touching = [];
    for (let k = 1; k < hits.length; k += 1) {
      if (hits[k - 1].index + hits[k - 1].token.length === hits[k].index) touching.push(hits[k - 1].token + hits[k].token);
    }
    const count = list => list.reduce((map, token) => map.set(token, (map.get(token) || 0) + 1), new Map());
    const want = count(expected);
    const have = count(actual);
    const missing = [];
    const extra = [];
    for (const [token, n] of want) if ((have.get(token) || 0) < n) missing.push(token);
    for (const [token, n] of have) if (n > (want.get(token) || 0)) extra.push(token);
    const ordered = actual.length === expected.length && actual.every((token, i) => token === expected[i]);
    return { ok: !missing.length && !extra.length && ordered && !touching.length, missing, extra, ordered, touching, expected: expected.length };
  }

  function problemText(parsed) {
    return parsed.items.filter(item => !item.ok).map(item => item.label).join(', ');
  }

  // options.frames: 저장된 원장님 틀 {1, 2}. 없으면 예시 틀로 미리보기만 만들고, options.requireFrame이면 복사를 막는다.
  function compose(input, options) {
    const opts = options || {};
    const st = normalizeState(input);
    const cycle = st.cycle;
    // 저장된 틀은 회차마다 1~3벌(문자열 하나도 됨). 환자마다 state.variant로 고른 벌을 쓴다.
    const lists = opts.frames ? { 1: frameList(opts.frames[1]), 2: frameList(opts.frames[2]) } : null;
    const frames = lists && lists[1].length && lists[2].length ? lists : null;
    const variant = frames ? Math.min(st.variant[cycle], frames[cycle].length - 1) : 0;
    const template = frames ? frames[cycle][variant] : EXAMPLE_FRAMES[cycle];
    // 바꿔 쓸 말은 환자마다 정한 수로 고른다(같은 환자는 같은 문장).
    const frame = wordFrame(template, st.wording[cycle]);
    const info = partsInfo(st);
    const first = parseMoire(st.paste1);
    const second = cycle === 2 ? parseMoire(st.paste2) : null;
    const filled = frameValues(st, info, first, second);
    const values = filled.values;
    const rendered = renderTracked(frame, values, filled.marks);
    const auto = rendered.text;
    const manual = st.manual[cycle];
    const text = manual.text !== null ? free(manual.text) : auto;
    const length = codePoints(text);
    const over = Math.max(0, length - LIMIT);

    const blocks = [];
    const notes = [];
    const block = (code, message) => blocks.push({ code, message });
    const note = (code, message) => notes.push({ code, message });
    if (opts.requireFrame && !frames) block('FRAME_MISSING', '원장님 차팅 틀을 먼저 설정하고 저장해 주세요.');
    else if (frames) {
      // 1·2차 틀은 한 벌로 저장하므로 어느 한쪽이라도 문제면 막는다(RV5-12).
      const broken = [1, 2].filter(n => frames[n].some(f => !checkFrame(f, n).ok));
      if (broken.length) block('FRAME_INVALID', '저장된 ' + broken.join('·') + '차 차팅 틀에 문제가 있습니다. 틀을 다시 설정해 주세요.');
      // 이 환자에게 고른 표현으로 펼친 틀도 다시 검사한다(조합으로만 생기는 문제, RV7-01·02).
      else if (frame !== template && !checkFrame(frame, cycle).ok) block('FRAME_WORDING', '이 환자에게 고른 표현으로 만든 문장에 문제가 있습니다. ‘다른 표현으로’를 누르거나 차팅 틀을 고쳐 주세요.');
    }
    // 직접 고친 문구는 그때의 틀로만 쓴다. 틀을 저장·변경하거나 다른 벌을 고른 뒤에는 쓰지 않는다(RV5-03).
    // 이때는 복사가 이미 막히므로, 다른 틀의 자동 문구와 수치를 대조한 결과(순서·누락)는 보여 주지 않는다.
    const frameChanged = manual.text !== null && manual.frame !== template;
    if (frameChanged) block('TEXT_FRAME_CHANGED', '직접 고친 문구는 지금 차팅 틀로 만든 것이 아닙니다. ‘자동 문구로 되돌리기’를 누른 뒤 다시 고쳐 주세요.');
    const firstName = cycle === 2 ? '1차 결과' : '검사 결과';
    if (first.empty) block('PASTE1_EMPTY', firstName + '를 붙여넣어 주세요.');
    else if (!first.ok) block('PASTE1_UNREADABLE', firstName + '에서 읽지 못한 항목 ' + first.problems + '개: ' + problemText(first) + '.');
    if (cycle === 2) {
      if (second.empty) block('PASTE2_EMPTY', '2차 결과를 붙여넣어 주세요.');
      else if (!second.ok) block('PASTE2_UNREADABLE', '2차 결과에서 읽지 못한 항목 ' + second.problems + '개: ' + problemText(second) + '.');
    }
    const sideMissing = info.selected.filter(x => x.def.sided && !SIDES.includes(x.p.side)).map(x => x.def.name);
    if (sideMissing.length) block('SIDE_MISSING', sideMissing.join('·') + '의 좌측/우측/양측을 선택하세요.');
    const pastesOk = first.ok && (cycle === 1 || second.ok);
    // 틀이 넣은 결과지 수치마다, 그 자리에서 수치 그대로 읽히는지 확인한다(앞뒤 글자와 섞이면 막음, RV5-01).
    const blurred = pastesOk ? blurredSpans(auto, rendered.spans) : [];
    if (blurred.length) block('FRAME_AMBIGUOUS', '문구에서 결과지 수치가 앞뒤 글자와 붙어 값이 달라 보입니다: ' + blurred.join(' ') + '. 입력 끝의 숫자나 차팅 틀의 띄어쓰기를 확인하세요.');
    const tokens = Array.from(new Set(rendered.spans.map(s => s.token)));
    const valuesChecked = pastesOk && !frameChanged;
    const check = valuesChecked ? verifyValues(text, tokens, auto) : { ok: true, missing: [], extra: [], ordered: true, touching: [] };
    if (check.missing.length) block('VALUE_MISMATCH', '문구에 결과지 수치가 빠졌거나 바뀌었습니다: ' + check.missing.join(', ') + '. 직접 수정한 부분을 확인하세요.');
    else if (check.extra.length) block('VALUE_EXTRA', '직접 고친 문구에 결과지 수치가 더 들어가 있습니다: ' + check.extra.join(', ') + '. 결과지 수치는 자동 문구와 같은 개수·순서로만 씁니다(소견은 소견 칸에 쓰세요).');
    else if (manual.text !== null && check.touching.length) block('VALUE_TOUCHING', '직접 고친 문구에서 결과지 수치 두 개가 붙어 있습니다: ' + check.touching.join(', ') + '. 사이를 띄우거나 쉼표 같은 구분 기호를 넣어 주세요.');
    else if (!check.ordered) block('VALUE_ORDER', '직접 수정한 문구에서 결과지 수치의 순서가 바뀌었습니다. 1차·2차 값이 뒤바뀌지 않았는지 확인하세요(순서를 바꾸려면 차팅 틀을 바꾸세요).');
    if (st.limitOn && over > 0) block('OVER_LIMIT', LIMIT + '자를 ' + over + '자 넘었습니다. 문장을 줄이거나 350자 제한을 끄세요.');

    if (!info.selected.length) note('NO_PART', '통증 부위를 선택하지 않았습니다.');
    if (st.parts.other.on && free(st.parts.other.text) === '') note('OTHER_EMPTY', '기타 부위 이름이 비어 있어 문구에서 뺐습니다.');
    const nrsMissing = info.named.filter(x => !validNrs(x.p.nrs)).map(x => x.text);
    if (nrsMissing.length) note('NRS_MISSING', 'NRS가 비어 있습니다: ' + nrsMissing.join(', ') + '.');
    if (cycle === 1) {
      if (!anyTx(st.planTx)) note('TX_MISSING', '치료를 선택하지 않았습니다.');
      if (!nextText(st.next)) note('NEXT_MISSING', '다음 평가 시점이 비어 있습니다.');
    } else {
      if (!anyTx(st.priorTx)) note('PRIOR_TX_MISSING', '1차 이후 받은 치료를 선택하지 않았습니다.');
      if (!free(st.opinion)) note('OPINION_EMPTY', '판독 소견이 비어 있습니다.');
      if (!JUDGEMENTS.includes(st.judgement)) note('JUDGEMENT_MISSING', '호전/유지/악화를 선택하지 않았습니다.');
      if (st.continuation !== 'continue' && st.continuation !== 'stop') note('CONTINUATION_MISSING', '치료 지속/종료를 선택하지 않았습니다.');
      else if (st.continuation === 'continue' && !nextText(st.next)) note('NEXT_MISSING', '다음 평가 시점이 비어 있습니다.');
    }
    if (manual.text !== null && !frameChanged && manual.base !== auto) note('TEXT_STALE', '입력이 바뀌었지만 직접 고친 문구에는 반영되지 않았습니다. 반영하려면 ‘자동 문구로 되돌리기’를 누르세요.');
    if (!st.limitOn && over > 0) note('OVER_LIMIT_OFF', LIMIT + '자를 ' + over + '자 넘었습니다. 복사는 되지만 EDI 프로그램에서 뒷부분이 잘리거나 막힐 수 있으니 붙여넣은 뒤 끝까지 들어갔는지 확인하세요.');

    return {
      text, autoText: auto, length, limit: LIMIT, limitOn: st.limitOn, over, cycle,
      frame: frames ? 'custom' : 'example', frameText: template, wordedFrame: frame, variant, variants: frames ? frames[cycle].length : 0, manual: manual.text !== null,
      parsed: { first, second }, values,
      valuesChecked, valuesOk: check.ok, missingValues: check.missing,
      blocks, notes,
      canCopy: blocks.length === 0
    };
  }

  return Object.freeze({
    VERSION, LIMIT, DEFAULTS, PARTS, SIDES, TREATMENTS, NEXT_PRESETS, JUDGEMENTS, ITEMS,
    POINTS, MEASURES, FRAME_VARS, EXAMPLE_FRAMES, codePoints, cleanPaste, free, clip, tidy, parseMoire, blankState, normalizeState, partPoints, txPhrase, nextText,
    renderFrame, checkFrame, checkFrameSet, frameList, splitFrames, splitFrameSets, STYLE_CHOICES, styleRecipe, exampleFrames, framePrompt, valueTokens, verifyValues, sampleState, compose,
    wordFrame, FRAME_DAYS, frameTimeLeft
  });
}));
