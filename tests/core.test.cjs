'use strict';
// QA-01~04: 순수 로직 검수. 실행: 이 업무 폴더에서 node --test tests/core.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { Core, temoText, FIRST, SECOND, firstState, secondState, EXPECTED_FIRST, EXPECTED_SECOND, DOCTOR_A, DOCTOR_B, DOCTOR_C, DOCTOR_W } = require('./fixtures.cjs');

const FIRST_VALUES = {
  shoulder_angle: '1.2º', pelvis_angle: '-0.8º', contour_interval: '6mm', contour_left: '12개', contour_right: '10개',
  contour_diff: '2개', shoulder_height_diff: '0.85cm', shoulder_ratio: '1.08:1', pelvis_ratio: '1:1.1'
};
const codes = list => list.map(x => x.code);

// ---------- QA-01 붙여넣기 해석 ----------
test('QA-01a 합성 TEMO 복사문 9항목을 글자 그대로 읽는다', () => {
  const p = Core.parseMoire(FIRST);
  assert.equal(p.ok, true);
  assert.equal(p.empty, false);
  assert.deepEqual(p.values, FIRST_VALUES);
  assert.equal(p.items.length, 9);
});

test('QA-01b 음수·-0.0·0개 값을 바꾸지 않는다 (0개 추가 경고 없음)', () => {
  const p = Core.parseMoire(temoText({ shoulder: -0.04, left: 0, right: 0 }));
  assert.equal(p.ok, true);
  assert.equal(p.values.shoulder_angle, '-0.0º');
  assert.equal(p.values.contour_left, '0개');
  assert.equal(p.values.contour_diff, '0개');
  const r = Core.compose(firstState({ paste1: temoText({ shoulder: -0.04, left: 0, right: 0 }) }));
  assert.deepEqual(codes(r.blocks), []);
  assert.ok(r.text.includes('어깨수평 -0.0º'));
  assert.ok(r.text.includes('좌 0개·우 0개·차 0개'));
});

test('QA-01c 값이 없으면 미확인으로 두고 0으로 채우지 않는다', () => {
  const p = Core.parseMoire(temoText({ left: null }));
  assert.equal(p.ok, false);
  const left = p.items.find(i => i.key === 'contour_left');
  assert.equal(left.ok, false);
  assert.equal(left.reason, 'invalid');
  assert.equal(p.values.contour_left, null);
  const r = Core.compose(firstState({ paste1: temoText({ left: null }) }));
  assert.ok(codes(r.blocks).includes('PASTE1_UNREADABLE'));
  assert.ok(r.text.includes('좌 미확인'));
  assert.ok(!/좌 0개/.test(r.text));
});

test('QA-01d 비율이 ‘-’로 나오면 미확인', () => {
  const p = Core.parseMoire(temoText({ xs: [undefined, 0.2, -0.15, 0.17] }));
  assert.equal(p.values.shoulder_ratio, null);
  assert.equal(p.values.pelvis_ratio, null);
  assert.equal(p.problems, 2);
});

test('QA-01e CRLF·NBSP·보이지 않는 문자·앞뒤 잡문이 있어도 값은 같다', () => {
  const messy = '\uFEFF환자 결과\r\n' + FIRST.replace(/\n/g, '\r\n').replace('어깨 : ', '어깨\u00A0: ').replace('12개', '12개\u200B') + '\r\n\r\n끝';
  const p = Core.parseMoire(messy);
  assert.equal(p.ok, true);
  assert.deepEqual(p.values, FIRST_VALUES);
});

test('QA-01f 두 결과를 한 칸에 붙여넣으면 중복으로 미확인', () => {
  const p = Core.parseMoire(FIRST + '\n' + SECOND);
  assert.equal(p.ok, false);
  assert.equal(p.problems, 9);
  assert.ok(p.items.every(i => i.reason === 'duplicate'));
});

test('QA-01g 관련 없는 글·빈 칸·일부만 붙여넣기', () => {
  const junk = Core.parseMoire('안녕하세요\n어깨 통증 있음');
  assert.equal(junk.ok, false);
  assert.ok(junk.items.every(i => i.reason === 'missing'));
  const empty = Core.parseMoire('  \n ');
  assert.equal(empty.empty, true);
  assert.equal(empty.ok, false);
  const partial = Core.parseMoire(FIRST.split('\n').slice(0, 5).join('\n'));
  assert.equal(partial.ok, false);
  assert.ok(partial.items.filter(i => i.reason === 'missing').length >= 5);
});

test('QA-01h 도(°) 기호와 공백 차이도 그대로 보존', () => {
  const literal = '기준점 수평도\n어깨: 2.5° / 골반: 0.0°\n등고선 비교\n등고선 간격: 6mm\n좌측 등고선 개수: 9개\n우측 등고선 개수: 11개\n좌우측 등고선 개수 차이: 2개\n어깨 높이 차이: -1.2cm\n어깨 좌우측 길이 비율: 1:1.05\n골반 좌우측 길이 비율: 1.1:1';
  const p = Core.parseMoire(literal);
  assert.equal(p.ok, true);
  assert.equal(p.values.shoulder_angle, '2.5°');
  assert.equal(p.values.pelvis_angle, '0.0°');
  assert.equal(p.values.shoulder_height_diff, '-1.2cm');
});

// ---------- QA-02 문구 구성 ----------
test('QA-02a 1차 기준 문구가 글자 단위로 일치', () => {
  const r = Core.compose(firstState());
  assert.equal(r.text, EXPECTED_FIRST);
  assert.equal(r.length, 317);
  assert.equal(r.canCopy, true);
  assert.deepEqual(r.notes, []);
  assert.equal(r.valuesChecked, true);
  assert.equal(r.valuesOk, true);
  assert.ok(!/[\r\n]/.test(r.text));
});

test('QA-02b 2차 기준 문구가 글자 단위로 일치하고 350자 켜짐이면 차단(기본 꺼짐이면 경고만)', () => {
  const byDefault = Core.compose(secondState());
  assert.equal(byDefault.limitOn, false, '350자 제한은 기본 꺼짐(2026-11-19 사용자 결정)');
  assert.equal(byDefault.canCopy, true);
  assert.ok(codes(byDefault.notes).includes('OVER_LIMIT_OFF'));
  const r = Core.compose(secondState({ limitOn: true }));
  assert.equal(r.text, EXPECTED_SECOND);
  assert.equal(r.length, 418);
  assert.equal(r.over, 68);
  assert.deepEqual(codes(r.blocks), ['OVER_LIMIT']);
  assert.match(r.blocks[0].message, /68자 넘었습니다/);
  assert.equal(r.valuesOk, true);
});

test('QA-02c 부위가 하나면 NRS 숫자만, 점수 없는 부위는 빼고 안내', () => {
  const one = Core.compose(firstState({ parts: { neck: { on: true, nrs: 6 } } }));
  assert.ok(one.text.includes('목 통증 지속(NRS 6)하여'));
  assert.ok(one.text.includes('[치료계획] 목(견외수·대추·풍지·견정(GB21)) 부위 침, 약침, 뜸 및 추나 치료로'));
  const miss = Core.compose(firstState({ parts: { neck: { on: true, nrs: 6 }, shoulder: { on: true, side: '우측', nrs: null } } }));
  assert.ok(miss.text.includes('목·우측 어깨 통증 지속(NRS 목 6)하여'));
  assert.deepEqual(codes(miss.notes), ['NRS_MISSING']);
  assert.match(miss.notes[0].message, /우측 어깨/);
  const none = Core.compose(firstState({ parts: { neck: { on: true, nrs: null } } }));
  assert.ok(none.text.includes('목 통증 지속하여'));
});

test('QA-02d 수상일·사고 내용 생략 조합', () => {
  assert.ok(Core.compose(firstState({ injuryDate: '' })).text.startsWith('[검사시행 사유] 교통사고 수상 후 4주 이상 경과에도'));
  assert.ok(Core.compose(firstState({ accident: '' })).text.startsWith('[검사시행 사유] 2026-10-01 수상 후 4주 이상 경과에도'));
  assert.ok(Core.compose(firstState({ injuryDate: '', accident: '  ' })).text.startsWith('[검사시행 사유] 수상 후 4주 이상 경과에도'));
  assert.ok(Core.compose(firstState({ accident: '교통사고(후방 추돌)' })).text.includes('2026-10-01 교통사고(후방 추돌) 수상 후'));
});

test('QA-02e 치료 조합: 침·약침·뜸은 부위 연결, 추나는 부위 없음', () => {
  const chunaOnly = Core.compose(firstState({ planTx: { chuna: true } }));
  assert.ok(chunaOnly.text.endsWith('[치료계획] 추나 치료로 척추·골반 정렬 교정 및 통증 완화 목표, 4주 후 재평가.'));
  const acuOnly = Core.compose(firstState({ planTx: { acu: true } }));
  assert.ok(acuOnly.text.endsWith('[치료계획] 목(견외수·대추·풍지·견정(GB21))·우측 어깨(견우·견료·천종·견정(GB21)) 부위 침 치료로 척추·골반 정렬 교정 및 통증 완화 목표, 4주 후 재평가.'));
  const pharmMoxa = Core.compose(firstState({ planTx: { pharm: true, moxa: true } }));
  assert.ok(pharmMoxa.text.endsWith('[치료계획] 목(견외수·대추·풍지·견정(GB21))·우측 어깨(견우·견료·천종·견정(GB21)) 부위 약침, 뜸 치료로 척추·골반 정렬 교정 및 통증 완화 목표, 4주 후 재평가.'));
  const noTx = Core.compose(firstState({ planTx: {} }));
  assert.ok(noTx.text.endsWith('[치료계획] 척추·골반 정렬 교정 및 통증 완화 목표, 4주 후 재평가.'));
  assert.deepEqual(codes(noTx.notes), ['TX_MISSING']);
  const noParts = Core.compose(firstState({ parts: {}, planTx: { acu: true, chuna: true } }));
  assert.ok(noParts.text.includes('수상 후 4주 이상 경과에도 통증 지속하여'));
  assert.ok(noParts.text.endsWith('[치료계획] 침 및 추나 치료로 척추·골반 정렬 교정 및 통증 완화 목표, 4주 후 재평가.'));
  assert.ok(codes(noParts.notes).includes('NO_PART'));
});

test('QA-02f 치료 목표·다음 평가 시점 조합', () => {
  // 틀 방식(EDI-18): 목표가 비면 예시 틀의 [[{치료목표} 목표, ]] 부분이 빠진다.
  assert.ok(Core.compose(firstState({ goal: '' })).text.endsWith('추나 치료로 4주 후 재평가.'));
  assert.ok(Core.compose(firstState({ next: { preset: 'custom', custom: '치료 10회 후' } })).text.endsWith('통증 완화 목표, 치료 10회 후 재평가.'));
  const noNext = Core.compose(firstState({ next: { preset: '', custom: '' } }));
  assert.ok(noNext.text.endsWith('추나 치료로 척추·골반 정렬 교정 및 통증 완화 목표.'));
  assert.deepEqual(codes(noNext.notes), ['NEXT_MISSING']);
  const nothing = Core.compose(firstState({ planTx: {}, goal: '', next: {} }));
  assert.ok(nothing.text.endsWith('[치료계획]'));
  const custom = Core.compose(firstState({ goal: '통증 완화' }));
  assert.ok(custom.text.endsWith('추나 치료로 통증 완화 목표, 4주 후 재평가.'));
});

test('QA-02g 2차 평가: 종료·판정 없음·1차 이후 치료 없음·소견 없음', () => {
  const stop = Core.compose(secondState({ continuation: 'stop' }));
  assert.ok(stop.text.endsWith('[치료 후 평가] 호전. 치료 종료.'));
  const noJudge = Core.compose(secondState({ judgement: '' }));
  assert.ok(noJudge.text.endsWith('[치료 후 평가] 척추·골반 정렬 교정 및 통증 완화 위해 치료 지속, 4주 후 재평가.'));
  assert.ok(codes(noJudge.notes).includes('JUDGEMENT_MISSING'));
  const noCont = Core.compose(secondState({ continuation: '' }));
  assert.ok(noCont.text.endsWith('[치료 후 평가] 호전. 4주 후 재평가.'));
  assert.ok(codes(noCont.notes).includes('CONTINUATION_MISSING'));
  const noPrior = Core.compose(secondState({ priorTx: {} }));
  assert.ok(noPrior.text.includes('하여 1차 검사(2026-10-20) 후 경과 확인 위해 2차 검사 시행.'));
  assert.ok(codes(noPrior.notes).includes('PRIOR_TX_MISSING'));
  const noOpinion = Core.compose(secondState({ opinion: '   ' }));
  assert.ok(!noOpinion.text.includes('소견:'));
  assert.ok(codes(noOpinion.notes).includes('OPINION_EMPTY'));
  const noDate = Core.compose(secondState({ firstExamDate: '' }));
  assert.ok(noDate.text.includes('하여 1차 검사 후 목(견외수·대추·풍지·견정(GB21))·우측 어깨(견우·견료·천종·견정(GB21)) 부위'));
  const worse = Core.compose(secondState({ judgement: '악화' }));
  assert.ok(worse.text.includes('[치료 후 평가] 악화. '));
});

test('QA-02h 등고선 간격이 다르면 화살표로, 같으면 한 번', () => {
  const r = Core.compose(secondState({ paste2: SECOND.replace('6mm', '7mm') }));
  assert.ok(r.text.includes('등고선(6mm→7mm) 좌 12개→11개'));
  assert.equal(r.valuesOk, true);
  assert.ok(Core.compose(secondState()).text.includes('등고선(6mm) 좌'));
});

test('QA-02i 직접 입력의 줄바꿈·탭·연속 공백은 한 칸', () => {
  const r = Core.compose(secondState({ opinion: '어깨 수평\n차이 감소.\t\t좌우  차이 감소.', accident: '교통\r\n사고' }));
  assert.ok(r.text.includes('소견: 어깨 수평 차이 감소. 좌우 차이 감소.'));
  assert.ok(r.text.includes('2026-10-01 교통 사고 수상 후'));
  assert.ok(!/[\r\n\t]/.test(r.text));
});

