# 로컬 오픈소스 LLM 기반 행정 파일 검색·정리 프로그램: 기술 실현 가능성 검토 및 실행 계획

## TL;DR
- **만들 수 있고, 만들 가치가 있다 — 단, "LLM 챗봇"이 아니라 "하이브리드 검색 엔진"으로 설계할 때만.** 핵심 가치는 생성형 LLM이 아니라 (1) 한국어 임베딩 기반 의미 검색 + BM25 하이브리드, (2) HWP/HWPX 파싱, (3) 관리자 권한 없는 폐쇄망 배포에 있다. Everything이 이미 완벽한 파일명 검색을 무료로 제공하므로, 차별점은 "파일 내용"과 "한글 문서"와 "설치 장벽 제로"다.
- **safeDoc 자산의 재활용 가치가 매우 높다.** HWPX/DOCX/XLSX 파서, fflate ZIP 해제, pdfjs-dist, PowerShell HttpListener 폐쇄망 실행기, CSP localhost 루프백 격리, 단일 HTML 배포 방식은 그대로 이 프로젝트의 뼈대가 된다. 새로 개발할 핵심은 임베딩·인덱싱·검색 계층뿐이다.
- **가장 큰 리스크는 기술이 아니라 (a) 구형 바이너리 HWP 파싱과 (b) 공공기관 설치 장벽이다.** 공공 문서의 대다수가 HWP/HWPX인데 브라우저에서 구형 .hwp를 파싱할 수 있는 오픈소스는 hwp.js 하나뿐이고 알파 수준(저자 추정 커버리지 약 20%)이다. 반면 국가인공지능전략위원회가 2026년 2월 긴급회의로 공공문서 개방형 포맷 전환을 결의하는 등 정부가 HWPX 전환을 강제하고 있어 시간은 사용자 편이다.

## Key Findings

### 1. LLM이 실제로 필요한 부분과 아닌 부분 (과잉 AI 경계)
- **파일명 검색: LLM 불필요.** Everything(voidtools)의 NTFS USN 저널 기반 즉시 검색은 이미 사실상 완벽하다. 여기에 AI를 얹는 것은 낭비다.
- **의미 검색(semantic search): 임베딩 모델은 필요하나 생성형 LLM은 불필요.** "작년 국정감사 예산자료"류 자연어 질의는 문장 임베딩 + 코사인 유사도로 해결된다. 여기에 BM25(정확 용어·사업명·연도 매칭)를 결합한 하이브리드 검색이 실무 최적해다. 연구 문헌(Elastic, OpenSearch, BEIR 분석)은 일관되게 하이브리드가 단일 방식을 이긴다고 본다 — BM25는 정확 매칭(사업코드, 연도), 임베딩은 표현이 달라도 의도가 같은 질의에 강하며, RRF(Reciprocal Rank Fusion)로 결합하는 것이 표준이다.
- **자동 분류·태깅·파일명 정규화: 소형 LLM이 실제로 가치를 더하는 유일한 영역.** 규칙(정규식)으로 1차 처리하고 애매한 경우만 LLM 폴백하는 safeDoc의 이중 구조를 그대로 재사용할 수 있다.
- **RAG 질의응답(출처 명시): 가능하지만 우선순위 낮음.** 소형 로컬 모델의 환각 위험이 있어 "요약+출처 링크" 수준으로 보수적으로 접근해야 한다. 검색으로 문서를 찾아주는 것이 1차 목표이고, 답변 생성은 부가 기능이다.
- **중복·유사 문서 탐지: LLM 불필요.** 임베딩 코사인 유사도 또는 해시(MinHash/SimHash)로 충분하다.
- 결론: **이 도구의 80%는 "임베딩 + 전통 검색 알고리즘"이면 되고, 생성형 LLM은 20%(분류 제안, 선택적 요약)에만 쓴다.**

