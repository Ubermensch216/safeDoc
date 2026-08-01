// PDF 처리 (기술명세서 Ⅳ-7)
// 원문 텍스트 레이어가 남지 않도록 각 페이지를 이미지로 렌더링한 뒤,
// 개인정보 영역을 불투명 처리하고 그 위에 치환 토큰을 그려 새 PDF를 생성한다.
// (흰 사각형만 덮는 방식은 원문이 내부에 남으므로 사용하지 않는다)

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { tokenFontBytes } from '../assets/tokenFont.js';
import { AppError } from '../core/errors.js';

const MAX_PAGES = 500; // 기술명세서 Ⅺ-3 처리 한도
const RENDER_SCALE = 2; // 페이지 이미지 해상도 배율

// 브라우저에서는 인라인 Worker 사용 (단일 HTML 배포, 기술명세서 Ⅺ-1)
let workerReady = null;
function ensureWorker() {
  if (typeof window === 'undefined') return Promise.resolve(); // Node(시험) 환경은 내장 처리
  if (!workerReady) {
    workerReady = import('pdfjs-dist/legacy/build/pdf.worker.mjs?worker&inline')
      .then(({ default: PdfWorker }) => {
        pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
      });
  }
  return workerReady;
}

// 같은 줄 판정 임계값(pt)
const LINE_Y_TOLERANCE = 2.5;
const WORD_GAP = 1.0;

// 브라우저 글꼴 측정값을 PDF 텍스트 항목 폭에 맞게 정규화한다.
// 측정할 수 없는 환경에서는 null을 반환하고 전체 폭 비례 계산으로 안전하게 폴백한다.
function measureCharOffsets(ctx, text, width, fontH, fontFamily) {
  if (!ctx || !text || text.length > 500 || width <= 0) return null;
  try {
    ctx.font = `${Math.max(fontH, 1)}px "${String(fontFamily || 'sans-serif').replace(/"/g, '')}"`;
    const measured = [0];
    for (let i = 1; i <= text.length; i++) measured.push(ctx.measureText(text.slice(0, i)).width);
    const total = measured[measured.length - 1];
    if (!Number.isFinite(total) || total <= 0) return null;
    return measured.map((v) => (v / total) * width);
  } catch {
    return null;
  }
}

// 세그먼트 일부가 차지하는 시작 거리와 폭을 계산한다.
// charOffsets가 있으면 실제 글자 폭을, 없으면 기존 길이 비례값을 사용한다.
export function sliceGeometry(seg, from, to) {
  const len = seg.str.length || 1;
  const safeFrom = Math.max(0, Math.min(len, from));
  const safeTo = Math.max(safeFrom, Math.min(len, to));
  const offsets = seg.charOffsets;
  if (Array.isArray(offsets) && offsets.length === len + 1) {
    return { offset: offsets[safeFrom], width: offsets[safeTo] - offsets[safeFrom] };
  }
  return {
    offset: seg.width * (safeFrom / len),
    width: seg.width * ((safeTo - safeFrom) / len),
  };
}

export async function parsePdf(buffer, { render = typeof document !== 'undefined' } = {}) {
  await ensureWorker();

  let doc;
  let loadingTask;
  try {
    loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    doc = await loadingTask.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new AppError('E004');
    throw new AppError('E005');
  }

  if (doc.numPages > MAX_PAGES) throw new AppError('E002', `PDF 페이지 수가 한도(${MAX_PAGES}쪽)를 초과했습니다.`);

  const segments = [];
  const pageSizes = [];
  const pageImages = [];
  const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const measureCtx = measureCanvas?.getContext('2d') || null;
  let text = '';

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ width: viewport.width, height: viewport.height });

    const content = await page.getTextContent();
    let prevY = null;
    let prevXEnd = null;
    for (const item of content.items) {
      if (!item.str || item.str.length === 0) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      const fontH = Math.hypot(item.transform[1], item.transform[3]) || item.height || 10;
      const angle = Math.atan2(item.transform[1], item.transform[0]);
      const fontFamily = content.styles?.[item.fontName]?.fontFamily;

      // 세그먼트 구분자: 줄이 바뀌면 줄바꿈, 같은 줄에서 간격이 있으면 공백
      if (text.length > 0) {
        if (prevY === null || Math.abs(y - prevY) > LINE_Y_TOLERANCE) text += '\n';
        else if (x - prevXEnd > WORD_GAP) text += ' ';
      }
      const globalStart = text.length;
      text += item.str;
      segments.push({
        page: p - 1,
        str: item.str,
        x,
        y,
        width: item.width,
        fontH,
        angle,
        charOffsets: measureCharOffsets(measureCtx, item.str, item.width, fontH, fontFamily),
        globalStart,
        globalEnd: text.length,
      });
      prevY = y;
      prevXEnd = x + item.width;
    }

    if (render) {
      // 페이지를 캔버스에 렌더링하여 PNG로 보관 (원문 텍스트 레이어 제거용)
      const canvas = document.createElement('canvas');
      const rv = page.getViewport({ scale: RENDER_SCALE });
      canvas.width = Math.ceil(rv.width);
      canvas.height = Math.ceil(rv.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: rv }).promise;
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      pageImages.push(new Uint8Array(await blob.arrayBuffer()));
      canvas.width = 0; // 메모리 해제
      canvas.height = 0;
    } else {
      pageImages.push(null);
    }
    page.cleanup();
  }
  await loadingTask.destroy();
  if (measureCanvas) {
    measureCanvas.width = 0;
    measureCanvas.height = 0;
  }

  if (text.trim().length === 0) {
    throw new AppError('E006', '텍스트 레이어가 없는 PDF(스캔 문서)는 지원하지 않습니다.');
  }

  return {
    format: 'pdf',
    text,
    segments,
    pageSizes,
    pageImages,
    meta: { pageCount: pageSizes.length, charCount: text.length },
  };
}

