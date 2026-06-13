import { GoogleGenAI, Type } from "@google/genai";
import { TCGPLAYER_STANDARDS_CONTEXT, PREDICTED_GRADES_CONTEXT } from "../constants";
import { GradingResult } from "../types";
import { resizeImage } from "./imageUtils";
import { selectGradingRuleset, buildPhase2Prompt } from "./gradingRulesets";
import { applyDefectConsistency } from "./grading/defectConsistency";
import { reconcileGradingReasoning } from "./grading/reconcileReasoning";
import { applyTcgNormalization } from "./grading/tcgGradeNormalize";
import {
  applyComputedGradesToResult,
  computeGradesFromEvidence,
} from "./grading/gradingMathEngine";
import {
  buildCenteringAssessmentPrompt,
  buildAdvisoryCenteringContext,
  parseCenteringAssessment,
  type CenteringAssessment,
} from "./grading/centeringAssessment";
import type { CenteringMeasurement } from "../types";
import {
  buildHouseChecksPrompt,
  buildSlabAuthInstructionsBlock,
  type SlabGradingHouse,
} from "./slabAuthenticityRules";
import { buildGeminiTcgdexContext, lookupPokemonCandidates } from "./pricing/tcgdexLookup";
import {
  cropFrontIdentityBands,
  chunkImageIndex,
  type CardGridSlice,
} from "./grading/cardImagePipeline";
import { sanitizeDetectedEdition } from "./grading/firstEditionGuard";
import {
  buildChunkForensicPrompt,
  FIRST_EDITION_RULE,
  NEVER_USE_BACK_FOR_IDENTITY,
} from "./llm/ollamaForensicPrompts";
import { buildLockedHintPromptBlock } from "./grading/authoritativeIdentity";

declare const process: any;

const cleanBase64 = (dataUrl: string) => {
  if (!dataUrl) return '';
  if (dataUrl.includes(',')) return dataUrl.split(',')[1];
  return dataUrl;
};

// --- JSON Parsing Safety Filter ---
// Gemini (especially the v3 previews) occasionally ignores responseMimeType="application/json" 
// and wraps the output in ```json ... ``` markdown. This strips it.
const cleanJsonResponse = (text: string): string => {
  if (!text) return '{}';
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    return text.substring(firstBrace, lastBrace + 1);
  }
  return text.trim().replace(/^```(json)?\s*/i, '').replace(/\s*```$/i, '').trim();
};

// --- RawGraded Scale Enforcer ---
// ALLOWED: 1, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10
// FORBIDDEN: 0.5, 1.5, 9.5 (half grades only between 2 and 8.5; 1, 2, 9, 10 are whole only)
const snapToPsaScale = (val: number): number => {
  if (typeof val !== 'number' || isNaN(val) || val <= 0) return 0;
  const snapped = Math.round(val * 2) / 2;
  
  // Force whole numbers for 1, 2, 9, 10
  if (snapped <= 1.5) return 1;      // 0.5, 1, 1.5 → 1
  if (snapped === 2) return 2;       // 2 stays 2 (whole)
  if (snapped >= 9.5) return snapped >= 10 ? 10 : 9;  // 9.5 → 9, 10 → 10
  
  // Half grades allowed only between 2 and 8.5
  return snapped;  // 2.5, 3, 3.5, ..., 8, 8.5 allowed
};

/** Phase 2/3 model: Gemini 3.1 Pro Preview (successor to gemini-3-pro-preview; better capacity, less 503). */
const PHASE2_MODEL = 'gemini-3.1-pro-preview';
const PHASE2_MODEL_FREE_TIER = 'gemini-2.5-flash';

export async function resolvePhase2Model(): Promise<string> {
  try {
    const { loadDesktopLlmSettings } = await import('./desktopSettings');
    const s = await loadDesktopLlmSettings();
    if (s.geminiFreeTierMode) return PHASE2_MODEL_FREE_TIER;
  } catch {
    /* use default Pro model */
  }
  return PHASE2_MODEL;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 4000;
/** Phase 2 forensics can be slow; timeout per attempt so we don't hang indefinitely (then retry).
 *  This is a ceiling per single Gemini call only: when the call resolves we proceed immediately; no extra wait. */
const PHASE2_REQUEST_TIMEOUT_MS = 240000; // 4 min per attempt (Phase 2 can be slow on large multi-image payloads)

/** Buffer after Phase 1 so API can settle before Batch A. */
export const PHASE2_DELAY_AFTER_IDENTIFICATION_MS = 1000;
/** Delay between Batch A and Batch B to avoid burst rate limits. */
export const PHASE2_DELAY_BETWEEN_BATCHES_MS = 2000;
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Timeout wrapper: rejects after ms with an error that can be retried. */
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
};

/** Phase 2 timing: server log (api/phase2_debug.log when admin) + Admin Debug Console. */
const debugLog = (payload: Record<string, unknown>) => {
  fetch('api/phase2_debug.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) }).catch(() => {});
  console.log('[DEBUG-PHASE2]', JSON.stringify(payload));
};

/** Retry generateContent on 503 (overloaded), 429 (rate limit), or timeout; exponential backoff. */
const generateContentWithRetry = async (
  ai: InstanceType<typeof GoogleGenAI>,
  opts: { model: string; contents: { parts: any[] }; config: Record<string, any>; requestTimeoutMs?: number }
): Promise<{ text: string }> => {
  const timeoutMs = opts.requestTimeoutMs ?? 0;
  let lastError: any;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // #region agent log
    const attemptStart = Date.now();
    debugLog({ location: 'geminiService.ts:generateContentWithRetry', message: 'Gemini attempt start', data: { attempt, partsCount: opts.contents.parts?.length ?? 0 }, timestamp: Date.now(), hypothesisId: 'H2' });
    // #endregion
    try {
      const call = ai.models.generateContent({
        model: opts.model,
        contents: opts.contents,
        config: opts.config,
      });
      const response = timeoutMs > 0
        ? await withTimeout(call, timeoutMs, 'Gemini generateContent')
        : await call;
      // #region agent log
      debugLog({ location: 'geminiService.ts:generateContentWithRetry', message: 'Gemini attempt success', data: { attempt, elapsedMs: Date.now() - attemptStart }, timestamp: Date.now(), hypothesisId: 'H2' });
      // #endregion
      return response;
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.statusCode ?? err?.response?.status;
      const msg = (err?.message ?? String(err)).toLowerCase();
      const isRetryable =
        status === 503 || status === 429 ||
        msg.includes('503') || msg.includes('overloaded') || msg.includes('resource exhausted') ||
        msg.includes('timed out');
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      // #region agent log
      debugLog({ location: 'geminiService.ts:generateContentWithRetry', message: 'Gemini attempt retry', data: { attempt, isRetryable, delayMs: delay, elapsedMs: Date.now() - attemptStart, status, msg: msg.slice(0, 80) }, timestamp: Date.now(), hypothesisId: 'H3' });
      // #endregion
      if (!isRetryable || attempt === MAX_RETRIES - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
};

// Cache the API key in memory to avoid repeated API calls
let cachedApiKey: string | null = null;
let keyFetchAttempted = false;

export function clearGeminiApiKeyCache(): void {
  cachedApiKey = null;
  keyFetchAttempted = false;
}

const getApiKey = async (): Promise<string> => {
  if (cachedApiKey) return cachedApiKey;

  try {
    const { loadDesktopLlmSettings } = await import('./desktopSettings');
    const desktop = await loadDesktopLlmSettings();
    if (desktop.geminiApiKey) {
      cachedApiKey = desktop.geminiApiKey;
      return desktop.geminiApiKey;
    }
  } catch {
    /* not desktop */
  }

  if (!keyFetchAttempted) {
    keyFetchAttempted = true;
    try {
      console.log("Fetching API key from DB...");
      // 5-second timeout for the settings fetch to prevent hangs
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('api/settings.php?action=get_settings', {
        credentials: 'include',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const dbKey = data?.data?.gemini_api_key || '';
        if (dbKey) {
          console.log("API Key fetched successfully from DB.");
          cachedApiKey = dbKey;
          return dbKey;
        }
      }
    } catch (error) {
      console.warn('API key fetch diverted to environment fallback:', error);
    }
  }

  console.log("Using environment/fallback API key.");
  const envKey = (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.API_KEY) : null) || '';

  if (envKey) cachedApiKey = envKey;
  return envKey;
};

export const getAutoCropSettings = async (imageBase64: string): Promise<{ x: number, y: number, zoom: number, rotation: number, tiltX: number, tiltY: number } | null> => {
  try {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const modelId = 'gemini-2.5-flash';

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          { text: `Analyze this trading card image. Return JSON to crop it perfectly flat: { "x": center%, "y": center%, "zoom": scale, "rotation": degrees, "tiltX": skew, "tiltY": skew }` },
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64(imageBase64) } }
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            x: { type: Type.NUMBER },
            y: { type: Type.NUMBER },
            zoom: { type: Type.NUMBER },
            rotation: { type: Type.NUMBER },
            tiltX: { type: Type.NUMBER },
            tiltY: { type: Type.NUMBER },
          },
        },
      }
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text);

  } catch (error) {
    console.error("AI Crop Error:", error);
    return null;
  }
};

