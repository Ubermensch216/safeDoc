// DOM 공통 도우미

import { AppError } from '../core/errors.js';

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
export function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// 오류 표시 (개인정보 원문 미포함, NFR-003)
export function showError(err) {
  const message = err instanceof AppError ? err.message : '처리 중 오류가 발생했습니다. 다시 시도해 주십시오.';
  toast(message, true);
}

// 보조기술 전용 알림. 토스트와 달리 화면에는 나타나지 않는다.
export function announce(message) {
  const region = $('#live-region');
  if (!region) return;
  region.textContent = '';
  // 같은 문구가 연속으로 오면 읽지 않는 판독기가 있어 한 틱 비운 뒤 넣는다
  setTimeout(() => { region.textContent = message; }, 50);
}

// 작업 단계 표시줄 (1 문서 준비 → 2 규칙 기반 탐지 → 3 AI 탐지 → 4 개인정보 검토 → 5 처리 확인 → 6 완료)
export const WORKFLOW_STEPS = ['prepare', 'rules', 'ai', 'review', 'confirm', 'complete'];

// AI를 쓰지 않았거나 중단·실패해 실제로 수행되지 않은 단계. 완료(✓)와 구분해 '–'로 표시한다.
let skippedSteps = new Set();

/**
 * 현재 단계를 표시한다. skipped를 넘기면 건너뛴 단계 목록을 교체하고, 생략하면 이전 값을 유지한다.
 */
export function setWorkflowStep(step, { skipped } = {}) {
  if (skipped) skippedSteps = new Set(skipped);
  const current = WORKFLOW_STEPS.indexOf(step);
  $$('#workflow-steps .step').forEach((item, index) => {
    const passed = index < current;
    const isSkipped = passed && skippedSteps.has(item.dataset.step);
    item.classList.toggle('current', index === current);
    item.classList.toggle('done', passed && !isSkipped);
    item.classList.toggle('skipped', isSkipped);
    if (index === current) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
}

export function showScreen(id) {
  $$('#tab-deidentify .screen').forEach((s) => s.classList.remove('active'));
  const screen = $(`#${id}`);
  screen.classList.add('active');

  // 검토 화면은 AI 탐지 중에는 3단계(AI 탐지), 끝난 뒤에는 4단계(개인정보 검토)로 표시한다
  const reviewStep = screen.classList.contains('ai-running') ? 'ai' : 'review';
  const screenMeta = {
    'screen-main': { step: 'prepare', title: '새 비식별 작업' },
    'screen-analyze': { step: 'rules', title: '규칙 기반 탐지' },
    'screen-review': { step: reviewStep, title: reviewStep === 'ai' ? 'AI 탐지' : '개인정보 검토' },
    'screen-confirm': { step: 'confirm', title: '처리 확인' },
    'screen-result': { step: 'complete', title: '완료' },
  };
  const meta = screenMeta[id];
  if (meta) {
    // 새 작업을 시작하면 이전 작업의 '건너뜀' 표시를 지운다
    setWorkflowStep(meta.step, meta.step === 'prepare' ? { skipped: [] } : {});
    const title = $('#page-title');
    if (title) title.textContent = meta.title;
  }

  const heading = screen.querySelector('h3, h2');
  if (heading) {
    heading.tabIndex = -1;
    requestAnimationFrame(() => heading.focus({ preventScroll: true }));
  }
}

// 컨테이너 내 특정 노드·오프셋의 텍스트 기준 위치 계산 (수동 추가용)
export function textOffsetIn(container, targetNode, offsetInNode) {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + offsetInNode;
    offset += node.textContent.length;
  }
  return -1;
}

// HTML 파서는 CRLF(\r\n)를 LF(\n) 한 글자로 정규화한다.
// 따라서 DOM에서 센 선택 오프셋을 원문에 그대로 더하면 줄마다 1자씩 앞당겨진다.
// renderedOffset을 sourceStart부터의 원문 UTF-16 오프셋으로 다시 변환한다.
export function renderedOffsetToSource(text, sourceStart, renderedOffset) {
  const safeStart = Math.max(0, Math.min(text.length, sourceStart));
  const target = Math.max(0, renderedOffset);
  let source = safeStart;
  let rendered = 0;

  while (source < text.length && rendered < target) {
    if (text[source] === '\r' && text[source + 1] === '\n') source += 2;
    else source += 1;
    rendered += 1;
  }
  return source;
}
