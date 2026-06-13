import type { GradingResult } from '../../types';
import { buildSoftCaptureContext } from '../grading/captureContext';
import { selectGradingRuleset } from '../gradingRulesets';
import { loadDesktopLlmSettings } from '../desktopSettings';
import { buildCenteringAssessmentPrompt, parseCenteringAssessment } from '../grading/centeringAssessment';
import {
  CardAnalysisWorkVector,
  normalizeWorkVectorDefects,
  scoreIdentityConfidence,
  type LocalOcrFields,
} from '../grading/cardAnalysisWorkVector';
import { lookupPokemonCandidates } from '../pricing/tcgdexLookup';
import { surgicalVerification } from '../geminiService';
import type { LlmProvider, RunGradingInput } from './types';
import { buildCenteringContext } from './types';
import { ollamaFetch } from './ollamaRequest';
import { mergeIdentityIntoResult } from './identityReanalysis';
import { stripBackIdentityFromReasoning } from '../grading/identityReasoningSanitizer';
import { buildLockedHintPromptBlock, parseIdentificationHint } from '../grading/authoritativeIdentity';
import { prepLocalImage, prepLocalImages } from './localImagePrep';
import {
  chunkImageIndex,
  gridToAnalysisChunks,
  prepareCardImages,
  type PreparedCardImages,
} from '../grading/cardImagePipeline';
import {
  buildChunkForensicPrompt,
  buildIdentityBottomBandPrompt,
  buildIdentityTopBandPrompt,
  buildOllamaBackConditionPrompt,
  buildOllamaFramePrompt,
  buildOllamaOcrPrompt,
  buildOllamaSynthesisPrompt,
  buildRapidAssessmentPrompt,
  selectForensicFrameIndices,
} from './ollamaForensicPrompts';

export const OLLAMA_MAX_IMAGES_PER_REQUEST = 1;

const cleanBase64 = (dataUrl: string): string => {
  const trimmed = dataUrl.trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx !== -1 && /^data:[^;]+;base64$/i.test(trimmed.slice(0, commaIdx))) {
    return trimmed.slice(commaIdx + 1).replace(/\s/g, '');
  }
  return trimmed.replace(/\s/g, '');
};

const normalizeOllamaImage = (dataUrl: string): string => {
  const b64 = cleanBase64(dataUrl);
  if (!b64 || b64.length < 64) {
    throw new Error('Ollama vision request requires a valid image payload.');
  }
  return b64;
};

const cleanJsonResponse = (text: string): string => {
  if (!text) return '{}';
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) return text.substring(firstBrace, lastBrace + 1);
  return text.trim().replace(/^```(json)?\s*/i, '').replace(/\s*```$/i, '').trim();
};

const buildHintContext = (hint?: string): string => buildLockedHintPromptBlock(hint);

async function ollamaChat(
  baseUrl: string,
  model: string,
  imageBase64: string,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const image = normalizeOllamaImage(imageBase64);
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const res = await ollamaFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [{ role: 'user', content: prompt, images: [image] }],
      }),
    },
    { signal }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content || '{}';
}

async function ollamaChatTextOnly(
  baseUrl: string,
  model: string,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const res = await ollamaFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    { signal }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content || '{}';
}

async function extractLocalCardText(
  baseUrl: string,
  model: string,
  frontImage: string,
  identificationHint: string | undefined,
  deep: boolean,
  signal?: AbortSignal
): Promise<LocalOcrFields> {
  const prompt = buildOllamaOcrPrompt(buildHintContext(identificationHint), deep);
  const text = await ollamaChat(baseUrl, model, frontImage, prompt, signal);
  const parsed = JSON.parse(cleanJsonResponse(text)) as Record<string, unknown>;
  if (!deep) {
    return {
      name: String(parsed.name || parsed.detectedName || '').trim(),
      cardNumber: String(parsed.number || parsed.cardNumber || parsed.detectedCardNumber || '').trim(),
    };
  }
  return {
    name: String(parsed.name || '').trim(),
    cardNumber: String(parsed.cardNumber || parsed.number || '').trim(),
    hp: String(parsed.hp || '').trim() || undefined,
    type: String(parsed.type || '').trim() || undefined,
    stage: String(parsed.stage || '').trim() || undefined,
    attacks: String(parsed.attacks || '').trim() || undefined,
    weakness: String(parsed.weakness || '').trim() || undefined,
    resistance: String(parsed.resistance || '').trim() || undefined,
    retreat: String(parsed.retreat || '').trim() || undefined,
  };
}

