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
    expect(locateAll('가가가가', 0, '가가')).toHaveLength(2);
  });

  it('지나치게 많이 출현하는 값은 흔한 단어로 보고 폐기한다', () => {
    const many = { text: '가나'.repeat(200), base: 0 };
    expect(locateAll(many.text, 0, '가나')).toHaveLength(0);
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
});
