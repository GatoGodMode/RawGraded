import * as cheerio from 'cheerio';
import { randomUUID } from 'crypto';
import { parseCardHtml } from './pricechartingScraper';
import { fetchTcgplayerProduct, extractTcgplayerProductId } from './tcgplayerCapture';
import { canonicalizePricechartingUrl } from '../shared/pricechartingCanonical';
import { resolveTcgPriceForGrade } from '../shared/tcgConditionPrice';
import type { StudioPortfolioCard } from '../shared/studioPortfolioTypes';
import { buildPcSearchSlug } from '../shared/studioPortfolioTypes';
import { getPortfolioCard, upsertPortfolioCard } from './portfolioDb';
import { configurePlaywrightBrowsersPath } from './shellEdge';

const PC_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

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

export interface PricingRefreshOutcome {
  ok: boolean;
  card?: StudioPortfolioCard;
  error?: string;
  needsPick?: boolean;
  candidates?: PcSearchCandidate[];
  searchUrl?: string;
  resolvedIdentity?: PricingResolvedIdentity;
}

function applyScrapedIdentity(
  card: StudioPortfolioCard,
  scraped: { name: string; set: string; cardNumber: string },
  force: boolean
): PricingResolvedIdentity {
  const num = (scraped.cardNumber || '').replace(/^#/, '').trim();
  if (force || !card.name?.trim()) card.name = (scraped.name || card.name || '').trim();
  if (force || !card.set?.trim()) card.set = (scraped.set || card.set || '').trim();
  if (force || !card.cardNumber?.trim()) card.cardNumber = num || card.cardNumber || '';
  return {
    detectedName: card.name,
    detectedSet: card.set,
    detectedCardNumber: card.cardNumber,
    pricechartingUrl: card.pricechartingUrl,
  };
}

export async function fetchPricechartingHtml(url: string) {
  const canonical = canonicalizePricechartingUrl(url);
  if (!canonical) throw new Error('Invalid PriceCharting URL');
  const res = await fetch(canonical, { headers: PC_FETCH_HEADERS });
  if (!res.ok) throw new Error(`PriceCharting responded ${res.status}`);
  const html = await res.text();
  const scraped = parseCardHtml(html, canonical);
  return { scraped, canonicalUrl: canonical };
}

function isSearchResultsUrl(url: string): boolean {
  return /search-products/i.test(url);
}

function parseCandidateFromAnchor(href: string, label: string): PcSearchCandidate | null {
  const abs = new URL(href, 'https://www.pricecharting.com').toString();
  const canon = canonicalizePricechartingUrl(abs);
  if (!canon) return null;
  const cleanLabel = label.replace(/\s+/g, ' ').trim();
  const numMatch = cleanLabel.match(/#(\d+[a-z]?)/i);
  return {
    url: canon,
    label: cleanLabel || canon,
    cardNumber: numMatch?.[1],
  };
}

function scoreCandidate(
  c: PcSearchCandidate,
  identity: { name: string; set: string; cardNumber: string }
): number {
  let score = 0;
  const label = c.label.toLowerCase();
  const set = (identity.set || '').toLowerCase();
  const name = (identity.name || '').toLowerCase();
  const num = (identity.cardNumber || '').toLowerCase().replace(/^#/, '');
  if (set && label.includes(set)) score += 3;
  if (num && (label.includes(`#${num}`) || label.includes(` ${num}`))) score += 3;
  for (const token of name.split(/\s+/).filter((w) => w.length > 2)) {
    if (label.includes(token)) score += 1;
  }
  return score;
}

function rankCandidates(
  candidates: PcSearchCandidate[],
  identity: { name: string; set: string; cardNumber: string }
): PcSearchCandidate[] {
  return candidates
    .map((c) => ({ ...c, score: scoreCandidate(c, identity) }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

function parseSearchLinks(html: string): PcSearchCandidate[] {
  const $ = cheerio.load(html);
  const links: PcSearchCandidate[] = [];
  $('a[href]').each((_, a) => {
    const href = String($(a).attr('href') || '').trim();
    if (!href || !/^\/(game|trading-cards)\//i.test(href)) return;
    const label = $(a).text().trim() || $(a).attr('title') || '';
    const parentText = $(a).parent().text().replace(label, '').trim();
    const cand = parseCandidateFromAnchor(href, label);
    if (!cand) return;
    if (parentText && parentText.length < 80) cand.setHint = parentText;
    if (!links.some((l) => l.url === cand.url)) links.push(cand);
  });
  return links;
}

export async function searchPricechartingUrls(q: string): Promise<PcSearchCandidate[]> {
  const normalized = q.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const terms = [
    normalized,
    normalized.replace(/\s+#?\d+[a-z]?$/i, '').trim(),
    normalized.split(/\s+/).slice(0, 3).join(' '),
  ].filter((t, i, arr) => t && arr.indexOf(t) === i);

  for (const term of terms) {
    const urls = [
      `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(term)}`,
      `https://www.pricecharting.com/search-products?q=${encodeURIComponent(term)}`,
    ];
    for (const u of urls) {
      try {
        const res = await fetch(u, { headers: PC_FETCH_HEADERS });
        if (!res.ok) continue;
        const links = parseSearchLinks(await res.text());
        if (links.length) return links.slice(0, 8);
      } catch {
        /* try next */
      }
    }
  }

  const guess = buildPcSearchSlug(normalized, '', '');
  return guess ? [{ url: guess, label: normalized }] : [];
}

async function applyTcgPrices(card: StudioPortfolioCard, now: number): Promise<void> {
  const tcgUrl = card.tcgplayerUrl?.trim();
  const productId = tcgUrl ? extractTcgplayerProductId(tcgUrl) : null;
  if (!productId) return;

  const snap = await fetchTcgplayerProduct(productId, tcgUrl);
  const tcgGrade =
    (card.grading?.predictedGrades as { tcg?: string } | undefined)?.tcg || 'Near Mint';
  const resolved = resolveTcgPriceForGrade(tcgGrade, snap.comparisonMarketPrices, snap.marketPrice);
  card.tcgplayerSummary = {
    productId: snap.productId,
    productName: snap.productName,
    setName: snap.setName,
    rarityName: snap.rarityName,
    marketPrice: snap.marketPrice,
    lowestPrice: snap.lowestPrice,
    url: snap.url,
    source: snap.source,
    comparisonMarketPrices: snap.comparisonMarketPrices,
    fetchedAt: now,
  };
  card.tcgMarket = resolved.price ?? undefined;
  card.tcgCondition = resolved.conditionLabel;
  card.tcgConditionHint = resolved.hint;
  card.tcgplayerUrl = snap.url;
}

function finalizeCard(card: StudioPortfolioCard, now: number): StudioPortfolioCard {
  card.lastRefreshedAt = now;
  card.updatedAt = now;
  card.priceHistory.push({
    at: now,
    raw: card.raw ?? null,
    tcgPrice: card.tcgMarket ?? null,
    tcgCondition: card.tcgCondition || 'Near Mint',
  });
  if (card.priceHistory.length > 120) card.priceHistory = card.priceHistory.slice(-120);
  upsertPortfolioCard(card);
  return card;
}

export async function refreshPortfolioCardWithPcUrl(
  cardId: string,
  pcUrl: string
): Promise<PricingRefreshOutcome> {
  configurePlaywrightBrowsersPath();
  const existing = getPortfolioCard(cardId);
  if (!existing) return { ok: false, error: 'Card not found' };

  const card: StudioPortfolioCard = { ...existing, priceHistory: [...(existing.priceHistory || [])] };
  const now = Date.now();
  const canonical = canonicalizePricechartingUrl(pcUrl);
  if (!canonical) return { ok: false, error: 'Invalid PriceCharting URL' };

  try {
    const { scraped, canonicalUrl } = await fetchPricechartingHtml(canonical);
    if (scraped.raw <= 0 && isSearchResultsUrl(canonicalUrl)) {
      const candidates = await searchPricechartingUrls(
        [card.name, card.set, card.cardNumber].filter(Boolean).join(' ')
      );
      return {
        ok: false,
        needsPick: true,
        error: 'Selected URL is not a product page.',
        candidates: rankCandidates(candidates, card),
        searchUrl: buildSearchUrl(card),
      };
    }
    if (scraped.raw <= 0) {
      return { ok: false, error: 'No raw price found on this listing.' };
    }

    card.pricechartingUrl = canonicalUrl;
    card.raw = scraped.raw;
    card.grade9 = scraped.grade9;
    card.psa10 = scraped.psa10;
    if (scraped.tcgplayerUrl) card.tcgplayerUrl = scraped.tcgplayerUrl;
    const resolvedIdentity = applyScrapedIdentity(card, scraped, true);

    await applyTcgPrices(card, now);
    return { ok: true, card: finalizeCard(card, now), resolvedIdentity };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function buildSearchUrl(card: { name: string; set: string; cardNumber: string }): string {
  const q = [card.name, card.set, card.cardNumber].filter(Boolean).join(' ');
  return `https://www.pricecharting.com/search-products?q=${encodeURIComponent(q)}`;
}

export async function refreshPortfolioCardPrices(cardId: string): Promise<PricingRefreshOutcome> {
  configurePlaywrightBrowsersPath();
  const existing = getPortfolioCard(cardId);
  if (!existing) return { ok: false, error: 'Card not found' };

  const identity = {
    name: existing.name || '',
    set: existing.set || '',
    cardNumber: existing.cardNumber || '',
  };
  const searchQuery = [identity.name, identity.set, identity.cardNumber].filter(Boolean).join(' ');
  const now = Date.now();
  const card: StudioPortfolioCard = { ...existing, priceHistory: [...(existing.priceHistory || [])] };

  let pcUrl = existing.pricechartingUrl?.trim() || '';
  let candidates: PcSearchCandidate[] = [];

  if (!pcUrl) {
    candidates = rankCandidates(await searchPricechartingUrls(searchQuery), identity);
    pcUrl = candidates[0]?.url || buildPcSearchSlug(identity.name, identity.set, identity.cardNumber);
  }

  if (!pcUrl) {
    return {
      ok: false,
      needsPick: true,
      error: 'No PriceCharting listing found.',
      candidates,
      searchUrl: buildSearchUrl(identity),
    };
  }

  try {
    const { scraped, canonicalUrl } = await fetchPricechartingHtml(pcUrl);

    if (scraped.raw <= 0) {
      if (!candidates.length) {
        candidates = rankCandidates(await searchPricechartingUrls(searchQuery), identity);
      }
      const top = candidates[0]?.score || 0;
      const ambiguous = candidates.filter((c) => (c.score || 0) >= top - 1).length >= 2;
      if (isSearchResultsUrl(canonicalUrl) || ambiguous || scraped.raw === 0) {
        return {
          ok: false,
          needsPick: true,
          error: 'Multiple listings or no price — pick the correct PriceCharting product.',
          candidates,
          searchUrl: buildSearchUrl(identity),
        };
      }
      return {
        ok: false,
        error: 'PriceCharting returned no raw price for this listing.',
        candidates,
        searchUrl: buildSearchUrl(identity),
      };
    }

    card.pricechartingUrl = canonicalUrl;
    card.raw = scraped.raw;
    card.grade9 = scraped.grade9;
    card.psa10 = scraped.psa10;
    if (scraped.tcgplayerUrl) card.tcgplayerUrl = scraped.tcgplayerUrl;
    const resolvedIdentity = applyScrapedIdentity(card, scraped, false);

    await applyTcgPrices(card, now);
    return { ok: true, card: finalizeCard(card, now), resolvedIdentity };
  } catch (err) {
    if (!candidates.length) {
      candidates = rankCandidates(await searchPricechartingUrls(searchQuery), identity);
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      needsPick: candidates.length > 1,
      candidates,
      searchUrl: buildSearchUrl(identity),
    };
  }
}

export function createCardFromGrading(input: {
  cardId?: string;
  name: string;
  set: string;
  cardNumber: string;
  year?: string;
  artist?: string;
  frontImage?: string;
  backImage?: string;
  grading: StudioPortfolioCard['grading'];
  pricechartingUrl?: string;
  provenance?: StudioPortfolioCard['provenance'];
}): StudioPortfolioCard {
  const now = Date.now();
  const id = input.cardId || randomUUID();
  const existing = getPortfolioCard(id);
  const card: StudioPortfolioCard = {
    id,
    name: input.name || existing?.name || '',
    set: input.set || existing?.set || '',
    cardNumber: input.cardNumber || existing?.cardNumber || '',
    year: input.year || existing?.year,
    artist: input.artist || existing?.artist,
    pricechartingUrl: input.pricechartingUrl || existing?.pricechartingUrl,
    tcgplayerUrl: existing?.tcgplayerUrl,
    raw: existing?.raw,
    tcgMarket: existing?.tcgMarket,
    tcgCondition: existing?.tcgCondition,
    grading: input.grading,
    frontImage: input.frontImage || existing?.frontImage,
    backImage: input.backImage || existing?.backImage,
    provenance: input.provenance ?? existing?.provenance,
    priceHistory: existing?.priceHistory || [],
    isArchived: existing?.isArchived ?? false,
    archivedAt: existing?.archivedAt,
    lastRefreshedAt: existing?.lastRefreshedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  upsertPortfolioCard(card);
  return card;
}

export function archivePortfolioCard(id: string, archived: boolean): StudioPortfolioCard | null {
  const card = getPortfolioCard(id);
  if (!card) return null;
  const now = Date.now();
  const updated: StudioPortfolioCard = {
    ...card,
    isArchived: archived,
    archivedAt: archived ? now : undefined,
    updatedAt: now,
  };
  upsertPortfolioCard(updated);
  return updated;
}

export function updatePortfolioProvenance(
  id: string,
  provenance: StudioPortfolioCard['provenance']
): StudioPortfolioCard | null {
  const card = getPortfolioCard(id);
  if (!card) return null;
  const updated: StudioPortfolioCard = {
    ...card,
    provenance: { ...card.provenance, ...provenance },
    updatedAt: Date.now(),
  };
  upsertPortfolioCard(updated);
  return updated;
}
