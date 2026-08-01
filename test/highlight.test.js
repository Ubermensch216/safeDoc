import { describe, it, expect } from 'vitest';
import { buildPreviewHtml, PREVIEW_CHAR_LIMIT } from '../src/ui/highlight.js';

describe('대용량 미리보기 구간 렌더링', () => {
  it('20만 자 이후 구간의 후보를 상대 위치에 맞게 표시한다', () => {
    const text = `${'가'.repeat(PREVIEW_CHAR_LIMIT + 100)}홍길동${'나'.repeat(20)}`;
    const start = PREVIEW_CHAR_LIMIT;
    const candidate = {
      id: 'late',
      start: PREVIEW_CHAR_LIMIT + 100,
      end: PREVIEW_CHAR_LIMIT + 103,
      originalText: '홍길동',
      type: 'PERSON_NAME',
      confidence: 1,
      selected: true,
    };
    const html = buildPreviewHtml(text, [candidate], { start, includeNotice: false });
    expect(html).toContain('data-id="late"');
    expect(html).toContain('>홍길동</mark>');
    expect(html.startsWith('가'.repeat(100))).toBe(true);
  });

  it('현재 구간 밖 후보는 표시하지 않는다', () => {
    const text = `${'가'.repeat(PREVIEW_CHAR_LIMIT + 10)}홍길동`;
    const candidate = {
      id: 'late', start: PREVIEW_CHAR_LIMIT + 10, end: PREVIEW_CHAR_LIMIT + 13,
      originalText: '홍길동', type: 'PERSON_NAME', confidence: 1, selected: true,
    };
    expect(buildPreviewHtml(text, [candidate], { start: 0, includeNotice: false }))
      .not.toContain('data-id="late"');
  });
});
