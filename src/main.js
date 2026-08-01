// 앱 진입점 — 화면 전환·이벤트 연결 (개인정보 원문은 콘솔·저장소에 기록하지 않는다)

import './style.css';
import { PROGRAM_NAME, PROGRAM_VERSION } from './version.js';
import { RULE_VERSION } from './detect/engine.js';
import { PII_TYPES, ACTION_LABELS } from './detect/types.js';
import { WorkSession } from './core/session.js';
import { validateAndRead, downloadBlob, resultFileName } from './core/fileManager.js';
import { parseDocument, analyze, buildResult, restoreDocument } from './core/analyzer.js';
import { applyToText } from './core/deidentify.js';
import { buildMappingTable, mappingTableToBlob, parseMappingTable } from './core/mappingTable.js';
import { buildSummary, summaryToBlob } from './core/summary.js';
import { AppError } from './core/errors.js';
import { checkAvailability, DEFAULT_ENDPOINT, DEFAULT_MODEL } from './ai/ollamaClient.js';
import { runAiDetection, createAiStats, estimateChunks, DEFAULT_MAX_CHUNKS } from './ai/aiDetect.js';
import { AiRunLifecycle } from './ai/lifecycle.js';
import { $, $$, toast, showScreen, textOffsetIn, escapeHtml } from './ui/dom.js';
import { CandidateListView } from './ui/candidateList.js';
import { PreviewHighlighter, buildPreviewHtml } from './ui/highlight.js';
import { renderAfterHtml, renderSummaryHtml, renderTypeChips, renderDocMeta } from './ui/render.js';

const session = new WorkSession();
let userRules = [];          // 사용자 정의 탐지 규칙 (세션 한정, FR-803)
let analyzeCancelled = false;
let manualSeq = 0;

let listView = null;
let highlighter = null;
let activeFilter = { type: null, source: null };

// AI 상태
const aiLifecycle = new AiRunLifecycle(); // 이전 문서의 비동기 실행을 현재 세션과 격리
let aiStats = null;          // 감사 기록용 통계
let aiAvailability = { available: false, reason: 'unknown' };

const POLICY_STORAGE_KEY = 'safedoc-type-policies';
const AI_STORAGE_KEY = 'safedoc-ai-settings';

let aiSettings = { enabled: true, endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL };

// ---------- 초기화 ----------

function init() {
  $('#version-info').textContent = `v${PROGRAM_VERSION} · 규칙 v${RULE_VERSION}`;
  document.title = PROGRAM_NAME;

  listView = new CandidateListView($('#candidate-list'));
  highlighter = new PreviewHighlighter($('#preview'), { onWindowChange: updatePreviewWindowUi });

  loadPolicies();
  loadAiSettings();
  populateSelects();
  renderPolicyList();
  bindTabEvents();
  bindUploadEvents();
  bindReviewEvents();
  bindKeyboard();
  bindResultEvents();
  bindRestoreEvents();
  bindSettingsEvents();

  refreshAiAvailability();
}

function loadPolicies() {
  try {
    const raw = localStorage.getItem(POLICY_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const [type, action] of Object.entries(saved)) {
        // 저장된 값이 유효한 처리방식일 때만 반영한다
        if (session.typePolicies[type] && ACTION_LABELS[action]) session.typePolicies[type] = action;
      }
    }
  } catch { /* 설정 손상 시 기본값 사용 */ }
  listView?.setPolicies(session.typePolicies);
}

function savePolicies() {
  try {
    localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(session.typePolicies));
  } catch { /* 저장 실패는 무시 */ }
}

// AI 설정에는 개인정보가 포함되지 않는다 (FR-805)
function loadAiSettings() {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    if (raw) aiSettings = { ...aiSettings, ...JSON.parse(raw) };
  } catch { /* 무시 */ }
  $('#ai-enabled').checked = aiSettings.enabled;
  $('#ai-endpoint').value = aiSettings.endpoint;
  $('#ai-model').value = aiSettings.model;
}

function saveAiSettings() {
  try { localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(aiSettings)); } catch { /* 무시 */ }
}

