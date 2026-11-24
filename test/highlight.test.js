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

  it('AI 미검사 구간을 빗금과 시작 표지로 표시하되 본문 글자는 바꾸지 않는다', () => {
    const text = '앞부분 홍길동 가운데 김철수 뒷부분';
    const candidates = [
      { id: 'a', start: 4, end: 7, originalText: '홍길동', type: 'PERSON_NAME', confidence: 1, selected: true },
      { id: 'b', start: 12, end: 15, originalText: '김철수', type: 'PERSON_NAME', confidence: 1, selected: true },
    ];
    const gaps = [{ start: 8, end: text.length, reason: 'truncated' }];
    const html = buildPreviewHtml(text, candidates, { includeNotice: false, gaps });
    expect(html).toContain('class="ai-gap-start" data-gap-start="8"');
    expect(html).toContain('<span class="ai-gap">');
    expect(html).toMatch(/class="pii[^"]*in-gap" data-id="b"/);
    expect(html).not.toMatch(/class="pii[^"]*in-gap" data-id="a"/);
    // 드래그로 후보를 추가할 때 글자 위치 계산이 어긋나지 않도록, 태그를 빼면 원문과 같아야 한다
    expect(html.replace(/<[^>]+>/g, '')).toBe(text);
  });

  it('미검사 구간이 후보 안에서 시작하면 표지를 후보 앞에 둔다', () => {
    const text = '이름 홍길동 끝';
    const candidates = [{ id: 'a', start: 3, end: 6, originalText: '홍길동', type: 'PERSON_NAME', confidence: 1, selected: true }];
    const html = buildPreviewHtml(text, candidates, { includeNotice: false, gaps: [{ start: 4, end: 8, reason: 'failed' }] });
    expect(html.indexOf('data-gap-start="4"')).toBeLessThan(html.indexOf('data-id="a"'));
    expect(html.match(/data-gap-start/g)).toHaveLength(1);
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
