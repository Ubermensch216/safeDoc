// 계좌번호 탐지 (FR-305)

import { BANK_NAMES } from '../dictionaries.js';
import { fieldKeywordScore, digitBoundaryPenalty, makeCandidate, getContext } from './helpers.js';

// 하이픈으로 구분된 3~4그룹 숫자열 (10~14자리) 또는 은행명 인접 연속 숫자
const ACCOUNT_REGEX = /\d{2,6}[-]\d{2,6}[-]\d{2,8}(?:[-]\d{1,6})?/g;
const PLAIN_ACCOUNT_REGEX = /\d{10,14}/g;

// 계좌가 아닌 번호류 라벨 (ANALYSIS 2.5의 검토 피로도 문제와 동일한 이유로 배제)
// 라벨이 값 바로 앞에서 값의 정체를 밝히고 있으므로 은행명이 근처에 있어도 계좌가 아니다.
export const NON_ACCOUNT_LABEL =
  /(?:(주문|문서|계약|접수|전표|승인|송장|운송장|관리|사건|공문|공고|고시|허가|등록|발주|정산|참조|추적|우편|일련|고유|과제|식별)\s*번호|예산\s*코드)\s*[:：=]?\s*$/;

// 연도로 시작하는 그룹(2026-…)은 문서번호·기안번호일 가능성이 높다
const YEAR_PREFIX = /^(19|20)\d{2}-/;

function bankContextScore(text, start, end) {
  const ctx = getContext(text, start, end, 30);
  return BANK_NAMES.some((b) => ctx.includes(b)) ? 0.25 : 0;
}

export function detectAccount(text) {
  const results = [];

  for (const m of text.matchAll(ACCOUNT_REGEX)) {
    const raw = m[0];
    const digits = raw.replace(/-/g, '');
    if (digits.length < 10 || digits.length > 16) continue;
    const start = m.index;
    const end = start + raw.length;
    // 전화번호(국제전화 +82-10-... 포함)·주민번호 패턴과 겹치는 형식은 제외
    if (/^01[016789]/.test(digits) || /^820?1[016789]/.test(digits) || /^\d{6}-\d{7}$/.test(raw)) continue;
    if (start > 0 && text[start - 1] === '+') continue;
    // 번호류 라벨이 값 바로 앞에 있으면 계좌가 아니다 (ANALYSIS 2.3)
    if (NON_ACCOUNT_LABEL.test(text.slice(Math.max(0, start - 16), start))) continue;
    const fieldScore = fieldKeywordScore(text, start, 'ACCOUNT_NO');
    const bankScore = bankContextScore(text, start, end);
    // 연도형은 계좌 문맥(필드명·은행명)이 있을 때만 인정한다 (ANALYSIS 2.3)
    if (YEAR_PREFIX.test(raw) && fieldScore === 0 && bankScore === 0) continue;
    let score = 0.4 + fieldScore + bankScore;
    score -= digitBoundaryPenalty(text, start, end);
    if (score < 0.35) continue;
    results.push(makeCandidate({ text, start, end, type: 'ACCOUNT_NO', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }

  // 구분자 없는 숫자열은 은행명 또는 계좌 필드명이 인접한 경우에만 후보로 인정
  for (const m of text.matchAll(PLAIN_ACCOUNT_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    const fieldScore = fieldKeywordScore(text, start, 'ACCOUNT_NO');
    const bankScore = bankContextScore(text, start, end);
    if (fieldScore === 0 && bankScore === 0) continue;
    let score = 0.35 + fieldScore * 2 + bankScore;
    score -= digitBoundaryPenalty(text, start, end);
    if (score < 0.35) continue;
    results.push(makeCandidate({ text, start, end, type: 'ACCOUNT_NO', baseScore: Math.min(score, 1), detectionMethod: 'CONTEXT' }));
  }

  return results;
}