/** Sniper: one quick scan — price/shipping if visible, else card identity for title. Client-side only; no credit. */
export const analyzeListingImages = async (
  images: string[]
): Promise<{
  suggestedPrice?: number;
  freeShipping?: boolean;
  suggestedShippingCost?: number;
  suggestedTitle?: string;
}> => {
  if (!images.length) return {};
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return {};
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [
      {
        text: `Look at the provided image(s) of a card listing (screenshot, marketplace, eBay, TCGPlayer, or photo of a card).

1. PRICE: If you see a listed/asking price in USD, extract it as a number (no $). If multiple prices, use the main asking price. If no price is visible, use null for suggestedPrice.
2. SHIPPING: (a) If the listing says free shipping or you see that indicated, set freeShipping true and suggestedShippingCost 0 or null. (b) If you see a specific shipping cost in USD (e.g. "+$3.99 shipping", "Shipping: $2.50", "$4.99 S&H"), extract that number and set suggestedShippingCost to it; set freeShipping false. If no shipping info is visible, use null for suggestedShippingCost.
3. CARD IDENTITY: Identify the trading card if visible: name, set, and set number (e.g. "Charizard Holo - Base Set #4" or "Pikachu - Evolutions 26/108"). If the card has a holographic/foil/galaxy/prism surface, include "Holo" or "Foil" in the title. If you cannot identify the card, use empty string for suggestedTitle.

Return JSON only: { "suggestedPrice": number or null, "freeShipping": boolean, "suggestedShippingCost": number or null, "suggestedTitle": string }.`
      },
      ...images.slice(0, 4).map((img) => ({
        inlineData: { mimeType: 'image/jpeg', data: cleanBase64(img) } as const
      }))
    ];
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestedPrice: { type: Type.NUMBER },
            freeShipping: { type: Type.BOOLEAN },
            suggestedShippingCost: { type: Type.NUMBER },
            suggestedTitle: { type: Type.STRING },
          },
        },
      },
    });
    const text = response.text;
    if (!text) return {};
    const parsed = JSON.parse(cleanJsonResponse(text));
    const suggestedPrice =
      typeof parsed.suggestedPrice === 'number' && !isNaN(parsed.suggestedPrice) ? parsed.suggestedPrice : undefined;
    const freeShipping = parsed.freeShipping === true;
    const suggestedShippingCost =
      typeof parsed.suggestedShippingCost === 'number' && !isNaN(parsed.suggestedShippingCost) && parsed.suggestedShippingCost >= 0
        ? parsed.suggestedShippingCost
        : undefined;
    const suggestedTitle =
      typeof parsed.suggestedTitle === 'string' && parsed.suggestedTitle.trim() !== ''
        ? parsed.suggestedTitle.trim()
        : undefined;
    return { suggestedPrice, freeShipping, suggestedShippingCost, suggestedTitle };
  } catch (e) {
    console.error('analyzeListingImages:', e);
    return {};
  }
};

/** Legacy: same as analyzeListingImages but only price/shipping (for manual "Get price from photos" if kept). */
export const extractPriceFromImages = async (
  images: string[]
): Promise<{ suggestedPrice?: number; freeShipping?: boolean }> => {
  const out = await analyzeListingImages(images);
  return { suggestedPrice: out.suggestedPrice, freeShipping: out.freeShipping };
};

// analyzeCardCondition removed in favor of multi-phase flow

export interface SurgicalVerificationOptions {
  centeringMeasurement?: CenteringMeasurement;
  useMeasuredCentering?: boolean;
  category?: string;
}

export const surgicalVerification = async (
  _frontImage: string,
  _backImage: string,
  _videoFrames: string[],
  initialResult: GradingResult,
  onStatus?: (status: string) => void,
  mathOptions?: SurgicalVerificationOptions
): Promise<GradingResult> => {
  if (onStatus) onStatus('Computing grades from evidence...');

  const consistent = applyDefectConsistency(initialResult);
  const ruleset = selectGradingRuleset(
    consistent.detectedSet,
    mathOptions?.category || 'Pokemon'
  );

  const computed = computeGradesFromEvidence({
    defects: consistent.defects || [],
    detectedSet: consistent.detectedSet,
    centeringMeasurement: mathOptions?.centeringMeasurement,
    useMeasuredCentering: mathOptions?.useMeasuredCentering ?? true,
    ruleset,
    riskFactors: consistent.riskFactors,
    reasoning: consistent.reasoning,
    identity: {
      detectedName: consistent.detectedName,
      detectedSet: consistent.detectedSet,
      detectedYear: consistent.detectedYear,
      detectedEdition: consistent.detectedEdition,
      detectedCardNumber: consistent.detectedCardNumber,
      detectedArtist: consistent.detectedArtist,
      detectedCharacter: consistent.detectedCharacter,
      isHolographic: consistent.isHolographic,
      holoPattern: consistent.holoPattern,
    },
  });

  const engineResult = applyComputedGradesToResult(consistent, computed);
  const normalized = applyTcgNormalization(engineResult);

  return reconcileGradingReasoning(normalized);
};

export const runGeminiCenteringAssessment = async (
  frontImage: string,
  backImage: string,
  centeringMeasurement?: CenteringMeasurement
): Promise<CenteringAssessment | null> => {
  try {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildCenteringAssessmentPrompt(buildAdvisoryCenteringContext(centeringMeasurement));
    const frontClean = cleanBase64(frontImage);
    const backClean = cleanBase64(backImage);
    const response = await generateContentWithRetry(ai, {
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: frontClean } },
          { inlineData: { mimeType: 'image/jpeg', data: backClean } },
        ],
      },
      config: { responseMimeType: 'application/json' },
      requestTimeoutMs: PHASE2_REQUEST_TIMEOUT_MS,
    });
    const parsed = JSON.parse(cleanJsonResponse(response.text || '{}'));
    return parseCenteringAssessment(parsed);
  } catch (err) {
    console.warn('Gemini centering assessment failed:', err);
    return null;
  }
};


