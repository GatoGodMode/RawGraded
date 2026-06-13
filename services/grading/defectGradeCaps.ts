import type { GradingResult } from '../../types';
import { maxTcgCondition } from './tcgGradeNormalize';

function snapCap(current: number, cap: number): number {
  if (!Number.isFinite(current) || current <= 0) return cap;
  return Math.min(current, cap);
}

const EDGE_PATTERNS = /edge|whiten|silver/i;
const CORNER_PATTERNS = /corner|ding|nick|chip/i;
const SURFACE_PATTERNS = /scratch|scuff|print.?line|holo.?scratch|surface/i;
const CREASE_PATTERNS = /crease|bend|fold|warp/i;

export function applyDefectGradeCaps(result: GradingResult): GradingResult {
  const out: GradingResult = { ...result, defects: [...(result.defects || [])] };
  let corners = out.corners;
  let edges = out.edges;
  let surface = out.surface;
  let overall = out.overall;

  for (const d of out.defects) {
    const text = `${d.category} ${d.description}`;
    if (EDGE_PATTERNS.test(text)) edges = snapCap(edges, 8);
    if (CORNER_PATTERNS.test(text)) corners = snapCap(corners, 8);
    if (SURFACE_PATTERNS.test(text)) surface = snapCap(surface, 8);
    if (CREASE_PATTERNS.test(text)) {
      overall = snapCap(overall, 6);
      corners = snapCap(corners, 7);
      edges = snapCap(edges, 7);
      surface = snapCap(surface, 7);
    }
  }

  const wearCount = out.defects.filter((d) =>
    EDGE_PATTERNS.test(`${d.category} ${d.description}`) ||
    CORNER_PATTERNS.test(`${d.category} ${d.description}`)
  ).length;

  const edgeWear = out.defects.some((d) => EDGE_PATTERNS.test(`${d.category} ${d.description}`));
  const cornerWear = out.defects.some((d) => CORNER_PATTERNS.test(`${d.category} ${d.description}`));

  if (wearCount >= 2 && edgeWear && cornerWear) {
    overall = snapCap(overall, 7.5);
  }

  if (wearCount > 0) {
    const bottleneck = Math.min(corners, edges, surface);
    if (overall > bottleneck) {
      overall = snapCap(overall, bottleneck);
    }
  }

  out.corners = corners;
  out.edges = edges;
  out.surface = surface;
  out.overall = overall;

  if (wearCount >= 2 && out.predictedGrades) {
    out.predictedGrades = {
      ...out.predictedGrades,
      tcg: maxTcgCondition(out.predictedGrades.tcg || 'Near Mint', 'Lightly Played'),
    };
  }

  if (wearCount >= 2 && edgeWear && cornerWear && out.predictedGrades) {
    out.predictedGrades = {
      ...out.predictedGrades,
      tcg: maxTcgCondition(out.predictedGrades.tcg, 'Moderately Played'),
    };
  }

  return out;
}
