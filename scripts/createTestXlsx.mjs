import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const output = fileURLToPath(new URL('../test/개인정보_탐지_테스트.xlsx', import.meta.url));
const workbook = Workbook.create();
const people = workbook.worksheets.add('민원인목록');
const notes = workbook.worksheets.add('상담기록');

people.showGridLines = false;
people.getRange('A1:L1').merge();
people.getRange('A1').values = [['개인정보 탐지 테스트 - 민원인 목록']];
people.getRange('A1:L1').format = {
  fill: '#1F4D78',
  font: { bold: true, color: '#FFFFFF', size: 16 },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
};
people.getRange('A1:L1').format.rowHeight = 30;

people.getRange('A3:L6').values = [
  ['성명', '주민등록번호', '휴대전화', '이메일', '주소', '계좌번호', '카드번호', '여권번호', '사업자번호', '차량번호', 'IP 주소', '생년월일'],
  ['홍길동', '900101-1234568', '010-1234-5678', 'hong.gildong@example.com', '서울특별시 강남구 테헤란로 152 101동 1203호', '110-123-456789', '4111-1111-1111-1111', 'M12345678', '220-81-62517', '12가3456', '192.168.10.25', '1990-01-01'],
  ['김민지', '950505-2234567', '010-9876-5432', 'minji.kim@test.co.kr', '부산광역시 해운대구 센텀중앙로 55 802호', '3333-02-1234567', '5555-5555-5555-4444', 'S98765432', '120-88-01234', '34나7890', '10.20.30.40', '1995-05-05'],
  ['이철수', '850315-1234567', '02-345-6789', 'cs.lee@example.org', '대전광역시 유성구 대학로 99', '1002-345-678901', '4012-8888-8888-1881', 'R11223344', '314-86-54321', '56다1234', '172.16.0.15', '1985-03-15'],
];
people.getRange('A3:L3').format = {
  fill: '#DCE6F1',
  font: { bold: true, color: '#17365D' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  wrapText: true,
  borders: { preset: 'all', style: 'thin', color: '#A6B7C8' },
};
people.getRange('A4:L6').format = {
  verticalAlignment: 'center',
  borders: { preset: 'all', style: 'thin', color: '#D9E1E8' },
};
people.getRange('A3:L6').format.autofitColumns();
people.getRange('A3:L6').format.autofitRows();
people.getRange('E:E').format.columnWidth = 42;
people.getRange('D:D').format.columnWidth = 28;
people.getRange('A:L').format.wrapText = true;
people.freezePanes.freezeRows(3);
people.tables.add('A3:L6', true, 'PeopleTestTable').style = 'TableStyleMedium2';

notes.showGridLines = false;
notes.getRange('A1:D1').merge();
notes.getRange('A1').values = [['개인정보 탐지 테스트 - 상담 기록']];
notes.getRange('A1:D1').format = {
  fill: '#2F75B5',
  font: { bold: true, color: '#FFFFFF', size: 15 },
  horizontalAlignment: 'center',
};
notes.getRange('A3:D6').values = [
  ['접수번호', '담당자', '상담 내용', '처리 상태'],
  ['REQ-2026-001', '박영희', '민원인 홍길동에게 010-1234-5678로 연락하고 hong.gildong@example.com으로 결과를 발송한다.', '검토 중'],
  ['REQ-2026-002', '최준호', '김민지의 주소는 부산광역시 해운대구 센텀중앙로 55이며 계좌번호는 3333-02-1234567이다.', '접수'],
  ['REQ-2026-003', '정수진', '카드번호 4111-1111-1111-1111 및 IP 192.168.10.25 노출 여부를 확인한다.', '완료'],
];
notes.getRange('A3:D3').format = { fill: '#D9EAF7', font: { bold: true }, borders: { preset: 'all', style: 'thin', color: '#A6B7C8' } };
notes.getRange('A4:D6').format = { wrapText: true, verticalAlignment: 'top', borders: { preset: 'all', style: 'thin', color: '#D9E1E8' } };
notes.getRange('A:A').format.columnWidth = 18;
notes.getRange('B:B').format.columnWidth = 14;
notes.getRange('C:C').format.columnWidth = 70;
notes.getRange('D:D').format.columnWidth = 14;
notes.getRange('A3:D6').format.autofitRows();
notes.freezePanes.freezeRows(3);
notes.tables.add('A3:D6', true, 'ConsultationTestTable').style = 'TableStyleMedium2';

await fs.mkdir(new URL('../test/', import.meta.url), { recursive: true });
const blob = await SpreadsheetFile.exportXlsx(workbook);
await blob.save(output);

const preview = await workbook.render({ sheetName: '민원인목록', range: 'A1:L6', scale: 1.5, format: 'png' });
await fs.mkdir(new URL('../tmp/test-docs/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../tmp/test-docs/xlsx-preview.png', import.meta.url), new Uint8Array(await preview.arrayBuffer()));

const inspect = await workbook.inspect({ kind: 'table', range: '민원인목록!A1:L6', include: 'values,formulas', tableMaxRows: 8, tableMaxCols: 12, maxChars: 4000 });
console.log(inspect.ndjson);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 50 }, summary: 'formula error scan' });
console.log(errors.ndjson);
