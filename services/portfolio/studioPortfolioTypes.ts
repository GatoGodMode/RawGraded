import type { GradingResult } from '../../types';
import type { PriceSnapshot, TcgplayerProductSummary } from '../pricing/pricingTypes';

export interface StudioPortfolioProvenance {
  acqPrice?: number;
  acqDate?: string;
  source?: string;
  notes?: string;
}

export interface StudioPortfolioCard {
  id: string;
  name: string;
  set: string;
  cardNumber: string;
  year?: string;
  artist?: string;
  pricechartingUrl?: string;
  tcgplayerUrl?: string;
  raw?: number;
  grade9?: number;
  psa10?: number;
  tcgMarket?: number;
  tcgCondition?: string;
  tcgConditionHint?: string;
  tcgplayerSummary?: TcgplayerProductSummary | null;
  grading?: GradingResult | null;
  frontImage?: string;
  backImage?: string;
  provenance?: StudioPortfolioProvenance;
  priceHistory: PriceSnapshot[];
  isArchived: boolean;
  archivedAt?: number;
  lastRefreshedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export function buildPcSearchSlug(name: string, set: string, cardNumber: string): string {
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const n = slugify(name);
  const num = String(cardNumber || '').replace(/[^0-9a-z]/gi, '');
  const setSlug = slugify(set);
  if (n && setSlug && num) return `https://www.pricecharting.com/game/${setSlug}/${n}-${num}`;
  return '';
}
