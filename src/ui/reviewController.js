// 검토 화면 제어 — 필터·일괄 처리·수동 추가·되돌리기·키보드 단축키

import { PII_TYPES, ACTION_LABELS, CONFIDENCE_LEVELS } from '../detect/types.js';
import { REVIEW_STATES, reviewCounts, setReviewState } from '../core/reviewState.js';
import { $, $$, toast, showScreen, textOffsetIn, renderedOffsetToSource } from './dom.js';
import { CandidateListView } from './candidateList.js';
import { PreviewHighlighter, PREVIEW_CHAR_LIMIT } from './highlight.js';

const STATUS_FILTER_LABELS = {
  pending: '확인 필요',
  ai: 'AI 발견',
  disputed: '오탐 의심',
  exclude: '처리 제외',
  manual: '수동 추가',
};

const PREVIEW_SCROLL_KEYS = new Set([
  'arrowdown', 'arrowup', 'pageup', 'pagedown', 'home', 'end', ' ',
]);

export class ReviewController {
  constructor({ session, onOpenConfirm, onCancelAnalyze, onCancelAi }) {
    this.session = session;
    this.onOpenConfirm = onOpenConfirm;
    this.onCancelAnalyze = onCancelAnalyze;
    this.onCancelAi = onCancelAi;

    this.activeFilter = { type: null, status: 'all' };
    this.manualSeq = 0;

    this.listView = new CandidateListView($('#candidate-list'));
    this.highlighter = new PreviewHighlighter($('#preview'), {
      onWindowChange: (info) => this.#updatePreviewWindowUi(info),
    });
  }

  bind() {
    this.#bindPreviewEvents();
    this.#bindCandidateListEvents();
    this.#bindFilterEvents();
    this.#bindManualAddEvents();
    this.#bindActionButtons();
    this.#bindKeyboard();
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
    const visible = this.listView.sync(candidates, { resort });

    const counts = reviewCounts(candidates);
    const reviewed = counts.process + counts.exclude;
    const badge = $('#detect-count-badge');
    badge.textContent = `${visible}건 표시`;
    badge.setAttribute('aria-label', `총 ${counts.total}건 중 ${visible}건 표시`);

    $('#review-done-count').textContent = reviewed.toLocaleString();
    $('#review-total-count').textContent = `/ ${counts.total.toLocaleString()}`;
    $('#review-meter-fill').style.width = `${counts.total ? (reviewed / counts.total) * 100 : 100}%`;
    $('#count-pending').textContent = counts.pending.toLocaleString();
    $('#count-process').textContent = counts.process.toLocaleString();
    $('#count-exclude').textContent = counts.exclude.toLocaleString();

    const aiCount = candidates.filter((c) => c.aiOnly).length;
    const disputedCount = candidates.filter((c) => c.aiDisputed).length;
    const manualCount = candidates.filter((c) => ['MANUAL', 'SEARCH'].includes(c.detectionMethod)).length;

    $('#count-ai').textContent = aiCount.toLocaleString();
    $('#filter-count-all').textContent = counts.total;
    $('#filter-count-pending').textContent = counts.pending;
    $('#filter-count-ai').textContent = aiCount;
    $('#filter-count-disputed').textContent = disputedCount;
    $('#filter-count-exclude').textContent = counts.exclude;
    $('#filter-count-manual').textContent = manualCount;
    $('#review-footer-summary').innerHTML =
      `<strong>${counts.process.toLocaleString()}개 처리</strong> · ${counts.exclude.toLocaleString()}개 제외 · ${counts.pending.toLocaleString()}개 미확인`;
    $('#btn-to-confirm').disabled = counts.pending > 0;

    const filtered = Boolean(this.activeFilter.type || this.activeFilter.status !== 'all');
    $('#filter-actions').hidden = !filtered;
    if (filtered) {
      const label = this.activeFilter.type
        ? (PII_TYPES[this.activeFilter.type]?.label || this.activeFilter.type)
        : STATUS_FILTER_LABELS[this.activeFilter.status];
      $('#filter-label').textContent = `${label} ${visible}건`;
    }

    this.#updateReviewGap();
  }

  reset() {
    this.listView.clear();
    this.highlighter.clear();
    this.activeFilter = { type: null, status: 'all' };
    this.manualSeq = 0;
    $('#type-filter').value = '';
    this.#syncStatusFilterButtons('all');
    $('#filter-actions').hidden = true;
    $('#selection-popover').hidden = true;
    $('#search-input').value = '';
  }

