// 성명 탐지 — 사전·필드명·문맥·호칭 조합 (FR-311, 기술명세서 Ⅴ-5)

import {
  KOREAN_SURNAMES, KOREAN_SURNAMES_2CHAR, NAME_FIELD_KEYWORDS, NAME_TITLES, NAME_STOPWORDS,
  FIELD_KEYWORDS_BY_TYPE, BANK_NAMES,
} from '../dictionaries.js';

// 모든 유형의 필드명 키워드("차량번호", "전화번호" 등)는 성명 후보에서 제외
const ALL_FIELD_KEYWORDS = new Set(
  Object.values(FIELD_KEYWORDS_BY_TYPE).flat().filter((k) => /^[가-힣]+$/.test(k)),
);
import { makeCandidate } from './helpers.js';

// 필드명 뒤의 값: "성명: 홍길동", "이름 홍길동" (같은 줄 안에서만 — 줄바꿈은 셀·문단 경계)
const FIELD_NAME_PATTERN = new RegExp(
  `(${NAME_FIELD_KEYWORDS.join('|')})[ \\t]*[:：=]?[ \\t]*([가-힣]{2,5})(?![가-힣])`,
  'g',
);

// 이름 뒤에 붙은 조사 분리 (ANALYSIS.md 2.1)
//
// 조사를 무조건 떼면 조사와 같은 음절로 끝나는 이름이 잘린다.
//   "최다은" → "최다"만 가려지고 실명의 끝 글자가 결과 문서에 남는다.
// 그렇다고 떼지 않으면 "홍길동에게"를 통째로 가려 문서를 읽을 수 없게 된다.
//
// 그래서 조사를 두 부류로 나눈다.
//   1) 이름의 마지막 음절로 쓰이지 않는 조사 → 안전하게 뗀다.
//   2) 이름 끝 음절과 구분할 수 없는 조사(은·이·가 …) → 뗀 형태와 안 뗀 형태를
//      모두 후보로 내고 판단을 중첩 정리에 맡긴다. resolveOverlaps 가 더 긴 범위를
//      우선하므로(engine.js priorityKey) 가림 범위가 넓은 쪽, 즉 안전한 쪽이 선택된다.
const UNAMBIGUOUS_PARTICLES = /(에게서|으로부터|께서|에게|한테|으로|는|을|를|의|께)$/;
const AMBIGUOUS_PARTICLES = /(은|이|가|과|와|도|만)$/;

// 하나의 단어에서 성명일 수 있는 표기들을 길이 내림차순으로 반환한다.
// 마지막 원소는 항상 조사를 최대한 뗀 형태이며, 점수 계산의 기준이 된다.
function nameVariants(word) {
  const unambiguous = word.replace(UNAMBIGUOUS_PARTICLES, '');
  if (unambiguous !== word) return unambiguous.length >= 2 ? [unambiguous] : [word];

  const ambiguous = word.replace(AMBIGUOUS_PARTICLES, '');
  if (ambiguous !== word && ambiguous.length >= 2) return [word, ambiguous];

  return [word];
}

// 기관명·복합어 배제 (ANALYSIS 2.5)
// "국민은행"·"한국전력공사"처럼 성씨로 시작하는 기관명이 성명으로 오탐됐다.
// 오탐이 많으면 사용자가 전체 선택 해제를 눌러 진짜 개인정보까지 놓치므로
// (검토 피로도), 기관 접미사로 끝나는 단어와 은행명은 사전에서 배제한다.
const ORG_SUFFIX = /(은행|공사|공단|공고|센터|지점|본점|금고|협회|재단|법인|부서|번호)$/;
const BANK_NAME_SET = new Set(BANK_NAMES);
function isOrgWord(word) {
  return BANK_NAME_SET.has(word) || (word.length >= 3 && ORG_SUFFIX.test(word));
}

// 한글 2~5글자 단어 (성씨 사전 확인용)
const HANGUL_WORD = /[가-힣]{2,5}/g;

const TITLE_PATTERN = new RegExp(`^\\s?(${NAME_TITLES.join('|')})(?![가-힣])`);

function startsWithSurname(word) {
  return (
    KOREAN_SURNAMES_2CHAR.has(word.slice(0, 2)) ||
    KOREAN_SURNAMES.has(word[0])
  );
}

