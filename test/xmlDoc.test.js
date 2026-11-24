import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { parseZipDocument, buildZipResult, restoreZipDocument } from '../src/parsers/xmlDoc.js';
import { analyze } from '../src/core/analyzer.js';
import { detectAll, resetIdCounter } from '../src/detect/engine.js';
import { applyToText } from '../src/core/deidentify.js';
import { buildMappingTable } from '../src/core/mappingTable.js';
import { WorkSession } from '../src/core/session.js';

// ---------- 픽스처 생성 ----------

function makeXlsx() {
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="민원목록" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`;
  const sharedStrings = `<?xml version="1.0"?><sst count="4" uniqueCount="4"><si><t>성명</t></si><si><t>홍길동</t></si><si><t>전화번호</t></si><si><t>010-1234-5678</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/sharedStrings.xml': strToU8(sharedStrings),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/styles.xml': strToU8('<?xml version="1.0"?><styleSheet/>'),
  }).buffer;
}

function makeXlsxWithNumericPii() {
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="숫자셀" sheetId="1"/></sheets></workbook>`;
  const sharedStrings = `<?xml version="1.0"?><sst count="1" uniqueCount="1"><si><t>주민등록번호</t></si></sst>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2"><v>9002011234560</v></c></row></sheetData></worksheet>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/sharedStrings.xml': strToU8(sharedStrings),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }).buffer;
}

function makeDocx() {
  // "홍길동" 이 두 개의 텍스트 런으로 분리된 경우 (기술명세서 Ⅳ-5: 결합 분석)
  const document = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>민원인 홍길</w:t></w:r><w:r><w:t>동, 연락처 010-1234-5678</w:t></w:r></w:p>
<w:p><w:r><w:t>주소: 서울특별시 강남구 테헤란로 152</w:t></w:r></w:p>
</w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8(document),
  }).buffer;
}

function makeHwpx() {
  const section = `<?xml version="1.0"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
<hp:p><hp:run><hp:t>신청인 김철수 (010-9876-5432)</hp:t></hp:run></hp:p>
</hs:sec>`;
  return zipSync({
    mimetype: strToU8('application/hwp+zip'),
    'Contents/section0.xml': strToU8(section),
  }).buffer;
}

function deidentify(parsed) {
  resetIdCounter();
  const session = new WorkSession();
  for (const t of Object.keys(session.typePolicies)) session.typePolicies[t] = 'REPLACE';
  session.candidates = detectAll(parsed.text);
  const { text: afterText, applied } = applyToText(parsed.text, session.candidates, session);
  return { session, afterText, applied };
}

// ---------- XLSX ----------

