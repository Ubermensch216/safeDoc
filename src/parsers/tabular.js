// 표(XLSX·CSV) 구조 기반 열 유형 추론 및 셀 단위 후보 생성
// - 헤더명 기반 유형 추정 (비정형 헤더 포함)
// - 헤더가 없거나 미등록인 경우 같은 열의 기탐지 패턴으로 열 유형 보조 추론
// - 셀 값 검증으로 안내 문구·합계행·비대상 유형(예: 연락처 열에 섞인 주민번호) 오탐 방지

import { TABLE_HEADER_KEYWORDS_BY_TYPE, NON_PII_TABLE_HEADERS } from '../detect/dictionaries.js';
import { isNonNameWord } from '../detect/rules/name.js';
import { validateRRN, validateForeignerNo } from '../detect/validators.js';

// 표 헤더 매칭 순서: 더 구체적인 유형을 먼저 검사
const HEADER_TYPE_ORDER = [
  'FOREIGNER_NO', 'RRN', 'PASSPORT_NO', 'BUSINESS_NO', 'VEHICLE_NO',
  'EMAIL', 'IP_ADDRESS', 'CARD_NO', 'ACCOUNT_NO', 'BIRTH_DATE',
  'PHONE_MOBILE', 'PHONE_LANDLINE', 'ADDRESS', 'PERSON_NAME',
];

// 성명 열에서도 성명이 아닌 상태·합계·placeholder 값
const TABLE_NON_NAME_VALUES = new Set([
  '합계', '소계', '총계', '계', '평균', '없음', '미상', '미정', '미기재', '공란', '공백',
  '해당없음', '불명', '본인', '자신', '정규', '계약', '숫자셀', '임시', '파견', '인턴',
  '재직', '퇴사', '휴직', '완료', '진행', '진행중', '대기', '예정', '보류', '취소',
  '정상', '오류', '참고', '기타', '전체', '다수', '소수', '일부', '미확인', '확인',
  'N/A', 'NA', 'NONE', 'NULL', 'UNKNOWN', '-', '--', '—',
]);

// 성명 셀 끝부분에 오면 문장/서술어로 판단하는 어미
const SENTENCE_END_RE = /(?:입니다|이었다|이었고|이다|였다|있다|없다|한다|된다|합니다|됩니다|함|됨|참고|예정|완료)$/;

// 숫자 셀 앞자리 0 탈락 휴대전화/일반전화 패턴
const STRIPPED_MOBILE_CELL_RE = /^1(?:0\d{8}|[16789]\d{7,8})$/;
const STRIPPED_MOBILE_SEP_RE = /^1[016789][-.\s_]\d{3,4}[-.\s_]\d{4}$/;
const STRIPPED_LANDLINE_CELL_RE = /^(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70|80)(?:[-.\s_]?\d{3,4}[-.\s_]?\d{4})$/;

// 표준 성명 표기: 한글 1~4어절 또는 영문(라틴) 1~4어절
const VALID_NAME_CELL_RE =
  /^(?:[가-힣]{1,5}(?:[ \t]+[가-힣]{1,5}){0,3}|[A-Za-z][A-Za-z'.-]*(?:[ \t]+[A-Za-z][A-Za-z'.-]*){0,3})$/;

function normalizeHeader(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '');
}

function stripParens(s) {
  return s.replace(/\([^)]*\)/g, '').trim();
}

// 헤더 문자열 1개 → 개인정보 유형 추정
export function matchHeaderType(headerText) {
  const trimmed = String(headerText || '').trim();
  if (!trimmed) return null;
  const compact = normalizeHeader(trimmed);
  const base = stripParens(compact);

  if (NON_PII_TABLE_HEADERS.has(compact) || NON_PII_TABLE_HEADERS.has(base)) {
    return null;
  }

  for (const type of HEADER_TYPE_ORDER) {
    const keywords = TABLE_HEADER_KEYWORDS_BY_TYPE[type];
    if (!keywords) continue;
    for (const kw of keywords) {
      const kwCompact = normalizeHeader(kw);
      if (
        trimmed === kw ||
        compact === kwCompact ||
        base === kwCompact ||
        trimmed.includes(kw) ||
        (kwCompact.length >= 2 && compact.includes(kwCompact))
      ) {
        return type;
      }
    }
  }
  return null;
}

