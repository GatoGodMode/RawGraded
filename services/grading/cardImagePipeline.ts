import { resizeImage } from '../imageUtils';

export const RAPID_ASSESS_MAX_DIM = 720;
export const GRID_ROWS = 3;
export const GRID_COLS = 3;
export const IDENTITY_BAND_HEIGHT_RATIO = 1 / 3;

export const RAPID_FRONT_IMAGE_INDEX = 0;
export const RAPID_BACK_IMAGE_INDEX = 1;
export const VIDEO_FRAME_IMAGE_INDEX_BASE = 2;

export type CardSliceSide = 'front' | 'back';

export interface CardGridSlice {
  side: CardSliceSide;
  row: number;
  col: number;
  index: number;
  label: string;
  dataUrl: string;
}

export interface AnalysisChunkRef {
  imageIndex: number;
  label: string;
  dataUrl: string;
}

export interface FrontIdentityBands {
  topBand: string;
  bottomBand: string;
}

export interface PreparedCardImages {
  frontPrep: string;
  backPrep: string;
  front720: string;
  back720: string;
  frontGrid: CardGridSlice[];
  backGrid: CardGridSlice[];
  identityBands: FrontIdentityBands;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function cropRect(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, quality = 0.88): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context failed');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function chunkImageIndex(side: CardSliceSide, row: number, col: number): number {
  const base = side === 'front' ? 100 : 200;
  return base + row * GRID_COLS + col;
}

export function chunkLabel(side: CardSliceSide, row: number, col: number): string {
  return `${side} R${row + 1}C${col + 1}`;
}

export async function buildRapidPair(front: string, back: string): Promise<{ front720: string; back720: string }> {
  const [front720, back720] = await Promise.all([
    resizeImage(front, RAPID_ASSESS_MAX_DIM, 0.82),
    resizeImage(back, RAPID_ASSESS_MAX_DIM, 0.82),
  ]);
  return { front720, back720 };
}

export async function slice3x3(dataUrl: string, side: CardSliceSide): Promise<CardGridSlice[]> {
  const img = await loadImage(dataUrl);
  const slices: CardGridSlice[] = [];
  const cellW = img.width / GRID_COLS;
  const cellH = img.height / GRID_ROWS;

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const index = row * GRID_COLS + col;
      const sx = col * cellW;
      const sy = row * cellH;
      slices.push({
        side,
        row,
        col,
        index,
        label: chunkLabel(side, row, col),
        dataUrl: cropRect(img, sx, sy, cellW, cellH),
      });
    }
  }
  return slices;
}

export async function cropFrontIdentityBands(front: string): Promise<FrontIdentityBands> {
  const img = await loadImage(front);
  const bandH = img.height * IDENTITY_BAND_HEIGHT_RATIO;
  return {
    topBand: cropRect(img, 0, 0, img.width, bandH),
    bottomBand: cropRect(img, 0, img.height - bandH, img.width, bandH),
  };
}

export function gridToAnalysisChunks(frontGrid: CardGridSlice[], backGrid: CardGridSlice[]): AnalysisChunkRef[] {
  const all = [...frontGrid, ...backGrid];
  return all.map((s) => ({
    imageIndex: chunkImageIndex(s.side, s.row, s.col),
    label: s.label,
    dataUrl: s.dataUrl,
  }));
}

export async function prepareCardImages(
  front: string,
  back: string,
  prepFront: (src: string) => Promise<string>,
  prepBack: (src: string) => Promise<string>
): Promise<PreparedCardImages> {
  const [frontPrep, backPrep] = await Promise.all([prepFront(front), prepBack(back)]);
  const { front720, back720 } = await buildRapidPair(frontPrep, backPrep);
  const [frontGrid, backGrid, identityBands] = await Promise.all([
    slice3x3(frontPrep, 'front'),
    slice3x3(backPrep, 'back'),
    cropFrontIdentityBands(frontPrep),
  ]);
  return { frontPrep, backPrep, front720, back720, frontGrid, backGrid, identityBands };
}

export function parseChunkIndex(imageIndex: number): { side: CardSliceSide; row: number; col: number } | null {
  if (imageIndex >= 100 && imageIndex < 109) {
    const i = imageIndex - 100;
    return { side: 'front', row: Math.floor(i / GRID_COLS), col: i % GRID_COLS };
  }
  if (imageIndex >= 200 && imageIndex < 209) {
    const i = imageIndex - 200;
    return { side: 'back', row: Math.floor(i / GRID_COLS), col: i % GRID_COLS };
  }
  return null;
}
