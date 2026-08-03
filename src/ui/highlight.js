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
export function buildPreviewHtml(text, candidates, {
  start = 0,
  limit = PREVIEW_CHAR_LIMIT,
  includeNotice = true,
} = {}) {
  const safeStart = Math.max(0, Math.min(text.length, start));
  const endOffset = Math.min(text.length, safeStart + limit);
  const truncated = safeStart > 0 || endOffset < text.length;
  const view = text.slice(safeStart, endOffset);
  const sorted = candidates
    .filter((c) => c.start < endOffset && c.end > safeStart)
    .slice()
    .sort((a, b) => a.start - b.start);

  let html = '';
  let pos = 0;
  for (const c of sorted) {
    const relativeStart = Math.max(0, c.start - safeStart);
    if (relativeStart < pos) continue; // 중첩 방어 (병합 단계에서 정리되지만 한 번 더 확인)
    html += escapeHtml(view.slice(pos, relativeStart));
    const end = Math.min(c.end - safeStart, view.length);
    // 강조는 클릭하면 해당 후보로 이동하는 조작 요소다. 키보드로도 닿아야 한다.
    html += `<mark class="${markClass(c)}" data-id="${c.id}" title="${escapeHtml(markTitle(c))}"`
      + ` role="button" tabindex="0" aria-label="${escapeHtml(`${view.slice(relativeStart, end)} — ${markTitle(c)}`)}">`
      + `${escapeHtml(view.slice(relativeStart, end))}</mark>`;
    pos = end;
  }
  html += escapeHtml(view.slice(pos));

  if (truncated && includeNotice) {
    html += `\n\n<span class="muted">… ${safeStart.toLocaleString()}~${endOffset.toLocaleString()}자 구간만 표시됩니다. `
      + '검토 화면에서는 이전·다음 구간으로 이동할 수 있습니다.</span>';
  }
  return html;
}

export class PreviewHighlighter {
  constructor(el, { onWindowChange } = {}) {
    this.el = el;
    this.onWindowChange = onWindowChange;
    this.timer = null;
    this.pending = null;
    this.windowStart = 0;
    this.text = '';
    this.candidates = [];
  }

  // 사용자가 미리보기에서 문자열을 드래그하는 중이면 다시 그리지 않는다
  hasActiveSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    return this.el.contains(sel.anchorNode);
  }

  renderNow(text, candidates, { start = this.windowStart } = {}) {
    const top = this.el.scrollTop;
    const left = this.el.scrollLeft;
    this.text = text;
    this.candidates = candidates;
    this.windowStart = Math.max(0, Math.min(Math.max(0, text.length - 1), start));
    this.el.innerHTML = buildPreviewHtml(text, candidates, {
      start: this.windowStart,
      includeNotice: false,
    });
    this.el.scrollTop = top;
    this.el.scrollLeft = left;
    this.onWindowChange?.({
      start: this.windowStart,
      end: Math.min(text.length, this.windowStart + PREVIEW_CHAR_LIMIT),
      total: text.length,
    });
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
    let mark = this.el.querySelector(`mark.pii[data-id="${CSS.escape(id)}"]`);
    if (!mark) {
      const candidate = this.candidates.find((c) => c.id === id);
      if (candidate) {
        const start = Math.max(0, candidate.start - Math.floor(PREVIEW_CHAR_LIMIT / 2));
        this.renderNow(this.text, this.candidates, { start });
        mark = this.el.querySelector(`mark.pii[data-id="${CSS.escape(id)}"]`);
      }
    }
    if (mark) {
      mark.classList.add('focused');
      mark.scrollIntoView({ block: 'center' });
    }
  }

  clear() {
    this.cancel();
    this.el.innerHTML = '';
    this.windowStart = 0;
    this.text = '';
    this.candidates = [];
    this.onWindowChange?.({ start: 0, end: 0, total: 0 });
  }

  shiftWindow(direction) {
    const step = Math.max(1, PREVIEW_CHAR_LIMIT - 2000);
    const maxStart = Math.max(0, this.text.length - PREVIEW_CHAR_LIMIT);
    const start = Math.max(0, Math.min(maxStart, this.windowStart + direction * step));
    this.renderNow(this.text, this.candidates, { start });
  }
}
