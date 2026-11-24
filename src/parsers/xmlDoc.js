// XLSX·DOCX·HWPX 공통 문서 처리 (기술명세서 Ⅳ-4~6)
// ZIP 내 XML의 텍스트 노드만 직접 수정하여 서식·구조를 보존한다.

import { strFromU8, strToU8 } from 'fflate';
import {
  safeUnzip, rezip, extractSegments, extractXlsxSegments,
  joinSegments, applyToSegments, spliceXml, decodeXmlEntities,
} from './zipUtils.js';
import { AppError } from '../core/errors.js';

// 형식별 구성
const FORMAT_CONFIGS = {
  xlsx: {
    // 공유 문자열 + 시트 인라인 문자열 (숨김 시트 포함 전체 시트 분석)
    requiredEntry: 'xl/workbook.xml',
    targetFiles: (names) => names.filter(
      (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n) || /^xl\/comments\d*\.xml$/.test(n),
    ),
    // <t> (sharedStrings/inlineStr/comments 공통), 셀 단위이므로 문단 구분 없이 항상 줄바꿈
    segmentSpec: { openTag: '<t(?:\\s[^>]*)?>', closeTag: '</t>', paragraphClose: null },
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    meta(entries) {
      const wb = strFromU8(entries['xl/workbook.xml']);
      const sheets = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => m[1]);
      return { sheetCount: sheets.length, sheetNames: sheets.join(', ') };
    },
  },
  docx: {
    requiredEntry: 'word/document.xml',
    targetFiles: (names) => names.filter(
      (n) => n === 'word/document.xml'
        || /^word\/(header|footer)\d+\.xml$/.test(n)
        || n === 'word/footnotes.xml' || n === 'word/endnotes.xml' || n === 'word/comments.xml',
    ),
    // 분리된 텍스트 런(<w:t>)은 문단(</w:p>) 경계가 없으면 결합하여 분석 (기술명세서 Ⅳ-5)
    segmentSpec: { openTag: '<w:t(?:\\s[^>]*)?>', closeTag: '</w:t>', paragraphClose: '</w:p>' },
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    meta(entries) {
      const doc = strFromU8(entries['word/document.xml']);
      return {
        paragraphCount: (doc.match(/<w:p[ >]/g) || []).length,
        tableCount: (doc.match(/<w:tbl>/g) || []).length,
      };
    },
  },
  hwpx: {
    requiredEntry: null, // section 파일 존재로 검증
    targetFiles: (names) => names.filter(
      (n) => /^Contents\/section\d+\.xml$/.test(n) || /^Contents\/header\.xml$/.test(n),
    ),
    // 본문 텍스트 노드 <hp:t>, 문단 </hp:p> (기술명세서 Ⅳ-6)
    segmentSpec: { openTag: '<hp:t(?:\\s[^>]*)?>', closeTag: '</hp:t>', paragraphClose: '</hp:p>' },
    mime: 'application/hwp+zip',
    meta(entries) {
      const sections = Object.keys(entries).filter((n) => /^Contents\/section\d+\.xml$/.test(n));
      return { sectionCount: sections.length };
    },
  },
};

export function parseZipDocument(buffer, format) {
  const config = FORMAT_CONFIGS[format];
  if (!config) throw new AppError('E001');

  const entries = safeUnzip(buffer);
  const names = Object.keys(entries);

  // 확장자와 실제 구조 교차검증
  if (config.requiredEntry && !entries[config.requiredEntry]) throw new AppError('E009');
  const targets = config.targetFiles(names);
  if (format === 'hwpx' && !targets.some((n) => /^Contents\/section\d+\.xml$/.test(n))) {
    throw new AppError('E009');
  }
  if (targets.length === 0) throw new AppError('E009');

  // 대상 XML에서 텍스트 세그먼트 추출
  const files = [];
  for (const path of targets.sort()) {
    const xml = strFromU8(entries[path]);
    let segments;
    if (format === 'xlsx' && /^xl\/worksheets\/sheet\d+\.xml$/.test(path)) {
      segments = extractXlsxSegments(xml);
    } else if (format === 'xlsx' && path === 'xl/sharedStrings.xml') {
      // 동일 <si> 안의 서식 분리 런(<r><t>)은 결합하고 <si> 경계에서만 줄바꿈한다
      segments = extractSegments(xml, {
        openTag: '<t(?:\\s[^>]*)?>', closeTag: '</t>', paragraphClose: '</si>',
      });
    } else {
      segments = extractSegments(xml, config.segmentSpec);
    }
    if (segments.length > 0) segments[0].fileBoundary = true;
    files.push({ path, xml, segments });
  }

  const text = joinSegments(files);
  if (text.length === 0) {
    throw new AppError('E006', '문서에서 추출할 텍스트가 없습니다.');
  }

  const xlsxTables = format === 'xlsx' ? extractXlsxTables(files, entries, text) : undefined;

  return {
    format,
    text,
    entries,
    files,
    xlsxTables,
    mime: config.mime,
    meta: { ...config.meta(entries), charCount: text.length },
  };
}

