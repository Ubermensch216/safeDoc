// 앱 진입점 — 화면 전환·이벤트 연결 (개인정보 원문은 콘솔·저장소에 기록하지 않는다)

import './style.css';
import { PROGRAM_NAME, PROGRAM_VERSION } from './version.js';
import { RULE_VERSION } from './detect/engine.js';
import { PII_TYPES } from './detect/types.js';
import { WorkSession } from './core/session.js';
import { validateAndRead, downloadBlob, resultFileName } from './core/fileManager.js';
import { parseDocument, analyze, buildResult, restoreDocument } from './core/analyzer.js';
import { applyToText } from './core/deidentify.js';
import { buildMappingTable, mappingTableToBlob, parseMappingTable } from './core/mappingTable.js';
import { buildSummary, summaryToBlob } from './core/summary.js';
import { AppError } from './core/errors.js';
import { $, $$, toast, showScreen, textOffsetIn, escapeHtml } from './ui/dom.js';
import {
  renderPreviewHtml, renderCandidateListHtml, renderAfterHtml, renderSummaryHtml,
} from './ui/render.js';

const session = new WorkSession();
let userRules = []; // 사용자 정의 탐지 규칙 (세션 한정, FR-803)
let analyzeCancelled = false;

// ---------- 초기화 ----------

function init() {
  $('#version-info').textContent = `v${PROGRAM_VERSION} (탐지규칙 v${RULE_VERSION})`;
  document.title = PROGRAM_NAME;
  loadPolicies();
  populateTypeSelects();
  renderPolicyList();
  bindTabEvents();
  bindUploadEvents();
  bindReviewEvents();
  bindResultEvents();
  bindRestoreEvents();
  bindSettingsEvents();
}

// 개인정보가 포함되지 않는 일반 설정(유형별 기본 처리방식)만 저장 (FR-805)
const POLICY_STORAGE_KEY = 'safedoc-type-policies';

function loadPolicies() {
  try {
    const raw = localStorage.getItem(POLICY_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const [type, action] of Object.entries(saved)) {
        if (session.typePolicies[type]) session.typePolicies[type] = action;
      }
    }
  } catch { /* 설정 손상 시 기본값 사용 */ }
}

function savePolicies() {
  try {
    localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(session.typePolicies));
  } catch { /* 저장 실패는 무시 */ }
}

function populateTypeSelects() {
  const options = Object.entries(PII_TYPES)
    .map(([code, def]) => `<option value="${code}">${def.label}</option>`)
    .join('');
  $('#search-type').innerHTML = options;
  $('#add-type').innerHTML = options;
  $('#search-type').value = 'CUSTOM';
  $('#add-type').value = 'CUSTOM';
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
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
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
  session.reset();
  loadPolicies();
  analyzeCancelled = false;

  try {
    const read = await validateAndRead(file);
    session.file = read;

    // 대용량 경고 (FR-207)
    if (read.size > 10 * 1024 * 1024) {
      toast('10MB를 초과하는 문서는 처리 속도가 느려질 수 있습니다.');
    }

    showScreen('screen-analyze');
    $('#analyze-file-info').innerHTML =
      `파일명: <strong>${escapeHtml(read.name)}</strong> · 형식: ${read.ext.toUpperCase()} · 크기: ${(read.size / 1024).toFixed(1)}KB`;
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
    setProgress(10, '파일을 읽는 중...');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    session.parsed = await parseDocument(session.file);
    setProgress(40, '문서 내용을 추출했습니다. 개인정보를 탐지하는 중...');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    session.candidates = analyze(session.parsed, userRules);
    setProgress(90, '탐지 결과를 정리하는 중...');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    setProgress(100, '분석 완료');
    // 파일정보 표시 (FR-104)
    const meta = session.parsed.meta;
    const metaText = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(' · ');
    void metaText;
    renderReview();
    showScreen('screen-review');
  } catch (err) {
    showError(err);
    session.dispose();
    showScreen('screen-main');
  }
}

// ---------- 검토 화면 ----------

function renderReview() {
  $('#preview').innerHTML = renderPreviewHtml(session.parsed.text, session.candidates);
  $('#candidate-list').innerHTML = renderCandidateListHtml(session.candidates, session.typePolicies);
  const total = session.candidates.length;
  const selected = session.candidates.filter((c) => c.selected).length;
  $('#detect-count-badge').textContent = `탐지 ${total}건 / 처리 대상 ${selected}건`;
}

function pushHistory() {
  // 되돌리기용 스냅샷 (FR-409) — 메모리에서만 유지
  session.history.push(JSON.stringify(session.candidates));
  if (session.history.length > 50) session.history.shift();
}

function findCandidate(id) {
  return session.candidates.find((c) => c.id === id);
}

