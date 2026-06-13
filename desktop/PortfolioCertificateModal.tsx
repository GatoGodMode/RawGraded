import React, { useCallback, useEffect, useState } from 'react';
import StudioCertificate from '../components/StudioCertificate';
import { portfolioCardToCardData } from '../services/portfolio/portfolioCardToCardData';
import { runPortfolioReanalysis, portfolioCardHasScanImages } from '../services/portfolio/runPortfolioReanalysis';
import { metadataFromResolvedIdentity, reidentifyFromPcLink } from '../services/portfolio/reidentifyFromPriceCharting';
import type { GradingResult } from '../types';
import type { StudioPortfolioCard } from '../services/portfolio/studioPortfolioTypes';

interface PortfolioCertificateModalProps {
  card: StudioPortfolioCard;
  onClose: () => void;
  onCardUpdated?: (card: StudioPortfolioCard) => void;
}

const PortfolioCertificateModal: React.FC<PortfolioCertificateModalProps> = ({
  card: initialCard,
  onClose,
  onCardUpdated,
}) => {
  const [liveCard, setLiveCard] = useState(initialCard);
  const [cardData, setCardData] = useState(() => portfolioCardToCardData(initialCard));
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [reanalysisStatus, setReanalysisStatus] = useState('');
  const [reanalysisError, setReanalysisError] = useState<string | null>(null);

  useEffect(() => {
    setLiveCard(initialCard);
    setCardData(portfolioCardToCardData(initialCard));
  }, [initialCard]);

  const grade = liveCard.grading as GradingResult | null | undefined;
  const canReidentifyIdentity = Boolean(grade);
  const canFullRegrade = portfolioCardHasScanImages(liveCard) && Boolean(grade);

  const applySavedCard = useCallback(
    (saved: StudioPortfolioCard, result: GradingResult, authoritative: boolean) => {
      setLiveCard(saved);
      setCardData({
        ...portfolioCardToCardData(saved),
        authoritativeIdentity: authoritative
          ? {
              detectedName: saved.name,
              detectedSet: saved.set,
              detectedCardNumber: saved.cardNumber,
              source: 'pricecharting',
              pricechartingUrl: saved.pricechartingUrl,
            }
          : undefined,
        aiGrade: result,
        userGrade: result,
        metadata: metadataFromResolvedIdentity(portfolioCardToCardData(saved).metadata, {
          detectedName: saved.name,
          detectedSet: saved.set,
          detectedCardNumber: saved.cardNumber,
          source: 'pricecharting',
        }),
      });
      onCardUpdated?.(saved);
    },
    [onCardUpdated]
  );

  const runIdentityViaPc = useCallback(
    async (link: string) => {
      if (!canReidentifyIdentity || isReanalyzing || !grade) return;

      setIsReanalyzing(true);
      setReanalysisError(null);
      setReanalysisStatus('Loading PriceCharting listing...');

      try {
        const { card: saved, grade: merged } = await reidentifyFromPcLink({
          link,
          cardId: liveCard.id,
          priorGrade: grade,
          portfolioCard: liveCard,
          fallbackSearch: {
            name: liveCard.name,
            set: liveCard.set,
            cardNumber: liveCard.cardNumber,
          },
          frontImage: liveCard.frontImage,
          backImage: liveCard.backImage,
        });
        applySavedCard(saved, merged, true);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setReanalysisError(msg);
        throw e;
      } finally {
        setIsReanalyzing(false);
        setReanalysisStatus('');
      }
    },
    [canReidentifyIdentity, isReanalyzing, grade, liveCard, applySavedCard]
  );

  const runFullRegrade = useCallback(
    async (hint: string) => {
      if (!canFullRegrade || isReanalyzing) return;

      setIsReanalyzing(true);
      setReanalysisError(null);
      setReanalysisStatus('Preparing full re-grade...');

      try {
        const { result, card: saved } = await runPortfolioReanalysis({
          card: liveCard,
          identificationHint: hint,
          mode: 'full',
          onStatus: setReanalysisStatus,
        });
        applySavedCard(saved, result, false);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setReanalysisError(msg);
        throw e;
      } finally {
        setIsReanalyzing(false);
        setReanalysisStatus('');
      }
    },
    [canFullRegrade, isReanalyzing, liveCard, applySavedCard]
  );

  if (!grade) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 overflow-y-auto">
      <div className="sticky top-0 z-[101] flex justify-between items-center gap-3 p-3 bg-black/80 border-b border-white/10">
        {!canFullRegrade && canReidentifyIdentity && (
          <p className="text-[10px] text-gray-500 uppercase tracking-wider max-w-md">
            Full re-grade needs stored scan images. Re-identify needs a PriceCharting product link only.
          </p>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-white/20 rounded hover:border-white/40"
        >
          Close
        </button>
      </div>
      <StudioCertificate
        cardData={cardData}
        grade={cardData.userGrade || grade}
        onDone={onClose}
        doneButtonLabel="Close"
        onReidentify={canReidentifyIdentity ? (link) => runIdentityViaPc(link) : undefined}
        onFullRegrade={canFullRegrade ? (hint) => runFullRegrade(hint) : undefined}
        isReanalyzing={isReanalyzing}
        reanalysisStatus={reanalysisStatus}
        reanalysisError={reanalysisError}
        portfolioCard={liveCard}
      />
    </div>
  );
};

export default PortfolioCertificateModal;
