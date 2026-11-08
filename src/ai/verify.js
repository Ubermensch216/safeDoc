// AI 응답 검증 및 오프셋 복원 (계획 C-1, C-5)
//
// LLM은 문자 위치를 세지 못하므로 오프셋을 묻지 않는다.
// 모델은 값만 반환하고, 여기서 청크 텍스트를 실제로 검색하여 위치를 복원한다.
// 청크에 존재하지 않는 값은 환각이므로 폐기하고,
// 존재하더라도 부서명·기관명·행정용어·비생년월일 등 문맥상 개인정보가 아닌 항목은 걸러낸다.

import { PII_TYPES } from '../detect/types.js';
import { NAME_TITLES } from '../detect/dictionaries.js';
import {
  isNonNameWord,
  isPrecededByNonNameLabel,
  isFollowedByOrgContext,
} from '../detect/rules/name.js';
import { isNonAddressValue } from '../detect/rules/address.js';
import { isNonBirthDateContext } from '../detect/rules/misc.js';
import { NON_ACCOUNT_LABEL } from '../detect/rules/account.js';

// 1글자 값은 오탐 위험이 지나치게 크다
const MIN_VALUE_LENGTH = 2;
// 흔한 단어를 개인정보로 반환한 경우를 걸러낸다 (예: 조사, 일반명사)
const MAX_OCCURRENCES = 50;
// 근거 문구가 지나치게 길면 화면을 망가뜨리므로 자른다
const MAX_REASON_LENGTH = 40;

const TRAILING_TITLE_RE = new RegExp(`\\s+(${NAME_TITLES.join('|')})$`);
const TRAILING_PREDICATE_RE = /(입니다|이었다|이었고|이었으며|이라고|이라는|이다|이고|이며|였다|였고|였으며|라고)$/;
const VALID_NAME_SUFFIX_RE =
  /^(은|는|이|가|을|를|의|과|와|도|만|에게서|으로부터|에게|한테|께서|께|님|씨|군|양|옹|이다|입니다|이었다|이었고|이었으며|이라고|이라는|이고|이며|였다|였고|였으며|라고)$/;

// 소형 모델이 isPersonalInfo=false를 반환하면서 사유에는 "계좌번호로 판단됨", "주소 정보로 판단됨"처럼
// 개인정보임을 긍정하는 자기모순 응답을 내는 사례를 방어한다 (정답지.md 05번 사례).
const CONTRADICTORY_POSITIVE_REASON_RE =
  /^(계좌\s*번호|카드\s*번호|주민\s*등록\s*번호|주민\s*번호|외국인\s*등록\s*번호|전화\s*번호|휴대\s*전화|연락처|이메일|사람\s*이름|실제\s*이름|개인\s*성명|성명|실명|개인\s*주소|도로명\s*주소|주소\s*정보|생년월일|개인\s*정보)(로\s*판단|에\s*해당|임|입니다|로\s*보임|로\s*확인)/;
const NEGATION_IN_REASON_RE =
  /(아님|아닌|아니라|오탐|일반|기관|부서|은행|회사|법인|사업소|공용|단순|조직|지명|장소|용어|수치|번호류|문서번호|주문번호|접수번호)/;

function sanitizeReason(reason) {
  if (typeof reason !== 'string') return '';
  const trimmed = reason.replace(/\s+/g, ' ').trim();
  return trimmed.length > MAX_REASON_LENGTH ? `${trimmed.slice(0, MAX_REASON_LENGTH)}…` : trimmed;
}

// 모델이 성명 뒤에 호칭("박서준 씨")이나 서술어 어미("최다은이다")를 붙여 반환한 경우 순수 이름으로 정규화
function normalizeAiNameValue(value, chunkText) {
  let cleaned = value.trim();
  const withoutTitle = cleaned.replace(TRAILING_TITLE_RE, '');
  if (withoutTitle !== cleaned && withoutTitle.length >= MIN_VALUE_LENGTH && chunkText.includes(withoutTitle)) {
    cleaned = withoutTitle;
  }
  const withoutPred = cleaned.replace(TRAILING_PREDICATE_RE, '');
  if (withoutPred !== cleaned && withoutPred.length >= MIN_VALUE_LENGTH && chunkText.includes(withoutPred)) {
    cleaned = withoutPred;
  }
  return cleaned;
}

// 어휘·형식 수준에서 명백히 개인정보가 아닌 AI 반환값을 배제
function isRejectedByLexicalCriteria(value, type) {
  if (type === 'PERSON_NAME') {
    return isNonNameWord(value);
  }
  if (type === 'ADDRESS') {
    return isNonAddressValue(value);
  }
  if (type === 'BIRTH_DATE') {
    const trimmed = value.trim();
    if (!/\d/.test(trimmed)) return true;
    // "26년", "42개소", "1,924" 같은 연도·수량 단독 표기는 생년월일이 아님
    if (/^\d{1,4}\s*(년|개소|구역|명|건|원|%)$/.test(trimmed)) return true;
    if (/^[\d,]+$/.test(trimmed) && trimmed.replace(/\D/g, '').length < 6) return true;
  }
  if (type === 'ACCOUNT_NO' || type === 'PHONE_MOBILE' || type === 'PHONE_LANDLINE' || type === 'RRN') {
    const trimmed = value.trim();
    // 한글 숫자 표기("공일공 구팔칠육 오사삼이")가 아닌데 숫자가 6자리 미만이면 인원수·통계 수치임
    const hasHangulDigits = /[공영일이삼사오육칠팔구]/.test(trimmed);
    const digitCount = trimmed.replace(/\D/g, '').length;
    if (!hasHangulDigits && digitCount < 7) return true;
  }
  return false;
}

