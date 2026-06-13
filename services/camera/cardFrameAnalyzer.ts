import { analyzeLighting, type LightingQuality, type NormalizedRoi } from './lightingAnalyzer';

export type CaptureMode = 'video_stage' | 'static_hold';

export type CardFrameQuality = {
  detected: boolean;
  quad: { x: number; y: number }[] | null;
  focus: number;
  perspective: number;
  overall: number;
  status: 'red' | 'yellow' | 'green';
  hint: string;
  lighting: LightingQuality;
  cardRoi: NormalizedRoi | null;
};

export type AnalyzeCardFrameOpts = {
  mode: CaptureMode;
  stage?: number;
  side?: 'front' | 'back';
  type?: 'card' | 'slab';
};

const SAMPLE_WIDTH = 320;

function toGrayscale(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

function rowEdgeScores(gray: Float32Array, w: number, h: number): number[] {
  const stride = Math.max(1, Math.floor(h / 120));
  const colStep = Math.max(1, Math.floor(w / 120));
  const scores: number[] = [];
  for (let y = 0; y < h; y += stride) {
    let s = 0;
    for (let x = 0; x < w - 1; x += colStep) {
      s += Math.abs(gray[y * w + x] - gray[y * w + x + 1]);
    }
    scores.push(s);
  }
  return scores;
}

function colEdgeScores(gray: Float32Array, w: number, h: number): number[] {
  const stride = Math.max(1, Math.floor(w / 120));
  const rowStep = Math.max(1, Math.floor(h / 120));
  const scores: number[] = [];
  for (let x = 0; x < w; x += stride) {
    let s = 0;
    for (let y = 0; y < h - 1; y += rowStep) {
      s += Math.abs(gray[y * w + x] - gray[(y + 1) * w + x]);
    }
    scores.push(s);
  }
  return scores;
}

function pickEdgePair(scores: number[], lowFrac: number, highFrac: number): { lo: number; hi: number } {
  let lo = Math.floor(scores.length * lowFrac);
  let hi = Math.floor(scores.length * highFrac);
  for (let i = 0; i < scores.length * 0.45; i++) {
    if (scores[i] > scores[lo] * 0.85) lo = i;
  }
  for (let i = scores.length - 1; i > scores.length * 0.55; i--) {
    if (scores[i] > scores[hi] * 0.85) hi = i;
  }
  if (hi <= lo + 1) {
    lo = Math.floor(scores.length * lowFrac);
    hi = Math.floor(scores.length * highFrac);
  }
  return { lo, hi };
}

function isPlausibleCardAspect(rw: number, rh: number, frameW: number, frameH: number, type: 'card' | 'slab'): boolean {
  if (rw <= 0.05 || rh <= 0.05) return false;
  const aspect = rw / rh;
  const portraitNominal = (5 / 7) * (frameH / frameW);
  const landscapeNominal = (7 / 5) * (frameH / frameW);
  if (type === 'slab') {
    return aspect >= 0.38 && aspect <= 0.95;
  }
  const tol = 0.42;
  const nearPortrait = aspect >= portraitNominal * (1 - tol) && aspect <= portraitNominal * (1 + tol);
  const nearLandscape = aspect >= landscapeNominal * (1 - tol) && aspect <= landscapeNominal * (1 + tol);
  return nearPortrait || nearLandscape || (aspect >= 0.28 && aspect <= 0.92);
}

function scoreRectBoundary(gray: Float32Array, w: number, h: number, roi: NormalizedRoi): number {
  const x0 = Math.max(0, Math.floor(roi.x * w));
  const y0 = Math.max(0, Math.floor(roi.y * h));
  const x1 = Math.min(w - 1, Math.ceil((roi.x + roi.w) * w));
  const y1 = Math.min(h - 1, Math.ceil((roi.y + roi.h) * h));
  if (x1 - x0 < 8 || y1 - y0 < 8) return 0;

  let score = 0;
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 40));

  for (let x = x0; x < x1; x += step) {
    score += Math.abs(gray[y0 * w + x] - gray[Math.min(h - 1, y0 + 1) * w + x]);
    score += Math.abs(gray[y1 * w + x] - gray[Math.max(0, y1 - 1) * w + x]);
  }
  for (let y = y0; y < y1; y += step) {
    score += Math.abs(gray[y * w + x0] - gray[y * w + Math.min(w - 1, x0 + 1)]);
    score += Math.abs(gray[y * w + x1] - gray[y * w + Math.max(0, x1 - 1)]);
  }
  return score / (step + 1);
}

/** Fit a centered 5:7 portrait rect by maximizing edge energy along its boundary. */
function detectCardRectCenterFit(
  gray: Float32Array,
  w: number,
  h: number,
  type: 'card' | 'slab'
): NormalizedRoi | null {
  const cardAspect = type === 'slab' ? 0.68 : 5 / 7;
  let best: { roi: NormalizedRoi; score: number } | null = null;

  for (let rh = 0.5; rh <= 0.94; rh += 0.04) {
    const rw = rh * cardAspect * (h / w);
    if (rw < 0.18 || rw > 0.92 || rh > 0.96) continue;
    const roi: NormalizedRoi = { x: (1 - rw) / 2, y: (1 - rh) / 2, w: rw, h: rh };
    const score = scoreRectBoundary(gray, w, h, roi);
    if (!best || score > best.score) best = { roi, score };
  }

  if (!best || best.score < 12) return null;
  return best.roi;
}