### 2. 한국어 임베딩 모델 (핵심 엔진)
고려대 NLP&AI연구실·HIAI연구소가 만든 MTEB-ko-retrieval 리더보드 기준 상위권(Average F1_top1):
- **KURE-v1 (nlpai-lab)**: **0.55784로 1위.** bge-m3 기반 한국어 파인튜닝.
- **dragonkue/BGE-m3-ko**: 0.55535로 2위.
- **BAAI/bge-m3**: 0.54998로 3위. MIT 라이선스, 100개 이상 언어, dense+sparse+multi-vector 동시 지원(하이브리드에 이상적), 8192 토큰 컨텍스트. **가장 안전한 기본값.**
- **snowflake-arctic-embed-l-v2.0**: 0.54489로 4위.
- **KoE5 (nlpai-lab)**: 0.53178로 5위.
- CPU 추론: bge-m3는 CPU에서 문서당 약 0.2초 수준으로 배치 인덱싱은 현실적. bge-m3-onnx-o2-cpu 등 ONNX O2 최적화 CPU 빌드가 존재해 GPU 없는 공무원 PC에서도 돌릴 수 있다. 다만 bge-m3(567M 파라미터)는 all-MiniLM(22M)·nomic-embed-text(137M) 대비 무거우므로, 저사양 PC에서 속도가 문제되면 경량 모델로 폴백 옵션을 둔다.
- **권고: bge-m3(또는 KURE-v1)를 Ollama 또는 ONNX Runtime로 구동.** 임베딩 모델은 생성 모델보다 훨씬 가볍고(수백 MB) CPU 친화적이다.

### 3. 로컬 소형 LLM 현황과 라이선스 (공공 배포 관점)
| 모델 | 크기 | 라이선스 | 공공·상업 배포 |
|---|---|---|---|
| **Gemma 3 / Gemma 3n (E2B/E4B)** | 2~4B | Gemma 약관(상업 허용) | 가능. E2B는 약 2~3GB RAM(3n-e2b 2.95GB) |
| **Kanana (카카오)** | 2.1B/8B | **Apache 2.0** | **완전 자유(가장 안전)** |
| **HyperCLOVA X SEED (네이버)** | 0.5B/1.5B/3B | 자체 라이선스(상업 허용, 일부 조건) | 대체로 가능 |
| **Qwen3 소형** | 0.5~8B | Apache 2.0(대부분) | 가능(한국어 특화도는 낮음) |
| **EXAONE (LG)** | 1.2B/32B | **EXAONE AI Model License(비상업·연구용)** | **상업·공공 배포 제약 — 주의** |

- **Kanana 라이선스 확인**: 카카오가 2025년 5월 23일 Kanana-1.5(8B·2.1B) 4종을 **Apache 2.0**으로 허깅페이스 공개("아파치 2.0 라이선스를 적용해 누구나 자유로운 수정과 상업적 활용이 가능하다"). 공모전·공공 배포에 가장 안전.
- **사용자가 언급한 "gemma4:e2b" 확인 결과**: Gemma 3n의 E2B/E4B와 혼동으로 보이며, 2026년 4월 2일 출시된 **Gemma 4** 라인에도 E2B/E4B 변형이 존재한다(Apache 2.0로 소개됨). 정확한 Ollama 태그·라이선스 조항은 배포 전 원본에서 검증 필요.
- **EXAONE은 한국어 성능(EXAONE 2.4B가 KMMLU 53.7점으로 동급 최고)이 우수하지만 라이선스가 비상업·연구용**이라 공모전 출품·공공 배포에는 부적합할 수 있다. EXAONE 4.0에서 약관이 다소 완화됐으나 "EXAONE과 경쟁하는 모델 개발 금지" 등 제약이 남아있다. 라이선스 리스크를 피하려면 **Kanana(Apache 2.0)나 Gemma 계열**을 권고.
- 양자화: Q4_K_M 기준 2~4B 모델은 8코어 CPU에서 초당 2~8토큰 수준(Gemma E2B/E4B). 실시간 채팅은 느리지만 "분류 제안·요약" 배치 작업에는 충분.

