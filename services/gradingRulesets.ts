/**
 * GRADING RULESETS PLUGIN
 * ------------------------
 * Modular grading rules selected based on card set/category.
 * Reduces Phase 2 prompt payload by injecting only relevant rules.
 * 
 * SCALE VALIDATION: All rulesets enforce the same valid grade list.
 * ALLOWED: 1, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10
 * FORBIDDEN: 0.5, 1.5, 9.5 (half grades only between 2 and 8.5; 1, 2, 9, 10 are whole only)
 */

export interface GradingRuleset {
  name: string;
  centering: string;
  edgeRules: string;
  cornerRules: string;
  scoreThresholds: string;
}

/** Valid grades list for AI enforcement. */
const VALID_GRADES = '1, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10';
const SCORING_FORMAT = `SCORING: Allowed grades: ${VALID_GRADES}. Half (.5) ONLY between 2 and 8.5. Grades 1, 2, 9, 10 are whole numbers. NO 9.5, NO 1.5, NO 0.5.`;

const MODERN_POKEMON_RULES: GradingRuleset = {
  name: 'Modern Pokemon',
  centering: 'CENTERING (PSA 2025): Front 55/45 for 10, 60/40 for 9, 65/35 for 8. Back 75/25 allowed. Grade PRINTED centering (borders), NOT photo alignment.',
  edgeRules: 'EDGES: 10 = sharp, no white. 9 = 1-2 microscopic white dots on back. 8 = 3-4 white touches.',
  cornerRules: 'CORNERS: 10 = no white specks. 9 = 1-2 very small specks on back. 8 = 3-4 white touches.',
  scoreThresholds: '10: No nicks, 55/45 front. 9: 1 minor flaw OR 60/40. 8: 3-4 white touches. 8.5 rare (between 8 and 9).'
};

const VINTAGE_ROUGH_CUT_RULES: GradingRuleset = {
  name: 'Vintage Rough Cut (Jungle/Fossil/Neo/Gym/Team Rocket)',
  centering: 'CENTERING (PSA 2025): Front 55/45 for 10, 60/40 for 9, 65/35 for 8. Back 75/25 allowed. Grade PRINTED centering, NOT photo alignment.',
  edgeRules: 'VINTAGE EDGES (Factory rough cut artifact): Jagged/fuzzy edges normal. PSA allows rough cuts for 10 IF no white loss (silvering). Check for WHITE LOSS, not roughness. If rough but color intact, edges 9-10 OK. If silvering visible, cap edges at 8 or below. 9 = minor silvering on 1 edge. 8 = light silvering on 1-2 edges.',
  cornerRules: 'CORNERS: 10 = virtually no white (ONE microscopic pinprick on ONE corner might pass if centering/surface perfect). 9 = 1-2 very small specks on back (if front clean). 8 = 3-4 white touches.',
  scoreThresholds: '10: No silvering, 55/45, rough cut OK if color solid. 9: 1-2 minor flaws OR 60/40. 8: 3-4 white touches, light silvering. 8.5 rare.'
};

const SPORTS_MODERN_RULES: GradingRuleset = {
  name: 'Sports (Modern)',
  centering: 'CENTERING: Front 55/45 for 10, 60/40 for 9. Back 75/25. Grade PRINTED centering, NOT photo alignment.',
  edgeRules: 'EDGES: 10 = sharp, no white. 9 = 1-2 microscopic dots. 8 = 3-4 white touches.',
  cornerRules: 'CORNERS: 10 = no white. 9 = 1-2 very small specks on back. 8 = 3-4 white touches.',
  scoreThresholds: '10: Virtually perfect. 9: 1 minor flaw. 8: 3-4 white touches. 8.5 rare.'
};

const DEFAULT_RULES: GradingRuleset = {
  name: 'Default (TCG)',
  centering: 'CENTERING: Front 55/45 for 10, 60/40 for 9. Back 75/25. Grade PRINTED centering, NOT photo alignment.',
  edgeRules: 'EDGES: 10 = sharp, no white. 9 = 1-2 microscopic dots. 8 = 3-4 white touches.',
  cornerRules: 'CORNERS: 10 = no white. 9 = 1-2 very small specks. 8 = 3-4 white touches.',
  scoreThresholds: '10: Virtually perfect. 9: 1 minor flaw. 8: 3-4 white touches. 8.5 rare.'
};

