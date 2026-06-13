import type { CenteringMeasurement, Defect, GradingResult } from '../../types';
import type { GradingRuleset } from '../gradingRulesets';
import { validateGrade } from '../gradingRulesets';
import { measuredCenteringSubgrade, isValidCenteringRatio } from '../centering/psaFromRatios';
import { deriveTcgFloor } from './tcgGradeNormalize';
import type { CardIdentity } from './cardAnalysisWorkVector';

export const CENTERING_UNMEASURED_DEFAULT = 8;
export const CENTERING_UNMEASURED_RISK =
  'Centering unmeasured — subgrade capped at 8 pending ruler verification';

const VINTAGE_ROUGH_CUT_SETS = [
  'jungle', 'fossil', 'neo genesis', 'neo discovery', 'neo revelation', 'neo destiny',
  'gym heroes', 'gym challenge', 'team rocket',
];

const EDGE_PATTERNS = /edge|whiten|silver/i;
const CORNER_PATTERNS = /corner|ding|nick|chip/i;
const SURFACE_PATTERNS = /scratch|scuff|print.?line|holo.?scratch|surface|dent/i;
const CREASE_PATTERNS = /crease|bend|fold|warp|tear|water|hole/i;

export interface MathEngineInput {
  defects: Defect[];
  detectedSet: string;
  centeringMeasurement?: CenteringMeasurement;
  useMeasuredCentering: boolean;
  ruleset: GradingRuleset;
  riskFactors?: string[];
  reasoning?: string;
  identity?: Partial<CardIdentity>;
}

export interface ComputedGrades {
  centering: number;
  centeringMeasured: number | null;
  centeringUnmeasured: boolean;
  corners: number;
  edges: number;
  surface: number;
  overall: number;
  predictedGrades: { psa: number; bgs: number; cgc: number; tcg: string };
  mathTrace: string[];
  riskFactors: string[];
}

function snapToPsaScale(val: number): number {
  return validateGrade(val);
}

function snapCap(current: number, cap: number, trace: string[], label: string): number {
  const before = current;
  const after = Math.min(current, cap);
  if (after < before) {
    trace.push(`[Math] ${label} capped ${before}→${after}`);
  }
  return after;
}

function isVintageRoughCut(set: string): boolean {
  const lower = (set || '').toLowerCase();
  return VINTAGE_ROUGH_CUT_SETS.some((v) => lower.includes(v));
}

function defectText(d: Defect): string {
  return `${d.category} ${d.description}`;
}

function hasValidCenteringMeasurement(
  measurement: CenteringMeasurement | undefined,
  useMeasured: boolean
): boolean {
  if (!useMeasured || !measurement) return false;
  const frontOk = measurement.front && isValidCenteringRatio(measurement.front);
  const backOk = measurement.back && isValidCenteringRatio(measurement.back);
  return Boolean(frontOk || backOk);
}

function computeCenteringSubgrade(
  measurement: CenteringMeasurement | undefined,
  useMeasured: boolean,
  trace: string[],
  riskFactors: string[]
): { centering: number; centeringMeasured: number | null; centeringUnmeasured: boolean } {
  if (hasValidCenteringMeasurement(measurement, useMeasured)) {
    const measured = measuredCenteringSubgrade(measurement);
    if (measured != null && measured > 0) {
      trace.push(`[Math] centering=${measured} from ruler measurement`);
      return { centering: snapToPsaScale(measured), centeringMeasured: measured, centeringUnmeasured: false };
    }
  }
  trace.push(`[Math] centering=${CENTERING_UNMEASURED_DEFAULT} (no valid ruler — conservative default)`);
  if (!riskFactors.includes(CENTERING_UNMEASURED_RISK)) {
    riskFactors.push(CENTERING_UNMEASURED_RISK);
  }
  return {
    centering: CENTERING_UNMEASURED_DEFAULT,
    centeringMeasured: null,
    centeringUnmeasured: true,
  };
}

