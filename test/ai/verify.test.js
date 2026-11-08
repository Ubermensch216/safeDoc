import { describe, it, expect } from 'vitest';
import { verifyItems, collectDisputed, locateAll } from '../../src/ai/verify.js';

const chunk = { text: '담당자 홍길동, 예금주 최다은. 홍길동 재등장.', base: 1000 };

describe('AI 응답 검증 — 환각 폐기', () => {
  it('문서에 없는 값은 폐기하고 건수를 기록한다', () => {
    const r = verifyItems([{ value: '박문수', type: 'PERSON_NAME', reason: '지어냄' }], chunk);
    expect(r.candidates).toHaveLength(0);
    expect(r.rejected).toBe(1);
  });

  it('1글자 값은 오탐 위험이 커서 폐기한다', () => {
    const r = verifyItems([{ value: '홍', type: 'PERSON_NAME', reason: 'x' }], chunk);
    expect(r.candidates).toHaveLength(0);
    expect(r.rejected).toBe(1);
  });

  it('값이 문자열이 아니면 폐기한다', () => {
    const r = verifyItems([{ value: 12345, type: 'PERSON_NAME' }, {}], chunk);
    expect(r.candidates).toHaveLength(0);
    expect(r.rejected).toBe(2);
  });

  it('알 수 없는 유형 코드는 CUSTOM으로 대체한다', () => {
    const r = verifyItems([{ value: '최다은', type: '존재하지않는유형', reason: 'x' }], chunk);
    expect(r.candidates[0].type).toBe('CUSTOM');
  });
});

describe('AI 응답 검증 — 오프셋 복원', () => {
  it('여러 번 나오는 값은 모든 위치를 후보로 만든다', () => {
    const r = verifyItems([{ value: '홍길동', type: 'PERSON_NAME', reason: '담당자' }], chunk);
    expect(r.candidates).toHaveLength(2);
  });

  it('복원한 오프셋이 실제 원문 위치와 일치한다', () => {
    const r = verifyItems([{ value: '최다은', type: 'PERSON_NAME', reason: '예금주' }], chunk);
    const c = r.candidates[0];
    expect(chunk.text.slice(c.start - chunk.base, c.end - chunk.base)).toBe('최다은');
  });

  it('전역 오프셋에 청크 base가 반영된다', () => {
    const r = verifyItems([{ value: '최다은', type: 'PERSON_NAME', reason: 'x' }], chunk);
    expect(r.candidates[0].start).toBe(chunk.base + chunk.text.indexOf('최다은'));
  });

  it('근거 문구가 너무 길면 잘라낸다', () => {
    const r = verifyItems([{ value: '홍길동', type: 'PERSON_NAME', reason: '가'.repeat(200) }], chunk);
    expect(r.candidates[0].aiReason.length).toBeLessThanOrEqual(41);
  });

  it('locateAll은 겹치지 않게 전진한다', () => {
    const r = locateAll('가가가가', 0, '가가');
    expect(r.positions).toHaveLength(2);
    expect(r.overflow).toBe(false);
  });

  // ANALYSIS 2.9: 출현 상한 초과를 "환각"으로 집계하면 감사 기록이 사실과 달라진다.
  // 명단·대장에서 같은 이름이 51번 나오는 것은 환각이 아니라 흔한 값이다.
  it('출현 상한 초과는 환각이 아니라 초과(overflow)로 구분한다', () => {
    const many = { text: '가나 '.repeat(200), base: 0 };
    const r = locateAll(many.text, 0, '가나');
    expect(r.positions).toHaveLength(0);
    expect(r.overflow).toBe(true);
  });

  it('출현 상한 초과 값은 환각 건수가 아니라 별도 건수로 기록된다', () => {
    const many = { text: '홍길동 '.repeat(60), base: 0 };
    const r = verifyItems([{ value: '홍길동', type: 'PERSON_NAME', reason: 'x' }], many);
    expect(r.candidates).toHaveLength(0);
    expect(r.rejected).toBe(0); // 환각 아님
    expect(r.skippedCommon).toBe(1); // 규칙 탐지가 잡아주는 흔한 값으로 분류
  });
});

