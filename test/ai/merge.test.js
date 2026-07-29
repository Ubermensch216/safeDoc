import { describe, it, expect, beforeEach } from 'vitest';
import { mergeAiResults, adjudicateType, resetAiIdCounter, AI_CONFIDENCE } from '../../src/ai/merge.js';
import { isDisputeEligible } from '../../src/ai/aiDetect.js';

const TEXT = '성명: 홍길동 주민등록번호: 900101-1234567 담당 김서연';

const rule = (start, end, type, extra = {}) => ({
  id: `r${start}`,
  start,
  end,
  originalText: TEXT.slice(start, end),
  type,
  confidence: 0.9,
  detectionMethod: 'REGEX',
  selected: true,
  action: null,
  ...extra,
});

beforeEach(() => resetAiIdCounter());

// 실측(C-0)에서 모델이 주민등록번호를 PERSON_NAME으로 분류했다.
// 그대로 두면 처리방식이 MASK_ALL에서 REPLACE로 약화되어 비식별이 무력화된다.
describe('유형 재판정 — AI의 유형 판단을 신뢰하지 않는다', () => {
  it.each([
    ['900101-1234567', 'RRN'],
    ['010-9876-5432', 'PHONE_MOBILE'],
    ['hong@example.com', 'EMAIL'],
    ['1234-5678-9012-3456', 'CARD_NO'],
  ])('%s 를 PERSON_NAME이라 해도 %s 로 교정한다', (value, expected) => {
    expect(adjudicateType(value, 'PERSON_NAME')).toBe(expected);
  });

  it('정형 규칙이 걸리지 않는 값은 AI 판단을 유지한다', () => {
    expect(adjudicateType('홍길동', 'PERSON_NAME')).toBe('PERSON_NAME');
    expect(adjudicateType('서울특별시 종로구 세종대로 209', 'ADDRESS')).toBe('ADDRESS');
  });

  it('값의 일부만 걸리는 경우에는 AI 판단을 유지한다', () => {
    expect(adjudicateType('연락처 010-1234-5678 입니다', 'PERSON_NAME')).toBe('PERSON_NAME');
  });
});

describe('병합 규칙', () => {
  it('범위가 같으면 후보를 추가하지 않고 확인 표시만 남긴다', () => {
    const s = TEXT.indexOf('900101-1234567');
    const cands = [rule(s, s + 14, 'RRN')];
    const r = mergeAiResults(cands, [
      { start: s, end: s + 14, originalText: '900101-1234567', type: 'PERSON_NAME', aiReason: '주민번호 형식' },
    ], [], { text: TEXT });

    expect(cands).toHaveLength(1);
    expect(cands[0].aiConfirmed).toBe(true);
    expect(cands[0].type).toBe('RRN'); // AI가 PERSON_NAME이라 해도 규칙 유형을 지킨다
    expect(r.confirmedCount).toBe(1);
  });

  it('규칙이 놓친 항목은 새 후보로 추가한다', () => {
    const cands = [];
    const s = TEXT.indexOf('김서연');
    const r = mergeAiResults(cands, [
      { start: s, end: s + 3, originalText: '김서연', type: 'PERSON_NAME', aiReason: '담당 뒤' },
    ], [], { text: TEXT });

    expect(r.added).toHaveLength(1);
    expect(cands[0]).toMatchObject({
      detectionMethod: 'AI', aiOnly: true, selected: true, type: 'PERSON_NAME',
    });
    expect(cands[0].confidence).toBeLessThanOrEqual(AI_CONFIDENCE);
    expect(cands[0].id).toMatch(/^pii-ai-/); // 규칙·수동 추가 id와 충돌하지 않는다
  });

  it('검증을 통과한 정형정보와 겹치면 AI 후보를 버린다', () => {
    const s = TEXT.indexOf('900101-1234567');
    const cands = [rule(s, s + 14, 'RRN')];
    mergeAiResults(cands, [
      { start: s, end: s + 6, originalText: '900101', type: 'BIRTH_DATE', aiReason: 'x' },
    ], [], { text: TEXT });

    expect(cands).toHaveLength(1);
    expect(cands[0].type).toBe('RRN');
  });

  it('규칙이 일부만 잡은 이름을 AI 범위로 확장한다', () => {
    const s = TEXT.indexOf('홍길동');
    const cands = [rule(s + 1, s + 3, 'PERSON_NAME', { confidence: 0.45, detectionMethod: 'DICTIONARY' })];
    mergeAiResults(cands, [
      { start: s, end: s + 3, originalText: '홍길동', type: 'PERSON_NAME', aiReason: '성명 필드' },
    ], [], { text: TEXT });

    expect(cands[0].originalText).toBe('홍길동');
    expect(cands[0].start).toBe(s);
    expect(cands[0].aiExpanded).toBe(true);
  });

  it('사용자가 수정한 후보의 범위는 바꾸지 않는다', () => {
    const s = TEXT.indexOf('홍길동');
    const cands = [rule(s + 1, s + 3, 'PERSON_NAME', {
      confidence: 0.45, detectionMethod: 'DICTIONARY', userModified: true,
    })];
    mergeAiResults(cands, [
      { start: s, end: s + 3, originalText: '홍길동', type: 'PERSON_NAME', aiReason: 'x' },
    ], [], { text: TEXT });

    expect(cands[0].originalText).toBe('길동');
  });
});

