import React from 'react';
import { ebaySearchUrlForCard } from '../../services/pricing/ebaySearchQuery';
import { ensureTcgplayerNearMintUrl, extractTcgplayerProductId } from '../../services/pricing/tcgplayerUrl';
import { BrandLogoImg } from './BrandLogoImg';

const linkBase =
  'inline-flex items-center justify-center rounded-lg border border-white/15 bg-black/40 p-1.5 transition-colors hover:border-poke-gold/40 hover:bg-white/5';
const disabledWrap =
  'inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-white/5 bg-black/20 p-1.5 opacity-40';
const linkLogoCls = 'h-[22px] w-auto max-h-[22px] max-w-[5.5rem] object-contain object-center pointer-events-none';

export type MarketLinkCard = {
  name?: string;
  set?: string;
  cardNumber?: string;
  pricechartingUrl?: string;
  tcgplayerUrl?: string;
  tcgplayerSummary?: { url?: string } | null;
};

function resolveTcgUrl(card: MarketLinkCard): string | null {
  const u = (card.tcgplayerUrl ?? '').trim();
  if (extractTcgplayerProductId(u)) return ensureTcgplayerNearMintUrl(u);
  const s = (card.tcgplayerSummary?.url ?? '').trim();
  if (extractTcgplayerProductId(s)) return ensureTcgplayerNearMintUrl(s);
  return null;
}

async function openExternal(url: string) {
  if (window.desktop?.shellOpenExternal) {
    await window.desktop.shellOpenExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function openEbay(url: string, e: React.MouseEvent) {
  e.preventDefault();
  if (window.desktop?.shellOpenEdge) {
    await window.desktop.shellOpenEdge(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export const ExternalMarketLinks: React.FC<{ card: MarketLinkCard; compact?: boolean }> = ({
  card,
  compact = false,
}) => {
  const pc = (card.pricechartingUrl ?? '').trim();
  const ebay = ebaySearchUrlForCard(card);
  const tcg = resolveTcgUrl(card);

  return (
    <div className={`flex items-center justify-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
      {pc ? (
        <button type="button" className={linkBase} title="Open on PriceCharting" onClick={() => void openExternal(pc)}>
          <span className="sr-only">PriceCharting</span>
          <BrandLogoImg brand="pricecharting" className={linkLogoCls} title="PriceCharting" />
        </button>
      ) : (
        <span className={disabledWrap} title="No PriceCharting URL yet">
          <BrandLogoImg brand="pricecharting" className={`${linkLogoCls} opacity-35 grayscale`} title="PriceCharting" />
        </span>
      )}
      <button type="button" className={linkBase} title="Search on eBay (Edge on Windows)" onClick={(e) => void openEbay(ebay, e)}>
        <span className="sr-only">eBay search</span>
        <BrandLogoImg brand="ebay" className={linkLogoCls} title="eBay" />
      </button>
      {tcg ? (
        <button type="button" className={linkBase} title="Open on TCGplayer" onClick={() => void openExternal(tcg)}>
          <span className="sr-only">TCGplayer</span>
          <BrandLogoImg brand="tcgplayer" className="h-7 w-7 object-contain" title="TCGplayer" />
        </button>
      ) : (
        <span className={disabledWrap} title="No TCGplayer URL yet">
          <BrandLogoImg brand="tcgplayer" className="h-7 w-7 object-contain opacity-35" title="TCGplayer" />
        </span>
      )}
    </div>
  );
};

export default ExternalMarketLinks;
