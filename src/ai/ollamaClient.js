// Ollama 통신 계층 (계획 C-3)
//
// 이 프로그램에서 유일하게 네트워크를 사용하는 모듈이다.
// CSP가 http://localhost:11434, http://127.0.0.1:11434 두 루프백 주소만 허용하므로
// 그 외 주소로는 요청 자체가 브라우저에서 차단된다.

import {
  DETECT_SCHEMA, DETECT_SYSTEM_PROMPT, buildDetectMessage,
  VERIFY_SCHEMA, VERIFY_SYSTEM_PROMPT, buildVerifyMessage,
} from './prompt.js';

export const DEFAULT_ENDPOINT = 'http://localhost:11434';
export const DEFAULT_MODEL = 'gemma4:e2b';

// 실측(청크 3,000자 기준 5~7초) 대비 넉넉하게 잡는다
const REQUEST_TIMEOUT_MS = 120000;
const HEALTH_TIMEOUT_MS = 3000;

export class AiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'offline' | 'model' | 'timeout' | 'aborted' | 'response'
  }
}

// 외부에서 넘어온 신호와 자체 타임아웃을 하나로 합친다
function withTimeout(signal, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new AiError('timeout', 'AI 응답 시간이 초과되었습니다.')), ms);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const cleanup = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  };
  return { signal: controller.signal, cleanup };
}

// Ollama 구동 여부 및 모델 설치 여부 확인
export async function checkAvailability({ endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL, signal } = {}) {
  let version;
  try {
    const res = await fetch(`${endpoint}/api/version`, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(HEALTH_TIMEOUT_MS) : signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    version = (await res.json())?.version;
  } catch {
    return { available: false, reason: 'offline', message: 'AI 엔진(Ollama)에 연결할 수 없습니다.' };
  }

  let models = [];
  try {
    const res = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(HEALTH_TIMEOUT_MS) : signal,
    });
    if (res.ok) models = ((await res.json())?.models || []).map((m) => m.name);
  } catch { /* 목록 조회 실패는 치명적이지 않다 */ }

  if (models.length > 0 && !models.includes(model)) {
    return {
      available: false,
      reason: 'model',
      message: `모델 ${model} 이(가) 설치되어 있지 않습니다.`,
      version,
      models,
    };
  }

  return { available: true, version, models, model };
}

// 구조화 출력 요청 공통 처리
async function chatJson(systemPrompt, userMessage, schema, {
  endpoint = DEFAULT_ENDPOINT,
  model = DEFAULT_MODEL,
  signal,
  numCtx = 4096,
  numPredict = 1024,
} = {}) {
  const body = {
    model,
    stream: false,
    // thinking 지원 모델이므로 명시적으로 끈다 — 지연만 늘고 이 작업에는 도움이 되지 않는다
    think: false,
    format: schema,
    // 7.2GB 모델을 청크마다 재로딩하면 사용할 수 없는 수준이 된다
    keep_alive: '10m',
    options: {
      // 기본값이 1이다. 감사 대상 도구이므로 반드시 0으로 고정한다.
      temperature: 0,
      top_p: 1,
      num_ctx: numCtx,
      num_predict: numPredict,
    },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  };

  const { signal: reqSignal, cleanup } = withTimeout(signal, REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: reqSignal,
    });
  } catch (e) {
    cleanup();
    if (e instanceof AiError) throw e;
    if (signal?.aborted) throw new AiError('aborted', '사용자가 작업을 취소했습니다.');
    throw new AiError('offline', 'AI 엔진과 통신하지 못했습니다.');
  }
  cleanup();

  if (!res.ok) {
    throw new AiError('response', `AI 엔진이 오류를 반환했습니다. (HTTP ${res.status})`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new AiError('response', 'AI 응답을 해석하지 못했습니다.');
  }

  const content = payload?.message?.content;
  if (typeof content !== 'string') {
    throw new AiError('response', 'AI 응답 형식이 올바르지 않습니다.');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // 구조화 출력을 강제해도 드물게 깨질 수 있다. 해당 청크만 건너뛴다.
    throw new AiError('response', 'AI가 올바른 형식으로 답하지 않았습니다.');
  }

  return {
    data: parsed,
    metrics: {
      totalDurationMs: Math.round((payload.total_duration || 0) / 1e6),
      promptTokens: payload.prompt_eval_count || 0,
      outputTokens: payload.eval_count || 0,
    },
  };
}

// 1단계: 규칙 결과를 보여주지 않고 백지 상태로 탐지한다.
// (규칙 결과를 함께 주면 모델이 그 목록에 앵커링되어 새 항목을 찾지 못한다 — prompt.js 주석 참고)
export async function detectChunk(chunkText, options = {}) {
  const { data, metrics } = await chatJson(
    DETECT_SYSTEM_PROMPT, buildDetectMessage(chunkText), DETECT_SCHEMA, options,
  );
  return { items: Array.isArray(data?.items) ? data.items : [], metrics };
}

// 2단계: 오탐이 의심되는 후보만 좁혀서 검증한다.
export async function verifyChunk(chunkText, values, options = {}) {
  if (!values || values.length === 0) return { judgements: [], metrics: null };
  const { data, metrics } = await chatJson(
    VERIFY_SYSTEM_PROMPT, buildVerifyMessage(chunkText, values), VERIFY_SCHEMA,
    { ...options, numPredict: 700 },
  );
  return { judgements: Array.isArray(data?.judgements) ? data.judgements : [], metrics };
}
