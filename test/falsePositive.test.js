// 오탐 회귀시험 (ANALYSIS.md 2.3, 2.5)
//
// 2.3: 하이픈으로 구분된 10~16자리 숫자열이 문맥 요구 없이 계좌번호가 됐다.
//      주문번호·문서번호·계약번호가 모두 오탐됐고, 기본점수 0.4가 임계값 0.35를
//      그냥 넘겼다. 구분자 없는 경로는 문맥을 요구하는데 하이픈 경로만 공짜였다.
//
// 2.5: 성씨로 시작하는 기관명·복합어("국민은행", "지원금")가 성명으로 탐지됐다.
//      정확도보다 검토 피로도 문제다 — 오탐이 많으면 사용자가 전체 해제를 눌러
//      진짜 개인정보까지 놓친다.
//
// 오탐 제거가 진짜 탐지를 깨지 않는지(재현율 유지)도 같은 파일에서 고정한다.

import { describe, it, expect } from 'vitest';
import { detectAll, resetIdCounter } from '../src/detect/engine.js';

function byType(text, type) {
  resetIdCounter();
  return detectAll(text).filter((c) => c.type === type).map((c) => c.originalText);
}

describe('계좌번호 오탐 (ANALYSIS.md 2.3)', () => {
  it('번호류 필드명이 앞에 오면 계좌번호가 아니다', () => {
    expect(byType('주문번호 2026-0001-000123 접수', 'ACCOUNT_NO')).toHaveLength(0);
    expect(byType('문서번호 2026-1234-5678 로 발송', 'ACCOUNT_NO')).toHaveLength(0);
    expect(byType('계약번호 2026-0417-0099 확인', 'ACCOUNT_NO')).toHaveLength(0);
    expect(byType('접수번호 2026-0417-1234 처리', 'ACCOUNT_NO')).toHaveLength(0);
    expect(byType('전표번호 1234-5678-9012 조회', 'ACCOUNT_NO')).toHaveLength(0);
  });

  it('연도로 시작하는 숫자열은 문맥 없이 계좌번호가 아니다', () => {
    expect(byType('참조: 2026-0001-000123', 'ACCOUNT_NO')).toHaveLength(0);
    expect(byType('결과는 2025-1111-2222 항목 참조', 'ACCOUNT_NO')).toHaveLength(0);
  });

  it('은행명이 인접하면 연도형 숫자열도 계좌번호다', () => {
    // 드물지만 계좌가 20으로 시작할 수 있다 — 문맥이 있으면 인정
    expect(byType('국민은행 2026-0001-000123 입금', 'ACCOUNT_NO')).toContain('2026-0001-000123');
  });

  it('진짜 계좌번호는 계속 탐지된다 (재현율 유지)', () => {
    expect(byType('환불 계좌는 국민은행 123456-78-901234 입니다', 'ACCOUNT_NO')).toContain('123456-78-901234');
    expect(byType('입금계좌: 302-1234-567891', 'ACCOUNT_NO')).toContain('302-1234-567891');
    expect(byType('농협 302-9876-543210', 'ACCOUNT_NO')).toContain('302-9876-543210');
    // 문맥 없는 일반 하이픈 숫자열도 연도형·번호류가 아니면 후보로 유지된다
    expect(byType('송금처 110-345-678901', 'ACCOUNT_NO')).toContain('110-345-678901');
  });
});