function populateSelects() {
  const options = Object.entries(PII_TYPES)
    .map(([code, def]) => `<option value="${code}">${escapeHtml(def.label)}</option>`)
    .join('');
  $('#search-type').innerHTML = options;
  $('#add-type').innerHTML = options;
  $('#search-type').value = 'CUSTOM';
  $('#add-type').value = 'CUSTOM';

  $('#bulk-action').innerHTML = Object.entries(ACTION_LABELS)
    .map(([code, label]) => `<option value="${code}">${escapeHtml(label)}</option>`)
    .join('');
}

// ---------- AI 상태 ----------

function setAiBadge(state, text) {
  const badge = $('#ai-badge');
  badge.className = `tbadge ${state}`;
  $('#ai-badge-text').textContent = text;
}

async function refreshAiAvailability() {
  // https로 열린 경우(GitHub Pages 등)에는 로컬 엔진에 접근할 수 없다
  if (location.protocol === 'https:') {
    aiAvailability = { available: false, reason: 'protocol', message: '웹에서 열람 중이라 로컬 AI를 사용할 수 없습니다.' };
    setAiBadge('off', 'AI 사용 불가 (웹 열람)');
    return;
  }
  if (!aiSettings.enabled) {
    aiAvailability = { available: false, reason: 'disabled' };
    setAiBadge('off', 'AI 사용 안 함');
    return;
  }

  setAiBadge('busy', 'AI 확인 중…');
  aiAvailability = await checkAvailability({ endpoint: aiSettings.endpoint, model: aiSettings.model });
  if (aiAvailability.available) setAiBadge('on', `AI 준비됨 · ${aiSettings.model}`);
  else if (aiAvailability.reason === 'model') setAiBadge('off', '모델 없음');
  else setAiBadge('off', 'AI 엔진 꺼짐');
}

// ---------- 탭 전환 ----------

