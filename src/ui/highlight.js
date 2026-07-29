// 문서 미리보기 강조 (계획 D-5)
//
// AI 결과가 청크마다 도착하므로 미리보기도 반복해서 다시 그려진다.
// 그때마다 스크롤이 튀거나 사용자가 드래그 중인 선택이 사라지면 검토를 할 수 없다.
// 여기서 다시 그리기를 지연시키고 스크롤·선택을 지켜준다.

import { escapeHtml } from './dom.js';
import { PII_TYPES, confidenceLabel } from '../detect/types.js';

// 화면 응답성 유지 (NFR-104)
export const PREVIEW_CHAR_LIMIT = 200000;

const RENDER_DEBOUNCE_MS = 400;

// 강조 색은 유형이 아니라 "검토 필요도"를 나타낸다
function markClass(c) {
  if (!c.selected) return 'pii excluded';
  if (c.aiDisputed) return 'pii src-disputed';
  if (c.aiOnly) return 'pii src-ai';
  return 'pii';
}

function markTitle(c) {
  const type = PII_TYPES[c.type]?.label || c.type;
  const parts = [`${type} · ${confidenceLabel(c.confidence)}`];
  if (c.aiDisputed) parts.push(`AI 오탐 의심: ${c.aiDisputed.reason}`);
  else if (c.aiOnly) parts.push(`AI 발견: ${c.aiReason}`);
  else if (c.aiConfirmed) parts.push('규칙과 AI가 일치');
  return parts.join(' — ');
}

// 문서 텍스트 + 후보 목록 → 강조된 HTML (FR-401)
export function buildPreviewHtml(text, candidates) {
  const truncated = text.length > PREVIEW_CHAR_LIMIT;
  const view = truncated ? text.slice(0, PREVIEW_CHAR_LIMIT) : text;
  const sorted = candidates
    .filter((c) => c.start < view.length)
    .slice()
    .sort((a, b) => a.start - b.start);

  let html = '';
  let pos = 0;
  for (const c of sorted) {
    if (c.start < pos) continue; // 중첩 방어 (병합 단계에서 정리되지만 한 번 더 확인)
    html += escapeHtml(view.slice(pos, c.start));
    const end = Math.min(c.end, view.length);
    html += `<mark class="${markClass(c)}" data-id="${c.id}" title="${escapeHtml(markTitle(c))}">`
      + `${escapeHtml(view.slice(c.start, end))}</mark>`;
    pos = end;
  }
  html += escapeHtml(view.slice(pos));

  if (truncated) {
    html += `\n\n<span class="muted">… 미리보기는 ${PREVIEW_CHAR_LIMIT.toLocaleString()}자까지만 표시됩니다. `
      + '처리는 문서 전체에 적용됩니다.</span>';
  }
  return html;
}

export class PreviewHighlighter {
  constructor(el) {
    this.el = el;
    this.timer = null;
    this.pending = null;
  }

  // 사용자가 미리보기에서 문자열을 드래그하는 중이면 다시 그리지 않는다
  hasActiveSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    return this.el.contains(sel.anchorNode);
  }

  renderNow(text, candidates) {
    const top = this.el.scrollTop;
    const left = this.el.scrollLeft;
    this.el.innerHTML = buildPreviewHtml(text, candidates);
    this.el.scrollTop = top;
    this.el.scrollLeft = left;
  }

  // AI 결과가 연속으로 도착할 때 매번 다시 그리지 않도록 묶어서 처리한다
  schedule(text, candidates) {
    this.pending = { text, candidates };
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const job = this.pending;
      this.pending = null;
      if (!job) return;
      if (this.hasActiveSelection()) {
        // 선택 중이면 미룬다 — 드래그로 개인정보를 추가하는 중일 수 있다
        this.schedule(job.text, job.candidates);
        return;
      }
      this.renderNow(job.text, job.candidates);
    }, RENDER_DEBOUNCE_MS);
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  focus(id) {
    this.el.querySelectorAll('mark.pii.focused').forEach((m) => m.classList.remove('focused'));
    const mark = this.el.querySelector(`mark.pii[data-id="${CSS.escape(id)}"]`);
    if (mark) {
      mark.classList.add('focused');
      mark.scrollIntoView({ block: 'center' });
    }
  }

  clear() {
    this.cancel();
    this.el.innerHTML = '';
  }
}
