'use strict';
// TEMO 3.3.3 모아레 뷰어의 '복사하기' 문구를 같은 방식으로 만든다(시험 기대값용, 공개 화면 코드를 합성값으로 대조해 재현).
// 진단이나 의학적 해석이 아니다. 시험에서는 합성 입력만 넣는다.
// TEMO 3.3.3.temo Dde/Hde view-copy, not a medical interpretation.
function moireMetrics(raw) {
  const s = raw?.shoulderInfo, p = raw?.pelvisInfo;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const rounded = (value, digits, absolute = false) => finite(value) ? parseFloat((absolute ? Math.abs(value) : value).toFixed(digits)) : null;
  const a = rounded(s?.angle_xy, 1), b = rounded(p?.angle_xy, 1);
  const left = rounded(s?.moireCountLeft, 0, true), right = rounded(s?.moireCountRight, 0, true);
  const diff = left !== null && right !== null ? Math.abs(left - right) : null;
  const cm = finite(s?.verticalDistanceDiff) ? rounded(100 * s.verticalDistanceDiff, 2) : null;
  const xs = [s?.pointLeft?.camera?.x, s?.pointRight?.camera?.x, p?.pointLeft?.camera?.x, p?.pointRight?.camera?.x];
  const center = xs.every(value => finite(value)) ? xs.reduce((sum, x) => sum + x, 0) / 4 : null;
  function ratio(info) {
    if (!finite(center)) return null;
    const denominator = Math.abs(info.pointRight.camera.x - center);
    if (denominator === 0) return null;
    const r = Math.abs(info.pointLeft.camera.x - center) / denominator;
    if (!finite(r) || (r > 0 && r < 1 && !finite(1 / r))) return null;
    return r === 0 ? '0:1' : r >= 1 ? `${rounded(r, 2)}:1` : `1:${rounded(1 / r, 2)}`;
  }
  const sr = ratio(s), pr = ratio(p);
  function row(key, label, value, unit = '', digits = null) {
    const available = value !== null;
    const text = available ? (digits === null ? String(value) : (Object.is(value, -0) ? '-' : '') + value.toFixed(digits)) + unit : (key.endsWith('_ratio') ? '-' : '미확인 (unknown)');
    return { key, label, value, unit, text, available };
  }
  const rows = [
    row('shoulder_angle', '어깨 수평도', a, 'º', 1), row('pelvis_angle', '골반 수평도', b, 'º', 1),
    row('contour_interval', '등고선 간격', 6, 'mm'), row('contour_left', '좌측 등고선 개수', left, '개'),
    row('contour_right', '우측 등고선 개수', right, '개'), row('contour_diff', '좌우측 등고선 개수 차이', diff, '개'),
    row('shoulder_height_diff', '어깨 높이 차이', cm, 'cm'), row('shoulder_ratio', '어깨 좌우측 길이 비율', sr),
    row('pelvis_ratio', '골반 좌우측 길이 비율', pr)
  ];
  const text = key => rows.find(item => item.key === key).text;
  const copy_text = `기준점 수평도\n어깨 : ${text('shoulder_angle')} / 골반 : ${text('pelvis_angle')}\n          \n등고선 비교\n등고선 간격 : 6mm\n1. 좌측 등고선 개수 : ${text('contour_left')}\n2. 우측 등고선 개수 : ${text('contour_right')}      \n3. 좌우측 등고선 개수 차이 : ${text('contour_diff')}\n\n어깨 높이 차이 : ${text('shoulder_height_diff')}\n어깨 좌우측 길이 비율 : ${text('shoulder_ratio')}\n골반 좌우측 길이 비율 : ${text('pelvis_ratio')}`;
  const issues = rows.filter(item => !item.available).map(item => 'UNKNOWN:' + item.key);
  return { rows, copy_text, complete: issues.length === 0, issues };
}

module.exports = { moireMetrics };