function bindTabEvents() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.remove('active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ---------- 업로드 (FR-101, FR-102) ----------

function bindUploadEvents() {
  const dropZone = $('#drop-zone');
  const fileInput = $('#file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });
}

async function handleFile(file) {
  // 중복 업로드 방지 (FR-106)
  if (session.parsed && !window.confirm('작업 중인 문서가 있습니다. 새 문서를 업로드하면 현재 작업이 사라집니다. 계속하시겠습니까?')) {
    $('#file-input').value = '';
    return;
  }
  stopAiPass();
  resetReviewUi();
  session.reset();
  loadPolicies();
  analyzeCancelled = false;
  aiStats = null;

  try {
    const read = await validateAndRead(file);
    session.file = read;

    if (read.size > 10 * 1024 * 1024) {
      toast('10MB를 초과하는 문서는 처리 속도가 느려질 수 있습니다.');
    }

    showScreen('screen-analyze');
    $('#analyze-file-info').innerHTML =
      `<strong>${escapeHtml(read.name)}</strong> · ${read.ext.toUpperCase()} · ${(read.size / 1024).toFixed(1)}KB`;
    await runAnalysis();
  } catch (err) {
    showError(err);
    showScreen('screen-main');
  } finally {
    $('#file-input').value = '';
  }
}

function setProgress(percent, statusText) {
  $('#analyze-progress').style.width = `${percent}%`;
  $('#analyze-status').textContent = statusText;
}

// 분석 실행 — 단계 사이에 제어권을 양보하여 화면 멈춤 방지 (NFR-104)
async function runAnalysis() {
  const yieldUi = () => new Promise((r) => setTimeout(r, 30));
  try {
    setProgress(10, '파일을 읽는 중…');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    session.parsed = await parseDocument(session.file);
    setProgress(45, '문서 내용을 추출했습니다. 규칙 기반 탐지 중…');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    session.candidates = analyze(session.parsed, userRules);
    setProgress(100, '탐지 완료');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    // 파일정보 표시 (FR-104)
    $('#doc-meta').innerHTML = renderDocMeta(session.file, session.parsed);

    highlighter.renderNow(session.parsed.text, session.candidates);
    syncReview({ resort: true });
    showScreen('screen-review');

    // 규칙 결과를 먼저 보여준 뒤 AI 탐지를 백그라운드로 시작한다 (계획 C-7)
    startAiPass();
  } catch (err) {
    showError(err);
    session.dispose();
    showScreen('screen-main');
  }
}

// ---------- 검토 화면 ----------

function syncReview({ resort = false } = {}) {
  listView.setPolicies(session.typePolicies);
  listView.setFilter(activeFilter);
  const visible = listView.sync(session.candidates, { resort });

  $('#type-chips').innerHTML = renderTypeChips(session.candidates, activeFilter);

  const total = session.candidates.length;
  const selected = session.candidates.filter((c) => c.selected).length;
  $('#detect-count-badge').textContent = `${total}건 중 ${selected}건 처리`;

  const filtered = activeFilter.type || activeFilter.source;
  $('#filter-actions').hidden = !filtered;
  if (filtered) {
    const label = activeFilter.type
      ? (PII_TYPES[activeFilter.type]?.label || activeFilter.type)
      : (activeFilter.source === 'ai' ? 'AI 발견' : 'AI 오탐 의심');
    $('#filter-label').textContent = `${label} ${visible}건`;
  }
}

function updatePreviewWindowUi({ start, end, total }) {
  const paged = total > 200000;
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

function pushHistory() {
  // 되돌리기용 스냅샷 (FR-409) — 메모리에서만 유지
  // 후보 배열뿐 아니라 수동 추가 카운터까지 담아야 요약 통계가 어긋나지 않는다
  session.history.push(JSON.stringify({
    candidates: session.candidates,
    manuallyAddedCount: session.manuallyAddedCount,
    manualSeq,
  }));
  if (session.history.length > 50) session.history.shift();
}

function findCandidate(id) {
  return session.candidates.find((c) => c.id === id);
}

// 사용자가 손댄 후보는 AI 병합이 범위를 바꾸지 않는다
function markUserModified(c) {
  c.userModified = true;
}

function bindReviewEvents() {
  $('#btn-preview-prev').addEventListener('click', () => highlighter.shiftWindow(-1));
  $('#btn-preview-next').addEventListener('click', () => highlighter.shiftWindow(1));

  // 미리보기에서 후보 클릭 → 목록에서 해당 항목으로 이동
  $('#preview').addEventListener('click', (e) => {
    const mark = e.target.closest('mark.pii');
    if (!mark) return;
    highlighter.focus(mark.dataset.id);
    listView.setCursor(mark.dataset.id, session.candidates);
  });

  const list = $('#candidate-list');

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.cand');
    if (!item) return;
    const c = findCandidate(item.dataset.id);
    if (!c) return;

    if (e.target.classList.contains('c-same')) {
      // 동일값 일괄 (FR-406)
      pushHistory();
      const target = !c.selected; // 현재 상태의 반대로 일괄 적용한다
      let count = 0;
      for (const other of session.candidates) {
        if (other.originalText === c.originalText && other.type === c.type) {
          other.selected = target;
          other.action = c.action;
          markUserModified(other);
          count += 1;
        }
      }
      syncReview();
      toast(`동일한 값 ${count}건을 ${target ? '처리 대상으로 지정' : '제외'}했습니다.`);
      return;
    }

    if (e.target.classList.contains('cand-toggle')) {
      listView.toggleExpanded(c.id);
      syncReview();
      return;
    }

    if (e.target.classList.contains('c-check')) {
      pushHistory();
      c.selected = e.target.checked;
      markUserModified(c);
      syncReview();
      return;
    }

    // 카드 클릭 → 커서 이동 + 미리보기 위치로 스크롤
    if (e.target.tagName !== 'SELECT') {
      listView.setCursor(c.id, session.candidates);
      highlighter.focus(c.id);
    }
  });

  list.addEventListener('change', (e) => {
    const item = e.target.closest('.cand');
    if (!item) return;
    const c = findCandidate(item.dataset.id);
    if (!c) return;
    if (e.target.classList.contains('c-type')) {
      // 유형 변경 (FR-405)
      pushHistory();
      c.type = e.target.value;
      c.action = null; // 새 유형의 기본 정책 적용
      markUserModified(c);
      syncReview();
    } else if (e.target.classList.contains('c-action')) {
      // 개별 처리방식 (FR-407)
      pushHistory();
      c.action = e.target.value;
      markUserModified(c);
      syncReview();
    }
  });

  // 유형·출처 필터 칩
  $('#type-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const key = chip.dataset.chip;
    if (key === 'all') activeFilter = { type: null, source: null };
    else if (key === 'ai' || key === 'disputed') activeFilter = { type: null, source: key };
    else activeFilter = { type: key, source: null };
    syncReview();
  });

  // 필터된 항목 일괄 처리 (FR-406: 동일 유형 전체 일괄)
  $('#filter-actions').addEventListener('click', (e) => {
    const action = e.target.dataset.bulk;
    if (!action) return;
    if (action === 'clear') {
      activeFilter = { type: null, source: null };
      syncReview();
      return;
    }
    pushHistory();
    const targets = session.candidates.filter((c) => listView.isVisible(c));
    for (const c of targets) {
      c.selected = action === 'select';
      markUserModified(c);
    }
    syncReview();
    toast(`${targets.length}건을 ${action === 'select' ? '선택' : '해제'}했습니다.`);
  });

  $('#bulk-action').addEventListener('change', (e) => {
    pushHistory();
    const targets = session.candidates.filter((c) => listView.isVisible(c));
    for (const c of targets) {
      c.action = e.target.value;
      markUserModified(c);
    }
    syncReview();
    toast(`${targets.length}건의 처리방식을 변경했습니다.`);
  });

  $('#sort-mode').addEventListener('change', (e) => {
    listView.setSort(e.target.value);
    syncReview({ resort: true });
  });

  $('#btn-select-all').addEventListener('click', () => {
    pushHistory();
    session.candidates.forEach((c) => { c.selected = true; markUserModified(c); });
    syncReview();
  });
  $('#btn-deselect-all').addEventListener('click', () => {
    pushHistory();
    session.candidates.forEach((c) => { c.selected = false; markUserModified(c); });
    syncReview();
  });

  // 검색 일괄 지정 (FR-408)
  $('#btn-search-add').addEventListener('click', () => {
    const term = $('#search-input').value;
    if (!term) {
      toast('검색할 문자열을 입력하십시오.', true);
      return;
    }
    pushHistory();
    const added = addCandidatesByText(term, $('#search-type').value, 'SEARCH');
    syncReview();
    highlighter.renderNow(session.parsed.text, session.candidates);
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
    start += highlighter.windowStart;
    end += highlighter.windowStart;

    pushHistory();
    const ok = addManualCandidate(start, end, $('#add-type').value);
    sel.removeAllRanges();
    syncReview();
    highlighter.renderNow(session.parsed.text, session.candidates);
    toast(ok ? '개인정보로 추가했습니다.' : '기존 후보와 겹치는 영역입니다.', !ok);
  });

  // 되돌리기 (FR-409)
  $('#btn-undo').addEventListener('click', undo);

  // 최종 확인 후 실행 (FR-410)
  $('#final-confirm').addEventListener('change', (e) => {
    $('#btn-execute').disabled = !e.target.checked;
  });
  $('#btn-execute').addEventListener('click', executeDeidentify);
  $('#btn-cancel-analyze').addEventListener('click', () => { analyzeCancelled = true; });
  $('#btn-cancel-ai').addEventListener('click', () => {
    stopAiPass();
    toast('AI 탐지를 중단했습니다. 규칙 기반 결과는 그대로 유지됩니다.');
  });
}

