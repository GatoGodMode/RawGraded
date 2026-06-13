import type { Defect, GradingResult } from '../../types';
import { maxTcgCondition } from './tcgGradeNormalize';

const VINTAGE_ROUGH_CUT_SETS = [
  'jungle', 'fossil', 'neo genesis', 'neo discovery', 'neo revelation', 'neo destiny',
  'gym heroes', 'gym challenge', 'team rocket',
];

function isVintageRoughCut(set: string): boolean {
  const lower = (set || '').toLowerCase();
  return VINTAGE_ROUGH_CUT_SETS.some((v) => lower.includes(v));
}

function mentionsVisibleWear(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(whitening|whiten|silvering|silvered|nick(?:ed|s)?|chip(?:ped|s)?|fray(?:ed|s)?|scuff(?:ed|s)?|ding(?:s)?|peel(?:ing|s)?|damage(?:d|s)?|edge\s*wear|spot(?:s)?)\b/.test(lower);
}

function hasPhase2WearReasoning(text: string): boolean {
  const phase2 = text.match(/\[(Phase 2[AB]|Front forensic|Back forensic|Frame|Phase1)[^\]]*\]:([^|]+)/gi) || [];
  return phase2.some((chunk) => mentionsVisibleWear(chunk));
}

function collectWearText(result: GradingResult): string {
  return [result.reasoning || '', ...(result.riskFactors || [])].join(' ');
}

function inferDefectFromReasoning(result: GradingResult, side: 'edge' | 'corner'): Defect {
  const reasoning = result.reasoning || '';
  const category = side === 'edge' ? 'edge_whitening' : 'corner_wear';
  return {
    category,
    description: `Inferred from wear language: visible ${side === 'edge' ? 'edge whitening/silvering' : 'corner wear'} noted in analysis but not listed as defect.`,
    imageIndex: /\[Back|Phase 2B|back forensic/i.test(reasoning) ? 1 : 0,
    confidence: 0.6,
    box2d: [],
    inferred: true,
  };
}

function inferDefectsFromWearText(result: GradingResult): void {
  const wearText = collectWearText(result);
  if (!mentionsVisibleWear(wearText)) return;

  const edgeWear = /\b(whitening|whiten|silvering|edge\s*wear|edge\s*white)\b/i.test(wearText);
  const cornerWear = /\b(corner|nick|chip|ding)\b/i.test(wearText);

  if (edgeWear && !result.defects.some((d) => /edge|whiten|silver/i.test(`${d.category} ${d.description}`))) {
    result.defects.push(inferDefectFromReasoning(result, 'edge'));
  }
  if (cornerWear && !result.defects.some((d) => /corner|nick|chip|ding/i.test(`${d.category} ${d.description}`))) {
    result.defects.push(inferDefectFromReasoning(result, 'corner'));
  }
}

export function applyDefectConsistency(result: GradingResult): GradingResult {
  const out: GradingResult = {
    ...result,
    defects: [...(result.defects || [])],
    riskFactors: [...(result.riskFactors || [])],
  };

  const worstWear = Math.min(out.corners, out.edges, out.surface);
  const reasoning = out.reasoning || '';
  const wearText = collectWearText(out);
  const phase2Wear = hasPhase2WearReasoning(reasoning);
  const harshSubgrades = out.edges <= 8.5 || out.corners <= 8.5;
  const veryHarsh = out.edges <= 5 || out.corners <= 5;
  const hasWearLanguage = mentionsVisibleWear(wearText);

  if (harshSubgrades && out.defects.length === 0 && (phase2Wear || hasWearLanguage) && (!veryHarsh || mentionsVisibleWear(reasoning))) {
    if (out.edges <= 8.5 && mentionsVisibleWear(wearText)) {
      out.defects.push(inferDefectFromReasoning(out, 'edge'));
    }
    if (out.corners <= 8.5 && /\b(corner|nick|chip|ding)\b/i.test(wearText)) {
      out.defects.push(inferDefectFromReasoning(out, 'corner'));
    }
    if (out.defects.length > 0) {
      out.reasoning = `${reasoning}\n\n[Consistency]: Defects inferred from wear language — model returned empty defects list.`.trim();
    }
  }

  if (out.defects.length === 0 && hasWearLanguage) {
    inferDefectsFromWearText(out);
    if (out.defects.length > 0) {
      out.reasoning = `${out.reasoning}\n\n[Consistency]: Defects inferred from risk factors / reasoning wear language.`.trim();
    }
  }

  if (isVintageRoughCut(out.detectedSet) && out.edges >= 9 && mentionsVisibleWear(wearText)) {
    out.edges = Math.min(out.edges, 8);
    const hasSilvering = out.defects.some((d) => /silver|whiten|edge/i.test(d.category + d.description));
    if (!hasSilvering) {
      out.defects.push({
        category: 'edge_silvering',
        description: 'Vintage set edge silvering/whitening detected in analysis — edges capped at 8 per rough-cut rules.',
        imageIndex: 1,
        confidence: 0.7,
        box2d: [],
        inferred: false,
      });
    }
    out.riskFactors.push('Vintage rough-cut set: white loss/silvering caps edges at 8 or below.');
  }

  if (isVintageRoughCut(out.detectedSet) && (hasWearLanguage || out.defects.length > 0)) {
    out.riskFactors.push(`${out.detectedSet}: dark borders amplify visible edge wear under grading.`);
    out.riskFactors.push('Distinguish factory rough cut (solid color) from post-production silvering.');
  }

  if (out.defects.some((d) => d.imageIndex === 1 && /edge|corner|whiten|silver/i.test(d.category + d.description))) {
    out.riskFactors.push('Back edge/corner wear limits PSA/BGS Mint grade ceiling.');
  }

  const subgrades = [out.centering, out.corners, out.edges, out.surface];
  const spread = Math.max(...subgrades) - Math.min(...subgrades);
  if (spread > 1.0) {
    out.riskFactors.push(`Subgrade spread (${spread.toFixed(1)}) — bottleneck subgrade limits overall grade.`);
  }

  if (out.centering >= 9 && out.detectedSet) {
    out.riskFactors.push('BGS/CGC apply strict centering math — vintage PSA leniency may not apply.');
  }

  let tcg = out.predictedGrades?.tcg || 'Lightly Played';
  const wearDefectCount = out.defects.filter((d) =>
    /edge|whiten|silver|corner|nick|chip|scuff|wear/i.test(`${d.category} ${d.description}`)
  ).length;

  if (worstWear <= 6.5) {
    tcg = maxTcgCondition(tcg, 'Moderately Played');
  } else if (worstWear <= 7.5 || wearDefectCount >= 2) {
    tcg = maxTcgCondition(tcg, 'Moderately Played');
  } else if (worstWear <= 8.5 || wearDefectCount >= 1 || (out.edges <= 8 || out.corners <= 8)) {
    tcg = maxTcgCondition(tcg, 'Lightly Played');
  }

  if (/\bwhitening\b/i.test(wearText) && /\bedge\s*wear\b/i.test(wearText)) {
    tcg = maxTcgCondition(tcg, 'Moderately Played');
  }

  if (out.predictedGrades) {
    out.predictedGrades = { ...out.predictedGrades, tcg };
  }

  out.riskFactors = [...new Set(out.riskFactors.filter(Boolean))];
  return out;
}
