import { describe, it, expect, vi } from 'vitest';
import { AiRunLifecycle } from '../../src/ai/lifecycle.js';
import { createAiStats } from '../../src/ai/aiDetect.js';

describe('AI 실행 수명주기', () => {
  it('새 실행이 시작되면 이전 실행은 현재 세션을 갱신할 수 없다', () => {
    const lifecycle = new AiRunLifecycle();
    const first = lifecycle.begin();
    const second = lifecycle.begin();
    expect(lifecycle.isCurrent(first)).toBe(false);
    expect(lifecycle.isCurrent(second)).toBe(true);
  });

  it('중단 시 컨트롤러를 취소하고 실행 결과를 기다린다', async () => {
    const lifecycle = new AiRunLifecycle();
    const run = lifecycle.begin();
    const abort = vi.fn();
    lifecycle.attachController(run, { abort });
    lifecycle.attachPromise(run, Promise.resolve({ completed: false, stopReason: 'aborted' }));

    const stats = await lifecycle.stop({ wait: true });
    expect(abort).toHaveBeenCalledOnce();
    expect(stats).toMatchObject({ completed: false, stopReason: 'aborted' });
    expect(lifecycle.isCurrent(run)).toBe(false);
  });

  it('이미 무효화된 실행에 붙은 컨트롤러는 즉시 취소한다', () => {
    const lifecycle = new AiRunLifecycle();
    const oldRun = lifecycle.begin();
    lifecycle.begin();
    const abort = vi.fn();
    lifecycle.attachController(oldRun, { abort });
    expect(abort).toHaveBeenCalledOnce();
  });
});

describe('AI 초기 감사 통계', () => {
  it('가용성 확인 단계에서 중단해도 미완료 감사 블록을 만들 수 있다', () => {
    const stats = createAiStats('가'.repeat(7000), { model: 'test-model', maxChunks: 1 });
    stats.stopReason = 'aborted';
    expect(stats).toMatchObject({
      enabled: true,
      model: 'test-model',
      chunksPlanned: 1,
      chunksCompleted: 0,
      truncated: true,
      completed: false,
      stopReason: 'aborted',
    });
  });
});
