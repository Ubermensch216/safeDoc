// 검토 화면 제어 — 필터·일괄 처리·수동 추가·되돌리기·키보드 단축키

import { PII_TYPES, ACTION_LABELS, CONFIDENCE_LEVELS } from '../detect/types.js';
import { REVIEW_STATES, reviewCounts, setReviewState } from '../core/reviewState.js';
import { $, $$, toast, showScreen, textOffsetIn, renderedOffsetToSource } from './dom.js';
import { CandidateListView, renderInspectorHtml } from './candidateList.js';
import { PreviewHighlighter, PREVIEW_CHAR_LIMIT } from './highlight.js';

const PREVIEW_SCROLL_KEYS = new Set([
  'arrowdown', 'arrowup', 'pageup', 'pagedown', 'home', 'end', ' ',
]);

const POPOVER_GAP = 6;
const POPOVER_EDGE = 8;

// AI 탐지(3단계) 중에는 후보를 바꾸는 조작을 막는다. 보기·이동·필터·정렬은 허용한다.
// 정적 조작 영역은 inert로, 표·상세 패널처럼 다시 그려지는 영역은 이벤트 가로채기로 막는다.
const READ_ONLY_INERT_SELECTORS = [
  '.doc-tools',
  '#btn-undo',
  '#btn-to-confirm',
  '#selection-popover',
  '#bulk-action',
  '#filter-actions [data-bulk="process"]',
  '#filter-actions [data-bulk="exclude"]',
];
const READ_ONLY_BLOCKED_CONTROLS = '.c-decision, .c-same, .c-type, .c-action';
const READ_ONLY_NAV_KEYS = new Set(['j', 'k', 'arrowdown', 'arrowup']);

export class ReviewController {
  #inspectorHtml = '';

  constructor({ session, onOpenConfirm, onCancelAnalyze, onCancelAi }) {
    this.session = session;
    this.onOpenConfirm = onOpenConfirm;
    this.onCancelAnalyze = onCancelAnalyze;
    this.onCancelAi = onCancelAi;

    this.activeFilter = { type: null, status: 'all' };
    this.manualSeq = 0;
    this.readOnly = false;

    this.listView = new CandidateListView($('#candidate-list'));
    this.highlighter = new PreviewHighlighter($('#preview'), {
      onWindowChange: (info) => this.#updatePreviewWindowUi(info),
    });
  }

  bind() {
    this.#bindPreviewEvents();
    this.#bindCandidateListEvents();
    this.#bindInspectorEvents();
    this.#bindFilterEvents();
    this.#bindManualAddEvents();
    this.#bindActionButtons();
    this.#bindKeyboard();
    this.#bindReadOnlyGuard();
  }

  // 읽기 전용 전환 (AI 탐지 중 true, 끝나면 false)
  setReadOnly(on) {
    this.readOnly = on;
    for (const el of $$(READ_ONLY_INERT_SELECTORS.join(','))) el.inert = on;
    $('#screen-review').toggleAttribute('data-readonly', on);
    if (on) {
      $('#selection-popover').hidden = true;
      window.getSelection()?.removeAllRanges();
    }
  }