// 헤더 행 배열 → 열별 개인정보 유형 배열 (CSV/XLSX 공통)
export function inferColumnTypes(headerRow) {
  const hints = [];
  for (let col = 0; col < headerRow.length; col++) {
    const cell = headerRow[col];
    const text = typeof cell === 'string' ? cell : (cell?.value ?? cell?.text ?? '');
    hints.push(matchHeaderType(text));
  }
  return hints;
}

function isPlaceholderValue(val) {
  const trimmed = val.trim();
  if (!trimmed) return true;
  if (/^[-–—_*./\\]+$/.test(trimmed)) return true;
  if (trimmed.startsWith('※')) return true;
  return TABLE_NON_NAME_VALUES.has(trimmed) || TABLE_NON_NAME_VALUES.has(trimmed.toUpperCase());
}

// 표의 성명 열 셀 값이 실제 인명 형태인지 검증
export function isPlausibleTableName(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length < 2 || trimmed.length > 24) return false;
  if (isPlaceholderValue(trimmed)) return false;
  if (/\d/.test(trimmed)) return false;
  if (/[※@.,?!;:()[\]{}/\\]/.test(trimmed) && /[가-힣]/.test(trimmed)) return false;
  if (!VALID_NAME_CELL_RE.test(trimmed)) return false;

  const tokens = trimmed.split(/[ \t]+/).filter(Boolean);
  if (tokens.length > 4) return false;

  // 한글 이름 검증
  if (/[가-힣]/.test(trimmed)) {
    if (tokens.length === 1 && trimmed.length > 5) return false;
    if (isNonNameWord(trimmed)) return false;
    if (tokens.some((t) => TABLE_NON_NAME_VALUES.has(t))) return false;
    const last = tokens[tokens.length - 1];
    if (last.length >= 3 && SENTENCE_END_RE.test(last)) return false;
    return true;
  }

  // 영문 이름 검증 (단일 대문자 코드·약어 배제)
  if (tokens.length === 1 && /^[A-Z0-9_-]{2,}$/.test(trimmed)) return false;
  return true;
}

// 셀이 헤더 행으로 적합한지 판별하고, 표 상단(최대 15행)에서 헤더 행 인덱스를 탐색
export function findHeaderRow(rows) {
  let bestIdx = -1;
  let bestScore = 0;
  let bestMap = new Map();

  const limit = Math.min(rows.length, 15);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    const nonEmpty = row.filter((c) => c && String(c.text ?? c.value ?? '').trim() !== '');
    if (nonEmpty.length === 0) continue;

    // 안내문·긴 문장·긴 숫자열이 있는 행은 헤더가 아님
    const looksLikeDataOrNote = nonEmpty.some((c) => {
      const v = String(c.text ?? c.value ?? '').trim();
      return v.startsWith('※') || v.length > 25 || /^\d{5,}$/.test(v) || /01[016789][-.\s]?\d{3,4}/.test(v);
    });
    if (looksLikeDataOrNote) continue;

    let score = 0;
    const colHints = new Map();
    for (const c of nonEmpty) {
      const v = String(c.text ?? c.value ?? '').trim();
      const compact = normalizeHeader(v);
      const hint = matchHeaderType(v);
      if (hint) {
        score += 3;
        colHints.set(c.col, hint);
      } else if (NON_PII_TABLE_HEADERS.has(compact) || NON_PII_TABLE_HEADERS.has(stripParens(compact))) {
        score += 1;
      }
    }

    if (nonEmpty.length >= 2 && score > bestScore) {
      bestScore = score;
      bestIdx = r;
      bestMap = colHints;
    } else if (nonEmpty.length === 1 && score >= 3 && bestScore === 0) {
      bestScore = score;
      bestIdx = r;
      bestMap = colHints;
    }
  }

  if (bestScore >= 3) {
    return { headerRowIndex: bestIdx, headerHints: bestMap };
  }

  // 기존 CSV 호환: 첫 행이 모두 비숫자 텍스트이고 2열 이상이면 헤더로 간주
  if (rows.length > 1) {
    const first = rows[0];
    if (
      first.length > 1 &&
      first.every((c) => {
        const v = String(c?.text ?? c?.value ?? '').trim();
        return v !== '' && !/^\d+$/.test(v) && !v.startsWith('※');
      })
    ) {
      const colHints = new Map();
      for (const c of first) {
        const hint = matchHeaderType(c.text ?? c.value ?? '');
        if (hint) colHints.set(c.col, hint);
      }
      return { headerRowIndex: 0, headerHints: colHints };
    }
  }

  return { headerRowIndex: -1, headerHints: new Map() };
}

