// 개인정보 후보 표 — 증분 렌더러 (계획 D-5)
//
// AI 탐지 결과가 청크마다 도착하므로 목록을 통째로 다시 그릴 수 없다.
// 다시 그리면 사용자의 스크롤 위치와 키보드 커서가 매번 사라진다.
// 여기서는 id를 키로 DOM 노드를 재사용하고 변경된 행만 갱신한다.

import { PII_TYPES, ACTION_LABELS, confidenceLabel, CONFIDENCE_LEVELS } from '../detect/types.js';
import { previewReplacement } from '../core/deidentify.js';
import { escapeHtml } from './dom.js';
import { REVIEW_STATES, REVIEW_STATE_LABELS } from '../core/reviewState.js';

const METHOD_LABELS = {
  REGEX: '정규식',
  CONTEXT: '문맥',
  DICTIONARY: '사전',
  FIELD_HEADER: '열 제목',
  USER_RULE: '사용자 규칙',
  MANUAL: '수동 추가',
  SEARCH: '검색 지정',
  AI: 'AI',
};

const CONTEXT_LEAD_CHARS = 14;

// 검토 필요도 — 낮을수록 먼저 보여준다.
// 사람의 시간은 확실한 항목이 아니라 애매한 항목에 써야 한다.
export function riskRank(c) {
  const decidedOffset = c.reviewState === REVIEW_STATES.PENDING ? 0
    : (c.reviewState === REVIEW_STATES.PROCESS ? 10 : 20);
  if (c.aiOnly) return decidedOffset;          // 규칙이 놓친 것 — AI 도입의 이유
  if (c.aiDisputed) return decidedOffset + 1;  // 오탐 의심
  if (c.confidence < CONFIDENCE_LEVELS.MEDIUM) return decidedOffset + 2;
  if (!c.aiConfirmed) return decidedOffset + 3;
  return decidedOffset + 4;                    // 규칙과 AI가 일치 — 가장 안전
}

function comparator(mode) {
  if (mode === 'position') return (a, b) => a.start - b.start;
  if (mode === 'type') {
    const order = Object.keys(PII_TYPES);
    return (a, b) => {
      const d = order.indexOf(a.type) - order.indexOf(b.type);
      return d !== 0 ? d : a.start - b.start;
    };
  }
  return (a, b) => {
    const d = riskRank(a) - riskRank(b);
    if (d !== 0) return d;
    if (a.confidence !== b.confidence) return a.confidence - b.confidence;
    return a.start - b.start;
  };
}

function confClass(conf) {
  if (conf >= CONFIDENCE_LEVELS.HIGH) return 'conf-high';
  if (conf >= CONFIDENCE_LEVELS.MEDIUM) return 'conf-mid';
  return 'conf-low';
}

// 출처 표시 — 우선순위: 오탐 의심 > AI 단독 > 규칙·AI 일치
function sourceOf(c) {
  if (c.aiDisputed) return { cls: 'src-disputed', badge: '오탐 의심', reason: c.aiDisputed.reason };
  if (c.aiOnly) return { cls: 'src-ai', badge: 'AI 발견', reason: c.aiReason };
  if (c.aiConfirmed) return { cls: 'src-confirmed', badge: 'AI 확인', reason: c.aiReason };
  return { cls: '', badge: '', reason: '' };
}

// 값이 말줄임으로 잘리지 않도록 문맥을 값 바로 앞에서 시작한다
function contextHtml(c) {
  const context = (c.context || c.originalText).replace(/\s+/g, ' ').trim();
  const value = c.originalText.replace(/\s+/g, ' ').trim();
  const at = context.indexOf(value);
  if (at < 0) return escapeHtml(context);
  const leadStart = Math.max(0, at - CONTEXT_LEAD_CHARS);
  return `${leadStart > 0 ? '…' : ''}${escapeHtml(context.slice(leadStart, at))}`
    + `<b>${escapeHtml(value)}</b>${escapeHtml(context.slice(at + value.length))}`;
}

