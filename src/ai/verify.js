// AI 응답 검증 및 오프셋 복원 (계획 C-1, C-5)
//
// LLM은 문자 위치를 세지 못하므로 오프셋을 묻지 않는다.
// 모델은 값만 반환하고, 여기서 청크 텍스트를 실제로 검색하여 위치를 복원한다.
// 청크에 존재하지 않는 값은 환각이므로 폐기한다.

import { PII_TYPES } from '../detect/types.js';

// 1글자 값은 오탐 위험이 지나치게 크다
const MIN_VALUE_LENGTH = 2;
// 흔한 단어를 개인정보로 반환한 경우를 걸러낸다 (예: 조사, 일반명사)
const MAX_OCCURRENCES = 50;
// 근거 문구가 지나치게 길면 화면을 망가뜨리므로 자른다
const MAX_REASON_LENGTH = 40;

function sanitizeReason(reason) {
  if (typeof reason !== 'string') return '';
  const trimmed = reason.replace(/\s+/g, ' ').trim();
  return trimmed.length > MAX_REASON_LENGTH ? `${trimmed.slice(0, MAX_REASON_LENGTH)}…` : trimmed;
}

// 청크 안에서 값이 나타나는 모든 위치를 전역 오프셋으로 반환
// "홍길동"이 5번 나오면 5곳 모두 개인정보이므로 전부 후보로 만든다.
export function locateAll(chunkText, base, value) {
  const positions = [];
  let idx = chunkText.indexOf(value);
  while (idx >= 0) {
    positions.push({ start: base + idx, end: base + idx + value.length });
    if (positions.length > MAX_OCCURRENCES) return [];
    idx = chunkText.indexOf(value, idx + value.length);
  }
  return positions;
}

// 모델 응답 items → 후보 원시 형태 [{ start, end, originalText, type, aiReason }]
// 반환: { candidates, rejected } — rejected는 환각으로 폐기한 건수(감사 기록용)
export function verifyItems(items, chunk) {
  const candidates = [];
  let rejected = 0;

  for (const item of items) {
    const value = typeof item?.value === 'string' ? item.value : '';
    if (value.length < MIN_VALUE_LENGTH) {
      rejected += 1;
      continue;
    }

    // 유효한 유형 코드인지 확인 (스키마가 강제하지만 방어)
    const type = PII_TYPES[item?.type] ? item.type : 'CUSTOM';

    const positions = locateAll(chunk.text, chunk.base, value);
    if (positions.length === 0) {
      // 문서에 없는 값 = 환각. 폐기하고 기록한다.
      rejected += 1;
      continue;
    }

    const reason = sanitizeReason(item?.reason);
    for (const pos of positions) {
      candidates.push({
        start: pos.start,
        end: pos.end,
        originalText: value,
        type,
        aiReason: reason,
      });
    }
  }

  return { candidates, rejected };
}

// 검증 응답(judgements) → 오탐 의심 목록
// isPersonalInfo가 명시적으로 false인 것만 취한다.
// 모델이 답하지 않았거나 형식이 어긋난 값은 개인정보로 간주한다(놓치는 쪽이 더 위험하다).
export function collectDisputed(judgements, askedValues, chunk) {
  const asked = new Set(askedValues);
  const out = [];
  for (const item of judgements) {
    const value = typeof item?.value === 'string' ? item.value : '';
    if (value.length < MIN_VALUE_LENGTH) continue;
    // 물어보지 않은 값에 대한 판정은 무시한다 (모델이 임의로 범위를 넓히는 것 방지)
    if (!asked.has(value)) continue;
    if (item?.isPersonalInfo !== false) continue;
    if (!chunk.text.includes(value)) continue;
    out.push({ value, reason: sanitizeReason(item?.reason) });
  }
  return out;
}
