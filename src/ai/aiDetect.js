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

// 응답이 잘리거나 입력이 창을 넘을 때 구간을 반으로 나눠 다시 묻는 한계.
// 창·출력 예산(ollamaClient.js NUM_CTX)을 문서 밀도에 맞춰 키웠으므로 나누기는 드문 대비책이다.
// 조각이 작을수록 출력 공간이 넉넉해지므로 400자까지 나눈다 (3,000자 → 최대 4단계).
const MAX_SPLIT_DEPTH = 4;
const MIN_SPLIT_CHARS = 400;
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
    uncoveredRanges: [],   // AI가 검사하지 못한 문서 범위 [{ start, end, reason }] — 사용자가 직접 점검해야 한다
    uncoveredChars: 0,
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
    // truncatedChunks는 나눈 조각 수라서 사용자에게 보이는 구간 수는 failedChunks로 센다
    reasons.push(stats.truncatedChunks > 0
      ? `${failed}개 구간은 후보가 너무 많아 AI 응답이 끝까지 오지 않았습니다`
      : `${failed}개 구간은 AI가 응답하지 못했습니다`);
  }
  if (stats.truncated) reasons.push(`문서가 길어 앞쪽 ${stats.chunksPlanned}개 구간만 검사했습니다`);
  return reasons.join(' · ') || '일부 구간을 검사하지 못했습니다';
}

// AI가 검사하지 못한 구간의 사유 (화면 표시용)
export const UNCOVERED_REASON_LABELS = {
  truncated: '후보가 너무 많아 AI 응답이 끝까지 오지 않음',
  failed: 'AI 응답 오류 또는 시간 초과',
  aborted: 'AI 탐지를 중단해 검사하지 않음',
  offline: 'AI 엔진 연결이 끊겨 검사하지 않음',
  notScanned: '문서가 길어 AI가 검사하지 않음',
};