  #bindReadOnlyGuard() {
    const block = (e) => {
      if (!this.readOnly) return;
      if (e.type === 'keydown' && e.key === 'Tab') return;
      if (!e.target.closest?.(READ_ONLY_BLOCKED_CONTROLS)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const screen = $('#screen-review');
    for (const type of ['click', 'mousedown', 'keydown', 'change']) {
      screen.addEventListener(type, block, true);
    }
  }

  setPolicies(policies) {
    this.listView.setPolicies(policies);
  }

  renderPreviewNow(text, candidates) {
    this.highlighter.renderNow(text, candidates);
  }

  schedulePreview(text, candidates) {
    this.highlighter.schedule(text, candidates);
  }

  sync({ resort = false } = {}) {
    const candidates = this.session.candidates;
    this.listView.setPolicies(this.session.typePolicies);
    this.listView.setFilter(this.activeFilter);

    // 필터나 되돌리기로 사라진 행에 커서가 남지 않게 한다
    if (this.listView.cursorId) {
      const current = this.#findCandidate(this.listView.cursorId);
      if (!current || !this.listView.isVisible(current)) this.listView.cursorId = null;
    }
    const visible = this.listView.sync(candidates, { resort });

    const counts = reviewCounts(candidates);
    const reviewed = counts.process + counts.exclude;

    $('#review-done-count').textContent = reviewed.toLocaleString();
    $('#review-total-count').textContent = `/ ${counts.total.toLocaleString()}건 검토`;
    $('#review-meter-fill').style.width = `${counts.total ? (reviewed / counts.total) * 100 : 100}%`;

    const aiCount = candidates.filter((c) => c.aiOnly).length;
    const disputedCount = candidates.filter((c) => c.aiDisputed).length;
    const manualCount = candidates.filter((c) => ['MANUAL', 'SEARCH'].includes(c.detectionMethod)).length;

    $('#filter-count-all').textContent = counts.total;
    $('#filter-count-pending').textContent = counts.pending;
    $('#filter-count-pending').classList.toggle('has-items', counts.pending > 0);
    $('#filter-count-ai').textContent = aiCount;
    $('#filter-count-disputed').textContent = disputedCount;
    $('#filter-count-exclude').textContent = counts.exclude;
    $('#filter-count-manual').textContent = manualCount;
    $('#review-footer-summary').innerHTML =
      `처리 <strong>${counts.process.toLocaleString()}</strong> · 제외 <strong>${counts.exclude.toLocaleString()}</strong> · 미확인 <strong>${counts.pending.toLocaleString()}</strong>`;

    // 비활성 버튼은 이유를 말해 주지 못한다. 지금 해야 할 일을 버튼이 직접 안내한다.
    $('#btn-to-confirm').textContent = counts.pending > 0
      ? `미확인 ${counts.pending.toLocaleString()}건 확인하기`
      : '처리 확인으로 이동 →';

    const filtered = Boolean(this.activeFilter.type || this.activeFilter.status !== 'all');
    $('#btn-clear-filter').hidden = !filtered;
    $('#filter-label').textContent = `표시 ${visible.toLocaleString()}건`;
    $$('#filter-actions [data-bulk="process"], #filter-actions [data-bulk="exclude"], #bulk-action')
      .forEach((control) => { control.disabled = visible === 0; });

    this.#updateReviewGap();
    this.#renderInspector();
  }

  // 분석 직후 첫 후보를 선택해 바로 키보드로 검토할 수 있게 한다
  selectFirst() {
    const id = this.listView.firstVisibleId();
    if (id) this.#selectCandidate(id);
  }

  reset() {
    this.listView.clear();
    this.highlighter.clear();
    this.activeFilter = { type: null, status: 'all' };
    this.manualSeq = 0;
    $('#type-filter').value = '';
    this.#syncStatusFilterButtons('all');
    $('#btn-clear-filter').hidden = true;
    $('#selection-popover').hidden = true;
    $('#search-input').value = '';
    this.#inspectorHtml = '';
    $('#cand-inspector').innerHTML = '';
    this.setAiGaps([]);
  }

  // AI가 검사하지 못한 범위를 문서 위에 표시하고, 차례로 찾아가는 안내 줄을 보여 준다.
  setAiGaps(ranges) {
    this.aiGaps = Array.isArray(ranges) ? ranges : [];
    this.aiGapIndex = -1;
    this.highlighter.setGaps(this.aiGaps);
    const count = this.aiGaps.length;
    const chars = this.aiGaps.reduce((sum, r) => sum + (r.end - r.start), 0);
    $('#ai-gap-bar').hidden = count === 0;
    $('#legend-ai-gap').hidden = count === 0;
    $('#ai-gap-text').textContent = count
      ? `AI가 검사하지 못한 구간 ${count}곳(약 ${chars.toLocaleString()}자)`
      : '';
    $('#btn-next-gap').textContent = count > 1 ? `다음 미검사 구간 (0/${count})` : '미검사 구간으로 이동';
  }

  #goToNextGap() {
    const count = this.aiGaps?.length || 0;
    if (count === 0) return;
    this.aiGapIndex = (this.aiGapIndex + 1) % count;
    this.highlighter.scrollToGap(this.aiGapIndex);
    if (count > 1) $('#btn-next-gap').textContent = `다음 미검사 구간 (${this.aiGapIndex + 1}/${count})`;
  }

