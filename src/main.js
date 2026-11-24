// 앱 진입점 — 화면 전환·세션 오케스트레이션 (개인정보 원문은 콘솔·저장소에 기록하지 않는다)

import './style.css';
import brandLogoUrl from './assets/safedoc-logo.png';
import { PROGRAM_NAME, PROGRAM_VERSION } from './version.js';
import { RULE_VERSION } from './detect/engine.js';
import { PII_TYPES, ACTION_LABELS } from './detect/types.js';
import { WorkSession } from './core/session.js';
import { REVIEW_STATES, ensureReviewStates, reviewCounts } from './core/reviewState.js';
import { validateAndRead, downloadBlob, resultFileName } from './core/fileManager.js';
import { parseDocument, analyze, buildResult } from './core/analyzer.js';
import { applyToText } from './core/deidentify.js';
import { buildMappingTable, mappingTableToBlob } from './core/mappingTable.js';
import { buildSummary, summaryToBlob } from './core/summary.js';
import { AppError } from './core/errors.js';
import { $, $$, toast, showError, showScreen, escapeHtml } from './ui/dom.js';
import { buildPreviewHtml } from './ui/highlight.js';
import { renderAfterHtml, renderSummaryHtml, renderDocMeta } from './ui/render.js';
import { loadStoredPolicies } from './ui/storage.js';
import { AiController } from './ui/aiController.js';
import { ReviewController } from './ui/reviewController.js';
import { bindRestoreEvents } from './ui/restoreController.js';
import { createSettingsController } from './ui/settingsController.js';

// 배포판은 단일 HTML만 서빙하므로 로고도 번들 안의 data URL로 주입한다.
// 같은 소스를 배너와 브라우저/홈 화면 아이콘에 사용해 실행 경로에 영향을 받지 않게 한다.
for (const logo of document.querySelectorAll('.brand-logo')) logo.src = brandLogoUrl;
for (const icon of document.querySelectorAll('[data-brand-icon]')) icon.href = brandLogoUrl;

const session = new WorkSession();
let analyzeCancelled = false;

let review = null;
let ai = null;
let settings = null;

// ---------- 초기화 ----------

function init() {
  document.title = PROGRAM_NAME;

  loadStoredPolicies(session.typePolicies);

  review = new ReviewController({
    session,
    onOpenConfirm: () => {
      renderConfirmScreen();
      showScreen('screen-confirm');
    },
    onCancelAnalyze: () => { analyzeCancelled = true; },
    onCancelAi: async () => {
      await ai.stop({ wait: true });
      ai.setBadge('off', 'AI 중단됨');
      toast('AI 탐지를 중단했습니다. 규칙 기반 결과는 그대로 유지됩니다.');
    },
  });

  settings = createSettingsController({
    session,
    onPoliciesChanged: () => {
      review.setPolicies(session.typePolicies);
      if (session.parsed) review.sync();
    },
    onAiSettingsChanged: () => ai.refreshAvailability(),
  });

  ai = new AiController({
    session,
    getSettings: () => settings.getAiSettings(),
    onSyncReview: (opts) => review.sync(opts),
    onSchedulePreview: (text, candidates) => review.schedulePreview(text, candidates),
    onRenderPreviewNow: (text, candidates) => review.renderPreviewNow(text, candidates),
  });

  review.setPolicies(session.typePolicies);
  populateSelects();

  review.bind();
  settings.bind();
  bindTabEvents();
  bindUploadEvents();
  bindConfirmAndResultEvents();
  bindRestoreEvents();

  ai.refreshAvailability();
}

function populateSelects() {
  const options = Object.entries(PII_TYPES)
    .map(([code, def]) => `<option value="${code}">${escapeHtml(def.label)}</option>`)
    .join('');
  $('#search-type').innerHTML = options;
  $('#add-type').innerHTML = options;
  $('#search-type').value = 'CUSTOM';
  $('#add-type').value = 'CUSTOM';

  $('#type-filter').innerHTML = `<option value="">전체 유형</option>${options}`;
  $('#bulk-action').innerHTML = Object.entries(ACTION_LABELS)
    .map(([code, label]) => `<option value="${code}">${escapeHtml(label)}</option>`)
    .join('');
}

// ---------- 탭 전환 ----------

function activateTab(btn, { focus = false } = {}) {
  $$('.tab-btn').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $$('.tab-panel').forEach((p) => p.classList.remove('active'));
  $(`#tab-${btn.dataset.tab}`).classList.add('active');

  const titles = {
    deidentify: ['비식별 작업', session.parsed ? '개인정보 검토' : '새 비식별 작업'],
    restore: ['도구', '원본 복원'],
    settings: ['관리', '설정'],
  };
  const [eyebrow, title] = titles[btn.dataset.tab];
  const pageEyebrow = $('#page-eyebrow');
  if (pageEyebrow) pageEyebrow.textContent = eyebrow;
  const pageTitle = $('#page-title');
  if (pageTitle) pageTitle.textContent = title;
  if (focus) btn.focus();
}

