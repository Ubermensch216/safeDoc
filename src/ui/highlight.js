// 문서 미리보기 강조 (계획 D-5)
//
// AI 결과가 청크마다 도착하므로 미리보기도 반복해서 다시 그려진다.
// 그때마다 스크롤이 튀거나 사용자가 드래그 중인 선택이 사라지면 검토를 할 수 없다.
// 여기서 다시 그리기를 지연시키고 스크롤·선택을 지켜준다.

import { escapeHtml } from './dom.js';
import { PII_TYPES, confidenceLabel } from '../detect/types.js';
import { REVIEW_STATES } from '../core/reviewState.js';
import { UNCOVERED_REASON_LABELS } from '../ai/aiDetect.js';

// 화면 응답성 유지 (NFR-104)
export const PREVIEW_CHAR_LIMIT = 200000;

const RENDER_DEBOUNCE_MS = 400;

// 강조 색은 유형이 아니라 "검토 필요도"를 나타낸다
function markClass(c) {
  if (c.reviewState === REVIEW_STATES.PENDING) return 'pii pending';
  if (c.reviewState === REVIEW_STATES.EXCLUDE || !c.selected) return 'pii excluded';
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

// AI 미검사 구간의 시작 표지. 글자 대신 CSS ::before로 "AI 미검사"를 그린다.
// 텍스트 노드를 넣으면 드래그로 후보를 추가할 때의 글자 위치 계산이 어긋나므로 빈 요소로 둔다.
function gapStartMarker(gap) {
  const reason = UNCOVERED_REASON_LABELS[gap.reason] || 'AI가 검사하지 못함';
  return `<span class="ai-gap-start" data-gap-start="${gap.abs}" title="AI 미검사 구간 — ${escapeHtml(reason)}. 직접 확인하십시오."></span>`;
}

// 문서 텍스트 + 후보 목록 → 강조된 HTML (FR-401)
// gaps: AI가 검사하지 못한 범위 [{ start, end, reason }] (문서 전체 기준). 빗금 배경과 시작 표지로 표시한다.
export function buildPreviewHtml(text, candidates, {
  start = 0,
  limit = PREVIEW_CHAR_LIMIT,
  includeNotice = true,
  gaps = [],
} = {}) {
  const safeStart = Math.max(0, Math.min(text.length, start));
  const endOffset = Math.min(text.length, safeStart + limit);
  const truncated = safeStart > 0 || endOffset < text.length;
  const view = text.slice(safeStart, endOffset);
  const sorted = candidates
    .filter((c) => c.start < endOffset && c.end > safeStart)
    .slice()
    .sort((a, b) => a.start - b.start);

  // 표시 구간 기준 위치로 바꾼다. startsHere: 시작점이 이 표시 구간 안에 있어 표지를 그릴지 여부
  const viewGaps = gaps
    .map((g) => ({
      s: Math.max(0, g.start - safeStart),
      e: Math.min(view.length, g.end - safeStart),
      abs: g.start,
      reason: g.reason,
      startsHere: g.start >= safeStart && g.start < endOffset,
    }))
    .filter((g) => g.e > g.s)
    .sort((a, b) => a.s - b.s);

  // 후보가 아닌 평문 [a, b)를 미검사 구간 기준으로 나눠 그린다
  const plain = (a, b) => {
    let out = '';
    let p = a;
    for (const g of viewGaps) {
      if (g.e <= p || g.s >= b) continue;
      const s = Math.max(g.s, p);
      const e = Math.min(g.e, b);
      if (s > p) out += escapeHtml(view.slice(p, s));
      if (s === g.s && g.startsHere) out += gapStartMarker(g);
      out += `<span class="ai-gap">${escapeHtml(view.slice(s, e))}</span>`;
      p = e;
    }
    if (p < b) out += escapeHtml(view.slice(p, b));
    return out;
  };

  let html = '';
  let pos = 0;
  for (const c of sorted) {
    const relativeStart = Math.max(0, c.start - safeStart);
    if (relativeStart < pos) continue; // 중첩 방어 (병합 단계에서 정리되지만 한 번 더 확인)
    html += plain(pos, relativeStart);
    const end = Math.min(c.end - safeStart, view.length);
    // 미검사 구간이 이 후보 안에서 시작하면 표지를 후보 앞에 둔다
    const inGap = viewGaps.filter((g) => g.s < end && g.e > relativeStart);
    for (const g of inGap) if (g.startsHere && g.s >= relativeStart) html += gapStartMarker(g);
    // 강조는 클릭하면 해당 후보로 이동하는 조작 요소다. 키보드로도 닿아야 한다.
    html += `<mark class="${markClass(c)}${inGap.length ? ' in-gap' : ''}" data-id="${c.id}" title="${escapeHtml(markTitle(c))}"`
      + ` role="button" tabindex="0" aria-label="${escapeHtml(`${view.slice(relativeStart, end)} — ${markTitle(c)}`)}">`
      + `${escapeHtml(view.slice(relativeStart, end))}</mark>`;
    pos = end;
  }
  html += plain(pos, view.length);

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
    this.focusedId = null;
    this.gaps = [];
  }

  // AI가 검사하지 못한 범위를 설정하고 바로 다시 그린다
  setGaps(gaps) {
    this.gaps = Array.isArray(gaps) ? gaps : [];
    if (this.text) this.renderNow(this.text, this.candidates);
  }

  // index번째 미검사 구간으로 본문을 옮긴다. 구간이 표시 범위 밖이면 표시 범위를 옮겨 다시 그린다.
  scrollToGap(index) {
    const gap = this.gaps[index];
    if (!gap) return false;
    const windowEnd = this.windowStart + PREVIEW_CHAR_LIMIT;
    if (gap.start < this.windowStart || gap.start >= windowEnd) {
      this.renderNow(this.text, this.candidates, { start: Math.max(0, gap.start - Math.floor(PREVIEW_CHAR_LIMIT / 2)) });
    }
    const target = this.el.querySelector(`.ai-gap-start[data-gap-start="${gap.start}"]`)
      || this.el.querySelector('.ai-gap');
    if (!target) return false;
    this.el.querySelectorAll('.ai-gap-start.current').forEach((m) => m.classList.remove('current'));
    target.classList.add('current');
    const box = this.el.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    // 구간 시작이 화면 위쪽 1/3 지점에 오도록 옮긴다 (아래로 이어지는 본문을 읽기 쉽게)
    this.el.scrollTop += rect.top - box.top - box.height / 3;
    return true;
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
      gaps: this.gaps,
    });
    this.el.scrollTop = top;
    this.el.scrollLeft = left;
    if (this.focusedId) this.#markById(this.focusedId)?.classList.add('focused');
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

  #markById(id) {
    return this.el.querySelector(`mark.pii[data-id="${CSS.escape(id)}"]`);
  }

  focus(id) {
    this.el.querySelectorAll('mark.pii.focused').forEach((m) => m.classList.remove('focused'));
    this.focusedId = id;
    let mark = this.#markById(id);
    if (!mark) {
      const candidate = this.candidates.find((c) => c.id === id);
      if (candidate) {
        const start = Math.max(0, candidate.start - Math.floor(PREVIEW_CHAR_LIMIT / 2));
        this.renderNow(this.text, this.candidates, { start });
        mark = this.#markById(id);
      }
    }
    if (mark) {
      mark.classList.add('focused');
      // scrollIntoView는 페이지까지 함께 움직이므로 본문 영역 안에서만 가운데로 옮긴다
      const box = this.el.getBoundingClientRect();
      const rect = mark.getBoundingClientRect();
      this.el.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
    }
  }

  // 판단이 바뀐 후보 하나만 강조 색을 갱신한다
  refreshMark(candidate) {
    const mark = this.#markById(candidate.id);
    if (!mark) return;
    const focused = mark.classList.contains('focused');
    mark.className = markClass(candidate) + (focused ? ' focused' : '');
    const label = `${candidate.originalText} — ${markTitle(candidate)}`;
    mark.title = markTitle(candidate);
    mark.setAttribute('aria-label', label);
  }

  clear() {
    this.cancel();
    this.el.innerHTML = '';
    this.windowStart = 0;
    this.text = '';
    this.candidates = [];
    this.focusedId = null;
    this.gaps = [];
    this.onWindowChange?.({ start: 0, end: 0, total: 0 });
  }

  shiftWindow(direction) {
    const step = Math.max(1, PREVIEW_CHAR_LIMIT - 2000);
    const maxStart = Math.max(0, this.text.length - PREVIEW_CHAR_LIMIT);
    const start = Math.max(0, Math.min(maxStart, this.windowStart + direction * step));
    this.renderNow(this.text, this.candidates, { start });
  }
}
