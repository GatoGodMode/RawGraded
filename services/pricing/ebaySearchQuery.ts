export const buildEbaySearchQuery = (c: {
  name?: string | null;
  set?: string | null;
  cardNumber?: string | null;
}): string => {
  const parts = [c.name, c.cardNumber, c.set]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean);
  return (
    parts
      .join(' ')
      .replace(/\s*\(\d+\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'pokemon card'
  );
};

export const ebaySearchUrlForCard = (c: {
  name?: string | null;
  set?: string | null;
  cardNumber?: string | null;
}): string => {
  const q = buildEbaySearchQuery(c);
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`;
};

export const ebayPurchaseSearchUrlForCard = (c: {
  name?: string | null;
  set?: string | null;
  cardNumber?: string | null;
}): string => `${ebaySearchUrlForCard(c)}&_sop=15`;
