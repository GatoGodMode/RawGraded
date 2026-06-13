export type LightingIssue =
  | 'too_dark'
  | 'too_bright'
  | 'blown_highlights'
  | 'crushed_shadows'
  | 'low_contrast'
  | 'uneven'
  | 'glare';

export type LightingQuality = {
  score: number;
  status: 'ok' | 'warn' | 'poor';
  issues: LightingIssue[];
  message: string;
  accuracyWarning?: string;
};

export type NormalizedRoi = { x: number; y: number; w: number; h: number };

const ACCURACY_WARNING =
  'Lighting is suboptimal — you can continue, but grading and defect detection may be less accurate.';

function defaultCenterRoi(): NormalizedRoi {
  return { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
}

function roiPixels(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  roi: NormalizedRoi
): { lum: number[]; r: number[]; g: number[]; b: number[] } {
  const x0 = Math.max(0, Math.floor(roi.x * w));
  const y0 = Math.max(0, Math.floor(roi.y * h));
  const x1 = Math.min(w, Math.ceil((roi.x + roi.w) * w));
  const y1 = Math.min(h, Math.ceil((roi.y + roi.h) * h));
  const lum: number[] = [];
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * 4;
      const rv = data[i];
      const gv = data[i + 1];
      const bv = data[i + 2];
      r.push(rv);
      g.push(gv);
      b.push(bv);
      lum.push(Math.round(0.299 * rv + 0.587 * gv + 0.114 * bv));
    }
  }
  return { lum, r, g, b };
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

function fractionBelow(arr: number[], threshold: number): number {
  if (!arr.length) return 0;
  return arr.filter((v) => v < threshold).length / arr.length;
}

function fractionAbove(arr: number[], threshold: number): number {
  if (!arr.length) return 0;
  return arr.filter((v) => v > threshold).length / arr.length;
}

function quadrantMeans(lum: number[], roiW: number, roiH: number): number[] {
  const cols = Math.max(1, Math.floor(Math.sqrt(lum.length)));
  const rows = Math.max(1, Math.ceil(lum.length / cols));
  const q: number[][] = [[], [], [], []];
  lum.forEach((v, idx) => {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const qi = (y < rows / 2 ? 0 : 2) + (x < cols / 2 ? 0 : 1);
    q[qi].push(v);
  });
  return q.map((a) => mean(a));
}

function detectGlare(lum: number[], w: number, h: number): boolean {
  const cols = Math.max(8, Math.floor(Math.sqrt(lum.length)));
  const rows = Math.max(8, Math.ceil(lum.length / cols));
  let hot = 0;
  const total = lum.length || 1;
  for (let i = 0; i < lum.length; i++) {
    if (lum[i] > 240) hot++;
  }
  const hotFrac = hot / total;
  if (hotFrac <= 0.04) return false;
  const blockW = Math.max(2, Math.floor(cols / 4));
  const blockH = Math.max(2, Math.floor(rows / 4));
  for (let by = 0; by < rows - blockH; by += blockH) {
    for (let bx = 0; bx < cols - blockW; bx += blockW) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < blockH; dy++) {
        for (let dx = 0; dx < blockW; dx++) {
          const idx = (by + dy) * cols + (bx + dx);
          if (idx < lum.length) {
            sum += lum[idx];
            count++;
          }
        }
      }
      if (count > 0 && sum / count > 240 && count / total > 0.04) return true;
    }
  }
  return hotFrac > 0.08;
}

export function analyzeLighting(imageData: ImageData, cardRoi?: NormalizedRoi): LightingQuality {
  const { width: w, height: h, data } = imageData;
  const roi = cardRoi && cardRoi.w > 0.05 && cardRoi.h > 0.05 ? cardRoi : defaultCenterRoi();
  const { lum } = roiPixels(data, w, h, roi);

  const issues: LightingIssue[] = [];
  const messages: string[] = [];
  let score = 1;

  const avgLum = mean(lum);
  if (avgLum < 55) {
    issues.push('too_dark');
    messages.push('Scene is too dark — add diffuse light');
    score -= 0.25;
  } else if (avgLum > 210) {
    issues.push('too_bright');
    messages.push('Scene is too bright — reduce direct light or glare');
    score -= 0.2;
  }

  const shadowClip = fractionBelow(lum, 20);
  if (shadowClip > 0.18) {
    issues.push('crushed_shadows');
    messages.push('Shadows are too deep — card detail may be lost');
    score -= 0.2;
  }

  const highlightClip = fractionAbove(lum, 245);
  if (highlightClip > 0.12) {
    issues.push('blown_highlights');
    messages.push('Highlights are blown — holo/white areas may wash out');
    score -= 0.2;
  }

  const contrast = stdDev(lum);
  if (contrast < 28) {
    issues.push('low_contrast');
    messages.push('Flat lighting — edges and defects harder to see');
    score -= 0.15;
  }

  const qMeans = quadrantMeans(lum, roi.w * w, roi.h * h);
  const qSpread = Math.max(...qMeans) - Math.min(...qMeans);
  if (qSpread > 45) {
    issues.push('uneven');
    messages.push('Uneven lighting — one side is much darker');
    score -= 0.15;
  }

  if (detectGlare(lum, roi.w * w, roi.h * h)) {
    issues.push('glare');
    messages.push('Glare detected — tilt card or change angle');
    score -= 0.2;
  }

  score = Math.max(0, Math.min(1, score));
  let status: LightingQuality['status'] = 'ok';
  if (score < 0.45) status = 'poor';
  else if (score < 0.75) status = 'warn';

  const message =
    messages[0] || (status === 'ok' ? 'Lighting OK' : 'Improve lighting for best accuracy');

  return {
    score,
    status,
    issues,
    message,
    accuracyWarning: status !== 'ok' ? ACCURACY_WARNING : undefined,
  };
}
