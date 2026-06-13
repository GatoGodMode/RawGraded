export const BRAND_LOGOS = {
  pricecharting: '/branding/pricecharting.svg',
  tcgplayer: '/branding/tcgplayer.svg',
  ebay: '/branding/ebay.svg',
} as const;

export type BrandLogoKey = keyof typeof BRAND_LOGOS;

const withBase = (p: string): string => {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const rel = String(p || '').replace(/^\/+/, '');
  return `${base}/${rel}`.replace(/\/{2,}/g, '/');
};

export const brandLogoSrc = (key: BrandLogoKey): string => withBase(BRAND_LOGOS[key]);

export const BRAND_LABELS: Record<BrandLogoKey, string> = {
  pricecharting: 'PC',
  tcgplayer: 'TCG',
  ebay: 'eBay',
};
