// AI 탐지 시험용 문서 생성기
//
//   node scripts/createAiTestDocuments.mjs
//
// 지원 파일 형식(txt, csv, xlsx, docx, hwpx, pdf)별로 각 1종씩,
// 3~4쪽 이상 분량의 시험 문서를 test/documents/ 에 생성한다.
//
// 프로젝트 의존성(fflate, pdf-lib, @pdf-lib/fontkit)만 사용한다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../test/documents');
mkdirSync(OUT, { recursive: true });

// 면책 문구 자체가 오탐을 만들지 않도록 성씨 사전과 겹치는 단어를 피해 작성했다.
const DISCLAIMER = '※ 아래에 나오는 사람 이름과 번호, 주소는 모두 시험용 가상 정보입니다.';

const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─────────────────────────────────────────────────────────────────
// 1. TXT — 문맥형 + 변형표기 + 오탐함정 통합 문서 (약 4쪽 분량)
// ─────────────────────────────────────────────────────────────────
const extraComplaints = [
  ['MW-2026-0418', '2026-03-14', '서지원', '010-4123-7891', '대전광역시 서구 둔산로 100', '국민건강보험 자격득실 확인서 발급 지연 민원. 당초 강민호 주무관이 초안을 작성하였으나 출장 중이라 서지원이 이어받아 처리함.'],
  ['MW-2026-0419', '2026-03-16', '응우옌 반 남', '+82-10-6543-2109', '인천광역시 연수구 송도과학로 32', '외국인 등록 사실증명서 정정 요청. 통역인 알렉산더 킴이 동석하여 서류를 대독하였으며, 회신 이메일은 nguyen.nam[at]example[dot]com 으로 요청함.'],
  ['MW-2026-0420', '2026-03-18', '한결', '010_7788_9900', '경기도 성남시 분당구 판교역로 235', '세목별 과세증명서 오기재 이의신청. 2글자 성명인 한결이 직접 내방하였고 대리인 위임장은 제출하지 않았음.'],
  ['MW-2026-0421', '2026-03-21', '최다은', '공일공 이삼사오 육칠팔구', '서울특별시 강남구 테헤란로 152 3층', '과오납 환급금 지급 계좌 변경 요청. 변경 계좌는 우리은행 1002 345 678901 이며 예금주는 최다은이다.'],
  ['MW-2026-0422', '2026-03-24', '박솔', '010 8899 1122', '부산광역시 해운대구 센텀중앙로 79', '건축물대장 현황도 열람 신청. 현장 안내를 맡은 직원은 홍보실로 전보된 무함마드 라시드의 후임이다.'],
  ['MW-2026-0423', '2026-03-27', '제임스 카터', '+82-10-3344-5566', '서울특별시 용산구 이태원로 177', '체류지 변경 신고 누락 보완 요청. 연락 가능한 이메일은 j.carter(at)sample.org 이며 팩스 번호는 02-790-1122이다.'],
  ['MW-2026-0424', '2026-04-02', '왕리메이', '010-5566-7788', '경기도 수원시 영통구 광교중앙로 145', '보육료 지원 자격 재심사 청구. 주민등록번호 920514 - 2345678 로 조회 시 전산 누락이 확인되어 수기 보완함.'],
  ['MW-2026-0425', '2026-04-05', '이든', '010-9911-2233', '대구광역시 수성구 달구벌대로 2450', '주차위반 과태료 의견진술서 접수. 2018년에 입사한 감사담당관실 유일한 여성 팀장이 결재를 진행함.'],
  ['MW-2026-0426', '2026-04-09', '배수지', '010-2233-4455', '광주광역시 서구 상무중앙로 110', '상수도 요금 감면 소급 적용 요청. 신한은행 110-456-789012 계좌로 차액을 정산할 예정임.'],
  ['MW-2026-0427', '2026-04-12', '장하늘', '공일공 사오육칠 팔구영일', '울산광역시 남구 삼산로 270', '소상공인 경영안정자금 추천서 재발급. 신청서 상단에는 작성자 미상으로 기재되어 있었으나 실제 제출자는 장하늘이었다.'],
  ['MW-2026-0428', '2026-04-15', '윤서아', '010-6677-8899', '세종특별자치시 한누리대로 2130', '전입세대 확인서 열람 제한 해제 신청. 세대주 본인 확인 후 처리하였으며 보조 연락처는 yoon.seoa dot test (at) mail.co.kr 이다.'],
  ['MW-2026-0429', '2026-04-19', '김도윤', '010_3311_2244', '강원특별자치도 춘천시 중앙로 1', '지방세 납세증명서 영문 발급 요청. 여권 성명 KIM DOYUN, 여권번호 M12345678 대조 완료.'],
];

