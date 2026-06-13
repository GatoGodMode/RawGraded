import type { GradingResult } from '../../types';
import { runStudioGrading } from '../llm/gradingOrchestrator';
import type { ReanalysisMode } from '../llm/types';
import { loadDesktopLlmSettings } from '../desktopSettings';
import type { StudioPortfolioCard } from './studioPortfolioTypes';

export function portfolioCardHasScanImages(card: StudioPortfolioCard): boolean {
  return Boolean(card.frontImage?.trim() && card.backImage?.trim());
}

function gradingFromPortfolio(card: StudioPortfolioCard): GradingResult | null {
  const g = card.grading;
  if (!g || typeof g !== 'object') return null;
  return g as GradingResult;
}

export interface RunPortfolioReanalysisOptions {
  card: StudioPortfolioCard;
  identificationHint?: string;
  mode: ReanalysisMode;
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
}

export interface RunPortfolioReanalysisResult {
  result: GradingResult;
  card: StudioPortfolioCard;
}

/** Re-identify or full re-grade a saved portfolio row; persists via portfolio:addFromGrading. */
export async function runPortfolioReanalysis(
  opts: RunPortfolioReanalysisOptions
): Promise<RunPortfolioReanalysisResult> {
  const { card, identificationHint, mode, onStatus, signal } = opts;

  if (!portfolioCardHasScanImages(card)) {
    throw new Error('This portfolio entry has no front/back scan images. Re-identify requires images saved at grading time.');
  }

  const priorGrade = gradingFromPortfolio(card);
  if (!priorGrade) {
    throw new Error('This portfolio entry has no stored grading data.');
  }

  const settings = await loadDesktopLlmSettings();
  const full = typeof window !== 'undefined' && window.desktop?.getSettingsFull
    ? await window.desktop.getSettingsFull()
    : null;
  const useMeasured = full?.useMeasuredCentering ?? settings.useMeasuredCentering ?? true;

  const result = await runStudioGrading({
    front: card.frontImage!,
    back: card.backImage!,
    frames: [],
    category: 'Pokemon',
    identificationHint: identificationHint?.trim() || undefined,
    useMeasuredCentering: useMeasured,
    onStatus,
    reanalysisMode: mode,
    existingResult: priorGrade,
    signal,
  });

  if (!result) throw new Error('Re-analysis returned no result.');

  if (!window.desktop?.portfolioAddFromGrading) {
    throw new Error('Portfolio save is not available in this environment.');
  }

  const name = result.detectedName?.trim() || card.name || '';
  const set = result.detectedSet?.trim() || card.set || '';
  const cardNumber = result.detectedCardNumber?.trim() || card.cardNumber || '';

  const saved = (await window.desktop.portfolioAddFromGrading({
    cardId: card.id,
    name,
    set,
    cardNumber,
    year: result.detectedYear || card.year,
    artist: result.detectedArtist || card.artist,
    frontImage: card.frontImage,
    backImage: card.backImage,
    grading: result,
    pricechartingUrl: card.pricechartingUrl,
    provenance: card.provenance,
  })) as StudioPortfolioCard;

  return { result, card: saved };
}
