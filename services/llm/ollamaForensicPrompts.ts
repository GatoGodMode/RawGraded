import type { GradingRuleset } from '../gradingRulesets';
import type { CardAnalysisWorkVector } from '../grading/cardAnalysisWorkVector';
import type { CardGridSlice } from '../grading/cardImagePipeline';

export interface OllamaCardMeta {
  detectedName: string;
  detectedSet: string;
  category: string;
}

export const NEVER_USE_BACK_FOR_IDENTITY = `
CRITICAL: Pokemon/TCG card backs are identical — NEVER infer name, set, card number, year, artist, or edition from a back scan.`;

export const FIRST_EDITION_RULE = `
1ST EDITION: Set detectedEdition to "1st Edition" ONLY if the set is one of: Base Set, Base Set 2, Fossil, Jungle, Team Rocket, Neo Genesis.
Otherwise use "Unlimited" or empty. Never infer 1st Edition from the back of the card.`;

export const OLLAMA_FORENSIC_JSON_SCHEMA = `{
  "reasoning": string,
  "defects": [{"category": string, "reasoning": string, "box2d": [ymin,xmin,ymax,xmax], "imageIndex": number, "confidence": number}],
  "riskFactors": [string]
}`;

export const OLLAMA_IDENTITY_TOP_JSON_SCHEMA = `{
  "detectedName": string, "detectedCharacter": string, "detectedSet": string, "detectedYear": string,
  "isHolographic": boolean, "holoPattern": string, "reasoning": string
}`;

export const OLLAMA_IDENTITY_BOTTOM_JSON_SCHEMA = `{
  "detectedCardNumber": string, "detectedArtist": string, "detectedEdition": string,
  "detectedSet": string, "reasoning": string
}`;

export const OLLAMA_RAPID_JSON_SCHEMA = `{
  "reasoning": string,
  "isHolographic": boolean,
  "holoPattern": string,
  "riskFactors": [string]
}`;

export const OLLAMA_BACK_CONDITION_JSON_SCHEMA = `{
  "backPrintQuality": string,
  "reasoning": string,
  "riskFactors": [string]
}`;

export const OLLAMA_OCR_JSON_SCHEMA = `{
  "name": string, "cardNumber": string, "hp": string, "type": string, "stage": string,
  "attacks": string, "weakness": string, "resistance": string, "retreat": string
}`;

export const OLLAMA_SYNTHESIS_JSON_SCHEMA = `{
  "reasoning": string,
  "identityNote": string
}`;

const HOLO_RULES = `
HOLOGRAPHIC: Set isHolographic true if foil/reflective surface visible.
HOLO PATTERN: cosmos, galaxy, cracked_ice, swirl, reverse, full_art, standard, or none.`;

export function buildOllamaOcrPrompt(hintCtx: string, deep: boolean): string {
  if (!deep) {
    return `OCR this Pokemon card FRONT top region. Return ONLY JSON: {"name": string, "number": string}
${NEVER_USE_BACK_FOR_IDENTITY}
${hintCtx}
Return ONLY valid JSON.`;
  }
  return `Extract readable text from this Pokemon card FRONT band.
Return ONLY valid JSON:
${OLLAMA_OCR_JSON_SCHEMA}
${NEVER_USE_BACK_FOR_IDENTITY}
${hintCtx}`;
}

export function buildRapidAssessmentPrompt(side: 'front' | 'back'): string {
  const extra =
    side === 'back'
      ? 'Catalog edge whitening, silvering, corner wear on the BACK only. Do NOT identify the card.'
      : 'Note holo/foil on the FRONT only. Do NOT assign numeric grades.';
  return `Rapid condition overview (~720px) of card ${side.toUpperCase()} scan.
${NEVER_USE_BACK_FOR_IDENTITY}
${extra}
Do NOT include detectedName, detectedSet, or detectedCardNumber.
Return ONLY valid JSON:
${OLLAMA_RAPID_JSON_SCHEMA}`;
}

export function buildIdentityTopBandPrompt(category: string, hintCtx: string, ocrCtx?: string): string {
  return `Identify this trading card from the FRONT TOP band (name, set, era, holo).
${NEVER_USE_BACK_FOR_IDENTITY}
${HOLO_RULES}
${FIRST_EDITION_RULE}
Do NOT assign numeric grades.
Return ONLY valid JSON:
${OLLAMA_IDENTITY_TOP_JSON_SCHEMA}
${hintCtx}
${ocrCtx ? `\nOCR:\n${ocrCtx}\n` : ''}
Category: ${category}`;
}

export function buildIdentityBottomBandPrompt(category: string, hintCtx: string, identityCtx?: string): string {
  return `Identify this trading card from the FRONT BOTTOM band (collector number, artist, edition stamp on front).
${NEVER_USE_BACK_FOR_IDENTITY}
${FIRST_EDITION_RULE}
Do NOT assign numeric grades.
${identityCtx ? `\nKNOWN FROM TOP BAND:\n${identityCtx}\n` : ''}
Return ONLY valid JSON:
${OLLAMA_IDENTITY_BOTTOM_JSON_SCHEMA}
${hintCtx}
Category: ${category}`;
}

export function buildOllamaBackConditionPrompt(hintCtx: string): string {
  return `Analyze BACK scan for print quality and edge/corner wear cues only.
${NEVER_USE_BACK_FOR_IDENTITY}
Do NOT return detectedName, detectedSet, detectedCardNumber, detectedEdition, or detectedYear.
Return ONLY valid JSON:
${OLLAMA_BACK_CONDITION_JSON_SCHEMA}
${hintCtx}`;
}

