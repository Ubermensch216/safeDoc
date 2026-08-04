import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

describe('전면 개편 UI 계약', () => {
  it('5단계 작업 흐름과 독립 처리 확인 화면을 제공한다', () => {
    for (const step of ['prepare', 'analyze', 'review', 'confirm', 'complete']) {
      expect(html).toContain(`data-step="${step}"`);
    }
    expect(html).toContain('id="screen-confirm"');
    expect(html).toContain('id="btn-to-confirm"');
  });

  it('작업 중심 내비게이션에 접근 가능한 이름을 제공한다', () => {
    expect(html).toContain('aria-label="새 비식별 작업"');
    expect(html).toContain('aria-label="비식별 처리"');
    expect(html).toContain('aria-label="원본 복원"');
    expect(html).toContain('aria-label="설정"');
  });

  it('safeDoc 로고를 브랜드 배너와 웹앱 아이콘에 공통 적용한다', () => {
    expect(html).toContain('class="brand-logo"');
    expect(html).toContain('rel="icon" type="image/png" data-brand-icon');
    expect(html).toContain('rel="apple-touch-icon" data-brand-icon');
    expect(main).toContain("import brandLogoUrl from './assets/safedoc-logo.png'");
    expect(main).toContain("document.querySelectorAll('.brand-logo')");
    expect(main).toContain("document.querySelectorAll('[data-brand-icon]')");
  });

  it('대응표 미생성을 기본값으로 둔다', () => {
    expect(html).toContain('name="mapping-choice" value="no" checked');
    expect(html).toContain('id="btn-download-mapping" class="btn danger-outline" hidden');
  });
});