const txtContent = `2026년 상반기 민원·상담·공지 통합 시험 문서
${DISCLAIMER}

======================================================================
[1부] 2026년 상반기 민원 처리 대장 (문맥형 식별 사례)
======================================================================

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

[후속 민원 처리 이력]
${extraComplaints.map(([id, dt, name, phone, addr, desc]) => (
  `- 접수번호 ${id} (${dt}) | 신청인: ${name} | 연락처: ${phone}\n  거주지: ${addr}\n  내용: ${desc}`
)).join('\n\n')}

======================================================================
[2부] 상담 메모 (비정형·변형 표기 사례)
======================================================================

상담 일시: 2026년 4월 20일 14:00
상담 기록자: 총무팀 오세훈

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

[추가 확인 사항]
상담자는 배수지였고 배석자는 이든이었다.
민원인이 남긴 메모에는 "제 번호 끝자리는 5432입니다"라고만 적혀 있었다.
추가 상담 내역은 아래와 같이 요약한다.
1) 1차 유선 상담: 010 2468 1357 로 연결 시도했으나 부재중이어서 문자 발송.
2) 2차 방문 상담: 주민등록번호 851122 - 1098765 확인 후 대리인 위임 여부 점검.
3) 이메일 회신 요청: park_jihoon[at]partner[dot]kr 및 support dot center (at) public.go.kr.
4) 계좌 정정: 기업은행 010 2233 44556677 (예금주 송민재).
5) 참고 주소: 세종대로 209 정부서울청사 별관 4층 민원실.

======================================================================
[3부] 전 직원 공지사항 (규칙 오탐 함정 사례)
======================================================================

제목: 2026년 2분기 개인정보 보호 및 문서 작성 유의사항 안내
이 영역의 본문에는 실제 개인정보가 없으며, 마지막 줄에만 담당자 정보가 있습니다.

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
11. 위임장 서식은 사내 게시판 자료실에서 내려받을 수 있습니다.
12. 동일한 사유로 재접수된 건은 기존 처리 부서에서 일괄 검토합니다.
13. 개인정보 처리방침 개정안은 법무팀 검토를 거쳐 다음 달 시행됩니다.
14. 외부 반출 문서는 반드시 비식별 처리 후 결재권자 승인을 받아야 합니다.
15. 대용량 첨부파일은 사내 보안 웹하드를 통해서만 전달하시기 바랍니다.
16. 부서별 자체 점검표는 매월 마지막 주 금요일까지 제출해 주십시오.

문의 담당: 총무팀 이도현 과장
`;

writeFileSync(join(OUT, '01_민원상담_및_공지모음.txt'), '\uFEFF' + txtContent, 'utf8');

// ─────────────────────────────────────────────────────────────────
// 2. CSV — 비정형 헤더 명부 (약 125행, 3~4쪽 이상 분량)
// ─────────────────────────────────────────────────────────────────
const csvSeedRows = [
  ['정규', '응우옌 반 남', '010-2345-6789', '협력사A', '베트남 국적'],
  ['정규', '왕리메이', '010-3456-7890', '협력사B', '중국 국적'],
  ['계약', '한결', '010-4567-8901', '협력사A', '두 글자 성명'],
  ['계약', '제임스 카터', '+82-10-5678-9012', '협력사C', '국제전화 표기'],
  ['정규', '최다은', '공일공 육칠팔구 영일이삼', '협력사B', '한글 숫자 표기'],
  ['계약', '박솔', '010 9999 0000', '협력사A', '공백 구분'],
  ['정규', '무함마드 라시드', '010-1111-2222', '협력사D', '중동 국적'],
];

const csvExtraNames = [
  '김서연', '이도현', '박지훈', '최수빈', '정우성', '강민지', '조현우', '윤서아',
  '장하늘', '임지민', '한소희', '오세훈', '서지원', '신동욱', '권나영', '황민호',
  '안유진', '송민재', '홍길동', '유재석', '이든', '배수지', '김도윤', '박서준',
  '마리아 가르시아', '다나카 켄지', '사라 윌슨', '리 웨이', '파티마 알리', '데이비드 브라운',
];
const csvDepts = ['협력사A', '협력사B', '협력사C', '협력사D', '외부자문단', '보안점검반'];
const csvNotes = [
  '야간 보안 관제 지원', '시스템 유지보수 상주', '문서 비식별 검수', '데이터 이관 작업',
  '네트워크 점검 지원', '품질 보증 테스트', '고객센터 기술 지원', '통번역 지원 인력',
];

const csvRows = [
  '구분,작업자,연결처,소속,비고',
  `${DISCLAIMER.replace(/,/g, '')},,,,`,
  ...csvSeedRows.map((r) => r.join(',')),
];

for (let i = 0; i < 118; i++) {
  const empType = i % 3 === 0 ? '계약' : '정규';
  const name = csvExtraNames[i % csvExtraNames.length];
  const mid = String(1000 + ((i * 73) % 9000)).padStart(4, '0');
  const tail = String(1000 + ((i * 137) % 9000)).padStart(4, '0');
  const phone = i % 5 === 0
    ? `+82-10-${mid}-${tail}`
    : i % 7 === 0
      ? `010 ${mid} ${tail}`
      : `010-${mid}-${tail}`;
  const dept = csvDepts[i % csvDepts.length];
  const note = `${csvNotes[i % csvNotes.length]} (${i + 8}번 구역)`;
  csvRows.push(`${empType},${name},${phone},${dept},${note}`);
}

writeFileSync(join(OUT, '02_외부인력_및_협력사명부.csv'), '\uFEFF' + csvRows.join('\n') + '\n', 'utf8');