function formatOcrContext(ocr: LocalOcrFields): string {
  const parts = [`name=${ocr.name}`, `cardNumber=${ocr.cardNumber}`];
  if (ocr.hp) parts.push(`hp=${ocr.hp}`, `type=${ocr.type || ''}`, `stage=${ocr.stage || ''}`);
  if (ocr.attacks) parts.push(`attacks=${ocr.attacks}`);
  return parts.join(', ');
}

function collectRiskFactors(...sources: Record<string, unknown>[]): string[] {
  const factors: string[] = [];
  for (const src of sources) {
    if (Array.isArray(src.riskFactors)) {
      for (const f of src.riskFactors) {
        if (typeof f === 'string' && f.trim()) factors.push(f.trim());
      }
    }
  }
  return [...new Set(factors)];
}

function workToIdentityPartialFromWork(work: CardAnalysisWorkVector): GradingResult {
  const id = work.identity;
  return {
    centering: 0,
    corners: 0,
    edges: 0,
    surface: 0,
    overall: 0,
    reasoning: '',
    defects: [],
    detectedName: id.detectedName,
    detectedCharacter: id.detectedCharacter,
    detectedSet: id.detectedSet,
    detectedYear: id.detectedYear,
    detectedEdition: id.detectedEdition,
    detectedCardNumber: id.detectedCardNumber,
    detectedArtist: id.detectedArtist,
    isHolographic: id.isHolographic,
    holoPattern: id.holoPattern,
  };
}

function applyRapidHolo(work: CardAnalysisWorkVector, raw: Record<string, unknown>): void {
  if (raw.isHolographic === true) {
    work.identity.isHolographic = true;
    if (raw.holoPattern) work.identity.holoPattern = String(raw.holoPattern);
  }
}

async function runFrontIdentityBands(
  work: CardAnalysisWorkVector,
  prepared: PreparedCardImages,
  settings: { ollamaBaseUrl: string; ollamaModel: string; localAnalysisDepth?: string },
  cat: string,
  hintCtx: string,
  identificationHint: string | undefined,
  onStatus: ((s: string) => void) | undefined,
  signal?: AbortSignal
): Promise<void> {
  const deep = settings.localAnalysisDepth === 'deep';
  const { ollamaBaseUrl, ollamaModel } = settings;

  onStatus?.('Reading card text...');
  try {
    const ocr = await extractLocalCardText(
      ollamaBaseUrl,
      ollamaModel,
      prepared.identityBands.topBand,
      identificationHint,
      deep,
      signal
    );
    work.setOcrFields(ocr);
  } catch (err) {
    console.warn('Ollama OCR preflight failed:', err);
  }

  const candidateSearch = identificationHint?.trim() || work.ocrFields.name;
  const isPokemon = cat.toLowerCase().includes('pokemon');
  const ocrCtx = formatOcrContext(work.ocrFields);

  onStatus?.('Identifying card (front top/bottom)...');
  const tcgPromise =
    isPokemon && candidateSearch
      ? lookupPokemonCandidates(candidateSearch, work.ocrFields.cardNumber)
      : Promise.resolve([]);

  const [candidates, topText, bottomText] = await Promise.all([
    tcgPromise,
    ollamaChat(
      ollamaBaseUrl,
      ollamaModel,
      prepared.identityBands.topBand,
      buildIdentityTopBandPrompt(cat, hintCtx, ocrCtx || undefined),
      signal
    ),
    ollamaChat(
      ollamaBaseUrl,
      ollamaModel,
      prepared.identityBands.bottomBand,
      buildIdentityBottomBandPrompt(cat, hintCtx),
      signal
    ),
  ]);

  work.tcgCandidates = candidates;
  work.identityConfidence = scoreIdentityConfidence(work.ocrFields, candidates);
  const topRaw = JSON.parse(cleanJsonResponse(topText)) as Record<string, unknown>;
  const bottomRaw = JSON.parse(cleanJsonResponse(bottomText)) as Record<string, unknown>;
  work.mergeIdentityBands(topRaw, bottomRaw);
}