describe('사업자등록번호 체크섬 정책 (ANALYSIS.md 2.2)', () => {
  it('검증번호가 틀려도 필드명이 있으면 낮은 신뢰도 후보로 유지된다', () => {
    // 이전에는 통째로 버려져 계좌번호로 오분류되거나 완전 누락됐다.
    // RRN·카드번호와 같은 정책(기술명세서 Ⅴ-4): 체크섬 실패 = 폐기가 아니라 낮은 신뢰도.
    resetIdCounter();
    const found = detectAll('사업자등록번호: 123-45-67890')
      .find((c) => c.originalText === '123-45-67890');
    expect(found).toBeDefined();
    expect(found.type).toBe('BUSINESS_NO');
    expect(found.confidence).toBeLessThan(0.7); // 낮은 신뢰도로 구분
  });

  it('검증번호가 맞으면 높은 신뢰도다', () => {
    resetIdCounter();
    const found = detectAll('사업자등록번호: 104-81-23454')
      .find((c) => c.originalText === '104-81-23454');
    expect(found).toBeDefined();
    expect(found.type).toBe('BUSINESS_NO');
    expect(found.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('필드명 없이 검증번호도 틀리면 후보로 내지 않는다 (오탐 방지)', () => {
    resetIdCounter();
    const found = detectAll('참고 자료 123-45-67890 페이지')
      .filter((c) => c.type === 'BUSINESS_NO');
    expect(found).toHaveLength(0);
  });
});

describe('기관명·복합어 성명 오탐 (ANALYSIS.md 2.5)', () => {
  it('은행명은 성명이 아니다', () => {
    expect(byType('국민은행과 신한은행 계좌만 지원합니다', 'PERSON_NAME')).toHaveLength(0);
    expect(byType('우리은행 지점 안내', 'PERSON_NAME')).toHaveLength(0);
  });

  it('기관명 접미사로 끝나는 단어는 성명이 아니다', () => {
    expect(byType('한국전력공사 및 도로교통공단 협조', 'PERSON_NAME')).toHaveLength(0);
    expect(byType('민원센터 방문 안내', 'PERSON_NAME')).toHaveLength(0);
    expect(byType('서울지점 담당 부서', 'PERSON_NAME')).toHaveLength(0);
    expect(byType('새마을금고 창구', 'PERSON_NAME')).toHaveLength(0);
  });

  it('일반명사 지원금·지시는 성명이 아니다', () => {
    expect(byType('지원금 지급 대장', 'PERSON_NAME')).toHaveLength(0);
    expect(byType('이전 지시를 모두 확인하라', 'PERSON_NAME')).toHaveLength(0);
  });

  it('다른 개인정보가 인접해도 은행명·일반명사는 성명이 아니다', () => {
    // 인접성 가점(+0.15)이 오탐을 임계값 위로 밀어 올리던 사례 (평가 29번 대장)
    const 대장 = '지원금 지급 대장\n1. 김민준 900101-1234567 010-2345-6789 국민은행 123456-78-901234';
    const names = byType(대장, 'PERSON_NAME');
    expect(names).toContain('김민준');
    expect(names).not.toContain('국민은행');
    expect(names).not.toContain('지원금');
  });

  it('진짜 이름은 계속 탐지된다 (재현율 유지)', () => {
    expect(byType('담당: 김서연 주무관', 'PERSON_NAME')).toContain('김서연');
    expect(byType('성명: 은지원', 'PERSON_NAME')).toContain('은지원');
    // "국중현이"는 조사 판단이 애매하므로 더 넓은 범위가 가려진다 (2.1 설계)
    const covered = byType('신청인 국중현이 방문함', 'PERSON_NAME');
    expect(covered.some((v) => v.includes('국중현'))).toBe(true);
  });

  it('행정·안전관리 인력배치 총괄표 문서에서 부서명·행정용어를 성명으로 오탐하지 않는다', () => {
    const 행정총괄표 = [
      '□ 안전관리 인력배치 총괄표 ▷중점관리지역(42개소)',
      '구 분 구 역',
      '인 원 수 부 서 별 배 치 인 원',
      '26년 근 무 부 서',
      '계 총 42개 구역 1,924',
      '광안리',
      '해수욕장',
      '(7구역)',
      '1 백 사 장 18 문화국 소관사업소Ⅰ(18)',
      '2 백 사 장 18 문화국 소관사업소Ⅱ(18)',
      '3 백 사 장 15 관광콘텐츠산업국Ⅰ(15)',
      '4 백 사 장 36 신공항국(12), 해양실 소관 사업소(24)',
      '5 백 사 장 28 해양수도전략실(28), 관광콘텐츠과(4)',
      '6 백 사 장 35 상수도사업본부Ⅰ(35)',
      '7 백 사 장 35 상수도사업본부Ⅱ(35)',
      '소 계 185',
    ].join('\n');

    resetIdCounter();
    const allFound = detectAll(행정총괄표);
    expect(allFound).toHaveLength(0);
  });

  it('부서·진료과·상호·상태어·일반 일자를 개인정보로 오탐하지 않는다', () => {
    const 문서 = [
      '처리부서: 민원지원과',
      '진료과: 소아청소년과',
      '상호: 주식회사 한빛',
      '대리인: 미상 (본인 직접 방문 예정)',
      '보호자 동의 및 대리인 자격으로 위임장 원본을 지참',
      '담당자였던 신동현 님은 자리에 없었고 대신 서지안이 안내해 주었습니다.',
      '최근 접속 일시: 2026-04-17 09:12',
    ].join('\n');

    const names = byType(문서, 'PERSON_NAME');
    expect(names).toContain('신동현');
    expect(names).toContain('서지안');
    for (const nonName of ['민원지원과', '소아청소년과', '주식회사', '미상', '본인', '동의', '자격', '위임장', '였던']) {
      expect(names).not.toContain(nonName);
    }
    expect(byType(문서, 'BIRTH_DATE')).not.toContain('2026-04-17');
  });
});