// ─────────────────────────────────────────────────────────────────
// 3. DOCX — 런 분리 + 테이블 + 페이지 나누기 포함 4쪽 회의록
// ─────────────────────────────────────────────────────────────────
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const docxPara = (runs, { bold = false, pageBreakBefore = false } = {}) => {
  const pPr = pageBreakBefore ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : '';
  const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p>${pPr}${runs.map((t) => `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r>`).join('')}</w:p>`;
};

const docxTable = (headers, dataRows) => {
  const tr = (cells, isHeader = false) => `<w:tr>${cells.map((c) => {
    const runs = Array.isArray(c) ? c : [c];
    return `<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tcBorders></w:tcPr>${docxPara(runs, { bold: isHeader })}</w:tc>`;
  }).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${tr(headers, true)}${dataRows.map((r) => tr(r)).join('')}</w:tbl>`;
};

const docxParts = [
  // 1쪽: 회의 개요 및 참석자 표
  docxPara(['2026년 개인정보 처리 실태 점검 회의록'], { bold: true }),
  docxPara([DISCLAIMER]),
  docxPara(['']),
  docxPara(['1. 회의 개요'], { bold: true }),
  docxPara(['일시: 2026년 4월 15일 14:00 ~ 16:30 | 장소: 본관 5층 대회의실']),
  docxPara(['주관: 개인정보보호팀 (간사 김서연 주무관)']),
  docxPara(['참석자는 최', '다은 주임과 한', '결, 그리고 응우', '옌 티 흐엉 통역이었다.']),
  docxPara(['서기는 박', '솔이 맡았다.']),
  docxPara(['']),
  docxPara(['[표 1] 회의 참석자 및 역할 현황'], { bold: true }),
  docxTable(
    ['소속', '성명', '직위/역할', '연락처', '비고'],
    [
      ['개인정보보호팀', ['김', '서연'], '주무관 (간사)', '010-2100-1001', '전체 총괄'],
      ['민원지원과', ['최', '다은'], '주임 (검토)', '010-2345-6789', '런 분리 확인'],
      ['정보화추진팀', ['한', '결'], '대리 (기술)', '010-3456-7890', '2글자 성명'],
      ['외부통역', ['응우', '옌 티 흐엉'], '통역사', '+82-10-9876-5432', '외국인 성명'],
      ['총무과', ['박', '솔'], '주무관 (서기)', '010-9999-0000', '회의록 작성'],
      ['협력사C', ['제임스 ', '카터'], '보안 자문', '+82-10-5678-9012', '영문 성명'],
    ],
  ),

  // 2쪽: 점검 대상 민원 샘플 검토
  docxPara(['2. 점검 대상 민원 샘플 검토 내역'], { bold: true, pageBreakBefore: true }),
  docxPara(['점검 기간 중 접수된 민원 240건 가운데 비정형·문맥형 개인정보가 포함된 12건을 표본으로 선정하여 분석하였다.']),
  docxPara(['1) 예금주는 최다은이며 환불 계좌는 국민은행 123456-78-901234 이다.']),
  docxPara(['2) 2019년에 입사한 재무팀 유일한 남성 대리가 담당하기로 하였다.']),
  docxPara(['3) 회신 주소는 테헤란로 152 3층으로 한다.']),
  docxPara(['4) 야간 비상 연락은 010_5555_6666 또는 hong[at]example[dot]com 으로 진행한다.']),
  docxPara(['']),
  docxPara(['[표 2] 표본 민원 개인정보 검출 및 처리 현황'], { bold: true }),
  docxTable(
    ['접수번호', '대상자', '식별번호/계좌', '연락처/이메일', '거주지'],
    [
      ['MW-2026-0417', '김서연', '900101-1234567', '010-2100-1001', '서울특별시 강남구 테헤란로 152'],
      ['MW-2026-0418', '서지원', '880315-2012345', '010-4123-7891', '대전광역시 서구 둔산로 100'],
      ['MW-2026-0419', '응우옌 반 남', '110-123-456789', 'nguyen.nam@example.com', '인천광역시 연수구 송도과학로 32'],
      ['MW-2026-0420', '왕리메이', '920514-2345678', '010-5566-7788', '경기도 수원시 영통구 광교중앙로 145'],
      ['MW-2026-0421', '배수지', '870707-2112233', '010-2233-4455', '광주광역시 서구 상무중앙로 110'],
      ['MW-2026-0422', '이든', '950101-1998877', '010-9911-2233', '대구광역시 수성구 달구벌대로 2450'],
      ['MW-2026-0423', '장하늘', '1002-345-678901', '010-4567-8901', '울산광역시 남구 삼산로 270'],
      ['MW-2026-0424', '윤서아', '931201-2445566', 'yoon.seoa@mail.co.kr', '세종특별자치시 한누리대로 2130'],
    ],
  ),

  // 3쪽: 변형 표기 및 간접 식별자 논의
  docxPara(['3. 변형 표기 및 간접 식별자 논의 결과'], { bold: true, pageBreakBefore: true }),
  docxPara(['정규식 기반 탐지에서 누락되기 쉬운 변형 표기 사례를 아래와 같이 정리하였다.']),
  docxPara(['- 공백 포함 주민등록번호: 900101 - 1234567 및 구술형 구공공일공일 다시 일이삼사오육칠']),
  docxPara(['- 우회 이메일 표기: minji dot kim (at) test.co.kr, park_jihoon[at]partner[dot]kr']),
  docxPara(['- 국가번호 포함 휴대전화: +82-10-9876-5432, +82-10-3344-5566']),
  docxPara(['- 공백 구분 계좌번호: 110 123 456789 (신한은행), 1002 345 678901 (우리은행)']),
  docxPara(['']),
  docxPara(['[표 3] 오탐 주의 일반 표현 목록 (비개인정보 대조군)'], { bold: true }),
  docxTable(
    ['문구', '유형', '판정 결과', '비고'],
    [
      ['작성자 미상', '일반명사', '비식별 제외', '성명 필드명 뒤 미상 표기'],
      ['보호자 동의', '일반명사', '비식별 제외', '동의 절차 안내 문구'],
      ['대리인 자격', '일반명사', '비식별 제외', '자격 확인 생략 문구'],
      ['국민은행 / 신한은행', '기관명', '비식별 제외', '금융기관 공식 명칭'],
      ['02-2100-3847', '대표전화', '비식별 제외', '기관 공용 대표번호'],
    ],
  ),
  docxPara(['작성자 미상 자료는 폐기한다. 대리인 자격 확인은 생략한다.']),

  // 4쪽: 후속 조치 계획 및 담당자 배정
  docxPara(['4. 후속 조치 계획 및 담당자 배정'], { bold: true, pageBreakBefore: true }),
  docxPara(['각 부서는 아래 일정에 따라 보유 문서의 비식별 처리를 완료하고 결과를 개인정보보호팀으로 제출한다.']),
  docxPara(['']),
  docxPara(['[표 4] 부서별 후속 조치 일정 및 담당자'], { bold: true }),
  docxTable(
    ['추진 과제', '주관 부서', '담당자', '비상 연락처', '완료 기한'],
    [
      ['민원 대장 일괄 비식별화', '민원지원과', '김서연', '010-2100-1001', '2026-04-30'],
      ['외부 인력 명부 암호화', '총무과', '이도현', '010-3100-2002', '2026-05-05'],
      ['상담 메모 변형표기 점검', '고객지원팀', '송민재', '010-4100-3003', '2026-05-10'],
      ['협력사 산출물 파기 확인', '정보화추진팀', '한결', '010-3456-7890', '2026-05-15'],
      ['해외 민원 통역 기록 정비', '국제협력팀', '무함마드 라시드', '010-1111-2222', '2026-05-20'],
    ],
  ),
  docxPara(['']),
  docxPara(['문의처: 서울특별시 종로구 세종대로 209 본관 5층 개인정보보호팀 (담당: 이도현 과장, dpo@safedoc.kr)']),
];

const docxDocument = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${docxParts.join('')}
<w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr>
</w:body></w:document>`;

const docxHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W_NS}>${docxPara(['담당 이도현 과장 | 내선 1234 | 무함마드 라시드 협력'])}</w:hdr>`;

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

writeFileSync(join(OUT, '03_개인정보_실태점검_회의록.docx'), Buffer.from(zipSync({
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
// 4. XLSX — 공유 문자열 + 인라인 문자열 + 숫자 셀 + 다중 시트 (3~4쪽 이상)
//    test/xmlDoc.test.js 의 회귀 검증 항목을 sheet1 상단에 유지하고
//    130여 행 + 2개 시트로 확장한다.
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
const sc = (r, c, idx) => `<c r="${col(c)}${r}" t="s"><v>${idx}</v></c>`;
const ic = (r, c, text) => `<c r="${col(c)}${r}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
const nc = (r, c, v) => `<c r="${col(c)}${r}"><v>${v}</v></c>`;

const sheet1Rows = [
  `<row r="1">${sc(1, 0, 0)}</row>`,
  `<row r="2">${sc(2, 0, 1)}</row>`,
  `<row r="4">${sc(4, 0, 2)}${sc(4, 1, 3)}${sc(4, 2, 4)}${sc(4, 3, 5)}</row>`,
  `<row r="5">${sc(5, 0, 6)}${sc(5, 1, 7)}${sc(5, 2, 8)}${sc(5, 3, 9)}</row>`,
  `<row r="6">${sc(6, 0, 10)}${sc(6, 1, 11)}${sc(6, 2, 12)}${sc(6, 3, 13)}</row>`,
  `<row r="7">${sc(7, 0, 14)}${sc(7, 1, 15)}${sc(7, 2, 16)}${sc(7, 3, 17)}</row>`,
  `<row r="8">${sc(8, 0, 18)}${sc(8, 1, 19)}${sc(8, 2, 20)}${sc(8, 3, 21)}</row>`,
  `<row r="9">${ic(9, 0, '정규')}${ic(9, 1, '무함마드 라시드')}${ic(9, 2, '010 9999 0000')}${ic(9, 3, '인라인 문자열 셀에 들어 있는 외국인 성명')}</row>`,
  `<row r="10">${ic(10, 0, '숫자셀')}${ic(10, 1, '박솔')}${nc(10, 2, 1098765432)}${ic(10, 3, '연락처가 숫자 서식으로 저장되어 있다')}</row>`,
  `<row r="11">${ic(11, 0, '숫자셀')}${ic(11, 1, '이든')}${nc(11, 2, 9001011234567)}${ic(11, 3, '주민등록번호가 숫자 서식으로 저장되어 있다')}</row>`,
];

for (let i = 0; i < 115; i++) {
  const r = 12 + i;
  const kind = i % 3 === 0 ? '계약' : '정규';
  const name = csvExtraNames[i % csvExtraNames.length];
  const mid = String(2000 + ((i * 53) % 7999)).padStart(4, '0');
  const tail = String(1000 + ((i * 97) % 8999)).padStart(4, '0');
  const phone = i % 6 === 0 ? `+82-10-${mid}-${tail}` : `010-${mid}-${tail}`;
  const memo = `정상 출근 기록 (${2026}-04-${String((i % 28) + 1).padStart(2, '0')})`;
  sheet1Rows.push(`<row r="${r}">${ic(r, 0, kind)}${ic(r, 1, name)}${ic(r, 2, phone)}${ic(r, 3, memo)}</row>`);
}

const sheet2Rows = [
  `<row r="1">${ic(1, 0, '부서별 비상연락망')}</row>`,
  `<row r="2">${ic(2, 0, '부서')}${ic(2, 1, '성명')}${ic(2, 2, '휴대전화')}${ic(2, 3, '이메일')}${ic(2, 4, '근무지')}</row>`,
];
const xlsxDepts = ['총무과', '민원지원과', '재무팀', '정보화추진팀', '감사담당관실', '홍보실'];
const xlsxAddrs = [
  '서울특별시 강남구 테헤란로 152',
  '경기도 성남시 분당구 판교역로 235',
  '대전광역시 서구 둔산로 100',
  '세종특별자치시 한누리대로 2130',
];
for (let i = 0; i < 60; i++) {
  const r = 3 + i;
  const dept = xlsxDepts[i % xlsxDepts.length];
  const name = csvExtraNames[(i + 5) % csvExtraNames.length];
  const mid = String(3000 + ((i * 61) % 6999)).padStart(4, '0');
  const tail = String(1000 + ((i * 83) % 8999)).padStart(4, '0');
  const email = `staff${i + 1}@safedoc.kr`;
  const addr = xlsxAddrs[i % xlsxAddrs.length];
  sheet2Rows.push(`<row r="${r}">${ic(r, 0, dept)}${ic(r, 1, name)}${ic(r, 2, `010-${mid}-${tail}`)}${ic(r, 3, email)}${ic(r, 4, addr)}</row>`);
}

writeFileSync(join(OUT, '04_근태_및_인사기록.xlsx'), Buffer.from(zipSync({
  '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`),
  '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
  'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${REL_NS}>
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`),
  'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook ${S_NS}><sheets><sheet name="근태기록" sheetId="1" r:id="rId1"/><sheet name="비상연락망" sheetId="2" r:id="rId2"/></sheets></workbook>`),
  'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst ${S_NS} count="${shared.length}" uniqueCount="${shared.length}">${si}</sst>`),
  'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet ${S_NS}><sheetData>${sheet1Rows.join('')}</sheetData></worksheet>`),
  'xl/worksheets/sheet2.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet ${S_NS}><sheetData>${sheet2Rows.join('')}</sheetData></worksheet>`),
})));

