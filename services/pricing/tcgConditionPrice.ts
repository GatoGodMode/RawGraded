import type { TcgComparisonMarketPrices } from './pricingTypes';

export type TcgConditionKey =
  | 'nearMint'
  | 'lightlyPlayed'
  | 'moderatelyPlayed'
  | 'heavilyPlayed'
  | 'damaged';

export interface TcgConditionPriceResult {
  price: number | null;
  conditionLabel: string;
  conditionKey: TcgConditionKey;
  usedFallback: boolean;
  hint: string;
}

const TCG_GRADE_MAP: Array<{ pattern: RegExp; key: TcgConditionKey; label: string }> = [
  { pattern: /near\s*mint|\bnm\b/i, key: 'nearMint', label: 'Near Mint' },
  { pattern: /lightly\s*played|\blp\b/i, key: 'lightlyPlayed', label: 'Lightly Played' },
  { pattern: /moderately\s*played|\bmp\b/i, key: 'moderatelyPlayed', label: 'Moderately Played' },
  { pattern: /heavily\s*played|\bhp\b/i, key: 'heavilyPlayed', label: 'Heavily Played' },
  { pattern: /damaged|\bdmg\b/i, key: 'damaged', label: 'Damaged' },
];

const SLAB_JARGON = /\b(gem\s*mint|pristine|nm-?mt|mint\+?|psa\s*10|bgs\s*9\.5|cgc\s*10|gem\b|black\s*label)\b/i;

export function mapTcgGradeToConditionKey(tcgGrade: string): TcgConditionKey {
  const g = String(tcgGrade || '').trim();
  if (SLAB_JARGON.test(g)) return 'lightlyPlayed';
  for (const row of TCG_GRADE_MAP) {
    if (row.pattern.test(g)) return row.key;
  }
  return 'nearMint';
}

function pickPrice(comparison: TcgComparisonMarketPrices | undefined, key: TcgConditionKey): number | null {
  if (!comparison) return null;
  const v = comparison[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export function resolveTcgPriceForGrade(
  tcgGrade: string | undefined,
  comparison: TcgComparisonMarketPrices | undefined,
  nmFallback?: number | null
): TcgConditionPriceResult {
  const key = mapTcgGradeToConditionKey(tcgGrade || 'Near Mint');
  const label = TCG_GRADE_MAP.find((r) => r.key === key)?.label || 'Near Mint';
  let price = pickPrice(comparison, key);
  let usedFallback = false;
  let hint = `TCGPlayer ${label} market price`;

  if (price == null && key !== 'nearMint') {
    price = pickPrice(comparison, 'nearMint') ?? (typeof nmFallback === 'number' ? nmFallback : null);
    usedFallback = price != null;
    if (usedFallback) {
      hint = `${label} price unavailable — showing Near Mint as fallback`;
    }
  }

  return { price, conditionLabel: label, conditionKey: key, usedFallback, hint };
}

export function fmtMoney(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}
