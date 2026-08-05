// 처리결과 요약 (FR-606, FR-607, 기술명세서 Ⅸ-2·3)
// 요약에는 개인정보 원문을 포함하지 않는다.

import { PROGRAM_VERSION } from '../version.js';
import { RULE_VERSION } from '../detect/engine.js';
import { PII_TYPES, ACTION_LABELS } from '../detect/types.js';

// AI 탐지 감사 블록 (계획 C-9)
// completed가 false이면 검사하지 않은 구간이 남아 있다는 뜻이므로
// 결과 화면에서 반드시 경고해야 한다. 완료로 오인하면 유출로 이어진다.
export function buildAiAudit(aiStats) {
  if (!aiStats) return { enabled: false };
  return {
    enabled: true,
    model: aiStats.model,
    promptVersion: aiStats.promptVersion,
    temperature: aiStats.temperature,
    chunkCount: aiStats.chunkCount,
    chunksPlanned: aiStats.chunksPlanned,
    chunksCompleted: aiStats.chunksCompleted,
    addedCount: aiStats.addedCount,
    confirmedCount: aiStats.confirmedCount,
    disputedCount: aiStats.disputedCount,
    rejectedHallucinations: aiStats.rejectedHallucinations,
    skippedCommonValues: aiStats.skippedCommonValues || 0,
    failedChunks: aiStats.failedChunks,
    failedVerifications: aiStats.failedVerifications,
    truncated: aiStats.truncated,
    elapsedMs: aiStats.elapsedMs,
    stopReason: aiStats.stopReason,
    completed: aiStats.completed,
  };
}

export function buildSummary({ session, applied, startedAt, finishedAt, resultName, aiStats = null }) {
  const typeCounts = {};
  const actionCounts = {};
  for (const c of applied) {
    typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
    const action = c.action || session.typePolicies[c.type] || 'REPLACE';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }

  // 탐지되었으나 사용자가 처리 대상에서 뺀 건수.
  // (이전에는 excludedCount를 그대로 빼서 항상 0이었다)
  const unselected = session.candidates.filter((c) => !c.selected).length;
  // 선택했지만 실제로 적용되지 않은 건수 — 중첩 등으로 건너뛴 경우 (FR-508)
  const selectedButSkipped = session.candidates.filter((c) => c.selected).length - applied.length;

  return {
    sourceFileName: session.file?.name || '',
    resultFileName: resultName,
    processedAt: finishedAt.toISOString(),
    processingStartedAt: startedAt.toISOString(),
    programVersion: PROGRAM_VERSION,
    ruleVersion: RULE_VERSION,
    detectedCount: session.candidates.length,
    processedCount: applied.length,
    excludedCount: unselected,
    manuallyAddedCount: session.manuallyAddedCount,
    aiAddedCount: session.candidates.filter((c) => c.aiOnly).length,
    aiDisputedCount: session.candidates.filter((c) => c.aiDisputed).length,
    unprocessedCount: Math.max(0, selectedButSkipped),
    typeCounts,
    actionCounts,
    ai: buildAiAudit(aiStats),
  };
}

export function summaryToBlob(summary) {
  return new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
}

export function typeLabel(code) {
  return PII_TYPES[code]?.label || code;
}

export function actionLabel(code) {
  return ACTION_LABELS[code] || code;
}
