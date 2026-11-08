// 성명 탐지 — 사전·필드명·문맥·호칭 조합 (FR-311, 기술명세서 Ⅴ-5)

import {
  KOREAN_SURNAMES, KOREAN_SURNAMES_2CHAR, NAME_FIELD_KEYWORDS, COLON_NAME_LABELS,
  NON_NAME_FIELD_LABELS, NAME_TITLES, NAME_STOPWORDS,
  FIELD_KEYWORDS_BY_TYPE, BANK_NAMES, SIDO_NAMES,
} from '../dictionaries.js';
import { makeCandidate } from './helpers.js';

// 모든 유형의 필드명 키워드("차량번호", "전화번호" 등)는 성명 후보에서 제외
const ALL_FIELD_KEYWORDS = new Set(
  Object.values(FIELD_KEYWORDS_BY_TYPE).flat().filter((k) => /^[가-힣]+$/.test(k)),
);
const BANK_NAME_SET = new Set(BANK_NAMES);
const SIDO_NAME_SET = new Set(SIDO_NAMES);
const NON_NAME_LABEL_SET = new Set(NON_NAME_FIELD_LABELS);

// 필드명 뒤의 값: "성명: 홍길동", "이름 홍길동"
// 반드시 콜론(:·：·=) 또는 공백 구분자가 1개 이상 있어야 한다.
// (구분자가 없으면 "담당자였던", "대리인으로"의 어미/조사를 이름으로 오탐한다)
const FIELD_NAME_PATTERN = new RegExp(
  `(${NAME_FIELD_KEYWORDS.join('|')})([ \\t]*[:：=][ \\t]*|[ \\t]+)([가-힣]{2,5})(?![가-힣])`,
  'g',
);

// 단축 라벨("담당: 김서연", "참석: 오세훈", "통역: 왕리메이")은 콜론이 있을 때만 인정
const COLON_NAME_PATTERN = new RegExp(
  `(${COLON_NAME_LABELS.join('|')})[ \\t]*[:：][ \\t]*([가-힣]{2,5})(?![가-힣])`,
  'g',
);

// 셀·줄 단위 추출 문서(XLSX sharedStrings 등)에서 단독 라벨 줄 바로 다음 줄의 성명 값 ("성명\n홍길동")
const LINE_LABEL_NAME_PATTERN = new RegExp(
  `(?:^|\\n)[ \\t]*(${NAME_FIELD_KEYWORDS.join('|')})[ \\t]*\\r?\\n[ \\t]*([가-힣]{2,4})(?=\\r?\\n|$)`,
  'g',
);

// 명시적 성명 라벨 + 콜론 뒤의 띄어쓰기 포함 외국인 성명 ("상담자: 응우옌 티 흐엉", "통역: 제임스 카터")
const ALL_NAME_LABELS = [...new Set([...NAME_FIELD_KEYWORDS, ...COLON_NAME_LABELS])];
const FOREIGN_COLON_NAME_PATTERN = new RegExp(
  `(${ALL_NAME_LABELS.join('|')})[ \\t]*[:：][ \\t]*([가-힣]{1,5}(?:[ \\t]+[가-힣]{1,5}){1,3})(?![가-힣])`,
  'g',
);

// 필드명과 값 사이에 조사가 낀 문장형: "예금주는 최다은이다", "상담자는 배수지였고" (ANALYSIS 2.4)
const FIELD_PARTICLE_PATTERN = new RegExp(
  `(${ALL_NAME_LABELS.join('|')})(?:은|는|이|가)[ \\t]+([가-힣]{2,7})(?![가-힣])`,
  'g',
);

// 이름 뒤에 붙는 서술어 어미 ("최다은이다" → "최다은", "배수지였고" → "배수지")
const PREDICATE_SUFFIX = /(입니다|이었다|이었고|이었으며|이라고|이라는|이다|이고|이며|였다|였고|였으며|라고)$/;