describe('오탐 판정 수집', () => {
  const asked = ['홍길동', '최다은'];

  it('isPersonalInfo=false인 것만 오탐으로 본다', () => {
    const out = collectDisputed([
      { value: '홍길동', isPersonalInfo: false, reason: '일반명사' },
      { value: '최다은', isPersonalInfo: true, reason: '사람 이름' },
    ], asked, chunk);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('홍길동');
  });

  it('판정이 누락되면 개인정보로 간주한다 (놓치는 쪽이 더 위험하다)', () => {
    const out = collectDisputed([{ value: '홍길동', reason: '판정 없음' }], asked, chunk);
    expect(out).toHaveLength(0);
  });

  it('물어보지 않은 값에 대한 판정은 무시한다', () => {
    const out = collectDisputed(
      [{ value: '재등장', isPersonalInfo: false, reason: 'x' }], asked, chunk,
    );
    expect(out).toHaveLength(0);
  });

  it('문서에 없는 값은 무시한다', () => {
    const out = collectDisputed(
      [{ value: '홍길동', isPersonalInfo: false, reason: 'x' }], ['홍길동'],
      { text: '다른 내용', base: 0 },
    );
    expect(out).toHaveLength(0);
  });

  it('근거 문구(reason)가 개인정보임을 긍정하는데 isPersonalInfo=false로 뒤집힌 자기모순 판정은 무시한다', () => {
    const c = { text: '환불 계좌: 국민은행 123456-78-901234', base: 0 };
    const out = collectDisputed(
      [{ value: '123456-78-901234', isPersonalInfo: false, reason: '계좌번호로 판단됨' }],
      ['123456-78-901234'],
      c,
    );
    expect(out).toHaveLength(0);
  });
});

describe('AI 응답 검증 — 문맥 기반 비개인정보(오탐) 배제', () => {
  it('부서명·행정용어·기관명을 AI가 PERSON_NAME으로 반환해도 폐기한다', () => {
    const adminChunk = {
      text: '□ 안전관리 인력배치 총괄표\n1 백 사 장 18 문화국 소관사업소Ⅰ(18)\n4 백 사 장 36 신공항국(12), 해양실 소관 사업소(24)\n처리부서: 민원지원과',
      base: 0,
    };
    const r = verifyItems([
      { value: '안전관리', type: 'PERSON_NAME', reason: '이름 오인' },
      { value: '인력배치', type: 'PERSON_NAME', reason: '이름 오인' },
      { value: '문화국', type: 'PERSON_NAME', reason: '이름 오인' },
      { value: '신공항국', type: 'PERSON_NAME', reason: '이름 오인' },
      { value: '사업소', type: 'PERSON_NAME', reason: '이름 오인' },
      { value: '민원지원과', type: 'PERSON_NAME', reason: '이름 오인' },
    ], adminChunk);
    expect(r.candidates).toHaveLength(0);
    expect(r.rejected).toBe(6);
  });

  it('단독 광역·기초 지자체명이나 관광지명은 ADDRESS에서 배제하고 구체적 주소만 수락한다', () => {
    const addrChunk = {
      text: '강원도 지역 민원 및 광안리 해수욕장 안내. 거주지: 서울특별시 종로구 세종대로 209',
      base: 0,
    };
    const r = verifyItems([
      { value: '강원도', type: 'ADDRESS', reason: '지역명' },
      { value: '광안리 해수욕장', type: 'ADDRESS', reason: '장소명' },
      { value: '서울특별시 종로구 세종대로 209', type: 'ADDRESS', reason: '거주지 주소' },
    ], addrChunk);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].originalText).toBe('서울특별시 종로구 세종대로 209');
  });

  it('일반 업무 일자·타임스탬프와 문서·주문번호는 생년월일·계좌번호에서 배제한다', () => {
    const docChunk = {
      text: '최근 접속 일시: 2026-04-17 09:12\n주문번호 2026-0001-000123 접수',
      base: 0,
    };
    const r = verifyItems([
      { value: '2026-04-17', type: 'BIRTH_DATE', reason: '날짜' },
      { value: '2026-0001-000123', type: 'ACCOUNT_NO', reason: '번호' },
    ], docChunk);
    expect(r.candidates).toHaveLength(0);
    expect(r.rejected).toBe(2);
  });

  it('한글 어절 내부의 부분 문자열 매칭은 폐기하고, 호칭·서술어가 붙은 성명은 본체만 정규화한다', () => {
    const narrativeChunk = {
      text: '예금주는 최다은이다. 이후 박서준 씨가 방문하여 안전관리 안내를 받았다.',
      base: 0,
    };
    const r = verifyItems([
      { value: '최다은이다', type: 'PERSON_NAME', reason: '예금주' },
      { value: '박서준 씨', type: 'PERSON_NAME', reason: '방문자' },
      { value: '안전', type: 'PERSON_NAME', reason: '안전관리의 일부' },
    ], narrativeChunk);
    const texts = r.candidates.map((c) => c.originalText);
    expect(texts).toContain('최다은');
    expect(texts).toContain('박서준');
    expect(texts).not.toContain('안전');
  });
});