  #findCandidate(id) {
    return this.session.candidates.find((c) => c.id === id);
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
    this.session.candidates = state.candidates;
    this.session.manuallyAddedCount = state.manuallyAddedCount;
    this.manualSeq = state.manualSeq;
    this.sync({ resort: true });
    this.highlighter.renderNow(this.session.parsed.text, this.session.candidates);
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
    const pending = candidates.filter((c) => c.reviewState === REVIEW_STATES.PENDING).length;
    const disputed = candidates.filter((c) => c.aiDisputed && !c.userModified).length;
    const lowConf = candidates.filter((c) => c.confidence < CONFIDENCE_LEVELS.MEDIUM && !c.userModified).length;

    const parts = [];
    if (pending > 0) parts.push(`<strong>미확인 ${pending}건</strong>`);
    if (disputed > 0) parts.push(`<strong>AI 오탐 의심 ${disputed}건</strong>`);
    if (lowConf > 0) parts.push(`<strong>신뢰도 낮음 ${lowConf}건</strong>`);

    if (parts.length === 0) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `${parts.join(' · ')}이 아직 확인되지 않았습니다. `
      + '위 필터로 해당 항목만 모아 볼 수 있습니다. 확인 후 실행하십시오.';
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

    const jumpToCandidate = (mark) => {
      this.highlighter.focus(mark.dataset.id);
      this.listView.setCursor(mark.dataset.id, this.session.candidates);
    };

