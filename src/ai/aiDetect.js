// AI 탐지 오케스트레이션 (계획 C-7)
//
// 규칙 결과가 이미 화면에 표시된 상태에서 백그라운드로 실행된다.
// 청크 하나가 끝날 때마다 onChunkMerged로 결과를 알려 화면에 점진 반영한다.

import { chunkText } from './chunker.js';
import { PROMPT_VERSION } from './prompt.js';
import { detectChunk, verifyChunk, AiError, DEFAULT_ENDPOINT, DEFAULT_MODEL } from './ollamaClient.js';
import { verifyItems, collectDisputed } from './verify.js';
import { mergeAiResults, resetAiIdCounter } from './merge.js';
import { STRUCTURED_TYPES } from '../detect/engine.js';

// 이 이상은 사용자 확인을 받는다 (청크당 6~9초 → 200청크면 20분 이상)
export const DEFAULT_MAX_CHUNKS = 200;

// 검증 호출에 실을 후보 수 상한 (출력 토큰이 곧 지연이다)
const MAX_VERIFY_VALUES = 30;

// 응답이 잘렸을 때 구간을 반으로 나눠 다시 묻는 한계.
// 컨텍스트 창은 입력+출력의 합계라서, 입력이 큰 구간에서 후보가 많으면 출력이 중간에 끊긴다.
// 입력 3,000자가 약 3,500토큰이면 4,096토큰 창에서 출력에 남는 것은 600토큰 남짓이다.
const MAX_SPLIT_DEPTH = 3;
const MIN_SPLIT_CHARS = 800;
const SPLIT_OVERLAP = 120;

// AI 실행 전·중단 시에도 동일한 감사 형식을 만들 수 있도록 초기 통계를 공개한다.
// UI가 가용성 확인 단계에서 중단되더라도 "AI 미사용"으로 잘못 기록하지 않는다.
export function createAiStats(text, {
  model = DEFAULT_MODEL,
  maxChunks = DEFAULT_MAX_CHUNKS,
} = {}) {
  const chunkCount = chunkText(text).length;
  return {
    enabled: true,
    model,
    promptVersion: PROMPT_VERSION,
    temperature: 0,
    chunkCount,
    chunksPlanned: Math.min(chunkCount, maxChunks),
    chunksCompleted: 0,
    addedCount: 0,
    confirmedCount: 0,
    disputedCount: 0,
    rejectedHallucinations: 0,
    skippedCommonValues: 0,
    failedChunks: 0,
    failedVerifications: 0,
    splitChunks: 0,        // 응답이 잘려 반으로 나눠 다시 물은 횟수
    truncatedChunks: 0,    // 더 나눌 수 없는데도 잘려 일부 항목을 잃었을 수 있는 구간 수
    truncated: chunkCount > maxChunks,
    elapsedMs: 0,
    completed: false,
    stopReason: null,
  };
}

// 오탐 검증 대상 고르기.
// 체크섬으로 검증된 정형정보는 LLM보다 신뢰도가 높으므로 묻지 않는다.
// 사용자가 직접 추가·수정한 것도 묻지 않는다 — 사람의 판단이 우선이다.
export function isDisputeEligible(c) {
  if (c.aiOnly || c.userModified) return false;
  if (['MANUAL', 'SEARCH', 'USER_RULE'].includes(c.detectionMethod)) return false;
  if (STRUCTURED_TYPES.has(c.type) && c.confidence >= 0.7) return false;
  // 은행명·계좌 라벨이 함께 확인된 고신뢰 계좌번호는 묻지 않는다
  if (c.type === 'ACCOUNT_NO' && c.confidence >= 0.75) return false;
  return true;
}

export function estimateChunks(text) {
  return chunkText(text).length;
}

// 미완료 사유를 사용자가 이해할 수 있는 문장으로 만든다. 완료됐으면 빈 문자열.
export function describeIncomplete(stats) {
  if (!stats || stats.completed) return '';
  if (stats.stopReason === 'aborted') return '사용자가 중단했습니다';
  if (stats.stopReason === 'offline') return 'AI 엔진과의 연결이 끊겼습니다';
  const reasons = [];
  const failed = stats.failedChunks || 0;
  if (failed > 0) {
    reasons.push(stats.truncatedChunks > 0
      ? `${stats.truncatedChunks}개 구간은 후보가 너무 많아 AI 응답이 끝까지 오지 않았습니다`
      : `${failed}개 구간은 AI가 응답하지 못했습니다`);
  }
  if (stats.truncated) reasons.push(`문서가 길어 앞쪽 ${stats.chunksPlanned}개 구간만 검사했습니다`);
  return reasons.join(' · ') || '일부 구간을 검사하지 못했습니다';
}