test('QA-02j 부위 순서·기타 부위', () => {
  const order = Core.compose(firstState({ parts: { knee: { on: true, side: '좌측', nrs: 4 }, neck: { on: true, nrs: 6 } } }));
  assert.ok(order.text.includes('목·좌측 무릎 통증 지속(NRS 목 6, 좌측 무릎 4)'));
  const other = Core.compose(firstState({ parts: { neck: { on: true, nrs: 6 }, other: { on: true, text: '좌측 손목', nrs: 3 } } }));
  assert.ok(other.text.includes('목·좌측 손목 통증 지속(NRS 목 6, 좌측 손목 3)'));
  assert.ok(other.text.includes('[치료계획] 목(견외수·대추·풍지·견정(GB21))·좌측 손목 부위 침'));
  const blankOther = Core.compose(firstState({ parts: { neck: { on: true, nrs: 6 }, other: { on: true, text: ' ', nrs: 3 } } }));
  assert.ok(blankOther.text.includes('목 통증 지속(NRS 6)'));
  assert.ok(codes(blankOther.notes).includes('OTHER_EMPTY'));
  const both = Core.compose(firstState({ parts: { shoulder: { on: true, side: '양측', nrs: 5 }, knee: { on: true, side: '우측', nrs: 2 } } }));
  assert.ok(both.text.includes('양측 어깨·우측 무릎 통증 지속(NRS 양측 어깨 5, 우측 무릎 2)'));
});

// ---------- QA-03 350자 ----------
test('QA-03a 350자는 허용, 351자는 차단, 제한을 끄면 허용', () => {
  const baseLen = Core.compose(firstState({ accident: '' })).length;
  assert.ok(baseLen < 340);
  const at = n => firstState({ accident: '가'.repeat(n - baseLen - 1), limitOn: true });
  const r350 = Core.compose(at(350));
  assert.equal(r350.length, 350);
  assert.equal(r350.canCopy, true);
  const r351 = Core.compose(at(351));
  assert.equal(r351.length, 351);
  assert.deepEqual(codes(r351.blocks), ['OVER_LIMIT']);
  assert.match(r351.blocks[0].message, /1자 넘었습니다/);
  const off = Core.compose(Object.assign(at(351), { limitOn: false }));
  assert.equal(off.canCopy, true);
  assert.deepEqual(codes(off.notes), ['OVER_LIMIT_OFF']);
  const offSecond = Core.compose(secondState({ limitOn: false }));
  assert.equal(offSecond.canCopy, true);
  assert.equal(offSecond.text, EXPECTED_SECOND);
});

test('QA-03b 글자 수는 공백 포함 코드포인트', () => {
  assert.equal(Core.codePoints('가 나'), 3);
  assert.equal(Core.codePoints('😀'), 1);
  const plain = Core.compose(secondState({ opinion: 'a' })).length;
  const emoji = Core.compose(secondState({ opinion: '😀' })).length;
  assert.equal(emoji, plain);
});

// ---------- QA-04 차단·안내 ----------
test('QA-04a 붙여넣기 차단: 1차 비어 있음, 2차 한쪽 없음, 읽지 못한 항목', () => {
  assert.deepEqual(codes(Core.compose(firstState({ paste1: '' })).blocks), ['PASTE1_EMPTY']);
  const noSecond = Core.compose(secondState({ paste2: '', limitOn: false }));
  assert.deepEqual(codes(noSecond.blocks), ['PASTE2_EMPTY']);
  const noFirst = Core.compose(secondState({ paste1: '', limitOn: false }));
  assert.deepEqual(codes(noFirst.blocks), ['PASTE1_EMPTY']);
  assert.match(noFirst.blocks[0].message, /^1차 결과를/);
  const bad = Core.compose(secondState({ paste2: temoText({ right: null }), limitOn: false }));
  assert.deepEqual(codes(bad.blocks), ['PASTE2_UNREADABLE']);
  assert.match(bad.blocks[0].message, /1개: 우측 등고선 개수, 좌우측 등고선 개수 차이|2개: 우측 등고선 개수, 좌우측 등고선 개수 차이/);
  assert.ok(bad.text.includes('우 10개→미확인'));
});

test('QA-04b 어깨·무릎 좌우 미선택은 차단', () => {
  const r = Core.compose(firstState({ parts: { shoulder: { on: true, side: '', nrs: 5 }, knee: { on: true, side: '', nrs: 3 } } }));
  assert.deepEqual(codes(r.blocks), ['SIDE_MISSING']);
  assert.equal(r.blocks[0].message, '어깨·무릎의 좌측/우측/양측을 선택하세요.');
  const ok = Core.compose(firstState({ parts: { shoulder: { on: true, side: '좌측', nrs: 5 } } }));
  assert.deepEqual(codes(ok.blocks), []);
});

// 최종 문구 전체를 직접 고친 상태를 만든다(EDI-18: 직접 수정은 회차별 최종 문구 단위).
function edited(state, change, options) {
  const auto = Core.compose(state, options);
  const s = JSON.parse(JSON.stringify(state));
  s.manual[s.cycle] = { text: change(auto.text), base: auto.autoText, frame: auto.frameText };
  return Core.compose(s, options);
}

test('QA-04c 판독 수치 대조(틀 방식): 바뀐 값·빠진 값·앞뒤로 붙은 숫자·1·2차 순서 바뀜은 차단', () => {
  const ok = edited(firstState(), t => t.replace('척추·골반 정렬 및 좌우 균형 확인 위해', '정렬 확인 위해'));
  assert.deepEqual(codes(ok.blocks), []);
  assert.equal(ok.valuesOk, true);
  const cases = [
    ['1.2º', '1.3º'], ['-0.8º', '0.8º'], ['(6mm)', '(16mm)'], ['좌 12개', '좌 112개'], ['0.85cm', '0.85cm5'],
    ['골반 1:1.1', '골반 1:1.15'], ['골반 1:1.1', '골반 11:1.1'], ['어깨수평 1.2º', '어깨수평 11.2º'], ['어깨수평 1.2º, ', '']
  ];
  for (const [from, to] of cases) {
    const r = edited(firstState(), t => t.replace(from, to));
    assert.deepEqual(codes(r.blocks), ['VALUE_MISMATCH'], from + ' → ' + to);
    assert.equal(r.valuesOk, false);
    assert.equal(r.canCopy, false);
  }
  assert.deepEqual(edited(firstState(), t => t.replace('1.2º', '1.3º')).missingValues, ['1.2º']);
  const second = { limitOn: false };
  assert.deepEqual(codes(edited(secondState(second), t => t).blocks), []);
  const swapped = edited(secondState(second), t => t.replace('1.2º→0.6º', '0.6º→1.2º'));
  assert.deepEqual(codes(swapped.blocks), ['VALUE_ORDER']);
  assert.match(swapped.blocks[0].message, /순서/);
  const dropSame = edited(secondState(second), t => t.replace('우 10개→10개', '우 10개'));
  assert.deepEqual(codes(dropSame.blocks), ['VALUE_MISMATCH'], '1·2차 값이 같아도 두 번 다 있어야 한다');
  assert.deepEqual(dropSame.missingValues, ['10개']);
  // 소견에 있던 수치도 자동 문구에 있었으면 남아 있어야 한다(대조 기준은 자동 문구).
  const withOpinion = secondState({ opinion: '어깨 수평 1.2º에서 0.6º로 감소', limitOn: false });
  assert.deepEqual(codes(edited(withOpinion, t => t.replace('1.2º에서', '어깨에서')).blocks), ['VALUE_MISMATCH']);
});

test('QA-04d 직접 수정(최종 문구 전체)·미반영 안내·회차별 보관', () => {
  const s = firstState();
  const auto = Core.compose(s);
  s.manual[1] = { text: auto.text.replace('1차 검사 시행.', '1차\n모아레 검사\t시행.'), base: auto.autoText, frame: auto.frameText };
  const manual = Core.compose(s);
  assert.ok(manual.text.includes('1차 모아레 검사 시행.'), '줄바꿈·탭은 한 칸');
  assert.equal(manual.manual, true);
  assert.equal(manual.autoText, auto.text, '자동 문구는 따로 돌려준다');
  assert.deepEqual(codes(manual.notes), []);
  assert.deepEqual(codes(manual.blocks), []);
  s.parts.neck.nrs = 3;
  const stale = Core.compose(s);
  assert.ok(stale.text.includes('1차 모아레 검사 시행.'), '입력이 바뀌어도 직접 고친 문구는 그대로');
  assert.deepEqual(codes(stale.notes), ['TEXT_STALE']);
  const asSecond = Core.compose(Object.assign(secondState({ limitOn: false }), { manual: s.manual }));
  assert.equal(asSecond.manual, false, '1차에서 고친 문구는 2차에 쓰지 않는다');
  assert.equal(asSecond.text, asSecond.autoText);
  const emptied = Core.compose(Object.assign(firstState(), { manual: { 1: { text: '   ', base: auto.autoText, frame: auto.frameText } } }));
  assert.equal(emptied.text, '');
  assert.ok(codes(emptied.blocks).includes('VALUE_MISMATCH'), '비운 문구는 수치가 없어 막힌다');
});

test('QA-04e compose는 입력을 바꾸지 않고, 빈 입력도 처리한다', () => {
  const s = secondState();
  const before = JSON.stringify(s);
  Core.compose(s);
  assert.equal(JSON.stringify(s), before);
  const empty = Core.compose({});
  assert.deepEqual(codes(empty.blocks), ['PASTE1_EMPTY']);
  assert.ok(codes(empty.notes).includes('NO_PART'));
  assert.equal(empty.limitOn, false, '350자 제한 기본 꺼짐');
});

// ---------- 독립 검수 r1 지적 (REV-01·02, 개선 제안) ----------
// 특수 문자는 소스에 그대로 넣지 않고 코드값으로 만든다(보이지 않는 문자 혼입 방지).
const C = code => String.fromCharCode(code);
const ODD_CODES = [0x0B, 0x0C, 0x85, 0xA0, 0x1680, 0x2000, 0x2003, 0x200A, 0x200B, 0x200C, 0x200D, 0x2028, 0x2029, 0x202F, 0x205F, 0x2060, 0x3000, 0xFEFF];
const hasOdd = text => ODD_CODES.some(code => text.includes(C(code)));

test('REV-01 소견의 줄 구분 문자 때문에 수치가 맞는데도 불일치로 막지 않는다', () => {
  for (const code of [0x2028, 0x2029, 0x85, 0x0B, 0x0C]) {
    const r = Core.compose(secondState({ opinion: '어깨 수평 차이 감소.' + C(code) + '좌우 차이 감소.', limitOn: false }));
    assert.deepEqual(codes(r.blocks), [], 'U+' + code.toString(16));
    assert.ok(r.text.includes('소견: 어깨 수평 차이 감소. 좌우 차이 감소. [치료 후 평가]'));
    assert.equal(r.valuesOk, true);
  }
});

test('REV-01b 문구 안의 머리말 글자는 수치 대조에 영향이 없다(머리말 검사는 EDI-18에서 폐지: 머리말은 원장님 틀이 정함)', () => {
  const dup = edited(firstState(), t => t.replace('1차 검사 시행.', '1차 검사 시행. [환자평가·판독결과] 아래와 같음.'));
  assert.deepEqual(codes(dup.blocks), []);
  assert.equal(dup.valuesOk, true);
  const input = Core.compose(secondState({ opinion: '감소. [치료계획] 계속', limitOn: false }));
  assert.deepEqual(codes(input.blocks), []);
  assert.equal(input.valuesOk, true);
  assert.equal('HEADER_IN_TEXT' in Core, false);
});

test('REV-02 모든 줄바꿈·공백류 문자를 한 칸으로 바꾸고 보이지 않는 문자는 지운다', () => {
  for (const code of ODD_CODES) {
    const ch = C(code);
    const s = secondState({ accident: '교통' + ch + '사고', opinion: '감소' + ch + '확인.', purpose2: '경과' + ch + '확인', goal: '통증' + ch + '완화', limitOn: false });
    s.parts.other = { on: true, text: '좌측' + ch + '손목', nrs: 2 };
    s.next = { preset: 'custom', custom: '치료' + ch + '10회 후' };
    const r = Core.compose(s);
    assert.equal(hasOdd(r.text), false, 'U+' + code.toString(16) + ' remained');
    assert.ok(!/ {2}/.test(r.text), 'double space U+' + code.toString(16));
    assert.deepEqual(codes(r.blocks), []);
  }
  assert.equal(Core.free('교통' + C(0x2028) + '사고'), '교통 사고');
  assert.equal(Core.free('교' + C(0x200B) + '통'), '교통');
  const manual = edited(firstState(), t => t.replace('1차 검사 시행.', '1차' + C(0x2029) + '검사' + C(0x0B) + '시행' + C(0x200B) + '함.'));
  assert.ok(manual.text.includes('하여 척추·골반 정렬 및 좌우 균형 확인 위해 1차 검사 시행함. [환자평가·판독결과]'));
  assert.equal(hasOdd(manual.text), false);
  const pasteWithSeparators = FIRST.split('\n').join(C(0x2028));
  assert.equal(Core.parseMoire(pasteWithSeparators).ok, true, '줄 구분 문자로 나뉜 복사문도 읽는다');
});

test('IMP-03 입력이 이미 틀의 연결어로 끝나면 덧붙이지 않는다(끝 구두점만 정리)', () => {
  const r = Core.compose(firstState({ goal: '척추 교정 목표.', next: { preset: 'custom', custom: '치료 10회 후 재평가' }, purpose1: '정렬 확인 위해', accident: '교통사고 수상' }));
  assert.ok(r.text.includes('2026-10-01 교통사고 수상 후 4주 이상 경과에도'));
  assert.ok(r.text.includes('하여 정렬 확인 위해 1차 검사 시행.'));
  assert.ok(r.text.endsWith('추나 치료로 척추 교정 목표, 치료 10회 후 재평가.'));
  for (const doubled of ['목표 목표', '재평가 재평가', '위해 위해', '수상 수상', '..', '.,']) assert.ok(!r.text.includes(doubled), doubled);
  assert.ok(Core.compose(secondState({ goal: '통증 완화 목표', limitOn: false })).text.endsWith('[치료 후 평가] 호전. 통증 완화 목표 위해 치료 지속, 4주 후 재평가.'));
  assert.ok(Core.compose(secondState({ purpose2: '경과 확인.', limitOn: false })).text.includes('추나 치료 경과 확인 위해 2차 검사 시행.'));
});