export function buildChunkForensicPrompt(
  ruleset: GradingRuleset,
  meta: OllamaCardMeta,
  slice: CardGridSlice,
  imageIndex: number,
  workVectorCtx?: string
): string {
  const side = slice.side.toUpperCase();
  const backNote =
    slice.side === 'back'
      ? '\nBACK CHUNK: prioritize edge whitening, silvering, corner chips visible on this back region.'
      : '';

  return `Card: ${meta.detectedName} (${meta.detectedSet}) — ${meta.category}
Ruleset: ${ruleset.name}
GRID POSITION: ${slice.label} — row ${slice.row + 1}, col ${slice.col + 1} (chunk ${slice.index + 1}/9) on ${side}
TASK: DEFECT CATALOG ONLY for this crop. Do NOT assign numeric grades.
${ruleset.edgeRules}
${ruleset.cornerRules}
${backNote}
${workVectorCtx ? `\nACCUMULATED:\n${workVectorCtx}\n` : ''}
- box2d normalized 0-1 within THIS crop only.
- Set imageIndex to ${imageIndex} for every defect.
${NEVER_USE_BACK_FOR_IDENTITY}
Return ONLY valid JSON:
${OLLAMA_FORENSIC_JSON_SCHEMA}`;
}

export function buildOllamaSynthesisPrompt(workVector: CardAnalysisWorkVector): string {
  const ctx = workVector.toPromptContext('synthesis');
  const { defects, conflicts } = workVector.compileEvidence();
  const defectSummary = defects
    .slice(0, 24)
    .map((d) => `- [img${d.imageIndex}] ${d.category}: ${d.description.slice(0, 120)}`)
    .join('\n');

  const lowIdNote =
    workVector.identityConfidence === 'low'
      ? 'In identityNote only: state that FRONT text/bands were unclear for set or card number. Do NOT mention the back scan for identity.'
      : '';

  return `You are RawGraded final assessment synthesizer. Write a unified narrative ONLY — do NOT assign numeric grades.
Do NOT invent new defects.
${NEVER_USE_BACK_FOR_IDENTITY}
Identity in this report comes ONLY from front-band OCR/identification. The back scan is for edge wear, whitening, and centering only — never cite the back for name, set, card number, edition, year, or artist.
${lowIdNote}
${conflicts.length ? `CONFLICTS:\n${conflicts.join('\n')}\n` : ''}

WORK VECTOR:
${ctx}

DEFECTS (${defects.length}):
${defectSummary || 'None'}

Return ONLY valid JSON:
${OLLAMA_SYNTHESIS_JSON_SCHEMA}`;
}

export function buildOllamaFramePrompt(
  ruleset: GradingRuleset,
  meta: OllamaCardMeta,
  frameLabel: string,
  imageIndex: number,
  workVectorCtx?: string
): string {
  return `Card: ${meta.detectedName} (${meta.detectedSet})
TASK: DEFECT CATALOG on video frame "${frameLabel}". Do NOT assign numeric grades.
${workVectorCtx ? `\nACCUMULATED:\n${workVectorCtx}\n` : ''}
${ruleset.edgeRules}
${ruleset.cornerRules}
- imageIndex ${imageIndex} for all defects.
Return ONLY valid JSON:
${OLLAMA_FORENSIC_JSON_SCHEMA}`;
}

/** @deprecated Use buildOllamaBackConditionPrompt — back is never used for identity. */
export function buildOllamaBackIdentityPrompt(_identityCtx: string, hintCtx: string): string {
  return buildOllamaBackConditionPrompt(hintCtx);
}

/** @deprecated Full-frame forensic replaced by 3×3 chunks. */
export function buildOllamaPhase1Prompt(
  category: string,
  _centeringCtx: string,
  candidateCtx: string,
  hintCtx: string,
  ocrCtx?: string
): string {
  return buildIdentityTopBandPrompt(category, hintCtx, ocrCtx) + candidateCtx;
}

export function buildOllamaForensicPrompt(
  ruleset: GradingRuleset,
  meta: OllamaCardMeta,
  phase: 'A' | 'B',
  _centeringCtx: string,
  _previousReasoning?: string,
  captureContext?: string,
  workVectorCtx?: string
): string {
  const slice: CardGridSlice = {
    side: phase === 'A' ? 'front' : 'back',
    row: 1,
    col: 1,
    index: 4,
    label: phase === 'A' ? 'front R2C2' : 'back R2C2',
    dataUrl: '',
  };
  const imageIndex = phase === 'A' ? 104 : 204;
  return buildChunkForensicPrompt(ruleset, meta, slice, imageIndex, workVectorCtx) + (captureContext ? `\n${captureContext}` : '');
}

export function buildOllamaDefectScanPrompt(
  ruleset: GradingRuleset,
  meta: OllamaCardMeta,
  phase: 'A' | 'B',
  workVectorCtx: string,
  captureContext?: string
): string {
  return buildOllamaForensicPrompt(ruleset, meta, phase, '', undefined, captureContext, workVectorCtx);
}

export function selectForensicFrameIndices(totalFrames: number): { index: number; label: string }[] {
  if (totalFrames <= 0) return [];
  const picks: { index: number; label: string }[] = [];
  if (totalFrames >= 5) {
    picks.push({ index: 3, label: 'back tilt' });
    picks.push({ index: 4, label: 'back macro' });
  } else if (totalFrames >= 3) {
    picks.push({ index: totalFrames - 2, label: 'tilt frame' });
    picks.push({ index: totalFrames - 1, label: 'macro frame' });
  } else {
    picks.push({ index: totalFrames - 1, label: 'video frame' });
  }
  return picks;
}

export function formatDefectListForPrompt(defects: { category: string; description: string; imageIndex: number }[]): string {
  if (!defects.length) return '';
  return defects.map((d) => `- [img${d.imageIndex}] ${d.category}: ${d.description}`).join('\n');
}
