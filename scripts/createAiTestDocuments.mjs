// AI 탐지 시험용 문서 생성기
//
//   node scripts/createAiTestDocuments.mjs
//
// 규칙 기반 탐지가 원리적으로 놓치는 사례를 의도적으로 심어 둔 문서를 만든다.
// 어떤 규칙이 왜 실패하는지는 test/fixtures/documents/정답지.md 에 근거와 함께 기록된다.
//
// 외부 의존성 없이 프로젝트에 이미 있는 fflate만 사용한다.
// (기존 createTestDocuments.py는 python-docx·reportlab·한글 설치 템플릿이 필요하고,
//  createTestXlsx.mjs는 사내 전용 패키지가 필요해 재현이 어렵다)

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../test/fixtures/documents');
mkdirSync(OUT, { recursive: true });

// 면책 문구 자체가 오탐을 만들지 않도록 성씨 사전과 겹치는 단어를 피해 작성했다.
// (예: "인적사항"은 '인'이 성씨 사전에 있어 모든 문서에서 성명으로 오탐된다)
const DISCLAIMER = '※ 아래에 나오는 사람 이름과 번호, 주소는 모두 시험용으로 지어낸 가상 정보입니다.';

const xmlEscape = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─────────────────────────────────────────────────────────────────
// 1. 문맥형 — 필드명 없이 문장 속에 묻힌 개인정보
// ─────────────────────────────────────────────────────────────────
const 문맥형 = `2026년 상반기 민원 처리 대장
${DISCLAIMER}

접수번호: MW-2026-0417
담당자: 김서연 주무관

[접수 경위]
지난 3월 12일 오후 창구를 찾은 민원인이 등본 발급 지연을 문제 삼았다.
최초 접수는 김서연 주무관이 맡았고, 뒤이어 한결이 서류를 넘겨받아 검토하였다.
환불 계좌는 국민은행 123456-78-901234 이며 예금주는 최다은이다.
이후 응우옌 티 흐엉 씨가 통역을 대동하고 방문하여 추가 자료를 제출하였다.
통역은 제임스 카터가 맡았으며, 동행인 왕리메이는 서명만 남기고 돌아갔다.

[처리 경과]
민원인 배우자 되는 분이 대신 연락을 주셨는데 성함은 밝히지 않으셨다.
다만 2019년에 입사한 재무팀 유일한 남성 대리라고만 하셨다.
회신은 테헤란로 152 3층 사무실로 보내달라는 요청이 있었다.
서류 검토는 박솔이 마무리하였다.

[특이사항]
작년 유사 사례를 담당했던 직원이 지금은 홍보실로 옮겼다.
당시 처리자 이름은 무함마드 라시드였고 현재 연락은 닿지 않는다.
민원인 본인 확인은 완료하였다.
작성자 미상 첨부물 1건은 반려하였다.
`;

// ─────────────────────────────────────────────────────────────────
// 2. 변형표기 — 정규식이 기대하는 형식에서 벗어난 표기
// ─────────────────────────────────────────────────────────────────
const 변형표기 = `상담 메모 (내부용)
${DISCLAIMER}

- 본인 확인: 주민등록번호 900101 - 1234567 (구분자 앞뒤 공백)
- 구술 확인분: 구공공일공일 다시 일이삼사오육칠
- 연락 가능한 번호: +82-10-9876-5432
- 대체 연락처: 공일공 구팔칠육 오사삼이
- 야간 연락처: 010_5555_6666
- 이메일: hong[at]example[dot]com
- 두 번째 이메일: minji dot kim (at) test.co.kr
- 급여 계좌: 110 123 456789 (신한)
- 자택은 판교역로 235 이며 우편물은 이쪽으로 보내 달라고 함
- 사무실은 테헤란로 152 3층

추가 확인 사항
상담자는 배수지였고 배석자는 이든이었다.
민원인이 남긴 메모에는 "제 번호 끝자리는 5432입니다"라고만 적혀 있었다.
`;

