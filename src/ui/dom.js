// DOM 공통 도우미

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
export function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

export function showScreen(id) {
  $$('#tab-deidentify .screen').forEach((s) => s.classList.remove('active'));
  const screen = $(`#${id}`);
  screen.classList.add('active');

  const screenMeta = {
    'screen-main': { step: 'prepare', title: '새 비식별 작업' },
    'screen-analyze': { step: 'analyze', title: '자동 분석' },
    'screen-review': { step: 'review', title: '개인정보 검토' },
    'screen-confirm': { step: 'confirm', title: '처리 확인' },
    'screen-result': { step: 'complete', title: '완료' },
  };
  const meta = screenMeta[id];
  if (meta) {
    const order = ['prepare', 'analyze', 'review', 'confirm', 'complete'];
    const current = order.indexOf(meta.step);
    $$('#workflow-steps .step').forEach((item, index) => {
      item.classList.toggle('current', index === current);
      item.classList.toggle('done', index < current);
      if (index === current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    const title = $('#page-title');
    if (title) title.textContent = meta.title;
  }

  const heading = screen.querySelector('h3, h2');
  if (heading) {
    heading.tabIndex = -1;
    requestAnimationFrame(() => heading.focus({ preventScroll: true }));
  }
}

// 컨테이너 내 특정 노드·오프셋의 텍스트 기준 위치 계산 (수동 추가용)
export function textOffsetIn(container, targetNode, offsetInNode) {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + offsetInNode;
    offset += node.textContent.length;
  }
  return -1;
}
