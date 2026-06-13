import type { TcgdexCandidate } from '../grading/cardAnalysisWorkVector';

export const TCGDEX_LOOKUP_TIMEOUT_MS = 8000;
export const TCGDEX_MAX_CARDS_PROCESS = 50;
export const TCGDEX_CANDIDATE_LIMIT = 3;

const TCGDEX_REST_BASE = 'https://api.tcgdex.net/v2/en/cards';

export type TcgdexCandidateResult = TcgdexCandidate & { variants?: unknown };

interface TcgdexRestCard {
  id?: string;
  localId?: string;
  name?: string;
  illustrator?: string;
  rarity?: string;
  variants?: unknown;
  set?: { name?: string; releaseDate?: string };
}

function buildSearchName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const words = trimmed.split(/\s+/);
  if (words.length <= 3) return trimmed;
  return words[0] ?? trimmed;
}

function filterByCardNumber(cards: TcgdexRestCard[], cardNumber: string): TcgdexRestCard[] {
  const cleanNum = cardNumber.split('/')[0]?.replace(/[^0-9A-Za-z]/g, '') ?? '';
  if (!cleanNum) return cards;
  const strict = cards.filter((c) => {
    const id = String(c.id || '');
    const localId = String(c.localId || '');
    return id.endsWith(`-${cleanNum}`) || localId.toLowerCase() === cleanNum.toLowerCase();
  });
  return strict.length > 0 ? strict : cards;
}

function toCandidates(cards: TcgdexRestCard[]): TcgdexCandidateResult[] {
  return cards.slice(0, TCGDEX_CANDIDATE_LIMIT).map((c) => ({
    id: String(c.id || ''),
    localId: String(c.localId || ''),
    name: String(c.name || ''),
    set: String(c.set?.name || ''),
    year: c.set?.releaseDate ? String(c.set.releaseDate).split('-')[0] : '',
    artist: String(c.illustrator || ''),
    rarity: String(c.rarity || ''),
    variants: c.variants || {},
  }));
}

async function fetchTcgdexRestCards(url: string): Promise<TcgdexRestCard[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TCGDEX_LOOKUP_TIMEOUT_MS) });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as TcgdexRestCard[];
}

function buildRestUrl(filter: string): string {
  const params = new URLSearchParams({
    name: filter,
    'pagination:page': '1',
    'pagination:itemsPerPage': '15',
  });
  return `${TCGDEX_REST_BASE}?${params.toString()}`;
}

/** Bounded Pokemon TCGdex lookup — never throws; returns [] on timeout or error. */
export async function lookupPokemonCandidates(
  name: string,
  cardNumber = ''
): Promise<TcgdexCandidateResult[]> {
  const searchName = buildSearchName(name);
  if (!searchName) return [];

  try {
    let cards = await fetchTcgdexRestCards(buildRestUrl(`eq:${searchName}`));

    if (cards.length === 0 && searchName.includes(' ')) {
      const firstWord = searchName.split(/\s+/)[0];
      if (firstWord && firstWord !== searchName) {
        cards = await fetchTcgdexRestCards(buildRestUrl(`like:${firstWord}`));
      }
    }

    if (cards.length === 0) {
      const firstWord = searchName.split(/\s+/)[0];
      if (firstWord && firstWord !== searchName) {
        cards = await fetchTcgdexRestCards(buildRestUrl(`eq:${firstWord}`));
      }
    }

    if (cards.length > TCGDEX_MAX_CARDS_PROCESS) {
      cards = cards.slice(0, TCGDEX_MAX_CARDS_PROCESS);
    }

    return toCandidates(filterByCardNumber(cards, cardNumber));
  } catch (err) {
    console.warn('TCGdex lookup failed (continuing without candidates):', err);
    return [];
  }
}

export function buildOllamaCandidateContext(candidates: TcgdexCandidateResult[]): string {
  if (candidates.length === 0) return '';
  return `OFFICIAL POKEMON TCGDEX CANDIDATES:
${JSON.stringify(candidates, null, 2)}
Use these candidates as official reference data. If one candidate matches the visible card, copy its official name, set, year, artist, card number/localId, rarity, and holo/first-edition variant flags.`;
}

export function buildGeminiTcgdexContext(candidates: TcgdexCandidateResult[]): string {
  if (candidates.length === 0) return '';
  return `OFFICIAL POKEMON API MATCHES FOUND:
${JSON.stringify(candidates, null, 2)}

You MUST strongly prefer these exact official Set Names, limits, Artist names, and variant/holographic flags over raw OCR text if they match the visuals. Pay special attention to the variants block to correctly flag isHolographic or First Edition.`;
}