const GEMINI_IDENTITY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reasoning: { type: Type.STRING },
    detectedName: { type: Type.STRING },
    detectedCharacter: { type: Type.STRING },
    detectedSet: { type: Type.STRING },
    detectedYear: { type: Type.STRING },
    detectedEdition: { type: Type.STRING },
    detectedCardNumber: { type: Type.STRING },
    detectedArtist: { type: Type.STRING },
    isHolographic: { type: Type.BOOLEAN },
    holoPattern: { type: Type.STRING },
  },
};

/** Front-only identity from top + bottom bands (never uses back scan). */
export const identifyCardFromFront = async (
  topBand: string,
  bottomBand: string,
  category?: string,
  userHint?: string
): Promise<GradingResult | null> => {
  const modelId = 'gemini-2.5-flash';
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('API Key Missing');
    const ai = new GoogleGenAI({ apiKey });

    const topClean = cleanBase64(topBand);
    const bottomClean = cleanBase64(bottomBand);

    let tcgApiData = '';
    if (category === 'Pokemon' || !category) {
      try {
        let cardName = userHint || '';
        let cardNumber = '';
        if (!userHint) {
          const ocrResp = await ai.models.generateContent({
            model: modelId,
            contents: {
              parts: [
                {
                  text: `OCR this card FRONT top band. Return ONLY JSON: {"name": string, "number": string}. ${NEVER_USE_BACK_FOR_IDENTITY}`,
                },
                { inlineData: { mimeType: 'image/jpeg', data: topClean } },
              ],
            },
            config: { responseMimeType: 'application/json' },
          });
          const ocrText = ocrResp.text;
          if (ocrText) {
            const ocrJson = JSON.parse(cleanJsonResponse(ocrText));
            cardName = ocrJson.name || '';
            cardNumber = ocrJson.number || '';
          }
        }
        if (cardName) {
          const candidates = await lookupPokemonCandidates(cardName, cardNumber);
          if (candidates.length > 0) tcgApiData = buildGeminiTcgdexContext(candidates);
        }
      } catch (e) {
        console.log('TCGdex pre-flight failed:', e);
      }
    }

    const hintInjection = buildLockedHintPromptBlock(userHint);

    const promptText = `
      ${NEVER_USE_BACK_FOR_IDENTITY}
      ${FIRST_EDITION_RULE}
      ${hintInjection}
      CARD CATEGORY: ${category || 'Pokemon'}
      TASK: IDENTIFY from FRONT TOP band (image 1) and FRONT BOTTOM band (image 2) only.
      Extract name, character, set, year, edition, card number, artist, holo flags.
      Do NOT assign numeric centering/corners/edges/surface/overall grades.
      HOLOGRAPHIC: Set isHolographic if foil visible. holoPattern: cosmos, galaxy, cracked_ice, swirl, reverse, full_art, standard, or none.
      ${tcgApiData}
      Return FLAT JSON.
    `;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          { text: promptText },
          { inlineData: { mimeType: 'image/jpeg', data: topClean } },
          { inlineData: { mimeType: 'image/jpeg', data: bottomClean } },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_IDENTITY_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) return null;
    const parsed = JSON.parse(cleanJsonResponse(text));
    const VALID_HOLO_PATTERNS = ['cosmos', 'galaxy', 'cracked_ice', 'swirl', 'reverse', 'full_art', 'standard', 'none'];
    const rawPattern = String(parsed.holoPattern || 'none').toLowerCase().replace(/[\s-]+/g, '_');
    const holoPattern = VALID_HOLO_PATTERNS.includes(rawPattern)
      ? rawPattern
      : parsed.isHolographic
        ? 'standard'
        : 'none';

    return {
      centering: 0,
      corners: 0,
      edges: 0,
      surface: 0,
      overall: 0,
      reasoning: String(parsed.reasoning || ''),
      defects: [],
      detectedName: String(parsed.detectedName || ''),
      detectedCharacter: String(parsed.detectedCharacter || ''),
      detectedSet: String(parsed.detectedSet || ''),
      detectedYear: String(parsed.detectedYear || ''),
      detectedEdition: sanitizeDetectedEdition(
        String(parsed.detectedSet || ''),
        String(parsed.detectedEdition || '')
      ),
      detectedCardNumber: String(parsed.detectedCardNumber || ''),
      detectedArtist: String(parsed.detectedArtist || ''),
      isHolographic: parsed.isHolographic === true,
      holoPattern,
    };
  } catch (error) {
    console.error('identifyCardFromFront failed:', error);
    return null;
  }
};

const CHUNK_BATCH_SIZE = 3;

/** 3×3 chunk forensic passes (batched images per request). */
export const refineGradingChunkGrid = async (
  frontGrid: CardGridSlice[],
  backGrid: CardGridSlice[],
  initialResult: GradingResult,
  onStatus?: (status: string) => void,
  captureContext?: string
): Promise<GradingResult> => {
  const allSlices = [...frontGrid, ...backGrid];
  if (allSlices.length === 0) return initialResult;

  try {
    const apiKey = await getApiKey();
    const phase2Model = await resolvePhase2Model();
    const ai = new GoogleGenAI({ apiKey });
    const category = (initialResult as GradingResult & { category?: string }).category || 'Pokemon';
    const ruleset = selectGradingRuleset(initialResult.detectedSet, category);
    const cardMeta = {
      detectedName: initialResult.detectedName,
      detectedSet: initialResult.detectedSet,
      category,
    };

    const allDefects: GradingResult['defects'] = [...(initialResult.defects || [])];
    const riskFactors: string[] = [...(initialResult.riskFactors || [])];
    const reasoningParts: string[] = [];

    for (let i = 0; i < allSlices.length; i += CHUNK_BATCH_SIZE) {
      const batch = allSlices.slice(i, i + CHUNK_BATCH_SIZE);
      onStatus?.(`Forensic ${batch.map((s) => s.label).join(', ')}...`);

      const prompts = batch.map((slice) => {
        const imageIndex = chunkImageIndex(slice.side, slice.row, slice.col);
        return buildChunkForensicPrompt(ruleset, cardMeta, slice, imageIndex);
      });

      const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [
        {
          text: `Analyze ${batch.length} card crops. Return ONE JSON object with "defects" (all chunks) and "reasoning".
${NEVER_USE_BACK_FOR_IDENTITY}
${captureContext ? `\nCAPTURE:\n${captureContext}\n` : ''}
${prompts.map((p, idx) => `\n--- CHUNK ${idx + 1} ---\n${p}`).join('\n')}`,
        },
      ];
      for (const slice of batch) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanBase64(slice.dataUrl) } });
      }

      const response = await generateContentWithRetry(ai, {
        model: phase2Model,
        contents: { parts },
        config: { responseMimeType: 'application/json' },
        requestTimeoutMs: PHASE2_REQUEST_TIMEOUT_MS,
      });

      const result = JSON.parse(cleanJsonResponse(response.text || '{}'));
      if (result.reasoning) reasoningParts.push(String(result.reasoning));
      if (Array.isArray(result.riskFactors)) {
        for (const f of result.riskFactors) {
          if (typeof f === 'string' && f.trim()) riskFactors.push(f.trim());
        }
      }
      const defects = (result.defects || []).map((d: Record<string, unknown>) => ({
        category: String(d.category || 'defect'),
        description: String(d.reasoning || d.description || '').trim() || 'No detail provided.',
        imageIndex: typeof d.imageIndex === 'number' ? d.imageIndex : chunkImageIndex(batch[0].side, batch[0].row, batch[0].col),
        confidence: typeof d.confidence === 'number' ? d.confidence : 0.75,
        box2d: Array.isArray(d.box2d) ? (d.box2d as number[]) : [],
      }));
      allDefects.push(...defects);
    }

    return {
      ...initialResult,
      reasoning: reasoningParts.length
        ? `[Chunk forensics]: ${reasoningParts.join(' | ')}`
        : initialResult.reasoning,
      defects: allDefects,
      riskFactors: [...new Set(riskFactors)],
    };
  } catch (error) {
    console.error('refineGradingChunkGrid failed:', error);
    return initialResult;
  }
};

