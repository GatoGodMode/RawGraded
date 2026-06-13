import type { GradingResult } from '../../types';
import { sanitizeDetectedEdition } from '../grading/firstEditionGuard';
import type { ResolvedCardIdentity } from '../../types';

export interface MergeIdentityOptions {
  /** When true, non-empty incoming identity fields replace existing (re-analysis). */
  preferIncoming?: boolean;
  /** User hint fields applied after LLM merge (highest priority for provided fields). */
  hintResolved?: Partial<ResolvedCardIdentity> | null;
}

function pickIdentityField(
  incoming: string | undefined,
  existing: string,
  preferIncoming: boolean
): string {
  const inc = (incoming || '').trim();
  if (preferIncoming && inc) return inc;
  return inc || existing;
}

/** Merge Phase 1 identity fields onto an existing grading result; preserve defects and condition evidence. */
export function mergeIdentityIntoResult(
  existing: GradingResult,
  identity: GradingResult,
  options?: MergeIdentityOptions
): GradingResult {
  const preferIncoming = options?.preferIncoming ?? false;
  const hint = options?.hintResolved;

  let detectedName = pickIdentityField(identity.detectedName, existing.detectedName, preferIncoming);
  let detectedSet = pickIdentityField(identity.detectedSet, existing.detectedSet, preferIncoming);
  let detectedCardNumber = pickIdentityField(
    identity.detectedCardNumber,
    existing.detectedCardNumber,
    preferIncoming
  );
  let detectedYear = pickIdentityField(identity.detectedYear, existing.detectedYear, preferIncoming);
  let detectedArtist = pickIdentityField(identity.detectedArtist, existing.detectedArtist, preferIncoming);
  let detectedCharacter = pickIdentityField(
    identity.detectedCharacter,
    existing.detectedCharacter,
    preferIncoming
  );

  if (hint?.detectedName?.trim()) detectedName = hint.detectedName.trim();
  if (hint?.detectedSet?.trim()) detectedSet = hint.detectedSet.trim();
  if (hint?.detectedCardNumber?.trim()) detectedCardNumber = hint.detectedCardNumber.trim();
  if (hint?.detectedYear?.trim()) detectedYear = hint.detectedYear.trim();
  if (hint?.detectedArtist?.trim()) detectedArtist = hint.detectedArtist.trim();

  const edition = sanitizeDetectedEdition(
    detectedSet || existing.detectedSet,
    pickIdentityField(identity.detectedEdition, existing.detectedEdition, preferIncoming)
  );

  const identityNote = identity.reasoning?.trim();
  const priorReasoning = existing.reasoning?.trim() || '';
  const reasoning =
    identityNote && identityNote !== priorReasoning
      ? priorReasoning
        ? `${priorReasoning} | [Re-identified]: ${identityNote}`
        : `[Re-identified]: ${identityNote}`
      : priorReasoning;

  return {
    ...existing,
    detectedName,
    detectedCharacter,
    detectedSet,
    detectedYear,
    detectedEdition: edition,
    detectedCardNumber,
    detectedArtist,
    isHolographic: identity.isHolographic ?? existing.isHolographic,
    holoPattern: identity.holoPattern || existing.holoPattern,
    predictedGrades: identity.predictedGrades ?? existing.predictedGrades,
    reasoning,
  };
}
