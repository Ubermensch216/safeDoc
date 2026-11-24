import { describe, expect, it } from 'vitest';
import { mapScroll, monotonicPairs } from '../src/ui/syncScroll.js';

describe('나란히 비교 동시 스크롤', () => {
  // 처리 전 0~1000, 처리 후 0~800 (줄바꿈이 줄어든 경우). 가운데 기준점은 400 ↔ 300.
  const pairs = [[0, 0], [400, 300], [1000, 800]];

  it('기준점에서는 정확히 같은 위치로 맞춘다', () => {
    expect(mapScroll(pairs, 0)).toBe(0);
    expect(mapScroll(pairs, 400)).toBe(300);
    expect(mapScroll(pairs, 1000)).toBe(800);
  });

  it('기준점 사이는 선형으로 보간한다', () => {
    expect(mapScroll(pairs, 200)).toBe(150);
    expect(mapScroll(pairs, 700)).toBe(550);
  });

  it('범위를 벗어난 값은 양 끝으로 고정한다', () => {
    expect(mapScroll(pairs, -50)).toBe(0);
    expect(mapScroll(pairs, 5000)).toBe(800);
  });

  it('반대 방향으로도 같은 기준점을 지난다', () => {
    const reverse = monotonicPairs(pairs.map(([x, y]) => [y, x]));
    expect(mapScroll(reverse, 300)).toBe(400);
    expect(mapScroll(reverse, 550)).toBe(700);
  });

  it('단조 증가하지 않는 기준점은 버린다', () => {
    expect(monotonicPairs([[0, 0], [100, 50], [100, 60], [90, 70], [200, 40], [300, 80]]))
      .toEqual([[0, 0], [100, 50], [300, 80]]);
  });

  it('기준점이 하나뿐이면 끝점 사이를 비율로 맞춘다', () => {
    expect(mapScroll([[0, 0], [1000, 500]], 600)).toBe(300);
  });

  it('기준점이 없으면 값을 그대로 쓴다', () => {
    expect(mapScroll([], 120)).toBe(120);
  });
});