describe('오탐 표시 — 표시만 하고 해제하지 않는다', () => {
  it('aiDisputed를 붙이되 selected는 건드리지 않는다', () => {
    const s = TEXT.indexOf('홍길동');
    const cands = [rule(s, s + 3, 'PERSON_NAME')];
    const r = mergeAiResults(cands, [], [
      { value: '홍길동', reason: '일반명사로 보임' },
    ], { text: TEXT, chunkStart: 0, chunkEnd: TEXT.length });

    expect(cands[0].aiDisputed.reason).toBe('일반명사로 보임');
    expect(cands[0].selected).toBe(true);
    expect(r.disputedCount).toBe(1);
  });

  it('AI가 스스로 추가한 후보는 스스로 반박하지 않는다', () => {
    const s = TEXT.indexOf('김서연');
    const cands = [];
    mergeAiResults(cands, [
      { start: s, end: s + 3, originalText: '김서연', type: 'PERSON_NAME', aiReason: 'x' },
    ], [], { text: TEXT });
    mergeAiResults(cands, [], [{ value: '김서연', reason: 'y' }], {
      text: TEXT, chunkStart: 0, chunkEnd: TEXT.length,
    });

    expect(cands[0].aiDisputed).toBeUndefined();
  });

  it('청크 범위 밖의 후보에는 판정을 적용하지 않는다', () => {
    const s = TEXT.indexOf('홍길동');
    const cands = [rule(s, s + 3, 'PERSON_NAME')];
    mergeAiResults(cands, [], [{ value: '홍길동', reason: 'x' }], {
      text: TEXT, chunkStart: 1000, chunkEnd: 2000,
    });

    expect(cands[0].aiDisputed).toBeUndefined();
  });
});

describe('오탐 검증 대상 선별', () => {
  const c = (o) => ({ type: 'PERSON_NAME', confidence: 0.5, detectionMethod: 'DICTIONARY', ...o });

  it('사전·문맥 기반 비정형 후보는 검증한다', () => {
    expect(isDisputeEligible(c({}))).toBe(true);
  });

  it('체크섬으로 검증된 정형정보는 묻지 않는다 (LLM보다 신뢰도가 높다)', () => {
    expect(isDisputeEligible(c({ type: 'RRN', confidence: 0.95 }))).toBe(false);
  });

  it.each(['MANUAL', 'SEARCH', 'USER_RULE'])('사용자가 지정한 %s 후보는 묻지 않는다', (method) => {
    expect(isDisputeEligible(c({ detectionMethod: method }))).toBe(false);
  });

  it('사용자가 수정했거나 AI가 찾은 후보는 묻지 않는다', () => {
    expect(isDisputeEligible(c({ userModified: true }))).toBe(false);
    expect(isDisputeEligible(c({ aiOnly: true }))).toBe(false);
  });
});
