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
  const stat = (v, k, cls = '') => `<div class="stat ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  return `
<p class="result-file" title="${escapeHtml(summary.resultFileName)}">결과 파일 <strong>${escapeHtml(summary.resultFileName)}</strong></p>
<div class="stat-row">
  ${stat(summary.detectedCount, '탐지')}
  ${stat(summary.processedCount, '처리', 'accent')}
  ${stat(summary.excludedCount, '제외', summary.excludedCount > 0 ? 'warn' : '')}
  ${stat(summary.manuallyAddedCount, '수동 추가')}
  ${stat(summary.aiAddedCount || 0, 'AI 발견')}
</div>`;
}

// 유형·처리방식별 내역과 AI 사용 기록
export function renderSummaryDetailHtml(summary) {
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
      + `${ai.splitChunks > 0 ? ` · 응답이 잘려 나눠 다시 검사 ${ai.splitChunks}회` : ''}`
      + `${ai.rejectedHallucinations > 0 ? ` · 검증 실패 폐기 ${ai.rejectedHallucinations}건` : ''}`
      + `${ai.skippedCommonValues > 0 ? ` · 고빈도 값 제외 ${ai.skippedCommonValues}건(규칙 탐지가 처리)` : ''}</p>`;
  } else {
    aiHtml = '<p class="muted">AI 탐지: 사용하지 않음 (규칙 기반으로만 처리)</p>';
  }

  return `
<table><thead><tr><th>개인정보 유형</th><th>건수</th></tr></thead>
  <tbody>${typeRows || '<tr><td colspan="2">없음</td></tr>'}</tbody></table>
<table><thead><tr><th>처리방식</th><th>건수</th></tr></thead>
  <tbody>${actionRows || '<tr><td colspan="2">없음</td></tr>'}</tbody></table>
<p class="muted">원본: ${escapeHtml(summary.sourceFileName)}</p>
${aiHtml}
<p class="muted">처리 일시: ${new Date(summary.processedAt).toLocaleString('ko-KR')}</p>`;
}
