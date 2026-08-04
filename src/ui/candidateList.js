// 개인정보 후보 목록 — 증분 렌더러 (계획 D-5)
//
// AI 탐지 결과가 청크마다 도착하므로 목록을 통째로 다시 그릴 수 없다.
// 다시 그리면 사용자의 스크롤 위치, 펼침 상태, 키보드 커서가 매번 사라진다.
// 여기서는 id를 키로 DOM 노드를 재사용하고 변경된 카드만 갱신한다.

import { PII_TYPES, ACTION_LABELS, confidenceLabel, CONFIDENCE_LEVELS } from '../detect/types.js';
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
  if (c.aiDisputed) return { cls: 'src-disputed', badge: 'AI 오탐 의심', reason: c.aiDisputed.reason };
  if (c.aiOnly) return { cls: 'src-ai', badge: 'AI 발견', reason: c.aiReason };
  if (c.aiConfirmed) return { cls: 'src-confirmed', badge: 'AI 확인', reason: c.aiReason };
  return { cls: '', badge: '', reason: '' };
}

const optionsHtml = (entries, selected) => entries
  .map(([code, label]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`)
  .join('');

const TYPE_ENTRIES = Object.entries(PII_TYPES).map(([code, def]) => [code, def.label]);
const ACTION_ENTRIES = Object.entries(ACTION_LABELS);

export class CandidateListView {
  constructor(root) {
    this.root = root;
    this.nodes = new Map();   // id → 카드 엘리먼트
    this.order = [];          // 현재 DOM 순서의 id 배열
    this.sortMode = 'risk';
    this.filter = { type: null, status: 'all' };
    this.policies = {};
    this.cursorId = null;
    this.expanded = new Set();
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
  // resort=false(기본)이면 기존 카드는 자리를 지키고 새 항목만 정렬 위치에 끼워 넣는다.
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
      const el = document.createElement('article');
      el.className = 'cand';
      el.dataset.id = c.id;
      el.setAttribute('role', 'listitem');
      el.tabIndex = -1;
      this.nodes.set(c.id, el);

      // 현재 순서에서 자기 자리를 찾아 끼워 넣는다 (기존 카드는 움직이지 않는다)
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

    // 4) 카드 내용 갱신 + 필터 적용
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

  // 실제로 바뀐 카드만 다시 그린다 (AI 결과가 도착할 때마다 전체를 건드리지 않도록)
  updateCard(el, c) {
    const action = c.action || this.policies[c.type] || 'REPLACE';
    const src = sourceOf(c);
    const isOpen = this.expanded.has(c.id);
    const sig = [
      c.selected, c.reviewState, c.type, action, c.originalText, c.context, c.confidence,
      src.cls, src.reason, isOpen, c.id === this.cursorId, c.aiReportedType,
    ].join('');

    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;

    const reviewState = c.reviewState || (c.selected ? REVIEW_STATES.PROCESS : REVIEW_STATES.EXCLUDE);
    el.className = `cand ${src.cls} state-${reviewState.toLowerCase()}${reviewState === REVIEW_STATES.EXCLUDE ? ' excluded' : ''}${c.id === this.cursorId ? ' cursor' : ''}`;

    const reasonHtml = src.reason
      ? `<span class="cand-reason" title="${escapeHtml(src.reason)}">${escapeHtml(src.reason)}</span>`
      : '';
    const badgeHtml = src.badge
      ? `<span class="src-badge ${src.cls.replace('src-', '')}">${src.badge}</span>`
      : '';
    // 유형 재판정으로 AI 판단이 교정된 경우 감사 가능하도록 남긴다
    const fixedHtml = c.aiReportedType
      ? `<span class="type-badge" title="AI는 ${escapeHtml(PII_TYPES[c.aiReportedType]?.label || c.aiReportedType)}(으)로 보았으나 규칙 검증으로 교정됨">유형 교정</span>`
      : '';

    const typeLabel = PII_TYPES[c.type]?.label || c.type;
    // 상태 버튼·처리방식 선택은 화면 없이도 어떤 항목의 것인지 알 수 있어야 한다
    const forWhat = `${c.originalText} (${typeLabel})`;
    const context = c.context || c.originalText;
    const reviewLabel = REVIEW_STATE_LABELS[reviewState];

    el.innerHTML = `
<div class="cand-main">
  <div class="cand-line">
    <span class="cand-value" title="${escapeHtml(c.originalText)}">${escapeHtml(c.originalText)}</span>
    <span class="type-badge">${escapeHtml(typeLabel)}</span>
    ${fixedHtml}
  </div>
  <div class="cand-line cand-meta">${badgeHtml}${reasonHtml}</div>
</div>
<div class="cand-decisions" role="group" aria-label="${escapeHtml(forWhat)} 검토 결정">
  <button class="c-decision process" data-state="${REVIEW_STATES.PROCESS}" aria-pressed="${reviewState === REVIEW_STATES.PROCESS}"><span class="decision-icon" aria-hidden="true">✓</span>처리</button>
  <button class="c-decision exclude" data-state="${REVIEW_STATES.EXCLUDE}" aria-pressed="${reviewState === REVIEW_STATES.EXCLUDE}"><span class="decision-icon" aria-hidden="true">—</span>제외</button>
</div>
<button class="cand-toggle" aria-expanded="${isOpen}"
        aria-label="${escapeHtml(forWhat)} 상세 ${isOpen ? '접기' : '펼치기'}">${isOpen ? '▴' : '▾'}</button>
<p class="cand-context">“${escapeHtml(context)}”</p>
<p class="cand-policy">${escapeHtml(typeLabel)} · ${reviewLabel} · 적용 방식: <strong>${escapeHtml(ACTION_LABELS[action])}</strong></p>
${isOpen ? `
<div class="cand-detail">
  <label class="inline-field">유형
    <select class="c-type" aria-label="개인정보 유형">${optionsHtml(TYPE_ENTRIES, c.type)}</select>
  </label>
  <label class="inline-field">처리방식
    <select class="c-action" aria-label="${escapeHtml(forWhat)} 처리방식">${optionsHtml(ACTION_ENTRIES, action)}</select>
  </label>
  <span class="${confClass(c.confidence)}">${confidenceLabel(c.confidence)} ${c.confidence.toFixed(2)}</span>
  <span>${METHOD_LABELS[c.detectionMethod] || c.detectionMethod}</span>
  <button class="btn tiny c-same">동일값 일괄</button>
</div>` : ''}`;
  }

  renderEmptyState(total, visible) {
    let el = this.root.querySelector('.empty-state');
    const message = total === 0
      ? '탐지된 개인정보 후보가 없습니다.<br />미리보기에서 문자열을 드래그하여 직접 추가할 수 있습니다.'
      : (visible === 0 ? '이 필터에 해당하는 후보가 없습니다.' : null);

    if (!message) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('p');
      el.className = 'empty-state';
      this.root.appendChild(el);
    }
    el.innerHTML = message;
    this.root.appendChild(el); // 항상 마지막에 둔다
  }

  toggleExpanded(id) {
    if (this.expanded.has(id)) this.expanded.delete(id);
    else this.expanded.add(id);
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

  setCursor(id, candidates) {
    const prev = this.cursorId;
    this.cursorId = id;
    for (const pid of [prev, id]) {
      if (!pid) continue;
      const el = this.nodes.get(pid);
      const c = candidates.find((x) => x.id === pid);
      if (el && c) { el.dataset.sig = ''; this.updateCard(el, c); }
    }
    this.nodes.get(id)?.scrollIntoView({ block: 'nearest' });
    return id;
  }

  clear() {
    this.root.innerHTML = '';
    this.nodes.clear();
    this.order = [];
    this.cursorId = null;
    this.expanded.clear();
  }
}
