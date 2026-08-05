// ZIP 컨테이너 공통 처리 — XLSX·DOCX·HWPX (기술명세서 Ⅻ-3 문서 보안)

import { unzipSync, zipSync } from 'fflate';
import { AppError } from '../core/errors.js';

// ZIP 폭탄 방지 한도 (NFR-007)
const MAX_ZIP_ENTRIES = 10000;
const MAX_TOTAL_UNCOMPRESSED = 300 * 1024 * 1024; // 300MB
const MAX_COMPRESSION_RATIO = 2000;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;

// 중앙 디렉터리는 압축을 풀지 않고 읽을 수 있다. 여기서 선언 크기와 항목 수를
// 먼저 검사해 unzipSync가 거대한 버퍼를 만들기 전에 비정상 ZIP을 거부한다.
export function inspectZipCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = 22;
  const searchStart = Math.max(0, bytes.length - 0xffff - minEocd);
  let eocd = -1;
  for (let i = bytes.length - minEocd; i >= searchStart; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new AppError('E005');

  const diskNo = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (diskNo !== 0 || centralDisk !== 0) throw new AppError('E005', '분할 ZIP 문서는 지원하지 않습니다.');
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new AppError('E005', 'ZIP64 문서는 지원 한도를 초과합니다.');
  }
  if (entryCount > MAX_ZIP_ENTRIES) throw new AppError('E005', '압축 항목 수가 비정상적으로 많습니다.');
  if (centralOffset + centralSize > bytes.length) throw new AppError('E005');

  let pos = centralOffset;
  let totalUncompressed = 0;
  let encrypted = false;
  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== SIG_CENTRAL) throw new AppError('E005');
    const flags = view.getUint16(pos + 8, true);
    const compressed = view.getUint32(pos + 20, true);
    const uncompressed = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    encrypted ||= (flags & 1) !== 0;
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
      throw new AppError('E005', '압축해제 크기가 비정상적으로 큽니다.');
    }
    if (uncompressed > 1024 * 1024 && uncompressed / Math.max(compressed, 1) > MAX_COMPRESSION_RATIO) {
      throw new AppError('E005', '압축률이 비정상적으로 높습니다.');
    }
    pos += 46 + nameLength + extraLength + commentLength;
  }
  if (pos > centralOffset + centralSize) throw new AppError('E005');
  return { entryCount, totalUncompressed, encrypted };
}

// 암호화된 Office 문서는 OLE(CFB) 컨테이너로 저장됨 → ZIP이 아님
function isOleContainer(bytes) {
  return bytes.length >= 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

export function safeUnzip(buffer) {
  const bytes = new Uint8Array(buffer);
  if (isOleContainer(bytes)) {
    throw new AppError('E004');
  }
  // ZIP 시그니처 확인 (확장자와 실제 구조 교차검증)
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new AppError('E005');
  }

  const zipInfo = inspectZipCentralDirectory(bytes);
  if (zipInfo.encrypted) throw new AppError('E004');

  let entries;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    // fflate는 암호화 항목에서 오류를 던짐
    if (String(e).toLowerCase().includes('encrypt')) throw new AppError('E004');
    throw new AppError('E005');
  }

  const names = Object.keys(entries);
  if (names.length > MAX_ZIP_ENTRIES) throw new AppError('E005', '압축 항목 수가 비정상적으로 많습니다.');
  let total = 0;
  for (const name of names) {
    total += entries[name].length;
    if (total > MAX_TOTAL_UNCOMPRESSED) throw new AppError('E005', '압축해제 크기가 비정상적으로 큽니다.');
  }
  return entries;
}

export function rezip(entries, { store = [], first = [] } = {}) {
  const ordered = {};
  const storeSet = new Set(store);
  const add = (name) => {
    if (!(name in entries) || name in ordered) return;
    ordered[name] = storeSet.has(name) ? [entries[name], { level: 0 }] : entries[name];
  };
  for (const name of first) add(name);
  for (const name of Object.keys(entries)) add(name);
  return zipSync(ordered);
}

// XML 엔터티 처리
export function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