// ---------- 독립 재검수 r2 지적 (REV-05·06) ----------
test('REV-06 방향 제어·보이는 서식 문자가 섞인 값은 지우지 않고 미확인으로 막는다', () => {
  const RLO = C(0x202E), PDF = C(0x202C);
  const tampered = FIRST.replace('어깨 높이 차이 : 0.85cm', '어깨 높이 차이 : ' + RLO + '58.0' + PDF + 'cm');
  const p = Core.parseMoire(tampered);
  assert.equal(p.items.find(i => i.key === 'shoulder_height_diff').ok, false);
  assert.equal(p.values.shoulder_height_diff, null);
  const r = Core.compose(firstState({ paste1: tampered }));
  assert.ok(codes(r.blocks).includes('PASTE1_UNREADABLE'));
  assert.ok(!r.text.includes('58.0cm'));
  for (const code of [0x200E, 0x200F, 0x202A, 0x202B, 0x202D, 0x2066, 0x2067, 0x2068, 0x2069, 0x06DD, 0x0600, 0x070F, 0x00AD]) {
    const t = FIRST.replace('0.85cm', '0.85' + C(code) + 'cm');
    assert.equal(Core.parseMoire(t).values.shoulder_height_diff, null, 'U+' + code.toString(16));
  }
  for (const code of [0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF]) {
    const t = FIRST.replace('0.85cm', '0.85' + C(code) + 'cm');
    assert.equal(Core.parseMoire(t).values.shoulder_height_diff, '0.85cm', 'U+' + code.toString(16));
  }
});

test('REV-05 조사·변형 표현으로 끝나도 연결어를 겹쳐 쓰지 않고 원문을 그대로 둔다', () => {
  const a = Core.compose(firstState({ goal: '기능 회복을 목표로', purpose1: '정렬 확인을 위해서', next: { preset: 'custom', custom: '2주 후 재평가 예정' } }));
  assert.ok(a.text.includes('하여 정렬 확인을 위해서 1차 검사 시행.'));
  assert.ok(a.text.endsWith('추나 치료로 기능 회복을 목표로, 2주 후 재평가 예정.'));
  const b2 = Core.compose(secondState({ goal: '통증 완화를 위해', limitOn: false }));
  assert.ok(b2.text.endsWith('[치료 후 평가] 호전. 통증 완화를 위해 치료 지속, 4주 후 재평가.'));
  const c = Core.compose(secondState({ goal: '통증 완화를 위하여', purpose2: '경과 확인을 위하여', limitOn: false }));
  assert.ok(c.text.includes('추나 치료 경과 확인을 위하여 2차 검사 시행.'));
  assert.ok(c.text.endsWith('호전. 통증 완화를 위하여 치료 지속, 4주 후 재평가.'));
  const d = Core.compose(firstState({ goal: '통증 완화를 위해' }));
  assert.ok(d.text.endsWith('추나 치료로 통증 완화를 위해, 4주 후 재평가.'));
  for (const t of [a.text, b2.text, c.text, d.text]) {
    for (const doubled of ['목표로 목표', '위해서 위해', '위하여 위해', '위해 위해', '재평가 예정 재평가', '위해 목표', '목표로 위해']) assert.ok(!t.includes(doubled), doubled);
  }
  assert.equal(Core.compose(firstState()).text, EXPECTED_FIRST, '기본 문장은 그대로');
  assert.equal(Core.compose(secondState()).text, EXPECTED_SECOND, '기본 문장은 그대로');
});

// ---------- 독립 재검수 r3 지적 (REV-08) ----------
test('REV-08 2차 치료 목표 끝의 말을 지우지 않는다(뜻 보존)', () => {
  const end = goal => Core.compose(secondState({ goal, limitOn: false })).text.split('[치료 후 평가] ')[1];
  assert.equal(end('단기 목표'), '호전. 단기 목표 위해 치료 지속, 4주 후 재평가.');
  assert.equal(end('최종목표'), '호전. 최종목표 위해 치료 지속, 4주 후 재평가.');
  assert.equal(end('NRS 3 이하 목표'), '호전. NRS 3 이하 목표 위해 치료 지속, 4주 후 재평가.');
  assert.equal(end('기능 회복을 목표로'), '호전. 기능 회복을 목표로 치료 지속, 4주 후 재평가.');
  assert.ok(Core.compose(secondState({ purpose2: '경과 확인하고자', limitOn: false })).text.includes('추나 치료 경과 확인하고자 2차 검사 시행.'));
  // 입력 문장은 끝 구두점 말고는 그대로 출력에 들어간다(문장 중간·끝의 단어를 지우지 않는다).
  const inputs = ['목표 체중 도달', '위해 요인 확인', '수상 레저 사고', '재평가 후 결정', '단기 목표', '통증 완화를 위해'];
  for (const goal of inputs) {
    assert.ok(Core.compose(firstState({ goal })).text.includes(goal), '1차 ' + goal);
    assert.ok(Core.compose(secondState({ goal, limitOn: false })).text.includes(goal), '2차 ' + goal);
  }
  assert.ok(Core.compose(firstState({ accident: '수상 레저 사고' })).text.includes('2026-10-01 수상 레저 사고 수상 후 4주'));
});

test('IMP-09 차단·안내 문장은 마침표로 끝난다(이어 읽어도 문장이 섞이지 않음)', () => {
  // 350자 제한을 켠 경우(차단 3개 이상)와 기본 꺼짐(넘으면 경고)을 모두 본다.
  const r = Core.compose(secondState({ paste2: temoText({ right: null }), parts: { shoulder: { on: true, side: '', nrs: null } }, limitOn: true }));
  assert.ok(r.blocks.length >= 3);
  const off = Core.compose(secondState());
  assert.ok(codes(off.notes).includes('OVER_LIMIT_OFF'));
  for (const item of [...r.blocks, ...r.notes, ...off.notes]) assert.match(item.message, /[.)]$/, item.code + ': ' + item.message);
});

// ---------- EDI-17 혈자리 (2026-11-18 사용자 결정: 기존 표 초기값 + 클릭 수정, 부위별 한 묶음, 2차에도) ----------
test('EDI-17a 부위를 고르면 표의 혈자리가 초기값으로 들어가고, 부위별 한 묶음으로 쓴다', () => {
  assert.deepEqual(Core.POINTS.neck, ['견외수', '대추', '풍지', '견정(GB21)']);
  assert.deepEqual(Core.POINTS.waist, ['신수', '대장수', '협척혈']);
  const r = Core.compose(firstState({ parts: { waist: { on: true, nrs: 7 }, knee: { on: true, side: '양측', nrs: 4 } } }));
  assert.ok(r.text.includes('[치료계획] 허리(신수·대장수·협척혈)·양측 무릎(내슬안·독비·족삼리·혈해) 부위 침, 약침, 뜸 및 추나 치료로'));
  assert.ok(r.text.includes('허리·양측 무릎 통증 지속(NRS 허리 7, 양측 무릎 4)'), '사유 문장의 부위에는 혈자리를 넣지 않는다');
});

test('EDI-17b 클릭으로 뺀 혈자리는 빠지고, 직접 적은 혈자리는 표 순서 뒤에 중복 없이 붙는다', () => {
  const s = firstState();
  s.parts.neck.points = ['풍지', '대추'];
  s.parts.neck.extra = '곡지, 합곡·대추 / 후계';
  s.parts.shoulder.points = [];
  const r = Core.compose(s);
  assert.ok(r.text.includes('[치료계획] 목(대추·풍지·곡지·합곡·후계)·우측 어깨 부위 침'));
  const other = firstState({ parts: { other: { on: true, text: '좌측 손목', nrs: 2, extra: '양계, 합곡' } } });
  assert.ok(Core.compose(other).text.includes('[치료계획] 좌측 손목(양계·합곡) 부위 침'));
  assert.deepEqual(Core.partPoints(Core.PARTS[0], { points: null, extra: '' }), ['견외수', '대추', '풍지', '견정(GB21)']);
});

test('EDI-17c 추나만이면 혈자리를 쓰지 않고, 2차의 1차 이후 치료에도 같은 혈자리를 쓴다', () => {
  assert.ok(Core.compose(firstState({ planTx: { chuna: true } })).text.endsWith('[치료계획] 추나 치료로 척추·골반 정렬 교정 및 통증 완화 목표, 4주 후 재평가.'));
  const s2 = secondState({ limitOn: false });
  s2.parts.shoulder.points = ['천종'];
  assert.ok(Core.compose(s2).text.includes('1차 검사(2026-10-20) 후 목(견외수·대추·풍지·견정(GB21))·우측 어깨(천종) 부위 침, 약침, 뜸 및 추나 치료 경과 확인'));
  const s = secondState();
  const before = JSON.stringify(s);
  Core.compose(s);
  assert.equal(JSON.stringify(s), before, '혈자리 기본값 계산이 입력을 바꾸지 않는다');
});

// ---------- EDI-18 원장님별 차팅 틀 (2026-11-19 사용자 결정: 처음 한 번 필수 설정, 이 PC에만 저장) ----------
const frameErrors = (frame, cycle) => Core.checkFrame(frame, cycle).errors.join(' / ');

test('EDI-18a 원장님 틀은 통과하고, 예시 틀·거의 베낀 틀은 막는다', () => {
  for (const F of [DOCTOR_A, DOCTOR_B]) for (const cycle of [1, 2]) {
    const c = Core.checkFrame(F[cycle], cycle);
    assert.equal(c.ok, true, cycle + '차: ' + c.errors.join(' / '));
    assert.deepEqual(c.warnings, [], cycle + '차 경고: ' + c.warnings.join(' / '));
    assert.ok(c.similarity < 0.8, '예시와 다른 문체 ' + c.similarity.toFixed(2));
  }
  const E1 = Core.EXAMPLE_FRAMES[1];
  for (const cycle of [1, 2]) assert.match(frameErrors(Core.EXAMPLE_FRAMES[cycle], cycle), /예시 틀과 너무 비슷합니다\(본문 100%\)/);
  // RV5-07: 머리말·문장부호만 바꾼 예시는 같은 문구로 본다(본문 비교).
  const headers = E1.replace('[검사시행 사유]', '[사유]').replace('[환자평가·판독결과]', '[판독]').replace('[치료계획]', '[계획]');
  assert.match(frameErrors(headers, 1), /너무 비슷합니다\(본문 100%\)/);
  assert.match(frameErrors(E1.replace(/, /g, '; ').replace(/\. /g, '; '), 1), /너무 비슷합니다\(본문 100%\)/);
  assert.match(frameErrors(E1.replace('재평가', '다시 평가'), 1), /너무 비슷합니다\(본문 9\d%\)/);
  const two = E1.replace('수상 후 4주 이상 경과에도', '다친 뒤 4주가 지나도').replace('통증 지속', '통증이 계속됨');
  assert.match(frameErrors(two, 1), /너무 비슷합니다\(본문 7\d%\)/, '구절 두 개만 바꾼 예시도 막는다');
  const three = Core.checkFrame(two.replace('1차 검사 시행', '모아레 1차 검사함'), 1);
  assert.equal(three.ok, true, '더 바꾸면 저장은 된다');
  assert.match(three.warnings.join(' '), /예시 틀과 비슷합니다\(본문 [67]\d%\)/);
});

test('EDI-18b 틀 검사: 수치·NRS·소견·판정 누락, 모르는 변수, [[ ]] 오류, 숫자로 적은 수치는 저장 불가', () => {
  assert.match(frameErrors('   ', 1), /비어 있습니다/);
  assert.match(frameErrors(DOCTOR_A[1].replace('[[{사고내용}로 ]]', '[[{사고내용}로 '), 1), /짝이 맞지 않거나/);
  assert.match(frameErrors(DOCTOR_A[1].replace('[[{사고내용}로 ]]', '[[{사고내용}로 [[{수상일} ]]]]'), 1), /짝이 맞지 않거나 겹쳐/);
  assert.match(frameErrors(DOCTOR_A[1].replace('{어깨수평}', '{어깨 수평도}'), 1), /수치 변수가 없거나.*\{어깨수평\}/);
  assert.match(frameErrors(DOCTOR_A[1].replace('{어깨수평}', '{어깨각도}'), 1), /쓸 수 없는 변수: \{어깨각도\}/);
  assert.match(frameErrors(DOCTOR_A[1].replace('어깨 기울기 {어깨수평}', '[[어깨 기울기 {어깨수평}]]'), 1), /\[\[ \]\] 안에 있습니다: \{어깨수평\}/);
  assert.match(frameErrors(DOCTOR_A[1].replace('[[({NRS})]]', ''), 1), /\{NRS\} 변수가 없습니다/);
  assert.match(frameErrors(DOCTOR_A[1].replace('{치료}', '{1차이후치료}'), 1), /1차 틀에 쓸 수 없는 변수: \{1차이후치료\}/);
  assert.match(frameErrors(DOCTOR_A[2].replace('{1차이후치료}', '{치료}'), 2), /2차 틀에 쓸 수 없는 변수: \{치료\}/);
  assert.match(frameErrors(DOCTOR_A[2].replace('{수치비교}', '{1차어깨수평}'), 2), /\{수치비교\}를 넣거나 1차·2차 수치 변수 18개/);
  assert.match(frameErrors(DOCTOR_B[2].replace('{2차골반길이비}', ''), 2), /18개/);
  assert.match(frameErrors(DOCTOR_A[2].replace('[[소견 {소견}. ]]', ''), 2), /\{소견\} 변수가 없습니다/);
  assert.match(frameErrors(DOCTOR_A[2].replace('[[{판정}, ]]', ''), 2), /\{판정\} 변수가 없습니다/);
  for (const literal of ['어깨 1.2º', '골반 -0.8°', '높이 0.85cm', '간격 6 mm', '비율 1:1.1', '등고선 차이 2개']) {
    assert.match(frameErrors(DOCTOR_A[1].replace('모아레 1차 검사함.', '모아레 1차 검사함. ' + literal + '.'), 1), /숫자로 적혀 있습니다/, literal);
  }
  assert.equal(Core.checkFrame(DOCTOR_A[1].replace('다친 뒤 4주가', '다친 뒤 4주 이상 2회'), 1).ok, true, '수치가 아닌 숫자는 괜찮다');
});

