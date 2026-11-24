// 전화번호 탐지 — 휴대전화·일반전화·국제전화·숫자셀·구술표기 (FR-303)

import { FIELD_KEYWORDS_BY_TYPE } from '../dictionaries.js';
import { NON_ACCOUNT_LABEL } from './account.js';
import { fieldKeywordScore, digitBoundaryPenalty, makeCandidate } from './helpers.js';

// 국제전화(한국 +82): +82-10-9876-5432, (+82) 10 9876 5432, +82-010-9876-5432, +821098765432
const INTL_MOBILE_REGEX = /(?:\(\+82\)|\+82)[-.\s)]*(?:\(0\)|0)?1[016789][-.\s_]?\d{3,4}[-.\s_]?\d{4}/g;
// + 기호 없이 구분자로 표기된 국가번호 휴대전화: 82-10-9876-5432
const INTL_MOBILE_NOPLUS_REGEX = /(?<!\d)82[-.\s]+0?1[016789][-.\s_]\d{3,4}[-.\s_]\d{4}/g;
// 국제전화(한국 일반전화): +82-2-1234-5678, +82-31-123-4567
const INTL_LANDLINE_REGEX = /(?:\(\+82\)|\+82)[-.\s)]*(?:\(0\)|0)?(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70|80|50\d)[-.\s_)]?\d{3,4}[-.\s_]?\d{4}/g;

// 휴대전화: 010/011/016/017/018/019, 하이픈·점·공백·밑줄·무구분 허용
const MOBILE_REGEX = /01[016789][-.\s_]?\d{3,4}[-.\s_]?\d{4}/g;

// 일반전화: 02 또는 0XX 지역번호, 괄호·밑줄 표현 허용
const LANDLINE_REGEX = /(?:\(0\d{1,2}\)|0(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70|80|50\d))[-.\s_)]?\d{3,4}[-.\s_]?\d{4}/g;

// 숫자 서식 셀 등에서 앞자리 0이 탈락한 휴대전화: 1098765432 (10+8자리) 또는 1[16789]+7~8자리
const STRIPPED_ZERO_MOBILE_REGEX = /(?<!\d)1(?:0\d{8}|[16789]\d{7,8})(?!\d)/g;

// 한글 구술 표기 휴대전화: "공일공 구팔칠육 오사삼이", "영일공 육칠팔구 영일이삼"
const HANGUL_MOBILE_REGEX = /(?:공|영)일(?:공|영|일|육|칠|팔|구)[ \t]*(?:[공영일이삼사오육칠팔구]{3,4})[ \t]*(?:[공영일이삼사오육칠팔구]{4})/g;

const PHONE_CONTEXT_KEYWORDS = [
  ...new Set([
    ...FIELD_KEYWORDS_BY_TYPE.PHONE_MOBILE,
    ...FIELD_KEYWORDS_BY_TYPE.PHONE_LANDLINE,
  ]),
];

function hasNearbyPhoneKeyword(text, start, end, radius = 40) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const windowText = text.slice(from, to);
  return PHONE_CONTEXT_KEYWORDS.some((kw) => windowText.includes(kw));
}

export function detectPhone(text) {
  const results = [];

  for (const re of [INTL_MOBILE_REGEX, INTL_MOBILE_NOPLUS_REGEX]) {
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      let score = 0.9;
      score += fieldKeywordScore(text, start, 'PHONE_MOBILE');
      score -= digitBoundaryPenalty(text, start, end);
      if (score < 0.3) continue;
      results.push(makeCandidate({ text, start, end, type: 'PHONE_MOBILE', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
    }
  }

  for (const m of text.matchAll(INTL_LANDLINE_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    let score = 0.85;
    score += fieldKeywordScore(text, start, 'PHONE_LANDLINE');
    score -= digitBoundaryPenalty(text, start, end);
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'PHONE_LANDLINE', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }

  for (const m of text.matchAll(MOBILE_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    let score = 0.55 + 0.3;
    score += fieldKeywordScore(text, start, 'PHONE_MOBILE');
    score -= digitBoundaryPenalty(text, start, end);
    // 구분자 없는 연속 숫자는 감점 (계좌·문서번호와 혼동 가능)
    if (!/[-.\s_]/.test(m[0])) score -= 0.15;
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'PHONE_MOBILE', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }

  for (const m of text.matchAll(LANDLINE_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    // 휴대전화와 중복되는 구간은 건너뜀 (010은 지역번호가 아님)
    if (/^01[016789]/.test(m[0].replace(/[^\d]/g, ''))) continue;
    let score = 0.5 + 0.25;
    score += fieldKeywordScore(text, start, 'PHONE_LANDLINE');
    score -= digitBoundaryPenalty(text, start, end);
    if (!/[-.\s_()]/.test(m[0])) score -= 0.2;
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'PHONE_LANDLINE', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }

  // 앞자리 0 탈락 휴대전화(1098765432 등): 주변에 연락처·전화 문맥이 있을 때 탐지
  for (const m of text.matchAll(STRIPPED_ZERO_MOBILE_REGEX)) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    // 금액(1000000000 등)이나 비전화 번호 라벨(주문번호·접수번호 등) 배제
    if (/0{5,}$/.test(raw)) continue;
    if (NON_ACCOUNT_LABEL.test(text.slice(Math.max(0, start - 16), start))) continue;
    if (!hasNearbyPhoneKeyword(text, start, end, 40)) continue;
    let score = 0.75;
    score -= digitBoundaryPenalty(text, start, end);
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'PHONE_MOBILE', baseScore: Math.min(score, 1), detectionMethod: 'CONTEXT' }));
  }

  // 한글 구술 표기 휴대전화 ("공일공 구팔칠육 오사삼이")
  for (const m of text.matchAll(HANGUL_MOBILE_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > 0 && /[가-힣]/.test(text[start - 1])) continue;
    if (end < text.length && /[가-힣]/.test(text[end])) continue;
    results.push(makeCandidate({ text, start, end, type: 'PHONE_MOBILE', baseScore: 0.85, detectionMethod: 'REGEX' }));
  }

  return results;
}
