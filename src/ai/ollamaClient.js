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

// 컨텍스트 창(입력+출력 합계)과 출력 상한 — 실측 근거 (2026-11-24, gemma4:e2b)
// - 시스템 프롬프트만 1,507토큰이다. 3,000자 구간의 입력은 표가 많은 문서에서 4,000토큰을 넘는다
//   (CSV 4,071 · XLSX 4,096 초과 → 4,096 창에서는 HTTP 400으로 요청 자체가 거부됐다).
// - 탐지 결과 항목 하나가 JSON으로 약 48토큰이다. 표가 많은 문서는 1,200자에 20건이 넘어
//   출력 상한 1,024토큰에서 잘렸다. 3,000자 구간에는 2,000~3,000토큰이 필요하다.
// 탐지와 검증은 같은 창 크기를 써야 한다. 크기가 바뀌면 Ollama가 모델을 다시 올린다.
export const NUM_CTX = 8192;
const DETECT_NUM_PREDICT = 4096;
// 검증은 최대 30개 값의 판정이다. 판정 하나가 약 35토큰이라 1,024에서는 잘렸다(실측).
const VERIFY_NUM_PREDICT = 2048;

// CPU만 쓰는 PC에서 출력 4,096토큰은 약 3분이 걸린다(24 tok/s 실측). 그보다 넉넉하게 잡는다.
const REQUEST_TIMEOUT_MS = 300000;
const HEALTH_TIMEOUT_MS = 3000;

export class AiError extends Error {
  constructor(kind, message) {
    super(message);
    // 'overflow'는 입력이 컨텍스트 창보다 길어 거부된 경우다. 호출자가 구간을 나눠 다시 묻는다.
    this.kind = kind; // 'offline' | 'model' | 'timeout' | 'aborted' | 'response' | 'overflow'
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

// 출력이 중간에 잘린 JSON에서 이미 완성된 배열 항목만 건져 낸다.
// 컨텍스트 창(입력+출력 합계)이 모자라면 모델은 항목 중간에서 멈추는데,
// 앞쪽 항목은 멀쩡하므로 통째로 버리면 그 구간의 탐지가 모두 사라진다.
export function salvageArray(content, key) {
  const keyAt = content.indexOf(`"${key}"`);
  const open = keyAt < 0 ? -1 : content.indexOf('[', keyAt);
  if (open < 0) return [];

  const items = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1;
  for (let i = open + 1; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) objStart = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && objStart >= 0) {
        try { items.push(JSON.parse(content.slice(objStart, i + 1))); } catch { /* 깨진 항목은 버린다 */ }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return items;
}

// 구조화 출력 요청 공통 처리
// arrayKey: 결과 배열의 이름. 출력이 잘렸을 때 완성된 항목만 건지는 데 쓴다.
async function chatJson(systemPrompt, userMessage, schema, {
  endpoint = DEFAULT_ENDPOINT,
  model = DEFAULT_MODEL,
  signal,
  numCtx = NUM_CTX,
  numPredict = DETECT_NUM_PREDICT,
  arrayKey = null,
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
    let detail = '';
    try { detail = await res.text(); } catch { /* 본문이 없어도 상태 코드로 판단한다 */ }
    if (/context length|longer than the context|exceeds? (the )?context/i.test(detail)) {
      throw new AiError('overflow', '구간이 AI 입력 한도를 넘었습니다.');
    }
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

  // done_reason이 length이면 모델이 끝까지 쓰지 못하고 잘렸다 (출력 상한 또는 컨텍스트 소진)
  const truncated = payload.done_reason === 'length';

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // 잘린 응답은 완성된 항목만 건진다. 호출자가 구간을 나눠 다시 물을 수 있도록 truncated로 알린다.
    if (truncated && arrayKey) {
      parsed = { [arrayKey]: salvageArray(content, arrayKey) };
    } else {
      // 구조화 출력을 강제해도 드물게 깨질 수 있다. 해당 청크만 건너뛴다.
      throw new AiError('response', 'AI가 올바른 형식으로 답하지 않았습니다.');
    }
  }

  return {
    data: parsed,
    truncated,
    metrics: {
      totalDurationMs: Math.round((payload.total_duration || 0) / 1e6),
      promptTokens: payload.prompt_eval_count || 0,
      outputTokens: payload.eval_count || 0,
    },
  };
}

// 1단계: 규칙 결과를 보여주지 않고 백지 상태로 탐지한다.
// (규칙 결과를 함께 주면 모델이 그 목록에 앵커링되어 새 항목을 찾지 못한다 — prompt.js 주석 참고)
// truncated가 true이면 응답이 잘렸다는 뜻이며 items는 그 앞부분만 담고 있다.
export async function detectChunk(chunkText, options = {}) {
  const { data, metrics, truncated } = await chatJson(
    DETECT_SYSTEM_PROMPT, buildDetectMessage(chunkText), DETECT_SCHEMA,
    { ...options, arrayKey: 'items' },
  );
  return { items: Array.isArray(data?.items) ? data.items : [], metrics, truncated };
}

// 2단계: 오탐이 의심되는 후보만 좁혀서 검증한다.
export async function verifyChunk(chunkText, values, options = {}) {
  if (!values || values.length === 0) return { judgements: [], metrics: null, truncated: false };
  const { data, metrics, truncated } = await chatJson(
    VERIFY_SYSTEM_PROMPT, buildVerifyMessage(chunkText, values), VERIFY_SCHEMA,
    { ...options, numPredict: VERIFY_NUM_PREDICT, arrayKey: 'judgements' },
  );
  return { judgements: Array.isArray(data?.judgements) ? data.judgements : [], metrics, truncated };
}