function bindTabEvents() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn));
  });
  $('#btn-new-task').addEventListener('click', () => {
    activateTab($('#tabbtn-deidentify'));
    if (!session.parsed || window.confirm('현재 작업 데이터를 지우고 새 작업을 시작하시겠습니까?')) newSession();
  });
}

// ---------- 업로드 및 분석 (FR-101, FR-102) ----------

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
  ai.stop();
  resetWorkUi();
  session.reset();
  loadStoredPolicies(session.typePolicies);
  review.setPolicies(session.typePolicies);
  analyzeCancelled = false;
  ai.resetStats();

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
  $('#analyze-progressbar').setAttribute('aria-valuenow', String(Math.round(percent)));
  $('#analyze-status').textContent = statusText;
  const order = ['open', 'extract', 'rules', 'prepare'];
  const activeAt = percent < 35 ? 0 : percent < 65 ? 1 : percent < 100 ? 2 : 3;
  order.forEach((key, index) => {
    const item = $(`[data-analysis="${key}"]`);
    item.classList.toggle('done', index < activeAt || percent === 100);
    item.classList.toggle('active', index === activeAt && percent < 100);
    item.querySelector('.analysis-icon').textContent = index < activeAt || percent === 100 ? '✓' : (index === activeAt ? '●' : '○');
  });
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

    session.candidates = analyze(session.parsed, settings.getUserRules());
    ensureReviewStates(session.candidates);
    setProgress(100, '탐지 완료');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    $('#doc-meta').innerHTML = renderDocMeta(session.file, session.parsed);
    review.renderPreviewNow(session.parsed.text, session.candidates);
    review.sync({ resort: true });
    showScreen('screen-review');

    // 규칙 결과를 먼저 보여준 뒤 AI 탐지를 백그라운드로 시작한다 (계획 C-7)
    ai.startPass();
  } catch (err) {
    showError(err);
    session.dispose();
    showScreen('screen-main');
  }
}

// ---------- 비식별 확인·실행 및 결과 ----------

function renderConfirmScreen() {
  const counts = reviewCounts(session.candidates);
  $('#confirm-process-count').textContent = counts.process.toLocaleString();
  $('#confirm-exclude-count').textContent = counts.exclude.toLocaleString();
  $('#confirm-pending-count').textContent = counts.pending.toLocaleString();

  const actionCounts = {};
  for (const candidate of session.candidates.filter((c) => c.reviewState === REVIEW_STATES.PROCESS)) {
    const action = candidate.action || session.typePolicies[candidate.type] || 'REPLACE';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }
  $('#confirm-action-counts').innerHTML = Object.entries(ACTION_LABELS).map(([action, label]) =>
    `<div class="action-count-row"><span>${escapeHtml(label)}</span><strong>${(actionCounts[action] || 0).toLocaleString()}개</strong></div>`).join('');

  const aiWarning = $('#confirm-ai-warning');
  const aiRunning = ai.isRunning();
  aiWarning.hidden = !aiRunning;
  if (aiRunning) {
    aiWarning.textContent = 'AI 추가 탐지가 아직 진행 중입니다. 지금 실행하면 AI 검사를 중단하고 미완료 상태를 처리 기록에 남깁니다.';
  }
  $('#final-confirm').checked = false;
  $('#btn-execute').disabled = true;
}

function renderChangeList(applied) {
  if (applied.length === 0) return '<p class="empty-state">변경된 항목이 없습니다.</p>';
  const header = `
    <div class="change-header" aria-hidden="true">
      <span>유형</span>
      <span>처리 전 (원문)</span>
      <span></span>
      <span>처리 후 (비식별)</span>
    </div>`;
  const rows = applied.map((item) => {
    const typeLabel = PII_TYPES[item.type]?.label || item.type;
    return `
      <div class="change-item">
        <span class="change-type">${escapeHtml(typeLabel)}</span>
        <code class="change-before-val" title="${escapeHtml(item.originalText)}">${escapeHtml(item.originalText)}</code>
        <span class="change-arrow" aria-hidden="true">→</span>
        <code class="change-after-val" title="${escapeHtml(item.replacementText)}">${escapeHtml(item.replacementText)}</code>
      </div>`;
  }).join('');
  return header + rows;
}