// A → 0, B → 1, ..., AA → 26
function colRefToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

// xl/styles.xml에서 셀 스타일 인덱스(s) → 사용자 지정 숫자 서식(formatCode) 매핑 추출
function parseXlsxStyleNumFmts(entries) {
  if (!entries['xl/styles.xml']) return [];
  const xml = strFromU8(entries['xl/styles.xml']);
  const numFmts = new Map();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const id = /\bnumFmtId="(\d+)"/.exec(attrs)?.[1];
    const code = /\bformatCode="([^"]*)"/.exec(attrs)?.[1];
    if (id !== undefined && code !== undefined) {
      numFmts.set(Number(id), decodeXmlEntities(code));
    }
  }
  const cellXfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!cellXfsMatch) return [];
  const styleFmtCodes = [];
  for (const m of cellXfsMatch[1].matchAll(/<xf\b([^>]*)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = /\bnumFmtId="(\d+)"/.exec(m[1])?.[1];
    styleFmtCodes.push(id !== undefined ? (numFmts.get(Number(id)) || null) : null);
  }
  return styleFmtCodes;
}

// XLSX 워크시트의 2차원 셀 그리드를 추출하여 각 셀을 전역 텍스트 오프셋에 연결한다
function extractXlsxTables(files, entries, fullText) {
  const styleFmtCodes = parseXlsxStyleNumFmts(entries);

  // 1) sharedStrings 인덱스별 전역 오프셋 구축
  const sharedStrings = [];
  const ssFile = files.find((f) => f.path === 'xl/sharedStrings.xml');
  if (ssFile) {
    let segPtr = 0;
    const segs = ssFile.segments;
    for (const m of ssFile.xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      const siStart = m.index;
      const siEnd = m.index + m[0].length;
      while (segPtr < segs.length && segs[segPtr].rawEnd <= siStart) segPtr += 1;
      let first = null;
      let last = null;
      let j = segPtr;
      while (j < segs.length && segs[j].rawStart < siEnd) {
        if (segs[j].rawStart >= siStart && segs[j].rawEnd <= siEnd) {
          if (!first) first = segs[j];
          last = segs[j];
        }
        j += 1;
      }
      segPtr = j;
      if (first && last) {
        sharedStrings.push({
          text: fullText.slice(first.globalStart, last.globalEnd),
          start: first.globalStart,
          end: last.globalEnd,
        });
      } else {
        sharedStrings.push(null);
      }
    }
  }

  // 2) 시트별 행·셀 그리드 추출
  const tables = [];
  for (const file of files) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(file.path)) continue;

    const numericByCellStart = new Map();
    const textSegs = [];
    for (const seg of file.segments) {
      if (seg.xlsxNumeric) numericByCellStart.set(seg.cellStart, seg);
      else textSegs.push(seg);
    }

    let textPtr = 0;
    const rows = [];
    for (const rowMatch of file.xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const rowXml = rowMatch[1];
      const rowBodyStart = rowMatch.index + rowMatch[0].indexOf(rowXml);
      const cells = [];
      let prevCol = -1;

      for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cellMatch[1];
        const body = cellMatch[2];
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const col = ref ? colRefToIndex(ref) : prevCol + 1;
        prevCol = col;
        if (body === undefined) continue;

        const cellStart = rowBodyStart + cellMatch.index;
        const cellEnd = cellStart + cellMatch[0].length;
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || 'n';
        const styleAttr = /\bs="(\d+)"/.exec(attrs)?.[1];
        const numFmtCode = styleAttr !== undefined ? (styleFmtCodes[Number(styleAttr)] || null) : null;

        if (type === 's') {
          const idxStr = /<v>(\d+)<\/v>/.exec(body)?.[1];
          if (idxStr === undefined) continue;
          const siIndex = Number(idxStr);
          const ss = sharedStrings[siIndex];
          if (!ss) continue;
          cells.push({
            col, text: ss.text, start: ss.start, end: ss.end,
            isShared: true, siIndex,
          });
        } else if (type === 'inlineStr') {
          while (textPtr < textSegs.length && textSegs[textPtr].rawEnd <= cellStart) textPtr += 1;
          let first = null;
          let last = null;
          let j = textPtr;
          while (j < textSegs.length && textSegs[j].rawStart < cellEnd) {
            if (textSegs[j].rawStart >= cellStart && textSegs[j].rawEnd <= cellEnd) {
              if (!first) first = textSegs[j];
              last = textSegs[j];
            }
            j += 1;
          }
          textPtr = j;
          if (!first || !last) continue;
          cells.push({
            col,
            text: fullText.slice(first.globalStart, last.globalEnd),
            start: first.globalStart,
            end: last.globalEnd,
            isInline: true,
          });
        } else if (type === 'n') {
          const seg = numericByCellStart.get(cellStart);
          if (!seg) continue;
          cells.push({
            col,
            text: seg.text,
            start: seg.globalStart,
            end: seg.globalEnd,
            isNumeric: true,
            numFmtCode,
          });
        }
      }

      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length > 0) tables.push({ name: file.path, rows });
  }

  return tables;
}

