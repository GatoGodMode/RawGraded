import type { LlmProvider, RunGradingInput } from './types';

import { buildSoftCaptureContext } from '../grading/captureContext';

import type { GradingResult } from '../../types';

import { resizeImage } from '../imageUtils';

const VIDEO_FRAME_ANALYSIS_MAX_DIM = 1536;
const VIDEO_FRAME_ANALYSIS_QUALITY = 0.85;

import {
  identifyCardFromFront,
  refineGradingChunkGrid,
  runGeminiCenteringAssessment,
  surgicalVerification,
  sleep,
  PHASE2_DELAY_AFTER_IDENTIFICATION_MS,
} from '../geminiService';
import { mergeIdentityIntoResult } from './identityReanalysis';
import { parseIdentificationHint } from '../grading/authoritativeIdentity';
import {
  cropFrontIdentityBands,
  gridToAnalysisChunks,
  prepareCardImages,
} from '../grading/cardImagePipeline';

async function runGeminiIdentityReanalysis(input: RunGradingInput): Promise<GradingResult | null> {
  const existing = input.existingResult;
  if (!existing) throw new Error('Identity re-analysis requires an existing grading result.');

  const { front, back, frames, category, identificationHint, centeringMeasurement, useMeasuredCentering, onStatus } =
    input;
  const setStatus = (s: string) => onStatus?.(s);
  const cat = category || 'Pokemon';

  setStatus('Preparing slices...');
  const [rFront, rBack, rFrames] = await Promise.all([
    resizeImage(front, 1024),
    resizeImage(back, 1024),
    Promise.all((frames || []).map((f) => resizeImage(f, VIDEO_FRAME_ANALYSIS_MAX_DIM, VIDEO_FRAME_ANALYSIS_QUALITY))),
  ]);

  if (input.signal?.aborted) {
    throw new Error(input.signal.reason instanceof Error ? input.signal.reason.message : 'Request cancelled');
  }

  const bands = await cropFrontIdentityBands(rFront);
  setStatus('Re-identifying card (front only)...');
  const identity = await identifyCardFromFront(
    bands.topBand,
    bands.bottomBand,
    cat,
    identificationHint?.trim() || undefined
  );
  if (!identity) throw new Error('Identification failed.');

  const merged = mergeIdentityIntoResult(existing, identity, {
    preferIncoming: true,
    hintResolved: parseIdentificationHint(identificationHint),
  });

  setStatus('Computing grades from evidence...');
  return surgicalVerification(rFront, rBack, rFrames, merged, setStatus, {
    centeringMeasurement,
    useMeasuredCentering: useMeasuredCentering ?? true,
    category: cat,
  });
}

export const geminiProvider: LlmProvider = {
  id: 'gemini',

  async runFullGrading(input: RunGradingInput): Promise<GradingResult | null> {
    if (input.reanalysisMode === 'identity') {
      return runGeminiIdentityReanalysis(input);
    }

    const {
      front,
      back,
      frames,
      category,
      identificationHint,
      centeringMeasurement,
      useMeasuredCentering,
      frontMetadata,
      backMetadata,
      onStatus,
      existingResult,
      reanalysisMode,
    } = input;
    const setStatus = (s: string) => onStatus?.(s);
    const captureContext = buildSoftCaptureContext(frontMetadata, backMetadata);
    const skipCenteringAssessment = reanalysisMode === 'full' && !!existingResult;
    const cat = category || 'Pokemon';

    setStatus('Preparing slices...');
    const prepared = await prepareCardImages(
      front,
      back,
      (s) => resizeImage(s, 1024),
      (s) => resizeImage(s, 1024)
    );
    const rFrames = await Promise.all(
      (frames || []).map((f) => resizeImage(f, VIDEO_FRAME_ANALYSIS_MAX_DIM, VIDEO_FRAME_ANALYSIS_QUALITY))
    );
    const analysisChunks = gridToAnalysisChunks(prepared.frontGrid, prepared.backGrid);

    setStatus('Identifying card (front only)...');
    const initialGrade = await identifyCardFromFront(
      prepared.identityBands.topBand,
      prepared.identityBands.bottomBand,
      cat,
      identificationHint?.trim() || undefined
    );
    if (!initialGrade) return null;

    let centeringReason: string | undefined;
    if (!skipCenteringAssessment) {
      setStatus('Assessing centering from stills...');
      const centeringAssessment = await runGeminiCenteringAssessment(
        prepared.frontPrep,
        prepared.backPrep,
        centeringMeasurement
      );
      centeringReason = centeringAssessment?.reasoning;
    }

    await sleep(PHASE2_DELAY_AFTER_IDENTIFICATION_MS);
    setStatus('Forensic grid (3×3)...');
    const chunkResult = await refineGradingChunkGrid(
      prepared.frontGrid,
      prepared.backGrid,
      initialGrade,
      setStatus,
      captureContext || undefined
    );

    const reasoningParts = [
      centeringReason ? `[Centering notes]: ${centeringReason}` : '',
      chunkResult.reasoning,
    ].filter(Boolean);

    const mergedResult: GradingResult = {
      ...chunkResult,
      centering: 0,
      corners: 0,
      edges: 0,
      surface: 0,
      overall: 0,
      reasoning: reasoningParts.join(' | '),
      predictedGrades: { psa: 0, bgs: 0, cgc: 0, tcg: 'Near Mint' },
      analysisChunks,
    };

    setStatus('Computing grades from evidence...');
    const verified = await surgicalVerification(
      prepared.frontPrep,
      prepared.backPrep,
      rFrames,
      mergedResult,
      setStatus,
      {
        centeringMeasurement,
        useMeasuredCentering: useMeasuredCentering ?? true,
        category: cat,
      }
    );
    if (verified) verified.analysisChunks = analysisChunks;
    return verified;
  },
};
