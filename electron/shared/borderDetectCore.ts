/** Border-detection math for desktop centering (card outer + print inner edges). */

export interface BorderGuidePositions {
  outerTop: number;
  outerBottom: number;
  outerLeft: number;
  outerRight: number;
  innerTop: number;
  innerBottom: number;
  innerLeft: number;
  innerRight: number;
}

export type BorderDetectSide = 'front' | 'back';

const CARD_ASPECT = 5 / 7;

export function bitmapToGrayscale(bitmap: Buffer, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[y * w + x] = Math.round(0.299 * bitmap[i + 2] + 0.587 * bitmap[i + 1] + 0.114 * bitmap[i]);
    }
  }
  return out;
}

/** Trim uniform Cropper letterbox (#f1f5f9-ish gray margins). */
export function trimLetterbox(
  gray: Uint8Array,
  w: number,
  h: number
): { gray: Uint8Array; w: number; h: number; ox: number; oy: number } {
  const isMargin = (x: number, y: number): boolean => {
    const g = gray[y * w + x];
    return g >= 228 && g <= 252;
  };

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  outer: for (; top < h; top++) {
    for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 80))) {
      if (!isMargin(x, top)) break outer;
    }
  }
  outer: for (; bottom > top; bottom--) {
    for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 80))) {
      if (!isMargin(x, bottom)) break outer;
    }
  }
  outer: for (; left < w; left++) {
    for (let y = top; y <= bottom; y += Math.max(1, Math.floor(h / 80))) {
      if (!isMargin(left, y)) break outer;
    }
  }
  outer: for (; right > left; right--) {
    for (let y = top; y <= bottom; y += Math.max(1, Math.floor(h / 80))) {
      if (!isMargin(right, y)) break outer;
    }
  }

  const tw = Math.max(40, right - left + 1);
  const th = Math.max(40, bottom - top + 1);
  if (tw >= w * 0.92 && th >= h * 0.92) {
    return { gray, w, h, ox: 0, oy: 0 };
  }

  const trimmed = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      trimmed[y * tw + x] = gray[(top + y) * w + (left + x)];
    }
  }
  return { gray: trimmed, w: tw, h: th, ox: left, oy: top };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function rowMean(gray: Uint8Array, w: number, y: number, x0: number, x1: number): number {
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor((x1 - x0) / 80));
  for (let x = x0; x < x1; x += step) {
    sum += gray[y * w + x];
    n++;
  }
  return n ? sum / n : 0;
}

function colMean(gray: Uint8Array, w: number, h: number, x: number, y0: number, y1: number): number {
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor((y1 - y0) / 80));
  for (let y = y0; y < y1; y += step) {
    sum += gray[y * w + x];
    n++;
  }
  return n ? sum / n : 0;
}

/** Vertical gradient strength at row y (for horizontal edges). */
function horizontalEdgeScore(gray: Uint8Array, w: number, h: number, y: number): number {
  if (y < 1 || y >= h - 1) return 0;
  const x0 = Math.floor(w * 0.08);
  const x1 = Math.floor(w * 0.92);
  const step = Math.max(1, Math.floor((x1 - x0) / 120));
  let sum = 0;
  let hits = 0;
  let strong = 0;
  for (let x = x0; x < x1; x += step) {
    const g = Math.abs(gray[y * w + x] - gray[(y + 1) * w + x]);
    sum += g;
    hits++;
    if (g >= 18) strong++;
  }
  if (!hits) return 0;
  const coverage = strong / hits;
  return (sum / hits) * (0.35 + coverage * 0.65);
}

/** Horizontal gradient strength at column x (for vertical edges). */
function verticalEdgeScore(gray: Uint8Array, w: number, h: number, x: number): number {
  if (x < 1 || x >= w - 1) return 0;
  const y0 = Math.floor(h * 0.08);
  const y1 = Math.floor(h * 0.92);
  const step = Math.max(1, Math.floor((y1 - y0) / 120));
  let sum = 0;
  let hits = 0;
  let strong = 0;
  for (let y = y0; y < y1; y += step) {
    const g = Math.abs(gray[y * w + x] - gray[y * w + x + 1]);
    sum += g;
    hits++;
    if (g >= 18) strong++;
  }
  if (!hits) return 0;
  const coverage = strong / hits;
  return (sum / hits) * (0.35 + coverage * 0.65);
}