function undo() {
  const snapshot = session.history.pop();
  if (!snapshot) {
    toast('되돌릴 작업이 없습니다.', true);
    return;
  }
  const state = JSON.parse(snapshot);
  session.candidates = state.candidates;
  session.manuallyAddedCount = state.manuallyAddedCount;
  manualSeq = state.manualSeq;
  syncReview({ resort: true });
  highlighter.renderNow(session.parsed.text, session.candidates);
}

// ---------- 키보드 검토 (계획 D-2) ----------

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!$('#screen-review').classList.contains('active')) return;
    if (!$('#tab-deidentify').classList.contains('active')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const key = e.key.toLowerCase();

    if (key === 'j' || key === 'arrowdown') {
      e.preventDefault();
      const id = listView.moveCursor(1, session.candidates);
      if (id) highlighter.focus(id);
      return;
    }
    if (key === 'k' || key === 'arrowup') {
      e.preventDefault();
      const id = listView.moveCursor(-1, session.candidates);
      if (id) highlighter.focus(id);
      return;
    }

    const current = listView.cursorId ? findCandidate(listView.cursorId) : null;
    if (!current) return;

    if (key === ' ') {
      e.preventDefault();
      pushHistory();
      current.selected = !current.selected;
      markUserModified(current);
      syncReview();
      return;
    }
    if (key === 'enter') {
      e.preventDefault();
      listView.toggleExpanded(current.id);
      syncReview();
      return;
    }
    if (['1', '2', '3', '4'].includes(key)) {
      e.preventDefault();
      const actions = Object.keys(ACTION_LABELS);
      pushHistory();
      current.action = actions[Number(key) - 1];
      markUserModified(current);
      syncReview();
      toast(`${ACTION_LABELS[current.action]}(으)로 변경했습니다.`);
    }
  });
}

