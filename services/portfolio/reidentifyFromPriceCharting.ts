import type { GradingResult, ResolvedCardIdentity } from '../../types';
import {
  applyResolvedIdentityToGradingResult,
  identityFromPortfolioCard,
  metadataFromResolvedIdentity,
} from '../grading/authoritativeIdentity';
import { canonicalizePricechartingUrl } from '../pricing/pricechartingCanonical';
import type { PcSearchCandidate, PricingResolvedIdentity } from './portfolioBridgeTypes';
import type { StudioPortfolioCard } from './studioPortfolioTypes';

export function buildPcSearchQuery(
  hint: string,
  fallback?: { name?: string; set?: string; cardNumber?: string }
): string {
  const t = hint.trim();
  if (t) return t;
  return [fallback?.name, fallback?.set, fallback?.cardNumber].filter(Boolean).join(' ').trim();
}

export function buildPcSearchUrl(query: string): string {
  return `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}`;
}

/** Product listing URL (not search). */
export function parsePcListingUrl(raw: string): string | null {
  const canonical = canonicalizePricechartingUrl(raw.trim());
  if (!canonical) return null;
  try {
    const path = new URL(canonical).pathname;
    if (path.includes('/search-products')) return null;
    if (!path.includes('/game/')) return null;
    return canonical;
  } catch {
    return null;
  }
}

export interface ReidentifyFromPcLinkInput {
  link: string;
  cardId: string;
  priorGrade: GradingResult;
  portfolioCard?: StudioPortfolioCard | null;
  fallbackSearch?: { name?: string; set?: string; cardNumber?: string };
  frontImage?: string;
  backImage?: string;
}

/** Apply a PriceCharting product URL directly — no search, no vision. */
export async function reidentifyFromPcLink(
  input: ReidentifyFromPcLinkInput
): Promise<CompletePcReidentifyResult> {
  const url = parsePcListingUrl(input.link);
  if (!url) {
    throw new Error(
      'Paste a PriceCharting product link (e.g. https://www.pricecharting.com/game/pokemon-...).'
    );
  }

  let row = input.portfolioCard;
  if (!row) {
    row = await ensurePortfolioRow({
      cardId: input.cardId,
      name: input.priorGrade.detectedName || input.fallbackSearch?.name || '',
      set: input.priorGrade.detectedSet || input.fallbackSearch?.set || '',
      cardNumber: input.priorGrade.detectedCardNumber || input.fallbackSearch?.cardNumber || '',
      year: input.priorGrade.detectedYear,
      artist: input.priorGrade.detectedArtist,
      frontImage: input.frontImage,
      backImage: input.backImage,
      grading: input.priorGrade,
      pricechartingUrl: undefined,
    });
  }

  return completePcReidentify(row, input.priorGrade, url);
}

export async function searchPcForReidentify(query: string): Promise<PcSearchCandidate[]> {
  if (!query.trim()) {
    throw new Error('Enter a card name, set, or number to search PriceCharting.');
  }
  if (!window.desktop?.pricingSearchPriceCharting) {
    throw new Error('PriceCharting search is not available in this environment.');
  }
  return window.desktop.pricingSearchPriceCharting(query.trim());
}

export function resolvedIdentityFromPricing(
  resolved?: PricingResolvedIdentity,
  card?: StudioPortfolioCard
): ResolvedCardIdentity {
  if (resolved) {
    return {
      detectedName: resolved.detectedName,
      detectedSet: resolved.detectedSet,
      detectedCardNumber: resolved.detectedCardNumber,
      source: 'pricecharting',
      pricechartingUrl: resolved.pricechartingUrl || card?.pricechartingUrl,
    };
  }
  if (card) return identityFromPortfolioCard(card);
  throw new Error('No identity data from PriceCharting.');
}

/** Merge PC listing onto existing grade (keeps defects, subgrades, reasoning). */
export function mergeGradeWithPcIdentity(
  priorGrade: GradingResult,
  auth: ResolvedCardIdentity
): GradingResult {
  return applyResolvedIdentityToGradingResult(priorGrade, auth);
}

export interface EnsurePortfolioInput {
  cardId: string;
  name: string;
  set: string;
  cardNumber: string;
  year?: string;
  artist?: string;
  frontImage?: string;
  backImage?: string;
  grading: GradingResult;
  pricechartingUrl?: string;
  provenance?: StudioPortfolioCard['provenance'];
}

export async function ensurePortfolioRow(input: EnsurePortfolioInput): Promise<StudioPortfolioCard> {
  if (!window.desktop?.portfolioAddFromGrading) {
    throw new Error('Portfolio save is not available.');
  }
  return (await window.desktop.portfolioAddFromGrading(input)) as StudioPortfolioCard;
}

export interface CompletePcReidentifyResult {
  card: StudioPortfolioCard;
  grade: GradingResult;
  resolvedIdentity: ResolvedCardIdentity;
}

/** Apply chosen PriceCharting URL and persist portfolio + grading identity (no vision). */
export async function completePcReidentify(
  portfolioCard: StudioPortfolioCard,
  priorGrade: GradingResult,
  pcUrl: string
): Promise<CompletePcReidentifyResult> {
  if (!window.desktop?.pricingRefreshWithPcUrl) {
    throw new Error('PriceCharting refresh is not available.');
  }

  const res = await window.desktop.pricingRefreshWithPcUrl(portfolioCard.id, pcUrl);
  if (!res.ok || !res.card) {
    throw new Error(res.error || 'Could not load that PriceCharting listing.');
  }

  const saved = res.card as StudioPortfolioCard;
  const auth = resolvedIdentityFromPricing(res.resolvedIdentity, saved);
  const grade = mergeGradeWithPcIdentity(priorGrade, auth);

  const persisted = await ensurePortfolioRow({
    cardId: saved.id,
    name: auth.detectedName || saved.name,
    set: auth.detectedSet || saved.set,
    cardNumber: auth.detectedCardNumber || saved.cardNumber,
    year: priorGrade.detectedYear || saved.year,
    artist: priorGrade.detectedArtist || saved.artist,
    frontImage: saved.frontImage,
    backImage: saved.backImage,
    grading: grade,
    pricechartingUrl: auth.pricechartingUrl || saved.pricechartingUrl,
    provenance: saved.provenance,
  });

  return { card: persisted, grade, resolvedIdentity: auth };
}

export { metadataFromResolvedIdentity };