// ─────────────────────────────────────────────────────────────────
// 5. HWPX — 본문 + 다수의 표(table) + 4쪽 분량 OWPML 문서
// ─────────────────────────────────────────────────────────────────
const HWPX_NS = [
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"',
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"',
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"',
  'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"',
  'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"',
].join(' ');

let hwpxId = 100;
const hwpxPara = (runs, { pageBreak = false, charPr = 0 } = {}) => {
  const list = Array.isArray(runs) ? runs : [runs];
  const pb = pageBreak ? ' pageBreak="1"' : ' pageBreak="0"';
  return `<hp:p id="${hwpxId++}" paraPrIDRef="0" styleIDRef="0"${pb} columnBreak="0" merged="0">${
    list.map((t) => `<hp:run charPrIDRef="${charPr}"><hp:t>${xmlEscape(t)}</hp:t></hp:run>`).join('')
  }</hp:p>`;
};

const hwpxTable = (headers, rows, colWidths) => {
  const rowCnt = rows.length + 1;
  const colCnt = headers.length;
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const makeRow = (cells, rowAddr, isHeader) => `<hp:tr>${cells.map((c, colAddr) => {
    const w = colWidths[colAddr];
    return `<hp:tc name="" header="${isHeader ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="1">`
      + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
      + hwpxPara(c, { charPr: isHeader ? 1 : 0 })
      + `</hp:subList>`
      + `<hp:cellAddr colAddr="${colAddr}" rowAddr="${rowAddr}"/>`
      + `<hp:cellSpan colSpan="1" rowSpan="1"/>`
      + `<hp:cellSz width="${w}" height="2400"/>`
      + `<hp:cellMargin left="510" right="510" top="141" bottom="141"/>`
      + `</hp:tc>`;
  }).join('')}</hp:tr>`;

  return `<hp:p id="${hwpxId++}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">`
    + `<hp:tbl id="${hwpxId++}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="1" noAdjust="0">`
    + `<hp:sz width="${totalW}" widthRelTo="ABSOLUTE" height="${rowCnt * 2400}" heightRelTo="ABSOLUTE" protect="0"/>`
    + `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
    + `<hp:outMargin left="283" right="283" top="283" bottom="283"/>`
    + `<hp:inMargin left="510" right="510" top="141" bottom="141"/>`
    + makeRow(headers, 0, true)
    + rows.map((r, idx) => makeRow(r, idx + 1, false)).join('')
    + `</hp:tbl></hp:run></hp:p>`;
};

const hwpxBody = [
  // 1쪽: 협조 요청 개요 및 기본 정보 표
  hwpxPara(['개인정보 비식별 처리 업무협조 및 점검 결과 보고서'], { charPr: 1 }),
  hwpxPara([DISCLAIMER]),
  hwpxPara(['']),
  hwpxPara(['1. 보고 개요'], { charPr: 1 }),
  hwpxPara(['본 문서는 2026년 상반기 민원·인사·협력사 관리 과정에서 생성된 문서의 개인정보 포함 현황과 비식별 처리 기준을 점검한 결과입니다.']),
  hwpxPara(['최초 점검은 ', '김서연 주무관이 수행하였으며, 후속 검토는 ', '최다은 주임과 한', '결이 공동으로 진행하였습니다.']),
  hwpxPara(['']),
  hwpxTable(
    ['구분', '점검 항목', '책임자', '연락처', '점검 일자'],
    [
      ['1차 점검', '민원 처리 대장', '김서연', '010-2100-1001', '2026-04-02'],
      ['2차 점검', '외부 인력 명부', ['이도', '현'], '010-3100-2002', '2026-04-06'],
      ['3차 점검', '상담 메모 기록', '배수지', '010-2233-4455', '2026-04-10'],
      ['최종 검증', '통역 및 해외 민원', ['응우옌 ', '티 흐엉'], '+82-10-9876-5432', '2026-04-14'],
    ],
    [6500, 10000, 7500, 10500, 7500],
  ),
  hwpxPara(['']),
  hwpxPara(['특히 환불 계좌(국민은행 123456-78-901234, 예금주 최다은)와 회신 주소(테헤란로 152 3층)처럼 문장 속에 자연스럽게 녹아든 항목은 누락 없이 식별해야 합니다.']),

  // 2쪽: 점검 대상자 및 개인정보 상세 표
  hwpxPara(['2. 점검 대상자별 개인정보 검출 현황'], { pageBreak: true, charPr: 1 }),
  hwpxPara(['부서별 표본 문서에서 확인된 성명, 주민등록번호, 휴대전화, 이메일, 계좌번호 내역은 아래 표와 같습니다.']),
  hwpxPara(['']),
  hwpxTable(
    ['성명', '주민등록번호', '휴대전화', '이메일', '주소'],
    [
      ['최다은', '900101-1234567', '010-2345-6789', 'daeun.choi@example.com', '서울특별시 강남구 테헤란로 152'],
      ['한결', '920315-1122334', '010-3456-7890', 'hangyeol@safedoc.kr', '경기도 성남시 분당구 판교역로 235'],
      ['박솔', '940821-2098765', '010 9999 0000', 'parksol@test.co.kr', '부산광역시 해운대구 센텀중앙로 79'],
      ['응우옌 반 남', '890512-5123456', '+82-10-2345-6789', 'nguyen.nam[at]example[dot]com', '인천광역시 연수구 송도과학로 32'],
      ['왕리메이', '920514-6345678', '010-5566-7788', 'wang.limei@partner.kr', '경기도 수원시 영통구 광교중앙로 145'],
      ['제임스 카터', '850909-5987654', '+82-10-5678-9012', 'j.carter(at)sample.org', '서울특별시 용산구 이태원로 177'],
      ['무함마드 라시드', '881103-5443322', '010-1111-2222', 'm.rashid@global.org', '대전광역시 서구 둔산로 100'],
      ['윤서아', '931201-2445566', '010-6677-8899', 'yoon.seoa@mail.co.kr', '세종특별자치시 한누리대로 2130'],
    ],
    [7000, 8500, 8500, 9500, 8500],
  ),

  // 3쪽: 변형 표기 및 금융·식별 정보 표
  hwpxPara(['3. 변형 표기 및 계좌·카드·여권 정보 점검'], { pageBreak: true, charPr: 1 }),
  hwpxPara(['정규표현식 탐지를 회피하기 쉬운 변형 표기 사례와 금융 정보를 표로 정리하여 재검토하였습니다.']),
  hwpxPara(['']),
  hwpxTable(
    ['유형', '원문 표기', '소유자', '확인 결과', '처리 권고'],
    [
      ['주민등록번호', '900101 - 1234567', '최다은', '구분자 앞뒤 공백 포함', '전체 마스킹'],
      ['주민등록번호', '구공공일공일 다시 일이삼사오육칠', '이든', '한글 구술 표기', '유형별 치환'],
      ['휴대전화', '010_5555_6666', '서지원', '밑줄(_) 구분자 사용', '부분 마스킹'],
      ['휴대전화', '공일공 구팔칠육 오사삼이', '배수지', '한글 숫자 표기', '부분 마스킹'],
      ['계좌번호', '110 123 456789 (신한)', '배수지', '공백 구분 계좌번호', '전체 마스킹'],
      ['계좌번호', '1002-345-678901 (우리)', '최다은', '하이픈 구분 계좌번호', '전체 마스킹'],
      ['이메일', 'hong[at]example[dot]com', '홍길동', '기호 치환 표기', '부분 마스킹'],
      ['여권번호', 'M12345678', '김도윤', '영문+숫자 8자리', '전체 마스킹'],
    ],
    [7000, 12000, 6000, 9500, 7500],
  ),
  hwpxPara(['']),
  hwpxPara(['참고: 작성자 미상 문서나 보호자 동의, 대리인 자격, 국민은행, 신한은행, 대표전화 02-2100-3847 등은 개인정보 오탐 방지를 위해 예외 처리합니다.']),

  // 4쪽: 부서별 이행 계획 및 결재선 표
  hwpxPara(['4. 부서별 후속 조치 및 이행 일정'], { pageBreak: true, charPr: 1 }),
  hwpxPara(['각 부서는 아래 조치 계획에 따라 보유 중인 한글(HWPX)·워드(DOCX)·엑셀(XLSX)·PDF 문서를 일괄 비식별화하고 대응표를 별도 금고에 보관합니다.']),
  hwpxPara(['']),
  hwpxTable(
    ['순번', '대상 부서', '담당자', '조치 내용', '목표일'],
    [
      ['1', '민원지원과', '김서연 주무관', '민원 처리 대장 비식별화 및 대응표 분리 보관', '2026-04-30'],
      ['2', '총무과', '이도현 과장', '외부 인력 명부 및 급여 계좌 표 점검', '2026-05-05'],
      ['3', '재무팀', '송민재 대리', '환불 계좌 및 세무 증빙 PDF 가림 처리', '2026-05-10'],
      ['4', '정보화추진팀', '한결 대리', '테스트 문서 자동 생성 및 회귀 검증 체계 구축', '2026-05-15'],
      ['5', '감사담당관실', '이든 팀장', '비식별 처리 결과 보고서 최종 감사', '2026-05-22'],
    ],
    [4000, 7500, 8000, 15500, 7000],
  ),
  hwpxPara(['']),
  hwpxPara(['작성 및 검토: 총무팀 이도현 과장 (내선 1234, dpo@safedoc.kr) / 협력: 무함마드 라시드']),
];

const hwpxSection = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec ${HWPX_NS}>
<hp:p id="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
  <hp:run charPrIDRef="0">
    <hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">
      <hp:grid lineGrid="0" charGrid="0" wongogojiFormat="0"/>
      <hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>
      <hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>
      <hp:pagePr landscape="WIDELY" width="59528" height="84188" gutterType="LEFT_ONLY">
        <hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/>
      </hp:pagePr>
      <hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:footNotePr>
      <hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:endNotePr>
      <hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>
    </hp:secPr>
  </hp:run>
</hp:p>
${hwpxBody.join('\n')}
</hs:sec>`;

