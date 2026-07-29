import { describe, it, expect } from 'vitest';
import { chunkText, CHUNK_SIZE } from '../../src/ai/chunker.js';

const longText = Array.from({ length: 400 }, (_, i) => `${i}행 내용입니다`).join('\n');

describe('AI 청킹', () => {
  it('짧은 문서는 청크 하나로 처리한다', () => {
    const chunks = chunkText('짧은 문서');
    expect(chunks).toEqual([{ text: '짧은 문서', base: 0 }]);
  });

  it('빈 문서는 청크를 만들지 않는다', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText(null)).toEqual([]);
  });

  it('모든 청크의 base가 원문 오프셋과 정확히 일치한다', () => {
    const chunks = chunkText(longText, { size: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(longText.slice(c.base, c.base + c.text.length)).toBe(c.text);
    }
  });

  it('문서 끝까지 빠짐없이 덮는다', () => {
    const chunks = chunkText(longText, { size: 500, overlap: 50 });
    const last = chunks[chunks.length - 1];
    expect(last.base + last.text.length).toBe(longText.length);
  });

  it('청크를 겹쳐 잘라 경계에 걸친 개인정보를 놓치지 않는다', () => {
    const chunks = chunkText(longText, { size: 500, overlap: 50 });
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].base).toBeLessThan(chunks[i - 1].base + chunks[i - 1].text.length);
    }
  });

  it('가능하면 줄바꿈 경계에서 자른다', () => {
    const chunks = chunkText(longText, { size: 500, overlap: 50 });
    // 마지막을 제외한 청크는 줄바꿈으로 끝나야 한다
    for (const c of chunks.slice(0, -1)) {
      expect(c.text.endsWith('\n')).toBe(true);
    }
  });

  it('overlap이 size보다 커도 전진하여 무한 루프에 빠지지 않는다', () => {
    const chunks = chunkText(longText, { size: 100, overlap: 500 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(1000);
  });

  it('기본 청크 크기는 실측 근거에 따라 3,000자다', () => {
    // 프롬프트 평가는 ~1,180 tok/s로 저렴하고 생성은 100 tok/s다.
    // 작게 쪼개면 요청 수만 늘어 손해다.
    expect(CHUNK_SIZE).toBe(3000);
  });
});
