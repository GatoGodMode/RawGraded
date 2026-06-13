import type {
  CardData,
  CardMetadata,
  GradingResult,
  ResolvedCardIdentity,
  IdentityAuthority,
} from '../../types';
import type { StudioPortfolioCard } from '../portfolio/studioPortfolioTypes';

export type { IdentityAuthority, ResolvedCardIdentity };

export interface PcScrapedIdentityInput {
  name: string;
  set: string;
  cardNumber: string;
}

export function identityFromPriceChartingScrape(scraped: PcScrapedIdentityInput): ResolvedCardIdentity {
  const num = (scraped.cardNumber || '').replace(/^#/, '').trim();
  return {
    detectedName: (scraped.name || '').trim(),
    detectedSet: (scraped.set || '').trim(),
    detectedCardNumber: num,
    source: 'pricecharting',
  };
}

export function identityFromPortfolioCard(card: StudioPortfolioCard): ResolvedCardIdentity {
  return {
    detectedName: card.name || '',
    detectedSet: card.set || '',
    detectedCardNumber: (card.cardNumber || '').replace(/^#/, '').trim(),
    source: 'pricecharting',
    pricechartingUrl: card.pricechartingUrl,
  };
}

/** Light parse from re-analyze hint textarea. */
export function parseIdentificationHint(hint?: string): Partial<ResolvedCardIdentity> {
  const t = hint?.trim() || '';
  if (!t) return {};

  let detectedCardNumber = '';
  let rest = t;

  const slash = t.match(/\b(\d{1,4}[a-z]?)\s*\/\s*(\d{1,4})\b/i);
  if (slash) {
    detectedCardNumber = `${slash[1]}/${slash[2]}`;
    rest = t.replace(slash[0], '').trim();
  } else {
    const hash = t.match(/#\s*(\d{1,4}[a-z]?)\b/i);
    if (hash) {
      detectedCardNumber = hash[1];
      rest = t.replace(hash[0], '').trim();
    }
  }

  rest = rest.replace(/\s+/g, ' ').trim();
  const out: Partial<ResolvedCardIdentity> = { source: 'user_hint' };
  if (rest) out.detectedName = rest;
  if (detectedCardNumber) out.detectedCardNumber = detectedCardNumber;
  return out;
}

export function applyResolvedIdentityToGradingResult(
  grade: GradingResult,
  resolved: Partial<ResolvedCardIdentity>
): GradingResult {
  return {
    ...grade,
    detectedName: resolved.detectedName?.trim() || grade.detectedName,
    detectedSet: resolved.detectedSet?.trim() || grade.detectedSet,
    detectedCardNumber: resolved.detectedCardNumber?.trim() || grade.detectedCardNumber,
    detectedYear: resolved.detectedYear?.trim() || grade.detectedYear,
    detectedArtist: resolved.detectedArtist?.trim() || grade.detectedArtist,
  };
}

export function metadataFromResolvedIdentity(
  metadata: CardMetadata,
  resolved: Partial<ResolvedCardIdentity>
): CardMetadata {
  return {
    ...metadata,
    name: resolved.detectedName?.trim() || metadata.name,
    set: resolved.detectedSet?.trim() || metadata.set,
    cardNumber: resolved.detectedCardNumber?.trim() || metadata.cardNumber,
    year: resolved.detectedYear?.trim() || metadata.year,
    artist: resolved.detectedArtist?.trim() || metadata.artist,
  };
}

export function resolveCertificateIdentity(
  cardData: CardData,
  grade: GradingResult,
  portfolioCard?: StudioPortfolioCard | null
): ResolvedCardIdentity {
  if (cardData.authoritativeIdentity?.detectedName) {
    return cardData.authoritativeIdentity;
  }
  if (portfolioCard?.pricechartingUrl?.trim()) {
    return identityFromPortfolioCard(portfolioCard);
  }
  return {
    detectedName: grade.detectedName || cardData.metadata.name || '',
    detectedSet: grade.detectedSet || cardData.metadata.set || '',
    detectedCardNumber: grade.detectedCardNumber || cardData.metadata.cardNumber || '',
    detectedYear: grade.detectedYear || cardData.metadata.year,
    detectedArtist: grade.detectedArtist || cardData.metadata.artist,
    source: 'llm',
  };
}

export function buildLockedHintPromptBlock(hint?: string): string {
  const trimmed = hint?.trim();
  if (!trimmed) return '';

  const parsed = parseIdentificationHint(trimmed);
  const hasStructured =
    Boolean(parsed.detectedName) || Boolean(parsed.detectedSet) || Boolean(parsed.detectedCardNumber);

  if (!hasStructured) {
    return `USER CARD NAME / KEYWORD HINT:
"${trimmed}"
Treat as high-priority identity context. Verify against FRONT text only — never use the back scan for name, set, or card number.`;
  }

  const lines = [
    'LOCKED IDENTITY (user-provided — do not contradict; verify only against FRONT bands/OCR):',
    parsed.detectedName ? `Name: ${parsed.detectedName}` : '',
    parsed.detectedSet ? `Set: ${parsed.detectedSet}` : '',
    parsed.detectedCardNumber ? `Card number: ${parsed.detectedCardNumber}` : '',
    'Pokemon/TCG backs are identical — NEVER infer name, set, card number, year, artist, or edition from a back scan.',
  ].filter(Boolean);

  return lines.join('\n');
}
