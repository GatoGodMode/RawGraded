import React from 'react';
import { fmtMoney } from '../../services/pricing/tcgConditionPrice';
import type { StudioPortfolioCard } from '../../services/portfolio/studioPortfolioTypes';
import type { PcSearchCandidate } from '../../services/portfolio/portfolioBridgeTypes';
import { ExternalMarketLinks } from './ExternalMarketLinks';

export const MarketPriceStrip: React.FC<{
  card: Partial<StudioPortfolioCard> & { name?: string; set?: string; cardNumber?: string };
  loading?: boolean;
  error?: string | null;
  needsPick?: boolean;
  onRefresh?: () => void;
  onPickListing?: () => void;
}> = ({ card, loading = false, error, needsPick = false, onRefresh, onPickListing }) => {
  const hasRaw = typeof card.raw === 'number' && card.raw > 0;
  const hasTcg = typeof card.tcgMarket === 'number' && Number.isFinite(card.tcgMarket);

  return (
    <section className="rounded-lg border border-white/10 bg-[#0a0a0a] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-poke-gold">Market prices</h3>
          {needsPick ? (
            <p className="text-sm text-amber-400 mt-1">Multiple listings — pick one</p>
          ) : (
            <p className="text-lg font-bold tabular-nums mt-1">
              <span className="text-emerald-400">{hasRaw ? fmtMoney(card.raw) : '—'}</span>
              <span className="text-gray-600 mx-2 font-normal">/</span>
              <span className="text-blue-400">{hasTcg ? fmtMoney(card.tcgMarket) : '—'}</span>
            </p>
          )}
          {card.tcgCondition && !needsPick && (
            <p className="text-xs text-gray-500 mt-1" title={card.tcgConditionHint || undefined}>
              {card.tcgConditionHint || `TCGPlayer ${card.tcgCondition}`}
            </p>
          )}
          {card.lastRefreshedAt && !needsPick && (
            <p className="text-[10px] text-gray-600 mt-1">
              Updated {new Date(card.lastRefreshedAt).toLocaleString()}
            </p>
          )}
        </div>
        <ExternalMarketLinks card={card} />
      </div>
      {error && <p className="text-xs text-red-400 rounded border border-red-500/20 bg-red-950/20 px-3 py-2">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {needsPick && onPickListing && (
          <button
            type="button"
            onClick={onPickListing}
            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded bg-amber-500/20 border border-amber-500/40 text-amber-300"
          >
            Pick listing
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded border border-poke-gold/30 text-poke-gold disabled:opacity-40"
          >
            {loading ? 'Fetching…' : 'Fetch prices'}
          </button>
        )}
      </div>
    </section>
  );
};

export default MarketPriceStrip;

export type { PcSearchCandidate };