function bindReviewEvents() {
  // 미리보기에서 후보 클릭 → 목록 강조 이동
  $('#preview').addEventListener('click', (e) => {
    const mark = e.target.closest('mark.pii');
    if (!mark) return;
    $$('mark.pii.focused').forEach((m) => m.classList.remove('focused'));
    mark.classList.add('focused');
    const item = $(`.candidate-item[data-id="${mark.dataset.id}"]`);
    if (item) {
      item.scrollIntoView({ block: 'center', behavior: 'smooth' });
      item.style.outline = '2px solid var(--primary)';
      setTimeout(() => { item.style.outline = ''; }, 1200);
    }
  });

  // 후보 목록 상호작용 (위임)
  $('#candidate-list').addEventListener('click', (e) => {
    const item = e.target.closest('.candidate-item');
    if (!item) return;
    const c = findCandidate(item.dataset.id);
    if (!c) return;

    if (e.target.classList.contains('c-exclude')) {
      // 탐지 제외/포함 (FR-403)
      pushHistory();
      c.selected = !c.selected;
      renderReview();
    } else if (e.target.classList.contains('c-same')) {
      // 동일값 일괄 선택 (FR-406)
      pushHistory();
      const targetState = !c.selected ? true : c.selected;
      let count = 0;
      for (const other of session.candidates) {
        if (other.originalText === c.originalText && other.type === c.type) {
          other.selected = targetState;
          other.action = c.action;
          count += 1;
        }
      }
      renderReview();
      toast(`동일한 값 ${count}건에 일괄 적용했습니다.`);
    } else if (e.target.classList.contains('c-check')) {
      pushHistory();
      c.selected = e.target.checked;
      renderReview();
    }
  });

  $('#candidate-list').addEventListener('change', (e) => {
    const item = e.target.closest('.candidate-item');
    if (!item) return;
    const c = findCandidate(item.dataset.id);
    if (!c) return;
    if (e.target.classList.contains('c-type')) {
      // 유형 변경 (FR-405)
      pushHistory();
      c.type = e.target.value;
      c.action = null; // 새 유형의 기본 정책 적용
      renderReview();
    } else if (e.target.classList.contains('c-action')) {
      // 개별 처리방식 (FR-407)
      pushHistory();
      c.action = e.target.value;
    }
  });

  // 전체 선택/해제
  $('#btn-select-all').addEventListener('click', () => {
    pushHistory();
    session.candidates.forEach((c) => { c.selected = true; });
    renderReview();
  });
  $('#btn-deselect-all').addEventListener('click', () => {
    pushHistory();
    session.candidates.forEach((c) => { c.selected = false; });
    renderReview();
  });

  // 검색 일괄 지정 (FR-408)
  $('#btn-search-add').addEventListener('click', () => {
    const term = $('#search-input').value;
    if (!term) {
      toast('검색할 문자열을 입력하십시오.', true);
      return;
    }
    const type = $('#search-type').value;
    pushHistory();
    const added = addCandidatesByText(term, type, 'SEARCH');
    renderReview();
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

    const type = $('#add-type').value;
    pushHistory();
    const ok = addManualCandidate(start, end, type);
    sel.removeAllRanges();
    renderReview();
    toast(ok ? '개인정보로 추가했습니다.' : '기존 후보와 겹치는 영역입니다.', !ok);
  });

  // 되돌리기 (FR-409)
  $('#btn-undo').addEventListener('click', () => {
    const snapshot = session.history.pop();
    if (!snapshot) {
      toast('되돌릴 작업이 없습니다.', true);
      return;
    }
    session.candidates = JSON.parse(snapshot);
    renderReview();
  });

  // 최종 확인 후 실행 (FR-410)
  $('#final-confirm').addEventListener('change', (e) => {
    $('#btn-execute').disabled = !e.target.checked;
  });
  $('#btn-execute').addEventListener('click', executeDeidentify);
  $('#btn-cancel-analyze').addEventListener('click', () => { analyzeCancelled = true; });
}

let manualSeq = 0;
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

// ---------- 비식별 실행 및 결과 ----------