// ---------- 수동 후보 추가 ----------

function addManualCandidate(start, end, type, method = 'MANUAL') {
  const overlaps = session.candidates.some((c) => start < c.end && c.start < end);
  if (overlaps) return false;
  manualSeq += 1;
  session.candidates.push({
    id: `pii-manual-${String(manualSeq).padStart(4, '0')}`,
    documentPart: 'body',
    start,
    end,
    originalText: session.parsed.text.slice(start, end),
    type,
    confidence: 1,
    detectionMethod: method,
    context: '',
    selected: true,
    action: null,
    replacementText: null,
    userModified: true,
  });
  session.manuallyAddedCount += 1;
  return true;
}

function addCandidatesByText(term, type, method) {
  const text = session.parsed.text;
  let added = 0;
  let idx = text.indexOf(term);
  while (idx >= 0) {
    if (addManualCandidate(idx, idx + term.length, type, method)) added += 1;
    idx = text.indexOf(term, idx + term.length);
  }
  return added;
}

// ---------- AI 탐지 패스 (계획 C-7) ----------

async function stopAiPass({ wait = false } = {}) {
  const stopped = aiLifecycle.stop({ wait });
  $('#ai-status').hidden = true;
  return wait ? await stopped : null;
}

function startAiPass() {
  if (!aiSettings.enabled) return Promise.resolve(null);
  const parsed = session.parsed;
  const candidates = session.candidates;
  if (!parsed) return Promise.resolve(null);

  const run = aiLifecycle.begin();
  const initialStats = createAiStats(parsed.text, {
    model: aiSettings.model,
    maxChunks: DEFAULT_MAX_CHUNKS,
  });
  const promise = performAiPass(run, parsed, candidates, initialStats);
  return aiLifecycle.attachPromise(run, promise);
}

async function performAiPass(run, parsed, candidates, initialStats) {
  await refreshAiAvailability();
  if (!aiLifecycle.isCurrent(run)) {
    initialStats.stopReason = 'aborted';
    return initialStats;
  }
  if (!aiAvailability.available) {
    if (aiAvailability.reason && aiAvailability.reason !== 'disabled') {
      toast(`${aiAvailability.message || 'AI 탐지를 사용할 수 없습니다.'} 규칙 기반 결과만 표시합니다.`);
    }
    aiLifecycle.clear(run);
    return null;
  }

  const chunkCount = estimateChunks(parsed.text);
  if (chunkCount > DEFAULT_MAX_CHUNKS) {
    const minutes = Math.ceil((chunkCount * 6) / 60);
    const ok = window.confirm(
      `문서가 커서 AI 탐지에 약 ${minutes}분 이상 걸립니다 (${chunkCount}개 구간).\n`
      + `앞쪽 ${DEFAULT_MAX_CHUNKS}개 구간만 검사합니다.\n\n계속하시겠습니까?`,
    );
    if (!ok) {
      aiLifecycle.clear(run);
      return null;
    }
  }

  const controller = new AbortController();
  aiLifecycle.attachController(run, controller);
  if (!aiLifecycle.isCurrent(run)) {
    initialStats.stopReason = 'aborted';
    return initialStats;
  }
  const statusBox = $('#ai-status');
  statusBox.hidden = false;
  setAiBadge('busy', 'AI 탐지 중…');
  updateAiProgress(0, Math.min(chunkCount, DEFAULT_MAX_CHUNKS), 0);

  try {
    const completedStats = await runAiDetection(parsed, candidates, {
      endpoint: aiSettings.endpoint,
      model: aiSettings.model,
      signal: controller.signal,
      onChunkMerged: ({ index, total, added, stats }) => {
        if (!aiLifecycle.isCurrent(run) || session.parsed !== parsed) return;
        updateAiProgress(index + 1, total, stats.addedCount);
        // 새 후보가 도착했으므로 목록·미리보기를 갱신한다.
        // sync는 기존 카드를 재사용하므로 스크롤·펼침 상태가 유지된다.
        syncReview();
        highlighter.schedule(parsed.text, candidates);

        // 검토를 마쳤다고 체크한 뒤에 새 후보가 나타나면 확인을 다시 받는다
        if (added.length > 0 && $('#final-confirm').checked) {
          $('#final-confirm').checked = false;
          $('#btn-execute').disabled = true;
          toast(`AI가 개인정보 후보 ${added.length}건을 새로 찾았습니다. 다시 확인해 주십시오.`);
        }
      },
    });
    if (aiLifecycle.isCurrent(run) && session.parsed === parsed) aiStats = completedStats;
    return completedStats;
  } catch (err) {
    if (aiLifecycle.isCurrent(run)) showError(err);
    return initialStats;
  } finally {
    if (aiLifecycle.isCurrent(run) && session.parsed === parsed) {
      statusBox.hidden = true;
      highlighter.renderNow(parsed.text, candidates);
      // AI 결과가 붙으면서 각 후보의 검토 우선순위가 바뀌었으므로 여기서 한 번 재정렬한다.
      // 청크마다 재정렬하면 검토 중인 사용자 눈앞에서 카드가 계속 움직인다.
      // AI 완료는 사용자에게 알리는 discrete 시점이므로 여기가 유일하게 안전한 자리다.
      syncReview({ resort: true });
      finishAiPass();
      aiLifecycle.clear(run);
    }
  }
}

