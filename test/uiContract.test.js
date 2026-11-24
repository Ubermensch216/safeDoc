import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

describe('전면 개편 UI 계약', () => {
  it('6단계 작업 흐름과 독립 처리 확인 화면을 제공한다', () => {
    // 문서 준비 → 규칙 기반 탐지 → AI 탐지 → 개인정보 검토 → 처리 확인 → 완료
    const steps = ['prepare', 'rules', 'ai', 'review', 'confirm', 'complete'];
    const found = [...html.matchAll(/<li class="step[^"]*" data-step="(\w+)"/g)].map((m) => m[1]);
    expect(found).toEqual(steps);
    expect(html).toContain('<b>규칙 기반 탐지</b>');
    expect(html).toContain('<b>AI 탐지</b>');
    expect(html).toContain('id="screen-confirm"');
    expect(html).toContain('id="btn-to-confirm"');
  });

  it('작업 중심 내비게이션에 접근 가능한 이름을 제공하고 상단 바에 메뉴명만 배치한다', () => {
    expect(html).toContain('class="app-topbar"');
    expect(html).not.toContain('class="app-sidebar"');
    expect(html).not.toContain('class="nav-section-label"');
    expect(html).not.toContain('class="sidebar-status"');
    expect(html).not.toContain('class="workspace-header"');
    expect(html).not.toContain('class="nav-icon"');
    expect(html).not.toContain('id="version-info"');
    expect(html).toContain('aria-label="새 비식별 작업"');
    expect(html).toContain('aria-label="비식별 처리"');
    expect(html).toContain('aria-label="관리"');
  });

  it('상단 메뉴는 비식별 처리·관리 두 개이고 설정은 톱니바퀴 아이콘 팝업이다', () => {
    const nav = /<nav class="top-nav"[\s\S]*?<\/nav>/.exec(html)[0];
    expect([...nav.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1])).toEqual(['deidentify', 'manage']);
    expect(html).not.toContain('data-tab="restore"');
    expect(html).not.toContain('data-tab="settings"');

    // 아이콘만 있는 버튼이므로 이름은 aria-label로 제공한다
    const gear = /<button id="btn-settings"[\s\S]*?<\/button>/.exec(html)[0];
    expect(gear).toContain('aria-label="설정"');
    expect(gear).toContain('aria-haspopup="dialog"');
    expect(gear).toContain('aria-expanded="false"');
    expect(gear).toContain('<svg');
    expect(gear.replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '').trim()).toBe('');
    expect(html).toMatch(/<div id="settings-popover"[^>]*role="dialog"[^>]*hidden>/);
  });

  it('설정 팝업에는 AI 엔진과 기본값 복원만 두고 관리 화면에 처리 정책·사용자 규칙·원본 복원을 둔다', () => {
    const popover = /<div id="settings-popover"[\s\S]*?<\/footer>\s*<\/div>/.exec(html)[0];
    expect(popover).toContain('id="ai-engine-title">AI 엔진');
    expect(popover).toContain('id="btn-reset-settings"');
    expect(popover).toContain('기본값 복원');
    expect(popover).not.toContain('id="policy-list"');
    expect(popover).not.toContain('id="rule-list"');
    expect(popover).not.toContain('id="btn-restore"');

    const manage = /<section id="tab-manage"[\s\S]*?<\/section>\s*<\/main>/.exec(html)[0];
    const items = [...manage.matchAll(/<button class="settings-nav-btn[^"]*" data-settings="(\w+)"[^>]*>([^<]+)</g)];
    expect(items.map((m) => [m[1], m[2]])).toEqual([['restore', '원본 복원'], ['policy', '처리 정책'], ['rules', '사용자 규칙']]);
    for (const id of ['policy-list', 'rule-list', 'btn-restore']) expect(manage).toContain(`id="${id}"`);
    expect(manage).not.toContain('id="ai-enabled"');
    expect(manage).not.toContain('id="btn-reset-settings"');
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
    expect(html).toContain('data-compare="side-by-side"');
    expect(html).not.toContain('data-compare="after"');
    expect(html).not.toContain('data-compare="before"');
    expect(html).not.toContain('id="btn-new-doc"');
    expect(html).not.toContain('id="btn-finish"');
  });
});
