// AI 후보를 규칙 기반 후보에 병합 (계획 C-6)
//
// 핵심 안전 규칙 두 가지:
//  1. AI는 후보를 추가만 한다. 사용자가 선택한 처리 대상을 해제하지 않는다.
//     문서에 프롬프트 인젝션이 심겨 모델이 "개인정보 없음"을 반환해도 규칙 결과는 그대로 남는다.
//  2. AI가 반환한 유형을 그대로 쓰지 않는다.
//     실측에서 모델이 주민등록번호를 PERSON_NAME으로 분류했다. 그대로 두면
//     처리방식이 MASK_ALL에서 REPLACE로 약화되어 비식별이 무력화된다.

import { STRUCTURED_TYPES } from '../detect/engine.js';
import { detectRRN } from '../detect/rules/rrn.js';
import { detectPhone } from '../detect/rules/phone.js';
import { detectEmail } from '../detect/rules/email.js';
import { detectCard } from '../detect/rules/card.js';
import { detectAccount } from '../detect/rules/account.js';
import {
  detectPassport, detectBusinessNo, detectVehicle, detectIP, detectBirthDate,
} from '../detect/rules/misc.js';
import { getContext } from '../detect/rules/helpers.js';

// AI 단독 후보의 신뢰도 상한. 모델의 자기보고 신뢰도는 신뢰하지 않는다.
export const AI_CONFIDENCE = 0.7;

// 정형정보 재판정 우선순위 — 앞쪽이 우선
const ADJUDICATION_ORDER = [
  ['RRN', detectRRN],
  ['CARD_NO', detectCard],
  ['PHONE', detectPhone],
  ['EMAIL', detectEmail],
  ['BUSINESS_NO', detectBusinessNo],
  ['PASSPORT_NO', detectPassport],
  ['ACCOUNT_NO', detectAccount],
  ['VEHICLE_NO', detectVehicle],
  ['IP_ADDRESS', detectIP],
  ['BIRTH_DATE', detectBirthDate],
];

let aiSeq = 0;
export function resetAiIdCounter() {
  aiSeq = 0;
}
function nextAiId() {
  aiSeq += 1;
  return `pii-ai-${String(aiSeq).padStart(5, '0')}`;
}

// 값 하나에 정형 규칙을 다시 돌려 유형을 재판정한다.
// 값 전체를 덮는 규칙 결과가 있을 때만 채택하고, 없으면 AI 판단을 쓴다.
// (성명·주소 등 비정형은 어떤 정형 규칙도 걸리지 않으므로 AI 유형이 유지된다)
export function adjudicateType(value, aiType) {
  for (const [, detect] of ADJUDICATION_ORDER) {
    let found;
    try {
      found = detect(value);
    } catch {
      continue;
    }
    const full = found.find((c) => c.start === 0 && c.end === value.length);
    if (full) return full.type;
  }
  return aiType;
}

const spansOverlap = (a, b) => a.start < b.end && b.start < a.end;
const sameSpan = (a, b) => a.start === b.start && a.end === b.end;
const strictlyContains = (outer, inner) =>
  outer.start <= inner.start && inner.end <= outer.end && !sameSpan(outer, inner);

// 검증을 통과한 정형정보 후보인가 (AI보다 신뢰도가 높다)
const isTrustedRule = (c) => STRUCTURED_TYPES.has(c.type) && c.confidence >= 0.7;

/**
 * AI 결과를 기존 후보 배열에 병합한다. candidates를 직접 수정한다.
 *
 * @param {Array}  candidates  세션의 후보 배열 (수정됨)
 * @param {Array}  aiCandidates verify.verifyItems가 반환한 원시 후보
 * @param {Array}  disputed     verify.verifyDisputed가 반환한 목록
 * @param {Object} ctx          { text, chunkStart, chunkEnd }
 * @returns {{ added: Array, confirmedCount: number, disputedCount: number }}
 */
export function mergeAiResults(candidates, aiCandidates, disputed, ctx) {
  const { text, chunkStart = 0, chunkEnd = Number.MAX_SAFE_INTEGER } = ctx;
  const added = [];
  let confirmedCount = 0;

  for (const ai of aiCandidates) {
    // 1) 규칙 후보와 범위가 정확히 같다 → 확인 표시만. 유형은 규칙 것을 유지한다.
    const exact = candidates.find((c) => sameSpan(c, ai));
    if (exact) {
      if (!exact.aiConfirmed) confirmedCount += 1;
      exact.aiConfirmed = true;
      if (!exact.aiReason) exact.aiReason = ai.aiReason;
      continue;
    }

    // 2) 부분 겹침
    const overlapping = candidates.filter((c) => spansOverlap(c, ai));
    if (overlapping.length > 0) {
      // 검증 통과 정형정보는 AI보다 신뢰도가 높다. 규칙을 그대로 둔다.
      if (overlapping.some(isTrustedRule)) continue;

      // AI 범위가 규칙 범위를 완전히 포함하고 대상이 하나뿐이며
      // 사용자가 손대지 않았다면 더 넓은 범위로 확장한다.
      // (예: 규칙이 "길동"만 잡은 것을 AI가 "홍길동"으로 잡은 경우)
      const [only] = overlapping;
      if (overlapping.length === 1 && strictlyContains(ai, only) && !only.userModified) {
        only.start = ai.start;
        only.end = ai.end;
        only.originalText = text.slice(ai.start, ai.end);
        only.context = getContext(text, ai.start, ai.end);
        only.aiConfirmed = true;
        only.aiExpanded = true;
        if (!only.aiReason) only.aiReason = ai.aiReason;
        confirmedCount += 1;
      }
      // 그 외 겹침은 건드리지 않는다 (사용자 검토 상태 보존)
      continue;
    }

    // 3) 겹치지 않는다 → 규칙이 놓친 항목. 새 후보로 추가한다.
    const type = adjudicateType(ai.originalText, ai.type);
    const candidate = {
      id: nextAiId(),
      documentPart: 'body',
      start: ai.start,
      end: ai.end,
      originalText: ai.originalText,
      type,
      confidence: AI_CONFIDENCE,
      detectionMethod: 'AI',
      context: getContext(text, ai.start, ai.end),
      selected: true,
      action: null,
      replacementText: null,
      aiReason: ai.aiReason,
      aiOnly: true,
      // 재판정으로 유형이 바뀐 경우 감사·UI 표시용으로 남긴다
      aiReportedType: type === ai.type ? null : ai.type,
    };
    candidates.push(candidate);
    added.push(candidate);
  }

  // 4) 오탐 의심 표시 — selected는 절대 건드리지 않는다.
  //    모델이 disputed 지시를 오해하는 사례가 실측에서 확인되어 표시만 한다.
  let disputedCount = 0;
  for (const d of disputed) {
    for (const c of candidates) {
      if (c.aiOnly) continue; // AI가 스스로 추가한 것을 스스로 반박하지 않는다
      if (c.originalText !== d.value) continue;
      if (c.start < chunkStart || c.end > chunkEnd) continue;
      if (!c.aiDisputed) disputedCount += 1;
      c.aiDisputed = { reason: d.reason };
    }
  }

  return { added, confirmedCount, disputedCount };
}