### 4. 공공기관 PC·망 환경 제약 (배포 방식이 결정적인 이유)
- **PC 사양**: 공공 PC는 저사양이 흔하다(사이버지식정보방 2019년 사양이 i5-8500·DDR4 4GB 수준). 행정안전부는 저용량 PC로 교체 중이고, **국가·지자체 공무원 62만3천여 명 대상 업무용 노트북 '온북'으로 데스크톱을 대체, 2027년까지 순차 도입** 중이다. GPU는 사실상 없다고 가정해야 한다. → **CPU 전용, 저메모리 전제 설계 필수.**
- **망분리 → N²SF 전환**: 국가정보원이 2025년 1월 23일 'N²SF(국가 망 보안체계) 가이드라인'을 발표(기밀 C·민감 S·공개 O 등급에 보안통제 차등 적용)했고, **2026년 5월 국가 정보보안 기본지침 제40조의 물리적 망분리 의무가 약 18년 만에 폐지**되는 방향으로 전환 중이다. 2026년 사이버보안 실태평가에서 "망분리 시행" 지표가 "N²SF 적용(5.5점)"으로 바뀌고 AI 도입에 가산점(1점)이 부여된다. → **로컬·오프라인 AI 도구는 정책 순풍을 탄다.**
- **설치 장벽**: 공공 PC는 비인가 SW 설치·관리자 권한이 엄격히 제한된다. Ollama 설치조차 현실적 장벽이 크다. → **safeDoc의 "관리자 권한 불필요, Node/인터넷 불필요, start.bat + PowerShell HttpListener" 방식이 결정적 차별점.** 이것이 이 프로젝트가 기존 오픈소스 도구를 이기는 핵심 이유다.
- 참고: 정보보호제품 CC인증/보안기능확인서는 방화벽·VPN·DB암호화 등 국가정보원이 지정한 정보보호제품 유형에 적용된다. 순수 로컬 검색 유틸리티는 이 필수 유형에 해당하지 않을 가능성이 크나, 기관 도입 시 보안적합성 검토는 별도로 받아야 한다.

### 5. 경쟁·유사 솔루션과 차별점
- **전통 도구**: Everything(파일명), Recoll/DocFetcher(내용 색인) — HWP 미지원, 의미 검색 없음.
- **LLM 기반 로컬 RAG**: AnythingLLM, GPT4All LocalDocs, Khoj, Onyx/Danswer, RAGFlow, PrivateGPT, LM Studio, Jan, Open WebUI 등 다수 존재. 대부분 오픈소스이고 폐쇄망 자체 호스팅도 가능.
- **"그냥 오픈소스 쓰면 되지 않나?"에 대한 답 — 안 된다. 세 가지 이유:**
  1. **HWP/HWPX 미지원**: 조사 결과 주요 RAG 프레임워크 중 **LlamaIndex만 HWP 로더(HWPReader)를 기본 제공**하고, **AnythingLLM·GPT4All·Onyx/Danswer·RAGFlow·PrivateGPT·Khoj는 HWP/HWPX를 전혀 지원하지 않는다.** (각 도구의 공식 지원 포맷 목록에 HWP 없음 — 예: Onyx는 txt/pdf/docx/pptx/xlsx/csv/md 등만, RAGFlow는 PDF/DOC/DOCX/TXT/MD 등만.) 공공 문서 대다수가 HWP/HWPX인데 이걸 못 읽으면 무용지물.
  2. **설치 장벽**: 대부분 Docker Compose나 별도 설치·GPU를 전제한다. 관리자 권한 없는 공공 PC에 배포 불가.
  3. **한국어 최적화·UX**: 4분할 탐색, 부서 폴더 동시 열람 같은 공무원 워크플로우에 맞춘 도구가 없다.
