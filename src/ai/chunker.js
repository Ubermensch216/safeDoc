// 문서 텍스트를 LLM 요청 단위로 분할 (계획 C-3)
//
// 실측 근거: gemma4:e2b는 프롬프트 평가가 ~1,180 tok/s로 사실상 공짜인 반면
// 생성은 100 tok/s다. 따라서 청크를 작게 쪼개 요청 수를 늘리는 것은 손해이고,
// 큰 청크로 요청 수를 줄이는 편이 빠르다.

export const CHUNK_SIZE = 3000;
export const CHUNK_OVERLAP = 200;

// 경계에서 잘린 개인정보를 놓치지 않도록 청크를 겹쳐 자른다.
// 겹친 구간에서 중복 탐지된 후보는 merge 단계에서 정리된다.
const BOUNDARY_SEARCH_RATIO = 0.7; // 청크 뒤쪽 30% 구간에서 줄바꿈 경계를 찾는다

// text → [{ text, base }] (base는 원본 전체 텍스트 기준 시작 오프셋)
export function chunkText(text, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];
  if (text.length <= size) return [{ text, base: 0 }];

  const safeOverlap = Math.max(0, Math.min(overlap, Math.floor(size / 2)));
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + size, text.length);

    // 마지막 청크가 아니면 줄바꿈에서 끊어 문장·셀 중간 절단을 피한다
    if (end < text.length) {
      const searchFrom = start + Math.floor(size * BOUNDARY_SEARCH_RATIO);
      const nl = text.lastIndexOf('\n', end - 1);
      if (nl > searchFrom) end = nl + 1;
    }

    chunks.push({ text: text.slice(start, end), base: start });

    if (end >= text.length) break;

    // 다음 청크 시작점. 겹치더라도 반드시 전진하여 무한 루프를 막는다.
    const next = end - safeOverlap;
    start = next > start ? next : end;
  }

  return chunks;
}