// 적용 내역을 XML에 반영하여 결과 ZIP 생성
export function buildZipResult(parsed, applied) {
  applyToSegments(parsed.files, applied);
  const newEntries = {};
  for (const [name, data] of Object.entries(parsed.entries)) {
    newEntries[name] = data;
  }
  for (const file of parsed.files) {
    const newXml = spliceXml(file.xml, file.segments);
    newEntries[file.path] = strToU8(newXml);
  }
  try {
    const zipOptions = parsed.format === 'hwpx'
      ? { store: ['mimetype'], first: ['mimetype'] }
      : {};
    const zipped = rezip(newEntries, zipOptions);
    return new Blob([zipped], { type: parsed.mime });
  } catch {
    throw new AppError('E008');
  }
}

// 복원: 대응표의 치환값을 각 텍스트 세그먼트에서 원문으로 역치환
export function restoreZipDocument(parsed, mappingTable) {
  let restoredCount = 0;
  let notRestoredCount = 0;
  const sorted = mappingTable.mappings
    .slice()
    .sort((a, b) => b.replacement.length - a.replacement.length);
  const reversible = sorted.filter((m) => m.reversible);
  notRestoredCount = sorted.length - reversible.length;

  const restoredTokens = new Set();
  for (const file of parsed.files) {
    for (const seg of file.segments) {
      let newText = seg.text;
      for (const m of reversible) {
        if (newText.includes(m.replacement)) {
          newText = newText.split(m.replacement).join(m.original);
          restoredTokens.add(m.replacement);
        }
      }
      if (newText !== seg.text) seg.newText = newText;
    }
  }
  restoredCount = restoredTokens.size;

  const newEntries = {};
  for (const [name, data] of Object.entries(parsed.entries)) newEntries[name] = data;
  for (const file of parsed.files) {
    newEntries[file.path] = strToU8(spliceXml(file.xml, file.segments));
  }
  const zipOptions = parsed.format === 'hwpx'
    ? { store: ['mimetype'], first: ['mimetype'] }
    : {};
  const blob = new Blob([rezip(newEntries, zipOptions)], { type: parsed.mime });
  return { blob, restoredCount, notRestoredCount };
}
