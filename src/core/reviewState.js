export const REVIEW_STATES = Object.freeze({
  PENDING: 'PENDING',
  PROCESS: 'PROCESS',
  EXCLUDE: 'EXCLUDE',
});

export const REVIEW_STATE_LABELS = Object.freeze({
  [REVIEW_STATES.PENDING]: '미확인',
  [REVIEW_STATES.PROCESS]: '처리',
  [REVIEW_STATES.EXCLUDE]: '제외',
});

export function setReviewState(candidate, reviewState, { userModified = true } = {}) {
  if (!Object.values(REVIEW_STATES).includes(reviewState)) {
    throw new TypeError(`지원하지 않는 검토 상태입니다: ${reviewState}`);
  }
  candidate.reviewState = reviewState;
  // 기존 비식별 처리·요약 로직과의 호환 값. 미확인은 실행 전에 차단된다.
  candidate.selected = reviewState === REVIEW_STATES.PROCESS;
  if (userModified) candidate.userModified = true;
  return candidate;
}

export function ensureReviewState(candidate, defaultState = REVIEW_STATES.PENDING) {
  if (candidate.reviewState) return candidate;
  return setReviewState(candidate, defaultState, { userModified: false });
}

export function ensureReviewStates(candidates, defaultState = REVIEW_STATES.PENDING) {
  for (const candidate of candidates) ensureReviewState(candidate, defaultState);
  return candidates;
}

export function reviewCounts(candidates) {
  const counts = { total: candidates.length, pending: 0, process: 0, exclude: 0 };
  for (const candidate of candidates) {
    const state = candidate.reviewState || (candidate.selected ? REVIEW_STATES.PROCESS : REVIEW_STATES.EXCLUDE);
    if (state === REVIEW_STATES.PENDING) counts.pending += 1;
    else if (state === REVIEW_STATES.PROCESS) counts.process += 1;
    else counts.exclude += 1;
  }
  return counts;
}

export function hasPendingReview(candidates) {
  return reviewCounts(candidates).pending > 0;
}
