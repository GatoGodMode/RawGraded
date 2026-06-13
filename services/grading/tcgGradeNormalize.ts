import type { GradingResult } from '../../types';

export const TCG_CONDITIONS = [
  'Near Mint',
  'Lightly Played',
  'Moderately Played',
  'Heavily Played',
  'Damaged',
] as const;

export type TcgCondition = (typeof TCG_CONDITIONS)[number];

const SLAB_JARGON = /\b(gem\s*mint|pristine|nm-?mt|mint\+?|psa\s*10|bgs\s*9\.5|cgc\s*10|gem\b|black\s*label)\b/i;

const WEAR_DEFECT = /edge|whiten|silver|corner|ding|nick|chip|scuff|scratch|wear/i;
const CREASE_DEFECT = /crease|bend|fold|tear|water|hole|warp/i;

export function tcgRank(tcg: string): number {
  const lower = tcg.toLowerCase();
  if (/damaged|\bdmg\b/.test(lower)) return 4;
  if (/heavily\s*played|\bhp\b/.test(lower)) return 3;
  if (/moderately\s*played|\bmp\b/.test(lower)) return 2;
  if (/lightly\s*played|\blp\b/.test(lower)) return 1;
  if (/near\s*mint|\bnm\b/.test(lower)) return 0;
  return -1;
}

export function maxTcgCondition(a: string, b: string): TcgCondition {
  const order = TCG_CONDITIONS;
  const rankA = tcgRank(a);
  const rankB = tcgRank(b);
  const pick = rankA >= rankB ? a : b;
  const idx = Math.max(rankA, rankB);
  if (idx >= 0 && idx < order.length) return order[idx];
  return normalizeTcgLabel(pick);
}

function normalizeTcgLabel(raw: string): TcgCondition {
  const r = tcgRank(raw);
  if (r >= 0) return TCG_CONDITIONS[r];
  return 'Near Mint';
}

export function sanitizeAiTcgString(raw: string | undefined): TcgCondition | null {
  const g = String(raw || '').trim();
  if (!g) return null;
  if (SLAB_JARGON.test(g)) return null;
  const rank = tcgRank(g);
  if (rank >= 0) return TCG_CONDITIONS[rank];
  return null;
}

function hasWearDefects(result: GradingResult): boolean {
  return (result.defects || []).some((d) => WEAR_DEFECT.test(`${d.category} ${d.description}`));
}

function hasCreaseDefects(result: GradingResult): boolean {
  return (result.defects || []).some((d) => CREASE_DEFECT.test(`${d.category} ${d.description}`));
}

function mentionsModerateWear(text: string): boolean {
  return /\b(moderate|major|significant|heavy|extensive)\s+(whitening|edge\s*wear|wear|silvering|scuff)/i.test(text);
}

function collectWearText(result: GradingResult): string {
  return [
    result.reasoning || '',
    ...(result.riskFactors || []),
  ].join(' ');
}

function wearDefectCount(result: GradingResult): number {
  return (result.defects || []).filter((d) => WEAR_DEFECT.test(`${d.category} ${d.description}`)).length;
}

export function deriveTcgFloor(result: GradingResult): TcgCondition {
  const overall = Number(result.overall) || 0;
  const worstWear = Math.min(result.corners, result.edges, result.surface);
  const wearText = collectWearText(result);
  const wearCount = wearDefectCount(result);
  const hasWear = hasWearDefects(result) || mentionsVisibleWear(wearText);

  if (hasCreaseDefects(result) || /\b(tear|water\s*damage|hole)\b/i.test(wearText) || overall <= 4) {
    return 'Damaged';
  }
  if (overall <= 6 || worstWear <= 5.5) return 'Heavily Played';
  if (
    overall <= 7.5 ||
    worstWear <= 7 ||
    wearCount >= 2 ||
    mentionsModerateWear(wearText) ||
    (/\bwhitening\b/i.test(wearText) && /\bedge\s*wear\b/i.test(wearText))
  ) {
    return 'Moderately Played';
  }
  if (overall <= 8.5 || worstWear <= 8.5 || hasWear) return 'Lightly Played';
  if (overall >= 9 && worstWear >= 9 && !hasWear) return 'Near Mint';
  return 'Lightly Played';
}

function mentionsVisibleWear(text: string): boolean {
  return /\b(whitening|whiten|silvering|silvered|nick(?:ed|s)?|chip(?:ped|s)?|fray(?:ed|s)?|scuff(?:ed|s)?|ding(?:s)?|peel(?:ing|s)?|edge\s*wear)\b/i.test(
    text.toLowerCase()
  );
}

export function deriveTcgCondition(result: GradingResult): TcgCondition {
  const aiRaw = result.predictedGrades?.tcg;
  const sanitized = sanitizeAiTcgString(aiRaw);
  const floor = deriveTcgFloor(result);
  if (sanitized) return maxTcgCondition(sanitized, floor);
  return floor;
}

export function applyTcgNormalization(result: GradingResult): GradingResult {
  if (!result.predictedGrades) return result;
  const tcg = deriveTcgCondition(result);
  return {
    ...result,
    predictedGrades: { ...result.predictedGrades, tcg },
  };
}
