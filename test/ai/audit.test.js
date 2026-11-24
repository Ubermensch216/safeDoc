// 감사 기록 — AI 검사가 미완료인데 완료로 오인하면 개인정보 유출로 이어진다.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runAiDetection, describeIncomplete, describeUncovered, splitToDepth, subtractRanges,
} from '../../src/ai/aiDetect.js';
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

  // 응답이 잘린 구간을 통째로 버리면 그 구간의 탐지가 사라지고 전체가 '미완료'가 되던 결함
  describe('응답이 잘린 구간', () => {
    const TAIL = ' 이 문서는 시험용 가상 정보입니다. 아래 내용을 확인하십시오.'.repeat(2);
    const LONG = `접수 담당 김철수 확인${TAIL.repeat(8)}\n처리 담당 이영희 확인${TAIL.repeat(8)}\n`;
    const item = (value) => ({ value, type: 'PERSON_NAME', reason: '문맥상 성명' });
    const cutOf = (items) => `{"items":[${items.map((i) => JSON.stringify(i)).join(',')},{"value":"박`;
    const bodyText = (init) => JSON.parse(init.body).messages[1].content;

    it('절반으로 나눠 다시 물어 전체를 끝까지 검사한다', async () => {
      let calls = 0;
      stubOllama(async (url, init) => {
        if (!url.includes('/api/chat')) return null;
        calls += 1;
        const text = bodyText(init);
        const found = [text.includes('김철수') && item('김철수'), text.includes('이영희') && item('이영희')].filter(Boolean);
        // 문서 전체를 한 번에 물으면 컨텍스트가 모자라 두 번째 항목에서 잘린다
        if (text.length > LONG.length * 0.8) {
          return { ok: true, json: async () => ({ message: { content: cutOf(found.slice(0, 1)) }, done_reason: 'length' }) };
        }
        return { ok: true, json: async () => ({ message: { content: JSON.stringify({ items: found }) }, done_reason: 'stop' }) };
      });

      const candidates = [];
      const stats = await runAiDetection({ text: LONG }, candidates, {});
      expect(calls).toBeGreaterThan(1);
      expect(stats.splitChunks).toBe(1);
      expect(stats.truncatedChunks).toBe(0);
      expect(stats.failedChunks).toBe(0);
      expect(stats.completed).toBe(true);
      const found = candidates.map((c) => c.originalText);
      expect(found).toContain('김철수');
      expect(found).toContain('이영희');
    });

    it('한 번 나눠야 했던 문서는 다음 구간부터 처음부터 나눠 묻는다 (잘릴 요청을 반복하지 않는다)', async () => {
      // 밀도가 같은 구간 3개. 구간 전체를 한 번에 물으면 잘린다.
      const block = `${LONG}\n`;
      const doc = block.repeat(6);
      const sizes = [];
      stubOllama(async (url, init) => {
        if (!url.includes('/api/chat')) return null;
        const text = bodyText(init);
        if (!text.includes('[찾을 유형]') && JSON.parse(init.body).messages[0].content.includes('검증기')) return null;
        sizes.push(text.length);
        const found = [text.includes('김철수') && item('김철수')].filter(Boolean);
        const truncated = text.length > 2000;
        return { ok: true, json: async () => ({ message: { content: truncated ? cutOf([]) : JSON.stringify({ items: found }) }, done_reason: truncated ? 'length' : 'stop' }) };
      });
      const stats = await runAiDetection({ text: doc }, [], {});
      expect(stats.completed).toBe(true);
      // 첫 구간만 통째로 물었다가 잘리고, 이후 구간은 처음부터 작은 조각으로 묻는다
      const oversized = sizes.filter((n) => n > 2000).length;
      expect(oversized).toBe(1);
      expect(stats.splitChunks).toBe(1);
    });

    it('미리 나누는 깊이는 텍스트를 끝까지 덮고 문서 위치를 유지한다', () => {
      const text = Array.from({ length: 80 }, (_, i) => `${i}번째 줄 김철수 010-1234-${String(i).padStart(4, '0')}`).join('\n');
      const pieces = splitToDepth({ text, base: 0 }, 2);
      expect(pieces.length).toBe(4);
      // 각 줄이 적어도 한 조각에 온전히 들어 있다 (조각 경계에서 값이 잘려 사라지지 않는다)
      for (const line of text.split('\n')) expect(pieces.some((p) => p.text.includes(line))).toBe(true);
      // 조각의 base는 원문에서의 실제 위치다 (미검사 구간을 문서 위에 정확히 표시하기 위해)
      for (const p of pieces) expect(text.slice(p.base, p.base + p.text.length)).toBe(p.text);
      expect(splitToDepth({ text, base: 7 }, 0)).toEqual([{ text, base: 7 }]);
    });

    it('입력이 창을 넘어 거부된 구간도 나눠서 끝까지 검사한다', async () => {
      stubOllama(async (url, init) => {
        if (!url.includes('/api/chat')) return null;
        const text = bodyText(init);
        if (text.length > LONG.length * 0.8) {
          return { ok: false, status: 400, text: async () => '{"error":"the prompt is longer than the context length"}' };
        }
        const found = [text.includes('김철수') && item('김철수'), text.includes('이영희') && item('이영희')].filter(Boolean);
        return { ok: true, json: async () => ({ message: { content: JSON.stringify({ items: found }) }, done_reason: 'stop' }) };
      });
      const candidates = [];
      const stats = await runAiDetection({ text: LONG }, candidates, {});
      expect(stats.completed).toBe(true);
      expect(stats.splitChunks).toBe(1);
      expect(candidates.map((c) => c.originalText)).toEqual(expect.arrayContaining(['김철수', '이영희']));
    });

    it('더 나눌 수 없어도 잘리기 전 항목은 살리고 미완료로 기록한다', async () => {
      const SHORT = '접수 담당 김철수 확인 후 처리 담당 이영희 확인함';
      stubOllama(async (url) => (url.includes('/api/chat')
        ? { ok: true, json: async () => ({ message: { content: cutOf([item('김철수')]) }, done_reason: 'length' }) }
        : null));
      const candidates = [];
      const stats = await runAiDetection({ text: SHORT }, candidates, {});
      expect(candidates.map((c) => c.originalText)).toContain('김철수');
      expect(stats.truncatedChunks).toBe(1);
      expect(stats.failedChunks).toBe(1);
      expect(stats.completed).toBe(false);
      expect(stats.chunksCompleted).toBe(0);
      expect(describeIncomplete(stats)).toContain('후보가 너무 많아');
    });
  });

  // AI가 끝내 읽지 못한 부분은 사용자가 직접 점검할 수 있도록 문서 위치로 남겨야 한다
  describe('AI 미검사 구간', () => {
    const TAIL = ' 이 문서는 시험용 가상 정보입니다. 아래 내용을 확인하십시오.'.repeat(2);
    const LONG = `접수 담당 김철수 확인${TAIL.repeat(8)}\n처리 담당 이영희 확인${TAIL.repeat(8)}\n`;
    const ok = (items = []) => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ items }) }, done_reason: 'stop' }) });
    const broken = () => ({ ok: true, json: async () => ({ message: { content: '{깨진' }, done_reason: 'stop' }) });
    const cut = () => ({ ok: true, json: async () => ({ message: { content: '{"items":[{"value":"김' }, done_reason: 'length' }) });
    const docOf = (init) => JSON.parse(init.body).messages[1].content;
    const isDetect = (init) => JSON.parse(init.body).messages[0].content.includes('[찾을 유형]');

    it('끝까지 완료하면 미검사 구간이 없다', async () => {
      stubOllama(async () => null);
      const stats = await runAiDetection({ text: DOC }, [], {});
      expect(stats.uncoveredRanges).toEqual([]);
      expect(describeUncovered(stats)).toBe('');
    });

    it('응답 오류로 읽지 못한 구간을 문서 위치와 사유로 남긴다', async () => {
      stubOllama(async (url) => (url.includes('/api/chat') ? broken() : null));
      const stats = await runAiDetection({ text: DOC }, [], {});
      expect(stats.uncoveredRanges).toEqual([{ start: 0, end: DOC.length, reason: 'failed' }]);
      expect(stats.uncoveredChars).toBe(DOC.length);
      expect(describeUncovered(stats)).toContain('1곳');
    });

    it('더 나눌 수 없게 잘린 조각은 조각 전체를 미검사로 남긴다', async () => {
      const SHORT = '접수 담당 김철수 확인 후 처리 담당 이영희 확인함';
      stubOllama(async (url) => (url.includes('/api/chat') ? cut() : null));
      const stats = await runAiDetection({ text: SHORT }, [], {});
      expect(stats.uncoveredRanges).toEqual([{ start: 0, end: SHORT.length, reason: 'truncated' }]);
    });

    it('나눈 조각 중 하나만 실패하면 그 조각에서 이웃이 읽은 겹침을 뺀 부분만 남긴다', async () => {
      stubOllama(async (url, init) => {
        if (!url.includes('/api/chat') || !isDetect(init)) return null;
        const doc = docOf(init);
        if (doc.length > LONG.length * 0.8) return cut();      // 통째로는 잘림 → 반으로 나눔
        return doc.includes('이영희') && !doc.includes('김철수') ? broken() : ok();   // 뒤쪽 조각만 실패
      });
      const stats = await runAiDetection({ text: LONG }, [], {});
      expect(stats.completed).toBe(false);
      expect(stats.uncoveredRanges).toHaveLength(1);
      const [gap] = stats.uncoveredRanges;
      expect(gap.reason).toBe('failed');
      // 뒤쪽 실패 조각(이영희 포함)은 표시되고, 앞쪽 성공 조각(김철수)은 표시되지 않는다
      expect(gap.start).toBeLessThanOrEqual(LONG.indexOf('이영희'));
      expect(gap.end).toBe(LONG.length);
      expect(gap.start).toBeGreaterThan(LONG.indexOf('김철수'));
    });

    it('중단하면 중단한 구간부터 문서 끝까지 미검사로 남긴다', async () => {
      const controller = new AbortController();
      controller.abort();
      stubOllama(async () => null);
      const stats = await runAiDetection({ text: DOC }, [], { signal: controller.signal });
      expect(stats.uncoveredRanges).toEqual([{ start: 0, end: DOC.length, reason: 'aborted' }]);
    });

    it('엔진 연결이 끊기면 그 뒤를 미검사로 남긴다', async () => {
      stubOllama(async (url) => {
        if (url.includes('/api/chat')) throw new TypeError('Failed to fetch');
        return null;
      });
      const stats = await runAiDetection({ text: DOC }, [], {});
      expect(stats.uncoveredRanges).toEqual([{ start: 0, end: DOC.length, reason: 'offline' }]);
    });

    it('문서가 길어 앞쪽만 검사하면 나머지를 미검사로 남긴다', async () => {
      stubOllama(async () => null);
      const long = 'ㄱ'.repeat(3000 * 5);
      const stats = await runAiDetection({ text: long }, [], { maxChunks: 2 });
      const tail = stats.uncoveredRanges.at(-1);
      expect(tail.reason).toBe('notScanned');
      expect(tail.end).toBe(long.length);
      expect(tail.start).toBeGreaterThan(0);
    });

    it('겹친 범위 빼기와 합치기', () => {
      const missed = [{ start: 0, end: 100, reason: 'failed' }, { start: 90, end: 150, reason: 'truncated' }];
      const covered = [{ start: 20, end: 40 }, { start: 140, end: 200 }];
      expect(subtractRanges(missed, covered)).toEqual([
        { start: 0, end: 20, reason: 'failed' },
        { start: 40, end: 140, reason: 'failed' },
      ]);
      expect(subtractRanges([{ start: 0, end: 10, reason: 'x' }], [{ start: 0, end: 10 }])).toEqual([]);
    });

    it('감사 기록에는 위치와 사유만 남긴다 (원문 없음)', () => {
      const audit = buildAiAudit({ uncoveredRanges: [{ start: 3, end: 9, reason: 'failed', text: '홍길동' }], uncoveredChars: 6 });
      expect(audit.uncoveredRanges).toEqual([{ start: 3, end: 9, reason: 'failed' }]);
      expect(JSON.stringify(audit)).not.toContain('홍길동');
    });
  });

  it('미완료 사유를 사람이 읽을 문장으로 설명한다', () => {
    expect(describeIncomplete({ completed: true })).toBe('');
    expect(describeIncomplete(null)).toBe('');
    expect(describeIncomplete({ completed: false, stopReason: 'aborted' })).toContain('중단');
    expect(describeIncomplete({ completed: false, stopReason: 'offline' })).toContain('연결이 끊겼');
    expect(describeIncomplete({ completed: false, stopReason: null, failedChunks: 2, truncatedChunks: 0 }))
      .toContain('2개 구간은 AI가 응답하지 못했습니다');
    // 조각 8개가 잘렸어도 사용자에게는 실패한 구간 수(1)로 알린다
    expect(describeIncomplete({ completed: false, stopReason: null, failedChunks: 1, truncatedChunks: 8 }))
      .toContain('1개 구간은 후보가 너무 많아');
    expect(describeIncomplete({ completed: false, stopReason: null, truncated: true, chunksPlanned: 200 }))
      .toContain('앞쪽 200개 구간만');
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
