import type { StudioPortfolioCard, StudioPortfolioProvenance } from './studioPortfolioTypes';

export interface PortfolioListParams {
  limit?: number;
  offset?: number;
  search?: string;
  includeArchived?: boolean;
  sort?: 'updated' | 'name' | 'raw';
}

export type { StudioPortfolioCard, StudioPortfolioProvenance };
