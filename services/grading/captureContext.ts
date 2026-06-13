import type { CaptureMetadata } from '../../types';

export function buildSoftCaptureContext(
  frontMeta?: CaptureMetadata,
  backMeta?: CaptureMetadata
): string {
  const soft =
    frontMeta?.captureWasSoft ||
    backMeta?.captureWasSoft ||
    (typeof frontMeta?.captureFocusScore === 'number' && frontMeta.captureFocusScore < 0.45) ||
    (typeof backMeta?.captureFocusScore === 'number' && backMeta.captureFocusScore < 0.45);

  if (!soft) return '';

  return `
CAPTURE QUALITY NOTE: One or more stills were soft or out of focus when captured. Scrutinize edges and corners for whitening, silvering, nicks, and spots — blur can hide wear.
- List every visible wear in defects[], not riskFactors alone.
- Do not use Gem Mint, Mint, NM-MT, or Pristine in predictedGrades.tcg — use TCGPlayer conditions only: Near Mint, Lightly Played, Moderately Played, Heavily Played, Damaged.
- Grade edges/corners/surface conservatively when wear is plausible on a played card.`.trim();
}

export function cardDataHasSoftCapture(frontMeta?: CaptureMetadata, backMeta?: CaptureMetadata): boolean {
  return Boolean(
    frontMeta?.captureWasSoft ||
      backMeta?.captureWasSoft ||
      (typeof frontMeta?.captureFocusScore === 'number' && frontMeta.captureFocusScore < 0.45) ||
      (typeof backMeta?.captureFocusScore === 'number' && backMeta.captureFocusScore < 0.45)
  );
}