- → **차별점 = HWP 지원 + 무설치 폐쇄망 배포 + 한국어 임베딩 + 공무원 특화 UX.** 이 조합은 현재 시장에 없다.

### 6. 한글(HWP/HWPX) 처리 — 가장 중요한 기술 관문
- **HWPX**: ZIP+XML(OWPML) 구조로 DOCX와 유사. **사용자가 이미 HWPX 파서를 구현했으므로 브라우저에서 그대로 처리 가능.** 정부가 2026년 HWPX 전환을 강제(온나라시스템 지자체 확대, 통합메일 HWP 첨부 제한 → 전면 금지 방향)하고 있어 신규 문서는 대부분 HWPX가 될 것. OpenAI도 2026년 4월 17일 ChatGPT의 HWP·HWPX 정식 지원을 발표했다(그전까지는 PDF·DOCX·TXT·XLSX·CSV·PPTX만).
- **구형 바이너리 HWP 5.0(CFB/OLE)**: 여기가 진짜 난관. 오픈소스 파서:
  - **hwplib (Java, Apache-2.0)**: 가장 완성도 높은 바이너리 HWP 파서. 텍스트 추출 성숙(내부에서 Apache POI로 Compound File 파싱). 단 JVM 필요 → 브라우저·무설치 배포와 상충.
  - **pyhwp/hwp5 (Python, AGPL-3.0)**: **AGPL은 배포 시 카피레프트 리스크** — 상업·공모전에 부적합.
  - **libhwp (Python, Apache-2.0, Rust 백엔드 hwp-rs)**: 허용적 라이선스의 좋은 Python 옵션. 문단·표·수식·각주 추출.
  - **hwp.js (TypeScript, Apache-2.0)**: **브라우저에서 바이너리 HWP를 파싱할 수 있는 사실상 유일한 순수 JS 라이브러리.** 그러나 알파 수준(저자 추정 커버리지 약 20%, npm v0.0.1, 약 5년 정체).
  - hwp-rs(Rust)의 WASM 바인딩은 계획 단계로 아직 미출시. 2026년 신규 rhwp-python(Rust+PyO3) 등 대안도 등장 중.
- **난이도 평가**: HWPX 추가는 사용자 기존 자산으로 **쉬움**. 구형 HWP는 **어려움** — 브라우저 순수 JS로는 hwp.js에 의존해야 하는데 커버리지가 낮다. **현실적 대응: 구형 HWP는 (a) 하이브리드 서버 방식에서 libhwp/hwplib로 처리하거나, (b) MVP에서는 "구형 HWP는 텍스트 추출 best-effort"로 범위를 낮추고 HWPX·PDF·Office에 집중.**

### 7. 아키텍처 — 브라우저 vs 네이티브 vs 하이브리드
- **순수 브라우저 단일 HTML(safeDoc 방식)의 한계:**
  - File System Access API는 **Chrome/Edge 86+·Opera만 지원**(Firefox·Safari는 로컬 디스크 picker 미지원, OPFS만). 사용자가 폴더를 **명시적으로 선택**해야 하고 시스템 폴더는 차단. 백그라운드 자동 색인 불가.
  - 대량 파일 색인 시 브라우저 CPU·메모리·IndexedDB 한도 압박. 수천~수만 파일 인덱싱은 부담.
  - 브라우저 벡터 검색은 가능: transformers.js(WebGPU/WASM) + IndexedDB/sqlite-wasm/entity-db/pglite+pgvector 등. WebGPU는 WASM 대비 약 10~40배 빠르나(all-MiniLM 벤치 기준) 지원 브라우저 제한.
  - 구형 바이너리 HWP 파싱이 브라우저에서 취약(hwp.js 한계).