export function encodeXmlEntities(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// XML 문자열에서 텍스트 노드 세그먼트 추출
// tagPattern: 여는 태그 정규식 소스 (예: '<w:t(?:\\s[^>]*)?>'), closeTag: '</w:t>'
// paragraphClose: 문단 종료 태그 — 세그먼트 사이에 줄바꿈 삽입 판단용 (null이면 항상 줄바꿈)
export function extractSegments(xml, { openTag, closeTag, paragraphClose }) {
  const segments = [];
  const re = new RegExp(`${openTag}([\\s\\S]*?)${closeTag}`, 'g');
  let prevRawEnd = 0;
  for (const m of xml.matchAll(re)) {
    const rawContent = m[1];
    const rawStart = m.index + m[0].length - closeTag.length - rawContent.length;
    const rawEnd = rawStart + rawContent.length;
    // 이전 세그먼트와의 사이에 문단 종료 태그가 있으면 줄바꿈으로 구분
    const between = xml.slice(prevRawEnd, m.index);
    const newParagraph = segments.length === 0
      ? false
      : (paragraphClose ? between.includes(paragraphClose) : true);
    segments.push({
      rawStart,
      rawEnd,
      text: decodeXmlEntities(rawContent),
      newParagraph,
    });
    prevRawEnd = rawEnd;
  }
  return segments;
}

// XLSX 워크시트의 숫자 셀은 <t>가 아니라 <v>에 저장된다.
// 공유 문자열 셀(t="s")의 <v>는 개인정보가 아니라 sharedStrings 인덱스이므로 제외한다.
export function extractXlsxSegments(xml) {
  const segments = extractSegments(xml, {
    openTag: '<t(?:\\s[^>]*)?>', closeTag: '</t>', paragraphClose: null,
  });

  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  for (const cell of xml.matchAll(cellRe)) {
    const attrs = cell[1];
    const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || 'n';
    if (!['n'].includes(type)) continue;

    const body = cell[2];
    const value = /<v>([\s\S]*?)<\/v>/.exec(body);
    if (!value || !/^[+\-]?\d+(?:\.\d+)?$/.test(value[1].trim())) continue;

    const cellStart = cell.index;
    const cellEnd = cell.index + cell[0].length;
    const bodyStart = cell.index + cell[0].indexOf(body);
    const rawStart = bodyStart + value.index + '<v>'.length;
    const rawEnd = rawStart + value[1].length;
    segments.push({
      rawStart,
      rawEnd,
      text: value[1],
      newParagraph: true,
      xlsxNumeric: true,
      cellStart,
      cellEnd,
      cellOpen: `<c${attrs}>`,
    });
  }

  segments.sort((a, b) => a.rawStart - b.rawStart);
  segments.forEach((seg, i) => { seg.newParagraph = i > 0; });
  return segments;
}

// 여러 XML 파일의 세그먼트를 하나의 문서 텍스트로 결합 (전역 오프셋 부여)
// files: [{ path, xml, segments }] → 반환: { text, files(세그먼트에 globalStart/End 추가) }
export function joinSegments(files) {
  let text = '';
  for (const file of files) {
    for (const seg of file.segments) {
      if (text.length > 0) {
        // 문단 경계는 줄바꿈, 같은 문단 내 분리된 텍스트 런은 그대로 연결하여 결합 분석
        text += seg.newParagraph || seg.fileBoundary ? '\n' : '';
      }
      seg.globalStart = text.length;
      text += seg.text;
      seg.globalEnd = text.length;
    }
  }
  return text;
}

// 적용된 치환 내역(전역 위치 기준)을 각 세그먼트에 분배하여 새 텍스트 계산
// applied: [{ start, end, replacementText }] (전역 오프셋, 오름차순)
// 여러 세그먼트에 걸친 후보는 시작 세그먼트에 치환값을 넣고 나머지 구간은 삭제
export function applyToSegments(files, applied) {
  const sorted = applied.slice().sort((a, b) => a.start - b.start);
  // 세그먼트와 적용 목록이 모두 시작위치 오름차순이므로 포인터 전진으로 대조한다.
  // 이전에는 세그먼트마다 전체 적용 목록을 filter로 훑어 O(세그먼트수×적용건수)였다 (ANALYSIS 3.2-3).
  // 여러 세그먼트에 걸친 적용 건이 있으므로, 포인터는 "끝이 현재 세그먼트 시작보다
  // 앞인 건"만 지나친다 — 걸침 건은 다음 세그먼트에서도 검사 대상으로 남는다.
  let cursor = 0;
  for (const file of files) {
    for (const seg of file.segments) {
      while (cursor < sorted.length && sorted[cursor].end <= seg.globalStart) cursor += 1;
      const overlapping = [];
      for (let j = cursor; j < sorted.length && sorted[j].start < seg.globalEnd; j++) {
        if (sorted[j].end > seg.globalStart) overlapping.push(sorted[j]);
      }
      if (overlapping.length === 0) {
        seg.newText = seg.text;
        continue;
      }
      let out = '';
      let pos = seg.globalStart;
      for (const c of overlapping) {
        const from = Math.max(c.start, seg.globalStart);
        if (from > pos) out += seg.text.slice(pos - seg.globalStart, from - seg.globalStart);
        if (c.start >= seg.globalStart) out += c.replacementText; // 시작 세그먼트에만 삽입
        pos = Math.min(c.end, seg.globalEnd);
      }
      if (pos < seg.globalEnd) out += seg.text.slice(pos - seg.globalStart);
      seg.newText = out;
    }
  }
}

// 세그먼트 변경사항을 XML 문자열에 반영 (뒤쪽부터 치환하여 위치 유지)
export function spliceXml(xml, segments) {
  let result = xml;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.newText === undefined || seg.newText === seg.text) continue;
    if (seg.xlsxNumeric) {
      const open = seg.cellOpen
        .replace(/\s+t="[^"]*"/g, '')
        .replace(/>$/, ' t="inlineStr">');
      const cellXml = `${open}<is><t>${encodeXmlEntities(seg.newText)}</t></is></c>`;
      result = result.slice(0, seg.cellStart) + cellXml + result.slice(seg.cellEnd);
    } else {
      result = result.slice(0, seg.rawStart) + encodeXmlEntities(seg.newText) + result.slice(seg.rawEnd);
    }
  }
  return result;
}
