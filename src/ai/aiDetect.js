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

// 오탐 검증 대상 고르기.
// 체크섬으로 검증된 정형정보는 LLM보다 신뢰도가 높으므로 묻지 않는다.
// 사용자가 직접 추가·수정한 것도 묻지 않는다 — 사람의 판단이 우선이다.
export function isDisputeEligible(c) {
  if (c.aiOnly || c.userModified) return false;
  if (['MANUAL', 'SEARCH', 'USER_RULE'].includes(c.detectionMethod)) return false;
  if (STRUCTURED_TYPES.has(c.type) && c.confidence >= 0.7) return false;
  return true;
}

export function estimateChunks(text) {
  return chunkText(text).length;
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

  const stats = {
    enabled: true,
    model,
    promptVersion: PROMPT_VERSION,
    temperature: 0,
    chunkCount: allChunks.length,
    chunksPlanned: chunks.length,
    chunksCompleted: 0,
    addedCount: 0,
    confirmedCount: 0,
    disputedCount: 0,
    rejectedHallucinations: 0,
    failedChunks: 0,
    failedVerifications: 0,
    truncated: allChunks.length > chunks.length,
    elapsedMs: 0,
    completed: false,
    stopReason: null, // 'aborted' | 'offline' | null
  };

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
    let items;
    try {
      ({ items } = await detectChunk(chunk.text, opts));
    } catch (e) {
      if (e instanceof AiError && (e.kind === 'aborted' || e.kind === 'offline')) {
        stats.stopReason = e.kind;
        break;
      }
      // 응답 형식 오류·타임아웃 등은 해당 청크만 건너뛴다
      stats.failedChunks += 1;
      if (onChunkMerged) onChunkMerged({ index: i, total: chunks.length, added: [], stats });
      continue;
    }

    // ── 2단계: 오탐 검증 ──
    // 판단이 애매한 후보만 좁혀서 따로 묻는다. 한 번에 물으면 1단계가 망가진다.
    const askedValues = [...new Set(candidates
      .filter((c) => c.start >= chunk.base && c.end <= chunkEnd && isDisputeEligible(c))
      .map((c) => c.originalText))].slice(0, MAX_VERIFY_VALUES);

    let disputed = [];
    if (askedValues.length > 0) {
      try {
        const { judgements } = await verifyChunk(chunk.text, askedValues, opts);
        disputed = collectDisputed(judgements, askedValues, chunk);
      } catch (e) {
        if (e instanceof AiError && (e.kind === 'aborted' || e.kind === 'offline')) {
          stats.stopReason = e.kind;
          break;
        }
        // 검증 실패는 탐지 결과를 버릴 이유가 아니다. 오탐 표시만 생략한다.
        stats.failedVerifications += 1;
      }
    }

    const { candidates: verified, rejected } = verifyItems(items, chunk);
    stats.rejectedHallucinations += rejected;

    const merged = mergeAiResults(candidates, verified, disputed, {
      text: parsed.text,
      chunkStart: chunk.base,
      chunkEnd,
    });

    stats.addedCount += merged.added.length;
    stats.confirmedCount += merged.confirmedCount;
    stats.disputedCount += merged.disputedCount;
    stats.chunksCompleted += 1;

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
