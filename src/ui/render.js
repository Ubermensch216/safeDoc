// 결과 화면 및 보조 UI 렌더링
// (문서 미리보기는 highlight.js, 후보 목록은 candidateList.js가 담당한다)

import { escapeHtml } from './dom.js';
import { PII_TYPES, ACTION_LABELS } from '../detect/types.js';
import { PREVIEW_CHAR_LIMIT } from './highlight.js';

// 처리 후 텍스트에서 치환된 부분 강조 (FR-602)
export function renderAfterHtml(afterText, applied) {
  let html = '';
  let searchFrom = 0;
  const view = afterText.length > PREVIEW_CHAR_LIMIT ? afterText.slice(0, PREVIEW_CHAR_LIMIT) : afterText;
  for (const c of applied) {
    const idx = view.indexOf(c.replacementText, searchFrom);
    if (idx < 0) continue;
    html += escapeHtml(view.slice(searchFrom, idx));
    html += `<mark class="replaced">${escapeHtml(c.replacementText)}</mark>`;
    searchFrom = idx + c.replacementText.length;
  }
  html += escapeHtml(view.slice(searchFrom));
  if (afterText.length > PREVIEW_CHAR_LIMIT) html += '\n<span class="muted">… 일부만 표시</span>';
  return html;
}

// 유형별 필터 칩 (FR-406 일괄처리 진입점)
export function renderTypeChips(candidates, active) {
  const counts = new Map();
  let aiCount = 0;
  let disputedCount = 0;
  for (const c of candidates) {
    counts.set(c.type, (counts.get(c.type) || 0) + 1);
    if (c.aiOnly) aiCount += 1;
    if (c.aiDisputed) disputedCount += 1;
  }

  // 필터가 없는 상태가 곧 "전체"다. 아무것도 눌리지 않은 것처럼 보이면 안 된다.
  const noFilter = !active.type && !active.source;
  const chip = (key, label, n, extraClass = '') => {
    const isActive = key === 'all' ? noFilter : (active.type === key || active.source === key);
    // 토글 버튼이므로 눌림 상태를 aria-pressed로 알린다 (색만으로는 전달되지 않는다)
    return `<button class="chip ${extraClass}${isActive ? ' active' : ''}" data-chip="${key}"`
      + ` aria-pressed="${isActive}" aria-label="${escapeHtml(label)} ${n}건">`
      + `${escapeHtml(label)}<span class="n">${n}</span></button>`;
  };

  let html = chip('all', '전체', candidates.length);
  // 검토가 필요한 것부터 앞에 둔다
  if (aiCount > 0) html += chip('ai', 'AI 발견', aiCount, 'ai-chip');
  if (disputedCount > 0) html += chip('disputed', 'AI 오탐 의심', disputedCount, 'ai-chip');
  for (const [code, def] of Object.entries(PII_TYPES)) {
    const n = counts.get(code) || 0;
    if (n > 0) html += chip(code, def.label, n);
  }
  return html;
}

// 파싱 메타정보 표시 (FR-104)
const META_LABELS = {
  sheetCount: '시트', sheetNames: '시트명', paragraphCount: '문단', tableCount: '표',
  sectionCount: '구역', pageCount: '쪽', rowCount: '행', columnCount: '열',
  lineCount: '줄', charCount: '글자', encoding: '인코딩', delimiter: '구분자', hasHeader: '머리글',
};

export function renderDocMeta(file, parsed) {
  const facts = [`${file.ext.toUpperCase()}`, `${(file.size / 1024).toFixed(1)}KB`];
  for (const [key, value] of Object.entries(parsed.meta || {})) {
    if (value === undefined || value === null || value === '') continue;
    const label = META_LABELS[key];
    if (!label) continue;
    if (typeof value === 'boolean') facts.push(`${label} ${value ? '있음' : '없음'}`);
    else if (key === 'charCount' || key === 'lineCount' || key === 'rowCount') facts.push(`${label} ${Number(value).toLocaleString()}`);
    else if (typeof value === 'number') facts.push(`${label} ${value}`);
    else facts.push(`${label} ${value}`);
  }
  return `<strong>${escapeHtml(file.name)}</strong>`
    + facts.map((f) => `<span class="sep">·</span><span>${escapeHtml(String(f))}</span>`).join('');
}

// 처리결과 요약 (FR-606)
export function renderSummaryHtml(summary) {
  const stat = (v, k, cls = '') => `<div class="stat ${cls}"><span class="v">${v}</span><span class="k">${k}</span></div>`;

  const typeRows = Object.entries(summary.typeCounts)
    .map(([t, n]) => `<tr><td>${escapeHtml(PII_TYPES[t]?.label || t)}</td><td>${n}건</td></tr>`)
    .join('');
  const actionRows = Object.entries(summary.actionCounts)
    .map(([a, n]) => `<tr><td>${escapeHtml(ACTION_LABELS[a] || a)}</td><td>${n}건</td></tr>`)
    .join('');

  const ai = summary.ai;
  let aiHtml = '';
  if (ai && ai.enabled) {
    aiHtml = `<p class="muted">AI 탐지: ${escapeHtml(ai.model)} · 추가 발견 <strong>${ai.addedCount}</strong>건 · `
      + `규칙과 일치 ${ai.confirmedCount}건 · 오탐 의심 표시 ${ai.disputedCount}건 · `
      + `${ai.chunksCompleted}/${ai.chunksPlanned}구간 · ${(ai.elapsedMs / 1000).toFixed(1)}초`
      + `${ai.rejectedHallucinations > 0 ? ` · 검증 실패 폐기 ${ai.rejectedHallucinations}건` : ''}</p>`;
  } else {
    aiHtml = '<p class="muted">AI 탐지: 사용하지 않음 (규칙 기반으로만 처리)</p>';
  }

  return `
<p>원본 <strong>${escapeHtml(summary.sourceFileName)}</strong> → 결과 <strong>${escapeHtml(summary.resultFileName)}</strong></p>
<div class="stat-row">
  ${stat(summary.detectedCount, '탐지')}
  ${stat(summary.processedCount, '처리', 'accent')}
  ${stat(summary.excludedCount, '제외', summary.excludedCount > 0 ? 'warn' : '')}
  ${stat(summary.manuallyAddedCount, '수동 추가')}
  ${stat(summary.aiAddedCount || 0, 'AI 발견', 'accent')}
</div>
<div class="result-tables">
  <table><thead><tr><th>개인정보 유형</th><th>처리 건수</th></tr></thead>
    <tbody>${typeRows || '<tr><td colspan="2">없음</td></tr>'}</tbody></table>
  <table><thead><tr><th>처리방식</th><th>건수</th></tr></thead>
    <tbody>${actionRows || '<tr><td colspan="2">없음</td></tr>'}</tbody></table>
</div>
${aiHtml}
<p class="muted">프로그램 ${escapeHtml(summary.programVersion)} · 탐지규칙 ${escapeHtml(summary.ruleVersion)} · ${new Date(summary.processedAt).toLocaleString('ko-KR')}</p>`;
}