// 서브셋 폰트에 없는 글자는 '*'로 대체 (치환 토큰 외 임의 문자 방어)
const TOKEN_CHARS = new Set(
  [...'성명주민번호외국인휴대전화이메일주소계좌카드여권사업자차량생년월일삭제개인정보'],
);
function sanitizeForFont(s) {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    out += (code >= 0x20 && code <= 0x7e) || TOKEN_CHARS.has(ch) ? ch : '*';
  }
  return out;
}

// 적용 내역을 반영한 새 PDF 생성
export async function buildPdfResult(parsed, applied) {
  try {
    const pdfDoc = await PDFDocument.create();
    const sorted = applied.slice().sort((a, b) => a.start - b.start);
    let font = null;
    if (sorted.length > 0) {
      pdfDoc.registerFontkit(fontkit);
      font = await pdfDoc.embedFont(tokenFontBytes(), { subset: true });
    }

    const pages = [];
    for (let i = 0; i < parsed.pageSizes.length; i++) {
      const { width, height } = parsed.pageSizes[i];
      const page = pdfDoc.addPage([width, height]);
      if (parsed.pageImages[i]) {
        const png = await pdfDoc.embedPng(parsed.pageImages[i]);
        page.drawImage(png, { x: 0, y: 0, width, height });
      }
      pages.push(page);
    }

    for (const c of sorted) {
      // 후보와 겹치는 세그먼트별로 원문 영역을 불투명 처리
      const overlapping = parsed.segments.filter(
        (s) => c.start < s.globalEnd && s.globalStart < c.end,
      );
      let first = true;
      for (const seg of overlapping) {
        const page = pages[seg.page];
        const from = Math.max(c.start, seg.globalStart) - seg.globalStart;
        const to = Math.min(c.end, seg.globalEnd) - seg.globalStart;
        const geometry = sliceGeometry(seg, from, to);
        const angle = seg.angle || 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        // 실제 글리프 경계의 안티앨리어싱 픽셀이 남지 않도록 사방에 보수적 여백을 둔다.
        const padX = Math.max(1.5, seg.fontH * 0.12);
        const start = Math.max(0, geometry.offset - padX);
        const rw = Math.min(seg.width - start + padX, geometry.width + padX * 2);
        const bottom = -seg.fontH * 0.35;
        const rx = seg.x + cos * start - sin * bottom;
        const ry = seg.y + sin * start + cos * bottom;
        const rh = seg.fontH * 1.5;

        page.drawRectangle({
          x: rx, y: ry, width: rw, height: rh,
          rotate: degrees((angle * 180) / Math.PI),
          color: rgb(1, 1, 1),
        });

        if (first) {
          // 시작 세그먼트 위치에 치환 토큰 표시 (영역 폭에 맞게 축소)
          const label = sanitizeForFont(c.replacementText);
          let size = seg.fontH * 0.9;
          const labelWidth = font.widthOfTextAtSize(label, size);
          const available = Math.max(rw, 20);
          if (labelWidth > available) size *= available / labelWidth;
          size = Math.max(size, 4);
          const labelX = seg.x + cos * start;
          const labelY = seg.y + sin * start;
          page.drawText(label, {
            x: labelX, y: labelY, size, font,
            rotate: degrees((angle * 180) / Math.PI),
            color: rgb(0.1, 0.1, 0.1),
          });
          first = false;
        }
      }
    }

    const bytes = await pdfDoc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('E008');
  }
}