async function executeDeidentify() {
  const executeButton = $('#btn-execute');
  const startedAt = new Date();
  executeButton.disabled = true;
  try {
    // AI가 아직 돌고 있으면 멈춘 상태로 결과를 만든다 (미완료 사실은 요약에 기록된다)
    await ai.stop({ wait: true });
    const aiStats = ai.stats;

    const { text: afterText, applied } = applyToText(session.parsed.text, session.candidates, session);
    const resultName = resultFileName(session.file.name);
    const blob = await buildResult(session.parsed, afterText, applied);

    session.excludedCount = session.candidates.filter((c) => !c.selected).length;
    const summary = buildSummary({
      session, applied, startedAt, finishedAt: new Date(), resultName, aiStats,
    });
    const shouldCreateMapping = document.querySelector('input[name="mapping-choice"]:checked')?.value === 'yes';
    const mappingTable = shouldCreateMapping
      ? buildMappingTable(session.file.name, resultName, applied, aiStats)
      : null;

    session.result = { blob, fileName: resultName, afterText, applied, summary, mappingTable, mappingCreated: shouldCreateMapping };

    // AI 미완료 경고 — 완료된 것으로 오인하면 유출로 이어진다
    const aiWarn = $('#ai-incomplete-warning');
    if (aiStats && !aiStats.completed) {
      const reason = aiStats.stopReason === 'aborted'
        ? '사용자가 중단'
        : (aiStats.stopReason === 'offline' ? 'AI 엔진 연결 끊김' : '일부 구간 실패');
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

    const beforeHtml = buildPreviewHtml(session.parsed.text, session.candidates.filter((c) => c.selected));
    const afterHtml = renderAfterHtml(afterText, applied);
    $('#result-summary').innerHTML = renderSummaryHtml(summary);
    $('#compare-split-before').innerHTML = beforeHtml;
    $('#compare-split-after').innerHTML = afterHtml;
    $('#compare-changes').innerHTML = renderChangeList(applied);
    $('#btn-download-mapping').hidden = !shouldCreateMapping;
    $('#mapping-result-note').textContent = shouldCreateMapping
      ? '개인정보 원문이 포함된 민감정보입니다. 결과 문서와 분리 보관하십시오.'
      : '대응표를 생성하지 않았습니다.';
    showScreen('screen-result');
  } catch (err) {
    showError(err);
    executeButton.disabled = false;
  }
}

function bindConfirmAndResultEvents() {
  // 최종 확인 후 실행 (FR-410)
  $('#final-confirm').addEventListener('change', (e) => {
    $('#btn-execute').disabled = !e.target.checked;
  });
  $('#btn-execute').addEventListener('click', executeDeidentify);

  $('#btn-download-result').addEventListener('click', () => {
    if (!session.result) return;
    downloadBlob(session.result.blob, session.result.fileName);
  });

  $('#btn-download-mapping').addEventListener('click', () => {
    if (!session.result?.mappingTable) return;
    if (!window.confirm('대응표 파일에는 개인정보 원문이 평문으로 포함됩니다.\n안전한 위치에 보관할 수 있는 경우에만 다운로드하십시오.\n\n계속하시겠습니까?')) return;
    const name = resultFileName(session.file.name, '_대응표').replace(/\.[^.]+$/, '.json');
    downloadBlob(mappingTableToBlob(session.result.mappingTable), name);
  });

  $('#btn-download-summary').addEventListener('click', () => {
    if (!session.result) return;
    const name = resultFileName(session.file.name, '_처리요약').replace(/\.[^.]+$/, '.json');
    downloadBlob(summaryToBlob(session.result.summary), name);
  });

  // 변경 항목/나란히 비교 토글
  $$('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $('#compare-changes').hidden = btn.dataset.compare !== 'changes';
      $('#compare-side-by-side').hidden = btn.dataset.compare !== 'side-by-side';
    });
  });
}

function newSession() {
  ai.stop();
  session.dispose();
  session.reset();
  ai.resetStats();
  loadStoredPolicies(session.typePolicies);
  review.setPolicies(session.typePolicies);
  resetWorkUi();
  showScreen('screen-main');
  ai.refreshAvailability();
}

function resetWorkUi() {
  review.reset();
  $('#compare-changes').innerHTML = '';
  $('#compare-split-before').innerHTML = '';
  $('#compare-split-after').innerHTML = '';
  $('#result-summary').innerHTML = '';
  $('#doc-meta').innerHTML = '';
  $('#final-confirm').checked = false;
  $('#btn-execute').disabled = true;
  document.querySelector('input[name="mapping-choice"][value="no"]').checked = true;
  $('#btn-download-mapping').hidden = true;
  $('#ai-incomplete-warning').hidden = true;
  $('#unprocessed-warning').hidden = true;
}

// 페이지 이탈 시 임시 데이터 정리 (FR-705)
window.addEventListener('beforeunload', () => {
  ai?.stop();
  session.dispose();
});

init();