function interiorVariance(gray: Float32Array, w: number, h: number, roi: NormalizedRoi): number {
  const x0 = Math.floor((roi.x + roi.w * 0.08) * w);
  const y0 = Math.floor((roi.y + roi.h * 0.08) * h);
  const x1 = Math.ceil((roi.x + roi.w * 0.92) * w);
  const y1 = Math.ceil((roi.y + roi.h * 0.92) * h);
  const vals: number[] = [];
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 24));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      vals.push(gray[y * w + x]);
    }
  }
  if (vals.length < 4) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length;
}

function detectCardRect(
  gray: Float32Array,
  w: number,
  h: number,
  type: 'card' | 'slab'
): NormalizedRoi | null {
  const rowScores = rowEdgeScores(gray, w, h);
  const colScores = colEdgeScores(gray, w, h);
  if (!rowScores.length || !colScores.length) return null;

  const rowStride = Math.max(1, Math.floor(h / rowScores.length));
  const colStride = Math.max(1, Math.floor(w / colScores.length));
  const rowPair = pickEdgePair(rowScores, 0.05, 0.95);
  const colPair = pickEdgePair(colScores, 0.08, 0.92);

  const top = rowPair.lo * rowStride;
  const bottom = Math.min(h - 1, rowPair.hi * rowStride);
  const left = colPair.lo * colStride;
  const right = Math.min(w - 1, colPair.hi * colStride);

  const rw = (right - left) / w;
  const rh = (bottom - top) / h;
  const area = rw * rh;
  if (area < 0.08) return null;
  if (area > 0.98) return null;

  if (!isPlausibleCardAspect(rw, rh, w, h, type)) return null;

  return { x: left / w, y: top / h, w: rw, h: rh };
}

function detectCardRectWeak(
  gray: Float32Array,
  w: number,
  h: number,
  type: 'card' | 'slab'
): NormalizedRoi | null {
  const rowScores = rowEdgeScores(gray, w, h);
  const colScores = colEdgeScores(gray, w, h);
  if (!rowScores.length || !colScores.length) return null;

  const rowStride = Math.max(1, Math.floor(h / rowScores.length));
  const colStride = Math.max(1, Math.floor(w / colScores.length));
  const rowPair = pickEdgePair(rowScores, 0.02, 0.98);
  const colPair = pickEdgePair(colScores, 0.05, 0.95);

  const top = rowPair.lo * rowStride;
  const bottom = Math.min(h - 1, rowPair.hi * rowStride);
  const left = colPair.lo * colStride;
  const right = Math.min(w - 1, colPair.hi * colStride);

  const rw = (right - left) / w;
  const rh = (bottom - top) / h;
  if (rw * rh < 0.06) return null;
  if (rw * rh > 0.98) return null;
  if (!isPlausibleCardAspect(rw, rh, w, h, type)) return null;

  return { x: left / w, y: top / h, w: rw, h: rh };
}

function rectToQuad(roi: NormalizedRoi): { x: number; y: number }[] {
  const { x, y, w, h } = roi;
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function laplacianVariance(gray: Float32Array, w: number, h: number, roi: NormalizedRoi): number {
  const inner: NormalizedRoi = {
    x: roi.x + roi.w * 0.1,
    y: roi.y + roi.h * 0.1,
    w: roi.w * 0.8,
    h: roi.h * 0.8,
  };
  const x0 = Math.max(1, Math.floor(inner.x * w));
  const y0 = Math.max(1, Math.floor(inner.y * h));
  const x1 = Math.min(w - 1, Math.ceil((inner.x + inner.w) * w));
  const y1 = Math.min(h - 1, Math.ceil((inner.y + inner.h) * h));
  const vals: number[] = [];
  for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const c = gray[y * w + x];
      const lap =
        -4 * c +
        gray[(y - 1) * w + x] +
        gray[(y + 1) * w + x] +
        gray[y * w + (x - 1)] +
        gray[y * w + (x + 1)];
      vals.push(lap);
    }
  }
  if (vals.length < 10) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length;
  return variance;
}

function normalizeFocus(variance: number): number {
  if (variance <= 0) return 0;
  const normalized = Math.log10(variance + 1) / 3.5;
  return Math.max(0, Math.min(1, normalized));
}

function perspectiveHoldScore(roi: NormalizedRoi): number {
  const aspect = roi.w / roi.h;
  const target = 5 / 7;
  const aspectErr = Math.abs(aspect - target) / target;
  const aspectScore = Math.max(0, 1 - aspectErr * 2);
  const cx = roi.x + roi.w / 2;
  const cy = roi.y + roi.h / 2;
  const centerDist = Math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2);
  const centerScore = Math.max(0, 1 - centerDist * 2);
  return aspectScore * 0.6 + centerScore * 0.4;
}