function finishAiPass() {
  if (!aiStats) { setAiBadge('off', 'AI 사용 안 함'); return; }
  if (aiStats.completed) {
    setAiBadge('on', `AI 완료 · ${aiStats.addedCount}건 추가`);
    if (aiStats.addedCount > 0) {
      toast(`AI가 규칙이 놓친 개인정보 ${aiStats.addedCount}건을 추가로 찾았습니다.`);
    }
  } else if (aiStats.stopReason === 'aborted') {
    setAiBadge('off', 'AI 중단됨');
  } else {
    setAiBadge('off', 'AI 미완료');
    toast('AI 탐지가 끝까지 완료되지 않았습니다. 결과에 기록됩니다.', true);
  }
}

function updateAiProgress(done, total, added) {
  $('#ai-progress').style.width = `${total > 0 ? (done / total) * 100 : 0}%`;
  $('#ai-status-text').textContent = `AI 검사 ${done}/${total} · ${added}건 추가 발견`;
}

// ---------- 비식별 실행 및 결과 ----------

async function executeDeidentify() {
  const executeButton = $('#btn-execute');
  const startedAt = new Date();
  executeButton.disabled = true;
  try {
    // AI가 아직 돌고 있으면 멈춘 상태로 결과를 만든다 (미완료 사실은 요약에 기록된다)
    const stoppedStats = await stopAiPass({ wait: true });
    if (stoppedStats) aiStats = stoppedStats;

    const { text: afterText, applied } = applyToText(session.parsed.text, session.candidates, session);
    const resultName = resultFileName(session.file.name);
    const blob = await buildResult(session.parsed, afterText, applied);

    session.excludedCount = session.candidates.filter((c) => !c.selected).length;
    const summary = buildSummary({
      session, applied, startedAt, finishedAt: new Date(), resultName, aiStats,
    });
    const mappingTable = buildMappingTable(session.file.name, resultName, applied, aiStats);

    session.result = { blob, fileName: resultName, afterText, applied, summary, mappingTable };

    // AI 미완료 경고 — 완료된 것으로 오인하면 유출로 이어진다
    const aiWarn = $('#ai-incomplete-warning');
    if (aiStats && !aiStats.completed) {
      const reason = aiStats.stopReason === 'aborted' ? '사용자가 중단' : (aiStats.stopReason === 'offline' ? 'AI 엔진 연결 끊김' : '일부 구간 실패');
      aiWarn.innerHTML = `⚠ <strong>AI 검사가 완료되지 않았습니다.</strong> `
        + `${escapeHtml(reason)} · ${aiStats.chunksCompleted}/${aiStats.chunksPlanned} 구간만 검사했습니다. `
        + '검사하지 않은 구간에 개인정보가 남아 있을 수 있습니다.';
      aiWarn.hidden = false;
    } else {
      aiWarn.hidden = true;
    }

    // 미처리 경고 (FR-608)
    const warnBox = $('#unprocessed-warning');
    if (session.excludedCount > 0) {
      warnBox.textContent = `⚠ 처리하지 않은 개인정보 후보가 ${session.excludedCount}건 있습니다. 결과 파일에 원문이 남아 있을 수 있으니 확인하십시오.`;
      warnBox.hidden = false;
    } else {
      warnBox.hidden = true;
    }

    $('#result-summary').innerHTML = renderSummaryHtml(summary);
    $('#compare-before').innerHTML =
      buildPreviewHtml(session.parsed.text, session.candidates.filter((c) => c.selected));
    $('#compare-after').innerHTML = renderAfterHtml(afterText, applied);
    showScreen('screen-result');
  } catch (err) {
    showError(err);
    executeButton.disabled = false;
  }
}