async function runChunkGridForensic(
  work: CardAnalysisWorkVector,
  prepared: PreparedCardImages,
  cardMeta: { detectedName: string; detectedSet: string; category: string },
  ruleset: ReturnType<typeof selectGradingRuleset>,
  captureContext: string | undefined,
  settings: { ollamaBaseUrl: string; ollamaModel: string },
  onStatus: ((s: string) => void) | undefined,
  signal?: AbortSignal
): Promise<void> {
  const { ollamaBaseUrl, ollamaModel } = settings;
  const allSlices = [...prepared.frontGrid, ...prepared.backGrid];

  for (const slice of allSlices) {
    const imageIndex = chunkImageIndex(slice.side, slice.row, slice.col);
    onStatus?.(`Forensic ${slice.label}...`);
    try {
      const text = await ollamaChat(
        ollamaBaseUrl,
        ollamaModel,
        slice.dataUrl,
        buildChunkForensicPrompt(
          ruleset,
          cardMeta,
          slice,
          imageIndex,
          work.toPromptContext('defects')
        ),
        signal
      );
      const raw = JSON.parse(cleanJsonResponse(text)) as Record<string, unknown>;
      const defects = normalizeWorkVectorDefects(raw.defects, imageIndex);
      work.addChunkPass(
        slice.side,
        slice.row,
        slice.col,
        imageIndex,
        defects,
        String(raw.reasoning || '')
      );
      work.addRiskFactors(collectRiskFactors(raw));
    } catch (err) {
      console.warn(`Chunk forensic failed (${slice.label}):`, err);
    }
  }
}

async function runOllamaIdentityReanalysis(input: RunGradingInput): Promise<GradingResult | null> {
  const existing = input.existingResult;
  if (!existing) throw new Error('Identity re-analysis requires an existing grading result.');

  const settings = await loadDesktopLlmSettings();
  const {
    front,
    back,
    frames,
    identificationHint,
    centeringMeasurement,
    useMeasuredCentering,
    onStatus,
    category,
    signal,
  } = input;

  const cat = category || 'Pokemon';
  const hintCtx = buildHintContext(identificationHint);
  const work = new CardAnalysisWorkVector();

  onStatus?.('Preparing slices...');
  const prepared = await prepareCardImages(front, back, (s) => prepLocalImage(s, settings), (s) =>
    prepLocalImage(s, settings)
  );

  await runFrontIdentityBands(work, prepared, settings, cat, hintCtx, identificationHint, onStatus, signal);

  const hintResolved = parseIdentificationHint(identificationHint);
  const identityPartial = mergeIdentityIntoResult(existing, workToIdentityPartialFromWork(work), {
    preferIncoming: true,
    hintResolved,
  });

  onStatus?.('Computing grades from evidence...');
  return surgicalVerification(prepared.frontPrep, prepared.backPrep, frames || [], identityPartial, onStatus, {
    centeringMeasurement,
    useMeasuredCentering: useMeasuredCentering ?? true,
    category: cat,
  });
}

