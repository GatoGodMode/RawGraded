import React from 'react';
import { fmtMoney } from '../../services/pricing/tcgConditionPrice';
import type { StudioPortfolioCard } from '../../services/portfolio/studioPortfolioTypes';

export const MarketPriceCell: React.FC<{ card: StudioPortfolioCard; error?: string | null }> = ({
  card,
  error,
}) => {
  const hasRaw = typeof card.raw === 'number' && Number.isFinite(card.raw);
  const hasTcg = typeof card.tcgMarket === 'number' && Number.isFinite(card.tcgMarket);
  const refreshed = card.lastRefreshedAt
    ? new Date(card.lastRefreshedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : null;

  return (
    <div className="text-right min-w-[7rem]">
      <div className="font-semibold tabular-nums text-sm leading-tight flex flex-wrap items-baseline justify-end gap-x-1">
        <span className="text-emerald-400">{hasRaw ? fmtMoney(card.raw) : '—'}</span>
        <span className="text-gray-600 font-normal">/</span>
        <span className="text-blue-400">{hasTcg ? fmtMoney(card.tcgMarket) : '—'}</span>
      </div>
      {card.tcgCondition && (
        <p className="text-[10px] text-gray-500 mt-0.5" title={card.tcgConditionHint || undefined}>
          {card.tcgCondition}
          {card.tcgConditionHint?.includes('fallback') ? ' *' : ''}
        </p>
      )}
      {refreshed && <p className="text-[9px] text-gray-600 mt-0.5">{refreshed}</p>}
      {error && <p className="text-[9px] text-red-400 mt-0.5 max-w-[10rem] ml-auto">{error}</p>}
    </div>
  );
};

export default MarketPriceCell;