export const identifyAndInitialGrade = async (frontImage: string, _backImage: string, category?: string, userHint?: string): Promise<GradingResult | null> => {
  const modelId = 'gemini-2.5-flash';
  try {
    console.log("AI Phase 1: Identifying (front bands only)...");
    const bands = await cropFrontIdentityBands(frontImage);
    return identifyCardFromFront(bands.topBand, bands.bottomBand, category, userHint);
  } catch (error: any) {
    console.error("AI Phase 1 Error:", error);
    if (error.status === 404) {
      console.error("404 DETAILS: Model not found or API Key invalid for this model.");
      console.error("Attempted Model:", modelId);
    }
    return null;
  }
};

export interface CollectOnlyIdentification {
  detectedName: string;
  detectedCharacter: string;
  detectedSet: string;
  detectedYear: string;
  detectedEdition: string;
  detectedCardNumber: string;
  detectedArtist: string;
  rarity: string;
  isHolographic: boolean;
  holoPattern: string;
  isFirstEdition: boolean;
  aiDescription: string;
  grades?: {
    overall: number;
    centering: number;
    corners: number;
    edges: number;
    surface: number;
  };
}

export const identifyCollectOnly = async (
  frontImage: string,
  backImage: string,
  category?: string
): Promise<CollectOnlyIdentification | null> => {
  const modelId = 'gemini-2.5-flash';
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("API Key Missing");
    const ai = new GoogleGenAI({ apiKey });

    const frontClean = cleanBase64(frontImage);
    const backClean = cleanBase64(backImage);

    // --- PRE-FLIGHT: POKEMON TCG API LOOKUP (TCGDex) ---
    let tcgApiData = '';
    if (category === 'Pokemon' || !category) {
      try {
        // OCR just for coarse card name + number; strict matching happens in TCGDex.
        const ocrResp = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
            parts: [
              {
                text: 'Look at this Pokemon card. Return ONLY a JSON object with two fields: "name" (pokemon name) and "number" (card number like "4/102" or "26"). If you cannot read it, return empty strings.',
              },
              { inlineData: { mimeType: 'image/jpeg', data: frontClean } },
            ],
          },
          config: { responseMimeType: "application/json" },
        });

        const ocrText = ocrResp.text;
        if (ocrText) {
          const ocrJson = JSON.parse(cleanJsonResponse(ocrText));
          const cardName = ocrJson.name || '';
          const cardNumber = ocrJson.number || '';

          if (cardName) {
            const candidates = await lookupPokemonCandidates(cardName, cardNumber);
            if (candidates.length > 0) {
              tcgApiData = buildGeminiTcgdexContext(candidates);
            }
          }
        }
      } catch (e) {
        console.log("TCGdex API pre-flight failed (continuing without it):", e);
      }
    }

    const promptText = `
      ${TCGPLAYER_STANDARDS_CONTEXT}
      CARD CATEGORY: ${category || 'Pokemon'}
      TASK: IDENTIFY the card AND provide a RAPID GRADE condition assessment.

      REQUIREMENTS:
      - Use the TCGDex matches in tcgApiData (if present) as the source of truth for official set/artist/variant flags.
      - Condition Grading: Evaluate the raw card using stringent RawGrade standards (Centering, Corners, Edges, Surface, and Overall on a 1-10 scale). 
      - Scale Rules: Allowed overall and subgrades are 1, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10. Half grades ONLY between 2 and 8.5. NO 9.5s.
      - aiDescription must be 2-4 sentences: summary of card identity and the most notable flaws justifying the rapid grade.
      - IMPORTANT: Do NOT predict or output PSA, BGS, CGC, or TAG equivalent grades. Skip 3rd party predictions entirely.
      - HOLO PATTERN: If isHolographic is true, set holoPattern to the specific foil pattern type visible on the card. Valid values: "cosmos" (circular dots/bubbles), "galaxy" (scattered star sparkles), "cracked_ice" (angular cell/shard pattern), "swirl" (visible spiral pattern in the foil), "reverse" (foil on borders/text but NOT the main artwork), "full_art" (entire card surface is textured foil), "standard" (classic uniform holofoil on artwork window only). If not holographic, set holoPattern to "none".

      Return FLAT JSON ONLY.
      ${tcgApiData}
    `;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          { text: promptText },
          { inlineData: { mimeType: 'image/jpeg', data: frontClean } },
          { inlineData: { mimeType: 'image/jpeg', data: backClean } },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedName: { type: Type.STRING },
            detectedCharacter: { type: Type.STRING },
            detectedSet: { type: Type.STRING },
            detectedYear: { type: Type.STRING },
            detectedEdition: { type: Type.STRING },
            detectedCardNumber: { type: Type.STRING },
            detectedArtist: { type: Type.STRING },
            rarity: { type: Type.STRING },
            isHolographic: { type: Type.BOOLEAN },
            holoPattern: { type: Type.STRING },
            isFirstEdition: { type: Type.BOOLEAN },
            aiDescription: { type: Type.STRING },
            overallGrade: { type: Type.NUMBER },
            centeringGrade: { type: Type.NUMBER },
            cornersGrade: { type: Type.NUMBER },
            edgesGrade: { type: Type.NUMBER },
            surfaceGrade: { type: Type.NUMBER },
          },
        },
      },
    });

    const text = response.text;
    if (!text) return null;
    const parsed = JSON.parse(cleanJsonResponse(text));

    const VALID_HOLO_PATTERNS = ['cosmos', 'galaxy', 'cracked_ice', 'swirl', 'reverse', 'full_art', 'standard', 'none'];
    const rawHp = String(parsed.holoPattern || 'none').toLowerCase().replace(/[\s-]+/g, '_');
    const holoPattern = VALID_HOLO_PATTERNS.includes(rawHp) ? rawHp : (parsed.isHolographic ? 'standard' : 'none');

    return {
      detectedName: String(parsed.detectedName || ''),
      detectedCharacter: String(parsed.detectedCharacter || ''),
      detectedSet: String(parsed.detectedSet || ''),
      detectedYear: String(parsed.detectedYear || ''),
      detectedEdition: String(parsed.detectedEdition || ''),
      detectedCardNumber: String(parsed.detectedCardNumber || ''),
      detectedArtist: String(parsed.detectedArtist || ''),
      rarity: String(parsed.rarity || ''),
      isHolographic: parsed.isHolographic === true,
      holoPattern,
      isFirstEdition: parsed.isFirstEdition === true,
      aiDescription: String(parsed.aiDescription || '').trim(),
      grades: {
        overall: snapToPsaScale(parsed.overallGrade || 0),
        centering: snapToPsaScale(parsed.centeringGrade || 0),
        corners: snapToPsaScale(parsed.cornersGrade || 0),
        edges: snapToPsaScale(parsed.edgesGrade || 0),
        surface: snapToPsaScale(parsed.surfaceGrade || 0),
      }
    };
  } catch (error) {
    console.error("CollectOnly AI Error:", error);
    return null;
  }
};

export interface MicroReliefHeightGrid {
  size: number; // NxN
  height: number[]; // length = size*size, normalized 0..1
  strength?: number; // optional render hint
}

