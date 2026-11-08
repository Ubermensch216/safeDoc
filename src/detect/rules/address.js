// 주소 탐지 — 도로명·지번·상세주소 (FR-312, 기술명세서 Ⅴ-6)

import { SIDO_NAMES, ADDRESS_FIELD_KEYWORDS } from '../dictionaries.js';
import { makeCandidate, fieldKeywordScore } from './helpers.js';

// 시·도로 시작하는 주소: 이후 시군구/읍면동/도로명/번지/상세를 탐욕적으로 이어붙임
const SIDO_ALT = SIDO_NAMES
  .slice()
  .sort((a, b) => b.length - a.length)
  .join('|');

// 주소 구성요소가 이어지는 패턴 (줄바꿈을 넘어 다른 행의 숫자·단어를 삼키지 않도록 [ \t]* 사용)
const ADDR_BODY =
  '(?:[ \\t]*[가-힣0-9]+(?:시|군|구|읍|면|동|리|로|길|가))*' + // 행정구역·도로명
  '(?:[ \\t]*지하)?(?:[ \\t]*\\d+(?:-\\d+)?(?:번지|번길|호|층|동|호수)?)*' + // 건물번호·번지
  '(?:[ \\t]*\\(?[가-힣0-9]+(?:동|가|아파트|빌라|타워|오피스텔|빌딩|주공|맨션)\\)?)?' + // 건물명
  '(?:[ \\t]*\\d+동)?(?:[ \\t]*\\d+호)?'; // 동·호수

const FULL_ADDR_REGEX = new RegExp(`(?:${SIDO_ALT})${ADDR_BODY}`, 'g');

// 시·도 없이 도로명으로 시작: "중앙대로 100", "테헤란로 152"
const ROAD_ADDR_REGEX = /[가-힣]{1,10}(?:대로|로|길|번길)[ \t]?\d+(?:-\d+)?(?:번지)?(?:[ \t]*,?[ \t]*\d+동)?(?:[ \t]*\d+호)?/g;

// 개인의 주소가 아닌 단독 지역명·공공장소·시설명 판별 (AI 후처리에서도 재사용)
const PUBLIC_PLACE_ONLY =
  /^(?:광안리|해수욕장|백사장|중점관리지역|관리지역|\d+구역|[가-힣\s]+(?:해수욕장|공원|광장|백사장|공항|항만|역|터미널|시청|구청|군청|도청|국|실|과|본부|사업소))$/;

export function isNonAddressValue(value) {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (SIDO_NAMES.includes(trimmed)) return true;
  if (PUBLIC_PLACE_ONLY.test(trimmed)) return true;
  // 최소한의 구체적 주소 요소(도로명·번지·건물·호수·숫자 또는 시군구+읍면동 2단계 이상 행정구역)가 있어야 함
  const hasSpecificDetail = /(로|길|번지|호|층|아파트|빌라|오피스텔|빌딩|타워|맨션)|\d/.test(trimmed);
  if (!hasSpecificDetail) {
    const adminUnits = trimmed.match(/[가-힣]+(?:시|군|구|읍|면|동|리)(?=\s|$)/g) || [];
    if (adminUnits.length < 2) return true;
  }
  return false;
}

export function detectAddress(text) {
  const results = [];
  const covered = [];

  for (const m of text.matchAll(FULL_ADDR_REGEX)) {
    let raw = m[0].replace(/\s+$/, '');
    // 시·도 명칭만 단독 출현한 경우 제외 (지역 언급일 뿐 주소가 아님)
    const sidoOnly = SIDO_NAMES.some((s) => raw === s);
    if (sidoOnly) continue;
    // 최소한 시군구 또는 도로명 요소가 하나는 있어야 함
    if (!/(시|군|구|읍|면|동|리|로|길)\s|\d/.test(raw.slice(2))) continue;
    const start = m.index;
    const end = start + raw.length;
    let score = 0.5 + 0.2;
    score += fieldKeywordScore(text, start, 'ADDRESS');
    // 번지·건물번호까지 있으면 가점
    if (/\d/.test(raw)) score += 0.15;
    results.push(makeCandidate({
      text, start, end, type: 'ADDRESS', baseScore: Math.min(score, 1), detectionMethod: 'REGEX',
    }));
    covered.push([start, end]);
  }

  // 도로명 시작 주소: 필드명이 인접한 경우에만 인정 (오탐 축소)
  for (const m of text.matchAll(ROAD_ADDR_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    if (covered.some(([s, e]) => start >= s && end <= e)) continue;
    const before = text.slice(Math.max(0, start - 30), start);
    const hasField = ADDRESS_FIELD_KEYWORDS.some((k) => before.includes(k));
    if (!hasField) continue;
    results.push(makeCandidate({
      text, start, end, type: 'ADDRESS', baseScore: 0.75, detectionMethod: 'CONTEXT',
    }));
  }

  return results;
}
