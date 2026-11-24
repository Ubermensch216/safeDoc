// 나란히 비교 화면의 동시 스크롤
//
// 처리 후 문서는 치환 문구의 길이가 달라 줄바꿈이 바뀐다. 스크롤 비율만 맞추면
// 아래로 갈수록 같은 문장이 서로 다른 높이에 놓인다. 그래서 양쪽에 같은 순서로 있는
// 강조 항목(<mark>)을 기준점으로 삼아, 기준점 사이를 선형 보간한다.
// 기준점을 만들 수 없으면(개수가 다르거나 없으면) 스크롤 비율로 맞춘다.

// pairs: [[원본 위치, 대상 위치], ...] 원본 위치 오름차순, 첫 항목은 [0, 0]
// value: 원본의 스크롤 위치 → 대상의 스크롤 위치
export function mapScroll(pairs, value) {
  if (pairs.length === 0) return value;
  if (value <= pairs[0][0]) return pairs[0][1];
  const last = pairs[pairs.length - 1];
  if (value >= last[0]) return last[1];

  let lo = 0;
  let hi = pairs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pairs[mid][0] <= value) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = pairs[lo];
  const [x1, y1] = pairs[hi];
  return x1 === x0 ? y0 : y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
}

// 양쪽 위치가 모두 늘어나는 기준점만 남긴다 (역방향 보간이 가능하도록)
export function monotonicPairs(pairs) {
  const out = [];
  for (const [x, y] of pairs) {
    const prev = out[out.length - 1];
    if (!prev || (x > prev[0] && y >= prev[1])) out.push([x, y]);
  }
  return out;
}

const contentTop = (el, box) => el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;

function buildPairs(a, b) {
  const maxA = Math.max(0, a.scrollHeight - a.clientHeight);
  const maxB = Math.max(0, b.scrollHeight - b.clientHeight);
  const marksA = a.querySelectorAll('mark');
  const marksB = b.querySelectorAll('mark');
  const pairs = [[0, 0]];
  if (marksA.length > 0 && marksA.length === marksB.length) {
    marksA.forEach((mark, i) => {
      pairs.push([Math.min(maxA, contentTop(mark, a)), Math.min(maxB, contentTop(marksB[i], b))]);
    });
  }
  pairs.push([maxA, maxB]);
  return monotonicPairs(pairs);
}

const inverse = (pairs) => monotonicPairs(pairs.map(([x, y]) => [y, x]));

// 두 스크롤 영역을 연결한다. 어느 쪽을 굴려도 다른 쪽이 같은 위치로 따라간다.
export function linkScroll(a, b) {
  let ab = null;
  let ba = null;
  let dirty = true;
  const expected = new Map(); // 우리가 설정한 위치 — 그에 따른 scroll 이벤트는 되돌리지 않는다

  const markDirty = () => { dirty = true; };
  new ResizeObserver(markDirty).observe(a);
  new ResizeObserver(markDirty).observe(b);
  const mutations = new MutationObserver(markDirty);
  mutations.observe(a, { childList: true, subtree: true });
  mutations.observe(b, { childList: true, subtree: true });

  const refresh = () => {
    ab = buildPairs(a, b);
    ba = inverse(ab);
    dirty = false;
  };

  const follow = (source, target, direction) => {
    source.addEventListener('scroll', () => {
      if (expected.has(source) && Math.abs(source.scrollTop - expected.get(source)) < 1.5) {
        expected.delete(source);
        return;
      }
      if (dirty) refresh();
      const next = mapScroll(direction(), source.scrollTop);
      if (Math.abs(target.scrollTop - next) < 1) return;
      target.scrollTop = next;
      expected.set(target, target.scrollTop);
    }, { passive: true });
  };

  follow(a, b, () => ab);
  follow(b, a, () => ba);
  return { refresh };
}