- **권고 아키텍처 — "로컬 서버 + 웹 UI" 하이브리드 (safeDoc 실행기 확장):**
  - safeDoc의 PowerShell HttpListener 실행기를 확장해 **로컬 인덱싱 백엔드**로 사용. 관리자 권한·인터넷 없이 localhost에서 동작하는 강점 유지.
  - 인덱싱·임베딩·HWP 파싱은 백엔드(초기엔 PowerShell/경량 실행파일, 확장 시 단일 실행 바이너리)에서, 검색 UI는 브라우저에서.
  - 임베딩은 Ollama(localhost:11434, safeDoc이 이미 CSP로 허용)로 bge-m3 호출하거나, Ollama 미설치 환경 대비 ONNX 임베딩을 번들.
  - 이 방식이 (1) 대량 파일 처리, (2) 구형 HWP 파싱, (3) 백그라운드 색인, (4) 무설치 배포를 모두 만족하는 유일한 균형점.
- 순수 브라우저 버전은 "소규모 폴더·HWPX 위주 데모/공모전 시연용"으로 병행 가능.

### 8. 개인정보·보안
- **임베딩 역전(embedding inversion) 공격**: 벡터DB만 유출돼도 원문이 상당 부분 복원될 수 있다. Morris et al.(2023) "Text Embeddings Reveal (Almost) As Much As Text"의 Vec2Text는 반복 보정·재임베딩으로 **32토큰 텍스트 입력의 92%를 정확히 복원**했고, 임상 노트에서 환자 실명까지 복원됐다(arXiv 2310.06816). 기업 문서 청크도 60~80% 복원 가능하다는 후속 분석이 있다. → **색인·벡터 파일을 원문과 동일한 보안 등급으로 취급**해야 한다.
- 대응: (1) 인덱스 파일 로컬 암호화, (2) 토큰 풀링+노이즈 주입 시 역전 방어 효과(최근 연구), (3) 인덱스를 사용자 PC 밖으로 절대 내보내지 않는 100% 로컬 원칙(safeDoc 철학 계승).
- **safeDoc 비식별화 연계 시너지**: 색인 생성 전 safeDoc의 규칙+LLM 비식별화를 파이프라인에 넣으면 벡터DB에 개인정보가 남지 않아 역전 공격 리스크를 근본적으로 줄인다. **두 제품을 "safeDoc으로 비식별화 → 안전하게 색인·검색"으로 묶는 것이 강력한 스토리.** 개인정보보호법 안전성 확보조치 기준(암호화·접근통제) 대응 근거로도 쓸 수 있다.

## Details

### 권고 기술 스택
- **파서**: safeDoc 기존 파서(TXT/CSV/XLSX/DOCX/HWPX/텍스트PDF) 재사용 + 구형 HWP는 libhwp(Apache-2.0) 또는 hwplib 경유(하이브리드 백엔드), 브라우저 데모는 hwp.js(best-effort).
- **검색**: BM25(경량 JS 구현 또는 sqlite FTS5) + bge-m3 임베딩 dense 검색 → RRF(Reciprocal Rank Fusion) 하이브리드.
- **임베딩**: bge-m3(1순위) / KURE-v1. Ollama 또는 ONNX Runtime. 저사양 폴백으로 경량 다국어 모델(예: multilingual-e5-small) 옵션.
- **선택적 생성 LLM**: Kanana 2.1B 또는 Gemma E2B(Apache 2.0/상업허용) — 분류 제안·요약에만.
- **저장**: 로컬 sqlite(FTS5 + sqlite-vec) 또는 IndexedDB, 암호화.
- **배포**: safeDoc의 start.bat + PowerShell HttpListener 확장, 무설치·무권한.
- **UI**: 프레임워크 없는 순수 JS + Vite(safeDoc 계승), 4분할 탐색·부서 폴더 뷰.