async function executeDeidentify() {
  const startedAt = new Date();
  const executeButton = $('#btn-execute');
  executeButton.disabled = true;
  try {
    const { text: afterText, applied } = applyToText(session.parsed.text, session.candidates, session);
    const resultName = resultFileName(session.file.name);
    const blob = await buildResult(session.parsed, afterText, applied);

    session.excludedCount = session.candidates.filter((c) => !c.selected).length;
    const summary = buildSummary({
      session, applied, startedAt, finishedAt: new Date(), resultName,
    });
    const mappingTable = buildMappingTable(session.file.name, resultName, applied);

    session.result = { blob, fileName: resultName, afterText, applied, summary, mappingTable };

    // 미처리 경고 (FR-608)
    const unprocessed = session.excludedCount;
    const warnBox = $('#unprocessed-warning');
    if (unprocessed > 0) {
      warnBox.textContent = `⚠ 처리하지 않은 개인정보 후보가 ${unprocessed}건 있습니다. 결과 파일에 원문이 남아 있을 수 있으니 확인하십시오.`;
      warnBox.hidden = false;
    } else {
      warnBox.hidden = true;
    }

    $('#result-summary').innerHTML = renderSummaryHtml(summary);
    $('#compare-before').innerHTML = renderPreviewHtml(session.parsed.text, session.candidates.filter((c) => c.selected));
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
    // 대응표에는 개인정보 원문이 포함됨 — 사용자 확인 후 다운로드 (사양 변경 기능)
    if (!window.confirm('대응표 파일에는 개인정보 원문이 평문으로 포함됩니다.\n안전한 위치에 보관할 수 있는 경우에만 다운로드하십시오.\n\n계속하시겠습니까?')) return;
    const name = resultFileName(session.file.name, '_대응표').replace(/\.[^.]+$/, '.json');
    downloadBlob(mappingTableToBlob(session.result.mappingTable), name);
  });

  $('#btn-download-summary').addEventListener('click', () => {
    if (!session.result) return;
    const name = resultFileName(session.file.name, '_처리요약').replace(/\.[^.]+$/, '.json');
    downloadBlob(summaryToBlob(session.result.summary), name);
  });

  // 새 문서 처리 (FR-609)
  $('#btn-new-doc').addEventListener('click', () => {
    session.dispose();
    session.reset();
    loadPolicies();
    resetReviewUi();
    showScreen('screen-main');
  });

  // 작업 종료: 화면·메모리 초기화 (FR-705, 기술명세서 Ⅷ-4)
  $('#btn-finish').addEventListener('click', () => {
    session.dispose();
    session.reset();
    loadPolicies();
    resetReviewUi();
    showScreen('screen-main');
    toast('작업정보를 초기화했습니다.');
  });
}

function resetReviewUi() {
  $('#preview').innerHTML = '';
  $('#candidate-list').innerHTML = '';
  $('#compare-before').innerHTML = '';
  $('#compare-after').innerHTML = '';
  $('#result-summary').innerHTML = '';
  $('#final-confirm').checked = false;
  $('#btn-execute').disabled = true;
  $('#search-input').value = '';
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
        `복원 완료: <strong>${escapeHtml(name)}</strong><br />` +
        `복원된 항목 ${restoredCount}건` +
        (notRestoredCount > 0 ? ` · 복원 불가(마스킹·삭제 처리) ${notRestoredCount}건` : '');
      resultBox.hidden = false;
    } catch (err) {
      showError(err);
    }
  });
}

// ---------- 설정 탭 ----------

function renderPolicyList() {
  const html = Object.entries(PII_TYPES)
    .filter(([code]) => code !== 'CUSTOM' || true)
    .map(([code, def]) => `
<div class="policy-item">
  <span>${def.label}</span>
  <select data-type="${code}">
    <option value="REPLACE"${session.typePolicies[code] === 'REPLACE' ? ' selected' : ''}>유형별 치환</option>
    <option value="MASK_PART"${session.typePolicies[code] === 'MASK_PART' ? ' selected' : ''}>부분 마스킹</option>
    <option value="MASK_ALL"${session.typePolicies[code] === 'MASK_ALL' ? ' selected' : ''}>전체 마스킹</option>
    <option value="DELETE"${session.typePolicies[code] === 'DELETE' ? ' selected' : ''}>삭제</option>
  </select>
</div>`)
    .join('');
  $('#policy-list').innerHTML = html;
}

function bindSettingsEvents() {
  $('#policy-list').addEventListener('change', (e) => {
    const type = e.target.dataset.type;
    if (!type) return;
    session.typePolicies[type] = e.target.value;
    savePolicies();
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
    try { localStorage.removeItem(POLICY_STORAGE_KEY); } catch { /* 무시 */ }
    session.typePolicies = session.defaultPolicies();
    userRules = [];
    renderPolicyList();
    renderRuleList();
    toast('설정을 초기 상태로 되돌렸습니다.');
  });
}

function renderRuleList() {
  $('#rule-list').innerHTML = userRules
    .map((r, i) => `<li><strong>${escapeHtml(r.name)}</strong> <code>${escapeHtml(r.pattern)}</code> <button class="btn tiny rule-delete" data-index="${i}">삭제</button></li>`)
    .join('');
}

// ---------- 오류 표시 (개인정보 원문 미포함, NFR-003) ----------

function showError(err) {
  const message = err instanceof AppError ? err.message : '처리 중 오류가 발생했습니다. 다시 시도해 주십시오.';
  toast(message, true);
}

// 페이지 이탈 시 임시 데이터 정리 (FR-705)
window.addEventListener('beforeunload', () => session.dispose());

init();