test('EDI-18c 틀 검사 경고: 넣으면 좋은 변수, 심평원 기재 항목', () => {
  const noPlan = Core.checkFrame(DOCTOR_A[1].replace('[치료계획] [[{치료} 시행, ]]', '[치료] '), 1);
  assert.equal(noPlan.ok, true);
  assert.match(noPlan.warnings.join(' '), /없는 말: 계획/);
  assert.match(noPlan.warnings.join(' '), /넣으면 좋은 변수: \{치료\}/);
  const second = Core.checkFrame(DOCTOR_A[2].replace('[[{치료여부}]]', ''), 2);
  assert.match(second.warnings.join(' '), /\{치료여부\}/);
});

test('EDI-18d 틀 채우기: 빈 변수의 [[ ]] 부분은 빠지고 남는 괄호·쉼표·마침표를 정리한다', () => {
  const v = { 부위: '목', NRS: '', 다음평가: '4주 후', 소견: '감소' };
  assert.equal(Core.renderFrame('[[{부위} ]]통증 지속[[({NRS})]].', v), '목 통증 지속.');
  assert.equal(Core.renderFrame('통증 지속({NRS}).', v), '통증 지속.');
  assert.equal(Core.renderFrame('소견 {소견}.. 평가: , {다음평가} 재검,.', v), '소견 감소. 평가: 4주 후 재검.');
  assert.equal(Core.renderFrame('[계획] [[{치료} ]].', v), '[계획]');
  assert.equal(Core.renderFrame('[[{없는변수} 앞]]뒤', v), '뒤');
  assert.equal(Core.renderFrame('{부위}{다음평가}', v), '목4주 후');
  // 입력 끝말과 틀 연결어가 같으면 틀 쪽만 뺀다(입력 글자는 그대로).
  assert.equal(Core.renderFrame('{치료목표} 목표로 치료.', { 치료목표: '통증 완화 목표로' }), '통증 완화 목표로 치료.');
  assert.equal(Core.renderFrame('{확인목적} 위하여 검사.', { 확인목적: '경과 확인을 위해' }), '경과 확인을 위해 검사.');
  assert.equal(Core.renderFrame('{확인목적} 확인 검사.', { 확인목적: '경과 확인' }), '경과 확인 검사.');
  assert.equal(Core.renderFrame('{치료목표} 목표.', { 치료목표: '목표 체중 도달' }), '목표 체중 도달 목표.', '앞쪽 낱말은 보지 않는다');
});

test('EDI-18e 저장한 틀로 문구를 만들고, 수치는 결과지 글자 그대로 쓴다', () => {
  const r1 = Core.compose(firstState(), { frames: DOCTOR_A, requireFrame: true });
  assert.equal(r1.frame, 'custom');
  assert.deepEqual(codes(r1.blocks), []);
  assert.equal(r1.canCopy, true);
  assert.equal(r1.valuesOk, true);
  assert.equal(r1.text, '[검사시행 사유] 교통사고로 다친 뒤 4주가 지나도 목·우측 어깨 통증이 계속됨(NRS 목 6, 우측 어깨 5). 척추·골반 정렬 및 좌우 균형 확인 위해 모아레 1차 검사함. [환자평가·판독결과] 어깨 기울기 1.2º, 골반 기울기 -0.8º. 등고선 간격 6mm 기준 좌 12개, 우 10개(차이 2개). 어깨 높이 차 0.85cm, 길이비 어깨 1.08:1·골반 1:1.1. [치료계획] 목(견외수·대추·풍지·견정(GB21))·우측 어깨(견우·견료·천종·견정(GB21)) 부위 침, 약침, 뜸 및 추나 치료 시행, 척추·골반 정렬 교정 및 통증 완화를 목표로 4주 후 다시 검사.');
  const r2 = Core.compose(secondState(), { frames: DOCTOR_B, requireFrame: true });
  assert.deepEqual(codes(r2.blocks), []);
  assert.equal(r2.length, 330);
  assert.ok(r2.text.includes('판독: 어깨 1.2º→0.6º, 골반 -0.8º→-0.3º, 등고선 간격 6mm→6mm L12개→11개 R10개→10개 차2개→1개, 어깨높이 0.85cm→0.4cm, 어깨비 1.08:1→1.01:1, 골반비 1:1.1→1:1.02.'));
  assert.ok(r2.text.endsWith('평가: 호전, 치료 지속, 4주 후 재검.'));
  const stop = Core.compose(secondState({ continuation: 'stop' }), { frames: DOCTOR_A });
  assert.ok(stop.text.endsWith('[치료 후 평가] 호전, 치료 종료.'));
  const withoutFrame = Core.compose(firstState());
  assert.equal(withoutFrame.frame, 'example');
  assert.equal(withoutFrame.text, EXPECTED_FIRST, '틀이 없으면 예시 틀로 미리보기만 만든다');
  const frames = { 1: DOCTOR_A[1], 2: DOCTOR_A[2] };
  const before = JSON.stringify(frames);
  Core.compose(firstState(), { frames });
  assert.equal(JSON.stringify(frames), before, '틀 객체를 바꾸지 않는다');
});

test('EDI-18f 틀을 저장하기 전에는 복사를 막고, 망가진 저장 틀도 막는다', () => {
  const missing = Core.compose(firstState(), { requireFrame: true });
  assert.deepEqual(codes(missing.blocks), ['FRAME_MISSING']);
  assert.equal(missing.canCopy, false);
  assert.equal(missing.text, EXPECTED_FIRST, '미리보기는 보여준다');
  assert.deepEqual(codes(Core.compose(firstState(), { frames: { 1: DOCTOR_A[1] }, requireFrame: true }).blocks), ['FRAME_MISSING']);
  assert.deepEqual(codes(Core.compose(firstState(), { frames: { 1: 7, 2: DOCTOR_A[2] }, requireFrame: true }).blocks), ['FRAME_MISSING']);
  const broken = Core.compose(firstState(), { frames: { 1: DOCTOR_A[1].replace('{골반길이비}', ''), 2: DOCTOR_A[2] }, requireFrame: true });
  assert.deepEqual(codes(broken.blocks), ['FRAME_INVALID']);
  assert.match(broken.blocks[0].message, /1차 차팅 틀/);
  const brokenSecond = Core.compose(secondState({ limitOn: false }), { frames: { 1: DOCTOR_A[1], 2: Core.EXAMPLE_FRAMES[2] }, requireFrame: true });
  assert.deepEqual(codes(brokenSecond.blocks), ['FRAME_INVALID']);
});