// 한글은 글자 모양의 장평(ratio)·상대 크기(relSz)가 없으면 0%로 해석해 글자를 한 점에 겹쳐 그린다.
// 언어별 글꼴과 함께 모든 글자 모양 속성을 명시해야 정상적으로 표시된다.
const HWPX_LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];
const hwpxLangAttrs = (value) => HWPX_LANGS.map((lang) => `${lang.toLowerCase()}="${value}"`).join(' ');
const hwpxFontfaces = HWPX_LANGS
  .map((lang) => `<hh:fontface lang="${lang}" fontCnt="1"><hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"/></hh:fontface>`)
  .join('');
const hwpxCharPr = (id, height, { bold = false } = {}) => `<hh:charPr id="${id}" height="${height}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">`
  + `<hh:fontRef ${hwpxLangAttrs(0)}/><hh:ratio ${hwpxLangAttrs(100)}/><hh:spacing ${hwpxLangAttrs(0)}/>`
  + `<hh:relSz ${hwpxLangAttrs(100)}/><hh:offset ${hwpxLangAttrs(0)}/>${bold ? '<hh:bold/>' : ''}`
  + '<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/>'
  + '<hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>';

const hwpxHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head ${HWPX_NS} version="1.4" secCnt="1">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>
    <hh:fontfaces itemCnt="${HWPX_LANGS.length}">${hwpxFontfaces}</hh:fontfaces>
    <hh:borderFills itemCnt="2"><hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="SOLID" width="0.12 mm" color="#999999"/><hh:rightBorder type="SOLID" width="0.12 mm" color="#999999"/><hh:topBorder type="SOLID" width="0.12 mm" color="#999999"/><hh:bottomBorder type="SOLID" width="0.12 mm" color="#999999"/></hh:borderFill><hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/><hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/><hh:topBorder type="NONE" width="0.1 mm" color="#000000"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/></hh:borderFill></hh:borderFills>
    <hh:charProperties itemCnt="2">
      ${hwpxCharPr(0, 1000)}
      ${hwpxCharPr(1, 1100, { bold: true })}
    </hh:charProperties>
    <hh:paraProperties itemCnt="1"><hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="JUSTIFY" vertical="BASELINE"/><hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/></hh:paraPr></hh:paraProperties>
    <hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>
  </hh:refList>