// Excel 사용자 지정 숫자 서식(numFmtCode)으로 앞자리 0이 표시되는 전화번호/주민번호 판별
export function detectFromExcelNumFmt(cell) {
  if (!cell.isNumeric || !cell.numFmtCode) return null;
  const raw = String(cell.text || '').trim();
  if (!/^\d+$/.test(raw)) return null;

  // 첫 번째 섹션(양수 서식)에서 따옴표/이스케이프/색상 제거 후 0 자리수 추출
  const section = cell.numFmtCode.split(';')[0]
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '');
  const zeroCount = (section.match(/0/g) || []).length;
  if (zeroCount < 9 || zeroCount > 13) return null;

  const padded = raw.padStart(zeroCount, '0');
  if ((zeroCount === 10 || zeroCount === 11) && /^01[016789]\d{7,8}$/.test(padded)) {
    return { type: 'PHONE_MOBILE', score: 0.9 };
  }
  if (zeroCount === 13) {
    if (validateRRN(padded).valid) return { type: 'RRN', score: 0.9 };
    if (validateForeignerNo(padded).valid) return { type: 'FOREIGNER_NO', score: 0.9 };
  }
  return null;
}

function hasOverlap(engineCandidates, start, end) {
  return engineCandidates.some((c) => c.start < end && start < c.end);
}

function hasExactTypeOverlap(engineCandidates, start, end, typeSet) {
  return engineCandidates.some(
    (c) => typeSet.has(c.type) && c.start <= start && c.end >= end,
  );
}

