import React, { useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { CardData, GradingResult } from '../types';
import { formatRatioLabel } from '../services/centering/psaFromRatios';
import { CENTERING_UNMEASURED_RISK } from '../services/grading/gradingMathEngine';
import { isMobileApp } from '../services/platform/platformBridge';
import MarketPriceStrip from './pricing/MarketPriceStrip';
import PriceChartingPickModal from './pricing/PriceChartingPickModal';
import EvidenceCrop from './EvidenceCrop';
import {
  buildVideoFrameLabels,
  getImageSourceLabel,
  getReferencedFrameIndices,
  getSourceImageByIndex,
} from '../services/grading/evidenceImages';
import { deriveTcgCondition } from '../services/grading/tcgGradeNormalize';
import { resolveCertificateIdentity } from '../services/grading/authoritativeIdentity';
import { parsePcListingUrl } from '../services/portfolio/reidentifyFromPriceCharting';
import { buildExportCardData } from '../services/export/buildExportCardData';
import { captureElementToPng, downloadDataUrl } from '../services/export/captureElementToPng';
import StudioSlabSlipTarget from './export/StudioSlabSlipTarget';
import StudioSocial1080Target from './export/StudioSocial1080Target';
import type { StudioPortfolioCard } from '../services/portfolio/studioPortfolioTypes';

interface StudioCertificateProps {
  cardData: CardData;
  grade: GradingResult;
  onDone: () => void;
  /** Primary footer action label (default: New scan). */
  doneButtonLabel?: string;
  mobile?: boolean;
  onReidentify?: (priceChartingUrl: string) => Promise<void>;
  onFullRegrade?: (hint: string) => Promise<void>;
  onCancelReanalysis?: () => void;
  isReanalyzing?: boolean;
  reanalysisStatus?: string;
  reanalysisError?: string | null;
  readOnly?: boolean;
  portfolioCard?: StudioPortfolioCard | null;
  portfolioLoading?: boolean;
  portfolioError?: string | null;
  portfolioSaved?: boolean;
  onFetchPrices?: () => void;
  onAddToPortfolio?: () => void;
  priceNeedsPick?: boolean;
  onPickListing?: () => void;
  pcPickOpen?: boolean;
  pcCandidates?: PcSearchCandidate[];
  pcSearchUrl?: string;
  pcPickLoading?: boolean;
  onPcPick?: (url: string) => void;
  onPcPickClose?: () => void;
}

const formatGrade = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value;
  return '--';
};

const displayText = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '--';
};

