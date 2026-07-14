# safeDoc — 개인정보 비식별화 프로그램

문서 속 개인정보를 브라우저 안에서 탐지·비식별 처리하는 개인 PC용 프로그램입니다. 모든 처리는 클라이언트에서 이루어지며, 외부 서버로 어떤 데이터도 전송하지 않습니다.

## 주요 특징

- **완전 오프라인 처리** — 콘텐츠 보안정책(CSP)으로 외부 통신을 차단(`connect-src 'none'`)하며, 파일이 사용자 기기를 벗어나지 않습니다.
- **단일 HTML 배포** — 빌드 결과물이 하나의 HTML 파일로 묶여, 별도 설치 없이 브라우저에서 바로 실행할 수 있습니다.
- **다양한 문서 형식 지원** — TXT, CSV, XLSX, DOCX, HWPX, 텍스트 기반 PDF
- **탐지 → 검토 → 비식별 → 결과**의 단계별 작업 흐름과 원본 복원 기능

## 지원 문서 형식

| 형식 | 확장자 | 비고 |
| --- | --- | --- |
| 텍스트 | `.txt` | 인코딩 자동 감지 |
| CSV | `.csv` | 헤더 기반 필드 탐지 |
| 엑셀 | `.xlsx` | |
| 워드 | `.docx` | |
| 한글 | `.hwpx` | |
| PDF | `.pdf` | 텍스트 PDF만 지원(스캔 이미지 PDF 제외) |

## 탐지하는 개인정보 유형

주민등록번호, 전화번호, 이메일, 카드번호, 계좌번호, 성명, 주소 등 (`src/detect/rules/`)

## 기술 스택

- [Vite](https://vitejs.dev/) — 빌드 및 단일 HTML 번들링(`vite-plugin-singlefile`)
- [pdf-lib](https://pdf-lib.js.org/) / [pdfjs-dist](https://mozilla.github.io/pdf.js/) — PDF 파싱 및 처리
- [fflate](https://github.com/101arrowz/fflate) — XLSX/DOCX/HWPX(ZIP 기반) 압축 해제
- [Vitest](https://vitest.dev/) — 단위 시험

## 시작하기

### 요구 사항

- Node.js 18 이상

### 설치

```bash
npm install
```

### 개발 서버

```bash
npm run dev
```

### 빌드

```bash
npm run build
```

빌드 결과물은 `dist/`에 단일 HTML 파일로 생성됩니다. 해당 파일을 브라우저에서 직접 열어 오프라인으로 사용할 수 있습니다.

### 시험

```bash
npm test
```

> Windows PowerShell에서 실행 정책 문제로 `npm`이 막힐 경우 `npm.cmd`를 사용하십시오.

## 프로젝트 구조

```
src/
├── main.js            # 진입점 및 작업 흐름 제어
├── core/              # 파일 관리, 분석, 비식별, 복원, 대응표, 세션
├── detect/            # 탐지 엔진 및 유형별 규칙(rules/)
├── parsers/           # 형식별 파서(txt, csv, pdf, xmlDoc, zip 등)
├── ui/                # DOM 렌더링
└── assets/            # 토큰 글꼴 등 자원
```

## 개발 상태

현재 개발 진행 상황, 미완성 항목, 알려진 기술 위험은 [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md)를 참고하십시오.

## 보안 안내

- 이 프로그램은 개인정보를 다루므로, 신뢰할 수 있는 환경에서만 사용하십시오.
- 비식별 처리 결과와 대응표(복원용)를 함께 보관하면 원본을 복원할 수 있으므로, 대응표는 별도로 안전하게 관리하십시오.