// 이름의 마지막 음절로 쓰이지 않는 조사 → 안전하게 뗀다
const UNAMBIGUOUS_PARTICLES = /(에게서|으로부터|께서|에게|한테|으로|는|을|를|의|께)$/;
// 이름 끝 음절과 겹칠 수 있는 조사(은·이·가·과·와·도·만)
const AMBIGUOUS_PARTICLES = /(은|이|가|과|와|도|만)$/;
// 사람 이름에 붙지 않는 비생물/처소/수단 격조사 ("부서에서", "문서에", "사유로")
const INANIMATE_PARTICLE_SUFFIX = /(에서|으로부터|으로|에게서|까지|부터|에|로)$/;

// 부서명 접미사 '과'("민원지원과", "관광콘텐츠과", "소아청소년과")가 조사 '과'로 분리되는 것을 방지
const DEPT_GWA_PATTERN =
  /(지원|관리|행정|민원|총무|기획|예산|회계|세무|복지|문화|관광|콘텐츠|체육|환경|교통|건설|도시|건축|토목|안전|재난|산림|농정|수산|해양|항만|공항|정보|전산|보안|교육|인사|노무|법무|감사|홍보|경제|산업|재정|정책|전략|소통|자치|여성|가족|아동|청소년|노인|장애인|보건|위생|의약|식품|진료|소아|피부|내|외|치|안|정형외|신경외|산부인)과$/;

// 기관·부서·시설·문서·비용·통계 접미사 (성명 오탐 원천 배제)
const ORG_AND_OBJECT_SUFFIX = new RegExp(
  '(' + [
    // 금융·공공기관·기업·조직
    '은행|공사|공단|공고|센터|지점|본점|금고|협회|재단|법인|부서|번호|본부|회사|조합|상사|유통|그룹',
    // 사업소·관공서·시설
    '사업소|사무소|연구소|보건소|파출소|출장소|영업소|관리소|상담소|진료소|대피소|보관소|정비소|휴게소|안내소|발전소|변전소',
    '경찰서|소방서|세무서|우체국|기상청|경찰청|국세청|관세청|조달청|통계청|병무청|산림청|특허청|검찰청|교육청|시청|구청|군청|도청|본청|지청',
    '법원|감사원|연구원|교육원|연수원|훈련원|보육원|양로원|요양원|재활원|감정원|평가원|인증원|진흥원|개발원|정보원|안전원|의료원|병원|한의원|유치원|수목원|동물원|식물원',
    '위원회|협의회|심의회|이사회|연구회|연합회|체육회|장학회|후원회|동호회',
    // 장소·장(場)·문서장(狀)
    '정수장|매립장|소각장|주차장|운동장|정류장|해수욕장|백사장|경기장|수영장|공연장|전시장|행사장|회의장|시험장|교육장|작업장|사업장|공사장|선착장|골프장|캠핑장|야영장|예식장|장례식장',
    '위임장|초대장|청첩장|안내장|통지장|소환장|고소장|고발장|답변서|표창장|임명장|위촉장|졸업장|운송장',
    // 문서·서식·증명·표
    '신청서|보고서|계획서|계약서|협약서|합의서|동의서|확인서|증명서|진단서|소견서|청구서|견적서|발주서|납품서|인수서|검수서|명세서|내역서|정산서|결산서|예산서|기안서|품의서|시말서|경위서|사유서|탄원서|진정서|성명서|선언서|서약서|이력서|소개서|추천서|통지서|고지서|안내서|지침서|해설서|설명서|교과서|참고서|처방전',
    '영수증|신분증|주민증|등록증|면허증|자격증|허가증|인가증|확인증|수료증|졸업증|합격증|회원증|사원증|학생증|출입증|주차증|보관증|차용증|인수증|접수증',
    '안내문|공고문|결정문|판결문|성명문|선언문|결의문|호소문|사과문|해명문|보도문|지시문|명령문|통지문|경고문|요약문|번역문',
    '총괄표|집계표|일정표|시간표|계획표|배치표|근무표|식단표|요금표|가격표|단가표|성적표|분석표|비교표|대조표|목록표|현황표|조직표|분류표|기준표|점검표|체크표',
    // 비용·요금·세금·수치·인원
    '사업비|인건비|운영비|관리비|유지비|수선비|재료비|노무비|출장비|교통비|숙박비|교육비|연구비|개발비|홍보비|광고비|행사비|회의비|통신비|치료비|진료비|약제비|수술비|입원비|장례비|참가비|배송비|설치비|철거비|처리비|예비비',
    '수수료|사용료|이용료|임대료|임차료|관람료|입장료|수강료|수업료|검정료|심사료|감정료|자문료|용역료|위탁료|대행료|보관료|주차료|통행료|배송료|우편료|전기료|수도료|가스료|통신료|수신료|구독료|보험료|연체료|과태료|범칙금',
    '지원금|보조금|장학금|후원금|기부금|대출금|배당금|수익금|매출금|판매금|계약금|중도금|보증금|위약금|배상금|보상금|합의금|위로금|격려금|포상금|상여금|성과금|퇴직금|부가세|소득세|법인세|재산세|취득세|등록세|상속세|증여세|과징금|부담금|분담금|충당금|적립금|예치금|미수금|선수금|환급금|반환금|정산금|할인금|공제금|체납금|미납금|연체금',
    '인원수|학생수|직원수|회원수|고객수|가구수|세대수|차량수|개월수|페이지수|조회수|방문수|과반수|상수도|하수도|가로수|지하수',
    '공무원|사무원|상담원|안내원|경비원|미화원|운전원|조리원|배달원|집배원|판매원|종업원|조합원|승무원|역무원',
  ].join('|') + ')$',
);