export function detectName(text, { otherPiiRanges = [] } = {}) {
  const results = [];
  const seen = new Set();

  // 1) 필드명 기반 탐지 — 높은 신뢰도
  for (const m of text.matchAll(FIELD_NAME_PATTERN)) {
    const variants = nameVariants(m[2]);
    // 제외 판정은 조사를 뗀 형태로 한다 ("조치를"이 아니라 "조치"가 제외어다)
    const base = variants[variants.length - 1];
    if (NAME_STOPWORDS.has(base)) continue;
    if (NAME_FIELD_KEYWORDS.includes(base) || ALL_FIELD_KEYWORDS.has(base)) continue; // 필드명 자체는 성명이 아님
    if (isOrgWord(base)) continue; // 기관명은 성명이 아님 (ANALYSIS 2.5)
    const start = m.index + m[0].length - m[2].length;
    let score = 0.55 + 0.15;
    if (startsWithSurname(base)) score += 0.2;
    for (const word of variants) {
      const end = start + word.length;
      const key = `${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(makeCandidate({ text, start, end, type: 'PERSON_NAME', baseScore: Math.min(score, 1), detectionMethod: 'CONTEXT' }));
    }
  }

  // 동사·어미형 단어 제외 ("연락하여", "안내하고" 등)
  const VERB_SUFFIX = /(하여|하고|하는|하니|하면|하며|했다|한다|합니다|되어|된다|됩니다|하기|하지)$/;

  // 2) 성씨 사전 기반 탐지 — 조사가 붙은 형태("홍길동에게")도 분리하여 인식
  const wordCount = new Map(); // 반복 출현 점수용
  const candidates = [];
  for (const m of text.matchAll(HANGUL_WORD)) {
    const raw = m[0];
    if (raw.length < 2) continue;
    if (VERB_SUFFIX.test(raw)) continue;
    // 앞이 한글이면 더 긴 단어의 일부이므로 제외
    if (m.index > 0 && /[가-힣]/.test(text[m.index - 1])) continue;
    const variants = nameVariants(raw);
    // 제외 판정과 점수 계산은 조사를 뗀 형태를 기준으로 한다
    const base = variants[variants.length - 1];
    if (base.length < 2 || base.length > 4) continue;
    if (!startsWithSurname(base)) continue;
    if (NAME_STOPWORDS.has(base)) continue;
    // 직위·호칭 단어 자체는 성명이 아님 ("주무관" 등)
    if (NAME_TITLES.includes(base)) continue;
    // 필드명 키워드 자체는 성명이 아님 ("차량번호" 등)
    if (ALL_FIELD_KEYWORDS.has(base) || ALL_FIELD_KEYWORDS.has(raw)) continue;
    // 기관명·은행명은 성명이 아님 (ANALYSIS 2.5)
    if (isOrgWord(base) || isOrgWord(raw)) continue;
    candidates.push({ base, variants, start: m.index });
    wordCount.set(base, (wordCount.get(base) || 0) + 1);
  }

  for (const c of candidates) {
    const baseEnd = c.start + c.base.length;

    // 필드명 자체("연락처", "담당자" 등)와 라벨 위치(뒤에 콜론)는 성명이 아님
    if (NAME_FIELD_KEYWORDS.includes(c.base)) continue;
    if (/^\s*[:：=]/.test(text.slice(baseEnd, baseEnd + 3))) continue;

    let score = 0.3; // 형식(성씨+2~4글자) 기본 점수
    const after = text.slice(baseEnd, baseEnd + 6);

    // 직위·호칭 결합 (홍길동 님, 김철수 과장)
    if (TITLE_PATTERN.test(after)) score += 0.3;

    // 조사 결합 (홍길동은, 홍길동에게 등) — 문장 내 주체로 쓰이는 경우
    if (/^(은|는|이|가|을|를|에게|께서|의)(?![가-힣])/.test(after)) score += 0.1;

    // 다른 개인정보와의 인접성 (전화번호·주민번호 등 40자 이내)
    const nearPii = otherPiiRanges.some(
      (r) => Math.abs(r.start - baseEnd) < 40 || Math.abs(c.start - r.end) < 40,
    );
    if (nearPii) score += 0.15;

    // 동일 문서 내 반복 출현
    if ((wordCount.get(c.base) || 0) >= 2) score += 0.1;

    // 3글자 이름이 2글자보다 오탐 적음
    if (c.base.length === 2) score -= 0.15;

    if (score < 0.4) continue;

    // 조사 판단이 애매한 경우 뗀 형태와 안 뗀 형태를 모두 후보로 낸다.
    // 중첩 정리에서 더 긴 범위가 선택되므로 실명 음절이 남지 않는다.
    for (const word of c.variants) {
      const end = c.start + word.length;
      const key = `${c.start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(makeCandidate({
        text, start: c.start, end, type: 'PERSON_NAME',
        baseScore: Math.min(score, 1), detectionMethod: 'DICTIONARY',
      }));
    }
  }

  return results;
}