describe('XLSX 처리 (기술명세서 Ⅳ-4)', () => {
  it('공유 문자열에서 텍스트를 추출하고 시트명을 인식한다', () => {
    const parsed = parseZipDocument(makeXlsx(), 'xlsx');
    expect(parsed.text).toContain('홍길동');
    expect(parsed.text).toContain('010-1234-5678');
    expect(parsed.meta.sheetNames).toBe('민원목록');
  });

  it('치환 후 원문이 제거되고 구조·서식 파일이 보존된다', () => {
    const parsed = parseZipDocument(makeXlsx(), 'xlsx');
    const { applied } = deidentify(parsed);
    expect(applied.length).toBeGreaterThanOrEqual(2);

    const blob = buildZipResult(parsed, applied);
    return blob.arrayBuffer().then((buf) => {
      const out = unzipSync(new Uint8Array(buf));
      const sst = strFromU8(out['xl/sharedStrings.xml']);
      expect(sst).not.toContain('홍길동');
      expect(sst).not.toContain('010-1234-5678');
      expect(sst).toContain('[성명_');
      // 헤더는 유지
      expect(sst).toContain('<t>성명</t>');
      // 시트·스타일 파일은 그대로
      expect(strFromU8(out['xl/worksheets/sheet1.xml'])).toContain('sheetData');
      expect(out['xl/styles.xml']).toBeDefined();
    });
  });

  it('대응표로 복원하면 원문이 되살아난다', () => {
    const parsed = parseZipDocument(makeXlsx(), 'xlsx');
    const { applied } = deidentify(parsed);
    const blob = buildZipResult(parsed, applied);
    const table = buildMappingTable('a.xlsx', 'b.xlsx', applied);

    return blob.arrayBuffer().then((buf) => {
      const deidParsed = parseZipDocument(buf, 'xlsx');
      const { blob: restoredBlob, restoredCount } = restoreZipDocument(deidParsed, table);
      expect(restoredCount).toBeGreaterThanOrEqual(2);
      return restoredBlob.arrayBuffer().then((rbuf) => {
        const out = unzipSync(new Uint8Array(rbuf));
        const sst = strFromU8(out['xl/sharedStrings.xml']);
        expect(sst).toContain('홍길동');
        expect(sst).toContain('010-1234-5678');
      });
    });
  });

  it('숫자 셀의 식별번호를 탐지하고 인라인 문자열로 안전하게 치환한다', async () => {
    const parsed = parseZipDocument(makeXlsxWithNumericPii(), 'xlsx');
    expect(parsed.text).toContain('9002011234560');
    // 공유 문자열 셀의 <v>0</v>는 인덱스이므로 분석 텍스트에 별도 숫자 셀로 추가되지 않는다.
    expect(parsed.text.split('\n').filter((v) => v === '0')).toHaveLength(0);

    const { applied } = deidentify(parsed);
    expect(applied.some((c) => c.originalText === '9002011234560')).toBe(true);

    const blob = buildZipResult(parsed, applied);
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const sheet = strFromU8(out['xl/worksheets/sheet1.xml']);
    expect(sheet).not.toContain('9002011234560');
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain('<is><t>[주민번호_');
    expect(sheet).toContain('<c r="A1" t="s"><v>0</v></c>');
  });

  it('04_근태_및_인사기록.xlsx의 모든 성명(2글자·외국인 포함)과 전화번호(국제전화·숫자셀 포함)를 누락 없이 비식별화한다', async () => {
    const bytes = readFileSync(new URL('./documents/04_근태_및_인사기록.xlsx', import.meta.url));
    const parsed = parseZipDocument(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'xlsx');
    resetIdCounter();
    const candidates = analyze(parsed);

    const names = candidates.filter((c) => c.type === 'PERSON_NAME').map((c) => c.originalText);
    const phones = candidates.filter((c) => c.type === 'PHONE_MOBILE').map((c) => c.originalText);
    const rrns = candidates.filter((c) => c.type === 'RRN').map((c) => c.originalText);

    // 7명 전원 탐지 (최다은은 본문 메모 포함 2회)
    for (const expectedName of ['최다은', '한결', '응우옌 티 흐엉', '제임스 카터', '무함마드 라시드', '박솔', '이든']) {
      expect(names).toContain(expectedName);
    }
    // 비개인정보 오탐 방지
    for (const nonPii of ['인라인', '문자열', '휴대전화 아래 숫자셀 참고', '작업자', '연결처']) {
      expect(candidates.map((c) => c.originalText)).not.toContain(nonPii);
    }
    // 전화번호 5건(국제전화·숫자셀 포함) + 주민번호 1건
    for (const expectedPhone of ['010-2345-6789', '010-3456-7890', '+82-10-9876-5432', '010 9999 0000', '1098765432']) {
      expect(phones).toContain(expectedPhone);
    }
    expect(rrns).toContain('9001011234567');

    // 기본 정책으로 비식별화 후 원문 잔존 여부 및 마스킹 형식 검증
    const session = new WorkSession();
    const { applied } = applyToText(parsed.text, candidates, session);
    const blob = buildZipResult(parsed, applied);
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const combinedXml = strFromU8(out['xl/sharedStrings.xml']) + '\n' + strFromU8(out['xl/worksheets/sheet1.xml']);

    for (const secret of [
      '최다은', '한결', '응우옌 티 흐엉', '제임스 카터', '무함마드 라시드', '박솔', '이든',
      '+82-10-9876-5432', '1098765432', '9001011234567',
    ]) {
      expect(combinedXml).not.toContain(secret);
    }
    expect(combinedXml).toContain('+82-10-****-5432');
    expect(combinedXml).toContain('10****5432');
    expect(combinedXml).toContain('휴대전화 아래 숫자셀 참고');
  });

  it('미등록 헤더 XLSX에서도 같은 열의 기탐지 패턴으로 나머지 성명과 숫자셀 전화번호를 추론한다', () => {
    const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="명단" sheetId="1"/></sheets></workbook>`;
    const sharedStrings = `<?xml version="1.0"?><sst count="10" uniqueCount="10"><si><t>항목A</t></si><si><t>항목B</t></si><si><t>김철수</t></si><si><t>010-1234-5678</t></si><si><t>한결</t></si><si><t>010-2222-3333</t></si><si><t>응우옌 티 흐엉</t></si><si><t>이든</t></si><si><t>박솔</t></si><si><t>비고없음</t></si></sst>`;
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
      <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c></row>
      <row r="4"><c r="A4" t="s"><v>6</v></c><c r="B4"><v>1098765432</v></c></row>
      <row r="5"><c r="A5" t="s"><v>7</v></c><c r="B5" t="s"><v>9</v></c></row>
    </sheetData></worksheet>`;
    const buf = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'xl/workbook.xml': strToU8(workbook),
      'xl/sharedStrings.xml': strToU8(sharedStrings),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    }).buffer;

    const parsed = parseZipDocument(buf, 'xlsx');
    resetIdCounter();
    const candidates = analyze(parsed);
    const names = candidates.filter((c) => c.type === 'PERSON_NAME').map((c) => c.originalText);
    const phones = candidates.filter((c) => c.type === 'PHONE_MOBILE').map((c) => c.originalText);

    expect(names).toEqual(expect.arrayContaining(['김철수', '한결', '응우옌 티 흐엉', '이든']));
    expect(phones).toEqual(expect.arrayContaining(['010-1234-5678', '010-2222-3333', '1098765432']));
    expect(phones).not.toContain('비고없음');
  });

  it('xl/styles.xml의 사용자 지정 전화번호 숫자 서식(000-0000-0000)을 해석해 숫자셀을 탐지한다', () => {
    const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="시트1" sheetId="1"/></sheets></workbook>`;
    const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="000-0000-0000"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`;
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="1"><v>1098765432</v></c></row></sheetData></worksheet>`;
    const buf = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
      'xl/workbook.xml': strToU8(workbook),
      'xl/styles.xml': strToU8(styles),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    }).buffer;

    const parsed = parseZipDocument(buf, 'xlsx');
    resetIdCounter();
    const candidates = analyze(parsed);
    expect(candidates.some((c) => c.type === 'PHONE_MOBILE' && c.originalText === '1098765432')).toBe(true);
  });
});

// ---------- DOCX ----------

describe('DOCX 처리 (기술명세서 Ⅳ-5)', () => {
  it('분리된 텍스트 런을 결합하여 분석한다', () => {
    const parsed = parseZipDocument(makeDocx(), 'docx');
    // "홍길" + "동"이 결합되어 하나의 텍스트로 나타나야 함
    expect(parsed.text).toContain('홍길동');
    const candidates = detectAll(parsed.text);
    expect(candidates.some((c) => c.originalText === '홍길동')).toBe(true);
  });

  it('세그먼트에 걸친 치환이 정상 반영되고 XML 구조가 유지된다', () => {
    const parsed = parseZipDocument(makeDocx(), 'docx');
    const { applied } = deidentify(parsed);

    const blob = buildZipResult(parsed, applied);
    return blob.arrayBuffer().then((buf) => {
      const out = unzipSync(new Uint8Array(buf));
      const doc = strFromU8(out['word/document.xml']);
      expect(doc).not.toContain('홍길');
      expect(doc).not.toContain('010-1234-5678');
      expect(doc).not.toContain('테헤란로 152');
      expect(doc).toContain('[성명_001]');
      // 문단·런 구조 유지
      expect((doc.match(/<w:p>/g) || []).length).toBe(2);
      expect((doc.match(/<w:t>/g) || []).length + (doc.match(/<w:t\s/g) || []).length).toBe(3);
    });
  });
});

// ---------- HWPX ----------

describe('HWPX 처리 (기술명세서 Ⅳ-6)', () => {
  it('본문 텍스트를 추출·치환하고 구조를 유지한다', () => {
    const parsed = parseZipDocument(makeHwpx(), 'hwpx');
    expect(parsed.text).toContain('김철수');
    const { applied } = deidentify(parsed);

    const blob = buildZipResult(parsed, applied);
    return blob.arrayBuffer().then((buf) => {
      const out = unzipSync(new Uint8Array(buf));
      const sec = strFromU8(out['Contents/section0.xml']);
      expect(sec).not.toContain('김철수');
      expect(sec).not.toContain('010-9876-5432');
      expect(sec).toContain('<hp:t>');
      expect(sec).toContain('</hp:p>');
      // mimetype 항목 보존
      expect(strFromU8(out.mimetype)).toBe('application/hwp+zip');
    });
  });

  it('mimetype 항목을 첫 항목이자 무압축(STORE)으로 저장한다', async () => {
    const parsed = parseZipDocument(makeHwpx(), 'hwpx');
    const { applied } = deidentify(parsed);
    const bytes = new Uint8Array(await buildZipResult(parsed, applied).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0); // compression method: STORE
    const nameLength = view.getUint16(26, true);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));
    expect(name).toBe('mimetype');
  });
});

// ---------- 보안 ----------

describe('ZIP 보안 검증 (NFR-007)', () => {
  it('ZIP이 아닌 파일은 손상 문서로 거부한다', async () => {
    const notZip = new TextEncoder().encode('평문 텍스트').buffer;
    expect(() => parseZipDocument(notZip, 'xlsx')).toThrow(/E005/);
  });

  it('OLE(암호화 Office) 컨테이너는 암호 문서로 안내한다', () => {
    const ole = new Uint8Array(16);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => parseZipDocument(ole.buffer, 'docx')).toThrow(/E004/);
  });

  it('필수 구조가 없는 ZIP은 구조 오류로 거부한다', () => {
    const fake = zipSync({ 'hello.txt': strToU8('내용') }).buffer;
    expect(() => parseZipDocument(fake, 'xlsx')).toThrow(/E009/);
  });

  it('중앙 디렉터리의 선언 크기가 한도를 넘으면 압축 해제 전에 거부한다', () => {
    const bytes = zipSync({
      'xl/workbook.xml': strToU8('<workbook/>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><t>내용</t></worksheet>'),
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let central = -1;
    for (let i = 0; i <= bytes.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) { central = i; break; }
    }
    expect(central).toBeGreaterThan(0);
    view.setUint32(central + 24, 301 * 1024 * 1024, true);
    expect(() => parseZipDocument(bytes.buffer, 'xlsx')).toThrow(/압축해제 크기/);
  });
});

describe('test/documents 통합 시험 문서 (DOCX·HWPX)', () => {
  it('03_개인정보_실태점검_회의록.docx의 본문·표·머리글을 추출하고 비식별화한다', async () => {
    const bytes = readFileSync(new URL('./documents/03_개인정보_실태점검_회의록.docx', import.meta.url));
    const parsed = parseZipDocument(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'docx');
    expect(parsed.meta.tableCount).toBe(4);
    expect(parsed.text).toContain('김서연');
    expect(parsed.text).toContain('900101-1234567');

    const { applied } = deidentify(parsed);
    expect(applied.some((c) => c.originalText === '900101-1234567')).toBe(true);
    const blob = buildZipResult(parsed, applied);
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(strFromU8(out['word/document.xml'])).not.toContain('900101-1234567');
  });

  it('05_업무협조_및_점검보고서.hwpx의 본문·표 텍스트를 추출하고 비식별화한다', async () => {
    const bytes = readFileSync(new URL('./documents/05_업무협조_및_점검보고서.hwpx', import.meta.url));
    const parsed = parseZipDocument(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'hwpx');
    expect(parsed.text).toContain('김서연');
    expect(parsed.text).toContain('900101-1234567');
    expect(parsed.text).toContain('응우옌 티 흐엉');

    const { applied } = deidentify(parsed);
    expect(applied.some((c) => c.originalText === '900101-1234567')).toBe(true);
    const blob = buildZipResult(parsed, applied);
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const sec = strFromU8(out['Contents/section0.xml']);
    expect(sec).toContain('<hp:tbl');
    expect(sec).not.toContain('900101-1234567');
  });

  it('05 HWPX 시험 문서는 한글에서 글자가 겹치지 않도록 글자 모양을 모두 정의한다', async () => {
    const bytes = readFileSync(new URL('./documents/05_업무협조_및_점검보고서.hwpx', import.meta.url));
    const parsed = parseZipDocument(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'hwpx');
    const { applied } = deidentify(parsed);
    const blob = buildZipResult(parsed, applied);
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const header = strFromU8(out['Contents/header.xml']);

    // 처리 과정은 글자 모양 정의를 변경하지 않는다
    expect(header).toBe(strFromU8(parsed.entries['Contents/header.xml']));

    const charProps = [...header.matchAll(/<hh:charPr\b[^>]*>[\s\S]*?<\/hh:charPr>/g)].map((m) => m[0]);
    expect(charProps.length).toBeGreaterThan(0);
    for (const charPr of charProps) {
      // 장평·상대 크기가 없으면 한글이 0%로 해석해 글자를 한 점에 겹쳐 그린다
      expect(charPr).toMatch(/<hh:ratio\b[^>]*hangul="100"/);
      expect(charPr).toMatch(/<hh:relSz\b[^>]*hangul="100"/);
      // 글자 테두리는 표 테두리(SOLID)를 참조하면 안 된다
      const fillId = /borderFillIDRef="(\d+)"/.exec(charPr)[1];
      const fill = new RegExp(`<hh:borderFill id="${fillId}"[\\s\\S]*?</hh:borderFill>`).exec(header)[0];
      expect(fill).not.toContain('type="SOLID"');
    }
    for (const lang of ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']) {
      expect(header).toContain(`<hh:fontface lang="${lang}"`);
    }
  });
});

describe('HWPX 미리보기 개인정보 제거', () => {
  it('결과 파일의 미리보기 문자열과 이미지에 원본 내용이 남지 않는다', async () => {
    const original = unzipSync(new Uint8Array(makeHwpx()));
    const originalImage = strToU8('원본 첫 쪽 그림 김철수');
    const bytes = zipSync({
      ...original,
      'Preview/PrvText.txt': strToU8('신청인 김철수 (010-9876-5432)'),
      'Preview/PrvImage.png': originalImage,
    });
    const parsed = parseZipDocument(bytes.buffer, 'hwpx');
    const { applied } = deidentify(parsed);
    const blob = buildZipResult(parsed, applied);
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));

    // container.xml이 참조할 수 있으므로 항목은 유지하고 내용만 제거한다
    expect(out['Preview/PrvText.txt']).toHaveLength(0);
    expect(strFromU8(out['Preview/PrvImage.png'], true)).not.toContain('김철수');
    expect([...out['Preview/PrvImage.png'].slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    for (const [name, data] of Object.entries(out)) {
      expect(strFromU8(data, true), name).not.toContain('010-9876-5432');
    }
  });

  it('문서 속성의 작성자·마지막 저장자를 비우고 다른 속성은 유지한다', async () => {
    const original = unzipSync(new Uint8Array(makeHwpx()));
    const hpf = '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:metadata><opf:title>보고서</opf:title>'
      + '<opf:meta name="creator" content="text">작성자계정</opf:meta>'
      + '<opf:meta name="subject" content="text"/>'
      + '<opf:meta name="lastsaveby" content="text">저장자계정</opf:meta>'
      + '<opf:meta name="CreatedDate" content="text">2026-11-24T03:08:49Z</opf:meta>'
      + '</opf:metadata></opf:package>';
    const parsed = parseZipDocument(zipSync({ ...original, 'Contents/content.hpf': strToU8(hpf) }).buffer, 'hwpx');
    const { applied } = deidentify(parsed);
    const out = unzipSync(new Uint8Array(await buildZipResult(parsed, applied).arrayBuffer()));
    const result = strFromU8(out['Contents/content.hpf']);

    expect(result).not.toContain('작성자계정');
    expect(result).not.toContain('저장자계정');
    expect(result).toContain('<opf:meta name="creator" content="text"/>');
    expect(result).toContain('<opf:meta name="lastsaveby" content="text"/>');
    expect(result).toContain('<opf:title>보고서</opf:title>');
    expect(result).toContain('<opf:meta name="subject" content="text"/>');
    expect(result).toContain('2026-11-24T03:08:49Z');
  });

  it('작성자가 비어 있는 self-closing 항목 뒤의 속성을 훼손하지 않는다', async () => {
    const original = unzipSync(new Uint8Array(makeHwpx()));
    const hpf = '<opf:metadata><opf:meta name="creator" content="text"/>'
      + '<opf:meta name="date" content="text">2026년 11월 24일</opf:meta></opf:metadata>';
    const parsed = parseZipDocument(zipSync({ ...original, 'Contents/content.hpf': strToU8(hpf) }).buffer, 'hwpx');
    const { applied } = deidentify(parsed);
    const out = unzipSync(new Uint8Array(await buildZipResult(parsed, applied).arrayBuffer()));
    expect(strFromU8(out['Contents/content.hpf'])).toBe(hpf);
  });
});