// 행정조직·부서 명칭 패턴 ("문화국", "신공항국", "해양실", "전산실", "총무팀", "재무팀", "민원지원과" 등)
const ADMIN_DEPT_PATTERN = new RegExp(
  '(문화|관광|콘텐츠|산업|신공항|공항|항만|해양|수도|전략|안전|관리|인력|배치|행정|민원|지원|복지|환경|교통|건설|도시|건축|토목|주택|도로|하천|공원|녹지|산림|농정|수산|경제|재정|기획|예산|회계|세무|총무|인사|교육|정보|전산|보안|감사|홍보|법무|노무|재난|소방|경찰|보건|위생|의약|식품|여성|가족|아동|청소년|노인|장애인|일자리|미래|혁신|디지털|스마트|시설|운영|점검|현장|비상|대응|상황|통제|소관|사업|진료|소아|피부|정형외|신경외|산부인|비서|상담|자료|대기|휴게|기계|당직|교무|연구|실험|서버|경비|숙직|강의|실습|도서|열람|방송|인쇄|문서|화장|탈의|조리|급식|수술|입원|응급|검사|원무|재무|구매|자재|물류|생산|품질|영업|개발|기술|고객)(국|실|과|팀|부|단|청|소|처|관|본부|센터)$',
);

// 일반 역할·대상자 명사 ("신청자", "대상자", "관계자", "담당자", "배석자" 등)
const ROLE_JA_PATTERN = new RegExp(
  '(관계|관련|해당|신청|대상|지원|후보|참가|방문|거주|운전|보행|사망|부상|실종|동반|이용|사용|소비|판매|구매|공급|채권|채무|임차|수급|유권|납세|응시|당선|입찰|낙찰|출입|체류|입국|출국|생존|구조|피해|가해|점유|발주|가입|수익|경영|생산|수요|노동|근로|관리|운영|책임|실무|검토|결재|승인|참석|불참|발표|진행|사회|강연|적격|위반|체납|미납|연체|희망|예정|선정|탈락|포기|이수|수료|졸업|전출|전입|퇴직|재직|휴직|복직|구직|실업|취업|창업|폐업|경력|초보|실제소유|비상연락|이해관계|특수관계|민원|담당|소유|대표|작성|접수|수신|발신|보호|계약|피보험|상담|배석|처리)자$',
);

