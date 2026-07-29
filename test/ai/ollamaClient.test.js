import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  checkAvailability, detectChunk, verifyChunk, AiError, DEFAULT_MODEL,
} from '../../src/ai/ollamaClient.js';

afterEach(() => vi.unstubAllGlobals());

const jsonRes = (data) => ({ ok: true, json: async () => data });

describe('Ollama 가용성 확인', () => {
  it('엔진과 모델이 모두 준비되면 available', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (
      String(url).includes('/api/version')
        ? jsonRes({ version: '0.32.5' })
        : jsonRes({ models: [{ name: DEFAULT_MODEL }] })
    )));
    const r = await checkAvailability({});
    expect(r.available).toBe(true);
    expect(r.version).toBe('0.32.5');
  });

  it('엔진이 꺼져 있으면 offline 사유를 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await checkAvailability({});
    expect(r).toMatchObject({ available: false, reason: 'offline' });
  });

  it('모델이 없으면 model 사유와 설치 목록을 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (
      String(url).includes('/api/version')
        ? jsonRes({ version: '0.32.5' })
        : jsonRes({ models: [{ name: 'llama3:8b' }] })
    )));
    const r = await checkAvailability({ model: 'gemma4:e2b' });
    expect(r).toMatchObject({ available: false, reason: 'model' });
    expect(r.models).toContain('llama3:8b');
  });
});

describe('청크 분석 요청', () => {
  it('구조화 출력을 파싱하여 items를 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({
      message: { content: JSON.stringify({ items: [{ value: '홍길동', type: 'PERSON_NAME', reason: 'x' }] }) },
      eval_count: 10,
    })));
    const r = await detectChunk('문서 본문', {});
    expect(r.items).toHaveLength(1);
    expect(r.metrics.outputTokens).toBe(10);
  });

  it('items가 없으면 빈 배열로 처리한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ message: { content: '{}' } })));
    const r = await detectChunk('문서', {});
    expect(r.items).toEqual([]);
  });

  it('JSON이 깨지면 response 오류를 던진다 (해당 청크만 건너뛴다)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ message: { content: '{깨진' } })));
    await expect(detectChunk('문서', {})).rejects.toMatchObject({ kind: 'response' });
  });

  it('응답 형식이 어긋나면 response 오류를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ nope: true })));
    await expect(detectChunk('문서', {})).rejects.toBeInstanceOf(AiError);
  });

  it('HTTP 오류를 오류코드와 함께 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(detectChunk('문서', {})).rejects.toMatchObject({ kind: 'response' });
  });

  it('통신 실패는 offline으로 구분한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(detectChunk('문서', {})).rejects.toMatchObject({ kind: 'offline' });
  });

  it('취소 신호를 aborted로 구분한다', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }));
    await expect(detectChunk('문서', { signal: controller.signal }))
      .rejects.toMatchObject({ kind: 'aborted' });
  });

  it('검증 대상이 없으면 요청을 보내지 않는다', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const r = await verifyChunk('문서', [], {});
    expect(r.judgements).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('감사 가능한 파라미터로 요청한다', async () => {
    let body;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      body = JSON.parse(init.body);
      return jsonRes({ message: { content: '{"items":[]}' } });
    }));
    await detectChunk('문서', { model: 'gemma4:e2b' });

    expect(body.model).toBe('gemma4:e2b');
    expect(body.options.temperature).toBe(0); // 모델 기본값 1을 반드시 덮어써야 한다
    expect(body.think).toBe(false);
    expect(body.keep_alive).toBe('10m'); // 7.2GB 재로딩 방지
    expect(body.options.num_ctx).toBe(4096);
  });
});
