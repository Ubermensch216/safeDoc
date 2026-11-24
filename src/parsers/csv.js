// CSV 파서 (기술명세서 Ⅳ-3)
// 원문 텍스트를 그대로 유지한 채 셀 위치만 기록하여, 치환 시 구분자·셀 구조가 보존된다.

import { decodeBuffer, encodeText } from './encoding.js';
import { AppError } from '../core/errors.js';
import { inferColumnTypes, findHeaderRow, extractTabularCandidates } from './tabular.js';

export { inferColumnTypes };

// 구분자 판별: 첫 행 기준 쉼표/탭/세미콜론 출현 수 비교
export function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
  };
  let best = ',';
  for (const [d, n] of Object.entries(counts)) {
    if (n > counts[best]) best = d;
  }
  return best;
}

// 셀 단위 토큰화 — 각 셀 내용의 원문 내 위치(start/end)를 기록
// 큰따옴표 셀·셀 내 줄바꿈 지원
export function tokenizeCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let i = 0;
  const len = text.length;

  while (i <= len) {
    if (i === len) {
      if (row.length > 0 || rows.length === 0) rows.push(row);
      break;
    }
    const ch = text[i];
    if (ch === '"') {
      // 따옴표 셀: 내부 시작 위치부터 닫는 따옴표 전까지
      const contentStart = i + 1;
      let j = contentStart;
      while (j < len) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      row.push({ value: text.slice(contentStart, j).replace(/""/g, '"'), start: contentStart, end: j, quoted: true });
      i = j + 1;
      // 따옴표 뒤 구분자/줄바꿈 소비
      if (text[i] === delimiter) i += 1;
      else if (text[i] === '\r' && text[i + 1] === '\n') { rows.push(row); row = []; i += 2; }
      else if (text[i] === '\n') { rows.push(row); row = []; i += 1; }
    } else {
      let j = i;
      while (j < len && text[j] !== delimiter && text[j] !== '\n' && text[j] !== '\r') j += 1;
      row.push({ value: text.slice(i, j), start: i, end: j, quoted: false });
      if (j >= len) { rows.push(row); break; }
      if (text[j] === delimiter) i = j + 1;
      else if (text[j] === '\r' && text[j + 1] === '\n') { rows.push(row); row = []; i = j + 2; }
      else { rows.push(row); row = []; i = j + 1; }
    }
  }
  return rows;
}

export function parseCsv(buffer) {
  let decoded;
  try {
    decoded = decodeBuffer(buffer);
  } catch {
    throw new AppError('E006');
  }
  const text = decoded.text;
  const delimiter = detectDelimiter(text);
  const rows = tokenizeCsv(text, delimiter);

  const tableRows = rows.map((r) => r.map((cell, col) => ({
    col, text: cell.value, start: cell.start, end: cell.end,
  })));
  const { headerRowIndex, headerHints } = findHeaderRow(tableRows);
  const hasHeader = headerRowIndex >= 0;
  const headerRow = hasHeader ? rows[headerRowIndex] : [];
  const columnTypeHints = hasHeader
    ? headerRow.map((_, col) => headerHints.get(col) || null)
    : [];

  return {
    format: 'csv',
    text,
    encoding: decoded.encoding,
    bom: decoded.bom,
    delimiter,
    rows,
    hasHeader,
    headerRowIndex,
    columnTypeHints,
    meta: {
      rowCount: rows.length,
      columnCount: (rows[0] || []).length,
      delimiter: delimiter === '\t' ? '탭' : delimiter,
      encoding: decoded.encoding.toUpperCase(),
      hasHeader,
    },
  };
}

// 헤더 유형 힌트·내용 일관성 기반 열 단위 후보 생성 (엔진 결과와 병합 후 중첩 정리)
export function columnCandidates(parsed, engineCandidates = []) {
  const tableRows = (parsed.rows || []).map((r) => r.map((cell, col) => ({
    col, text: cell.value, start: cell.start, end: cell.end,
  })));
  return extractTabularCandidates([{ name: 'csv', rows: tableRows }], engineCandidates);
}

export function buildCsvResult(parsed, processedText) {
  const bytes = encodeText(processedText, parsed.encoding, parsed.bom);
  return new Blob([bytes], { type: 'text/csv' });
}