// ─────────────────────────────────────────────────────────────────
// 3. 오탐 함정 — 규칙이 개인정보로 잘못 잡는 표현들
// ─────────────────────────────────────────────────────────────────
const 오탐함정 = `전 직원 공지사항
${DISCLAIMER}
이 문서에 실제 개인정보는 마지막 한 줄뿐입니다.

1. 강원도 및 경상북도 출장 규정이 변경되었습니다.
2. 국민은행, 신한은행, 우리은행 계좌만 급여 이체가 가능합니다.
3. 정보통신 설비 점검은 전산실에서 진행합니다.
4. 작성자 미상 문서는 접수하지 않습니다.
5. 보호자 동의 없이는 미성년자 민원을 처리할 수 없습니다.
6. 대리인 자격으로 방문하실 경우 위임장을 지참하십시오.
7. 담당자 부재중일 때는 고객센터로 연결됩니다.
8. 예금주 본인 명의 계좌만 등록됩니다.
9. 신청인 다수가 동일한 사유로 접수하는 경우 일괄 처리합니다.
10. 대표전화 02-2100-3847 로 문의하십시오. (부서 공용 번호입니다)

문의 담당: 총무팀 이도현 과장
`;

// ─────────────────────────────────────────────────────────────────
// 4. 비정형 헤더 CSV — 열 제목이 사전에 없어 헤더 힌트가 동작하지 않는다
// ─────────────────────────────────────────────────────────────────
const 비정형헤더 = `구분,작업자,연결처,소속,비고
${DISCLAIMER.replace(/,/g, '')},,,,
정규,응우옌 반 남,010-2345-6789,협력사A,베트남 국적
정규,왕리메이,010-3456-7890,협력사B,중국 국적
계약,한결,010-4567-8901,협력사A,두 글자 성명
계약,제임스 카터,+82-10-5678-9012,협력사C,국제전화 표기
정규,최다은,공일공 육칠팔구 영일이삼,협력사B,한글 숫자 표기
계약,박솔,010 9999 0000,협력사A,공백 구분
정규,무함마드 라시드,010-1111-2222,협력사D,중동 국적
`;

writeFileSync(join(OUT, '01_문맥형_민원처리대장.txt'), '﻿' + 문맥형, 'utf8');
writeFileSync(join(OUT, '02_변형표기_상담메모.txt'), '﻿' + 변형표기, 'utf8');
writeFileSync(join(OUT, '03_오탐함정_내부공지.txt'), '﻿' + 오탐함정, 'utf8');
writeFileSync(join(OUT, '04_비정형헤더_외부인력명부.csv'), '﻿' + 비정형헤더, 'utf8');

// ─────────────────────────────────────────────────────────────────
// 5. DOCX — 텍스트 런이 쪼개진 문서 + 머리글
//    safeDoc은 같은 문단 안의 <w:t>를 이어 붙여 분석한다(xmlDoc.js).
//    이름이 런 경계에서 잘려 있어도 찾아내는지 확인한다.
// ─────────────────────────────────────────────────────────────────
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const para = (runs) => `<w:p>${runs.map((t) => `<w:r><w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r>`).join('')}</w:p>`;

const docxBody = [
  para(['회의록 — 개인정보 처리 실태 점검']),
  para([DISCLAIMER]),
  para(['']),
  // 이름이 런 경계에서 쪼개진 경우 (한글 문서에서 흔히 발생한다)
  para(['참석자는 최', '다은 주임과 한', '결, 그리고 응우', '옌 티 흐엉 통역이었다.']),
  para(['서기는 박', '솔이 맡았다.']),
  para(['']),
  para(['논의 내용']),
  para(['1. 예금주는 최다은이며 환불 계좌는 국민은행 123456-78-901234 이다.']),
  para(['2. 2019년에 입사한 재무팀 유일한 남성 대리가 담당하기로 하였다.']),
  para(['3. 회신 주소는 테헤란로 152 3층으로 한다.']),
  para(['4. 연락은 +82-10-9876-5432 로 한다.']),
  para(['']),
  para(['작성자 미상 자료는 폐기한다. 대리인 자격 확인은 생략한다.']),
].join('');

const docxDocument = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${docxBody}
<w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr>
</w:body></w:document>`;

// 머리글에도 개인정보를 넣어 header1.xml 처리 경로를 확인한다
const docxHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W_NS}>${para(['담당 이도현 과장 | 내선 1234 | 무함마드 라시드 협력'])}</w:hdr>`;

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

writeFileSync(join(OUT, '05_런분리_회의록.docx'), Buffer.from(zipSync({
  '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`),
  '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
  'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`),
  'word/document.xml': strToU8(docxDocument),
  'word/header1.xml': strToU8(docxHeader),
})));

