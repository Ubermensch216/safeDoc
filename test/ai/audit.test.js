// 감사 기록 — AI 검사가 미완료인데 완료로 오인하면 개인정보 유출로 이어진다.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runAiDetection } from '../../src/ai/aiDetect.js';
import { buildSummary, buildAiAudit } from '../../src/core/summary.js';
import { buildMappingTable, parseMappingTable, MAPPING_FILE_VERSION } from '../../src/core/mappingTable.js';

afterEach(() => vi.unstubAllGlobals());

const DOC = '성명: 홍길동\n주민등록번호: 900101-1234567';

function stubOllama(handler) {
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url).includes('/api/')) {
      const r = await handler(String(url), init);
      if (r) return r;
    }
    return { ok: true, json: async () => ({ message: { content: '{"items":[]}' } }) };
  }));
}

describe('AI 패스 통계', () => {
  it('정상 완료 시 completed=true', async () => {
    stubOllama(async () => null);
    const stats = await runAiDetection({ text: DOC }, [], {});
    expect(stats.completed).toBe(true);
    expect(stats.stopReason).toBeNull();
    expect(stats.chunksCompleted).toBe(stats.chunksPlanned);
  });

  it('취소하면 completed=false와 사유를 남긴다', async () => {
    const controller = new AbortController();
    controller.abort();
    stubOllama(async () => null);
    const stats = await runAiDetection({ text: DOC }, [], { signal: controller.signal });
    expect(stats.completed).toBe(false);
    expect(stats.stopReason).toBe('aborted');
  });

  it('엔진이 중간에 끊기면 completed=false로 남긴다', async () => {
    stubOllama(async (url) => {
      if (url.includes('/api/chat')) throw new TypeError('Failed to fetch');
      return null;
    });
    const stats = await runAiDetection({ text: DOC }, [], {});
    expect(stats.completed).toBe(false);
    expect(stats.stopReason).toBe('offline');
  });

  it('응답 형식 오류는 해당 청크만 건너뛰고 계속한다', async () => {
    stubOllama(async (url) => (
      url.includes('/api/chat')
        ? { ok: true, json: async () => ({ message: { content: '{깨진' } }) }
        : null
    ));
    const stats = await runAiDetection({ text: DOC }, [], {});
    expect(stats.failedChunks).toBeGreaterThan(0);
    expect(stats.completed).toBe(false);
  });

  it('문서가 너무 길면 앞쪽만 검사하고 truncated로 표시한다', async () => {
    stubOllama(async () => null);
    const long = 'ㄱ'.repeat(3000 * 5);
    const stats = await runAiDetection({ text: long }, [], { maxChunks: 2 });
    expect(stats.truncated).toBe(true);
    expect(stats.completed).toBe(false);
  });
});

describe('감사 블록', () => {
  const session = {
    file: { name: 'a.txt' },
    typePolicies: {},
    excludedCount: 0,
    manuallyAddedCount: 1,
    candidates: [
      { type: 'RRN', selected: true },
      { type: 'PERSON_NAME', selected: false, aiOnly: true },
      { type: 'PERSON_NAME', selected: true, aiOnly: true, aiDisputed: { reason: 'x' } },
    ],
  };
  const applied = [{ type: 'RRN', action: 'MASK_ALL', originalText: 'a', replacementText: '[주민번호_001]' }];
  const times = { startedAt: new Date(), finishedAt: new Date(), resultName: 'a_비식별.txt' };

  const aiStats = {
    model: 'gemma4:e2b', promptVersion: '2.0.0', temperature: 0,
    chunkCount: 5, chunksPlanned: 5, chunksCompleted: 3,
    addedCount: 2, confirmedCount: 1, disputedCount: 1,
    rejectedHallucinations: 1, failedChunks: 0, failedVerifications: 0,
    truncated: false, elapsedMs: 1000, stopReason: 'aborted', completed: false,
  };

  it('AI를 쓰지 않으면 enabled=false만 기록한다', () => {
    expect(buildAiAudit(null)).toEqual({ enabled: false });
  });

  it('요약에 모델·프롬프트 버전·온도를 기록한다', () => {
    const s = buildSummary({ session, applied, ...times, aiStats });
    expect(s.ai).toMatchObject({
      enabled: true, model: 'gemma4:e2b', promptVersion: '2.0.0', temperature: 0,
    });
  });

  it('중단된 AI 패스는 completed=false로 남는다', () => {
    const s = buildSummary({ session, applied, ...times, aiStats });
    expect(s.ai.completed).toBe(false);
    expect(s.ai.stopReason).toBe('aborted');
    expect(s.ai.chunksCompleted).toBe(3);
  });

  it('AI 발견 건수와 오탐 표시 건수를 집계한다', () => {
    const s = buildSummary({ session, applied, ...times, aiStats });
    expect(s.aiAddedCount).toBe(2);
    expect(s.aiDisputedCount).toBe(1);
  });

  it('excludedCount가 실제 미선택 건수를 반영한다', () => {
    const s = buildSummary({ session, applied, ...times, aiStats: null });
    expect(s.excludedCount).toBe(1);
  });

  it('대응표에도 같은 감사 블록과 탐지 경로를 남긴다', () => {
    const t = buildMappingTable('a.txt', 'a_비식별.txt', [
      { type: 'RRN', originalText: '900101-1234567', replacementText: '[주민번호_001]', action: 'REPLACE' },
      { type: 'PERSON_NAME', originalText: '최다은', replacementText: '[성명_001]', action: 'REPLACE', aiOnly: true },
    ], aiStats);

    expect(t.ai.completed).toBe(false);
    expect(t.version).toBe(MAPPING_FILE_VERSION);
    expect(t.mappings[1].detectedBy).toBe('AI');
    expect(t.mappings.every((m) => m.reversible)).toBe(true);
  });
});

describe('대응표 검증', () => {
  const ok = JSON.stringify({
    version: MAPPING_FILE_VERSION,
    mappings: [{ type: 'RRN', original: 'a', replacement: '[주민번호_001]', reversible: true }],
  });

  it('정상 대응표를 통과시킨다', () => {
    expect(parseMappingTable(ok).mappings).toHaveLength(1);
  });

  it.each([
    ['깨진 JSON', '{'],
    ['mappings 없음', '{"version":"1.1"}'],
    ['replacement가 문자열이 아님', '{"version":"1.1","mappings":[{"type":"RRN","original":"a","replacement":123}]}'],
    ['replacement가 빈 문자열', '{"version":"1.1","mappings":[{"type":"RRN","original":"a","replacement":""}]}'],
    ['지원하지 않는 버전', '{"version":"9.0","mappings":[{"type":"RRN","original":"a","replacement":"b"}]}'],
  ])('거부: %s', (_, json) => {
    expect(() => parseMappingTable(json)).toThrow();
  });
});