/**
 * Select the appropriate grading ruleset based on card set and category.
 */
export const selectGradingRuleset = (detectedSet: string, category: string): GradingRuleset => {
  const setLower = (detectedSet || '').toLowerCase();
  const catLower = (category || '').toLowerCase();

  // Vintage Pokemon sets with rough-cut edges (1999-2000)
  const vintageRoughCutSets = [
    'jungle', 'fossil', 'neo genesis', 'neo discovery', 'neo revelation', 'neo destiny',
    'gym heroes', 'gym challenge', 'team rocket'
  ];

  if (catLower.includes('pokemon') || catLower === 'pokemon') {
    if (vintageRoughCutSets.some(v => setLower.includes(v))) {
      return VINTAGE_ROUGH_CUT_RULES;
    }
    return MODERN_POKEMON_RULES;
  }

  if (catLower.includes('sport')) {
    return SPORTS_MODERN_RULES;
  }

  return DEFAULT_RULES;
};

/**
 * Build the compact Phase 2 prompt text using the selected ruleset.
 */
export const buildPhase2Prompt = (
  ruleset: GradingRuleset,
  cardName: string,
  cardSet: string,
  category: string,
  phase: 'A' | 'B',
  previousReasoning?: string,
  captureContext?: string
): string => {
  const tcgNote =
    'TCG FIELD: predictedGrades.tcg must be a TCGPlayer condition only — Near Mint, Lightly Played, Moderately Played, Heavily Played, or Damaged. Never use Gem Mint, Mint, NM-MT, or Pristine.';
  const base = `Card: ${cardName} (${cardSet}) — Category: ${category}.
TASK: Analyze ${phase === 'A' ? 'FRONT' : 'BACK'} scan and video frames for defects. Apply STRICT PSA/BGS grading.
${ruleset.centering}
CRITICAL CENTERING: Grade only the card's PRINTED border centering (artwork frame vs physical card edge). Do NOT penalize for camera angle, photo tilt, or how the card sits in the photo—those are capture artifacts. True centering = left/right and top/bottom border widths on the actual card; 55/45 = 10, 60/40 = 9, 65/35 = 8.
${ruleset.edgeRules}
${ruleset.cornerRules}
${ruleset.scoreThresholds}
${SCORING_FORMAT}
${tcgNote}
${captureContext ? `\n${captureContext}\n` : ''}
Return JSON: { "reasoning": str, "defects": [{"category": str, "reasoning": str, "box2d": [ymin, xmin, ymax, xmax], "imageIndex": int, "confidence": number}], "riskFactors": [str] }
Do NOT return numeric subgrades or predictedGrades — the math engine computes all grades from defects and ruler centering.
Image indices: 0 = ${phase === 'A' ? 'Front' : 'Back'}, 1-2 = Video (2 frames).
box2d = normalized [0-1]. imageIndex = integer. confidence = 0-1.
IMAGE USAGE: Use image 0 (flat scan) and video frames (images 1-2) to detect and list defects only.`;

  if (phase === 'B' && previousReasoning) {
    return `Earlier (Front): ${previousReasoning}\n\n${base}`;
  }
  return base;
};

/**
 * Validate a grade value against the allowed list.
 * Returns the corrected grade if invalid.
 */
export const validateGrade = (grade: number): number => {
  if (typeof grade !== 'number' || isNaN(grade) || grade <= 0) return 0;
  const snapped = Math.round(grade * 2) / 2;
  
  // Forbidden values
  if (snapped === 0.5 || snapped === 1.5) return 1;  // force to 1
  if (snapped === 9.5) return 9;                     // force to 9
  
  // Allowed: 1, 2, 2.5, 3, ..., 8, 8.5, 9, 10
  if (snapped === 2) return 2;
  if (snapped >= 10) return 10;
  if (snapped >= 2 && snapped <= 8.5) return snapped;
  if (snapped === 9 || snapped === 10) return snapped;
  
  // Fallback: clamp to 1-10
  return Math.max(1, Math.min(10, Math.round(grade)));
};