// 동사·형용사·관형형·어미 활용형 ("연락하여", "가능한", "동일한", "주십시오", "부재중일", "안내해", "남긴")
const VERB_OR_MODIFIER_SUFFIX =
  /(하여|하고|하는|하니|하면|하며|했다|한다|합니다|되어|된다|됩니다|하기|하지|가능한|동일한|유일한|필요한|중요한|명확한|정확한|적절한|충분한|다양한|특별한|간단한|복잡한|유사한|상세한|긴급한|신속한|안전한|위험한|불가한|부당한|정당한|타당한|합당한|십시오|세요|시오|바랍니다|습니다|았다|었다|였다|겠다|는지|은지|았던|었던|였던|해서|해야|해도|해주|해달|드리|드림|주었|받았|맡았|남긴|보낸|찾은|없는|있는|같은|따른|위한|관한|대한|부재중일|안내해)$/;

// 한글 숫자 표기 ("공일공", "구팔칠육", "오사삼이" 등 전화·주민번호 구술 표기)
const HANGUL_DIGIT_ONLY = /^[공영일이삼사오육칠팔구십백천만억조]+$/;

// 하나의 단어에서 성명일 수 있는 표기들을 길이 내림차순으로 반환한다.
// 마지막 원소는 항상 조사를 최대한 뗀 형태이며, 점수 계산의 기준이 된다.
export function nameVariants(word) {
  if (DEPT_GWA_PATTERN.test(word)) return [word];

  const unambiguous = word.replace(UNAMBIGUOUS_PARTICLES, '');
  if (unambiguous !== word) return unambiguous.length >= 2 ? [unambiguous] : [word];

  const ambiguous = word.replace(AMBIGUOUS_PARTICLES, '');
  if (ambiguous !== word && ambiguous.length >= 2) {
    // 1글자 성씨 + 3글자 이름 + 1글자 조사 = 4글자("윤채은은", "정예은이", "한시은과", "강태오와"):
    // 복성(남궁·황보 등)이 아니면 4번째 글자는 확실히 조사이므로 3글자 본체만 남긴다.
    if (word.length === 4 && !KOREAN_SURNAMES_2CHAR.has(word.slice(0, 2))) {
      return [ambiguous];
    }
    return [word, ambiguous];
  }

  return [word];
}

// 단어가 인명이 아닌 일반명사·기관명·부서명·직위·상태어인지 판별 (AI 후처리에서도 재사용)
export function isNonNameWord(word) {
  if (typeof word !== 'string') return true;
  const trimmed = word.trim();
  if (trimmed.length < 2) return true;
  if (!/[가-힣A-Za-z]/.test(trimmed)) return true;

  // 띄어쓰기가 포함된 경우 ("주식회사 한빛", "안전관리 인력배치", "응우옌 티 흐엉")
  if (/\s/.test(trimmed)) {
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.some((t) =>
      BANK_NAME_SET.has(t) ||
      NAME_TITLES.includes(t) ||
      NAME_FIELD_KEYWORDS.includes(t) ||
      NON_NAME_LABEL_SET.has(t) ||
      ALL_FIELD_KEYWORDS.has(t) ||
      (t.length >= 2 && (ORG_AND_OBJECT_SUFFIX.test(t) || ADMIN_DEPT_PATTERN.test(t))))) {
      return true;
    }
    if (tokens.every((t) => isNonNameWord(t))) return true;
    return false;
  }

  if (NAME_STOPWORDS.has(trimmed)) return true;
  if (NAME_TITLES.includes(trimmed)) return true;
  if (NAME_FIELD_KEYWORDS.includes(trimmed) || COLON_NAME_LABELS.includes(trimmed)) return true;
  if (NON_NAME_LABEL_SET.has(trimmed)) return true;
  if (ALL_FIELD_KEYWORDS.has(trimmed)) return true;
  if (SIDO_NAME_SET.has(trimmed)) return true;
  if (BANK_NAME_SET.has(trimmed)) return true;
  if (HANGUL_DIGIT_ONLY.test(trimmed)) return true;
  if (VERB_OR_MODIFIER_SUFFIX.test(trimmed)) return true;
  if (DEPT_GWA_PATTERN.test(trimmed)) return true;
  if (ORG_AND_OBJECT_SUFFIX.test(trimmed)) return true;
  if (ADMIN_DEPT_PATTERN.test(trimmed)) return true;
  if (ROLE_JA_PATTERN.test(trimmed)) return true;

  return false;
}