function scanHorizontalEdge(
  gray: Uint8Array,
  w: number,
  h: number,
  from: 'top' | 'bottom'
): number {
  const band = Math.max(12, Math.floor(h * 0.12));
  const start = from === 'top' ? 1 : h - 2;
  const end = from === 'top' ? Math.min(h - 2, band) : Math.max(1, h - band);
  const step = from === 'top' ? 1 : -1;

  const marginMean =
    from === 'top'
      ? rowMean(gray, w, 0, Math.floor(w * 0.2), Math.floor(w * 0.8))
      : rowMean(gray, w, h - 1, Math.floor(w * 0.2), Math.floor(w * 0.8));

  let best = from === 'top' ? 2 : h - 3;
  let bestScore = 0;

  for (let y = start; from === 'top' ? y <= end : y >= end; y += step) {
    const edge = horizontalEdgeScore(gray, w, h, y);
    const interior = rowMean(gray, w, clamp(y + (from === 'top' ? 3 : -3), 0, h - 1), Math.floor(w * 0.15), Math.floor(w * 0.85));
    const delta = Math.abs(interior - marginMean);
    const score = edge + delta * 0.45;
    if (score > bestScore) {
      bestScore = score;
      best = y;
    }
    if (edge >= 22 && delta >= 8 && y > (from === 'top' ? 2 : 0)) break;
  }
  return best;
}

function scanVerticalEdge(gray: Uint8Array, w: number, h: number, from: 'left' | 'right'): number {
  const band = Math.max(12, Math.floor(w * 0.12));
  const start = from === 'left' ? 1 : w - 2;
  const end = from === 'left' ? Math.min(w - 2, band) : Math.max(1, w - band);
  const step = from === 'left' ? 1 : -1;

  const marginMean =
    from === 'left'
      ? colMean(gray, w, h, 0, Math.floor(h * 0.2), Math.floor(h * 0.8))
      : colMean(gray, w, h, w - 1, Math.floor(h * 0.2), Math.floor(h * 0.8));

  let best = from === 'left' ? 2 : w - 3;
  let bestScore = 0;

  for (let x = start; from === 'left' ? x <= end : x >= end; x += step) {
    const edge = verticalEdgeScore(gray, w, h, x);
    const interior = colMean(
      gray,
      w,
      h,
      clamp(x + (from === 'left' ? 3 : -3), 0, w - 1),
      Math.floor(h * 0.15),
      Math.floor(h * 0.85)
    );
    const delta = Math.abs(interior - marginMean);
    const score = edge + delta * 0.45;
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
    if (edge >= 22 && delta >= 8) break;
  }
  return best;
}

function refineRectToAspect(
  top: number,
  bottom: number,
  left: number,
  right: number,
  w: number,
  h: number
): { top: number; bottom: number; left: number; right: number } {
  const rw = right - left;
  const rh = bottom - top;
  if (rw <= 0 || rh <= 0) return { top, bottom, left, right };

  const currentAspect = rw / rh;
  const targetAspect = CARD_ASPECT * (h / w);
  if (Math.abs(currentAspect - targetAspect) / targetAspect < 0.06) {
    return { top, bottom, left, right };
  }

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  let newW = rw;
  let newH = rh;
  if (currentAspect > targetAspect) {
    newH = rw / targetAspect;
  } else {
    newW = rh * targetAspect;
  }

  let nLeft = cx - newW / 2;
  let nRight = cx + newW / 2;
  let nTop = cy - newH / 2;
  let nBottom = cy + newH / 2;

  if (nLeft < 1) {
    nRight -= nLeft - 1;
    nLeft = 1;
  }
  if (nRight > w - 2) {
    nLeft -= nRight - (w - 2);
    nRight = w - 2;
  }
  if (nTop < 1) {
    nBottom -= nTop - 1;
    nTop = 1;
  }
  if (nBottom > h - 2) {
    nTop -= nBottom - (h - 2);
    nBottom = h - 2;
  }

  return {
    top: Math.round(nTop),
    bottom: Math.round(nBottom),
    left: Math.round(nLeft),
    right: Math.round(nRight),
  };
}