// Micro-relief JSON produced by Gemini can be occasionally truncated mid-number
// (e.g. "0.123" without the remainder), causing `JSON.parse` to throw.
// This parser attempts strict JSON first, then falls back to extracting numeric
// values from the `"height": [...]` region to keep 3D generation resilient.
const safeParseMicroReliefHeightGrid = (
  text: string,
  size: number
): MicroReliefHeightGrid | null => {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const expectedLen = size * size;
  const isValidSize = (s: number) => Number.isFinite(s) && s >= 8 && s <= 64 && Math.floor(s) === s;

  // 1) Strict JSON parse (handles complete responses).
  try {
    const cleaned = cleanJsonResponse(text);
    const parsed = JSON.parse(cleaned);
    const h = parsed?.height;
    if (!Array.isArray(h)) return null;

    // Prefer model-provided size if it matches.
    const parsedSizeMaybe = Number(parsed?.size);
    if (isValidSize(parsedSizeMaybe) && parsedSizeMaybe * parsedSizeMaybe === h.length) {
      const height = h.map((v: any) => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? clamp01(n) : 0;
      });
      return { size: parsedSizeMaybe, height, strength: 1 };
    }

    // Otherwise derive from array length.
    const derivedSize = Math.round(Math.sqrt(h.length));
    if (!isValidSize(derivedSize) || derivedSize * derivedSize !== h.length) return null;

    const height = h.map((v: any) => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? clamp01(n) : 0;
    });
    return { size: derivedSize, height, strength: 1 };
  } catch {
    // Fall through to fallback parser.
  }

  // 2) Fallback: regex extraction from `"height": [...]` region.
  try {
    const lower = text.toLowerCase();
    const keyCandidates = ['"height"', '"heights"', '"height_grid"', '"heightgrid"', '"height_field"'];
    let heightKeyIdx = -1;

    for (const k of keyCandidates) {
      const idx = lower.indexOf(k);
      if (idx !== -1) {
        heightKeyIdx = idx;
        break;
      }
    }
    if (heightKeyIdx === -1) return null;

    const arrayOpenIdx = text.indexOf('[', heightKeyIdx);
    if (arrayOpenIdx === -1) return null;

    const arrayCloseIdx = text.indexOf(']', arrayOpenIdx + 1);
    const heightRegion =
      arrayCloseIdx === -1 ? text.substring(arrayOpenIdx + 1) : text.substring(arrayOpenIdx + 1, arrayCloseIdx);

    const numRe = /-?\d*\.?\d+(?:[eE][+-]?\d+)?/g;
    const matches = heightRegion.match(numRe) || [];
    const nums = matches
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n))
      .map((n) => clamp01(n));

    if (nums.length === 0) return null;

    // Trim/pad deterministically to expected length for the requested size.
    const height = new Array(expectedLen).fill(0);
    for (let i = 0; i < expectedLen; i++) height[i] = nums[i] ?? 0;
    return { size, height, strength: 1 };
  } catch {
    return null;
  }
};

/**
 * Generates a low-res height grid for micro-relief (simple “edge bump” look).
 * Client converts height grid -> normal map for rendering.
 */
export const generateMicroReliefHeightGrid = async (
  frontImage: string,
  backImage: string,
  category?: string,
  opts?: { size?: number; certId?: string }
): Promise<MicroReliefHeightGrid | null> => {
  const modelId = 'gemini-2.5-flash';

  // Browser proxy: avoid client-side Gemini API key exposure during 3D generation.
  if (typeof window !== 'undefined') {
    try {
      const trySize = Math.max(8, Math.min(64, Math.floor(opts?.size ?? 20)));
      const categorySafe = category || 'Pokemon';
      const certId = opts?.certId;
      if (!certId) {
        // We intentionally avoid client-side Gemini calls.
        // The server endpoint needs cert_id so it can load images and keep payload small.
        return null;
      }

      const res = await fetch('api/plugin_3d_card.php?action=generate_micro_relief_height_grid', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cert_id: certId,
          category: categorySafe,
          size: trySize,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `micro_relief server failed (${res.status})`);
      }

      const json = await res.json();
      if (!json?.success) throw new Error(json?.error || 'micro_relief failed');

      const grid = json?.height_grid;
      const outSize = Number(grid?.size ?? trySize);
      if (!Number.isFinite(outSize) || outSize < 8 || outSize > 64) return null;
      const expectedLen = outSize * outSize;
      const inHeight = Array.isArray(grid?.height) ? grid.height : [];
      if (!inHeight.length) return null;

      const outHeight = new Array(expectedLen).fill(0);
      for (let i = 0; i < expectedLen; i++) {
        const v = inHeight[i] ?? 0;
        outHeight[i] = Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : 0;
      }

      return { size: outSize, height: outHeight, strength: Number(grid?.strength ?? 1) || 1 };
    } catch (error) {
      console.error('Micro-relief proxy height grid AI error:', error);
      return null;
    }
  }

  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('API Key Missing');
    const ai = new GoogleGenAI({ apiKey });

    const frontClean = cleanBase64(frontImage);
    const backClean = cleanBase64(backImage);
    const effectiveBack = backClean ? backClean : frontClean;

    const detectMimeType = (s: string) => {
      const t = (s || '').toLowerCase();
      if (t.includes('image/png')) return 'image/png';
      if (t.includes('image/webp')) return 'image/webp';
      return 'image/jpeg';
    };

    // Keep sizes small so the JSON doesn’t get truncated.
    const baseSize = Math.max(8, Math.min(64, Math.floor(opts?.size ?? 20)));
    const sizesToTry = Array.from(new Set([baseSize, baseSize - 2, baseSize - 4])).filter((s) => s >= 8);

    const promptForSize = (s: number) => `
Return ONLY valid JSON (no code fences, no markdown, no extra keys):
{"size":${s},"height":[/* ${s * s} numbers between 0 and 1 */]}
Rules:
- height array MUST contain exactly ${s * s} numbers
- numbers must be in [0,1]
- use at most 4 decimal places per number
`;

    for (const size of sizesToTry) {
      const promptText = promptForSize(size);
      const response = await ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [
            { text: promptText },
            { inlineData: { mimeType: detectMimeType(frontImage), data: frontClean } },
            { inlineData: { mimeType: detectMimeType(backImage || frontImage), data: effectiveBack } },
          ],
        },
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text;
      if (!text) continue;

      const parsed = safeParseMicroReliefHeightGrid(text, size);
      if (!parsed) continue;
      return parsed;
    }

    return null;
  } catch (error) {
    console.error('Micro-relief height grid AI error:', error);
    return null;
  }
};

/**
 * PHASE 2: FORENSIC BATCH A (Front & Tilt)
 * Images: Caller already resizes to max 1024px, JPEG 0.72. We send raw base64 JPEG
 * so the model receives decodeable pixels—no Brotli/compression (model needs image bytes, not a compressed blob).
 */