### 단계별 실행 계획 (1인 개발 기준)
- **Phase 0 — MVP 정의(1~2주)**: 범위 = HWPX·DOCX·XLSX·TXT·텍스트PDF의 (1) 파일명 검색 + (2) 내용 BM25 키워드 검색. LLM·임베딩 없이. safeDoc 파서 재사용으로 빠르게 "작동하는 검색"부터. 난이도 낮음.
- **Phase 1 — 의미 검색 추가(3~4주)**: bge-m3 임베딩 인덱싱 + dense 검색 + BM25 하이브리드(RRF). 여기서 "AI가 실제 가치를 더하는" 첫 지점. 검증: 실제 부서 폴더로 자연어 질의 재현율(recall@k) 측정. 난이도 중.
- **Phase 2 — 폐쇄망 배포기 완성(2~3주)**: PowerShell HttpListener 백엔드로 대량 색인·백그라운드 인덱싱. 무설치·무권한 검증(실제 공공 PC 유사 환경). 난이도 중.
- **Phase 3 — 구형 HWP 지원(3~5주, 고난도·고위험)**: libhwp/hwplib 통합. 실패 시 best-effort 텍스트 추출로 완화. 난이도 높음.
- **Phase 4 — 선택적 LLM 기능(2~3주)**: 분류·태깅 제안, 요약+출처. Kanana/Gemma. 규칙 우선·LLM 폴백. 난이도 중.
- **Phase 5 — 보안·비식별화 연계(2주)**: 인덱스 암호화, safeDoc 비식별화 파이프라인 연결. 난이도 중.
- **총 예상: 약 3.5~5개월(1인, 자산 재활용 전제).**

### 우선순위 원칙
- **먼저**: 파일명+키워드 검색(즉시 효용), HWPX 처리, 무설치 배포.
- **나중**: 구형 바이너리 HWP, 생성형 LLM 요약/QA, 자동 폴더 정리 제안.
- 이유: 사용자 고충의 대부분은 "내용까지 뒤지는 빠른 검색 + 한글 문서 + 설치 없이"로 해결되며, 이는 LLM 없이도 대부분 구현된다.

### 리스크 레지스터
| 리스크 | 확률 | 영향 | 대응 |
|---|---|---|---|
| 구형 HWP 파싱 실패 | 높음 | 높음 | libhwp/hwplib 백엔드; MVP는 HWPX 집중; 정부 HWPX 전환이 순풍 |
| 저사양 CPU에서 임베딩 인덱싱 느림 | 중 | 중 | ONNX O2 CPU 최적화, 야간 배치 색인, 증분 인덱싱, 경량 모델 폴백 |
| 공공 PC 설치·보안 검토 반려 | 중 | 높음 | 무설치·무권한·오프라인 설계; 보안성 검토 문서 준비 |
| 임베딩 역전 개인정보 유출 | 중 | 높음 | 인덱스 암호화, 비식별화 선행, 100% 로컬 |
| LLM 환각(잘못된 요약) | 중 | 중 | 생성 기능 보수적 범위, 항상 출처 문서 링크 병기 |
| 라이선스 위반(EXAONE 등) | 낮음 | 높음 | Apache 2.0(Kanana)·Gemma·MIT(bge-m3)만 사용 |
| 브라우저 API 제약(Chrome 전용) | 확실 | 중 | 하이브리드 서버 방식으로 우회, Chrome/Edge 타깃 명시 |

### safeDoc 재활용 가능 자산
1. HWPX·DOCX·XLSX·CSV·TXT·텍스트PDF 파서 (그대로)
2. fflate ZIP 해제, pdfjs-dist (그대로)
3. PowerShell HttpListener 폐쇄망 실행기 (인덱싱 백엔드로 확장)
4. CSP localhost:11434 루프백 격리 (Ollama 임베딩 호출에 재사용)
5. 규칙(정규식)+로컬 LLM 이중 탐지 구조 (분류·비식별화에 재사용)
6. 단일 HTML 배포·순수 JS+Vite 빌드 (UI 계승)
7. Vitest 테스트·GitHub Actions CI (품질 인프라 계승)
8. 비식별화 엔진 (색인 전처리 파이프라인으로 결합)