// 겹치거나 맞닿은 범위를 하나로 합친다. 사유는 앞쪽 범위의 것을 쓴다.
function mergeRanges(ranges) {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

// 실패한 범위에서 다른 조각이 실제로 읽은 범위를 뺀다.
// 조각은 서로 겹치므로, 실패한 조각의 앞뒤 일부는 이웃 조각이 이미 검사했을 수 있다.
// 결과는 "AI가 아무도 읽지 못한" 범위다. { start, end, reason } (문서 전체 기준 오프셋)
export function subtractRanges(missed, covered) {
  const cov = mergeRanges(covered);
  const out = [];
  for (const m of missed) {
    let parts = [{ start: m.start, end: m.end }];
    for (const c of cov) {
      if (c.end <= m.start || c.start >= m.end) continue;
      parts = parts.flatMap((p) => {
        if (c.end <= p.start || c.start >= p.end) return [p];
        const kept = [];
        if (c.start > p.start) kept.push({ start: p.start, end: c.start });
        if (c.end < p.end) kept.push({ start: c.end, end: p.end });
        return kept;
      });
    }
    for (const p of parts) if (p.end > p.start) out.push({ ...p, reason: m.reason });
  }
  return mergeRanges(out);
}

// 텍스트 조각 { text, base }를 반으로 나눈다 (줄바꿈 경계 우선, 조각 사이 겹침). 나눌 수 없으면 빈 배열.
// base는 문서 전체 기준 시작 오프셋이다. 미검사 구간을 문서 위에 표시하는 데 쓴다.
function halvesOf(piece, depth) {
  return depth < MAX_SPLIT_DEPTH && piece.text.length >= MIN_SPLIT_CHARS
    ? chunkText(piece.text, { size: Math.ceil(piece.text.length / 2) + SPLIT_OVERLAP, overlap: SPLIT_OVERLAP })
      .map((p) => ({ text: p.text, base: piece.base + p.base }))
    : [];
}

// 같은 문서의 앞 구간에서 나눠야 했던 깊이만큼 미리 나눈다.
// 표가 많은 문서는 구간마다 밀도가 비슷해서, 매번 통째로 물었다가 잘리면
// CPU 환경에서 구간당 2~3분을 버린다(XLSX 실측: 잘린 첫 요청 2분 40초).
export function splitToDepth(piece, depth, from = 0) {
  if (from >= depth) return [piece];
  const halves = halvesOf(piece, from);
  if (halves.length < 2) return [piece];
  return halves.flatMap((half) => splitToDepth(half, depth, from + 1));
}

// 미검사 구간을 사람이 읽을 문장으로 요약한다. 없으면 빈 문자열.
export function describeUncovered(stats) {
  const ranges = stats?.uncoveredRanges || [];
  if (ranges.length === 0) return '';
  return `AI가 검사하지 못한 구간 ${ranges.length}곳(약 ${(stats.uncoveredChars || 0).toLocaleString()}자)`;
}

// 한 조각을 탐지하되, 응답이 잘리면 반으로 나눠 다시 묻는다.
// 중단·연결 끊김은 던지고, 그 밖의 실패는 결과에 담아 돌려준다.
// cov: 끝까지 읽은 범위(covered)와 읽지 못한 범위(missed)를 기록한다.
// 반환: { items, incomplete(일부 조각을 끝까지 못 읽음), succeeded(성공한 요청 수), depth(끝까지 읽은 조각의 최대 깊이) }
async function detectResilient(piece, opts, stats, cov, depth = 0) {
  const range = { start: piece.base, end: piece.base + piece.text.length };
  let result;
  try {
    result = await detectChunk(piece.text, opts);
  } catch (e) {
    if (e instanceof AiError && (e.kind === 'aborted' || e.kind === 'offline')) throw e;
    // 입력이 창보다 길어 거부되면 잘린 응답과 같이 나눠서 다시 묻는다
    if (e instanceof AiError && e.kind === 'overflow') {
      result = { items: [], truncated: true };
    } else {
      // 응답 형식 오류·타임아웃 등은 해당 조각만 포기한다
      cov.missed.push({ ...range, reason: 'failed' });
      return { items: [], incomplete: true, succeeded: 0, depth };
    }
  }
  if (!result.truncated) {
    cov.covered.push(range);
    return { items: result.items, incomplete: false, succeeded: 1, depth };
  }

  const pieces = halvesOf(piece, depth);
  if (pieces.length < 2) {
    // 더 쪼갤 수 없다. 잘리기 전까지 받은 항목만 쓰고, 이 조각 전체를 미검사로 남긴다.
    // (응답이 어디서 끊겼는지 문서 위치로 확정할 수 없으므로 보수적으로 조각 전체를 표시한다)
    stats.truncatedChunks += 1;
    cov.missed.push({ ...range, reason: 'truncated' });
    return { items: result.items, incomplete: true, succeeded: result.items.length > 0 ? 1 : 0, depth };
  }

  stats.splitChunks += 1;
  return detectPieces(pieces, opts, stats, cov, depth + 1);
}

// 여러 조각을 차례로 탐지해 결과를 합친다.
async function detectPieces(pieces, opts, stats, cov, depth) {
  const merged = { items: [], incomplete: false, succeeded: 0, depth };
  for (const piece of pieces) {
    if (opts.signal?.aborted) throw new AiError('aborted', '사용자가 작업을 취소했습니다.');
    const part = await detectResilient(piece, opts, stats, cov, depth);
    merged.items.push(...part.items);
    merged.incomplete ||= part.incomplete;
    merged.succeeded += part.succeeded;
    merged.depth = Math.max(merged.depth, part.depth);
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
  // 앞 구간에서 끝까지 읽기 위해 나눠야 했던 깊이. 다음 구간은 처음부터 그만큼 나눠 묻는다.
  let learnedDepth = 0;
  // 문서 전체 기준으로 AI가 끝까지 읽은 범위와 읽지 못한 범위
  const runCovered = [];
  const runMissed = [];
  const textLength = parsed.text.length;
  // 중단·연결 끊김: 이 구간부터 문서 끝까지는 AI가 검사하지 않았다
  const stopFrom = (start, reason) => {
    stats.stopReason = reason;
    runMissed.push({ start, end: textLength, reason });
  };

  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) {
      stopFrom(chunks[i].base, 'aborted');
      break;
    }

    const chunk = chunks[i];
    const chunkEnd = chunk.base + chunk.text.length;
    const opts = { endpoint, model, signal };
    // 이 구간의 검사 범위는 결과를 병합한 뒤에만 확정한다 (병합 전 중단되면 읽은 것이 아니다)
    const chunkCov = { covered: [], missed: [] };

    // ── 1단계: 탐지 ──
    // 규칙 결과를 함께 주면 모델이 그 목록에 앵커링되어 새 항목을 찾지 못한다(실측).
    // 그래서 백지 상태로 묻는다.
    let detection;
    try {
      const pieces = splitToDepth({ text: chunk.text, base: chunk.base }, learnedDepth);
      const startDepth = pieces.length > 1 ? learnedDepth : 0;
      detection = await detectPieces(pieces, opts, stats, chunkCov, startDepth);
      if (detection.succeeded > 0) learnedDepth = Math.max(learnedDepth, detection.depth);
    } catch (e) {
      if (e instanceof AiError && (e.kind === 'aborted' || e.kind === 'offline')) {
        stopFrom(chunk.base, e.kind);
        break;
      }
      throw e;
    }
    if (detection.succeeded === 0) {
      // 응답 형식 오류·타임아웃 등으로 이 구간을 전혀 읽지 못했다. 이 구간만 건너뛴다.
      stats.failedChunks += 1;
      runMissed.push(...chunkCov.missed);
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
          // 탐지 결과를 병합하기 전에 멈췄으므로 이 구간도 검사하지 않은 것으로 본다
          stopFrom(chunk.base, e.kind);
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
    runCovered.push(...chunkCov.covered);
    runMissed.push(...chunkCov.missed);

    if (onChunkMerged) {
      onChunkMerged({ index: i, total: chunks.length, added: merged.added, stats });
    }
  }

  // 문서가 길어 앞쪽 구간만 검사했다면 나머지는 검사하지 않았다
  if (stats.truncated && chunks.length > 0) {
    const last = chunks[chunks.length - 1];
    runMissed.push({ start: last.base + last.text.length, end: textLength, reason: 'notScanned' });
  }
  stats.uncoveredRanges = subtractRanges(runMissed, runCovered);
  stats.uncoveredChars = stats.uncoveredRanges.reduce((sum, r) => sum + (r.end - r.start), 0);

  stats.elapsedMs = Date.now() - startedAt;
  // 모든 청크를 끝냈고 중단 사유가 없을 때만 완료로 기록한다.
  // 이 값이 false이면 결과 화면에서 "AI 검사 미완료"를 경고한다.
  stats.completed = stats.stopReason === null && stats.chunksCompleted === chunks.length && !stats.truncated;

  return stats;
}