export const refineGradingBatchA = async (
  frontImage: string,
  videoFrames: string[],
  initialResult: GradingResult,
  onStatus?: (status: string) => void,
  captureContext?: string
): Promise<GradingResult> => {
  // #region agent log
  const batchAStart = Date.now();
  debugLog({ location: 'geminiService.ts:refineGradingBatchA', message: 'Batch A start', data: { batch: 'A' }, timestamp: Date.now(), hypothesisId: 'H5' });
  // #endregion
  console.log("[Phase 2A] Starting Batch A (Front Scan)...");
  try {
    const t0 = Date.now();
    const apiKey = await getApiKey();
    const getKeyMs = Date.now() - t0;
    const phase2Model = await resolvePhase2Model();
    // #region agent log
    debugLog({ location: 'geminiService.ts:refineGradingBatchA', message: 'getApiKey done', data: { getKeyMs }, timestamp: Date.now(), hypothesisId: 'H1' });
    // #endregion
    const ai = new GoogleGenAI({ apiKey });
    console.log("[Phase 2A] API Key obtained, GoogleGenAI initialized.");

    if (onStatus) onStatus("Forensics: Batch A (Front Scan)...");

    const category = (initialResult as any).category || 'Pokemon';
    const ruleset = selectGradingRuleset(initialResult.detectedSet, category);
    console.log(`[Phase 2A] Selected ruleset: ${ruleset.name}`);

    const promptText = buildPhase2Prompt(
      ruleset,
      initialResult.detectedName,
      initialResult.detectedSet,
      category,
      'A',
      undefined,
      captureContext
    );

    const frontClean = cleanBase64(frontImage);
    const parts: any[] = [{ text: promptText }, { inlineData: { mimeType: 'image/jpeg', data: frontClean } }];
    videoFrames.forEach(f => parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanBase64(f) } }));
    const promptLen = promptText?.length ?? 0;
    const totalDataLen = parts.reduce((sum, p) => sum + (typeof (p as any).text === 'string' ? (p as any).text.length : ((p as any).inlineData?.data?.length ?? 0)), 0);
    // #region agent log
    debugLog({ location: 'geminiService.ts:refineGradingBatchA', message: 'Batch A payload', data: { partsCount: parts.length, promptLen, totalDataLen }, timestamp: Date.now(), hypothesisId: 'H4' });
    // #endregion
    console.log(`[Phase 2A] Prepared ${parts.length} parts (1 prompt + ${parts.length - 1} images). Sending to Gemini...`);

    const geminiStart = Date.now();
    const response = await generateContentWithRetry(ai, {
      model: phase2Model,
      contents: { parts },
      config: { responseMimeType: "application/json" },
      requestTimeoutMs: PHASE2_REQUEST_TIMEOUT_MS,
    });
    const geminiMs = Date.now() - geminiStart;
    // #region agent log
    debugLog({ location: 'geminiService.ts:refineGradingBatchA', message: 'Batch A Gemini done', data: { geminiMs, totalBatchAMs: Date.now() - batchAStart }, timestamp: Date.now(), hypothesisId: 'H2' });
    // #endregion
    console.log("[Phase 2A] Received response from Gemini.");

    const result = JSON.parse(cleanJsonResponse(response.text || '{}'));
    console.log("[Phase 2A] Parsed JSON result:", result);

    const defects = (result.defects || []).map((d: any) => ({
      ...d,
      imageIndex: d.imageIndex === 0 ? 0 : d.imageIndex + 1,
      description: d.reasoning ?? d.description ?? ''
    }));

    const predictedGradesOut = result.predictedGrades ? {
      psa: snapToPsaScale(result.predictedGrades.psa || 0),
      bgs: snapToPsaScale(result.predictedGrades.bgs || 0),
      cgc: snapToPsaScale(result.predictedGrades.cgc || 0),
      tcg: result.predictedGrades.tcg || 'LP'
    } : initialResult.predictedGrades;
    
    console.log("[Phase 2A] Batch A completed successfully.");
    console.log("[Phase 2A] Predicted grades:", predictedGradesOut);
    
    return {
      ...initialResult,
      centering: initialResult.centering,
      corners: snapToPsaScale(result.corners || initialResult.corners),
      edges: snapToPsaScale(result.edges || initialResult.edges),
      surface: snapToPsaScale(result.surface || initialResult.surface),
      overall: snapToPsaScale(result.overall || initialResult.overall),
      reasoning: `[Phase 2A Front]: ${result.reasoning || 'No defects detected.'}`,
      defects: defects,
      predictedGrades: predictedGradesOut,
    };
  } catch (error: any) {
    console.error("[Phase 2A] Forensic Batch A FAILED:", error);
    console.error("[Phase 2A] Error details:", {
      message: error?.message,
      status: error?.status ?? error?.statusCode,
      stack: error?.stack
    });
    return initialResult;
  }
};

/**
 * PHASE 2: FORENSIC BATCH B (Back & Tilt)
 * Same image policy as Batch A: raw JPEG base64; caller supplies 1024px / 0.72 quality.
 */
export const refineGradingBatchB = async (
  backImage: string,
  videoFrames: string[],
  previousResult: GradingResult,
  onStatus?: (status: string) => void,
  captureContext?: string
): Promise<GradingResult> => {
  // #region agent log
  const batchBStart = Date.now();
  debugLog({ location: 'geminiService.ts:refineGradingBatchB', message: 'Batch B start', data: { batch: 'B' }, timestamp: Date.now(), hypothesisId: 'H5' });
  // #endregion
  console.log("[Phase 2B] Starting Batch B (Back Scan)...");
  try {
    const t0 = Date.now();
    const apiKey = await getApiKey();
    const getKeyMs = Date.now() - t0;
    const phase2Model = await resolvePhase2Model();
    // #region agent log
    debugLog({ location: 'geminiService.ts:refineGradingBatchB', message: 'getApiKey done', data: { getKeyMs }, timestamp: Date.now(), hypothesisId: 'H1' });
    // #endregion
    const ai = new GoogleGenAI({ apiKey });
    console.log("[Phase 2B] API Key obtained.");

    if (onStatus) onStatus("Forensics: Batch B (Back Scan)...");

    const category = (previousResult as any).category || 'Pokemon';
    const ruleset = selectGradingRuleset(previousResult.detectedSet, category);
    console.log(`[Phase 2B] Selected ruleset: ${ruleset.name}`);

    const promptText = buildPhase2Prompt(
      ruleset,
      previousResult.detectedName,
      previousResult.detectedSet,
      category,
      'B',
      previousResult.reasoning,
      captureContext
    );

    const backClean = cleanBase64(backImage);
    const parts: any[] = [{ text: promptText }, { inlineData: { mimeType: 'image/jpeg', data: backClean } }];
    videoFrames.forEach(f => parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanBase64(f) } }));
    const promptLen = promptText?.length ?? 0;
    const totalDataLen = parts.reduce((sum, p) => sum + (typeof (p as any).text === 'string' ? (p as any).text.length : ((p as any).inlineData?.data?.length ?? 0)), 0);
    // #region agent log
    debugLog({ location: 'geminiService.ts:refineGradingBatchB', message: 'Batch B payload', data: { partsCount: parts.length, promptLen, totalDataLen }, timestamp: Date.now(), hypothesisId: 'H4' });
    // #endregion
    console.log(`[Phase 2B] Prepared ${parts.length} parts. Sending to Gemini...`);

    const geminiStart = Date.now();
    const response = await generateContentWithRetry(ai, {
      model: phase2Model,
      contents: { parts },
      config: { responseMimeType: "application/json" },
      requestTimeoutMs: PHASE2_REQUEST_TIMEOUT_MS,
    });
    const geminiMs = Date.now() - geminiStart;
    // #region agent log
    debugLog({ location: 'geminiService.ts:refineGradingBatchB', message: 'Batch B Gemini done', data: { geminiMs, totalBatchBMs: Date.now() - batchBStart }, timestamp: Date.now(), hypothesisId: 'H2' });
    // #endregion
    console.log("[Phase 2B] Received response from Gemini.");

    const result = JSON.parse(cleanJsonResponse(response.text || '{}'));
    console.log("[Phase 2B] Parsed JSON result:", result);

    // Reconcile: average front and back scores for a balanced view.
    // Phase 3 (Surgical Verification) is the true final arbiter that can
    // override in either direction, so Phase 2 should not systematically penalize.
    const pickBalanced = (val1: number, val2: number, fallback: number) => {
      let avg = fallback;
      if (!val1 && !val2) avg = fallback;
      else if (!val1) avg = val2;
      else if (!val2) avg = val1;
      else avg = (val1 + val2) / 2; // average

      return snapToPsaScale(avg);
    };

    // Map defects (0 = back = global index 1; 1-2 = video = global 4-5)
    const newDefects = (result.defects || []).map((d: any) => ({
      ...d,
      imageIndex: d.imageIndex === 0 ? 1 : d.imageIndex + 3,
      description: d.reasoning ?? d.description ?? ''
    }));

    const prevPredicted = previousResult.predictedGrades || { psa: 99, bgs: 99, cgc: 99, tcg: 'LP' };
    const resPredicted = result.predictedGrades || {};
    const psaMin = Math.min(Number(resPredicted.psa) || 99, Number(prevPredicted.psa) || 99);
    const bgsMin = Math.min(Number(resPredicted.bgs) || 99, Number(prevPredicted.bgs) || 99);
    const cgcMin = Math.min(Number(resPredicted.cgc) || 99, Number(prevPredicted.cgc) || 99);

    return {
      ...previousResult,
      centering: previousResult.centering,
      corners: pickBalanced(result.corners, previousResult.corners, previousResult.corners),
      edges: pickBalanced(result.edges, previousResult.edges, previousResult.edges),
      surface: pickBalanced(result.surface, previousResult.surface, previousResult.surface),
      overall: pickBalanced(result.overall, previousResult.overall, previousResult.overall),
      reasoning: `${previousResult.reasoning}\n\n[Phase 2B Back]: ${result.reasoning || 'Verified'}`,
      defects: [...(previousResult.defects || []), ...newDefects],
      predictedGrades: {
        psa: psaMin < 99 ? snapToPsaScale(psaMin) : 0,
        bgs: bgsMin < 99 ? snapToPsaScale(bgsMin) : 0,
        cgc: cgcMin < 99 ? snapToPsaScale(cgcMin) : 0,
        tcg: resPredicted.tcg || prevPredicted.tcg || 'LP',
      },
    };
  } catch (error: any) {
    console.error("[Phase 2B] Forensic Batch B FAILED:", error);
    console.error("[Phase 2B] Error details:", {
      message: error?.message,
      status: error?.status ?? error?.statusCode,
      stack: error?.stack
    });
    return previousResult;
  }
};




