import { describe, expect, it } from 'vitest';
import {
  REVIEW_STATES,
  ensureReviewState,
  reviewCounts,
  setReviewState,
} from '../src/core/reviewState.js';

describe('후보 검토 상태', () => {
  it('자동 후보를 미확인 상태로 초기화한다', () => {
    const candidate = { selected: true };
    ensureReviewState(candidate);
    expect(candidate.reviewState).toBe(REVIEW_STATES.PENDING);
    expect(candidate.selected).toBe(false);
    expect(candidate.userModified).toBeUndefined();
  });

  it('처리와 제외 결정을 기존 selected 값에 동기화한다', () => {
    const candidate = {};
    setReviewState(candidate, REVIEW_STATES.PROCESS);
    expect(candidate.selected).toBe(true);
    expect(candidate.userModified).toBe(true);
    setReviewState(candidate, REVIEW_STATES.EXCLUDE);
    expect(candidate.selected).toBe(false);
  });

  it('상태별 수량을 집계한다', () => {
    const candidates = [
      { reviewState: REVIEW_STATES.PENDING, selected: false },
      { reviewState: REVIEW_STATES.PROCESS, selected: true },
      { reviewState: REVIEW_STATES.EXCLUDE, selected: false },
    ];
    expect(reviewCounts(candidates)).toEqual({ total: 3, pending: 1, process: 1, exclude: 1 });
  });
});
