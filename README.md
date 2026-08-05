# safeDoc — 로컬 AI기반 개인정보 비식별화 프로그램

문서 속 개인정보를 브라우저 안에서 탐지·비식별 처리하는 개인 PC용 프로그램입니다. 모든 처리는 클라이언트에서 이루어지며, 외부 서버로 어떤 데이터도 전송하지 않습니다.

버전 1.0.0 · 단위시험 180개 통과 · 단일 HTML 빌드 약 4.3MB(gzip 약 1.99MB)

## 주요 특징

- **폐쇄망 동작** — 콘텐츠 보안정책(CSP)이 외부 통신을 차단합니다. 허용되는 통신은 **이 PC 안의 AI 엔진(`localhost:11434`)** 하나뿐이며, 파일이 사용자 기기를 벗어나지 않습니다.
- **규칙 + 로컬 AI 이중 탐지** — 정규식·검증 알고리즘이 정형정보를 잡고, 로컬 LLM([Ollama](https://ollama.com/) + `gemma4:e2b`)이 문맥을 판단해 규칙이 놓치는 성명·주소를 추가로 찾습니다. AI 없이 규칙만으로도 동작합니다.
- **단일 HTML 배포** — 빌드 결과물이 하나의 HTML 파일로 묶입니다. 동봉된 `start.bat`이 이를 `http://localhost`로 열어 줍니다.
- **다양한 문서 형식 지원** — TXT, CSV, XLSX, DOCX, HWPX, 텍스트 기반 PDF
- **탐지 → 검토 → 비식별 → 결과**의 단계별 작업 흐름과 원본 복원 기능

## 지원 문서 형식

| 형식 | 확장자 | 비고 |
| --- | --- | --- |
| 텍스트 | `.txt` | 인코딩 자동 감지 |
| CSV | `.csv` | 헤더 기반 필드 탐지 |
| 엑셀 | `.xlsx` | 숫자 셀(`<v>`) 원시 값 포함 |
| 워드 | `.docx` | |
| 한글 | `.hwpx` | `mimetype` 무압축 저장(규격 준수) |
| PDF | `.pdf` | 텍스트 PDF만 지원(스캔 이미지 PDF 제외) |

입력 한도는 20MB이며, 구형 HWP/DOC/XLS, 암호·DRM 문서, 압축파일은 지원하지 않습니다.

## 탐지하는 개인정보 유형

성명, 주민등록번호, 외국인등록번호, 휴대전화, 일반전화, 이메일, 주소, 계좌번호, 카드번호, 여권번호, 사업자등록번호, 차량번호, IP 주소, 생년월일, 사용자 지정(`src/detect/types.js`, 규칙은 `src/detect/rules/`).

유형별 기본 처리방식은 전부 가림(`MASK_ALL`), 부분 가림(`MASK_PART`), 토큰 치환(`REPLACE`) 중 하나이며 설정 화면에서 변경할 수 있습니다.

## 작업 흐름

1. **문서 준비** — 끌어놓기 또는 파일 선택. 원본 유지·로컬 처리 원칙을 먼저 확인합니다.
2. **자동 분석** — 문서 열기, 텍스트 추출, 규칙 탐지 단계를 구분해 표시하고 AI 문맥 탐지는 검토 화면에서 이어집니다.
3. **개인정보 검토** — 모든 자동 후보는 `미확인`으로 시작합니다. 문서 문맥과 후보를 함께 보며 `처리` 또는 `제외`를 결정하고, 미확인 항목이 남으면 다음 단계로 이동할 수 없습니다.
4. **처리 확인** — 처리·제외·처리방식별 수량을 확인하고 복원용 대응표 생성 여부를 선택합니다. 대응표는 기본적으로 생성하지 않습니다.
5. **완료** — 결과 문서 다운로드를 주요 행동으로 제공하고, 변경 항목·전체 문서·처리 전 내용을 나누어 확인합니다.

좌측 메뉴에서 비식별 처리, 단계형 원본 복원, 설정으로 이동합니다. 설정은 처리 정책·AI 엔진·사용자 규칙으로 분리되어 있습니다.

## 탐지 정확도

`npm run eval:ai` — 합성 평가 세트 32건 기준. 세트에는 과거 결함 사례(조사와 같은 음절로 끝나는 이름, 무효 체크섬, 계좌번호 오탐 함정 등)가 일부러 포함되어 있습니다.

| | 재현율 | 정밀도 | F1 |
| --- | --- | --- | --- |
| 규칙 단독 | 90.2% | 89.6% | 89.9% |
| 규칙 + AI | 100.0% | 87.7% | 93.5% |

> 평가 세트가 합성 데이터 32건이므로 이 수치는 운영 환경 성능을 보장하지 않습니다. 재현율 100%는 이 세트에 한한 수치입니다. 자세한 한계는 [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md)를 참고하십시오.

## 기술 스택

- [Ollama](https://ollama.com/) + `gemma4:e2b` — 로컬 LLM 문맥 탐지 (선택)
- [Vite](https://vitejs.dev/) — 빌드 및 단일 HTML 번들링(`vite-plugin-singlefile`)
- [pdf-lib](https://pdf-lib.js.org/) / [pdfjs-dist](https://mozilla.github.io/pdf.js/) — PDF 파싱 및 처리
- [fflate](https://github.com/101arrowz/fflate) — XLSX/DOCX/HWPX(ZIP 기반) 압축 해제
- [Vitest](https://vitest.dev/) — 단위 시험

프레임워크 없이 순수 JavaScript로 작성되었습니다.

## 시작하기

### 요구 사항

- Node.js 18 이상 (CI는 20 사용)

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

빌드 결과물은 `dist/`에 단일 HTML 파일로 생성됩니다.

### 실행

```bash
deploy/start.bat
```

`http://localhost:8080`으로 서버를 띄우고 브라우저를 엽니다. 포트가 사용 중이면 8089까지 자동으로 탐색합니다.

> **`dist/index.html`을 파일로 직접 열지(`file://`) 마십시오.** Ollama가 `file://` 출처(`Origin: null`)의 요청을 403으로 거부하므로 AI 탐지가 동작하지 않습니다. 규칙 기반 탐지만 쓸 경우에는 직접 열어도 무방합니다.

### AI 탐지 준비

```bash
ollama pull gemma4:e2b
```

Ollama가 실행 중이면 `start.bat`이 자동으로 감지합니다. 모델이 없거나 Ollama가 꺼져 있으면 규칙 기반으로만 동작합니다.

### 다른 PC에 배포

```bash
npm run package
```

빌드 결과와 실행기를 묶어 `release/safeDoc-v<버전>.zip`을 만듭니다. 이 ZIP을 대상 PC에 풀고 `start.bat`을 실행하면 됩니다. **Node.js·npm·인터넷 연결이 필요 없습니다** — 서버는 Windows 기본 구성요소(PowerShell 5.1 + .NET `HttpListener`)만 쓰고 관리자 권한도 요구하지 않습니다.

기존 `dist/`를 그대로 쓰려면 `npm run package -- -SkipBuild`.

저장소를 직접 복사한 경우에는 `dist/`가 `.gitignore` 대상이라 비어 있습니다. 이때 `start.bat`은 Node.js가 설치돼 있으면 그 자리에서 빌드할지 물어봅니다.

폐쇄망 배포 절차는 [deploy/README.txt](deploy/README.txt)를 참고하십시오.

## npm 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | Vite 개발 서버 |
| `npm run build` | 단일 HTML 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm test` | 단위시험(Vitest) 180개 |
| `npm run eval` | 규칙 단독 탐지 정확도 측정 (AI 불필요) |
| `npm run eval:ai` | 규칙 vs 규칙+AI 비교 (Ollama 필요) |
| `npm run testdocs` | 평가용 합성 시험 문서 생성 |
| `npm run serve` | `deploy/serve.ps1`로 빌드 결과 제공 |
| `npm run package` | 배포용 ZIP 생성(`release/`) |

> Windows PowerShell에서 실행 정책 문제로 `npm`이 막힐 경우 `npm.cmd`를 사용하십시오.

Node가 없는 환경에서는 `scripts/devserve.ps1` + `test/browser/harness.html`로 핵심 로직을 브라우저에서 검증할 수 있습니다.

## 프로젝트 구조

```
src/
├── main.js            # 진입점 및 작업 흐름 제어
├── version.js         # 프로그램 이름·버전
├── style.css          # 전체 스타일(다크 모드 포함)
├── core/              # 파일 관리, 분석, 비식별, 복원, 대응표, 요약, 세션
├── detect/            # 규칙 기반 탐지 엔진, 유형 정의, 검증기, 유형별 규칙(rules/)
├── ai/                # 로컬 LLM 탐지 계층(클라이언트, 프롬프트, 청킹, 검증, 병합, 수명주기)
├── parsers/           # 형식별 파서(txt, csv, pdf, xmlDoc, zipUtils, encoding)
├── ui/                # DOM 렌더링, 후보 목록, 하이라이트
└── assets/            # 토큰 글꼴 등 자원

test/                  # 단위시험 19파일 180개, 평가 세트(fixtures/eval), 브라우저 하네스
scripts/               # 시험 문서 생성, 정확도 평가, 글꼴 생성, 개발 서버, 배포 패키징(package.ps1)
deploy/                # 폐쇄망 배포용 실행기(start.bat, serve.ps1, README.txt)
release/               # npm run package 산출물(ZIP) — 저장소에 포함하지 않음
doc/                   # 요구사항 정의서·기술명세서(PDF)
.github/workflows/     # GitHub Pages 배포(단위시험·의존성 감사 게이트 포함)
```

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 단위시험 → `npm audit --audit-level=high` → 빌드를 순서대로 수행하고, 통과한 경우에만 GitHub Pages로 배포합니다([.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)).

폐쇄망 환경에는 `dist/index.html`과 `deploy/` 폴더를 함께 반입하여 사용합니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) | 개발 진행 상황, 미완성 항목, 알려진 기술 위험, 재개 지점 |
| [ANALYSIS.md](ANALYSIS.md) | 전체 코드베이스 분석 보고서와 확인된 결함 목록 |
| [WORK_SPEC.md](WORK_SPEC.md) | 안전성 보강 작업 명세서와 진행 상태 |
| [deploy/README.txt](deploy/README.txt) | 최종 사용자용 폐쇄망 설치·실행 안내 |
| `doc/` | 요구사항 정의서, 기술명세서(PDF) |

## 알려진 제한

- **필드명 뒤 조사** — "예금주는 최다은이다"처럼 필드명과 값 사이에 조사가 끼면 규칙 탐지가 동작하지 않습니다(`ANALYSIS.md` 2.4). AI 탐지가 보완하지만 규칙 단독으로는 놓칩니다.
- **처리 성능** — 명세상 입력 한도는 20MB이지만 탐지 알고리즘이 문서 크기에 대해 제곱으로 증가하여 실질 상한은 그보다 훨씬 낮습니다(`ANALYSIS.md` 3.3).
- **명세 충돌** — 대응표 다운로드·원본 복원·AI 탐지는 요구사항 정의서에 없거나 충돌하는 기능으로, 유지 여부에 대한 결정이 남아 있습니다.
- 파싱·정규식 구간의 즉시 취소, XLSX 시트별 표시, 사용자 지정 치환문구 등 일부 요구사항이 미구현입니다.

전체 목록은 [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md)와 [ANALYSIS.md](ANALYSIS.md)에 있습니다.

## 보안 안내

- 이 프로그램은 개인정보를 다루므로, 신뢰할 수 있는 환경에서만 사용하십시오.
- 비식별 처리 결과와 대응표(복원용)를 함께 보관하면 원본을 복원할 수 있으므로, 대응표는 별도로 안전하게 관리하십시오.
- **네트워크 범위** — CSP `connect-src`가 `http://localhost:11434`, `http://127.0.0.1:11434` 두 개의 루프백 주소만 허용합니다. 문서 내용은 이 PC 안의 AI 엔진으로만 전달되며 외부로 나가지 않습니다.
- **AI 탐지의 한계** — 로컬 LLM은 규칙이 놓치는 항목을 추가로 찾을 뿐, 모든 개인정보를 보장하지 않습니다. AI는 후보를 **추가만** 할 수 있고 사용자가 선택한 처리 대상을 자동으로 해제하지 않습니다. 문서에 삽입된 지시문으로 탐지를 무력화할 수 없도록 규칙 기반 결과는 항상 보존됩니다.
- **로컬 로그** — 문서 내용이 로컬 AI 엔진 프로세스로 전달되므로, Ollama 로그 설정에 따라 디스크에 남을 수 있습니다. 폐쇄망 배포 시 확인하십시오.
- 검사가 완료되지 않은 경우(중단·청크 상한 초과) 결과 화면과 처리 요약에 `completed: false`로 기록됩니다. 이 표시가 있으면 개인정보가 남아 있을 수 있습니다.
- 최종 확인은 사람이 수행해야 합니다. 검토 화면의 결과를 반드시 확인하십시오.