</hh:head>`;

const hwpxContentHpf = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id="">
  <opf:metadata><opf:title>개인정보 비식별 처리 업무협조 및 점검 결과 보고서</opf:title><opf:language>ko</opf:language></opf:metadata>
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine>
</opf:package>`;

writeFileSync(join(OUT, '05_업무협조_및_점검보고서.hwpx'), Buffer.from(zipSync({
  mimetype: strToU8('application/hwp+zip'),
  'version.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" targetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="0" os="1"/>'),
  'META-INF/container.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>'),
  'META-INF/manifest.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>'),
  'Contents/content.hpf': strToU8(hwpxContentHpf),
  'Contents/header.xml': strToU8(hwpxHeader),
  'Contents/section0.xml': strToU8(hwpxSection),
})));

// ─────────────────────────────────────────────────────────────────
// 6. PDF — 텍스트 레이어 포함 4쪽 보고서 (테이블 + 본문)
// ─────────────────────────────────────────────────────────────────
async function buildTestPdf() {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontCandidates = [
    'C:\\Windows\\Fonts\\malgun.ttf',
    'C:\\Windows\\Fonts\\NGULIM.TTF',
  ];
  const fontPath = fontCandidates.find((p) => existsSync(p));
  if (!fontPath) {
    throw new Error('한글 PDF 시험 문서 생성을 위한 시스템 글꼴(malgun.ttf 등)을 찾을 수 없습니다.');
  }
  const fontBytes = readFileSync(fontPath);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const W = 595.28;
  const H = 841.89;
  const M = 48;

  const drawTable = (page, startY, colWidths, headers, rows) => {
    const rowH = 24;
    let y = startY;
    const totalW = colWidths.reduce((a, b) => a + b, 0);

    const drawRow = (cells, isHeader) => {
      if (isHeader) {
        page.drawRectangle({ x: M, y: y - rowH, width: totalW, height: rowH, color: rgb(0.93, 0.95, 0.99) });
      }
      let x = M;
      for (let i = 0; i < cells.length; i++) {
        page.drawRectangle({
          x,
          y: y - rowH,
          width: colWidths[i],
          height: rowH,
          borderColor: rgb(0.75, 0.78, 0.84),
          borderWidth: 0.6,
        });
        page.drawText(cells[i], {
          x: x + 6,
          y: y - 16,
          size: isHeader ? 9.5 : 9,
          font,
          color: rgb(0.1, 0.12, 0.16),
        });
        x += colWidths[i];
      }
      y -= rowH;
    };

    drawRow(headers, true);
    for (const r of rows) drawRow(r, false);
    return y;
  };

  const addPageWithHeader = (pageNum, title) => {
    const page = pdfDoc.addPage([W, H]);
    page.drawText(title, { x: M, y: H - 52, size: 15, font, color: rgb(0.08, 0.12, 0.22) });
    page.drawText(DISCLAIMER, { x: M, y: H - 72, size: 9, font, color: rgb(0.4, 0.44, 0.5) });
    page.drawLine({ start: { x: M, y: H - 82 }, end: { x: W - M, y: H - 82 }, thickness: 0.8, color: rgb(0.82, 0.85, 0.9) });
    page.drawText(`safeDoc 시험 문서 - ${pageNum} / 4 쪽`, { x: W - M - 110, y: 28, size: 8.5, font, color: rgb(0.45, 0.48, 0.54) });
    return page;
  };

  // 1쪽
  const p1 = addPageWithHeader(1, '2026년 개인정보 처리현황 종합 보고서');
  let y = H - 108;
  const p1Lines = [
    '1. 점검 목적 및 범위',
    '본 보고서는 민원 처리, 외부 인력 관리, 상담 기록에서 수집되는 개인정보의 비식별 수준을 점검하기 위해 작성되었습니다.',
    '최초 접수는 김서연 주무관이 담당하였고, 서류 검토는 최다은 주임과 한결 대리가 수행하였습니다.',
    '환불 계좌는 국민은행 123456-78-901234 이며 예금주는 최다은입니다.',
    '회신 주소는 서울특별시 강남구 테헤란로 152 3층 사무실로 지정되었습니다.',
  ];
  for (const line of p1Lines) {
    p1.drawText(line, { x: M, y, size: 10, font, color: rgb(0.15, 0.17, 0.2) });
    y -= 20;
  }
  y -= 10;
  p1.drawText('[표 1] 주요 점검 담당자 및 연락처', { x: M, y, size: 10.5, font, color: rgb(0.1, 0.12, 0.16) });
  y -= 10;
  drawTable(p1, y, [90, 90, 120, 199], ['부서', '성명', '휴대전화', '이메일'], [
    ['민원지원과', '김서연', '010-2100-1001', 'seoyeon.kim@safedoc.kr'],
    ['총무과', '이도현', '010-3100-2002', 'dohyun.lee@safedoc.kr'],
    ['정보화추진팀', '한결', '010-3456-7890', 'hangyeol@safedoc.kr'],
    ['외부통역', '응우옌 티 흐엉', '+82-10-9876-5432', 'huong.nguyen@example.com'],
    ['보안자문', '제임스 카터', '+82-10-5678-9012', 'j.carter@sample.org'],
    ['협력사D', '무함마드 라시드', '010-1111-2222', 'm.rashid@global.org'],
  ]);

  // 2쪽
  const p2 = addPageWithHeader(2, '2. 민원인 및 외부 인력 표본 명세');
  y = H - 108;
  p2.drawText('아래 표는 2026년 1분기 표본 추출 대상자의 인적 및 연락 정보입니다.', { x: M, y, size: 10, font, color: rgb(0.15, 0.17, 0.2) });
  y -= 18;
  drawTable(p2, y, [85, 110, 110, 194], ['성명', '주민등록번호', '휴대전화', '거주지 주소'], [
    ['최다은', '900101-1234567', '010-2345-6789', '서울특별시 강남구 테헤란로 152'],
    ['박솔', '940821-2098765', '010-9999-0000', '부산광역시 해운대구 센텀중앙로 79'],
    ['배수지', '870707-2112233', '010-2233-4455', '광주광역시 서구 상무중앙로 110'],
    ['이든', '950101-1998877', '010-9911-2233', '대구광역시 수성구 달구벌대로 2450'],
    ['왕리메이', '920514-6345678', '010-5566-7788', '경기도 수원시 영통구 광교중앙로 145'],
    ['서지원', '880315-2012345', '010-4123-7891', '대전광역시 서구 둔산로 100'],
    ['장하늘', '910618-1334455', '010-4567-8901', '울산광역시 남구 삼산로 270'],
    ['윤서아', '931201-2445566', '010-6677-8899', '세종특별자치시 한누리대로 2130'],
    ['김도윤', '891010-1556677', '010-3311-2244', '강원특별자치도 춘천시 중앙로 1'],
    ['송민재', '900425-1778899', '010-4100-3003', '경기도 성남시 분당구 판교역로 235'],
  ]);

  // 3쪽
  const p3 = addPageWithHeader(3, '3. 비정형·변형 표기 및 오탐 대조군');
  y = H - 108;
  const p3Lines = [
    '상담 메모 및 첨부 서류에서는 다음과 같은 변형 표기가 다수 관측되었습니다.',
    '- 공백 포함 주민등록번호: 900101 - 1234567 / 851122 - 1098765',
    '- 밑줄 구분 휴대전화: 010_5555_6666 / 010_7788_9900',
    '- 공백 구분 계좌번호: 110 123 456789 (신한은행), 1002 345 678901 (우리은행)',
    '- 우회 표기 이메일: hong[at]example[dot]com, minji dot kim (at) test.co.kr',
    '- 여권번호 기재 사례: 김도윤 여권 M12345678, 사업자등록번호 123-45-67890',
    '',
    '반면 다음 표현들은 일반 행정 문구이므로 비식별 대상에서 제외해야 합니다.',
    '- 강원도 및 경상북도 출장 규정, 국민은행·신한은행·우리은행 급여 이체 안내',
    '- 작성자 미상, 보호자 동의, 대리인 자격, 담당자 부재중, 예금주 본인, 신청인 다수',
    '- 대표전화 02-2100-3847 (부서 공용 번호)',
  ];
  for (const line of p3Lines) {
    p3.drawText(line, { x: M, y, size: 10, font, color: rgb(0.15, 0.17, 0.2) });
    y -= 22;
  }

  // 4쪽
  const p4 = addPageWithHeader(4, '4. 후속 조치 계획 및 이행 일정');
  y = H - 108;
  p4.drawText('부서별 비식별 처리 이행 계획 및 최종 책임자는 아래와 같습니다.', { x: M, y, size: 10, font, color: rgb(0.15, 0.17, 0.2) });
  y -= 18;
  y = drawTable(p4, y, [55, 95, 90, 179, 80], ['순번', '부서명', '책임자', '이행 과제', '완료 기한'], [
    ['1', '민원지원과', '김서연', '민원 대장 일괄 비식별 처리', '2026-04-30'],
    ['2', '총무과', '이도현', '외부 인력 명부 암호화 및 파기', '2026-05-05'],
    ['3', '재무팀', '송민재', '환불 계좌 및 세무 증빙 가림 처리', '2026-05-10'],
    ['4', '정보화추진팀', '한결', '문서 파서 회귀 테스트 점검', '2026-05-15'],
    ['5', '감사담당관실', '이든', '최종 비식별 보고서 감사', '2026-05-22'],
  ]);
  y -= 28;
  p4.drawText('최종 작성자: 총무팀 이도현 과장 | 연락처: 010-3100-2002 | 이메일: dpo@safedoc.kr', { x: M, y, size: 10, font, color: rgb(0.15, 0.17, 0.2) });

  writeFileSync(join(OUT, '06_개인정보_처리현황_보고서.pdf'), Buffer.from(await pdfDoc.save()));
}

await buildTestPdf();

const files = [
  '01_민원상담_및_공지모음.txt',
  '02_외부인력_및_협력사명부.csv',
  '03_개인정보_실태점검_회의록.docx',
  '04_근태_및_인사기록.xlsx',
  '05_업무협조_및_점검보고서.hwpx',
  '06_개인정보_처리현황_보고서.pdf',
];
console.log(`생성 위치: ${OUT}`);
for (const f of files) console.log(`  ${f}`);