    const preview = $('#preview');
    preview.addEventListener('click', (e) => {
      const mark = e.target.closest('mark.pii');
      if (mark) jumpToCandidate(mark);
    });
    // 강조는 role="button"이므로 Enter·Space로도 동작해야 한다
    preview.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const mark = e.target.closest?.('mark.pii');
      if (!mark) return;
      e.preventDefault();
      jumpToCandidate(mark);
    });

    const updateSelectionPopover = () => {
      const selection = window.getSelection();
      $('#selection-popover').hidden = !selection || selection.isCollapsed
        || !preview.contains(selection.anchorNode) || !preview.contains(selection.focusNode);
    };
    preview.addEventListener('mouseup', updateSelectionPopover);
    preview.addEventListener('keyup', updateSelectionPopover);
  }

  #bindCandidateListEvents() {
    const list = $('#candidate-list');

    list.addEventListener('click', (e) => {
      const item = e.target.closest('.cand');
      if (!item) return;
      const c = this.#findCandidate(item.dataset.id);
      if (!c) return;

      if (e.target.classList.contains('c-same')) {
        // 동일값 일괄 (FR-406)
        this.#pushHistory();
        const targetState = c.reviewState === REVIEW_STATES.PROCESS ? REVIEW_STATES.EXCLUDE : REVIEW_STATES.PROCESS;
        let count = 0;
        for (const other of this.session.candidates) {
          if (other.originalText === c.originalText && other.type === c.type) {
            setReviewState(other, targetState);
            other.action = c.action;
            count += 1;
          }
        }
        this.sync();
        toast(`동일한 값 ${count}건을 ${targetState === REVIEW_STATES.PROCESS ? '처리 대상으로 지정' : '제외'}했습니다.`);
        return;
      }

      if (e.target.classList.contains('cand-toggle')) {
        this.listView.toggleExpanded(c.id);
        this.sync();
        return;
      }

      if (e.target.classList.contains('c-decision')) {
        this.#pushHistory();
        setReviewState(c, e.target.dataset.state);
        this.sync();
        return;
      }

      if (e.target.tagName !== 'SELECT') {
        this.listView.setCursor(c.id, this.session.candidates);
        this.highlighter.focus(c.id);
      }
    });

    list.addEventListener('change', (e) => {
      const item = e.target.closest('.cand');
      if (!item) return;
      const c = this.#findCandidate(item.dataset.id);
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
  }

  #bindFilterEvents() {
    $('#status-filters').addEventListener('click', (e) => {
      const button = e.target.closest('.status-filter');
      if (!button) return;
      this.activeFilter.status = button.dataset.status;
      this.#syncStatusFilterButtons(button.dataset.status);
      this.sync();
    });

    $('#type-filter').addEventListener('change', (e) => {
      this.activeFilter.type = e.target.value || null;
      this.sync();
    });

    // 필터된 항목 일괄 처리 (FR-406)
    $('#filter-actions').addEventListener('click', (e) => {
      const action = e.target.dataset.bulk;
      if (!action) return;
      if (action === 'clear') {
        this.activeFilter = { type: null, status: 'all' };
        $('#type-filter').value = '';
        this.#syncStatusFilterButtons('all');
        this.sync();
        return;
      }
      this.#pushHistory();
      const targets = this.session.candidates.filter((c) => this.listView.isVisible(c));
      const targetState = action === 'process' ? REVIEW_STATES.PROCESS : REVIEW_STATES.EXCLUDE;
      for (const c of targets) setReviewState(c, targetState);
      this.sync();
      toast(`${targets.length}건을 ${action === 'process' ? '처리 대상으로 지정' : '제외'}했습니다.`);
    });

    $('#bulk-action').addEventListener('change', (e) => {
      this.#pushHistory();
      const targets = this.session.candidates.filter((c) => this.listView.isVisible(c));
      for (const c of targets) {
        c.action = e.target.value;
        c.userModified = true;
      }
      this.sync();
      toast(`${targets.length}건의 처리방식을 변경했습니다.`);
    });

    $('#sort-mode').addEventListener('change', (e) => {
      this.listView.setSort(e.target.value);
      this.sync({ resort: true });
    });

    $('#btn-select-all').addEventListener('click', () => {
      this.#pushHistory();
      this.session.candidates.forEach((c) => setReviewState(c, REVIEW_STATES.PROCESS));
      this.sync();
    });
    $('#btn-deselect-all').addEventListener('click', () => {
      this.#pushHistory();
      this.session.candidates.forEach((c) => setReviewState(c, REVIEW_STATES.EXCLUDE));
      this.sync();
    });
  }

  #bindManualAddEvents() {
    // 검색 일괄 지정 (FR-408)
    $('#btn-search-add').addEventListener('click', () => {
      const term = $('#search-input').value;
      if (!term) {
        toast('검색할 문자열을 입력하십시오.', true);
        return;
      }
      this.#pushHistory();
      const added = this.#addCandidatesByText(term, $('#search-type').value, 'SEARCH');
      this.sync();
      this.highlighter.renderNow(this.session.parsed.text, this.session.candidates);
      toast(added > 0 ? `"${term}" ${added}건을 개인정보로 지정했습니다.` : '이미 지정되었거나 문서에 없는 문자열입니다.', added === 0);
    });

    // 선택 영역 수동 추가 (FR-404)
    $('#btn-add-selection').addEventListener('click', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        toast('미리보기에서 추가할 문자열을 먼저 드래그하십시오.', true);
        return;
      }
      const preview = $('#preview');
      if (!preview.contains(sel.anchorNode) || !preview.contains(sel.focusNode)) {
        toast('문서 미리보기 안의 문자열만 추가할 수 있습니다.', true);
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
        this.activeFilter.status = 'pending';
        this.#syncStatusFilterButtons('pending');
        this.sync();
        toast(`미확인 후보 ${counts.pending}건을 먼저 확인해 주십시오.`, true);
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
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const key = e.key.toLowerCase();
      // 미리보기에 포커스가 있으면 방향키는 그 패널의 스크롤이어야 한다.
      if (document.activeElement === $('#preview') && PREVIEW_SCROLL_KEYS.has(key)) return;

      if (key === 'j' || key === 'arrowdown') {
        e.preventDefault();
        const id = this.listView.moveCursor(1, this.session.candidates);
        if (id) this.highlighter.focus(id);
        return;
      }
      if (key === 'k' || key === 'arrowup') {
        e.preventDefault();
        const id = this.listView.moveCursor(-1, this.session.candidates);
        if (id) this.highlighter.focus(id);
        return;
      }

      const current = this.listView.cursorId ? this.#findCandidate(this.listView.cursorId) : null;
      if (!current) return;

      if (key === 'i' || key === 'x') {
        e.preventDefault();
        this.#pushHistory();
        setReviewState(current, key === 'i' ? REVIEW_STATES.PROCESS : REVIEW_STATES.EXCLUDE);
        this.sync();
        return;
      }
      if (key === 'enter') {
        e.preventDefault();
        this.listView.toggleExpanded(current.id);
        this.sync();
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
