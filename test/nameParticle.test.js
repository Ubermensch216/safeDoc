// 성명 조사 분리 회귀시험 (ANALYSIS.md 2.1)
//
// 결함: 조사 제거 규칙이 조사와 이름의 마지막 음절을 구분하지 못해
//       "최다은" → "최다"만 가려지고 실명의 끝 글자가 결과 문서에 남았다.
//       "성명: [성명_001]은" 은 앞 두 글자만으로도 재식별 위험이 있다.
//
// 반대 방향도 함께 고정한다. 진짜 조사("홍길동에게")까지 가리면
// 문서가 읽히지 않으므로, 이름이 아닌 것이 확실한 조사는 계속 분리해야 한다.

import { describe, it, expect } from 'vitest';
import { detectAll, resetIdCounter } from '../src/detect/engine.js';
import { applyToText } from '../src/core/deidentify.js';
import { WorkSession } from '../src/core/session.js';

function deidentify(text) {
  resetIdCounter();
  const session = new WorkSession();
  // 치환 방식으로 통일해야 결과 문자열을 정확히 대조할 수 있다
  for (const type of Object.keys(session.typePolicies)) session.typePolicies[type] = 'REPLACE';
  session.candidates = detectAll(text);
  return applyToText(text, session.candidates, session).text;
}

function names(text) {
  resetIdCounter();
  return detectAll(text).filter((c) => c.type === 'PERSON_NAME').map((c) => c.originalText);
}

describe('조사와 같은 음절로 끝나는 이름 (ANALYSIS.md 2.1)', () => {
  // "은"으로 끝나는 이름은 매우 흔하다 (다은·지은·서은·하은·예은·시은…)
  const 이름들 = ['최다은', '김지은', '이서은', '박하은', '정예은', '한시은'];

  it.each(이름들)('필드명 뒤의 "%s"을(를) 통째로 탐지한다', (이름) => {
    expect(names(`성명: ${이름}`)).toContain(이름);
  });

  it.each(이름들)('결과 문서에 "%s"의 마지막 음절이 남지 않는다', (이름) => {
    const 결과 = deidentify(`성명: ${이름}`);
    expect(결과).toBe('성명: [성명_001]');
    // 이름의 어떤 음절도 결과에 남아서는 안 된다
    for (const 음절 of 이름) expect(결과).not.toContain(음절);
  });

  it('여러 필드명 표기에서 모두 동작한다', () => {
    for (const 라벨 of ['성명', '이름', '민원인', '신청인', '작성자']) {
      expect(deidentify(`${라벨}: 최다은`)).toBe(`${라벨}: [성명_001]`);
    }
  });

  it('문서 전체에서 실명 음절이 남지 않는다', () => {
    const 결과 = deidentify('성명: 김지은\n연락처: 010-1234-5678\n담당: 이서은');
    expect(결과).not.toMatch(/지은|서은/);
  });
});

describe('진짜 조사는 계속 분리한다', () => {
  it('여러 음절 조사는 이름에서 떼어낸다', () => {
    expect(deidentify('홍길동에게 전달')).toBe('[성명_001]에게 전달');
    expect(deidentify('홍길동께서 확인')).toBe('[성명_001]께서 확인');
  });

  it('이름 끝 음절로 쓰이지 않는 조사는 떼어낸다', () => {
    expect(deidentify('신청인 박서준의 서류')).toBe('신청인 [성명_001]의 서류');
  });

  it('조사를 뗀 결과가 일반명사면 성명으로 보지 않는다', () => {
    // "조치를" → "조치"는 제외어이므로 조사가 붙어도 탐지되면 안 된다
    expect(names('필요한 조치를 취하였다')).toHaveLength(0);
    expect(names('전산 장애 조치가 완료되었다')).toHaveLength(0);
  });
});
