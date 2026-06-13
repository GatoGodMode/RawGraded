import type { GradingResult } from '../../types';
import type { PcSearchCandidate } from './portfolioBridgeTypes';
import type { StudioPortfolioCard } from './studioPortfolioTypes';
import {
  buildPcSearchQuery,
  buildPcSearchUrl,
  ensurePortfolioRow,
  searchPcForReidentify,
} from './reidentifyFromPriceCharting';

export interface StartPcIdentityReidentifyInput {
  hint: string;
  cardId: string;
  priorGrade: GradingResult;
  portfolioCard?: StudioPortfolioCard | null;
  fallbackSearch?: { name?: string; set?: string; cardNumber?: string };
  frontImage?: string;
  backImage?: string;
  onStatus?: (status: string) => void;
}

export interface StartPcIdentityReidentifyResult {
  portfolioCard: StudioPortfolioCard;
  candidates: PcSearchCandidate[];
  searchUrl: string;
  searchQuery: string;
}

/**
 * Search PriceCharting from hint/keywords only — no LLM vision.
 * Caller shows pick modal; on pick call completePcReidentify.
 */
export async function startPcIdentityReidentify(
  input: StartPcIdentityReidentifyInput
): Promise<StartPcIdentityReidentifyResult> {
  const { hint, cardId, priorGrade, portfolioCard, fallbackSearch, frontImage, backImage, onStatus } =
    input;

  onStatus?.('Searching PriceCharting...');
  const searchQuery = buildPcSearchQuery(hint, fallbackSearch);
  const candidates = await searchPcForReidentify(searchQuery);

  if (candidates.length === 0) {
    throw new Error(`No PriceCharting listings found for "${searchQuery}". Try different keywords.`);
  }

  onStatus?.('Pick the correct listing...');

  let row = portfolioCard;
  if (!row) {
    row = await ensurePortfolioRow({
      cardId,
      name: priorGrade.detectedName || fallbackSearch?.name || '',
      set: priorGrade.detectedSet || fallbackSearch?.set || '',
      cardNumber: priorGrade.detectedCardNumber || fallbackSearch?.cardNumber || '',
      year: priorGrade.detectedYear,
      artist: priorGrade.detectedArtist,
      frontImage,
      backImage,
      grading: priorGrade,
      pricechartingUrl: undefined,
    });
  }

  return {
    portfolioCard: row,
    candidates,
    searchUrl: buildPcSearchUrl(searchQuery),
    searchQuery,
  };
}