### 공모전 어필 포인트
- 2026년 공공데이터·AI 활용 창업경진대회 다수(행정안전부 범정부 통합본선, 서울·경기·충남·제주 등)가 "AI 기술 활용/AI 서비스" 평가지표를 신설. 로컬 AI·개인정보 보호는 정확히 트렌드에 부합.
- **스토리**: "실제 공무원이 겪는 고충 → 100% 로컬·오프라인 AI로 해결 → 개인정보 유출 제로 → 무설치 폐쇄망 배포 → HWP 지원." 정책(N²SF, 소버린 AI, 공공문서 개방형 포맷 전환)과 완벽히 정렬.
- safeDoc(비식별화) + 이 도구(안전한 검색)의 **제품군 시너지**로 완성도 어필.

## Recommendations
1. **지금 시작: Phase 0~2를 먼저 완성하라.** 파일명+키워드+의미 검색 + 무설치 배포. LLM 없이 4~9주 안에 "실사용 가능한 차별화 제품"이 나온다. 이것만으로도 공모전 출품 가능.
2. **임베딩은 bge-m3, 생성 LLM은 Kanana(Apache 2.0) 또는 Gemma로 확정.** EXAONE은 라이선스 때문에 배제. "gemma4:e2b" 정확 태그는 Ollama에서 실물 확인 후 사용.
3. **구형 HWP는 Phase 3로 미루되, MVP 단계부터 "HWPX 우선" 메시지를 명확히 하라.** 정부의 HWPX 강제 전환이 리스크를 자동으로 줄여준다.
4. **아키텍처는 하이브리드(로컬 서버+웹UI)로.** 순수 브라우저는 시연·소규모용으로 병행. safeDoc 실행기를 인덱싱 백엔드로 확장하는 것이 최단 경로.
5. **safeDoc 비식별화를 색인 전처리로 결합하라.** 임베딩 역전 리스크를 없애고 제품군 스토리를 완성한다.
6. **벤치마크·검증 임계값**: 실제 부서 폴더(수천~1만 파일)로 재현율/속도 측정. 기준 — 저사양 CPU에서 1만 파일 초기 색인이 하룻밤(야간 배치) 내 완료되고, 질의 응답이 2초 이내면 실사용 가능. 이 기준 미달 시 증분 색인·경량 임베딩(384차원 소형 모델)으로 전환.

## Caveats
- Gemma 4 및 "gemma4:e2b" 관련 정보는 2026년 4월 출시 후의 2차 자료(모델 크기·라이선스 소개 사이트)에 기반하며 일부는 마케팅성 서술을 포함한다. 정확한 Ollama 태그·라이선스 조항은 배포 전 원본에서 재확인 필요.
- CPU 임베딩 속도 수치(bge-m3 문서당 약 0.2초 등)는 하드웨어·배치·양자화에 크게 좌우된다. 실제 대상 PC에서 벤치마크 필수.
- 공공기관 보안성 검토·설치 허용 여부는 기관마다 다르며, N²SF 전환기라 기준이 유동적이다. "정보보호제품" CC인증/보안기능확인서 대상 여부는 도구 성격에 따라 달라지므로 도입 기관과 사전 협의 필요.
- hwp.js 커버리지(약 20%)와 정체 상태는 저자의 과거 공지(GitHub Issue)에 근거하며, 이후 커뮤니티 포크로 개선됐을 수 있으니 최신 상태 재확인 권장.
- 공공 문서 HWP/HWPX 비중은 2025~2026년 조사·보도에 근거한다. 2025년 10월 조사에서 공무원 약 90%가 "AI가 읽지 못하는 HWP·PDF를 쓴다"고 응답했고, 국가인공지능전략위원회가 2026년 2월 긴급회의로 개방형 포맷 전환을 결의했다. HWP와 HWPX를 분리한 정확한 비율 통계는 공개 자료에서 확인되지 않았다.