function computeWearSubgrades(
  defects: Defect[],
  detectedSet: string,
  trace: string[]
): { corners: number; edges: number; surface: number } {
  let corners = 10;
  let edges = 10;
  let surface = 10;

  const edgeDefects = defects.filter(
    (d) => d.confidence >= 0.7 && EDGE_PATTERNS.test(defectText(d))
  );
  const cornerDefects = defects.filter(
    (d) => d.confidence >= 0.7 && CORNER_PATTERNS.test(defectText(d))
  );
  const surfaceDefects = defects.filter(
    (d) => d.confidence >= 0.7 && SURFACE_PATTERNS.test(defectText(d))
  );
  const creaseDefects = defects.filter((d) => CREASE_PATTERNS.test(defectText(d)));

  const backEdgeDefects = edgeDefects.filter((d) => d.imageIndex === 1);
  const backCornerDefects = cornerDefects.filter((d) => d.imageIndex === 1);

  if (edgeDefects.length === 1 && backEdgeDefects.length === 0) {
    edges = snapCap(edges, 9, trace, 'edges (1 edge defect)');
  }
  if (edgeDefects.length >= 2 || backEdgeDefects.length >= 1) {
    edges = snapCap(edges, 8, trace, 'edges (multiple or back edge wear)');
  }

  if (cornerDefects.length === 1 && backCornerDefects.length === 0) {
    corners = snapCap(corners, 9, trace, 'corners (1 corner defect)');
  }
  if (cornerDefects.length >= 2 || backCornerDefects.length >= 1) {
    corners = snapCap(corners, 8, trace, 'corners (multiple or back corner wear)');
  }

  if (surfaceDefects.length >= 1) {
    surface = snapCap(surface, 8.5, trace, 'surface (scratch/scuff/print line)');
  }
  if (surfaceDefects.length >= 2) {
    surface = snapCap(surface, 8, trace, 'surface (multiple surface defects)');
  }

  if (creaseDefects.length > 0) {
    corners = snapCap(corners, 7, trace, 'corners (crease/bend)');
    edges = snapCap(edges, 7, trace, 'edges (crease/bend)');
    surface = snapCap(surface, 7, trace, 'surface (crease/bend)');
  }

  const wearCount = defects.filter(
    (d) =>
      EDGE_PATTERNS.test(defectText(d)) || CORNER_PATTERNS.test(defectText(d))
  ).length;
  const edgeWear = edgeDefects.length > 0;
  const cornerWear = cornerDefects.length > 0;

  if (wearCount >= 2 && edgeWear && cornerWear) {
    corners = snapCap(corners, 7.5, trace, 'corners (combined edge+corner wear)');
    edges = snapCap(edges, 7.5, trace, 'edges (combined edge+corner wear)');
  }

  if (isVintageRoughCut(detectedSet)) {
    const hasSilvering = defects.some((d) => /silver|whiten|edge/i.test(defectText(d)));
    if (hasSilvering) {
      edges = snapCap(edges, 8, trace, 'edges (vintage silvering)');
    }
  }

  if (defects.length === 0) {
    trace.push('[Math] corners/edges/surface=10 (no qualifying defects)');
  }

  return {
    corners: snapToPsaScale(corners),
    edges: snapToPsaScale(edges),
    surface: snapToPsaScale(surface),
  };
}

function computeSlabGrades(
  centering: number,
  corners: number,
  edges: number,
  surface: number,
  trace: string[]
): { psa: number; bgs: number; cgc: number; overall: number } {
  const subs = [centering, corners, edges, surface].filter((g) => g > 0);
  const bottleneck = subs.length ? Math.min(...subs) : 0;
  const overall = snapToPsaScale(bottleneck);

  trace.push(
    `[Math] overall=${overall} = min(centering=${centering}, corners=${corners}, edges=${edges}, surface=${surface})`
  );

  const psa = overall;
  const cgc = overall;
  const allPerfect = subs.every((g) => g >= 10);
  const bgs = allPerfect ? 9.5 : overall;

  trace.push(`[Math] PSA=${psa}, BGS=${bgs}, CGC=${cgc} from subgrade bottleneck`);

  return { psa, bgs, cgc, overall };
}

export function computeGradesFromEvidence(input: MathEngineInput): ComputedGrades {
  const trace: string[] = [];
  const riskFactors = [...(input.riskFactors || [])];

  const { centering, centeringMeasured, centeringUnmeasured } = computeCenteringSubgrade(
    input.centeringMeasurement,
    input.useMeasuredCentering,
    trace,
    riskFactors
  );

  const wear = computeWearSubgrades(input.defects, input.detectedSet, trace);
  const slab = computeSlabGrades(centering, wear.corners, wear.edges, wear.surface, trace);

  const draft: GradingResult = {
    centering,
    centeringMeasured: centeringMeasured ?? undefined,
    corners: wear.corners,
    edges: wear.edges,
    surface: wear.surface,
    overall: slab.overall,
    reasoning: input.reasoning || '',
    defects: input.defects,
    riskFactors,
    predictedGrades: { psa: slab.psa, bgs: slab.bgs, cgc: slab.cgc, tcg: 'Near Mint' },
    detectedName: input.identity?.detectedName || '',
    detectedCharacter: input.identity?.detectedCharacter || '',
    detectedSet: input.detectedSet,
    detectedYear: input.identity?.detectedYear || '',
    detectedEdition: input.identity?.detectedEdition || '',
    detectedCardNumber: input.identity?.detectedCardNumber || '',
    detectedArtist: input.identity?.detectedArtist || '',
    isHolographic: input.identity?.isHolographic,
    holoPattern: input.identity?.holoPattern,
  };

  const tcg = deriveTcgFloor(draft);
  trace.push(`[Math] TCG condition=${tcg} from deriveTcgFloor`);

  return {
    centering,
    centeringMeasured,
    centeringUnmeasured,
    corners: wear.corners,
    edges: wear.edges,
    surface: wear.surface,
    overall: slab.overall,
    predictedGrades: { psa: slab.psa, bgs: slab.bgs, cgc: slab.cgc, tcg },
    mathTrace: trace,
    riskFactors: [...new Set(riskFactors.filter(Boolean))],
  };
}

export function applyComputedGradesToResult(
  base: GradingResult,
  computed: ComputedGrades
): GradingResult {
  const mathNote = computed.mathTrace.length
    ? `\n\n[RawGraded Math Engine]\n${computed.mathTrace.join('\n')}`
    : '';

  return {
    ...base,
    centering: computed.centering,
    centeringMeasured: computed.centeringMeasured ?? undefined,
    corners: computed.corners,
    edges: computed.edges,
    surface: computed.surface,
    overall: computed.overall,
    predictedGrades: computed.predictedGrades,
    riskFactors: [...new Set([...(base.riskFactors || []), ...computed.riskFactors])],
    reasoning: `${base.reasoning || ''}${mathNote}`.trim(),
  };
}