test('EDI-18g AI 응답에서 1차·2차 틀을 꺼낸다(코드 블록·앞뒤 설명·순서 바뀜 허용)', () => {
  const plain = '=== 1차 틀 ===\n' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n' + DOCTOR_A[2];
  assert.deepEqual(Core.splitFrames(plain), { 1: DOCTOR_A[1], 2: DOCTOR_A[2] });
  const fenced = '네, 만들었습니다.\n```text\n=== 1차 틀 ===\n' + DOCTOR_B[1] + '\n\n=== 2차 틀 ===\n' + DOCTOR_B[2] + '\n```';
  assert.deepEqual(Core.splitFrames(fenced), { 1: DOCTOR_B[1], 2: DOCTOR_B[2] });
  const reversed = '==== 2차 틀 ====\n' + DOCTOR_A[2] + '\n==== 1차 틀 ====\n' + DOCTOR_A[1];
  assert.deepEqual(Core.splitFrames(reversed), { 1: DOCTOR_A[1], 2: DOCTOR_A[2] });
  const wrapped = '=== 1차 틀 ===\n' + DOCTOR_A[1].replace('. [환자평가', '.\n[환자평가');
  assert.equal(Core.splitFrames(wrapped + '\n=== 2차 틀 ===\n' + DOCTOR_A[2])[1], DOCTOR_A[1], '줄바꿈은 한 칸');
  assert.equal(Core.splitFrames(DOCTOR_A[1]), null);
  assert.equal(Core.splitFrames(''), null);
  // AI가 끝에 덧붙인 인사·설명은 틀에 넣지 않는다(코드 블록 뒤, 또는 빈 줄 뒤 변수 없는 문단).
  const closing = '네, 만들었습니다.\n```\n=== 1차 틀 ===\n' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n' + DOCTOR_A[2] + '\n```\n더 고칠 부분이 있으면 말씀해 주세요.';
  assert.deepEqual(Core.splitFrames(closing), { 1: DOCTOR_A[1], 2: DOCTOR_A[2] });
  const remark = '=== 1차 틀 ===\n' + DOCTOR_B[1] + '\n\n=== 2차 틀 ===\n' + DOCTOR_B[2] + '\n\n위 틀은 원장님 예시의 항목형 문체를 따랐습니다.\r\n필요하면 말씀해 주세요.';
  assert.deepEqual(Core.splitFrames(remark), { 1: DOCTOR_B[1], 2: DOCTOR_B[2] });
  const perBlock = '=== 1차 틀 ===\n```text\n' + DOCTOR_A[1] + '\n```\n설명: 1차는 문장형입니다.\n=== 2차 틀 ===\n```\n' + DOCTOR_A[2] + '\n```';
  assert.deepEqual(Core.splitFrames(perBlock), { 1: DOCTOR_A[1], 2: DOCTOR_A[2] });
  const twoParagraphs = '=== 1차 틀 ===\n' + DOCTOR_A[1].replace(' [환자평가', '\n\n[환자평가') + '\n=== 2차 틀 ===\n' + DOCTOR_A[2];
  assert.equal(Core.splitFrames(twoParagraphs)[1], DOCTOR_A[1], '변수가 있는 다음 문단은 같은 틀로 이어 붙인다');
});

test('EDI-18h AI 요청문: 규칙·변수 전체·출력 형식·예시 틀·개인정보 안내를 담는다', () => {
  const p = Core.framePrompt();
  for (const v of Core.FRAME_VARS) {
    if (/^[12]차/.test(v.name) && v.measure && !/어깨수평|골반길이비/.test(v.name)) continue; // 1·2차 수치 18개는 범위로 안내
    assert.ok(p.includes('{' + v.name + '}'), v.name);
  }
  for (const marker of ['=== 1차 틀 A ===', '=== 1차 틀 B ===', '=== 1차 틀 C ===', '=== 2차 틀 A ===', '=== 2차 틀 B ===', '=== 2차 틀 C ===']) assert.ok(p.includes(marker), marker);
  const examples = Core.exampleFrames(0);
  assert.ok(p.includes(examples[1]) && p.includes(examples[2]), '요청문마다 만든 예시 틀을 넣는다');
  assert.ok(!p.includes(Core.EXAMPLE_FRAMES[1]) && !p.includes(Core.EXAMPLE_FRAMES[2]), '모두 같은 고정 예시 틀은 넣지 않는다');
  assert.match(p, /수치 변수로 씁니다/);
  assert.match(p, /\[\[ \]\]로 감쌉니다/);
  assert.match(p, /환자 이름·주민번호·차트번호·날짜는 지우고/);
  assert.match(p, /심평원 기재 항목/);
  assert.match(p, /그대로 베끼지 말고/);
  assert.ok(p.trimEnd().endsWith('없으면 비워 두고 그대로 보내세요.)'), '원장님 예시는 맨 끝에 붙이고, 없어도 된다');
  // 요청문의 예시 출력 형식 그대로 답하면 꺼낼 수 있다.
  assert.deepEqual(Core.splitFrames('=== 1차 틀 ===\nA {NRS}\n=== 2차 틀 ===\nB {NRS}'), { 1: 'A {NRS}', 2: 'B {NRS}' });
});

test('EDI-18i 결과지 수치 대조는 숫자가 앞뒤로 붙은 글자를 같은 값으로 보지 않는다', () => {
  const tokens = ['1.2º', '1:1.1', '6mm', '2개'];
  assert.equal(Core.verifyValues('어깨 1.2º, 비 1:1.1. 간격(6mm) 차 2개.', tokens, '어깨 1.2º, 비 1:1.1. 간격(6mm) 차 2개.').ok, true);
  for (const bad of ['어깨 11.2º, 비 1:1.1. 간격(6mm) 차 2개.', '어깨 1.2º, 비 1:1.15. 간격(6mm) 차 2개.', '어깨 1.2º, 비 1:1.1. 간격(16mm) 차 2개.', '어깨 1.2º, 비 1:1.1. 간격(6mm) 차 12개.', '어깨 -1.2º, 비 1:1.1. 간격(6mm) 차 2개.', '어깨 ' + String.fromCharCode(0x2212) + '1.2º, 비 1:1.1. 간격(6mm) 차 2개.']) {
    const r = Core.verifyValues(bad, tokens, '어깨 1.2º, 비 1:1.1. 간격(6mm) 차 2개.');
    assert.equal(r.ok, false, bad);
    assert.equal(r.missing.length, 1, bad);
  }
  const swapped = Core.verifyValues('2개 6mm', ['6mm', '2개'], '6mm 2개');
  assert.deepEqual([swapped.ok, swapped.missing, swapped.ordered], [false, [], false]);
  assert.deepEqual(Core.valueTokens(DOCTOR_B[2], Core.parseMoire(FIRST), Core.parseMoire(SECOND)).length, 16, '1·2차 수치 18개 중 같은 값(6mm·10개)은 하나로');
});

// ---------- 독립 검수 r5 지적 (RV5-01~12, 2026-11-19) ----------
const withFrame = (cycle, frame) => (cycle === 1 ? { 1: frame, 2: DOCTOR_A[2] } : { 1: DOCTOR_A[1], 2: frame });
function editedWith(state, frames, change) {
  const auto = Core.compose(state, { frames });
  const s = JSON.parse(JSON.stringify(state));
  s.manual[s.cycle] = { text: change(auto.text), base: auto.autoText, frame: auto.frameText };
  return Core.compose(s, { frames, requireFrame: true });
}

test('RV5-01 라벨:값 틀에서도 직접 수정한 수치를 막고, 값이 그대로면 막지 않는다', () => {
  const colon = DOCTOR_A[1].replace('어깨 기울기 {어깨수평}, 골반 기울기 {골반수평}', '어깨 기울기:{어깨수평}, 골반 기울기:{골반수평}');
  assert.equal(Core.checkFrame(colon, 1).ok, true);
  const frames = withFrame(1, colon);
  assert.deepEqual(codes(editedWith(firstState(), frames, t => t).blocks), []);
  for (const [from, to] of [['기울기:1.2º', '기울기:2.1º'], ['기울기:-0.8º', '기울기:0.8º'], ['기울기:1.2º', '기울기:11.2º'], ['기울기:1.2º', '기울기:1.2º5']]) {
    const r = editedWith(firstState(), frames, t => t.replace(from, to));
    assert.deepEqual(codes(r.blocks), ['VALUE_MISMATCH'], from + ' → ' + to);
  }
  const relabel = editedWith(firstState(), DOCTOR_A, t => t.replace('어깨 기울기 1.2º', '어깨 기울기:1.2º'));
  assert.deepEqual(codes(relabel.blocks), [], '값은 그대로 두고 “:”만 붙이면 막지 않는다(오탐 없음)');
});

test('RV5-01 수치 변수 앞뒤에 부호·숫자·마침표가 붙는 틀은 저장할 수 없고, 입력 때문에 붙으면 복사를 막는다', () => {
  assert.match(frameErrors(DOCTOR_B[2].replace('{1차어깨수평}→{2차어깨수평}', '{1차어깨수평}-{2차어깨수평}'), 2), /\{2차어깨수평\} 앞에 “-”/);
  assert.match(frameErrors(DOCTOR_A[1].replace('골반 {골반길이비}. [치료계획]', '골반 {골반길이비}.3.[치료계획]'), 1), /\{골반길이비\} 뒤에 “\.3”/);
  assert.match(frameErrors(DOCTOR_A[1].replace('어깨 기울기 {어깨수평}, 골반 기울기 {골반수평}', '어깨·골반 기울기 {어깨수평}{골반수평}'), 1), /다른 변수와 바로 붙어 있음/);
  const touching = DOCTOR_A[1].replace('어깨 기울기 {어깨수평}', '어깨 기울기 [[{부위} ]][[{NRS}]]{어깨수평}');
  assert.match(frameErrors(touching, 1), /채워 보면 수치가 앞뒤 글자와 붙어/);
  const glued = DOCTOR_A[1].replace('어깨 기울기 {어깨수평}', '어깨 기울기 [[{사고내용}]]{어깨수평}');
  assert.equal(Core.checkFrame(glued, 1).ok, true, '가상 환자로는 붙지 않는다');
  const r = Core.compose(firstState({ accident: '교통사고 2' }), { frames: withFrame(1, glued), requireFrame: true });
  assert.ok(codes(r.blocks).includes('FRAME_AMBIGUOUS'), JSON.stringify(r.blocks));
  assert.equal(r.canCopy, false);
});

test('RV5-02 대시류·±·전각 숫자·결합 문자가 붙은 수치는 다른 값으로 본다', () => {
  const base = '어깨 1.2º, 간격(6mm), 비 1:1.1.';
  const tokens = ['1.2º', '6mm', '1:1.1'];
  assert.equal(Core.verifyValues(base, tokens, base).ok, true);
  for (const code of [0x2013, 0x2014, 0xFF0D, 0xFE63, 0x2010, 0x00B1, 0x2212, 0x2D]) {
    assert.equal(Core.verifyValues(base.replace('1.2º', C(code) + '1.2º'), tokens, base).ok, false, 'U+' + code.toString(16));
  }
  assert.equal(Core.verifyValues(base.replace('6mm', C(0xFF11) + '6mm'), tokens, base).ok, false, '전각 1');
  assert.equal(Core.verifyValues(base.replace('1:1.1', '1:1.1' + C(0xFF15)), tokens, base).ok, false, '전각 5');
  assert.equal(Core.verifyValues(base.replace('1.2º', '1.2º' + C(0x0301)), tokens, base).ok, false, '결합 문자');
});

test('RV5-03 다른 틀이나 틀 저장 전에 고친 문구는 복사를 막는다', () => {
  const example = Core.compose(firstState());
  const s = firstState();
  s.manual[1] = { text: example.text, base: example.autoText, frame: example.frameText };
  const r = Core.compose(s, { frames: DOCTOR_A, requireFrame: true });
  assert.ok(codes(r.blocks).includes('TEXT_FRAME_CHANGED'));
  assert.equal(r.canCopy, false);
  const legacy = firstState();
  legacy.manual[1] = { text: example.text, base: example.autoText };
  assert.ok(codes(Core.compose(legacy, { frames: DOCTOR_A }).blocks).includes('TEXT_FRAME_CHANGED'), '틀 정보가 없는 직접 수정도 막는다');
  assert.deepEqual(codes(editedWith(firstState(), DOCTOR_A, t => t).blocks), []);
});

test('RV5-04 AI 답의 굵은 표시·제목 기호·설명·부제·수정본·목록 기호를 틀에 섞지 않는다', () => {
  const both = { 1: DOCTOR_A[1], 2: DOCTOR_A[2] };
  assert.deepEqual(Core.splitFrames('**=== 1차 틀 ===**\n' + DOCTOR_A[1] + '\n**=== 2차 틀 ===**\n' + DOCTOR_A[2]), both);
  assert.deepEqual(Core.splitFrames('### === 1차 틀 ===\n' + DOCTOR_A[1] + '\n### === 2차 틀 ===\n' + DOCTOR_A[2]), both);
  assert.deepEqual(Core.splitFrames('=== 1차 틀 ===\n' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n' + DOCTOR_A[2] + '\n※ {소견}은 원장님이 직접 쓰는 부분입니다.\n- {판정}은 호전·유지·악화 중 하나입니다.'), both);
  assert.deepEqual(Core.splitFrames('=== 1차 틀 ===\n(문장형, 1차 검사용)\n' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n(2차 검사용)\n' + DOCTOR_A[2]), both);
  assert.deepEqual(Core.splitFrames('초안입니다.\n=== 1차 틀 ===\n' + DOCTOR_B[1] + '\n=== 2차 틀 ===\n' + DOCTOR_B[2] + '\n\n고친 최종본입니다.\n=== 1차 틀 ===\n' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n' + DOCTOR_A[2]), both, '수정본(마지막 표시)을 쓴다');
  assert.deepEqual(Core.splitFrames('=== 1차 틀(문장형) ===\n' + DOCTOR_A[1] + '\n=== 2차 틀(문장형) ===\n' + DOCTOR_A[2]), both);
  assert.deepEqual(Core.splitFrames('=== 1차 틀 ===\n- ' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n- ' + DOCTOR_A[2]), both);
  assert.deepEqual(Core.splitFrames('=== 1차 틀 ===\n' + DOCTOR_A[1].replace('[검사시행 사유]', '**[검사시행 사유]**') + '\n=== 2차 틀 ===\n' + DOCTOR_A[2]), both, '틀 안의 굵게 표시도 지운다');
  for (const junk of ['** ', '## ', '=== ']) assert.match(frameErrors(junk + DOCTOR_A[1], 1), /서식·설명 기호/, junk);
});

test('RV5-05 변수처럼 보이는 글자·짝이 안 맞는 괄호는 저장할 수 없다', () => {
  for (const [from, to] of [['{부위}', '{{부위}}'], ['{다음평가}', '{다음 평가}'], ['{치료}', String.fromCharCode(0xFF5B) + '치료' + String.fromCharCode(0xFF5D)]]) {
    assert.match(frameErrors(DOCTOR_A[1].replace(from, to), 1), /중괄호가 짝이 맞지 않거나/, to);
  }
  assert.match(frameErrors(DOCTOR_A[1].replace('[[{사고내용}로 ]]', ']]{사고내용}로 [['), 1), /\[\[ \]\] 짝이 맞지 않거나/);
});

test('RV5-06 빌 수 있는 변수가 [[ ]] 밖이면 알리고, 값이 빈 가상 환자로 미리 볼 수 있다', () => {
  const bare = DOCTOR_A[2].replace('[[{판정}, ]][[{치료여부}]][[, {다음평가} 다시 검사]]', '{판정} 상태로, {치료목표} 위해 {치료여부}하며 {다음평가} 재평가 예정');
  const c = Core.checkFrame(bare, 2);
  assert.equal(c.ok, true);
  const warn = c.warnings.join(' ');
  assert.match(warn, /값이 빌 수 있는 변수가 \[\[ \]\] 밖에 있습니다/);
  for (const name of ['판정', '치료목표', '치료여부', '다음평가']) assert.ok(warn.includes('{' + name + '}'), name);
  for (const F of [DOCTOR_A, DOCTOR_B]) for (const n of [1, 2]) assert.doesNotMatch(Core.checkFrame(F[n], n).warnings.join(' '), /빌 수 있는/);
  const sparse = Core.compose(Core.sampleState(2, 'sparse'), { frames: DOCTOR_A });
  assert.ok(sparse.text.endsWith('[치료 후 평가] 호전, 치료 종료.'), sparse.text);
  assert.ok(!sparse.text.includes('소견'));
  assert.ok(Core.compose(Core.sampleState(1, 'sparse'), { frames: DOCTOR_A }).text.endsWith('[치료계획] 추나 치료 시행.'));
  assert.match(Core.framePrompt(), /값이 빌 수 있습니다\(\{수상일\}/);
});

test('RV5-08 {NRS}·{소견}·{판정}을 다른 변수와 같은 [[ ]]에 넣으면 저장할 수 없다', () => {
  assert.match(frameErrors(DOCTOR_A[1].replace('[[{부위} ]]통증이 계속됨[[({NRS})]]', '[[{부위} 통증이 계속됨({NRS})]]'), 1), /\{NRS\} 변수가 다른 변수와 같은 \[\[ \]\] 안에/);
  assert.match(frameErrors(DOCTOR_A[2].replace('[[소견 {소견}. ]]', '[[{1차검사일} 대비 소견 {소견}. ]]'), 2), /\{소견\} 변수가 다른 변수와/);
});

test('RV5-09 틀 검사 보강: NRS 중복, 고정 날짜·통증 점수, 다른 단위 표기, “1:1 비교” 허용', () => {
  assert.match(frameErrors(DOCTOR_A[1].replace('[[({NRS})]]', '[[(NRS {NRS})]]'), 1), /이미 ‘NRS’가 들어 있습니다/);
  for (const literal of ['2026-10-01', '2026.10.1', '10월 1일']) assert.match(frameErrors(DOCTOR_A[1].replace('다친 뒤', literal + ' 다친 뒤'), 1), /특정 날짜/, literal);
  assert.match(frameErrors(DOCTOR_A[1].replace('통증이 계속됨', '통증이 계속됨 NRS 7'), 1), /통증 점수가 숫자로/);
  for (const literal of ['1.2도', '6㎜', '0.85㎝', C(0xFF11) + '.2º', '좌 12개']) {
    assert.match(frameErrors(DOCTOR_A[1].replace('모아레 1차 검사함.', '모아레 1차 검사함. ' + literal + '.'), 1), /숫자로 적혀 있습니다/, literal);
  }
  assert.equal(Core.checkFrame(DOCTOR_A[1].replace('모아레 1차 검사함.', '모아레 1차 검사함(좌우 1:1 비교).'), 1).ok, true);
});

test('RV5-10 변수 바로 뒤 조사는 받침에 맞추고, 겹치는 연결어는 뺀다', () => {
  const r = (frame, values) => Core.renderFrame(frame, values);
  assert.equal(r('[[{사고내용}로 ]]다침.', { 사고내용: '낙상' }), '낙상으로 다침.');
  assert.equal(r('[[{사고내용}로 ]]다침.', { 사고내용: '교통사고' }), '교통사고로 다침.');
  assert.equal(r('{사고내용}로 다침.', { 사고내용: '물' }), '물로 다침.', 'ㄹ 받침은 로');
  assert.equal(r('{치료목표}를 목표로.', { 치료목표: '정렬 교정' }), '정렬 교정을 목표로.');
  assert.equal(r('{치료목표}을 목표로.', { 치료목표: '통증 완화' }), '통증 완화를 목표로.');
  assert.equal(r('[[{치료목표}를 목표로 ]]재검.', { 치료목표: '통증 완화를 목표로' }), '통증 완화를 목표로 재검.');
  assert.equal(r('{부위}가 아픔.', { 부위: '양측 무릎' }), '양측 무릎이 아픔.');
  assert.equal(r('{부위}이 아픔.', { 부위: '허리' }), '허리가 아픔.');
  assert.equal(r('{부위}이후 호전.', { 부위: '허리' }), '허리이후 호전.', '조사가 아니면 그대로');
  assert.ok(Core.compose(firstState({ accident: '낙상' }), { frames: DOCTOR_A }).text.startsWith('[검사시행 사유] 낙상으로 다친 뒤'));
  assert.ok(Core.compose(firstState({ goal: '정렬 교정' }), { frames: DOCTOR_A }).text.includes('정렬 교정을 목표로'));
});

test('RV5-11 문장 정리는 원장님이 입력한 글자를 바꾸지 않는다', () => {
  const r = Core.compose(secondState({ opinion: '어깨 [R], 우측 감소... 좌우 차이(경미 ) 확인', limitOn: false }), { frames: DOCTOR_A });
  assert.ok(r.text.includes('소견 어깨 [R], 우측 감소... 좌우 차이(경미 ) 확인. [치료 후 평가]'), r.text);
  assert.ok(Core.compose(firstState({ planTx: {}, goal: '', next: {} })).text.endsWith('[치료계획]'), '빈 머리말 뒤 구두점 정리는 그대로');
});

test('RV5-12 저장된 2차 틀만 문제여도 1차 복사를 막는다', () => {
  const r = Core.compose(firstState(), { frames: { 1: DOCTOR_A[1], 2: DOCTOR_A[2].replace('{수치비교}', '') }, requireFrame: true });
  assert.deepEqual(codes(r.blocks), ['FRAME_INVALID']);
  assert.match(r.blocks[0].message, /2차 차팅 틀/);
});

// ---------- 독립 재검수 r6 지적 (RV6-01~06, 2026-11-19) — RV6-01(화면)은 UI-17에서 확인 ----------
test('RV6-02 AI 답: 목록형 절, 바로 붙은 끝인사, 예시 틀 다시 붙임, 제목형 표시, 코드 블록 안 괄호 설명', () => {
  const both = { 1: DOCTOR_A[1], 2: DOCTOR_A[2] };
  const sections = f => f.replace(/ \[(환자평가|치료)/g, '\n[$1');
  const bullets = f => sections(f).split('\n').map(line => '- ' + line).join('\n');
  assert.deepEqual(Core.splitFrames('=== 1차 틀 ===\n' + bullets(DOCTOR_A[1]) + '\n\n=== 2차 틀 ===\n' + bullets(DOCTOR_A[2])), both, '절마다 목록 기호');
  assert.deepEqual(Core.splitFrames('=== 1차 틀 ===\n' + DOCTOR_A[1] + '\n\n=== 2차 틀 ===\n' + DOCTOR_A[2] + '\n필요하시면 더 다듬어 드리겠습니다.'), both, '빈 줄 없이 붙은 끝인사');
  assert.deepEqual(Core.splitFrames('=== 1차 틀 ===\n' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n' + DOCTOR_A[2] + '\n\n참고: 처음 받은 예시 틀은 아래와 같았습니다.\n=== 1차 틀 ===\n' + Core.EXAMPLE_FRAMES[1] + '\n=== 2차 틀 ===\n' + Core.EXAMPLE_FRAMES[2]), both, '뒤에 다시 붙인 예시 틀은 건너뛴다');
  assert.deepEqual(Core.splitFrames('1차 틀:\n' + DOCTOR_A[1] + '\n\n2차 틀:\n' + DOCTOR_A[2]), both, '“1차 틀:” 제목형');
  assert.deepEqual(Core.splitFrames('[1차 틀]\n' + DOCTOR_A[1] + '\n## 2차 틀 (항목형)\n' + DOCTOR_A[2]), both, '[1차 틀]·## 2차 틀');
  assert.deepEqual(Core.splitFrames('=== 1차 틀 ===\n```\n' + DOCTOR_A[1] + '\n(1차는 문장형으로 정리했습니다)\n```\n=== 2차 틀 ===\n```\n' + DOCTOR_A[2] + '\n```'), both, '코드 블록 안 괄호 설명');
  assert.equal(Core.splitFrames('1차 틀을 만들었습니다.\n' + DOCTOR_A[1]), null, '“1차 틀을 …” 문장은 표시가 아니다');
  assert.match(frameErrors(DOCTOR_A[1] + ' 필요하시면 더 다듬어 드리겠습니다.', 1), /인사·안내 문장/);
});

test('RV6-03 저장 검사 오탐 줄이기: ※·척도 설명·부위 개수는 허용, 고정 점수·등고선 개수는 계속 막음', () => {
  const add = phrase => DOCTOR_A[1].replace('모아레 1차 검사함.', '모아레 1차 검사함. ' + phrase);
  for (const ok of ['※ 경과 관찰 필요.', 'NRS 0~10 척도로 평가.', 'VAS 10점 만점 기준.', '치료 부위 2개 이상.', '혈자리 3개소 시술.']) {
    assert.deepEqual(Core.checkFrame(add(ok), 1).errors, [], ok);
  }
  for (const bad of ['NRS 7.', 'NRS 7/10.', '좌 12개.', '우측 10개.']) assert.ok(!Core.checkFrame(add(bad), 1).ok, bad);
});

test('RV6-04 기타 부위 이름·직접 적은 혈자리 끝의 문장부호는 정리한다', () => {
  const s = firstState({ parts: { neck: { on: true, nrs: 6, extra: '곡지., 합곡' }, other: { on: true, text: '좌측 손목,', nrs: 3 } } });
  const r = Core.compose(s, { frames: DOCTOR_A });
  assert.ok(r.text.includes('목·좌측 손목 통증이 계속됨'), r.text);
  assert.ok(r.text.includes('목(견외수·대추·풍지·견정(GB21)·곡지·합곡)·좌측 손목 부위 침'), r.text);
  assert.ok(!/,,|\.\./.test(r.text));
  const c5 = Core.compose(firstState({ parts: { other: { on: true, text: 'C5.', nrs: 4 } } }), { frames: DOCTOR_A });
  assert.ok(c5.text.includes('C5 통증이 계속됨(NRS 4)'), c5.text);
});

test('RV6-05 조사: 괄호로 끝나면 괄호 앞말에, 복합 조사(으로부터·으로서·으로써)도 받침에 맞춘다', () => {
  const r = (frame, values) => Core.renderFrame(frame, values);
  assert.equal(r('{사고내용}로 다침.', { 사고내용: '교통사고(낙상)' }), '교통사고(낙상)로 다침.');
  assert.equal(r('{사고내용}로 다침.', { 사고내용: '추락(2층 높이)' }), '추락(2층 높이)으로 다침.');
  assert.equal(r('{수상일}로부터 4주.', { 수상일: '2026-10-03' }), '2026-10-03으로부터 4주.');
  assert.equal(r('{수상일}로부터 4주.', { 수상일: '2026-10-02' }), '2026-10-02로부터 4주.');
  assert.equal(r('{치료}로서 시행.', { 치료: '추나 치료' }), '추나 치료로서 시행.');
  assert.equal(r('{부위}을 치료.', { 부위: '견정(GB21)' }), '견정(GB21)을 치료.');
});

test('RV6-06 부호·숫자 닮은꼴(˗ ㅡ ー 一 ➖ ⁃, 위첨자·원 숫자)이 붙은 수치는 다른 값으로 본다', () => {
  const base = '어깨 1.2º, 간격(6mm).';
  const tokens = ['1.2º', '6mm'];
  for (const code of [0x02D7, 0x3161, 0x30FC, 0x4E00, 0x2796, 0x2043, 0x00B9, 0x2460, 0x2075]) {
    assert.equal(Core.verifyValues(base.replace('1.2º', C(code) + '1.2º'), tokens, base).ok, false, '앞 U+' + code.toString(16));
  }
  for (const code of [0x00B9, 0x2460, 0x2075]) assert.equal(Core.verifyValues(base.replace('6mm', '6mm' + C(code)), tokens, base).ok, false, '뒤 U+' + code.toString(16));
});

test('RV6 참고: 목표가 ‘목표’로 끝나면 틀 연결어의 남는 부분만 붙인다', () => {
  const end = goal => Core.compose(firstState({ goal }), { frames: DOCTOR_A }).text.split('[치료계획] ')[1];
  assert.ok(end('단기 목표').endsWith('추나 치료 시행, 단기 목표로 4주 후 다시 검사.'), end('단기 목표'));
  assert.ok(end('최종목표').endsWith('최종목표로 4주 후 다시 검사.'));
  assert.ok(end('통증 완화를 목표로').endsWith('통증 완화를 목표로 4주 후 다시 검사.'));
  assert.ok(end('통증 완화를 위해').endsWith('통증 완화를 위해 4주 후 다시 검사.'));
  assert.equal(Core.renderFrame('{확인목적} 위해서 검사.', { 확인목적: '경과 확인 위해' }), '경과 확인 위해서 검사.');
  assert.equal(Core.compose(firstState()).text, EXPECTED_FIRST, '예시 틀 문구는 그대로');
  assert.equal(Core.compose(secondState()).text, EXPECTED_SECOND, '예시 틀 문구는 그대로');
});


// ---------- Astra 마지막 검수 r3 지적 (AST-02~04, 2026-11-19) ----------
// Astra 보고서의 AST-01~03을 이 저장소의 기존 AST-01(r1, 복사 상태 표시)과 겹치지 않게 AST-02~04로 기록한다.
test('AST-02(Astra r3 AST-01) 결과지 수치를 중복하거나 끼워 넣으면 막는다(같은 개수·같은 순서)', () => {
  const r1 = editedWith(firstState(), DOCTOR_A, t => t.replace('어깨 기울기 1.2º', '어깨 기울기 1.2º 1.2º'));
  assert.deepEqual(codes(r1.blocks), ['VALUE_EXTRA']);
  assert.match(r1.blocks[0].message, /1\.2º/);
  const r2 = editedWith(secondState({ limitOn: false }), DOCTOR_B, t => t.replace('어깨 1.2º→0.6º', '어깨 0.6º→1.2º→0.6º'));
  assert.deepEqual(codes(r2.blocks), ['VALUE_EXTRA']);
  const r3 = editedWith(firstState(), DOCTOR_A, t => t + ' 참고 0.85cm.');
  assert.deepEqual(codes(r3.blocks), ['VALUE_EXTRA'], '결과지 수치를 덧붙여도 막는다');
  const other = editedWith(firstState(), DOCTOR_A, t => t.replace('4주 후 다시 검사.', '4주 후 다시 검사(치료 8회 예정).'));
  assert.deepEqual(codes(other.blocks), [], '결과지 수치가 아닌 숫자는 더 써도 된다');
  const check = Core.verifyValues('a 1.2º b 1.2º', ['1.2º'], 'a 1.2º');
  assert.deepEqual([check.ok, check.extra, check.missing], [false, ['1.2º'], []]);
});

test('AST-03(Astra r3 AST-02) 보조 평면 숫자(𝟙)가 붙은 수치·틀도 다른 값으로 본다', () => {
  const one = String.fromCodePoint(0x1D7D9);
  assert.deepEqual(codes(editedWith(firstState(), DOCTOR_A, t => t.replace('1.2º', one + '1.2º')).blocks), ['VALUE_MISMATCH']);
  assert.deepEqual(codes(editedWith(firstState(), DOCTOR_A, t => t.replace('골반 1:1.1', '골반 1:1.1' + one)).blocks), ['VALUE_MISMATCH']);
  assert.match(frameErrors(DOCTOR_A[1].replace('{어깨수평}', one + '{어깨수평}'), 1), /\{어깨수평\} 앞에/);
  assert.match(frameErrors(DOCTOR_A[1].replace('{골반길이비}', '{골반길이비}' + one), 1), /\{골반길이비\} 뒤에/);
  const base = '어깨 1.2º.';
  assert.equal(Core.verifyValues(base.replace('1.2º', String.fromCodePoint(0x1D7CE) + '1.2º'), ['1.2º'], base).ok, false, '𝟎');
});

test('AST-04(Astra r3 AST-03) 소수점 없는 비율·떨어진 등고선 개수도 틀에 숫자로 적으면 저장할 수 없다', () => {
  const add = phrase => DOCTOR_A[1] + ' ' + phrase;
  assert.match(frameErrors(add('어깨 좌우측 길이 비율 2:1.'), 1), /“2:1”/);
  assert.match(frameErrors(add('좌측 등고선 개수(검사값) 99개.'), 1), /“99개”/);
  for (const ok of ['치료 부위 2개 이상.', '혈자리 3개소 시술.', '좌우 1:1 비교.', '부위 2개 치료.', '치료 2개월째.']) assert.deepEqual(Core.checkFrame(add(ok), 1).errors, [], ok);
});

// ---------- 요청문: 예시 없이도 (2026-11-19 사용자: “예시가 없이도 나올수잇게 요청문 바꿔줘”) ----------
test('EDI-18k 요청문은 예시 문구 없이도 문체 조건으로 바로 틀을 만들게 하고, 요청문마다 조건이 달라진다', () => {
  const p = Core.framePrompt({ seed: 11 });
  assert.match(p, /\[이번 문체 조건\]/);
  assert.match(p, /묻지 말고 바로 만들어 주세요/);
  assert.match(p, /예시가 없으면 \[이번 문체 조건\]대로 새로 만듭니다/);
  assert.match(p, /\(선택: 평소 쓰신 EDI 문구가 있으면 3~5개를/);
  assert.ok(p.trimEnd().endsWith('없으면 비워 두고 그대로 보내세요.)'));
  const style = Core.styleRecipe(11);
  for (const part of [style.form, style.headers[1], style.headers[2], style.ending, style.order, style.separator, style.compare, style.length]) assert.ok(p.includes(part), part);
  assert.equal(Core.framePrompt({ seed: 11 }), p, '같은 수면 같은 요청문');
  const recipes = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(Core.styleRecipe(i + 1))));
  assert.ok(recipes.size >= 30, '요청문마다 문체 조건이 달라진다: ' + recipes.size);
  for (const h of Core.STYLE_CHOICES.headers) {
    for (const word of ['사유', '판독', '계획']) assert.ok(h[1].includes(word), h[1] + ' / ' + word);
    for (const word of ['사유', '판독', '평가']) assert.ok(h[2].includes(word), h[2] + ' / ' + word);
  }
  for (const rule of ['수치 변수로 씁니다', '[[ ]]로 감쌉니다', '심평원 기재 항목', '그대로 베끼지 말고', '답하기 전에 벌마다 확인합니다', '3벌(A·B·C)', '서로 다르게']) assert.ok(p.includes(rule), rule);
});

// ---------- 베리에이션 (2026-11-19 사용자 선택: 요청문 예시 다양화 + 틀 여러 벌 돌려쓰기) ----------
test('EDI-18m 요청문 예시 틀은 문체 조건으로 요청문마다 다르게 만들고, 어떤 조합도 틀 검사를 통과한다', () => {
  const seen = new Set();
  for (let seed = 0; seed < 200; seed += 1) {
    const ex = Core.exampleFrames(seed);
    seen.add(ex[1] + ex[2]);
    for (const cycle of [1, 2]) {
      const c = Core.checkFrame(ex[cycle], cycle);
      assert.deepEqual(c.errors, [], 'seed ' + seed + ' ' + cycle + '차');
      assert.ok(c.similarity < 0.75, 'seed ' + seed + ' 고정 예시와 다름');
    }
    assert.ok(Core.framePrompt({ seed }).includes(ex[1]));
  }
  assert.ok(seen.size >= 190, '요청문마다 예시가 다르다: ' + seen.size);
  assert.equal(Core.exampleFrames(9)[1], Core.exampleFrames(9)[1], '같은 수면 같은 예시');
});

test('EDI-18n AI 답에서 1·2차 틀을 A·B·C 벌로 꺼낸다(표시 모양·빠진 벌·벌 이름 없음)', () => {
  const answer = ['=== 1차 틀 A ===', DOCTOR_A[1], '=== 1차 틀 B ===', DOCTOR_B[1], '=== 1차 틀 C ===', DOCTOR_C[1],
    '=== 2차 틀 A ===', DOCTOR_A[2], '=== 2차 틀 B ===', DOCTOR_B[2], '=== 2차 틀 C ===', DOCTOR_C[2]].join('\n');
  assert.deepEqual(Core.splitFrameSets(answer), { 1: [DOCTOR_A[1], DOCTOR_B[1], DOCTOR_C[1]], 2: [DOCTOR_A[2], DOCTOR_B[2], DOCTOR_C[2]] });
  assert.deepEqual(Core.splitFrames(answer), { 1: DOCTOR_A[1], 2: DOCTOR_A[2] }, '첫 벌만 꺼내는 이전 함수');
  const styled = ['**1차 틀 A:**', DOCTOR_A[1], '[1차 틀 (B)]', DOCTOR_B[1], '## 1차 틀 - C', DOCTOR_C[1], '2차 틀 A:', DOCTOR_A[2], '=== 2차 틀(B) ===', DOCTOR_B[2]].join('\n');
  assert.deepEqual(Core.splitFrameSets(styled), { 1: [DOCTOR_A[1], DOCTOR_B[1], DOCTOR_C[1]], 2: [DOCTOR_A[2], DOCTOR_B[2]] }, '2차 C가 없으면 두 벌');
  const shuffled = ['=== 2차 틀 C ===', DOCTOR_C[2], '=== 1차 틀 B ===', DOCTOR_B[1], '=== 1차 틀 A ===', DOCTOR_A[1], '=== 2차 틀 A ===', DOCTOR_A[2]].join('\n');
  assert.deepEqual(Core.splitFrameSets(shuffled), { 1: [DOCTOR_A[1], DOCTOR_B[1]], 2: [DOCTOR_A[2], DOCTOR_C[2]] }, '순서가 섞여도 A·B·C 차례로');
  assert.deepEqual(Core.splitFrameSets('=== 1차 틀 ===\n' + DOCTOR_A[1] + '\n=== 2차 틀 ===\n' + DOCTOR_A[2]), { 1: [DOCTOR_A[1]], 2: [DOCTOR_A[2]] }, '벌 이름이 없으면 한 벌');
  assert.equal(Core.splitFrameSets('1차 틀을 만들었습니다.\n' + DOCTOR_A[1]), null);
});

test('EDI-18o 저장한 여러 벌 중 환자마다 고른 벌로 문구를 만든다', () => {
  const frames = { 1: [DOCTOR_A[1], DOCTOR_B[1], DOCTOR_C[1]], 2: [DOCTOR_A[2], DOCTOR_B[2], DOCTOR_C[2]] };
  const texts = [0, 1, 2].map(v => Core.compose(Object.assign(firstState(), { variant: { 1: v, 2: 0 } }), { frames, requireFrame: true }));
  texts.forEach((r, v) => {
    assert.deepEqual(codes(r.blocks), [], 'variant ' + v);
    assert.equal(r.variant, v);
    assert.equal(r.variants, 3);
    assert.equal(r.text, Core.compose(firstState(), { frames: { 1: frames[1][v], 2: frames[2][v] } }).text);
  });
  assert.equal(new Set(texts.map(r => r.text)).size, 3, '벌마다 문장이 다르다');
  assert.equal(Core.compose(Object.assign(firstState(), { variant: { 1: 7, 2: 0 } }), { frames }).variant, 2, '없는 벌 번호는 마지막 벌로');
  assert.equal(Core.compose(Object.assign(secondState({ limitOn: false }), { variant: { 1: 0, 2: 1 } }), { frames }).frameText, DOCTOR_B[2]);
  const broken = Core.compose(firstState(), { frames: { 1: frames[1], 2: [DOCTOR_A[2], DOCTOR_B[2].replace('{소견}', '')] }, requireFrame: true });
  assert.deepEqual(codes(broken.blocks), ['FRAME_INVALID'], '어느 벌이든 문제면 막는다');
  const edited = editedWith(firstState(), frames, t => t);
  assert.deepEqual(codes(edited.blocks), []);
  const switched = JSON.parse(JSON.stringify(firstState()));
  const auto = Core.compose(switched, { frames });
  switched.manual[1] = { text: auto.text, base: auto.autoText, frame: auto.frameText };
  switched.variant = { 1: 1, 2: 0 };
  const other = Core.compose(switched, { frames });
  assert.deepEqual(codes(other.blocks), ['TEXT_FRAME_CHANGED'], 'A로 고친 문구를 B 벌에서 쓰지 않는다(다른 벌과의 수치 대조 결과는 섞지 않음)');
  assert.equal(other.valuesChecked, false);
  assert.ok(!codes(other.notes).includes('TEXT_STALE'));
  switched.variant = { 1: 0, 2: 0 };
  assert.deepEqual(codes(Core.compose(switched, { frames }).blocks), [], '원래 벌로 돌아오면 고친 문구를 다시 쓴다');
});

test('EDI-18p 같은 회차의 벌끼리 거의 같으면 알린다', () => {
  const set = Core.checkFrameSet([DOCTOR_A[1], DOCTOR_B[1], DOCTOR_C[1]], 1);
  assert.equal(set.ok, true);
  assert.deepEqual(set.warnings, []);
  const near = Core.checkFrameSet([DOCTOR_A[1], DOCTOR_A[1].replace('다친 뒤', '다친 후'), DOCTOR_C[1]], 1);
  assert.equal(near.ok, true);
  assert.match(near.warnings.join(' '), /틀 A와 B가 거의 같습니다\(본문 \d+%\)/);
  assert.equal(Core.checkFrameSet([DOCTOR_A[1], DOCTOR_A[1].replace('{골반길이비}', '')], 1).ok, false);
  assert.equal(Core.checkFrameSet([], 1).ok, false);
  // 설정 화면처럼 가운데 칸(B)이 비어 있어도 경고는 원래 자리(A·C)로 말한다.
  const gap = Core.checkFrameSet([DOCTOR_A[1], '', DOCTOR_A[1].replace('다친 뒤', '다친 후')], 1);
  assert.equal(gap.ok, true);
  assert.equal(gap.items.length, 2);
  assert.match(gap.warnings.join(' '), /틀 A와 C가 거의 같습니다/);
  assert.equal(Core.checkFrameSet(['', '  '], 1).ok, false);
});

test('EDI-19a 바꿔 쓸 말: 환자마다 후보 하나를 골라 쓰고, 결과지 수치와 수치 대조는 그대로다', () => {
  for (const cycle of [1, 2]) assert.deepEqual(Core.checkFrame(DOCTOR_W[cycle], cycle).errors, [], cycle + '차');
  assert.equal(Core.wordFrame(DOCTOR_W[1], 7), Core.wordFrame(DOCTOR_W[1], 7), '같은 수면 같은 문장');
  const wordings = Array.from(new Set(Array.from({ length: 60 }, (_, w) => Core.wordFrame(DOCTOR_W[1], w))));
  assert.ok(wordings.length >= 20, '환자마다 표현이 달라진다: ' + wordings.length);
  for (const option of ['다친 뒤', '다친 후', '통증이 계속됨', '통증이 지속됨', '통증이 이어짐', '검사함', '검사를 시행함', '기울기는', '기울기가', '또한 어깨', '그리고 어깨', '다시 검사', '재검사']) {
    assert.ok(wordings.some(t => t.includes(option)), option);
  }
  assert.ok(wordings.every(t => !t.includes('<<') && !t.includes('>>') && !t.includes('|')));
  assert.equal(Core.wordFrame(DOCTOR_A[1], 5), DOCTOR_A[1], '바꿔 쓸 말이 없는 틀은 그대로');
  const frames = { 1: DOCTOR_W[1], 2: DOCTOR_W[2] };
  const texts = new Set();
  for (let w = 0; w < 30; w += 1) {
    const r = Core.compose(Object.assign(firstState(), { wording: w }), { frames, requireFrame: true });
    assert.deepEqual(codes(r.blocks), [], 'wording ' + w);
    assert.equal(r.frameText, DOCTOR_W[1], '직접 수정 확인용 틀은 바꿔 쓸 말 그대로');
    assert.ok(!r.text.includes('<<'));
    let at = -1;
    for (const token of ['1.2º', '-0.8º', '6mm', '12개', '10개', '2개', '0.85cm', '1.08:1', '1:1.1']) {
      const i = r.text.indexOf(token, at + 1);
      assert.ok(i > at, token + ' 차례');
      at = i;
    }
    texts.add(r.text);
    const r2 = Core.compose(Object.assign(secondState({ limitOn: false }), { wording: w }), { frames, requireFrame: true });
    assert.deepEqual(codes(r2.blocks), [], '2차 wording ' + w);
  }
  assert.ok(texts.size >= 10, '같은 입력도 환자 수에 따라 문장이 달라진다: ' + texts.size);
  // 직접 고친 문구: 같은 환자(같은 수)면 그대로 쓰고, 수치 대조도 그대로 한다
  const st = Object.assign(firstState(), { wording: 3 });
  const auto = Core.compose(st, { frames });
  st.manual[1] = { text: auto.text + ' 경과 관찰.', base: auto.autoText, frame: auto.frameText };
  assert.deepEqual(codes(Core.compose(st, { frames }).blocks), []);
  st.manual[1] = { text: auto.text.replace('1.2º', '1.3º'), base: auto.autoText, frame: auto.frameText };
  assert.deepEqual(codes(Core.compose(st, { frames }).blocks), ['VALUE_MISMATCH']);
});

test('EDI-19b 바꿔 쓸 말 검사: 모양·숫자·변수·후보 수·길이, 펼쳐 보면 생기는 문제, 정도 판단 말', () => {
  const base = DOCTOR_A[1];
  const bad = (text, pattern) => assert.match(Core.checkFrame(text, 1).errors.join(' '), pattern, text.slice(0, 60));
  bad(base.replace('다친 뒤', '<<다친 뒤|다친 후'), /<< >> 짝이 맞지 않거나/);
  bad(base.replace('다친 뒤', '<<다친 <<뒤|후>>|다친 뒤>>'), /<< >> 짝이 맞지 않거나/);
  bad(base.replace('다친 뒤', '<<다친 뒤>>'), /후보가 둘 이상/);
  bad(base.replace('4주가', '<<4주가|한 달이>>'), /한글·띄어쓰기·쉼표/);
  bad(base.replace('다친 뒤', '<<{부위}|다친 뒤>>'), /한글·띄어쓰기·쉼표/);
  bad(base.replace('다친 뒤', '<<다친 뒤|가|나|다|라>>'), /4개까지/);
  bad(base.replace('다친 뒤', '<<다친 뒤|교통사고로 다쳐서 병원에 다닌 지 오래된 뒤>>'), /너무 깁니다/);
  bad(base.replace('다친 뒤', '<<|>>'), /모두 비어/);
  // 빈 후보가 수치 변수 둘을 붙이면(펼쳐 보면) 막는다
  bad(base.replace(', 골반 기울기 ', '<<, 골반 기울기 |>>'), /다른 변수와 바로 붙어/);
  // 정도를 판단하는 말: 고정 글자든 후보든 막는다
  bad(base.replace('통증이 계속됨', '통증이 다소 계속됨'), /정도를 판단하는 말이 틀에 고정되어 있습니다: “다소”/);
  bad(base.replace('통증이 계속됨', '<<통증이 계속됨|통증이 현저히 남음>>'), /정도를 판단하는 말.*“현저”/);
  // 호전·악화는 경고만(‘호전 여부’는 괜찮음)
  const judged = Core.checkFrame(DOCTOR_A[2].replace('2차 검사함', '통증 호전되어 2차 검사함'), 2);
  assert.equal(judged.ok, true);
  assert.match(judged.warnings.join(' '), /판정 말 “호전”/);
  const whether = Core.checkFrame(DOCTOR_A[2].replace('2차 검사함', '호전 여부 확인 위해 2차 검사함'), 2);
  assert.ok(!whether.warnings.join(' ').includes('판정 말'));
  // 어느 벌이든 펼친 틀이 문제면 저장된 틀로 막는다
  const broken = Core.compose(firstState(), { frames: { 1: base.replace(', 골반 기울기 ', '<<, 골반 기울기 |>>'), 2: DOCTOR_A[2] }, requireFrame: true });
  assert.deepEqual(codes(broken.blocks), ['FRAME_INVALID']);
  // AI 답에서 바꿔 쓸 말이 든 틀을 그대로 꺼낸다
  const answer = '=== 1차 틀 A ===\n' + DOCTOR_W[1] + '\n=== 2차 틀 A ===\n' + DOCTOR_W[2];
  assert.deepEqual(Core.splitFrameSets(answer), { 1: [DOCTOR_W[1]], 2: [DOCTOR_W[2]] });
  // 벌끼리 비교할 때는 첫 후보로 본다(후보를 모두 더해 유사도가 부풀지 않게)
  assert.ok(Core.checkFrameSet([DOCTOR_W[1], DOCTOR_A[1]], 1).warnings.join(' ').includes('거의 같습니다'));
});

test('EDI-19c 요청문: 사람이 쓴 것처럼 잇고, 바꿔 쓸 말 후보를 넣고, 정도 판단 말은 쓰지 않게 한다', () => {
  const p = Core.framePrompt({ seed: 4 });
  for (const rule of ['사람이 쓴 차트처럼', '<<후보1|후보2|후보3>>', '환자마다 후보 하나를 골라', '정도를 판단하는 말', '바꿔 쓸 말 후보에 숫자·변수가 없는지']) assert.ok(p.includes(rule), rule);
  for (let seed = 0; seed < 100; seed += 1) {
    const ex = Core.exampleFrames(seed);
    assert.ok(ex[1].includes('<<') && ex[2].includes('<<'), 'seed ' + seed + ' 예시에 바꿔 쓸 말');
  }
  const natural = Array.from({ length: 60 }, (_, seed) => seed).find(seed => Core.styleRecipe(seed).index.separator === 0);
  assert.match(Core.exampleFrames(natural)[1], /<<로 측정되었고\|로 확인되었고>>/, '쉼표로 이을 때는 판독 수치를 문장으로');
  for (const form of Core.STYLE_CHOICES.form) assert.match(form, /문장/);
});

test('EDI-20a 틀은 저장 후 30일 동안 쓴다(30일이 되면 지움)', () => {
  const now = Date.parse('2026-11-19T06:00:00.000Z');
  const day = 86400000;
  assert.equal(Core.FRAME_DAYS, 30);
  assert.equal(Core.frameTimeLeft('2026-11-19T06:00:00.000Z', now), 30 * day);
  assert.equal(Core.frameTimeLeft(new Date(now - 29 * day).toISOString(), now), day);
  assert.ok(Core.frameTimeLeft(new Date(now - 30 * day).toISOString(), now) <= 0, '30일이 되면 다 씀');
  assert.ok(Core.frameTimeLeft(new Date(now - 45 * day).toISOString(), now) < 0);
  assert.equal(Core.frameTimeLeft('잘못된 날짜', now), 0, '저장 시각을 읽을 수 없으면 다 쓴 것으로');
  assert.equal(Core.frameTimeLeft(undefined, now), 0);
  assert.equal(Core.frameTimeLeft(new Date(now + 2 * day).toISOString(), now), 0, '하루 넘게 미래면 다 쓴 것으로');
  assert.equal(Core.frameTimeLeft(new Date(now + 3600000).toISOString(), now), 30 * day + 3600000, '시계 오차(한 시간)는 그대로');
});

// ---------- 독립 검수 r7 지적(RV7-01~08) ----------
// 표현 조합으로만 예시 틀과 너무 비슷해지는 1차 틀(묶음마다 원래 말과 다른 말을 엇갈려 둠). 펼침 검사는 통과하지만 일부 환자 조합은 막혀야 한다.
const MIXED = '[검사시행 사유] [[{수상일} ]][[{사고내용} ]]<<수상 후|교통 손상을 입은 뒤>> 4주 <<넘게 지났는데도|이상 경과에도>> [[{부위} ]]<<통증 지속|아픔이 그대로 남아>>[[({NRS})]]<<있어서|하여>> [[{확인목적} <<위해|살펴보려고>> ]]1차 <<촬영 진행|검사 시행>>. [환자평가·판독결과] <<어깨수평|어깨 기울어짐>> {어깨수평}, <<골반 기울어짐|골반수평>> {골반수평}, 등고선({등고선간격}) 좌 {좌측등고선}·우 {우측등고선}·차 {등고선차이}, <<어깨높이차|양 어깨 높낮이>> {어깨높이차}, <<좌우 비율은 어깨|길이비 어깨>> {어깨길이비}·골반 {골반길이비}. [치료계획] [[{치료}로 ]][[{치료목표} <<목표|바라보며>>, ]][[{다음평가} <<다시 확인하기로 함|재평가>>]].';

test('RV7-01 변수 {…} 안의 바꿔 쓸 말은 저장할 수 없고, 환자별로 펼친 틀이 문제면 그 환자의 복사를 막는다', () => {
  const brace1 = DOCTOR_A[1].replace('어깨 기울기 {어깨수평}, 골반 기울기 {골반수평}', '어깨 기울기 {<<어깨|골반>>수평}, 골반 기울기 {<<골반|어깨>>수평}');
  assert.notEqual(brace1, DOCTOR_A[1]);
  assert.match(Core.checkFrame(brace1, 1).errors.join(' '), /변수 \{…\} 안에 넣을 수 없습니다/);
  const brace2 = DOCTOR_A[2].replace('{수치비교}', '{<<수치비교|소견>>}');
  assert.match(Core.checkFrame(brace2, 2).errors.join(' '), /변수 \{…\} 안에 넣을 수 없습니다/);
  for (let w = 0; w < 40; w += 1) {
    const r = Core.compose(Object.assign(firstState(), { wording: w }), { frames: { 1: brace1, 2: DOCTOR_A[2] }, requireFrame: true });
    assert.equal(r.canCopy, false, 'wording ' + w);
  }
  // 펼침 검사(묶음마다 k번째 후보)는 통과하지만, 원래 말 조합이 모이면 예시와 너무 비슷해지는 틀 → 그 환자만 FRAME_WORDING
  assert.deepEqual(Core.checkFrame(MIXED, 1).errors, []);
  const at = w => Core.compose(Object.assign(firstState(), { wording: w }), { frames: { 1: MIXED, 2: DOCTOR_A[2] }, requireFrame: true });
  assert.deepEqual(codes(at(0).blocks), []);
  assert.deepEqual(codes(at(9).blocks), ['FRAME_WORDING']);
  assert.match(at(9).blocks[0].message, /다른 표현으로/);
});

test('RV7-02 묶음끼리 붙이거나 빈 후보로 [[ ]]를 만들 수 없고, 값 두 개가 맞닿으면 막는다', () => {
  const base = DOCTOR_A[1];
  const errorsOf = text => Core.checkFrame(text, 1).errors.join(' ');
  assert.match(errorsOf(base.replace(', 골반 기울기 ', '<<, |>><<|, >>골반 기울기 ')), /묶음 두 개를 붙여 쓸 수 없습니다/);
  assert.match(errorsOf(base.replace('통증이 계속됨', '<<통증이|아픔이>><<계속됨|남음>>')), /묶음 두 개를 붙여 쓸 수 없습니다/);
  assert.match(errorsOf(base.replace('[[{사고내용}로 ]]', '[<<가|>>[{사고내용}로 ]]')), /같은 괄호 사이/);
  // 한쪽만 [[ ]]에 붙은 묶음은 괜찮다(DOCTOR_W 모양)
  assert.equal(errorsOf(DOCTOR_W[1]), '');
  // 기존 경로: 빈 [[ ]]가 빠져 값이 맞닿으면 복사를 막는다
  const glue = base.replace('어깨 기울기 {어깨수평}, 골반 기울기 {골반수평}', '어깨 기울기 {어깨수평}[[ {치료목표} ]]{골반수평}');
  const noGoal = Core.compose(firstState({ goal: '' }), { frames: { 1: glue, 2: DOCTOR_A[2] }, requireFrame: true });
  assert.ok(noGoal.text.includes('1.2º-0.8º'));
  assert.ok(codes(noGoal.blocks).includes('FRAME_AMBIGUOUS'));
  assert.equal(noGoal.canCopy, false);
  // 빈 괄호가 지워져 맞닿는 틀은 저장 검사에서 막는다
  assert.match(errorsOf(base.replace('어깨 기울기 {어깨수평}, 골반 기울기 {골반수평}', '어깨 기울기 {어깨수평}(){골반수평}')), /채워 보면 수치가 앞뒤 글자와 붙어/);
  // 직접 고친 문구에서 값 뒤에 부호를 붙이면 그 값은 없는 것으로 본다
  const st = firstState();
  const auto = Core.compose(st, { frames: DOCTOR_A });
  st.manual[1] = { text: auto.text.replace('1.2º, 골반 기울기 -0.8º', '1.2º-0.8º, 골반 기울기 -0.8º'), base: auto.autoText, frame: auto.frameText };
  assert.equal(Core.compose(st, { frames: DOCTOR_A }).canCopy, false);
});

test('RV7-03 후보는 한글·띄어쓰기·쉼표·가운뎃점만, 값 앞의 부호·1 닮은꼴도 막는다', () => {
  const base = DOCTOR_A[1];
  for (const ch of ['l', 'I', 'ǀ', '丨', 'ㅣ', '⼀', '㇐', 'ᅳ', 'ￚ', '_', '¯', '~', '═', '╴', '⏤', 'O', 'x', '1', '.']) {
    assert.match(Core.checkFrame(base.replace('골반 기울기 {골반수평}', '골반 기울기 <<' + ch + '|>>{골반수평}'), 1).errors.join(' '), /한글·띄어쓰기·쉼표/, ch);
  }
  // 틀 글자(고정)에서도 값 바로 앞의 닮은꼴은 막는다
  for (const ch of ['⼀', 'ᅳ', '_', 'l', 'ㅣ']) {
    assert.match(Core.checkFrame(base.replace('골반 기울기 {골반수평}', '골반 기울기 ' + ch + '{골반수평}'), 1).errors.join(' '), /수치 변수 바로 앞뒤/, ch);
  }
  // 한글 후보·쉼표·가운뎃점·띄어쓰기는 된다
  assert.deepEqual(Core.checkFrame(base.replace('다친 뒤', '<<다친 뒤|다친 후·경과 중|다친 뒤, 지금까지>>'), 1).errors, []);
});

test('RV7-06 바꿔 쓸 말 수는 회차별이다(다른 회차 문구는 그대로)', () => {
  const frames = { 1: DOCTOR_W[1], 2: DOCTOR_W[2] };
  const second = w => Core.compose(Object.assign(secondState({ limitOn: false }), { wording: w }), { frames });
  assert.equal(second({ 1: 1, 2: 7 }).text, second({ 1: 99, 2: 7 }).text, '1차 수가 바뀌어도 2차 문구는 그대로');
  assert.notEqual(Core.compose(Object.assign(firstState(), { wording: { 1: 1, 2: 7 } }), { frames }).text, Core.compose(Object.assign(firstState(), { wording: { 1: 2, 2: 7 } }), { frames }).text);
  assert.deepEqual(Core.normalizeState({ wording: 5 }).wording, { 1: 5, 2: 5 }, '예전 형식(수 하나)은 두 회차에 같이');
  assert.deepEqual(Core.blankState().wording, { 1: 0, 2: 0 });
});

test('RV7-07 요청문 규칙이 검사기와 맞는다', () => {
  const p = Core.framePrompt({ seed: 4 });
  for (const word of ['현저', '뚜렷', '확연', '상당히', '크게', '많이', '매우', '다소', '약간', '조금', '미세하게', '심하게', '극심', '완전히', '훨씬', '확실히']) assert.ok(p.includes(word), word);
  for (const rule of ['한글·띄어쓰기·쉼표·가운뎃점만', '16자까지', '변수 {…} 안에 넣거나', '묶음 두 개를 붙여 쓰거나', '문장 끝 마침표는 괜찮습니다']) assert.ok(p.includes(rule), rule);
  assert.ok(!/숫자·부호\(-, \+\)·마침표를 붙이지/.test(p));
});

test('RV7-08 AI 답의 벌 이름(1·2·3, 버전 B)·4번째 벌·다시 붙인 요청문 예시', () => {
  const answer = ['=== 1차 틀 1 ===', DOCTOR_A[1], '=== 1차 틀 2 ===', DOCTOR_B[1], '=== 1차 틀 (버전 C) ===', DOCTOR_C[1], '=== 1차 틀 D ===', DOCTOR_W[1],
    '=== 2차 틀 1 ===', DOCTOR_A[2], '2차 틀 2:', DOCTOR_B[2]].join('\n');
  assert.deepEqual(Core.splitFrameSets(answer), { 1: [DOCTOR_A[1], DOCTOR_B[1], DOCTOR_C[1]], 2: [DOCTOR_A[2], DOCTOR_B[2]] }, '4번째 벌은 쓰지 않고 A를 바꾸지 않는다');
  const ex = Core.exampleFrames(17);
  const tail = ['=== 1차 틀 A ===', DOCTOR_A[1], '=== 2차 틀 A ===', DOCTOR_A[2], '', '아래는 요청문 예시입니다.', '=== 1차 틀 A ===', ex[1], '=== 2차 틀 A ===', ex[2]].join('\n');
  assert.deepEqual(Core.splitFrameSets(tail, { examples: ex }), { 1: [DOCTOR_A[1]], 2: [DOCTOR_A[2]] }, '이 요청문의 예시를 다시 붙이면 건너뛴다');
  assert.deepEqual(Core.splitFrameSets(tail), { 1: [ex[1]], 2: [ex[2]] }, '예시를 모르면 이전과 같다(마지막 표시)');
});

// ---------- Astra 마지막 검수 r5 지적(AST-R5-01·02) ----------
test('AST-R5-01 직접 고친 문구에 부호가 붙은 결과지 수치를 더 넣으면 막고(VALUE_EXTRA), 수치 두 개를 붙이면 막는다(VALUE_TOUCHING)', () => {
  for (const cycle of [1, 2]) {
    for (const sign of ['-', '+', String.fromCharCode(0x2212)]) {
      const s = Core.sampleState(cycle, 'sparse');
      s.limitOn = true;
      const opts = { frames: DOCTOR_B, requireFrame: true };
      const a = Core.compose(s, opts);
      s.manual[cycle] = { text: a.text.replace('1.2º', '1.2º, 1.2º' + sign), base: a.autoText, frame: a.frameText };
      const r = Core.compose(s, opts);
      assert.equal(r.canCopy, false, cycle + '차 ' + sign);
      assert.deepEqual(codes(r.blocks), ['VALUE_EXTRA'], cycle + '차 ' + sign);
    }
  }
  const st = firstState();
  const auto = Core.compose(st, { frames: DOCTOR_A });
  st.manual[1] = { text: auto.text.replace('1.2º, 골반 기울기 -0.8º', '1.2º-0.8º, 골반 기울기'), base: auto.autoText, frame: auto.frameText };
  const glued = Core.compose(st, { frames: DOCTOR_A });
  assert.deepEqual(codes(glued.blocks), ['VALUE_TOUCHING']);
  assert.match(glued.blocks[0].message, /1\.2º-0\.8º/);
  // 값과 떨어진 부호·범위 표시는 괜찮다
  st.manual[1] = { text: auto.text.replace('[치료계획]', '- 경과 관찰 + 재평가 [치료계획]'), base: auto.autoText, frame: auto.frameText };
  assert.deepEqual(codes(Core.compose(st, { frames: DOCTOR_A }).blocks), []);
});

