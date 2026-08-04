import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/parsers/csv.js';
import { analyze } from '../src/core/analyzer.js';
import { renderedOffsetToSource } from '../src/ui/dom.js';

describe('미리보기 선택 위치 변환', () => {
  it('CRLF 문서의 DOM 선택 위치를 원문 위치로 복원한다', () => {
    const text = '첫째\r\n둘째\r\n영일이삼';
    const rendered = text.replace(/\r\n/g, '\n');
    const renderedStart = rendered.indexOf('영일이삼');
    const sourceStart = text.indexOf('영일이삼');

    expect(renderedOffsetToSource(text, 0, renderedStart)).toBe(sourceStart);
    expect(renderedOffsetToSource(text, 0, renderedStart + 4)).toBe(sourceStart + 4);
  });

  it('CSV fixture의 영일이삼 선택이 기존 후보와 겹치지 않는다', () => {
    const documentsUrl = new URL('./fixtures/documents/', import.meta.url);
    const fixtureName = readdirSync(documentsUrl).find((name) => name.startsWith('04_'));
    const bytes = readFileSync(new URL(fixtureName, documentsUrl));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parsed = parseCsv(buffer);
    const candidates = analyze(parsed, []);

    const targetText = '영일이삼';
    const sourceStart = parsed.text.indexOf(targetText);
    const renderedText = parsed.text.replace(/\r\n/g, '\n');
    const renderedStart = renderedText.indexOf(targetText);
    const convertedStart = renderedOffsetToSource(parsed.text, 0, renderedStart);
    const convertedEnd = renderedOffsetToSource(parsed.text, 0, renderedStart + targetText.length);
    const overlaps = candidates.some((candidate) => convertedStart < candidate.end && candidate.start < convertedEnd);

    expect(convertedStart).toBe(sourceStart);
    expect(parsed.text.slice(convertedStart, convertedEnd)).toBe(targetText);
    expect(overlaps).toBe(false);
  });
});