export const reassessChain = async (
  chainData: any[],
  onStatus?: (status: string) => void
): Promise<GradingResult | null> => {
  try {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const phase2Model = await resolvePhase2Model();

    if (onStatus) onStatus("Analyzing Audit History (Forensic Merge)...");

    // 1. Prepare Evidence from Chain
    const historySummary = chainData.map((c, i) => {
      return `
        AUDIT #${i + 1} (${c.date_scanned || c.created_at}):
        - ID: ${c.id}
        - Grade: ${c.overall_grade}/10
        - Reasoning: "${c.reasoning}"
        - Defects: ${c.defects_json || '[]'}
      `;
    }).join('\n');

    // 2. Select Best Images (Latest Scan usually has best current state)
    const leadCert = chainData[0];
    if (!leadCert) return null;

    const resizedFront = await resizeImage(leadCert.front_img || leadCert.frontCropped, 1024);
    const resizedBack = await resizeImage(leadCert.back_img || leadCert.backCropped, 1024);

    const promptText = `
      ${TCGPLAYER_STANDARDS_CONTEXT}
      ${PREDICTED_GRADES_CONTEXT}
      
      TASK: PERFORM A FINAL "MERGE & RE-ASSESS" AUDIT.
      This card has been audited ${chainData.length} times.
      
      HISTORY OF AUDITS:
      ${historySummary}

      INSTRUCTIONS:
      1. Review the conflicting or evolving opinions in the history.
      2. Re-examine the visual evidence (Front/Back) with a fresh, sterile perspective.
      3. Synthesize a FINAL, definitive grade. 
      4. If previous grades missed a defect mentioned in another audit, VERIFY if it exists.
      5. Your reasoning must explain the final verdict by referencing the history (e.g., "Confirmed scratch noted in Audit #1, but rejected centering concern from Audit #2").
      
      Return JSON: { "centering": num, "corners": num, "edges": num, "surface": num, "overall": num, "reasoning": str, "defects": [], "predictedGrades": {psa, bgs, cgc, tcg} }
    `;

    const parts: any[] = [
      { text: promptText },
      { inlineData: { mimeType: 'image/jpeg', data: cleanBase64(resizedFront) } },
      { inlineData: { mimeType: 'image/jpeg', data: cleanBase64(resizedBack) } }
    ];

    const response = await generateContentWithRetry(ai, {
      model: phase2Model,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            centering: { type: Type.NUMBER },
            corners: { type: Type.NUMBER },
            edges: { type: Type.NUMBER },
            surface: { type: Type.NUMBER },
            overall: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
            predictedGrades: {
              type: Type.OBJECT,
              properties: {
                psa: { type: Type.NUMBER },
                bgs: { type: Type.NUMBER },
                cgc: { type: Type.NUMBER },
                tcg: { type: Type.STRING },
              }
            }
          }
        }
      },
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(cleanJsonResponse(text));

  } catch (error) {
    console.error("AI Chain Re-assess Error:", error);
    return null;
  }
};