// 앞쪽 같은 줄에 비성명 라벨("처리부서:", "소속:", "상호:", "진료과:" 등)이 있는지 확인
const PRECEDING_NON_NAME_LABEL_RE = new RegExp(
  `(?:^|[^가-힣])(${NON_NAME_FIELD_LABELS.join('|')})[ \\t]*[:：=][ \\t]*$`,
);
export function isPrecededByNonNameLabel(text, start) {
  const lineStart = Math.max(0, text.lastIndexOf('\n', start - 1) + 1, start - 20);
  const before = text.slice(lineStart, start);
  return PRECEDING_NON_NAME_LABEL_RE.test(before);
}

// 뒤쪽 같은 줄에 조직·정원·소관 표기("문화국 소관사업소", "신공항국(12)", "사업소Ⅰ(18)")가 이어지는지 확인
const FOLLOWING_ORG_CONTEXT_RE =
  /^(?:[ \t]*(?:소관|산하|관할)(?:사업소|부서|기관)?|[ \t]*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩI]{1,3}(?:[ \t]*\(\d+|\b)|[ \t]*\(\d+(?:명|개소|구역|건|%)?\))/;
export function isFollowedByOrgContext(text, end) {
  const after = text.slice(end, Math.min(text.length, end + 20));
  return FOLLOWING_ORG_CONTEXT_RE.test(after);
}

// 한글 2~5글자 단어 (성씨 사전 확인용)
const HANGUL_WORD = /[가-힣]{2,5}/g;

// 직위·호칭 뒤에 조사("신동현 님은", "박서준 씨가", "김서연 주무관이")가 붙는 경우도 함께 인식
const TITLE_PATTERN = new RegExp(
  `^\\s?(${NAME_TITLES.join('|')})(?:은|는|이|가|을|를|의|께|께서|에게|한테|과|와|도|만|으로부터|에게서)?(?![가-힣])`,
);

// 사람에게만 붙는 여격/높임 조사 또는 동반 표현 ("윤소라에게", "홍길동께서", "강태오와 함께")
const PERSON_PARTICLE_AFTER = /^(?:(에게서|에게|한테|께서|께)(?![가-힣])|(과|와)[ \t]+함께)/;

// 주격/보조사/관형격 뒤에서 사람임을 뒷받침하는 행위·역할 문맥
const PERSON_ACTION_CONTEXT =
  /(방문|제출|신청|접수|작성|서명|날인|참석|불참|동행|안내해|안내하|연락|문의|상담|수령|입금|출금|송금|결제|위임|대리인|본인|민원인|신청인|예금주|수령인|보호자|환자|피해자|거주|전입|전출|입원|퇴원|진료|출장|근무|입사|퇴사|진술|넘겨받아|검토하|마무리하|맡았|돌아갔|확인하였|확인했|요청하였|요청했)/;

