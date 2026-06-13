import type { CardData, GradingResult } from '../../types';
import type { ResolvedCardIdentity } from '../../types';

/** Clone CardData with metadata synced to resolved certificate identity (PC / hint / LLM). */
export function buildExportCardData(
  cardData: CardData,
  grade: GradingResult,
  resolvedId: ResolvedCardIdentity
): CardData {
  return {
    ...cardData,
    metadata: {
      ...cardData.metadata,
      name: resolvedId.detectedName || grade.detectedName || cardData.metadata.name,
      set: resolvedId.detectedSet || grade.detectedSet || cardData.metadata.set,
      year: grade.detectedYear || cardData.metadata.year,
      edition: grade.detectedEdition || cardData.metadata.edition,
      cardNumber: resolvedId.detectedCardNumber || grade.detectedCardNumber || cardData.metadata.cardNumber,
      artist: grade.detectedArtist || cardData.metadata.artist,
      holo_pattern: grade.holoPattern || cardData.metadata.holo_pattern,
      character: grade.detectedCharacter || cardData.metadata.character,
    },
  };
}