---
### 주요 출처 URL
- 한국어 임베딩 리더보드: https://github.com/nlpai-lab/KURE , https://github.com/su-park/mteb_ko_leaderboard , https://onand0n.github.io/ko-embedding-leaderboard/
- Ollama 임베딩/bge-m3: https://ollama.com/library/bge-m3 , https://www.morphllm.com/ollama-embedding-models
- Gemma 3n/4: https://ai.google.dev/gemma/docs/gemma-3n , https://lmstudio.ai/models/gemma-3n
- Kanana(Apache 2.0): https://www.kakaocorp.com/page/detail/11566 , 공개SW포털 https://www.oss.kr/oss_guide/show/9246eca5-f639-484c-be09-797d76fc9582
- HyperCLOVA X SEED: https://clova.ai/tech-blog/ai-생태계에-씨앗을-뿌리다-상업용-오픈소스-ai-hyperclova-x-seed
- EXAONE 라이선스: https://huggingface.co/LGAI-EXAONE/EXAONE-4.0-32B , https://github.com/LG-AI-EXAONE/EXAONE-3.0/blob/main/LICENSE
- 한국어 SLM 벤치마크: https://medical.vizensoft.com/insight/read?no=617 , https://www.promptquorum.com/ko/local-llms/best-beginner-local-llm-models
- N²SF/망분리: https://byline.network/2025/01/30-371/ , https://www.ahnlab.com/ko/contents/content-center/36104 , https://m.boannews.com/html/detail.html?idx=140878
- 공무원 PC/온북: https://namu.news/article/1704736 , https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?nttId=62275
- CC인증/보안기능확인서: https://www.nis.go.kr/AF/1_7_2_1.do , https://www.ncsc.go.kr , https://www.koit.co.kr/news/articleView.html?idxno=92305
- HWP/HWPX 처리 도구: https://ko.wikipedia.org/wiki/오픈소스_HWP/HWPX_처리_도구_목록 , https://github.com/neolord0/hwplib , https://github.com/neolord0/hwpxlib , https://github.com/hahnlee/hwp.js , https://github.com/hahnlee/hwp-rs , https://pypi.org/project/libhwp , https://github.com/mete0r/pyhwp , https://pypi.org/project/llama-index-readers-hwp/
- 경쟁 RAG 도구: https://docs.gpt4all.io/gpt4all_desktop/localdocs.html , https://github.com/Mintplex-Labs/anything-llm , https://onyx.app/insights/self-hosted-rag , https://ragflow.io/docs/ , https://github.com/zylon-ai/private-gpt , https://docs.khoj.dev/
- File System Access API: https://developer.chrome.com/docs/capabilities/web-apis/file-system-access , https://www.testmuai.com/learning-hub/file-system-access-api-browser-support/
- 브라우저 벡터 검색: https://huggingface.co/docs/transformers.js/en/guides/webgpu , https://rxdb.info/articles/javascript-vector-database.html , https://github.com/anasM0hammad/entity-db
- 하이브리드 검색: https://www.elastic.co/what-is/hybrid-search , https://opensearch.org/blog/building-effective-hybrid-search-in-opensearch-techniques-and-best-practices/ , https://www.knovo.dev/guides/semantic-search-vs-keyword
- 임베딩 역전 공격: https://aclanthology.org/2024.acl-long.230.pdf , https://arxiv.org/abs/2310.06816 , https://aquilax.ai/blog/vector-embedding-inversion-attacks
- CPU 임베딩 속도: https://huggingface.co/BAAI/bge-m3/discussions/9 , https://www.promptlayer.com/models/bge-m3-onnx-o2-cpu/ , https://sbert.net/docs/sentence_transformer/usage/efficiency.html
- 공모전: https://www.data.go.kr/suc/preliminaryRound.do , https://bigtori.kalis.or.kr/contest/data-utilization-5
- ChatGPT HWP 지원/공공문서 포맷 전환: ZDNet Korea(2026.4.17), https://www.koreatimes.co.kr/southkorea/20260426/govt-to-phase-out-hwp-file-format-for-ai-compatibility