// 성씨 + 음절 수 적합성 검사
// - 복성(남궁·황보 등): 3~4글자 ("남궁민", "남궁민수")
// - 단성(김·이·박 등): 기본 2~3글자 ("홍길동", "한결").
//   단성 4글자 단어는 거의 모두 사자성어·복합명사("안전관리", "인력배치", "신공항국")이므로
//   직위·호칭이나 성명 필드명이 명시된 경우에만 허용한다.
function startsWithValidSurname(word, allowFourCharSingleSurname = false) {
  if (KOREAN_SURNAMES_2CHAR.has(word.slice(0, 2))) {
    return word.length >= 3 && word.length <= 4;
  }
  if (KOREAN_SURNAMES.has(word[0])) {
    if (word.length === 2 || word.length === 3) return true;
    if (word.length === 4 && allowFourCharSingleSurname) return true;
  }
  return false;
}

// 같은 줄(또는 인접 줄)에 정형 개인정보가 있는지 확인
function isNearStructuredPii(text, start, end, otherPiiRanges) {
  for (const r of otherPiiRanges) {
    const dist = r.start >= end ? r.start - end : (start >= r.end ? start - r.end : 0);
    if (dist >= 40) continue;
    const between = r.start >= end ? text.slice(end, r.start) : text.slice(r.end, start);
    const newlines = (between.match(/\n/g) || []).length;
    if (newlines <= 1) return true;
  }
  return false;
}

