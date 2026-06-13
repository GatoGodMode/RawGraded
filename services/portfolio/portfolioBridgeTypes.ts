import type { GradingResult } from '../../types';
import type { StudioPortfolioCard, StudioPortfolioProvenance } from './studioPortfolioTypes';
import type { TcgplayerProductSummary } from '../pricing/pricingTypes';

export interface PortfolioListParams {
  limit?: number;
  offset?: number;
  search?: string;
  includeArchived?: boolean;
  sort?: 'updated' | 'name' | 'raw';
}

export interface PortfolioListResult {
  items: StudioPortfolioCard[];
  total: number;
}

export interface AddFromGradingInput {
  cardId?: string;
  name: string;
  set: string;
  cardNumber: string;
  year?: string;
  artist?: string;
  frontImage?: string;
  backImage?: string;
  grading: GradingResult;
  pricechartingUrl?: string;
  provenance?: StudioPortfolioProvenance;
}

export interface RefreshProgressEvent {
  cardId: string;
  index: number;
  total: number;
  ok: boolean;
  error?: string;
}

export interface PcSearchCandidate {
  url: string;
  label: string;
  setHint?: string;
  cardNumber?: string;
  score?: number;
}

export interface PricingResolvedIdentity {
  detectedName: string;
  detectedSet: string;
  detectedCardNumber: string;
  pricechartingUrl?: string;
}

export interface PricingRefreshResult {
  ok: boolean;
  card?: StudioPortfolioCard;
  error?: string;
  needsPick?: boolean;
  candidates?: PcSearchCandidate[];
  searchUrl?: string;
  resolvedIdentity?: PricingResolvedIdentity;
}

export type { TcgplayerProductSummary, StudioPortfolioCard, StudioPortfolioProvenance };