const StudioCertificate: React.FC<StudioCertificateProps> = ({
  cardData,
  grade,
  onDone,
  doneButtonLabel = 'New scan',
  mobile = false,
  onReidentify,
  onFullRegrade,
  onCancelReanalysis,
  isReanalyzing = false,
  reanalysisStatus = '',
  reanalysisError = null,
  readOnly = false,
  portfolioCard = null,
  portfolioLoading = false,
  portfolioError = null,
  portfolioSaved = false,
  onFetchPrices,
  onAddToPortfolio,
  priceNeedsPick = false,
  onPickListing,
  pcPickOpen = false,
  pcCandidates = [],
  pcSearchUrl,
  pcPickLoading = false,
  onPcPick,
  onPcPickClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const slabRef = useRef<HTMLDivElement>(null);
  const socialRef = useRef<HTMLDivElement>(null);
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [pcReidentifyUrl, setPcReidentifyUrl] = useState('');
  const [regradeHint, setRegradeHint] = useState('');
  const [pcUrlError, setPcUrlError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const certId = (cardData.id || '').substring(0, 8).toUpperCase();
  const useMobileExport = mobile || isMobileApp();
  const m = cardData.centeringMeasurement;
  const predicted = grade.predictedGrades;
  const tcgDisplay = predicted?.tcg ? deriveTcgCondition(grade) : '--';
  const resolvedId = resolveCertificateIdentity(cardData, grade, portfolioCard);
  const exportCardData = useMemo(
    () => buildExportCardData(cardData, grade, resolvedId),
    [cardData, grade, resolvedId]
  );

  const exportPng = async () => {
    if (!ref.current) return;
    const canvas = await html2canvas(ref.current, { backgroundColor: '#000', scale: 2 });
    const dataUrl = canvas.toDataURL('image/png');
    const filename = `rawgraded-studio-${certId}.png`;

    if (useMobileExport) {
      try {
        const base64 = dataUrl.split(',')[1] || '';
        await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });
        const uri = (await Filesystem.getUri({ path: filename, directory: Directory.Cache })).uri;
        await Share.share({
          title: 'RawGraded Studio Certificate',
          text: `${resolvedId.detectedName || 'Card'} - Overall ${grade.overall}`,
          url: uri,
          dialogTitle: 'Share certificate',
        });
      } catch {
        await Share.share({
          title: 'RawGraded Studio Certificate',
          text: `${resolvedId.detectedName || 'Card'} - Overall ${grade.overall}`,
        });
      }
      return;
    }

    const a = document.createElement('a');
    a.download = filename;
    a.href = dataUrl;
    a.click();
  };

  const exportSlabSlip = async () => {
    if (!slabRef.current || exportBusy) return;
    setExportBusy(true);
    try {
      const dataUrl = await captureElementToPng(slabRef.current, {
        width: 754,
        height: 1054,
        scale: 1.5,
        backgroundColor: '#ffffff',
      });
      downloadDataUrl(dataUrl, `rawgraded-slab-${certId}.png`);
    } catch (err) {
      console.error('Slab slip export failed:', err);
    } finally {
      setExportBusy(false);
    }
  };

  const exportSocial1080 = async () => {
    if (!socialRef.current || exportBusy) return;
    setExportBusy(true);
    try {
      const dataUrl = await captureElementToPng(socialRef.current, {
        width: 1080,
        height: 1080,
        scale: 1,
        backgroundColor: '#090909',
      });
      downloadDataUrl(dataUrl, `rawgraded-social-1080-${certId}.png`);
    } catch (err) {
      console.error('Social 1080 export failed:', err);
    } finally {
      setExportBusy(false);
    }
  };

  const openReanalyze = () => {
    setPcReidentifyUrl(resolvedId.pricechartingUrl?.trim() || '');
    setRegradeHint(
      [resolvedId.detectedName, resolvedId.detectedSet, resolvedId.detectedCardNumber]
        .filter(Boolean)
        .join(' ')
    );
    setPcUrlError('');
    setReanalyzeOpen(true);
  };

  const pastePcUrl = async () => {
    setPcUrlError('');
    try {
      const text = await navigator.clipboard.readText();
      setPcReidentifyUrl(text.trim());
    } catch {
      setPcUrlError('Could not read clipboard — paste with Ctrl+V.');
    }
  };

  const runReidentify = async () => {
    if (!onReidentify || isReanalyzing) return;
    setPcUrlError('');
    if (!parsePcListingUrl(pcReidentifyUrl)) {
      setPcUrlError('Paste a valid PriceCharting product link (…/game/…).');
      return;
    }
    try {
      await onReidentify(pcReidentifyUrl.trim());
      setReanalyzeOpen(false);
    } catch {
      // Parent renders reanalysisError.
    }
  };

  const runFullRegrade = async () => {
    if (!onFullRegrade || isReanalyzing) return;
    try {
      await onFullRegrade(regradeHint);
      setReanalyzeOpen(false);
    } catch {
      // Parent renders reanalysisError.
    }
  };

  const identityRows = [
    ['Name', resolvedId.detectedName || '--'],
    ['Set', resolvedId.detectedSet || '--'],
    ['Year', displayText(grade.detectedYear, cardData.metadata.year)],
    ['Number', resolvedId.detectedCardNumber || '--'],
    ['Artist', displayText(grade.detectedArtist, cardData.metadata.artist)],
    ['Edition', displayText(grade.detectedEdition, cardData.metadata.edition)],
    ['Foil', displayText(grade.holoPattern, cardData.metadata.holo_pattern, grade.isHolographic ? 'holo' : '')],
  ];

  const conditionRows = [
    ['Centering', formatGrade(grade.centering)],
    ['Corners', formatGrade(grade.corners)],
    ['Edges', formatGrade(grade.edges)],
    ['Surface', formatGrade(grade.surface)],
  ];

  const psaCapped =
    typeof predicted?.psa === 'number' &&
    typeof grade.overall === 'number' &&
    predicted.psa > grade.overall;

  const defects = grade.defects || [];
  const riskFactors = grade.riskFactors || [];
  const frameLabels = buildVideoFrameLabels(cardData.videoFrames?.length || 0);
  const referencedFrames = getReferencedFrameIndices(defects);

  const marketCard: Partial<StudioPortfolioCard> = portfolioCard || {
    name: resolvedId.detectedName,
    set: resolvedId.detectedSet,
    cardNumber: resolvedId.detectedCardNumber,
    pricechartingUrl: resolvedId.pricechartingUrl,
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4">
      <div ref={ref} className="bg-[#0a0a0a] border border-poke-gold/30 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="text-center border-b border-white/10 pb-5">
          <p className="text-[10px] text-gray-500 uppercase tracking-[0.3em]">
            RawGraded Studio {useMobileExport ? '- Android' : '- Local'}
          </p>
          <h2 className="text-2xl sm:text-3xl font-black text-poke-gold mt-2">
            {resolvedId.detectedName || 'Card'}
          </h2>
          <p className="text-sm text-gray-400">
            {resolvedId.detectedSet || '--'}
            {grade.detectedYear || cardData.metadata.year
              ? ` - ${displayText(grade.detectedYear, cardData.metadata.year)}`
              : ''}
          </p>
          {resolvedId.source === 'pricecharting' && (
            <p className="text-[9px] text-gray-500 uppercase tracking-widest mt-1">Identity: PriceCharting</p>
          )}
          <p className="text-5xl font-black text-white mt-4">{formatGrade(grade.overall)}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest">Overall - ID {certId}</p>
        </div>

        <div className="grid grid-cols-4 gap-3 text-center">
          {[
            ['PSA', predicted?.psa],
            ['BGS', predicted?.bgs],
            ['CGC', predicted?.cgc],
            ['TCG', tcgDisplay],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-black/50 rounded p-3 border border-white/5">
              <p className="text-[9px] text-gray-500 uppercase">{label}</p>
              <p className="text-xl font-black text-white">{formatGrade(value)}</p>
            </div>
          ))}
        </div>
        {psaCapped && (
          <p className="text-[10px] text-gray-500 text-center italic">
            Predicted grade capped by condition analysis (overall {formatGrade(grade.overall)}).
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="rounded-lg border border-white/10 bg-black/30 p-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-poke-gold mb-3">Identity</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {identityRows.map(([label, value]) => (
                <div key={label}>
                  <p className="text-[9px] uppercase tracking-widest text-gray-600">{label}</p>
                  <p className="text-xs text-gray-200 break-words">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-black/30 p-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-poke-gold mb-3">Condition</h3>
            <div className="grid grid-cols-4 gap-2 text-center">
              {conditionRows.map(([label, value]) => (
                <div key={label} className="rounded bg-black/50 border border-white/5 p-2">
                  <p className="text-[8px] uppercase text-gray-500">{label}</p>
                  <p className="text-lg font-black text-white">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-1">
              {grade.centeringMeasured != null && (
                <p className="text-xs text-gray-500">
                  Ruler centering: <span className="text-poke-gold font-mono">{formatGrade(grade.centeringMeasured)}</span>
                  {' · '}
                  Final: <span className="text-white font-mono">{formatGrade(grade.centering)}</span>
                </p>
              )}
              {grade.centeringMeasured == null && riskFactors.includes(CENTERING_UNMEASURED_RISK) && (
                <p className="text-[10px] text-amber-500/90 italic">
                  Run the centering ruler for an accurate centering subgrade (default 8 applied).
                </p>
              )}
              {m?.front && (
                <p className={`text-xs font-mono ${m.front.centeringValid === false ? 'text-amber-500' : 'text-gray-400'}`}>
                  Front centering: {formatRatioLabel(m.front)}
                </p>
              )}
              {m?.back && (
                <p className={`text-xs font-mono ${m.back.centeringValid === false ? 'text-amber-500' : 'text-gray-400'}`}>
                  Back centering: {formatRatioLabel(m.back)}
                </p>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-white/10 bg-black/30 p-4">
          <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-poke-gold mb-3">Analysis</h3>
          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{grade.reasoning}</p>
        </section>

        {(cardData.analysisChunks?.length || grade.analysisChunks?.length) ? (
          <section className="rounded-lg border border-white/10 bg-black/30 p-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-poke-gold mb-3">Phased analysis</h3>
            <div className="grid grid-cols-3 gap-1.5 max-w-md">
              {(cardData.analysisChunks || grade.analysisChunks || []).map((chunk) => (
                <div
                  key={chunk.imageIndex}
                  className="relative rounded border border-white/10 bg-black/50 overflow-hidden aspect-[5/7]"
                  title={getImageSourceLabel(chunk.imageIndex, frameLabels)}
                >
                  <img src={chunk.dataUrl} alt={chunk.label} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 inset-x-0 text-[7px] text-center bg-black/70 text-gray-400 py-0.5 truncate px-0.5">
                    {getImageSourceLabel(chunk.imageIndex, frameLabels)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-white/10 bg-black/30 p-4">
          <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-poke-gold mb-3">Defects</h3>
          {defects.length > 0 ? (
            <div className="space-y-2">
              {defects.slice(0, 6).map((defect, idx) => (
                <div key={`${defect.category}-${idx}`} className="rounded border border-white/5 bg-black/40 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-300 flex items-center gap-2">
                    {defect.category || 'Defect'} — {getImageSourceLabel(defect.imageIndex ?? 0, frameLabels)}
                    {defect.inferred && (
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        Inferred
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{defect.description || (defect as unknown as { reasoning?: string }).reasoning || 'No detail provided.'}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No listed defects.</p>
          )}
        </section>

        {defects.length > 0 && (
          <section className="rounded-lg border border-white/10 bg-black/30 p-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-poke-gold mb-3">Forensic evidence</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {defects.slice(0, 6).map((defect, idx) => {
                const sourceImg = getSourceImageByIndex(cardData, defect.imageIndex ?? 0, defect);
                const hasBox = Array.isArray(defect.box2d) && defect.box2d.length === 4;
                return (
                  <div key={`ev-${defect.category}-${idx}`} className="flex flex-col items-center rounded border border-white/10 bg-black/40 p-2">
                    {sourceImg && hasBox ? (
                      <EvidenceCrop imageSrc={sourceImg} box={defect.box2d!} label={defect.category} />
                    ) : sourceImg ? (
                      <img src={sourceImg} alt={defect.category} className="w-full h-28 object-contain rounded" />
                    ) : (
                      <div className="w-full h-28 rounded border-2 border-dashed border-white/20 flex items-center justify-center">
                        <span className="text-[10px] text-gray-500">No image</span>
                      </div>
                    )}
                    <p className="text-[9px] text-gray-500 mt-1 text-center line-clamp-2">{defect.category}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {riskFactors.length > 0 && (
          <section className="rounded-lg border border-amber-500/20 bg-amber-950/20 p-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-400 mb-3">Risk factors</h3>
            <ul className="space-y-1.5">
              {riskFactors.slice(0, 8).map((factor, idx) => (
                <li key={`risk-${idx}`} className="text-xs text-amber-100/80 leading-relaxed flex gap-2">
                  <span className="text-amber-500 shrink-0">•</span>
                  <span>{factor}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(onFetchPrices || onAddToPortfolio) && (
          <div className="space-y-3">
            <MarketPriceStrip
              card={marketCard}
              loading={portfolioLoading}
              error={portfolioError}
              needsPick={priceNeedsPick}
              onRefresh={onFetchPrices}
              onPickListing={onPickListing}
            />
            {onAddToPortfolio && (
              <button
                type="button"
                disabled={portfolioLoading || portfolioSaved}
                onClick={onAddToPortfolio}
                className="w-full py-2.5 text-[10px] font-black uppercase tracking-widest rounded border border-poke-gold/40 text-poke-gold disabled:opacity-40"
              >
                {portfolioSaved ? 'In portfolio' : 'Add to portfolio'}
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {cardData.frontCropped && (
            <img src={cardData.frontCropped} alt="Front" className="rounded border border-white/10 w-full" />
          )}
          {cardData.backCropped && (
            <img src={cardData.backCropped} alt="Back" className="rounded border border-white/10 w-full" />
          )}
        </div>

        <section className="rounded-lg border border-white/10 bg-black/30 p-4">
          <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-poke-gold mb-3">Frames assessed</h3>
          {(cardData.videoFrames?.length || 0) > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {cardData.videoFrames!.map((src, i) => (
                <div
                  key={`vf-${i}`}
                  className={`shrink-0 w-24 rounded border p-1 ${referencedFrames.has(i) ? 'border-poke-gold/60 bg-poke-gold/5' : 'border-white/10 bg-black/40'}`}
                >
                  <img src={src} alt={frameLabels[i] || `Frame ${i + 1}`} className="w-full h-20 object-contain rounded" />
                  <p className="text-[8px] text-gray-500 text-center mt-1 uppercase tracking-wider truncate">
                    {frameLabels[i] || `Frame ${i + 1}`}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">No guided video captured for this scan.</p>
          )}
        </section>
      </div>

      <div className="flex flex-wrap gap-3 justify-center rg-safe-pb">
        <button
          type="button"
          disabled={exportBusy}
          onClick={() => void exportPng()}
          className="px-6 py-3 bg-poke-blue text-xs font-bold uppercase tracking-widest rounded disabled:opacity-50"
        >
          {useMobileExport ? 'Share PNG' : 'Export certificate'}
        </button>
        {!useMobileExport && (
          <>
            <button
              type="button"
              disabled={exportBusy}
              onClick={() => void exportSlabSlip()}
              className="px-6 py-3 border border-white/20 text-xs font-bold uppercase tracking-widest rounded disabled:opacity-50"
            >
              Export slab slip
            </button>
            <button
              type="button"
              disabled={exportBusy}
              onClick={() => void exportSocial1080()}
              className="px-6 py-3 border border-poke-gold/40 text-poke-gold text-xs font-bold uppercase tracking-widest rounded disabled:opacity-50"
            >
              Export social 1080
            </button>
          </>
        )}
        {(onReidentify || onFullRegrade) && (
          <button
            type="button"
            onClick={openReanalyze}
            className="px-6 py-3 border border-poke-gold/40 text-poke-gold text-xs font-bold uppercase tracking-widest rounded"
          >
            Re-analyze
          </button>
        )}
        <button type="button" onClick={onDone} className="px-6 py-3 bg-poke-gold text-black text-xs font-bold uppercase tracking-widest rounded">
          {doneButtonLabel}
        </button>
      </div>

      {pcPickOpen && onPcPick && onPcPickClose && (
        <PriceChartingPickModal
          open={pcPickOpen}
          candidates={pcCandidates}
          searchUrl={pcSearchUrl}
          loading={pcPickLoading}
          onPick={onPcPick}
          onClose={onPcPickClose}
        />
      )}

      <div style={{ position: 'fixed', left: -12000, top: 0, pointerEvents: 'none' }} aria-hidden>
        <StudioSlabSlipTarget ref={slabRef} exportCardData={exportCardData} grade={grade} />
        <StudioSocial1080Target
          ref={socialRef}
          cardData={cardData}
          grade={grade}
          resolvedId={resolvedId}
          certId={certId}
        />
      </div>

      {reanalyzeOpen && (
        <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#080808] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-poke-gold">Re-analyze</h3>
                <p className="text-xs text-gray-500 mt-2">
                  Re-identify: paste the PriceCharting product page from your browser (no search, no GPU). Full re-grade
                  optionally uses keywords and re-runs AI on your scans.
                </p>
              </div>
              <button
                type="button"
                disabled={isReanalyzing}
                onClick={() => setReanalyzeOpen(false)}
                className="text-xs text-gray-500 hover:text-white disabled:opacity-40"
              >
                Close
              </button>
            </div>

            {onReidentify && (
              <label className="block mt-5">
                <span className="text-[10px] uppercase tracking-widest text-gray-500">PriceCharting link</span>
                <input
                  type="url"
                  value={pcReidentifyUrl}
                  onChange={(e) => {
                    setPcReidentifyUrl(e.target.value);
                    setPcUrlError('');
                  }}
                  maxLength={512}
                  disabled={isReanalyzing}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-poke-gold/50 disabled:opacity-60"
                  placeholder="https://www.pricecharting.com/game/pokemon-..."
                />
                <button
                  type="button"
                  disabled={isReanalyzing}
                  onClick={() => void pastePcUrl()}
                  className="mt-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-poke-gold disabled:opacity-40"
                >
                  Paste from clipboard
                </button>
              </label>
            )}

            {onFullRegrade && (
              <label className={`block ${onReidentify ? 'mt-4' : 'mt-5'}`}>
                <span className="text-[10px] uppercase tracking-widest text-gray-500">
                  Identification hint (full re-grade only)
                </span>
                <textarea
                  value={regradeHint}
                  onChange={(e) => setRegradeHint(e.target.value)}
                  maxLength={160}
                  rows={2}
                  disabled={isReanalyzing}
                  className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-poke-gold/50 disabled:opacity-60"
                  placeholder="e.g. Charmander Base Set 46/102"
                />
              </label>
            )}

            {(pcUrlError || reanalysisError) && (
              <p className="mt-3 rounded border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">
                {pcUrlError || reanalysisError}
              </p>
            )}

            {isReanalyzing && (
              <p className="mt-3 text-xs text-poke-gold uppercase tracking-widest">{reanalysisStatus || 'Working...'}</p>
            )}
            <div className="mt-5 flex flex-col gap-2">
              {onReidentify && (
                <button
                  type="button"
                  disabled={isReanalyzing}
                  onClick={() => void runReidentify()}
                  className="w-full rounded bg-poke-gold py-3 text-xs font-black uppercase tracking-widest text-black disabled:opacity-50"
                >
                  {isReanalyzing ? 'Running...' : 'Re-identify'}
                </button>
              )}
              {onFullRegrade && (
                <button
                  type="button"
                  disabled={isReanalyzing}
                  onClick={() => void runFullRegrade()}
                  className="w-full rounded border border-poke-gold/40 py-3 text-xs font-black uppercase tracking-widest text-poke-gold disabled:opacity-50"
                >
                  {isReanalyzing ? 'Running...' : 'Full re-grade'}
                </button>
              )}
              {isReanalyzing && onCancelReanalysis && (
                <button
                  type="button"
                  onClick={onCancelReanalysis}
                  className="w-full rounded border border-white/15 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudioCertificate;