// 한 구간을 탐지하되, 응답이 잘리면 반으로 나눠 다시 묻는다.
// 중단·연결 끊김은 던지고, 그 밖의 실패는 결과에 담아 돌려준다.
// 반환: { items, incomplete(일부 조각을 끝까지 못 읽음), succeeded(성공한 요청 수) }
async function detectResilient(text, opts, stats, depth = 0) {
  let result;
  try {
    result = await detectChunk(text, opts);
  } catch (e) {
    if (e instanceof AiError && (e.kind === 'aborted' || e.kind === 'offline')) throw e;
    // 응답 형식 오류·타임아웃 등은 해당 조각만 포기한다
    return { items: [], incomplete: true, succeeded: 0 };
  }
  if (!result.truncated) return { items: result.items, incomplete: false, succeeded: 1 };

  const pieces = depth < MAX_SPLIT_DEPTH && text.length >= MIN_SPLIT_CHARS
    ? chunkText(text, { size: Math.ceil(text.length / 2) + SPLIT_OVERLAP, overlap: SPLIT_OVERLAP })
    : [];
  if (pieces.length < 2) {
    // 더 쪼갤 수 없다. 잘리기 전까지 받은 항목만 쓰고, 이 구간은 미완료로 남긴다.
    stats.truncatedChunks += 1;
    return { items: result.items, incomplete: true, succeeded: 1 };
  }

  stats.splitChunks += 1;
  const merged = { items: [], incomplete: false, succeeded: 0 };
  for (const piece of pieces) {
    if (opts.signal?.aborted) throw new AiError('aborted', '사용자가 작업을 취소했습니다.');
    const part = await detectResilient(piece.text, opts, stats, depth + 1);
    merged.items.push(...part.items);
    merged.incomplete ||= part.incomplete;
    merged.succeeded += part.succeeded;
  }
  return merged;
}

/**
 * @param {Object} parsed        파서 결과 ({ text, ... })
 * @param {Array}  candidates    세션의 후보 배열 (직접 수정됨)
 * @param {Object} options
 * @param {AbortSignal} options.signal
 * @param {Function}    options.onChunkMerged  ({ index, total, added, stats }) => void
 * @returns {Promise<Object>} 감사 기록용 통계
 */
export async function runAiDetection(parsed, candidates, {
  endpoint = DEFAULT_ENDPOINT,
  model = DEFAULT_MODEL,
  signal,
  onChunkMerged,
  maxChunks = DEFAULT_MAX_CHUNKS,
} = {}) {
  const startedAt = Date.now();
  resetAiIdCounter();

  const allChunks = chunkText(parsed.text);
  const chunks = allChunks.slice(0, maxChunks);
  const stats = createAiStats(parsed.text, { model, maxChunks });

  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) {
      stats.stopReason = 'aborted';
      break;
    }

    const chunk = chunks[i];
    const chunkEnd = chunk.base + chunk.text.length;
    const opts = { endpoint, model, signal };

    // ── 1단계: 탐지 ──
    // 규칙 결과를 함께 주면 모델이 그 목록에 앵커링되어 새 항목을 찾지 못한다(실측).
    // 그래서 백지 상태로 묻는다.
    let detection;
    try {
      detection = await detectResilient(chunk.text, opts, stats);
    } catch (e) {
      if (e instanceof AiError && (e.kind === 'aborted' || e.kind === 'offline')) {
        stats.stopReason = e.kind;
        break;
      }
      throw e;
    }
    if (detection.succeeded === 0) {
      // 응답 형식 오류·타임아웃 등으로 이 구간을 전혀 읽지 못했다. 이 구간만 건너뛴다.
      stats.failedChunks += 1;
      if (onChunkMerged) onChunkMerged({ index: i, total: chunks.length, added: [], stats });
      continue;
    }
    // 일부 조각만 읽은 경우에도 읽은 항목은 살리고, 이 구간은 미완료로 센다
    if (detection.incomplete) stats.failedChunks += 1;
    const { items } = detection;

    // ── 2단계: 오탐 검증 ──
    // 판단이 애매한 후보만 좁혀서 따로 묻는다. 한 번에 물으면 1단계가 망가진다.
    const askedValues = [...new Set(candidates
      .filter((c) => c.start >= chunk.base && c.end <= chunkEnd && isDisputeEligible(c))
      .map((c) => c.originalText))].slice(0, MAX_VERIFY_VALUES);

    let disputed = [];
    if (askedValues.length > 0) {
      try {
        const { judgements, truncated } = await verifyChunk(chunk.text, askedValues, opts);
        disputed = collectDisputed(judgements, askedValues, chunk);
        // 판정이 잘려 일부 후보는 오탐 여부를 묻지 못했다. 표시만 빠질 뿐 탐지에는 영향이 없다.
        if (truncated) stats.failedVerifications += 1;
      } catch (e) {
        if (e instanceof AiError && (e.kind === 'aborted' || e.kind === 'offline')) {
          stats.stopReason = e.kind;
          break;
        }
        // 검증 실패는 탐지 결과를 버릴 이유가 아니다. 오탐 표시만 생략한다.
        stats.failedVerifications += 1;
      }
    }

    const { candidates: verified, rejected, skippedCommon } = verifyItems(items, chunk);
    stats.rejectedHallucinations += rejected;
    stats.skippedCommonValues += skippedCommon;

    const merged = mergeAiResults(candidates, verified, disputed, {
      text: parsed.text,
      chunkStart: chunk.base,
      chunkEnd,
    });

    stats.addedCount += merged.added.length;
    stats.confirmedCount += merged.confirmedCount;
    stats.disputedCount += merged.disputedCount;
    if (!detection.incomplete) stats.chunksCompleted += 1;

    if (onChunkMerged) {
      onChunkMerged({ index: i, total: chunks.length, added: merged.added, stats });
    }
  }

  stats.elapsedMs = Date.now() - startedAt;
  // 모든 청크를 끝냈고 중단 사유가 없을 때만 완료로 기록한다.
  // 이 값이 false이면 결과 화면에서 "AI 검사 미완료"를 경고한다.
  stats.completed = stats.stopReason === null && stats.chunksCompleted === chunks.length && !stats.truncated;

  return stats;
}