function bindResultEvents() {
  $('#btn-download-result').addEventListener('click', () => {
    if (!session.result) return;
    downloadBlob(session.result.blob, session.result.fileName);
  });

  $('#btn-download-mapping').addEventListener('click', () => {
    if (!session.result) return;
    if (!window.confirm('대응표 파일에는 개인정보 원문이 평문으로 포함됩니다.\n안전한 위치에 보관할 수 있는 경우에만 다운로드하십시오.\n\n계속하시겠습니까?')) return;
    const name = resultFileName(session.file.name, '_대응표').replace(/\.[^.]+$/, '.json');
    downloadBlob(mappingTableToBlob(session.result.mappingTable), name);
  });

  $('#btn-download-summary').addEventListener('click', () => {
    if (!session.result) return;
    const name = resultFileName(session.file.name, '_처리요약').replace(/\.[^.]+$/, '.json');
    downloadBlob(summaryToBlob(session.result.summary), name);
  });

  // 처리 전/후 토글
  $$('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const showAfter = btn.dataset.compare === 'after';
      $('#compare-after').hidden = !showAfter;
      $('#compare-before').hidden = showAfter;
    });
  });

  $('#btn-new-doc').addEventListener('click', () => newSession());
  $('#btn-finish').addEventListener('click', () => {
    newSession();
    toast('작업정보를 초기화했습니다.');
  });
}

function newSession() {
  stopAiPass();
  session.dispose();
  session.reset();
  aiStats = null;
  loadPolicies();
  resetReviewUi();
  showScreen('screen-main');
  refreshAiAvailability();
}

function resetReviewUi() {
  listView.clear();
  highlighter.clear();
  activeFilter = { type: null, source: null };
  $('#type-chips').innerHTML = '';
  $('#filter-actions').hidden = true;
  $('#compare-before').innerHTML = '';
  $('#compare-after').innerHTML = '';
  $('#result-summary').innerHTML = '';
  $('#doc-meta').innerHTML = '';
  $('#final-confirm').checked = false;
  $('#btn-execute').disabled = true;
  $('#search-input').value = '';
  $('#ai-incomplete-warning').hidden = true;
  $('#unprocessed-warning').hidden = true;
  manualSeq = 0;
}

// ---------- 복원 탭 ----------

function bindRestoreEvents() {
  const docInput = $('#restore-doc-input');
  const mapInput = $('#restore-map-input');
  const btn = $('#btn-restore');

  const updateBtn = () => {
    btn.disabled = !(docInput.files.length > 0 && mapInput.files.length > 0);
  };
  docInput.addEventListener('change', updateBtn);
  mapInput.addEventListener('change', updateBtn);

  btn.addEventListener('click', async () => {
    try {
      const docFile = docInput.files[0];
      const mapFile = mapInput.files[0];
      const read = await validateAndRead(docFile);
      const parsed = await parseDocument(read);
      const mappingTable = parseMappingTable(await mapFile.text());

      const { blob, restoredCount, notRestoredCount } = await restoreDocument(parsed, mappingTable);
      const name = resultFileName(docFile.name, '_복원');
      downloadBlob(blob, name);

      const resultBox = $('#restore-result');
      resultBox.innerHTML =
        `복원 완료: <strong>${escapeHtml(name)}</strong><br />복원된 항목 ${restoredCount}건`
        + (notRestoredCount > 0 ? ` · 복원 불가(마스킹·삭제 처리) ${notRestoredCount}건` : '');
      resultBox.hidden = false;
    } catch (err) {
      showError(err);
    }
  });
}

// ---------- 설정 탭 ----------

