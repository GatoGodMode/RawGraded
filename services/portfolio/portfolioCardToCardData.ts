import { INITIAL_METADATA, type CardData } from '../../types';
import type { StudioPortfolioCard } from './studioPortfolioTypes';

/** Reconstruct minimal CardData for StudioCertificate from a saved portfolio row. */
export function portfolioCardToCardData(card: StudioPortfolioCard): CardData {
  const grade = card.grading;
  return {
    id: card.id,
    frontRaw: card.frontImage ?? null,
    backRaw: card.backImage ?? null,
    frontCropped: card.frontImage ?? null,
    backCropped: card.backImage ?? null,
    videoRaw: null,
    videoFrames: [],
    userGrade: grade ?? null,
    aiGrade: grade ?? null,
    metadata: {
      ...INITIAL_METADATA,
      name: grade?.detectedName || card.name || '',
      character: grade?.detectedCharacter || '',
      set: grade?.detectedSet || card.set || '',
      year: grade?.detectedYear || card.year || '',
      edition: grade?.detectedEdition || '',
      cardNumber: grade?.detectedCardNumber || card.cardNumber || '',
      artist: grade?.detectedArtist || card.artist || '',
      holo_pattern: grade?.holoPattern || '',
      category: INITIAL_METADATA.category,
    },
    dateScanned: new Date(card.updatedAt).toLocaleString(),
    is_holographic: grade?.isHolographic,
  };
}
