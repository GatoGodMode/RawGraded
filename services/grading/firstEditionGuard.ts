/** Sets that could legally have a 1st Edition stamp on the card front (Wizards era). */
const FIRST_EDITION_ELIGIBLE = [
  'base set',
  'base set 2',
  'fossil',
  'jungle',
  'team rocket',
  'neo genesis',
  'neo genisis',
];

function normalizeSetName(set: string): string {
  return set
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isFirstEditionEligibleSet(detectedSet: string): boolean {
  const norm = normalizeSetName(detectedSet || '');
  if (!norm) return false;
  return FIRST_EDITION_ELIGIBLE.some((eligible) => norm.includes(eligible) || eligible.includes(norm));
}

function looksLikeFirstEdition(edition: string): boolean {
  const e = edition.toLowerCase();
  return e.includes('1st') || e.includes('first edition');
}

/** Strip 1st Edition when the set cannot have that stamp. */
export function sanitizeDetectedEdition(detectedSet: string, edition: string): string {
  const trimmed = (edition || '').trim();
  if (!trimmed) return '';
  if (!looksLikeFirstEdition(trimmed)) return trimmed;
  if (isFirstEditionEligibleSet(detectedSet)) return trimmed;
  return 'Unlimited';
}