function findInnerHorizontalEdge(
  gray: Uint8Array,
  w: number,
  h: number,
  outerPx: number,
  dir: 'down' | 'up'
): number {
  const cardSpan = dir === 'down' ? h - outerPx : outerPx;
  const band = Math.max(6, Math.min(Math.floor(cardSpan * 0.14), Math.floor(h * 0.12)));
  const start = dir === 'down' ? outerPx + 2 : outerPx - 2;
  const end = dir === 'down' ? Math.min(h - 3, outerPx + band) : Math.max(2, outerPx - band);
  const step = dir === 'down' ? 1 : -1;

  const x0 = Math.floor(w * 0.12);
  const x1 = Math.floor(w * 0.88);
  const colStep = Math.max(1, Math.floor((x1 - x0) / 100));

  let best = dir === 'down' ? outerPx + Math.floor(h * 0.035) : outerPx - Math.floor(h * 0.035);
  let bestScore = 0;
  let firstStrong = -1;

  for (let y = start; dir === 'down' ? y <= end : y >= end; y += step) {
    let sum = 0;
    let hits = 0;
    let strong = 0;
    for (let x = x0; x < x1; x += colStep) {
      const g = Math.abs(gray[y * w + x] - gray[(y + step) * w + x]);
      sum += g;
      hits++;
      if (g >= 14) strong++;
    }
    if (!hits) continue;
    const coverage = strong / hits;
    const score = (sum / hits) * (0.25 + coverage * 0.75);
    if (score >= 16 && coverage >= 0.35 && firstStrong < 0) firstStrong = y;
    if (score > bestScore) {
      bestScore = score;
      best = y;
    }
  }

  if (firstStrong >= 0) {
    const outerDistBest = Math.abs(best - outerPx);
    const outerDistFirst = Math.abs(firstStrong - outerPx);
    if (Math.abs(best - firstStrong) <= 5) return firstStrong;
    if (outerDistFirst < outerDistBest * 0.9) return firstStrong;
  }
  return best;
}

function findInnerVerticalEdge(
  gray: Uint8Array,
  w: number,
  h: number,
  outerPx: number,
  dir: 'right' | 'left'
): number {
  const cardSpan = dir === 'right' ? w - outerPx : outerPx;
  const band = Math.max(6, Math.min(Math.floor(cardSpan * 0.14), Math.floor(w * 0.12)));
  const start = dir === 'right' ? outerPx + 2 : outerPx - 2;
  const end = dir === 'right' ? Math.min(w - 3, outerPx + band) : Math.max(2, outerPx - band);
  const step = dir === 'right' ? 1 : -1;

  const y0 = Math.floor(h * 0.12);
  const y1 = Math.floor(h * 0.88);
  const rowStep = Math.max(1, Math.floor((y1 - y0) / 100));

  let best = dir === 'right' ? outerPx + Math.floor(w * 0.035) : outerPx - Math.floor(w * 0.035);
  let bestScore = 0;
  let firstStrong = -1;

  for (let x = start; dir === 'right' ? x <= end : x >= end; x += step) {
    let sum = 0;
    let hits = 0;
    let strong = 0;
    for (let y = y0; y < y1; y += rowStep) {
      const g = Math.abs(gray[y * w + x] - gray[y * w + x + step]);
      sum += g;
      hits++;
      if (g >= 14) strong++;
    }
    if (!hits) continue;
    const coverage = strong / hits;
    const score = (sum / hits) * (0.25 + coverage * 0.75);
    if (score >= 16 && coverage >= 0.35 && firstStrong < 0) firstStrong = x;
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
  }

  if (firstStrong >= 0) {
    const outerDistBest = Math.abs(best - outerPx);
    const outerDistFirst = Math.abs(firstStrong - outerPx);
    if (Math.abs(best - firstStrong) <= 5) return firstStrong;
    if (outerDistFirst < outerDistBest * 0.9) return firstStrong;
  }
  return best;
}