export const getCardValuation = async (cardData: any, grade: any): Promise<{ estimated_value_usd: number, confidence_score: number, notes: string } | null> => {
  // ... existing code ...
  try {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const modelId = 'gemini-2.5-flash'; // Flash is faster/cheaper for simple text tasks

    const promptText = `
      You are an expert Pokemon Card Appraiser with deep knowledge of TCGPlayer, eBay Sold Listings, and PriceCharting data.
      Estimate the market value(USD) for this card:

      Name: ${cardData.metadata.name}
    Set: ${cardData.metadata.set}
    Year: ${cardData.metadata.year}
    Edition: ${cardData.metadata.edition || 'Unlimited'}
      
      Condition Grade: ${grade.overall} / 10
      (Centering: ${grade.centering}, Corners: ${grade.corners}, Edges: ${grade.edges}, Surface: ${grade.surface})

    Task:
    1. Simulate a search for recent sold listings of this card in a similar condition(Grade ${grade.overall}).
      2. If the grade is 9 or 10, weigh heavily towards graded prices(PSA / BGS / CGC equivalents).
      3. If the grade is lower, use raw / ungraded near - mint prices as a baseline.
      4. Estimate a conservative market price(USD).
      5. Provide a confidence score(0 - 100).
      6. Provide brief market notes citing reference points(e.g. "Last sold PSA 9 was $X...").
      
      Return JSON only: { "estimated_value_usd": number, "confidence_score": number, "notes": string }
    `;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [{ text: promptText }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimated_value_usd: { type: Type.NUMBER },
            confidence_score: { type: Type.NUMBER },
            notes: { type: Type.STRING }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(cleanJsonResponse(text));

  } catch (error) {
    console.error("AI Valuation Error:", error);
    return {
      estimated_value_usd: 0,
      confidence_score: 0,
      notes: "Could not retrieve valuation at this time."
    };
  }
};

/** eBay sales graphic: one short paragraph (2–4 sentences) for listing copy. Honest, condition-focused, no grades. */
export const generateEbaySnippet = async (
  cardMetadata: { name: string; set: string; year: string },
  conditionSummary: string
): Promise<string> => {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("API Key Missing");
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are writing listing copy for a collectible card sale. Write ONE short paragraph (2–4 sentences) suitable for an eBay or marketplace listing.

Card: ${cardMetadata.name}
Set: ${cardMetadata.set}
Year: ${cardMetadata.year}

Condition notes (use to describe honestly; do not invent grades or numbers): ${conditionSummary.slice(0, 500)}

Rules:
- Describe the card and its condition in a buyer-friendly, honest way. No numeric grades, no hype that misrepresents.
- Help the sale by highlighting real positives and being transparent about condition.
- Return plain text only, no quotes or labels. No bullet points.`;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: prompt }] }
    });
    const text = (response.text || '').trim();
    return text || 'Condition as shown. See photos for details.';
  } catch (err) {
    console.error("[generateEbaySnippet]", err);
    return 'Condition as shown. See photos for details.';
  }
};

// ─── ENVELOPE OCR PLUGIN ──────────────────────────────────────────────────────
// Isolated from the grading pipeline. Reads a shipping envelope image and
// returns structured fields. Image is not retained after the call.
export interface EnvelopeExtractResult {
  city?: string;
  state?: string;
  trackingNumber?: string;
  cardCount?: number;
  orderId?: string;
  source?: string;
  price?: number;
}

export const extractEnvelopeData = async (imageDataUrl: string): Promise<EnvelopeExtractResult> => {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("API Key Missing");

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are reading a shipping label, receipt, or invoice. Extract the following fields from the image, prioritizing the SENDER'S address (ORIGIN) or the STORE'S details over the destination:
    - city: sender's or store's city
    - state: sender's or store's state (2-letter abbreviation preferred)
    - trackingNumber: any tracking/barcode number visible (on shipping labels)
    - cardCount: any number indicating quantity of cards purchased or shipped (look for "qty", "count", "#", or line items)
    - orderId: The order number, receipt number, or invoice ID (if present)
    - source: The name of the store, seller, or marketplace (e.g., "eBay", "TCGPlayer", "Bob's Cards")
    - price: The Total Purchase Price, Grand Total, or Amount Paid (if this is a receipt or invoice). Extract just the number (e.g., 49.99).

SPECIAL RULE FOR TRACKING NUMBERS:
If the trackingNumber starts with "ESUS", you MUST set the source to "eBay - [Seller's Name]". Attempt to find the sender/seller's name from the return address. If you cannot find the seller's name, just set source to "eBay".

Return ONLY a JSON object with these exact keys. Use null for any field you cannot find.
Example: { "city": "Seattle", "state": "WA", "trackingNumber": "ESUS12345678", "cardCount": 1, "orderId": "12-34567-890", "source": "eBay - Collectibles Store", "price": 49.99 }`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64(imageDataUrl) } }
        ]
      },
      config: {
        responseMimeType: "application/json"
      }
    });

    const parsed = JSON.parse(cleanJsonResponse(response.text || '{}'));
    return {
      city: parsed.city || undefined,
      state: parsed.state || undefined,
      trackingNumber: parsed.trackingNumber || undefined,
      cardCount: parsed.cardCount ? Number(parsed.cardCount) : undefined,
      orderId: parsed.orderId || undefined,
      source: parsed.source || undefined,
      price: parsed.price ? Number(parsed.price) : undefined
    };
  } catch (err) {
    console.error("[EnvelopeOCR] Error:", err);
    return {}; // fail gracefully — plugin errors must not surface to grading
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Slab Authenticity Checker (SlabCheckerPlugin)
// ─────────────────────────────────────────────────────────────────────────────

export interface SlabCheck {
  name: string;
  score: number;          // 0–100
  pass: boolean;
  detail: string;
  box2d?: number[];       // [ymin, xmin, ymax, xmax] 0-1000
  imageIndex?: number;    // 0=Front, 1=Back, 2+=Video Frames
}

export interface SlabCheckResult {
  grading_house: 'PSA' | 'BGS' | 'CGC' | 'Other';
  authenticity_score: number;   // 0–100
  verdict: 'LIKELY AUTHENTIC' | 'INCONCLUSIVE' | 'LIKELY FAKE';
  serial_detected: string;
  card_name_detected: string;
  checks: SlabCheck[];
  ai_reasoning: string;
}

/**
 * Analyzes front/back/video frames of a graded slab for authenticity.
 * Returns a per-check breakdown with an overall verdict.
 */
export const checkSlabAuthenticity = async (
  frontImage: string,
  backImage: string,
  videoFrames: string[],
  gradingHouse: 'PSA' | 'BGS' | 'CGC' | 'Other',
  onStatus?: (s: string) => void
): Promise<SlabCheckResult | null> => {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('API Key Missing');
    const ai = new GoogleGenAI({ apiKey });
    const phase2Model = await resolvePhase2Model();

    if (onStatus) onStatus('Analyzing slab front...');

    const frontClean = cleanBase64(frontImage);
    const backClean  = cleanBase64(backImage);
    const validFrames = (videoFrames || []).slice(0, 6).map(cleanBase64);

    const houseChecks = buildHouseChecksPrompt(gradingHouse as SlabGradingHouse);

    const promptText = `
You are an expert graded trading card slab authenticator. You have analyzed thousands of real and fake ${gradingHouse} slabs.

TASK: Analyze the provided images of a ${gradingHouse} graded slab and determine its authenticity.

${houseChecks}

VIDEO FRAME ANALYSIS:
- The video frames show the slab from different angles, lighting conditions, and pan directions.
- Use them to detect reflective logo illumination effects, edge/weld integrity, and any suspicious anomalies not visible in static shots.

${buildSlabAuthInstructionsBlock()}
    `.trim();

    const parts: any[] = [
      { text: promptText },
      { inlineData: { mimeType: 'image/jpeg', data: frontClean } },
      { inlineData: { mimeType: 'image/jpeg', data: backClean } },
      ...validFrames.map(f => ({ inlineData: { mimeType: 'image/jpeg', data: f } }))
    ];

    if (onStatus) onStatus('Running slab authenticity analysis...');

    const checkSchema: Record<string, any> = {
      type: Type.OBJECT,
      properties: {
        name:       { type: Type.STRING },
        score:      { type: Type.NUMBER },
        pass:       { type: Type.BOOLEAN },
        detail:     { type: Type.STRING },
        box2d:      { type: Type.ARRAY, items: { type: Type.NUMBER } },
        imageIndex: { type: Type.NUMBER },
      },
    };

    const response = await generateContentWithRetry(ai, {
      model: phase2Model,
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            grading_house:       { type: Type.STRING },
            authenticity_score:  { type: Type.NUMBER },
            verdict:             { type: Type.STRING },
            serial_detected:     { type: Type.STRING },
            card_name_detected:  { type: Type.STRING },
            checks:              { type: Type.ARRAY, items: checkSchema },
            ai_reasoning:        { type: Type.STRING },
          },
        },
      },
      requestTimeoutMs: PHASE2_REQUEST_TIMEOUT_MS,
    });

    const text = response.text;
    if (!text) return null;

    if (onStatus) onStatus('Processing results...');

    const parsed = JSON.parse(cleanJsonResponse(text));

    // Normalize score and verdict
    const rawScore = Math.max(0, Math.min(100, Math.round(parsed.authenticity_score ?? 50)));
    const verdictFromScore = rawScore >= 75 ? 'LIKELY AUTHENTIC' : rawScore >= 50 ? 'INCONCLUSIVE' : 'LIKELY FAKE';
    const verdict = (['LIKELY AUTHENTIC', 'INCONCLUSIVE', 'LIKELY FAKE'] as const).includes(parsed.verdict)
      ? parsed.verdict as SlabCheckResult['verdict']
      : verdictFromScore;

    return {
      grading_house: gradingHouse,
      authenticity_score: rawScore,
      verdict,
      serial_detected: String(parsed.serial_detected || ''),
      card_name_detected: String(parsed.card_name_detected || ''),
      checks: Array.isArray(parsed.checks) ? parsed.checks.map((c: any) => ({
        name: String(c.name || ''),
        score: Math.max(0, Math.min(100, Math.round(c.score ?? 50))),
        pass: !!c.pass,
        detail: String(c.detail || ''),
      })) : [],
      ai_reasoning: String(parsed.ai_reasoning || ''),
    };
  } catch (err) {
    console.error('[checkSlabAuthenticity] Error:', err);
    return null;
  }
};
