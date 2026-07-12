// DOM 공통 도우미

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  $(`#${id}`).classList.add('active');
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