function perspectiveTiltScore(roi: NormalizedRoi, axis: 'lr' | 'ud'): number {
  const cx = roi.x + roi.w / 2;
  const cy = roi.y + roi.h / 2;
  const offset = axis === 'lr' ? Math.abs(cx - 0.5) : Math.abs(cy - 0.5);
  if (offset < 0.03) return 0.35;
  if (offset > 0.22) return 0.4;
  return 0.85;
}

function perspectiveMacroScore(roi: NormalizedRoi): number {
  const area = roi.w * roi.h;
  if (area < 0.25) return Math.max(0.3, area / 0.25);
  return 1;
}

function scorePerspective(roi: NormalizedRoi, mode: CaptureMode, stage: number): number {
  if (mode === 'static_hold') return perspectiveHoldScore(roi);
  switch (stage) {
    case 0:
    case 4:
      return perspectiveHoldScore(roi);
    case 1:
      return perspectiveTiltScore(roi, 'lr');
    case 2:
      return perspectiveTiltScore(roi, 'ud');
    case 3:
      return perspectiveMacroScore(roi);
    default:
      return perspectiveHoldScore(roi);
  }
}

function combineOverall(focus: number, perspective: number, mode: CaptureMode, stage: number): number {
  if (mode === 'static_hold' || stage === 0 || stage === 4) {
    return focus * 0.45 + perspective * 0.55;
  }
  if (stage === 3) return focus * 0.7 + perspective * 0.3;
  return focus * 0.4 + perspective * 0.6;
}

function statusFromOverall(overall: number): CardFrameQuality['status'] {
  if (overall >= 0.72) return 'green';
  if (overall >= 0.45) return 'yellow';
  return 'red';
}

function buildHint(
  status: CardFrameQuality['status'],
  detected: boolean,
  partial: boolean,
  mode: CaptureMode,
  stage: number,
  side?: 'front' | 'back'
): string {
  if (!detected) return 'Card not found — move closer and fill the frame';
  if (partial) {
    const label = side === 'back' ? 'Back' : 'Front';
    return `${label} — card detected, fine-tune position or focus`;
  }
  if (mode === 'static_hold') {
    const label = side === 'back' ? 'Back' : 'Front';
    if (status === 'green') return `${label} — hold flat and steady`;
    if (status === 'yellow') return `${label} — adjust angle or focus`;
    return `${label} — move closer and reduce blur`;
  }
  const stageHints: Record<number, string> = {
    0: 'Hold front still',
    1: 'Tilt left and right',
    2: 'Tilt up and down',
    3: 'Move closer for macro scan',
    4: 'Hold back still',
  };
  const base = stageHints[stage] || 'Align card in frame';
  if (status === 'green') return base;
  if (status === 'yellow') return `${base} — almost ready`;
  return `${base} — improve focus or angle`;
}

export function downscaleVideoFrame(video: HTMLVideoElement, targetW = SAMPLE_WIDTH): ImageData | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = targetW / video.videoWidth;
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function analyzeCardFrame(imageData: ImageData, opts: AnalyzeCardFrameOpts): CardFrameQuality {
  const { mode, stage = 0, side, type = 'card' } = opts;
  const { width: w, height: h, data } = imageData;
  const gray = toGrayscale(data, w, h);
  let cardRoi = detectCardRect(gray, w, h, type);
  let partial = false;
  let detectionMethod: 'edge' | 'weak' | 'centerfit' = 'edge';
  if (!cardRoi) {
    cardRoi = detectCardRectWeak(gray, w, h, type);
    if (cardRoi) {
      partial = true;
      detectionMethod = 'weak';
    }
  }
  if (!cardRoi) {
    cardRoi = detectCardRectCenterFit(gray, w, h, type);
    if (cardRoi) {
      partial = true;
      detectionMethod = 'centerfit';
    }
  }
  const detected = cardRoi != null;
  const quad = cardRoi ? rectToQuad(cardRoi) : null;

  let focus = 0;
  let perspective = 0;
  if (cardRoi) {
    focus = normalizeFocus(laplacianVariance(gray, w, h, cardRoi));
    perspective = scorePerspective(cardRoi, mode, stage);
  }

  let overall = detected ? combineOverall(focus, perspective, mode, stage) : 0;
  if (partial && overall > 0) {
    overall = Math.max(detectionMethod === 'centerfit' ? 0.48 : 0.35, overall * 0.9);
  }
  if (detected && cardRoi && interiorVariance(gray, w, h, cardRoi) < 80) {
    overall = Math.min(overall, 0.5);
    partial = true;
  }
  let status = statusFromOverall(overall);
  if (partial && status === 'red') status = 'yellow';
  const hint = buildHint(status, detected, partial, mode, stage, side);
  const lighting = analyzeLighting(imageData, cardRoi || undefined);

  return {
    detected,
    quad,
    focus,
    perspective,
    overall,
    status,
    hint,
    lighting,
    cardRoi,
  };
}