// 청크 문맥 내에서 해당 위치(relStart~relEnd)가 실제 개인정보로 유효한지 검증
function isValidPositionInContext(chunkText, relStart, relEnd, value, type) {
  // 한글로 시작하는 값이 앞쪽 한글과 바로 붙어 있으면 더 긴 단어의 일부("문화국" 안의 "문화")이므로 배제
  if (/^[가-힣]/.test(value) && relStart > 0 && /[가-힣]/.test(chunkText[relStart - 1])) {
    return false;
  }

  if (type === 'PERSON_NAME') {
    if (isPrecededByNonNameLabel(chunkText, relStart)) return false;
    if (isFollowedByOrgContext(chunkText, relEnd)) return false;

    // 뒤쪽에 한글이 바로 이어지는 경우: 조사·어미가 아니라 복합어("민원지원과", "한국전력공사")의 일부이면 배제
    if (relEnd < chunkText.length && /[가-힣]/.test(chunkText[relEnd])) {
      const rest = chunkText.slice(relEnd).match(/^[가-힣]+/)?.[0] || '';
      if (isNonNameWord(value + rest)) return false;
      if (!VALID_NAME_SUFFIX_RE.test(rest)) return false;
    }
  } else if (type === 'BIRTH_DATE') {
    if (isNonBirthDateContext(chunkText, relStart, relEnd)) return false;
  } else if (type === 'ACCOUNT_NO' || type === 'PHONE_MOBILE' || type === 'PHONE_LANDLINE') {
    const before = chunkText.slice(Math.max(0, relStart - 16), relStart);
    if (NON_ACCOUNT_LABEL.test(before)) return false;
  }

  return true;
}

// 청크 안에서 값이 나타나는 모든 위치를 전역 오프셋으로 반환
// "홍길동"이 5번 나오면 5곳 모두 개인정보이므로 전부 후보로 만든다.
//
// 출현 상한 초과는 환각과 구분한다 (ANALYSIS 2.9).
// 명단·대장 문서에서 같은 이름이 51번 나오는 것은 환각이 아니라 흔한 값이며,
// 규칙 탐지가 별도로 잡아준다. 이전에는 빈 배열을 돌려줘 호출부가 환각으로
// 집계했고, 감사 기록이 사실과 달라졌다.
export function locateAll(chunkText, base, value) {
  const positions = [];
  let idx = chunkText.indexOf(value);
  while (idx >= 0) {
    positions.push({ start: base + idx, end: base + idx + value.length });
    if (positions.length > MAX_OCCURRENCES) {
      return { positions: [], overflow: true };
    }
    idx = chunkText.indexOf(value, idx + value.length);
  }
  return { positions, overflow: false };
}

// 모델 응답 items → 후보 원시 형태 [{ start, end, originalText, type, aiReason }]
// 반환: { candidates, rejected, skippedCommon }
//   rejected      환각(문서에 없는 값) 또는 비개인정보 배제 규칙으로 폐기한 건수 — 감사 기록용
//   skippedCommon 출현 상한 초과로 건너뛴 건수 — 환각이 아니므로 분리 집계 (ANALYSIS 2.9)
export function verifyItems(items, chunk) {
  const candidates = [];
  let rejected = 0;
  let skippedCommon = 0;

  for (const item of items) {
    const rawValue = typeof item?.value === 'string' ? item.value : '';
    if (rawValue.length < MIN_VALUE_LENGTH) {
      rejected += 1;
      continue;
    }

    // 유효한 유형 코드인지 확인 (스키마가 강제하지만 방어)
    const type = PII_TYPES[item?.type] ? item.type : 'CUSTOM';

    const value = type === 'PERSON_NAME'
      ? normalizeAiNameValue(rawValue, chunk.text)
      : rawValue;

    if (value.length < MIN_VALUE_LENGTH || isRejectedByLexicalCriteria(value, type)) {
      rejected += 1;
      continue;
    }

    const { positions, overflow } = locateAll(chunk.text, chunk.base, value);
    if (overflow) {
      // 흔한 값 — 규칙 탐지가 잡아준다. 환각 건수와 섞지 않는다.
      skippedCommon += 1;
      continue;
    }
    if (positions.length === 0) {
      // 문서에 없는 값 = 환각. 폐기하고 기록한다.
      rejected += 1;
      continue;
    }

    const validPositions = positions.filter((pos) =>
      isValidPositionInContext(chunk.text, pos.start - chunk.base, pos.end - chunk.base, value, type));

    if (validPositions.length === 0) {
      rejected += 1;
      continue;
    }

    const reason = sanitizeReason(item?.reason);
    for (const pos of validPositions) {
      candidates.push({
        start: pos.start,
        end: pos.end,
        originalText: value,
        type,
        aiReason: reason,
      });
    }
  }

  return { candidates, rejected, skippedCommon };
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
    const reason = sanitizeReason(item?.reason);
    // 사유가 개인정보임을 긍정하면서 boolean만 false로 뒤집힌 자기모순 응답은 무시한다
    if (CONTRADICTORY_POSITIVE_REASON_RE.test(reason) && !NEGATION_IN_REASON_RE.test(reason)) {
      continue;
    }
    out.push({ value, reason });
  }
  return out;
}