export function validateGuideOrdering(g: BorderGuidePositions): BorderGuidePositions {
  let {
    outerTop,
    outerBottom,
    outerLeft,
    outerRight,
    innerTop,
    innerBottom,
    innerLeft,
    innerRight,
  } = g;

  outerTop = clamp(outerTop, 0.5, 45);
  outerBottom = clamp(outerBottom, 55, 99.5);
  outerLeft = clamp(outerLeft, 0.5, 45);
  outerRight = clamp(outerRight, 55, 99.5);

  if (outerLeft >= outerRight - 10) {
    outerLeft = 8;
    outerRight = 92;
  }
  if (outerTop >= outerBottom - 10) {
    outerTop = 8;
    outerBottom = 92;
  }

  innerLeft = clamp(innerLeft, outerLeft + 1, outerRight - 4);
  innerRight = clamp(innerRight, innerLeft + 2, outerRight - 1);
  innerTop = clamp(innerTop, outerTop + 1, outerBottom - 4);
  innerBottom = clamp(innerBottom, innerTop + 2, outerBottom - 1);

  return {
    outerTop,
    outerBottom,
    outerLeft,
    outerRight,
    innerTop,
    innerBottom,
    innerLeft,
    innerRight,
  };
}

export function defaultGuides(): BorderGuidePositions {
  return validateGuideOrdering({
    outerTop: 8,
    outerBottom: 92,
    outerLeft: 12,
    outerRight: 88,
    innerTop: 14,
    innerBottom: 86,
    innerLeft: 18,
    innerRight: 82,
  });
}

export function detectBordersFromGrayscale(
  fullGray: Uint8Array,
  w: number,
  h: number,
  _side: BorderDetectSide = 'front'
): BorderGuidePositions | null {
  const { gray, w: tw, h: th, ox, oy } = trimLetterbox(fullGray, w, h);

  let outerTopPx = scanHorizontalEdge(gray, tw, th, 'top');
  let outerBottomPx = scanHorizontalEdge(gray, tw, th, 'bottom');
  let outerLeftPx = scanVerticalEdge(gray, tw, th, 'left');
  let outerRightPx = scanVerticalEdge(gray, tw, th, 'right');

  const refined = refineRectToAspect(outerTopPx, outerBottomPx, outerLeftPx, outerRightPx, tw, th);
  outerTopPx = refined.top;
  outerBottomPx = refined.bottom;
  outerLeftPx = refined.left;
  outerRightPx = refined.right;

  const innerTopPx = findInnerHorizontalEdge(gray, tw, th, outerTopPx, 'down');
  const innerBottomPx = findInnerHorizontalEdge(gray, tw, th, outerBottomPx, 'up');
  const innerLeftPx = findInnerVerticalEdge(gray, tw, th, outerLeftPx, 'right');
  const innerRightPx = findInnerVerticalEdge(gray, tw, th, outerRightPx, 'left');

  const toGlobalX = (x: number) => ((ox + x) / w) * 100;
  const toGlobalY = (y: number) => ((oy + y) / h) * 100;

  return validateGuideOrdering({
    outerTop: toGlobalY(outerTopPx),
    outerBottom: toGlobalY(outerBottomPx),
    outerLeft: toGlobalX(outerLeftPx),
    outerRight: toGlobalX(outerRightPx),
    innerTop: toGlobalY(innerTopPx),
    innerBottom: toGlobalY(innerBottomPx),
    innerLeft: toGlobalX(innerLeftPx),
    innerRight: toGlobalX(innerRightPx),
  });
}
