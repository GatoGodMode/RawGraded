export type TcgComparisonMarketPrices = {
  nearMint?: number | null;
  lightlyPlayed?: number | null;
  moderatelyPlayed?: number | null;
  heavilyPlayed?: number | null;
  damaged?: number | null;
};

export type TcgplayerProductSummary = {
  productId: number;
  productName: string;
  setName: string;
  rarityName: string | null;
  marketPrice: number;
  lowestPrice: number | null;
  url: string;
  source: 'playwright_exact_url' | 'api_details';
  comparisonMarketPrices?: TcgComparisonMarketPrices;
  fetchedAt: number;
};

export type PriceSnapshot = {
  at: number;
  raw: number | null;
  tcgPrice: number | null;
  tcgCondition: string;
};