// ─────────────────────────────────────────────────────────────────
// 6. XLSX — 공유 문자열 + 인라인 문자열 + 숫자 셀
//    숫자 셀(<v>)은 safeDoc이 아직 스캔하지 않는 알려진 공백이다.
//    정답지에 '알려진 미탐'으로 표시해 두어 회귀 확인에 쓴다.
// ─────────────────────────────────────────────────────────────────
const shared = [
  '근태 기록', DISCLAIMER,
  '구분', '작업자', '연결처', '메모',
  '정규', '최다은', '010-2345-6789', '예금주는 최다은이다',
  '계약', '한결', '010-3456-7890', '두 글자 성명이라 규칙 점수가 낮다',
  '정규', '응우옌 티 흐엉', '+82-10-9876-5432', '외국인 성명과 국제전화 표기',
  '계약', '제임스 카터', '휴대전화 아래 숫자셀 참고', '숫자 서식 셀에 번호가 들어 있다',
];
const si = shared.map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join('');

const S_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const col = (n) => String.fromCharCode(65 + n);
// 공유 문자열 셀
const sc = (r, c, idx) => `<c r="${col(c)}${r}" t="s"><v>${idx}</v></c>`;
// 인라인 문자열 셀 (safeDoc이 시트에서 직접 <t>를 읽는 경로)
const ic = (r, c, text) => `<c r="${col(c)}${r}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
// 숫자 셀 — 알려진 미탐 지점
const nc = (r, c, v) => `<c r="${col(c)}${r}"><v>${v}</v></c>`;

const rows = [
  `<row r="1">${sc(1, 0, 0)}</row>`,
  `<row r="2">${sc(2, 0, 1)}</row>`,
  `<row r="4">${sc(4, 0, 2)}${sc(4, 1, 3)}${sc(4, 2, 4)}${sc(4, 3, 5)}</row>`,
  `<row r="5">${sc(5, 0, 6)}${sc(5, 1, 7)}${sc(5, 2, 8)}${sc(5, 3, 9)}</row>`,
  `<row r="6">${sc(6, 0, 10)}${sc(6, 1, 11)}${sc(6, 2, 12)}${sc(6, 3, 13)}</row>`,
  `<row r="7">${sc(7, 0, 14)}${sc(7, 1, 15)}${sc(7, 2, 16)}${sc(7, 3, 17)}</row>`,
  `<row r="8">${sc(8, 0, 18)}${sc(8, 1, 19)}${sc(8, 2, 20)}${sc(8, 3, 21)}</row>`,
  // 인라인 문자열로만 존재하는 행
  `<row r="9">${ic(9, 0, '정규')}${ic(9, 1, '무함마드 라시드')}${ic(9, 2, '010 9999 0000')}${ic(9, 3, '인라인 문자열 셀에 들어 있는 외국인 성명')}</row>`,
  // 숫자 서식 셀 — 전화번호와 주민번호 뒷자리 (현재 미탐)
  `<row r="10">${ic(10, 0, '숫자셀')}${ic(10, 1, '박솔')}${nc(10, 2, 1098765432)}${ic(10, 3, '연락처가 숫자 서식으로 저장되어 있다')}</row>`,
  `<row r="11">${ic(11, 0, '숫자셀')}${ic(11, 1, '이든')}${nc(11, 2, 9001011234567)}${ic(11, 3, '주민등록번호가 숫자 서식으로 저장되어 있다')}</row>`,
].join('');

writeFileSync(join(OUT, '06_숫자셀_근태기록.xlsx'), Buffer.from(zipSync({
  '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`),
  '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
  'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${REL_NS}>
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`),
  'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook ${S_NS}><sheets><sheet name="근태기록" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst ${S_NS} count="${shared.length}" uniqueCount="${shared.length}">${si}</sst>`),
  'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet ${S_NS}><sheetData>${rows}</sheetData></worksheet>`),
})));

const files = [
  '01_문맥형_민원처리대장.txt',
  '02_변형표기_상담메모.txt',
  '03_오탐함정_내부공지.txt',
  '04_비정형헤더_외부인력명부.csv',
  '05_런분리_회의록.docx',
  '06_숫자셀_근태기록.xlsx',
];
console.log(`생성 위치: ${OUT}`);
for (const f of files) console.log(`  ${f}`);
