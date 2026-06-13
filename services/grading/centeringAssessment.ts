import type { CenteringMeasurement } from '../../types';
import { isValidCenteringRatio, measuredCenteringSubgrade, stricterCenteringSubgrade } from '../centering/psaFromRatios';

export interface CenteringAssessment {
  frontCentering: number;
  backCentering: number;
  centeringAi: number;
  reasoning: string;
}

const snap = (val: number): number => {
  if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) return 0;
  const snapped = Math.round(val * 2) / 2;
  if (snapped <= 1.5) return 1;
  if (snapped === 2) return 2;
  if (snapped >= 9.5) return snapped >= 10 ? 10 : 9;
  return snapped;
};

export const CENTERING_ASSESSMENT_JSON_SCHEMA = `{
  "frontCentering": number,
  "backCentering": number,
  "reasoning": string
}`;

export function buildCenteringAssessmentPrompt(advisoryCtx?: string): string {
  return `You are a PSA centering specialist. Assess PRINTED border centering only from the two flat scans (front and back).
Ignore camera tilt, sleeve glare, and perspective distortion — judge true left/right and top/bottom border balance of the artwork frame within the card.

FRONT (stricter): 55/45 = 10, 60/40 = 9, 65/35 = 8, 70/30 = 7.
BACK (lenient): 75/25 = 10, 80/20 = 9, 85/15 = 8.

Return subgrades 1-10 for frontCentering and backCentering separately. Allowed: 1,2,2.5,...,8.5,9,10 (no 9.5).
${advisoryCtx ? `\n${advisoryCtx}\nTreat ruler measurements as advisory only — your visual assessment from the scans is primary.` : ''}

Return ONLY valid JSON:
${CENTERING_ASSESSMENT_JSON_SCHEMA}`;
}

export function parseCenteringAssessment(raw: Record<string, unknown>): CenteringAssessment {
  const frontCentering = snap(Number(raw.frontCentering) || 0);
  const backCentering = snap(Number(raw.backCentering) || 0);
  const reasoning = String(raw.reasoning || 'Centering assessed from front and back stills.');
  const centeringAi = mergeCenteringGrades(frontCentering, backCentering);
  return { frontCentering, backCentering, centeringAi, reasoning };
}

export function mergeCenteringGrades(front: number, back: number): number {
  const f = front > 0 ? front : 10;
  const b = back > 0 ? back : 10;
  return Math.min(f, b);
}

export function buildAdvisoryCenteringContext(m?: CenteringMeasurement): string {
  if (!m?.front && !m?.back) return '';
  const parts: string[] = ['USER RULER MEASUREMENT (verify visually — may be inaccurate if guides misaligned):'];
  if (m.front && isValidCenteringRatio(m.front)) {
    parts.push(`Front: L ${m.front.leftPct}% R ${m.front.rightPct}% T ${m.front.topPct}% B ${m.front.bottomPct}%`);
  }
  if (m.back && isValidCenteringRatio(m.back)) {
    parts.push(`Back: L ${m.back.leftPct}% R ${m.back.rightPct}% T ${m.back.topPct}% B ${m.back.bottomPct}%`);
  }
  return parts.length > 1 ? parts.join('\n') : '';
}

export function resolveFinalCentering(
  centeringAi: number,
  measurement: CenteringMeasurement | undefined,
  useMeasured: boolean
): { centering: number; centeringMeasured: number | null } {
  const centeringMeasured =
    useMeasured && measurement ? measuredCenteringSubgrade(measurement) : null;
  const centering = stricterCenteringSubgrade(centeringAi, centeringMeasured);
  return { centering, centeringMeasured };
}

/** Cap video-frame forensic influence: at most 1 point below still-image baseline. */
export function applyFrameSubgradeCap(
  baseline: { corners: number; edges: number; surface: number },
  frameMerged: { corners: number; edges: number; surface: number }
): { corners: number; edges: number; surface: number } {
  const cap = (base: number, frame: number) => {
    if (base <= 0 || frame <= 0) return base;
    return Math.max(frame, base - 1);
  };
  return {
    corners: cap(baseline.corners, frameMerged.corners),
    edges: cap(baseline.edges, frameMerged.edges),
    surface: cap(baseline.surface, frameMerged.surface),
  };
}

export function filterFrameDefects<T extends { imageIndex?: number; confidence?: number; box2d?: number[] }>(
  defects: T[]
): T[] {
  return defects.filter((d) => {
    const idx = d.imageIndex ?? 0;
    if (idx < 2) return true;
    const conf = typeof d.confidence === 'number' ? d.confidence : 0;
    const hasBox = Array.isArray(d.box2d) && d.box2d.length === 4;
    return hasBox && conf >= 0.8;
  });
}
