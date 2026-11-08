// 여권번호·사업자등록번호·차량번호·IP주소·생년월일 탐지 (FR-307~310, FR-313)

import { validateBusinessNo, validateDate, validateIPv4 } from '../validators.js';
import { fieldKeywordScore, digitBoundaryPenalty, makeCandidate } from './helpers.js';

// 여권번호: M12345678 등 (구여권 1자리+8자리, 차세대 1자리+3자리+4자리 포함)
const PASSPORT_REGEX = /\b[MSRODT]\d{3}[A-Z]?\d{4,5}\b/g;

// 사업자등록번호: 000-00-00000
const BUSINESS_REGEX = /\d{3}-\d{2}-\d{5}/g;

// 차량번호: 12가3456, 123가4567, 서울12가3456 (지역 접두는 실제 시·도 약칭만 허용)
const VEHICLE_REGEX = /(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s?)?\d{2,3}[가-힣]\s?\d{4}(?![\d])/g;

// IPv4 / IPv6
const IPV4_REGEX = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const IPV6_REGEX = /\b(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}\b/g;

// 생년월일: 1990-01-01, 1990.01.01, 1990년 1월 1일 등
// 두 자리 월·일을 먼저 배치하고 뒤쪽 숫자 경계(?!\d)를 확인해야 "1990-03-15"가 "1990-03-1"로 잘리지 않는다.
const BIRTH_REGEX = /(?<!\d)(19\d{2}|20[0-2]\d)[.\-\/년\s]\s?(1[0-2]|0?[1-9])[.\-\/월\s]\s?(3[01]|[12]\d|0?[1-9])일?(?!\d)/g;

// 생년월일이 아닌 일반 업무·로그 일자 라벨 ("접속 일시: 2026-04-17", "시행일: 2026.03.01" 등)
const NON_BIRTH_DATE_LABEL =
  /(?:(접속|작성|시행|접수|등록|발급|만료|점검|회의|계약|결제|입금|출금|방문|입사|퇴사|처리|발송|수신|개최|마감|공고|고시|기준)\s*(일시|일자|일|날짜)?|일시)\s*[:：=]?\s*$/;

export function isNonBirthDateContext(text, start, end) {
  const before = text.slice(Math.max(0, start - 20), start);
  if (NON_BIRTH_DATE_LABEL.test(before)) return true;
  // 뒤에 시각(" 09:12")이 이어지면 타임스탬프이지 생년월일이 아니다
  const after = text.slice(end, Math.min(text.length, end + 10));
  if (/^\s+\d{1,2}:\d{2}/.test(after)) return true;
  return false;
}

const VEHICLE_USE_CHARS = '가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주하허호배';

export function detectPassport(text) {
  const results = [];
  for (const m of text.matchAll(PASSPORT_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    const digits = m[0].replace(/[^0-9]/g, '');
    if (digits.length < 8 || digits.length > 8) continue;
    let score = 0.45 + fieldKeywordScore(text, start, 'PASSPORT_NO') * 3;
    if (score < 0.45) score = 0.45;
    results.push(makeCandidate({ text, start, end, type: 'PASSPORT_NO', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  return results;
}

export function detectBusinessNo(text) {
  const results = [];
  for (const m of text.matchAll(BUSINESS_REGEX)) {
    const digits = m[0].replace(/-/g, '');
    const v = validateBusinessNo(digits);
    if (!v.valid) continue;
    const start = m.index;
    const end = start + m[0].length;
    const fieldScore = fieldKeywordScore(text, start, 'BUSINESS_NO');
    // 체크섬 실패 시 필드명 문맥이 있을 때만 낮은 신뢰도 후보로 유지 (ANALYSIS 2.2)
    // — 문맥까지 없으면 일반 하이픈 숫자열과 구분할 수 없어 오탐이 된다.
    if (!v.checksumOk && fieldScore === 0) continue;
    let score = v.checksumOk ? 0.5 + 0.35 : 0.45;
    score += fieldScore;
    score -= digitBoundaryPenalty(text, start, end);
    results.push(makeCandidate({ text, start, end, type: 'BUSINESS_NO', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  return results;
}

export function detectVehicle(text) {
  const results = [];
  for (const m of text.matchAll(VEHICLE_REGEX)) {
    const raw = m[0];
    // 용도기호가 실제 차량용 한글인지 확인 (오탐 축소)
    const useChar = raw.match(/\d{2,3}([가-힣])/);
    if (!useChar || !VEHICLE_USE_CHARS.includes(useChar[1])) continue;
    const start = m.index;
    const end = start + raw.length;
    let score = 0.5 + 0.2;
    score += fieldKeywordScore(text, start, 'VEHICLE_NO');
    score -= digitBoundaryPenalty(text, start, end);
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'VEHICLE_NO', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  return results;
}

export function detectIP(text) {
  const results = [];
  for (const m of text.matchAll(IPV4_REGEX)) {
    if (!validateIPv4(m[0])) continue;
    const start = m.index;
    const end = start + m[0].length;
    // 버전 번호(1.0.0.1 등) 오탐 축소: 각 옥텟이 모두 한 자리면 감점
    let score = 0.45 + 0.25;
    if (m[0].split('.').every((p) => p.length === 1)) score -= 0.25;
    score += fieldKeywordScore(text, start, 'IP_ADDRESS');
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'IP_ADDRESS', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  for (const m of text.matchAll(IPV6_REGEX)) {
    if (!m[0].includes(':') || m[0].split(':').length < 4) continue;
    const start = m.index;
    const end = start + m[0].length;
    results.push(makeCandidate({ text, start, end, type: 'IP_ADDRESS', baseScore: 0.7, detectionMethod: 'REGEX' }));
  }
  return results;
}

export function detectBirthDate(text) {
  const results = [];
  for (const m of text.matchAll(BIRTH_REGEX)) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!validateDate(y, mo, d)) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (isNonBirthDateContext(text, start, end)) continue;
    // 날짜는 일반 문서에 흔하므로 생년월일 필드명(인접 또는 표 헤더) 문맥이 있을 때만 후보로 선별 (FR-313)
    const fieldScore = fieldKeywordScore(text, start, 'BIRTH_DATE', 35);
    const headerScore = fieldScore === 0 ? fieldKeywordScore(text, start, 'BIRTH_DATE', 300) : 0;
    if (fieldScore === 0 && headerScore === 0) continue;
    const score = fieldScore > 0 ? 0.5 + fieldScore * 3 : 0.75;
    results.push(makeCandidate({
      text, start, end, type: 'BIRTH_DATE', baseScore: Math.min(score, 1),
      detectionMethod: 'CONTEXT',
    }));
  }
  return results;
}