function renderPolicyList() {
  $('#policy-list').innerHTML = Object.entries(PII_TYPES).map(([code, def]) => `
<div class="policy-item">
  <span>${escapeHtml(def.label)}</span>
  <select data-type="${code}">
    ${Object.entries(ACTION_LABELS).map(([a, label]) =>
    `<option value="${a}"${session.typePolicies[code] === a ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
  </select>
</div>`).join('');
}

function bindSettingsEvents() {
  $('#policy-list').addEventListener('change', (e) => {
    const type = e.target.dataset.type;
    if (!type) return;
    session.typePolicies[type] = e.target.value;
    savePolicies();
    if (session.parsed) syncReview();
  });

  // AI 설정
  $('#ai-enabled').addEventListener('change', (e) => {
    aiSettings.enabled = e.target.checked;
    saveAiSettings();
    refreshAiAvailability();
  });
  $('#ai-endpoint').addEventListener('change', (e) => {
    aiSettings.endpoint = e.target.value.trim() || DEFAULT_ENDPOINT;
    $('#ai-endpoint').value = aiSettings.endpoint;
    saveAiSettings();
  });
  $('#ai-model').addEventListener('change', (e) => {
    aiSettings.model = e.target.value.trim() || DEFAULT_MODEL;
    $('#ai-model').value = aiSettings.model;
    saveAiSettings();
  });

  $('#btn-ai-test').addEventListener('click', async () => {
    const out = $('#ai-test-result');
    out.className = 'test-result';
    out.textContent = '확인 중…';
    const result = await checkAvailability({ endpoint: aiSettings.endpoint, model: aiSettings.model });
    if (result.models?.length) {
      $('#ai-model-list').innerHTML = result.models.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
    }
    if (result.available) {
      out.className = 'test-result ok';
      out.textContent = `연결됨 — Ollama ${result.version} · ${aiSettings.model}`;
    } else {
      out.className = 'test-result bad';
      out.textContent = result.message || '연결할 수 없습니다.';
    }
    refreshAiAvailability();
  });

  $('#btn-add-rule').addEventListener('click', () => {
    const name = $('#rule-name').value.trim();
    const pattern = $('#rule-pattern').value.trim();
    if (!name || !pattern) {
      toast('규칙 이름과 정규표현식을 입력하십시오.', true);
      return;
    }
    try {
      new RegExp(pattern, 'g'); // 정규식 사전 검증
    } catch {
      toast('올바르지 않은 정규표현식입니다.', true);
      return;
    }
    userRules.push({ name, pattern, type: 'CUSTOM' });
    renderRuleList();
    $('#rule-name').value = '';
    $('#rule-pattern').value = '';
    toast('규칙을 추가했습니다. 다음 분석부터 적용됩니다.');
  });

  $('#rule-list').addEventListener('click', (e) => {
    if (!e.target.classList.contains('rule-delete')) return;
    userRules.splice(Number(e.target.dataset.index), 1);
    renderRuleList();
  });

  // 설정 초기화 (FR-804)
  $('#btn-reset-settings').addEventListener('click', () => {
    try {
      localStorage.removeItem(POLICY_STORAGE_KEY);
      localStorage.removeItem(AI_STORAGE_KEY);
    } catch { /* 무시 */ }
    session.typePolicies = session.defaultPolicies();
    aiSettings = { enabled: true, endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL };
    userRules = [];
    loadAiSettings();
    renderPolicyList();
    renderRuleList();
    refreshAiAvailability();
    toast('설정을 초기 상태로 되돌렸습니다.');
  });
}

function renderRuleList() {
  $('#rule-list').innerHTML = userRules
    .map((r, i) => `<li><strong>${escapeHtml(r.name)}</strong> <code>${escapeHtml(r.pattern)}</code>`
      + `<span class="sp"></span><button class="btn tiny rule-delete" data-index="${i}">삭제</button></li>`)
    .join('');
}

// ---------- 오류 표시 (개인정보 원문 미포함, NFR-003) ----------

function showError(err) {
  const message = err instanceof AppError ? err.message : '처리 중 오류가 발생했습니다. 다시 시도해 주십시오.';
  toast(message, true);
}

// 페이지 이탈 시 임시 데이터 정리 (FR-705)
window.addEventListener('beforeunload', () => {
  stopAiPass();
  session.dispose();
});

init();