  #findCandidate(id) {
    return this.session.candidates.find((c) => c.id === id);
  }

  #selectCandidate(id) {
    this.listView.setCursor(id, this.session.candidates);
    this.highlighter.focus(id);
    this.#renderInspector();
  }

  #renderInspector() {
    const current = this.listView.cursorId ? this.#findCandidate(this.listView.cursorId) : null;
    const html = renderInspectorHtml(current, this.session.typePolicies, this.session.candidates);
    // AI 결과가 도착해도 열려 있는 선택상자가 닫히지 않도록 내용이 바뀔 때만 다시 그린다
    if (html === this.#inspectorHtml) return;
    this.#inspectorHtml = html;

    const box = $('#cand-inspector');
    const active = box.contains(document.activeElement) ? document.activeElement : null;
    const refocus = ['c-type', 'c-action'].find((name) => active?.classList.contains(name));
    box.innerHTML = html;
    if (refocus) box.querySelector(`.${refocus}`)?.focus();
  }

  #pushHistory() {
    // 되돌리기용 스냅샷 (FR-409) — 메모리에서만 유지
    this.session.history.push(JSON.stringify({
      candidates: this.session.candidates,
      manuallyAddedCount: this.session.manuallyAddedCount,
      manualSeq: this.manualSeq,
    }));
    if (this.session.history.length > 50) this.session.history.shift();
  }

  #undo() {
    const snapshot = this.session.history.pop();
    if (!snapshot) {
      toast('되돌릴 작업이 없습니다.', true);
      return;
    }
    const state = JSON.parse(snapshot);
    // 진행 중인 AI 탐지가 같은 배열에 후보를 추가하므로 배열 자체는 유지한다
    this.session.candidates.splice(0, this.session.candidates.length, ...state.candidates);
    this.session.manuallyAddedCount = state.manuallyAddedCount;
    this.manualSeq = state.manualSeq;
    this.sync({ resort: true });
    this.highlighter.renderNow(this.session.parsed.text, this.session.candidates);
  }

  // 판단 후 표와 문서 강조를 함께 갱신한다
  #decide(candidate, state, { advance }) {
    this.#pushHistory();
    setReviewState(candidate, state);
    const nextId = this.listView.nextPendingId(candidate.id, this.session.candidates);
    const staysVisible = this.listView.isVisible(candidate);
    this.sync();
    this.highlighter.refreshMark(candidate);

    if (advance && nextId) this.#selectCandidate(nextId);
    else if (staysVisible) this.#selectCandidate(candidate.id);
    else if (nextId) this.#selectCandidate(nextId);
    else this.selectFirst();
  }

  #applyToMany(targets, mutate) {
    this.#pushHistory();
    for (const c of targets) mutate(c);
    this.sync();
    this.highlighter.renderNow(this.session.parsed.text, this.session.candidates);
  }

  #setStatusFilter(status) {
    this.activeFilter.status = status;
    this.#syncStatusFilterButtons(status);
    this.sync();
    if (!this.listView.cursorId) this.selectFirst();
  }

  #syncStatusFilterButtons(activeStatus) {
    $$('.status-filter').forEach((item) => {
      const active = item.dataset.status === activeStatus;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }

  #updateReviewGap() {
    const box = $('#review-gap');
    const candidates = this.session.candidates;
    const disputed = candidates.filter((c) => c.aiDisputed && !c.userModified).length;
    const lowConf = candidates.filter((c) => c.confidence < CONFIDENCE_LEVELS.MEDIUM && !c.userModified).length;

    const parts = [];
    if (disputed > 0) parts.push(`오탐 의심 ${disputed}건`);
    if (lowConf > 0) parts.push(`신뢰도 낮음 ${lowConf}건`);

    box.hidden = parts.length === 0;
    box.textContent = parts.length ? `주의 필요: ${parts.join(' · ')}` : '';
  }

  #updatePreviewWindowUi({ start, end, total }) {
    const paged = total > PREVIEW_CHAR_LIMIT;
    const info = $('#preview-window-info');
    const prev = $('#btn-preview-prev');
    const next = $('#btn-preview-next');
    info.hidden = !paged;
    prev.hidden = !paged;
    next.hidden = !paged;
    if (!paged) return;
    info.textContent = `${(start + 1).toLocaleString()}~${end.toLocaleString()} / ${total.toLocaleString()}자`;
    prev.disabled = start === 0;
    next.disabled = end >= total;
  }

  #bindPreviewEvents() {
    $('#btn-preview-prev').addEventListener('click', () => this.highlighter.shiftWindow(-1));
    $('#btn-preview-next').addEventListener('click', () => this.highlighter.shiftWindow(1));
    $('#btn-next-gap').addEventListener('click', () => this.#goToNextGap());

    const preview = $('#preview');
    const popover = $('#selection-popover');

    preview.addEventListener('click', (e) => {
      // 드래그로 문자열을 고르는 중이면 후보 이동으로 해석하지 않는다
      if (!window.getSelection()?.isCollapsed) return;
      const mark = e.target.closest('mark.pii');
      if (mark) this.#selectCandidate(mark.dataset.id);
    });
    // 강조는 role="button"이므로 Enter·Space로도 동작해야 한다
    preview.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const mark = e.target.closest?.('mark.pii');
      if (!mark) return;
      e.preventDefault();
      this.#selectCandidate(mark.dataset.id);
    });

    const updateSelectionPopover = () => {
      if (this.readOnly) { popover.hidden = true; return; }
      const selection = window.getSelection();
      const valid = selection && !selection.isCollapsed && selection.rangeCount > 0
        && preview.contains(selection.anchorNode) && preview.contains(selection.focusNode);
      popover.hidden = !valid;
      if (valid) this.#positionPopover(selection.getRangeAt(0));
    };
    preview.addEventListener('mouseup', updateSelectionPopover);
    preview.addEventListener('keyup', updateSelectionPopover);
    preview.addEventListener('scroll', () => { popover.hidden = true; });
    // 버튼을 눌러도 문서의 선택 영역이 풀리지 않게 한다
    $('#btn-add-selection').addEventListener('mousedown', (e) => e.preventDefault());
    document.addEventListener('selectionchange', () => {
      if (popover.contains(document.activeElement)) return;
      if (window.getSelection()?.isCollapsed) popover.hidden = true;
    });
  }

  #positionPopover(range) {
    const popover = $('#selection-popover');
    const wrap = popover.parentElement.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = popover;

    const centered = rect.left - wrap.left + rect.width / 2 - width / 2;
    const left = Math.max(POPOVER_EDGE, Math.min(wrap.width - width - POPOVER_EDGE, centered));
    let top = rect.bottom - wrap.top + POPOVER_GAP;
    if (top + height > wrap.height - POPOVER_EDGE) top = rect.top - wrap.top - height - POPOVER_GAP;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(POPOVER_EDGE, top)}px`;
  }

  #bindCandidateListEvents() {
    $('#candidate-list').addEventListener('click', (e) => {
      const item = e.target.closest('.cand');
      if (!item) return;
      const c = this.#findCandidate(item.dataset.id);
      if (!c) return;

      const decision = e.target.closest('.c-decision');
      if (decision) {
        const { state } = decision.dataset;
        const byKeyboard = e.detail === 0;
        this.#decide(c, state, { advance: false });
        // 키보드로 누른 경우 다시 그려진 같은 버튼으로 포커스를 돌려준다
        if (byKeyboard) {
          this.listView.nodes.get(c.id)?.querySelector(`.c-decision[data-state="${state}"]`)?.focus();
        }
        return;
      }
      this.#selectCandidate(c.id);
    });
  }

  #bindInspectorEvents() {
    const box = $('#cand-inspector');

    box.addEventListener('click', (e) => {
      const button = e.target.closest('.c-same');
      if (!button) return;
      const c = this.#findCandidate(this.listView.cursorId);
      if (!c) return;
      // 동일값 일괄 (FR-406)
      const targetState = button.dataset.state;
      const targets = this.session.candidates.filter((o) => o.originalText === c.originalText && o.type === c.type);
      this.#applyToMany(targets, (other) => {
        setReviewState(other, targetState);
        other.action = c.action;
      });
      toast(`같은 값 ${targets.length}건을 ${targetState === REVIEW_STATES.PROCESS ? '처리 대상으로 지정' : '제외'}했습니다.`);
    });

    box.addEventListener('change', (e) => {
      const c = this.#findCandidate(this.listView.cursorId);
      if (!c) return;
      if (e.target.classList.contains('c-type')) {
        // 유형 변경 (FR-405)
        this.#pushHistory();
        c.type = e.target.value;
        c.action = null;
        c.userModified = true;
        this.sync();
      } else if (e.target.classList.contains('c-action')) {
        // 개별 처리방식 (FR-407)
        this.#pushHistory();
        c.action = e.target.value;
        c.userModified = true;
        this.sync();
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.activeElement?.blur();
    });
  }

  #bindFilterEvents() {
    $('#status-filters').addEventListener('click', (e) => {
      const button = e.target.closest('.status-filter');
      if (button) this.#setStatusFilter(button.dataset.status);
    });

    $('#type-filter').addEventListener('change', (e) => {
      this.activeFilter.type = e.target.value || null;
      this.sync();
      if (!this.listView.cursorId) this.selectFirst();
    });

    // 표시된 항목 일괄 처리 (FR-406)
    $('#filter-actions').addEventListener('click', (e) => {
      const button = e.target.closest('[data-bulk]');
      if (!button) return;
      const action = button.dataset.bulk;
      if (action === 'clear') {
        this.activeFilter.type = null;
        $('#type-filter').value = '';
        this.#setStatusFilter('all');
        return;
      }
      const targets = this.session.candidates.filter((c) => this.listView.isVisible(c));
      const targetState = action === 'process' ? REVIEW_STATES.PROCESS : REVIEW_STATES.EXCLUDE;
      // 제외는 결과 문서에 개인정보 원문을 남기는 판단이므로 한 번 더 확인한다
      if (action === 'exclude' && !window.confirm(
        `표시된 ${targets.length}건을 모두 제외합니다.\n제외한 항목은 결과 문서에 원문 그대로 남습니다.\n\n계속하시겠습니까?`,
      )) return;
      this.#applyToMany(targets, (c) => setReviewState(c, targetState));
      if (!this.listView.cursorId) this.selectFirst();
      toast(`${targets.length}건을 ${action === 'process' ? '처리 대상으로 지정' : '제외'}했습니다.`);
    });

    $('#bulk-action').addEventListener('change', (e) => {
      const { value } = e.target;
      e.target.value = '';
      if (!value) return;
      const targets = this.session.candidates.filter((c) => this.listView.isVisible(c));
      this.#applyToMany(targets, (c) => {
        c.action = value;
        c.userModified = true;
      });
      toast(`${targets.length}건의 처리방식을 ${ACTION_LABELS[value]}(으)로 변경했습니다.`);
    });

    $('#sort-mode').addEventListener('change', (e) => {
      this.listView.setSort(e.target.value);
      this.sync({ resort: true });
    });
  }

  #bindManualAddEvents() {
    // 검색 일괄 지정 (FR-408)
    const addBySearch = () => {
      const term = $('#search-input').value;
      if (!term) {
        toast('찾을 문자열을 입력하십시오.', true);
        return;
      }
      this.#pushHistory();
      const added = this.#addCandidatesByText(term, $('#search-type').value, 'SEARCH');
      this.sync();
      this.highlighter.renderNow(this.session.parsed.text, this.session.candidates);
      toast(added > 0 ? `"${term}" ${added}건을 개인정보로 지정했습니다.` : '이미 지정되었거나 문서에 없는 문자열입니다.', added === 0);
      if (added > 0) $('#search-input').value = '';
    };
    $('#btn-search-add').addEventListener('click', addBySearch);
    $('#search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addBySearch(); }
    });

    // 선택 영역 수동 추가 (FR-404)
    $('#btn-add-selection').addEventListener('click', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        toast('문서에서 추가할 문자열을 먼저 드래그하십시오.', true);
        return;
      }
      const preview = $('#preview');
      if (!preview.contains(sel.anchorNode) || !preview.contains(sel.focusNode)) {
        toast('문서 본문 안의 문자열만 추가할 수 있습니다.', true);
        return;
      }
      let start = textOffsetIn(preview, sel.anchorNode, sel.anchorOffset);
      let end = textOffsetIn(preview, sel.focusNode, sel.focusOffset);
      if (start < 0 || end < 0) return;
      if (start > end) [start, end] = [end, start];
      if (start === end) return;
      start = renderedOffsetToSource(this.session.parsed.text, this.highlighter.windowStart, start);
      end = renderedOffsetToSource(this.session.parsed.text, this.highlighter.windowStart, end);

      this.#pushHistory();
      const ok = this.#addManualCandidate(start, end, $('#add-type').value);
      sel.removeAllRanges();
      this.sync();
      this.highlighter.renderNow(this.session.parsed.text, this.session.candidates);
      toast(ok ? '개인정보로 추가했습니다.' : '기존 후보와 겹치는 영역입니다.', !ok);
      $('#selection-popover').hidden = true;
    });
  }

  #bindActionButtons() {
    $('#btn-undo').addEventListener('click', () => this.#undo());
    $('#btn-to-confirm').addEventListener('click', () => {
      const counts = reviewCounts(this.session.candidates);
      if (counts.pending > 0) {
        this.activeFilter.type = null;
        $('#type-filter').value = '';
        this.#setStatusFilter('pending');
        this.selectFirst();
        toast(`미확인 후보 ${counts.pending}건을 먼저 판단해 주십시오.`, true);
        return;
      }
      this.onOpenConfirm();
    });
    $('#btn-back-review').addEventListener('click', () => showScreen('screen-review'));
    $('#btn-cancel-analyze').addEventListener('click', () => this.onCancelAnalyze());
    $('#btn-cancel-ai').addEventListener('click', () => this.onCancelAi());
  }

  // 키보드 검토 (계획 D-2)
  #bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (!$('#screen-review').classList.contains('active')) return;
      if (!$('#tab-deidentify').classList.contains('active')) return;
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      // 상단의 새 작업·설정 팝업을 조작하는 중에는 검토 단축키가 끼어들지 않는다
      if (activeEl?.closest?.('.top-actions')) return;
      // 읽기 전용 중에는 후보 이동만 허용하고 처리·제외·되돌리기·처리방식 단축키는 막는다
      if (this.readOnly && (e.ctrlKey || e.altKey || e.metaKey || !READ_ONLY_NAV_KEYS.has(e.key.toLowerCase()))) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.#undo();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const key = e.key.toLowerCase();
      // 포커스된 버튼의 Enter·Space는 그 버튼의 동작이어야 한다
      if (tag === 'BUTTON' && (key === 'enter' || key === ' ')) return;
      // 문서 본문에 포커스가 있으면 방향키는 그 패널의 스크롤이고 Enter는 강조 선택이다
      const inPreview = Boolean(activeEl?.closest?.('#preview'));
      if (inPreview && (PREVIEW_SCROLL_KEYS.has(key) || key === 'enter')) return;

      if (key === 'j' || key === 'arrowdown' || key === 'k' || key === 'arrowup') {
        e.preventDefault();
        const delta = key === 'j' || key === 'arrowdown' ? 1 : -1;
        const id = this.listView.moveCursor(delta, this.session.candidates);
        if (id) {
          this.highlighter.focus(id);
          this.#renderInspector();
        }
        return;
      }

      const current = this.listView.cursorId ? this.#findCandidate(this.listView.cursorId) : null;
      if (!current) return;

      if (key === 'i' || key === 'x') {
        e.preventDefault();
        this.#decide(current, key === 'i' ? REVIEW_STATES.PROCESS : REVIEW_STATES.EXCLUDE, { advance: true });
        return;
      }
      if (key === 'enter') {
        e.preventDefault();
        $('#cand-inspector .c-type')?.focus();
        return;
      }
      if (['1', '2', '3', '4'].includes(key)) {
        e.preventDefault();
        const actions = Object.keys(ACTION_LABELS);
        this.#pushHistory();
        current.action = actions[Number(key) - 1];
        current.userModified = true;
        this.sync();
        toast(`${ACTION_LABELS[current.action]}(으)로 변경했습니다.`);
      }
    });
  }

  #addManualCandidate(start, end, type, method = 'MANUAL') {
    if (this.session.candidates.some((c) => start < c.end && c.start < end)) return false;
    this.manualSeq += 1;
    this.session.candidates.push({
      id: `pii-manual-${String(this.manualSeq).padStart(4, '0')}`,
      documentPart: 'body',
      start,
      end,
      originalText: this.session.parsed.text.slice(start, end),
      type,
      confidence: 1,
      detectionMethod: method,
      context: '',
      selected: true,
      reviewState: REVIEW_STATES.PROCESS,
      action: null,
      replacementText: null,
      userModified: true,
    });
    this.session.manuallyAddedCount += 1;
    return true;
  }

  #addCandidatesByText(term, type, method) {
    const text = this.session.parsed.text;
    let added = 0;
    let idx = text.indexOf(term);
    while (idx >= 0) {
      if (this.#addManualCandidate(idx, idx + term.length, type, method)) added += 1;
      idx = text.indexOf(term, idx + term.length);
    }
    return added;
  }
}
