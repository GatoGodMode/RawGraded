import type { CardData, Defect } from '../../types';
import { parseChunkIndex } from './cardImagePipeline';

export function getSourceImageByIndex(
  cardData: CardData,
  imageIndex: number,
  defect?: Defect
): string | null {
  if (defect?.imageData) return defect.imageData;
  const chunk = cardData.analysisChunks?.find((c) => c.imageIndex === imageIndex);
  if (chunk?.dataUrl) return chunk.dataUrl;
  const fromGrade = cardData.aiGrade?.analysisChunks?.find((c) => c.imageIndex === imageIndex);
  if (fromGrade?.dataUrl) return fromGrade.dataUrl;
  if (imageIndex >= 2) {
    const frame = cardData.videoFrames?.[imageIndex - 2];
    return frame || null;
  }
  if (imageIndex === 1) {
    return cardData.backCropped || cardData.backRaw || null;
  }
  return cardData.frontCropped || cardData.frontRaw || null;
}

export function getImageSourceLabel(imageIndex: number, frameLabels?: string[]): string {
  const chunk = parseChunkIndex(imageIndex);
  if (chunk) {
    const side = chunk.side === 'front' ? 'Front' : 'Back';
    return `${side} · R${chunk.row + 1}C${chunk.col + 1}`;
  }
  if (imageIndex === 0) return 'Front';
  if (imageIndex === 1) return 'Back';
  const frameIdx = imageIndex - 2;
  const label = frameLabels?.[frameIdx];
  return label ? `Video · ${label}` : `Video frame ${frameIdx + 1}`;
}

/** Labels aligned with VideoCapture stages / forensic frame picks. */
export function buildVideoFrameLabels(frameCount: number): string[] {
  const stageLabels = ['Front hold', 'Tilt L/R', 'Tilt U/D', 'Macro scan', 'Back scan'];
  if (frameCount <= 0) return [];
  if (frameCount >= 5) return stageLabels.slice(0, frameCount);
  if (frameCount >= 3) {
    return Array.from({ length: frameCount }, (_, i) => {
      if (i === frameCount - 2) return 'Tilt frame';
      if (i === frameCount - 1) return 'Macro frame';
      return `Frame ${i + 1}`;
    });
  }
  return Array.from({ length: frameCount }, (_, i) => `Frame ${i + 1}`);
}

export function getReferencedFrameIndices(defects: Defect[]): Set<number> {
  const refs = new Set<number>();
  for (const d of defects) {
    const idx = d.imageIndex ?? 0;
    if (idx >= 2 && parseChunkIndex(idx) === null) refs.add(idx - 2);
  }
  return refs;
}