// 표 목록(XLSX 시트들 또는 CSV 1개 표)에서 열 힌트·내용 일관성·숫자 서식 기반 후보 생성
export function extractTabularCandidates(tables, engineCandidates = []) {
  const out = [];

  for (const table of tables) {
    const rows = table.rows || [];
    if (rows.length === 0) continue;

    const { headerRowIndex, headerHints } = findHeaderRow(rows);
    const dataStartRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;

    // 헤더 행에 사용된 sharedStrings 인덱스는 데이터 후보로 내보내지 않는다
    const headerSiSet = new Set();
    const headerTextByCol = new Map();
    if (headerRowIndex >= 0) {
      for (const c of rows[headerRowIndex]) {
        if (!c) continue;
        headerTextByCol.set(c.col, String(c.text ?? c.value ?? '').trim());
        if (c.isShared && c.siIndex !== undefined) headerSiSet.add(c.siIndex);
      }
    }

    // 1) 숫자 서식(xl/styles.xml numFmt)이 명시된 숫자 셀 우선 검사
    for (let r = dataStartRow; r < rows.length; r++) {
      for (const cell of rows[r]) {
        if (!cell || !cell.isNumeric || cell.start === undefined || cell.end === undefined) continue;
        if (hasOverlap(engineCandidates, cell.start, cell.end)) continue;
        const fmtHit = detectFromExcelNumFmt(cell);
        if (!fmtHit) continue;
        const val = String(cell.text).trim();
        const offset = cell.text.indexOf(val);
        out.push({
          start: cell.start + offset,
          end: cell.start + offset + val.length,
          originalText: val,
          type: fmtHit.type,
          baseScore: fmtHit.score,
          detectionMethod: 'FIELD_HEADER',
          context: `${headerTextByCol.get(cell.col) || '숫자서식'} 셀`,
        });
      }
    }

    // 2) 열별 데이터 셀 수집
    const cellsByCol = new Map();
    for (let r = dataStartRow; r < rows.length; r++) {
      for (const cell of rows[r]) {
        if (!cell || cell.start === undefined || cell.end === undefined) continue;
        if (cell.isShared && headerSiSet.has(cell.siIndex)) continue;
        const val = String(cell.text ?? cell.value ?? '').trim();
        if (!val) continue;
        if (!cellsByCol.has(cell.col)) cellsByCol.set(cell.col, []);
        cellsByCol.get(cell.col).push(cell);
      }
    }

    // 3) 미지정 열에 대한 내용 일관성 기반 보조 추론
    //    (예: 헤더가 비정형이거나 생략되었더라도, 같은 열에 기탐지된 성명/전화번호가 있고
    //     열 전체 패턴이 일치하면 나머지 셀도 함께 탐지)
    const finalHints = new Map(headerHints);
    const PHONE_TYPES = new Set(['PHONE_MOBILE', 'PHONE_LANDLINE']);
    const NAME_TYPES = new Set(['PERSON_NAME']);

    for (const [col, cells] of cellsByCol.entries()) {
      if (finalHints.has(col)) continue;
      const hText = headerTextByCol.get(col) || '';
      const hCompact = normalizeHeader(hText);
      if (hCompact && (NON_PII_TABLE_HEADERS.has(hCompact) || NON_PII_TABLE_HEADERS.has(stripParens(hCompact)))) {
        continue;
      }

      let phoneHits = 0;
      let nameHits = 0;
      let nameLikeCount = 0;
      for (const cell of cells) {
        const val = String(cell.text ?? cell.value ?? '').trim();
        const offset = (cell.text ?? cell.value ?? '').indexOf(val);
        const s = cell.start + offset;
        const e = s + val.length;
        if (hasExactTypeOverlap(engineCandidates, s, e, PHONE_TYPES)) phoneHits += 1;
        if (hasExactTypeOverlap(engineCandidates, s, e, NAME_TYPES)) nameHits += 1;
        if (isPlausibleTableName(val)) nameLikeCount += 1;
      }

      if (phoneHits >= 2 || (phoneHits >= 1 && phoneHits / cells.length >= 0.4)) {
        finalHints.set(col, 'PHONE_MOBILE');
      } else if (nameHits >= 1 && nameLikeCount >= 2 && nameLikeCount / cells.length >= 0.5) {
        finalHints.set(col, 'PERSON_NAME');
      }
    }

    // 4) 유형이 확정된 열의 셀별 검증 및 후보 생성
    for (const [col, type] of finalHints.entries()) {
      const cells = cellsByCol.get(col) || [];
      const headerLabel = headerTextByCol.get(col) || type;

      for (const cell of cells) {
        const rawText = cell.text ?? cell.value ?? '';
        const val = rawText.trim();
        if (!val || isPlaceholderValue(val)) continue;
        const offset = rawText.indexOf(val);
        const start = cell.start + offset;
        const end = start + val.length;

        if (type === 'PERSON_NAME') {
          if (!isPlausibleTableName(val)) continue;
          // 이미 정형 개인정보(전화번호·주민번호 등)로 잡힌 셀은 건드리지 않음
          if (engineCandidates.some((c) => c.type !== 'PERSON_NAME' && c.start < end && start < c.end)) continue;
          out.push({
            start,
            end,
            originalText: val,
            type: 'PERSON_NAME',
            baseScore: 0.85,
            detectionMethod: 'FIELD_HEADER',
            context: `${headerLabel} 열`,
          });
          continue;
        }

        if (type === 'PHONE_MOBILE' || type === 'PHONE_LANDLINE') {
          // 이미 엔진이 탐지한 값(정상 전화번호 또는 해당 열에 섞인 주민번호 등)은 유지
          if (hasOverlap(engineCandidates, start, end)) continue;
          // 앞자리 0이 탈락한 숫자 서식 전화번호만 보완 탐지 (설명 문구 오탐 방지)
          if (STRIPPED_MOBILE_CELL_RE.test(val) || STRIPPED_MOBILE_SEP_RE.test(val)) {
            if (/0{5,}$/.test(val.replace(/\D/g, ''))) continue;
            out.push({
              start,
              end,
              originalText: val,
              type: 'PHONE_MOBILE',
              baseScore: 0.85,
              detectionMethod: 'FIELD_HEADER',
              context: `${headerLabel} 열`,
            });
          } else if (STRIPPED_LANDLINE_CELL_RE.test(val)) {
            if (/0{5,}$/.test(val.replace(/\D/g, ''))) continue;
            out.push({
              start,
              end,
              originalText: val,
              type: 'PHONE_LANDLINE',
              baseScore: 0.8,
              detectionMethod: 'FIELD_HEADER',
              context: `${headerLabel} 열`,
            });
          }
          continue;
        }

        // 그 외 열 유형: 이미 엔진이 잡은 셀은 그대로 두고, 기본 형식 검증 후 보완
        if (hasOverlap(engineCandidates, start, end)) continue;
        if (type === 'EMAIL' && !/(@|\(at\)|\[at\])/i.test(val)) continue;
        if (
          ['RRN', 'FOREIGNER_NO', 'ACCOUNT_NO', 'CARD_NO', 'BUSINESS_NO', 'BIRTH_DATE'].includes(type) &&
          !/\d/.test(val)
        ) {
          continue;
        }
        if (type === 'ADDRESS' && val.length < 2) continue;

        out.push({
          start,
          end,
          originalText: val,
          type,
          baseScore: 0.8,
          detectionMethod: 'FIELD_HEADER',
          context: `${headerLabel} 열`,
        });
      }
    }
  }

  return out;
}