const optionsHtml = (entries, selected) => entries
  .map(([code, label]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`)
  .join('');

const TYPE_ENTRIES = Object.entries(PII_TYPES).map(([code, def]) => [code, def.label]);
const ACTION_ENTRIES = Object.entries(ACTION_LABELS);

// 선택한 후보의 상세·수정 영역
export function renderInspectorHtml(c, policies, candidates) {
  if (!c) {
    return '<p class="insp-empty">표에서 후보를 선택하면 유형과 처리방식을 바꿀 수 있습니다.</p>';
  }
  const action = c.action || policies[c.type] || 'REPLACE';
  const src = sourceOf(c);
  const typeLabel = PII_TYPES[c.type]?.label || c.type;
  const sameCount = candidates.filter((o) => o.originalText === c.originalText && o.type === c.type).length;
  const corrected = c.aiReportedType
    ? `<span class="src-badge disputed" title="AI는 ${escapeHtml(PII_TYPES[c.aiReportedType]?.label || c.aiReportedType)}(으)로 보았으나 규칙 검증으로 교정됨">유형 교정</span>`
    : '';
  const badge = src.badge ? `<span class="src-badge ${src.cls.replace('src-', '')}">${src.badge}</span>` : '';
  const reason = src.reason
    ? `<p class="insp-reason" title="${escapeHtml(src.reason)}">${escapeHtml(src.reason)}</p>`
    : '';

  return `
<div class="insp-title">
  <span class="insp-value" title="${escapeHtml(c.originalText)}">${escapeHtml(c.originalText)}</span>
  ${badge}${corrected}
  <span class="insp-facts">
    <span>신뢰도 <span class="${confClass(c.confidence)}">${confidenceLabel(c.confidence)} ${c.confidence.toFixed(2)}</span></span>
    <span>${escapeHtml(METHOD_LABELS[c.detectionMethod] || c.detectionMethod)}</span>
  </span>
</div>
${reason}
<div class="insp-controls">
  <label class="insp-field">유형
    <select class="c-type" aria-label="${escapeHtml(c.originalText)} 개인정보 유형">${optionsHtml(TYPE_ENTRIES, c.type)}</select>
  </label>
  <label class="insp-field">처리방식
    <select class="c-action" aria-label="${escapeHtml(c.originalText)} (${escapeHtml(typeLabel)}) 처리방식">${optionsHtml(ACTION_ENTRIES, action)}</select>
  </label>
  <span class="insp-preview">결과 예시 <code title="${escapeHtml(previewReplacement(c.type, action, c.originalText))}">${escapeHtml(previewReplacement(c.type, action, c.originalText))}</code></span>
  ${sameCount > 1 ? `
  <span class="insp-same" role="group" aria-label="같은 값 ${sameCount}건 일괄 판단">같은 값 ${sameCount}건
    <button class="btn tiny c-same" data-state="${REVIEW_STATES.PROCESS}">모두 처리</button>
    <button class="btn tiny c-same" data-state="${REVIEW_STATES.EXCLUDE}">모두 제외</button>
  </span>` : ''}
</div>`;
}

export class CandidateListView {
  constructor(root) {
    this.root = root;
    this.nodes = new Map();   // id → 행 엘리먼트
    this.order = [];          // 현재 DOM 순서의 id 배열
    this.sortMode = 'risk';
    this.filter = { type: null, status: 'all' };
    this.policies = {};
    this.cursorId = null;
  }

  setPolicies(policies) { this.policies = policies; }

  setSort(mode) {
    this.sortMode = mode;
    this.needsResort = true;
  }

  setFilter(filter) {
    this.filter = { type: null, status: 'all', ...filter };
  }

  isVisible(c) {
    const { type, status } = this.filter;
    if (type && c.type !== type) return false;
    if (status === 'pending' && c.reviewState !== REVIEW_STATES.PENDING) return false;
    if (status === 'ai' && !c.aiOnly) return false;
    if (status === 'disputed' && !c.aiDisputed) return false;
    if (status === 'exclude' && c.reviewState !== REVIEW_STATES.EXCLUDE) return false;
    if (status === 'manual' && !['MANUAL', 'SEARCH'].includes(c.detectionMethod)) return false;
    return true;
  }

  // 후보 배열을 DOM에 반영한다.
  // resort=false(기본)이면 기존 행은 자리를 지키고 새 항목만 정렬 위치에 끼워 넣는다.
  sync(candidates, { resort = false } = {}) {
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const cmp = comparator(this.sortMode);

    // 1) 사라진 항목 제거
    for (const id of [...this.order]) {
      if (byId.has(id)) continue;
      this.nodes.get(id)?.remove();
      this.nodes.delete(id);
      this.order = this.order.filter((x) => x !== id);
    }

    // 2) 신규 항목 생성 후 정렬 위치에 삽입
    for (const c of candidates) {
      if (this.nodes.has(c.id)) continue;
      const el = document.createElement('div');
      el.className = 'cand';
      el.dataset.id = c.id;
      el.setAttribute('role', 'row');
      el.tabIndex = -1;
      this.nodes.set(c.id, el);

      // 현재 순서에서 자기 자리를 찾아 끼워 넣는다 (기존 행은 움직이지 않는다)
      let at = this.order.length;
      for (let i = 0; i < this.order.length; i++) {
        const other = byId.get(this.order[i]);
        if (other && cmp(c, other) < 0) { at = i; break; }
      }
      const refId = this.order[at];
      this.root.insertBefore(el, refId ? this.nodes.get(refId) : null);
      this.order.splice(at, 0, c.id);
      el.dataset.fresh = '1';
    }

    // 3) 전체 재정렬 (정렬 기준 변경 시에만)
    if (resort || this.needsResort) {
      this.needsResort = false;
      this.order = candidates.slice().sort(cmp).map((c) => c.id);
      for (const id of this.order) this.root.appendChild(this.nodes.get(id));
    }

    // 4) 행 내용 갱신 + 필터 적용
    let visibleCount = 0;
    for (const id of this.order) {
      const c = byId.get(id);
      const el = this.nodes.get(id);
      const visible = this.isVisible(c);
      el.hidden = !visible;
      if (visible) visibleCount += 1;
      this.updateCard(el, c);
    }

    this.renderEmptyState(candidates.length, visibleCount);
    return visibleCount;
  }

  // 실제로 바뀐 행만 다시 그린다 (AI 결과가 도착할 때마다 전체를 건드리지 않도록)
  updateCard(el, c) {
    const src = sourceOf(c);
    const sig = [
      c.selected, c.reviewState, c.type, c.originalText, c.context,
      src.cls, c.id === this.cursorId,
    ].join('\u0001');

    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;

    const reviewState = c.reviewState || (c.selected ? REVIEW_STATES.PROCESS : REVIEW_STATES.EXCLUDE);
    el.className = `cand ${src.cls} state-${reviewState.toLowerCase()}${reviewState === REVIEW_STATES.EXCLUDE ? ' excluded' : ''}${c.id === this.cursorId ? ' cursor' : ''}`;

    // 표에서는 판단에 영향을 주는 출처만 보인다. "AI 확인"은 상세 영역에 둔다.
    const badgeHtml = src.badge && src.cls !== 'src-confirmed'
      ? `<span class="src-badge ${src.cls.replace('src-', '')}">${src.badge}</span>`
      : '';
    const typeLabel = PII_TYPES[c.type]?.label || c.type;
    // 판단 버튼은 화면 없이도 어떤 항목의 것인지 알 수 있어야 한다
    const forWhat = `${c.originalText} (${typeLabel})`;

    el.innerHTML = `
<span role="cell"><span class="cand-state"><i aria-hidden="true"></i>${REVIEW_STATE_LABELS[reviewState]}</span></span>
<span role="cell" class="cand-value-cell"><span class="cand-value" title="${escapeHtml(c.originalText)}">${escapeHtml(c.originalText)}</span>${badgeHtml}</span>
<span role="cell" class="type-label" title="${escapeHtml(typeLabel)}">${escapeHtml(typeLabel)}</span>
<span role="cell" class="cand-context">${contextHtml(c)}</span>
<span role="cell"><span class="cand-decisions" role="group" aria-label="${escapeHtml(forWhat)} 검토 결정">
  <button class="c-decision process" data-state="${REVIEW_STATES.PROCESS}" aria-pressed="${reviewState === REVIEW_STATES.PROCESS}">처리</button>
  <button class="c-decision exclude" data-state="${REVIEW_STATES.EXCLUDE}" aria-pressed="${reviewState === REVIEW_STATES.EXCLUDE}">제외</button>
</span></span>`;
  }

  renderEmptyState(total, visible) {
    let el = this.root.querySelector('.empty-state');
    const message = total === 0
      ? '탐지된 개인정보 후보가 없습니다.<br />문서 본문을 드래그하여 직접 추가할 수 있습니다.'
      : (visible === 0 ? '이 필터에 해당하는 후보가 없습니다.' : null);

    if (!message) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'empty-state';
      el.setAttribute('role', 'row');
      this.root.appendChild(el);
    }
    el.innerHTML = `<span role="cell">${message}</span>`;
    this.root.appendChild(el); // 항상 마지막에 둔다
  }

  // 키보드 커서 이동 (J/K)
  moveCursor(delta, candidates) {
    const visible = this.order.filter((id) => !this.nodes.get(id).hidden);
    if (visible.length === 0) return null;
    const at = visible.indexOf(this.cursorId);
    const next = at < 0
      ? (delta > 0 ? 0 : visible.length - 1)
      : Math.max(0, Math.min(visible.length - 1, at + delta));
    return this.setCursor(visible[next], candidates);
  }

  // 판단 직후 이동할 다음 미확인 후보 (현재 위치 뒤쪽 우선)
  nextPendingId(fromId, candidates) {
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const at = this.order.indexOf(fromId);
    const rotated = at < 0 ? this.order : [...this.order.slice(at + 1), ...this.order.slice(0, at)];
    return rotated.find((id) => {
      const c = byId.get(id);
      return c && c.reviewState === REVIEW_STATES.PENDING && this.isVisible(c);
    }) ?? null;
  }

  firstVisibleId() {
    return this.order.find((id) => !this.nodes.get(id).hidden) ?? null;
  }

  setCursor(id, candidates) {
    const prev = this.cursorId;
    this.cursorId = id;
    for (const pid of [prev, id]) {
      if (!pid) continue;
      const el = this.nodes.get(pid);
      const c = candidates.find((x) => x.id === pid);
      if (el && c) { el.dataset.sig = ''; this.updateCard(el, c); }
    }
    this.#scrollRowIntoView(this.nodes.get(id));
    return id;
  }

  // scrollIntoView는 페이지까지 함께 움직이므로 표 안에서만 스크롤한다
  #scrollRowIntoView(el) {
    const box = this.root.closest('.grid-scroll');
    if (!box || !el || el.hidden) return;
    const headHeight = box.querySelector('.cand-header')?.offsetHeight || 0;
    const boxRect = box.getBoundingClientRect();
    const rowRect = el.getBoundingClientRect();
    if (rowRect.top < boxRect.top + headHeight) box.scrollTop -= boxRect.top + headHeight - rowRect.top;
    else if (rowRect.bottom > boxRect.bottom) box.scrollTop += rowRect.bottom - boxRect.bottom;
  }

  clear() {
    this.root.innerHTML = '';
    this.nodes.clear();
    this.order = [];
    this.cursorId = null;
  }
}