// 다중 어절 외국인 성명 후보 검증 ("응우옌 티 흐엉", "제임스 카터", "리 웨이", "사토 유키")
function cleanForeignNameTokens(rawPhrase) {
  const tokens = rawPhrase.trim().split(/[ \t]+/).filter(Boolean);
  while (tokens.length > 0 && NAME_TITLES.includes(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (tokens.some((t) =>
    NAME_TITLES.includes(t) ||
    NAME_FIELD_KEYWORDS.includes(t) ||
    COLON_NAME_LABELS.includes(t) ||
    NON_NAME_LABEL_SET.has(t) ||
    ALL_FIELD_KEYWORDS.has(t) ||
    PREDICATE_SUFFIX.test(t) ||
    INANIMATE_PARTICLE_SUFFIX.test(t) ||
    VERB_OR_MODIFIER_SUFFIX.test(t) ||
    ORG_AND_OBJECT_SUFFIX.test(t) ||
    ADMIN_DEPT_PATTERN.test(t) ||
    NAME_STOPWORDS.has(t))) {
    return null;
  }
  const cleaned = tokens.join(' ');
  if (cleaned.length < 3 || cleaned.length > 15) return null;
  return cleaned;
}

// 콜론(:) 뒤 서식 값("성명: 최다은", "동행: 왕리메이")은 뒤에 문장이 이어지지 않으면
// 끝 글자('은', '이' 등)를 격조사로 분리하지 않는다.
function colonFieldVariants(raw, text, rawEnd) {
  const afterOnLine = text.slice(rawEnd, rawEnd + 10);
  if (/^[ \t]+[가-힣]/.test(afterOnLine)) {
    return nameVariants(raw);
  }
  const unambiguous = raw.replace(UNAMBIGUOUS_PARTICLES, '');
  if (unambiguous !== raw && unambiguous.length >= 2) return [unambiguous];
  return [raw];
}

export function detectName(text, { otherPiiRanges = [] } = {}) {
  const results = [];
  const seen = new Set();
  const confirmedNames = new Set();

  function addResult(start, end, score, method, baseName = null) {
    const key = `${start}:${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (baseName && score >= 0.45) confirmedNames.add(baseName);
    results.push(makeCandidate({
      text, start, end, type: 'PERSON_NAME',
      baseScore: Math.min(score, 1), detectionMethod: method,
    }));
  }

  // 1-a) 필드명 기반 탐지 — "성명: 홍길동", "신청인 박서준"
  for (const m of text.matchAll(FIELD_NAME_PATTERN)) {
    const sep = m[2];
    const raw = m[3];
    const hasColon = /[:：=]/.test(sep);
    if (!hasColon && INANIMATE_PARTICLE_SUFFIX.test(raw)) continue;
    if (isNonNameWord(raw)) continue;

    const valueStart = m.index + m[0].length - raw.length;
    const variants = hasColon
      ? colonFieldVariants(raw, text, valueStart + raw.length)
      : nameVariants(raw);
    const base = variants[variants.length - 1];
    if (isNonNameWord(base)) continue;
    if (isFollowedByOrgContext(text, valueStart + base.length)) continue;

    // 콜론 없이 공백으로만 이어진 경우("보호자 동의", "수신자 목록")에는 성씨 구조가 맞아야 성명으로 인정
    if (!hasColon && !startsWithValidSurname(base, false)) continue;

    let score = hasColon ? 0.75 : 0.65;
    if (startsWithValidSurname(base, hasColon)) score += 0.15;
    for (const word of variants) {
      addResult(valueStart, valueStart + word.length, score, 'CONTEXT', base);
    }
  }

  // 1-b) 단축 라벨 + 콜론: "담당: 김서연", "통역: 왕리메이", "참석: 오세훈"
  for (const m of text.matchAll(COLON_NAME_PATTERN)) {
    const raw = m[2];
    if (isNonNameWord(raw)) continue;
    const valueStart = m.index + m[0].length - raw.length;
    const variants = colonFieldVariants(raw, text, valueStart + raw.length);
    const base = variants[variants.length - 1];
    if (isNonNameWord(base)) continue;
    if (isFollowedByOrgContext(text, valueStart + base.length)) continue;

    let score = 0.75;
    if (startsWithValidSurname(base, true)) score += 0.15;
    for (const word of variants) {
      addResult(valueStart, valueStart + word.length, score, 'CONTEXT', base);
    }
  }

  // 1-c) 단독 라벨 줄 + 다음 줄 성명 (XLSX 셀 추출 등: "성명\n홍길동")
  for (const m of text.matchAll(LINE_LABEL_NAME_PATTERN)) {
    const raw = m[2];
    if (isNonNameWord(raw)) continue;
    if (!startsWithValidSurname(raw, false)) continue;
    const valueStart = m.index + m[0].length - raw.length;
    addResult(valueStart, valueStart + raw.length, 0.8, 'CONTEXT', raw);
  }

  // 1-d) 명시적 라벨 + 콜론 뒤의 다중 어절 외국인 성명 ("상담자: 응우옌 티 흐엉", "통역: 제임스 카터")
  for (const m of text.matchAll(FOREIGN_COLON_NAME_PATTERN)) {
    const rawPhrase = m[2];
    const cleaned = cleanForeignNameTokens(rawPhrase);
    if (!cleaned) continue;
    const valueStart = m.index + m[0].indexOf(rawPhrase);
    addResult(valueStart, valueStart + cleaned.length, 0.85, 'CONTEXT', cleaned);
  }

  // 1-e) 필드명+조사 문장형 — "예금주는 최다은이다", "상담자는 배수지였고" (ANALYSIS 2.4)
  for (const m of text.matchAll(FIELD_PARTICLE_PATTERN)) {
    const raw = m[2];
    if (INANIMATE_PARTICLE_SUFFIX.test(raw)) continue;
    if (VERB_OR_MODIFIER_SUFFIX.test(raw)) continue;
    const stripped = raw.replace(PREDICATE_SUFFIX, '');
    if (stripped.length < 2 || isNonNameWord(stripped)) continue;
    const variants = nameVariants(stripped);
    const base = variants[variants.length - 1];
    if (base.length < 2 || base.length > 4) continue;
    if (!startsWithValidSurname(base, false)) continue;
    if (isNonNameWord(base)) continue;
    const start = m.index + m[0].length - raw.length;
    for (const word of variants) {
      addResult(start, start + word.length, 0.65, 'CONTEXT', base);
    }
  }

  // 2) 성씨 사전 + 문맥 기반 탐지
  // 성씨로 시작한다는 것만으로는 개인정보가 아니다(한국어 일반 한자어의 상당수가 성씨 음절로 시작함).
  // 반드시 호칭·직위, 인칭 격조사, 인명 행위 서술어, 같은 행의 정형 식별자 인접,
  // 또는 문서 내 기확인된 성명의 재출현 중 하나 이상의 문맥 근거가 있어야 후보로 선별한다.
  const wordCount = new Map();
  const candidates = [];
  for (const m of text.matchAll(HANGUL_WORD)) {
    const raw = m[0];
    if (raw.length < 2) continue;
    // 앞이 한글이면 더 긴 단어의 일부이므로 제외
    if (m.index > 0 && /[가-힣]/.test(text[m.index - 1])) continue;
    if (INANIMATE_PARTICLE_SUFFIX.test(raw)) continue;
    if (isNonNameWord(raw)) continue;

    const variants = nameVariants(raw);
    const base = variants[variants.length - 1];
    if (base.length < 2 || base.length > 4) continue;
    if (isNonNameWord(base)) continue;

    const baseEnd = m.index + base.length;
    const after = text.slice(baseEnd, baseEnd + 10);
    const hasTitle = TITLE_PATTERN.test(after);
    if (!startsWithValidSurname(base, hasTitle)) continue;
    if (isPrecededByNonNameLabel(text, m.index)) continue;
    if (isFollowedByOrgContext(text, baseEnd)) continue;
    if (/^\s*[:：=]/.test(text.slice(baseEnd, baseEnd + 3))) continue;

    candidates.push({ base, variants, start: m.index, baseEnd, after, hasTitle });
    wordCount.set(base, (wordCount.get(base) || 0) + 1);
  }

  const pendingPropagation = [];

  for (const c of candidates) {
    const primaryLen = c.variants[0].length;
    let score = primaryLen === 2 ? 0.15 : 0.25;

    // (a) 직위·호칭 결합 ("김서연 주무관", "박서준 씨", "신동현 님")
    if (c.hasTitle) score += 0.35;

    // (b) 사람 전용 격조사·동반 표현 ("윤소라에게", "홍길동께서", "강태오와 함께")
    if (PERSON_PARTICLE_AFTER.test(c.after)) {
      score += 0.25;
    } else if (/^(은|는|이|가|의)(?![가-힣])/.test(c.after)) {
      // (c) 주격/보조사/관형격 + 같은 절 내 인명 행위 서술어("방문", "제출", "안내해" 등)
      const lineEnd = text.indexOf('\n', c.baseEnd);
      const clauseAfter = text.slice(
        c.baseEnd,
        lineEnd >= 0 ? Math.min(lineEnd, c.baseEnd + 35) : c.baseEnd + 35,
      );
      const lineStart = Math.max(0, text.lastIndexOf('\n', c.start - 1) + 1, c.start - 20);
      const clauseBefore = text.slice(lineStart, c.start);
      if (PERSON_ACTION_CONTEXT.test(clauseAfter) || PERSON_ACTION_CONTEXT.test(clauseBefore)) {
        score += 0.25;
      }
    }

    // (d) 같은 줄(또는 인접 줄) 정형 개인정보와의 인접성 (명단·대장·표)
    if (isNearStructuredPii(text, c.start, c.baseEnd, otherPiiRanges)) {
      score += 0.2;
    }

    if (score >= 0.4) {
      if ((wordCount.get(c.base) || 0) >= 2) score += 0.05;
      for (const word of c.variants) {
        addResult(c.start, c.start + word.length, score, 'DICTIONARY', c.base);
      }
    } else {
      pendingPropagation.push(c);
    }
  }

  // (e) 문서 내 기확인된 성명의 재출현 전파:
  // 단순 2회 반복("문화국", "사업소")은 성명으로 잡지 않되,
  // 문서의 다른 위치에서 이미 성명으로 확인된 이름이 다시 나오면 함께 탐지한다.
  for (const c of pendingPropagation) {
    if (!confirmedNames.has(c.base)) continue;
    for (const word of c.variants) {
      addResult(c.start, c.start + word.length, 0.45, 'DICTIONARY', c.base);
    }
  }

  return results;
}