export const ollamaProvider: LlmProvider = {
  id: 'ollama',

  async runFullGrading(input: RunGradingInput): Promise<GradingResult | null> {
    if (input.reanalysisMode === 'identity') {
      return runOllamaIdentityReanalysis(input);
    }

    const settings = await loadDesktopLlmSettings();
    const deep = settings.localAnalysisDepth === 'deep';
    const {
      front,
      back,
      frames,
      identificationHint,
      centeringMeasurement,
      useMeasuredCentering,
      onStatus,
      category,
      frontMetadata,
      backMetadata,
      signal,
      existingResult,
      reanalysisMode,
    } = input;

    const skipCenteringNotes = reanalysisMode === 'full' && !!existingResult;

    const work = new CardAnalysisWorkVector();
    const captureContext = buildSoftCaptureContext(frontMetadata, backMetadata);
    const cat = category || 'Pokemon';
    const hintCtx = buildHintContext(identificationHint);
    const { ollamaBaseUrl, ollamaModel } = settings;

    onStatus?.('Preparing slices...');
    const prepared = await prepareCardImages(front, back, (s) => prepLocalImage(s, settings), (s) =>
      prepLocalImage(s, settings)
    );
    const rFrames = await prepLocalImages(frames || [], settings);
    work.setAnalysisChunks(gridToAnalysisChunks(prepared.frontGrid, prepared.backGrid));

    onStatus?.('Rapid assessment (front)...');
    try {
      const rapidFrontText = await ollamaChat(
        ollamaBaseUrl,
        ollamaModel,
        prepared.front720,
        buildRapidAssessmentPrompt('front'),
        signal
      );
      const rapidFront = JSON.parse(cleanJsonResponse(rapidFrontText)) as Record<string, unknown>;
      applyRapidHolo(work, rapidFront);
      work.addRiskFactors(collectRiskFactors(rapidFront));
      work.appendPhase('Rapid front', rapidFront);
    } catch (err) {
      console.warn('Rapid front assessment failed:', err);
    }

    onStatus?.('Rapid assessment (back)...');
    try {
      const rapidBackText = await ollamaChat(
        ollamaBaseUrl,
        ollamaModel,
        prepared.back720,
        buildRapidAssessmentPrompt('back'),
        signal
      );
      const rapidBack = JSON.parse(cleanJsonResponse(rapidBackText)) as Record<string, unknown>;
      work.addRiskFactors(collectRiskFactors(rapidBack));
      work.appendPhase('Rapid back', rapidBack);
      try {
        const backCondText = await ollamaChat(
          ollamaBaseUrl,
          ollamaModel,
          prepared.back720,
          buildOllamaBackConditionPrompt(hintCtx),
          signal
        );
        work.setBackCondition(JSON.parse(cleanJsonResponse(backCondText)) as Record<string, unknown>);
      } catch {
        /* optional */
      }
    } catch (err) {
      console.warn('Rapid back assessment failed:', err);
    }

    await runFrontIdentityBands(
      work,
      prepared,
      settings,
      cat,
      hintCtx,
      identificationHint,
      onStatus,
      signal
    );

    const cardMeta = {
      detectedName: work.identity.detectedName,
      detectedSet: work.identity.detectedSet,
      category: cat,
    };
    const ruleset = selectGradingRuleset(cardMeta.detectedSet, cat);
    const advisory = buildCenteringContext({ category: cat } as never, centeringMeasurement);
    const baseCenterPrompt = buildCenteringAssessmentPrompt(advisory);

    if (!skipCenteringNotes) {
      onStatus?.('Centering notes (front)...');
      try {
        const frontCenterText = await ollamaChat(
          ollamaBaseUrl,
          ollamaModel,
          prepared.frontPrep,
          `${baseCenterPrompt}\nFRONT scan only. Qualitative centering notes in reasoning only.`,
          signal
        );
        const frontParsed = parseCenteringAssessment(JSON.parse(cleanJsonResponse(frontCenterText)));
        work.addCenteringNote('front', frontParsed.reasoning);
      } catch (err) {
        console.warn('Ollama front centering notes failed:', err);
      }

      onStatus?.('Centering notes (back)...');
      try {
        const backCenterText = await ollamaChat(
          ollamaBaseUrl,
          ollamaModel,
          prepared.backPrep,
          `${baseCenterPrompt}\nBACK scan only. Qualitative centering notes in reasoning only.`,
          signal
        );
        const backParsed = parseCenteringAssessment(JSON.parse(cleanJsonResponse(backCenterText)));
        work.addCenteringNote('back', backParsed.reasoning);
      } catch (err) {
        console.warn('Ollama back centering notes failed:', err);
      }
    }

    await runChunkGridForensic(
      work,
      prepared,
      cardMeta,
      ruleset,
      captureContext || undefined,
      settings,
      onStatus,
      signal
    );

    const framePicks = selectForensicFrameIndices(rFrames.length);
    for (const pick of framePicks) {
      const frame = rFrames[pick.index];
      if (!frame) continue;
      onStatus?.(`Frame forensic (${pick.label})...`);
      try {
        const frameText = await ollamaChat(
          ollamaBaseUrl,
          ollamaModel,
          frame,
          buildOllamaFramePrompt(ruleset, cardMeta, pick.label, pick.index + 2, work.toPromptContext('defects')),
          signal
        );
        const frameRaw = JSON.parse(cleanJsonResponse(frameText)) as Record<string, unknown>;
        const imageIndex = pick.index + 2;
        work.addFramePass({
          reasoning: String(frameRaw.reasoning || ''),
          passLabel: `Frame ${pick.label}`,
          imageIndex,
          defects: normalizeWorkVectorDefects(frameRaw.defects, imageIndex),
        });
        work.addRiskFactors(collectRiskFactors(frameRaw));
      } catch (err) {
        console.warn(`Ollama frame forensic failed (${pick.label}):`, err);
      }
    }

    onStatus?.('Compiling evidence...');
    work.compileEvidence();

    if (deep) {
      onStatus?.('Final assessment...');
      try {
        const synthText = await ollamaChatTextOnly(
          ollamaBaseUrl,
          ollamaModel,
          buildOllamaSynthesisPrompt(work),
          signal
        );
        const synth = JSON.parse(cleanJsonResponse(synthText)) as Record<string, unknown>;
        const identityNote = String(synth.identityNote || '');
        const reasoning = stripBackIdentityFromReasoning(
          [String(synth.reasoning || ''), identityNote].filter(Boolean).join(' ')
        );
        work.setSynthesis(reasoning);
      } catch (err) {
        console.warn('Ollama synthesis pass failed:', err);
      }
    }

    onStatus?.('Computing grades from evidence...');
    const initial = work.toGradingResult(useMeasuredCentering ?? false, centeringMeasurement, cat);

    return surgicalVerification(prepared.frontPrep, prepared.backPrep, rFrames, initial, onStatus, {
      centeringMeasurement,
      useMeasuredCentering: useMeasuredCentering ?? true,
      category: cat,
    });
  },
};
