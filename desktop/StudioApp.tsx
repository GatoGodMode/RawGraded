import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  StudioAppStep,
  CardData,
  INITIAL_METADATA,
  CaptureMetadata,
  CenteringRatioSet,
  BorderGuideState,
} from '../types';
import Cropper from '../components/Cropper';
import VideoCapture from '../components/VideoCapture';
import StudioCertificate from '../components/StudioCertificate';
import CenteringTool from '../components/CenteringTool';
import WebcamCapture from '../components/WebcamCapture';
import CameraCapture from '../components/CameraCapture';
import DesktopSettings from '../components/DesktopSettings';
import MobileSettings from '../components/MobileSettings';
import { runStudioGrading } from '../services/llm/gradingOrchestrator';
import type { ReanalysisMode } from '../services/llm/types';
import { loadDesktopLlmSettings } from '../services/desktopSettings';
import type { StudioPortfolioCard } from '../services/portfolio/studioPortfolioTypes';
import type { PcSearchCandidate, PricingResolvedIdentity } from '../services/portfolio/portfolioBridgeTypes';
import {
  applyResolvedIdentityToGradingResult,
  identityFromPortfolioCard,
  metadataFromResolvedIdentity,
  type ResolvedCardIdentity,
} from '../services/grading/authoritativeIdentity';
import { reidentifyFromPcLink } from '../services/portfolio/reidentifyFromPriceCharting';

const emptyCard = (): CardData => ({
  id: crypto.randomUUID(),
  frontRaw: null,
  backRaw: null,
  frontCropped: null,
  backCropped: null,
  videoRaw: null,
  videoFrames: [],
  userGrade: null,
  aiGrade: null,
  metadata: { ...INITIAL_METADATA },
  dateScanned: new Date().toLocaleString(),
});

interface StudioAppProps {
  onOpenSettings?: () => void;
  mobile?: boolean;
}

const StudioApp: React.FC<StudioAppProps> = ({ onOpenSettings, mobile = false }) => {
  const [step, setStep] = useState<StudioAppStep>(StudioAppStep.UPLOAD);
  const [cardData, setCardData] = useState<CardData>(emptyCard);
  const [cameraSide, setCameraSide] = useState<'front' | 'back' | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [identificationHint, setIdentificationHint] = useState('');
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [reanalysisStatus, setReanalysisStatus] = useState('');
  const [reanalysisError, setReanalysisError] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [portfolioCard, setPortfolioCard] = useState<StudioPortfolioCard | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [portfolioSaved, setPortfolioSaved] = useState(false);
  const [priceNeedsPick, setPriceNeedsPick] = useState(false);
  const [pcPickOpen, setPcPickOpen] = useState(false);
  const [pcCandidates, setPcCandidates] = useState<PcSearchCandidate[]>([]);
  const [pcSearchUrl, setPcSearchUrl] = useState<string | undefined>();
  const [pcPickLoading, setPcPickLoading] = useState(false);
  const [videoSkippedNotice, setVideoSkippedNotice] = useState(false);
  const [skipVideoByDefault, setSkipVideoByDefault] = useState(false);
  const analysisStarted = useRef(false);
  const reanalysisAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void (async () => {
      const s = window.desktop?.getSettingsFull
        ? await window.desktop.getSettingsFull()
        : await loadDesktopLlmSettings();
      setSkipVideoByDefault(s.skipVideoByDefault ?? false);
    })();
  }, [step]);

  const loadHistory = useCallback(async () => {
    if (window.desktop?.listHistory) {
      setHistory(await window.desktop.listHistory());
    }
  }, []);

  const handleFile = (side: 'front' | 'back', file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setCardData((prev) =>
        side === 'front'
          ? { ...prev, frontRaw: url, id: crypto.randomUUID() }
          : { ...prev, backRaw: url }
      );
      if (side === 'front' && cardData.backRaw) setStep(StudioAppStep.CROP_FRONT);
      if (side === 'back' && cardData.frontRaw) setStep(StudioAppStep.CROP_FRONT);
    };
    reader.readAsDataURL(file);
  };

  const handleCropConfirm = (cropped: string) => {
    if (step === StudioAppStep.CROP_FRONT) {
      setCardData((p) => ({ ...p, frontCropped: cropped }));
      setStep(StudioAppStep.CROP_BACK);
    } else if (step === StudioAppStep.CROP_BACK) {
      setCardData((p) => ({ ...p, backCropped: cropped }));
      setStep(StudioAppStep.CENTERING_FRONT);
    }
  };

  const handleCenteringConfirm = (ratios: CenteringRatioSet, _guides: BorderGuideState) => {
    if (step === StudioAppStep.CENTERING_FRONT) {
      setCardData((p) => ({
        ...p,
        centeringMeasurement: { ...p.centeringMeasurement, front: ratios },
      }));
      setStep(StudioAppStep.CENTERING_BACK);
    } else {
      setCardData((p) => ({
        ...p,
        centeringMeasurement: { ...p.centeringMeasurement, back: ratios },
      }));
      void (async () => {
        const s = window.desktop?.getSettingsFull
          ? await window.desktop.getSettingsFull()
          : await loadDesktopLlmSettings();
        const skip = s.skipVideoByDefault ?? false;
        setSkipVideoByDefault(skip);
        if (skip) {
          setVideoSkippedNotice(true);
          setStep(StudioAppStep.ANALYSIS);
        } else {
          setVideoSkippedNotice(false);
          setStep(StudioAppStep.VIDEO_CAPTURE);
        }
      })();
    }
  };

  const handleVideoCapture = (video: string, frames: string[]) => {
    setVideoSkippedNotice(false);
    setCardData((p) => ({ ...p, videoRaw: video, videoFrames: frames }));
    setStep(StudioAppStep.ANALYSIS);
  };

  const handleSkipVideo = () => setStep(StudioAppStep.ANALYSIS);

  const applyPcIdentityToState = (card: StudioPortfolioCard, resolved?: PricingResolvedIdentity) => {
    const auth: ResolvedCardIdentity = resolved
      ? {
          detectedName: resolved.detectedName,
          detectedSet: resolved.detectedSet,
          detectedCardNumber: resolved.detectedCardNumber,
          source: 'pricecharting',
          pricechartingUrl: resolved.pricechartingUrl || card.pricechartingUrl,
        }
      : identityFromPortfolioCard(card);

    setCardData((p) => {
      const base = p.aiGrade || p.userGrade;
      const grade = base ? applyResolvedIdentityToGradingResult(base, auth) : base;
      return {
        ...p,
        authoritativeIdentity: auth,
        aiGrade: grade,
        userGrade: grade,
        metadata: metadataFromResolvedIdentity(p.metadata, auth),
      };
    });
  };

  const syncPortfolioAfterReanalysis = async (result: NonNullable<CardData['userGrade']>) => {
    if (!portfolioCard || !window.desktop?.portfolioAddFromGrading) return;
    const name = result.detectedName?.trim() || cardData.metadata.name || '';
    const set = result.detectedSet?.trim() || cardData.metadata.set || '';
    const cardNumber = result.detectedCardNumber?.trim() || cardData.metadata.cardNumber || '';
    const input = {
      cardId: cardData.id,
      name,
      set,
      cardNumber,
      year: result.detectedYear || cardData.metadata.year,
      artist: result.detectedArtist || cardData.metadata.artist,
      frontImage: cardData.frontCropped || undefined,
      backImage: cardData.backCropped || undefined,
      grading: result,
    };
    const saved = (await window.desktop.portfolioAddFromGrading(input)) as StudioPortfolioCard;
    setPortfolioCard(saved);
    setPortfolioSaved(true);
  };

  const cancelReanalysis = () => {
    reanalysisAbortRef.current?.abort();
    reanalysisAbortRef.current = null;
  };

  const runIdentityReidentifyViaPc = async (link: string) => {
    const prior = cardData.userGrade ?? cardData.aiGrade;
    if (!prior || isReanalyzing) return;

    setIsReanalyzing(true);
    setReanalysisError(null);
    setReanalysisStatus('Loading PriceCharting listing...');

    try {
      const { card: saved, grade: merged, resolvedIdentity } = await reidentifyFromPcLink({
        link,
        cardId: cardData.id,
        priorGrade: prior,
        portfolioCard,
        fallbackSearch: {
          name: cardData.metadata.name,
          set: cardData.metadata.set,
          cardNumber: cardData.metadata.cardNumber,
        },
        frontImage: cardData.frontCropped || undefined,
        backImage: cardData.backCropped || undefined,
      });

      setPortfolioCard(saved);
      setPortfolioSaved(true);
      setCardData((p) => ({
        ...p,
        authoritativeIdentity: resolvedIdentity,
        aiGrade: merged,
        userGrade: merged,
        metadata: metadataFromResolvedIdentity(p.metadata, resolvedIdentity),
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setReanalysisError(msg);
      throw e;
    } finally {
      setIsReanalyzing(false);
      setReanalysisStatus('');
    }
  };

  const runAnalysis = async (opts?: {
    identificationHint?: string;
    reanalysis?: boolean;
    reanalysisMode?: ReanalysisMode;
  }) => {
    if (!cardData.frontCropped || !cardData.backCropped || isAnalyzing || isReanalyzing) return;
    const isReanalysis = opts?.reanalysis === true;
    const reanalysisMode: ReanalysisMode = opts?.reanalysisMode ?? 'full';
    const setStatus = isReanalysis ? setReanalysisStatus : setAnalysisStatus;
    const abortController = isReanalysis ? new AbortController() : null;
    if (isReanalysis) {
      reanalysisAbortRef.current = abortController;
      setIsReanalyzing(true);
      setReanalysisError(null);
      setReanalysisStatus(
        reanalysisMode === 'identity' ? 'Preparing re-identification...' : 'Preparing full re-grade...'
      );
    } else {
      setIsAnalyzing(true);
      setAnalysisError(null);
    }
    try {
      const settings = await loadDesktopLlmSettings();
      const full = window.desktop?.getSettingsFull ? await window.desktop.getSettingsFull() : null;
      const useMeasured = full?.useMeasuredCentering ?? settings.useMeasuredCentering ?? true;
      const hint = (opts?.identificationHint ?? identificationHint).trim();
      const priorGrade = cardData.userGrade ?? cardData.aiGrade ?? undefined;

      const result = await runStudioGrading({
        front: cardData.frontCropped,
        back: cardData.backCropped,
        frames: cardData.videoFrames || [],
        category: cardData.metadata.category,
        identificationHint: hint || undefined,
        centeringMeasurement: cardData.centeringMeasurement,
        useMeasuredCentering: useMeasured,
        frontMetadata: cardData.frontMetadata,
        backMetadata: cardData.backMetadata,
        onStatus: setStatus,
        reanalysisMode: isReanalysis ? reanalysisMode : undefined,
        existingResult: isReanalysis ? priorGrade : undefined,
        signal: abortController?.signal,
      });
      if (!result) throw new Error('Grading returned no result');
      const preferIncoming = isReanalysis;
      const pick = (incoming: string | undefined, prior: string) => {
        const v = (incoming || '').trim();
        if (preferIncoming && v) return v;
        return v || prior;
      };
      setCardData((p) => ({
        ...p,
        aiGrade: result,
        userGrade: result,
        analysisChunks: result.analysisChunks,
        authoritativeIdentity: isReanalysis ? undefined : p.authoritativeIdentity,
        metadata: {
          ...p.metadata,
          name: pick(result.detectedName, p.metadata.name),
          character: pick(result.detectedCharacter, p.metadata.character || ''),
          set: pick(result.detectedSet, p.metadata.set),
          year: pick(result.detectedYear, p.metadata.year),
          edition: pick(result.detectedEdition, p.metadata.edition),
          cardNumber: pick(result.detectedCardNumber, p.metadata.cardNumber),
          artist: pick(result.detectedArtist, p.metadata.artist || ''),
          holo_pattern: result.holoPattern || p.metadata.holo_pattern,
        },
        is_holographic: result.isHolographic ?? p.is_holographic,
      }));
      const entry = {
        id: cardData.id,
        name: result.detectedName,
        overall: result.overall,
        centering: result.centering,
      };
      await window.desktop?.saveHistory?.(entry);
      if (isReanalysis) await syncPortfolioAfterReanalysis(result);
      if (!isReanalysis) setStep(StudioAppStep.CERTIFICATE);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const cancelled = abortController?.signal.aborted;
      if (isReanalysis) {
        if (!cancelled) setReanalysisError(msg);
        if (!cancelled) throw new Error(msg);
      } else {
        setAnalysisError(msg);
      }
    } finally {
      if (isReanalysis) {
        reanalysisAbortRef.current = null;
        setIsReanalyzing(false);
        setReanalysisStatus('');
      } else {
        setIsAnalyzing(false);
      }
    }
  };

  useEffect(() => {
    if (step === StudioAppStep.ANALYSIS && !analysisStarted.current) {
      analysisStarted.current = true;
      runAnalysis();
    }
    if (step !== StudioAppStep.ANALYSIS) analysisStarted.current = false;
  }, [step]);

  const reset = () => {
    setCardData(emptyCard());
    setIdentificationHint('');
    setStep(StudioAppStep.UPLOAD);
    setAnalysisError(null);
    setReanalysisError(null);
    setReanalysisStatus('');
    setPortfolioCard(null);
    setPortfolioError(null);
    setPortfolioSaved(false);
    setPriceNeedsPick(false);
    setPcPickOpen(false);
    setPcCandidates([]);
    setVideoSkippedNotice(false);
  };

  const buildPortfolioInput = () => {
    const grade = cardData.userGrade;
    if (!grade) return null;
    return {
      cardId: cardData.id,
      name: grade.detectedName || cardData.metadata.name || '',
      set: grade.detectedSet || cardData.metadata.set || '',
      cardNumber: grade.detectedCardNumber || cardData.metadata.cardNumber || '',
      year: grade.detectedYear || cardData.metadata.year,
      artist: grade.detectedArtist || cardData.metadata.artist,
      frontImage: cardData.frontCropped || undefined,
      backImage: cardData.backCropped || undefined,
      grading: grade,
    };
  };

  const addToPortfolio = async () => {
    const input = buildPortfolioInput();
    if (!input || !window.desktop?.portfolioAddFromGrading) return;
    setPortfolioLoading(true);
    setPortfolioError(null);
    try {
      const saved = (await window.desktop.portfolioAddFromGrading(input)) as StudioPortfolioCard;
      setPortfolioCard(saved);
      setPortfolioSaved(true);
    } catch (e) {
      setPortfolioError(e instanceof Error ? e.message : String(e));
    } finally {
      setPortfolioLoading(false);
    }
  };

  const fetchPrices = async () => {
    if (!window.desktop?.pricingRefreshCard) return;
    setPortfolioLoading(true);
    setPortfolioError(null);
    setPriceNeedsPick(false);
    try {
      let id = portfolioCard?.id || cardData.id;
      if (!portfolioCard && window.desktop.portfolioAddFromGrading) {
        const input = buildPortfolioInput();
        if (input) {
          const saved = (await window.desktop.portfolioAddFromGrading(input)) as StudioPortfolioCard;
          setPortfolioCard(saved);
          setPortfolioSaved(true);
          id = saved.id;
        }
      }
      const res = await window.desktop.pricingRefreshCard(id);
      if (res.ok && res.card) {
        const saved = res.card as StudioPortfolioCard;
        setPortfolioCard(saved);
        applyPcIdentityToState(saved, res.resolvedIdentity);
        setPriceNeedsPick(false);
      } else if (res.needsPick) {
        setPriceNeedsPick(true);
        setPcCandidates(res.candidates || []);
        setPcSearchUrl(res.searchUrl);
        setPortfolioError(res.error || 'Pick the correct PriceCharting listing.');
      } else {
        setPortfolioError(res.error || 'Price refresh failed');
      }
    } catch (e) {
      setPortfolioError(e instanceof Error ? e.message : String(e));
    } finally {
      setPortfolioLoading(false);
    }
  };

  const handlePcPick = async (url: string) => {
    if (!window.desktop?.pricingRefreshWithPcUrl) return;
    const id = portfolioCard?.id || cardData.id;
    setPcPickLoading(true);
    setPortfolioError(null);
    setReanalysisError(null);
    try {
      const res = await window.desktop.pricingRefreshWithPcUrl(id, url);
      if (res.ok && res.card) {
        const saved = res.card as StudioPortfolioCard;
        setPortfolioCard(saved);
        applyPcIdentityToState(saved, res.resolvedIdentity);
        setPriceNeedsPick(false);
        setPcPickOpen(false);
      } else if (res.needsPick) {
        setPcCandidates(res.candidates || []);
        setPcSearchUrl(res.searchUrl);
        setPortfolioError(res.error || 'Still ambiguous — try another listing.');
      } else {
        setPortfolioError(res.error || 'Could not refresh with that URL.');
      }
    } catch (e) {
      setPortfolioError(e instanceof Error ? e.message : String(e));
    } finally {
      setPcPickLoading(false);
    }
  };

  const stepLabel: Record<StudioAppStep, string> = {
    [StudioAppStep.UPLOAD]: 'Upload',
    [StudioAppStep.CROP_FRONT]: 'Crop front',
    [StudioAppStep.CROP_BACK]: 'Crop back',
    [StudioAppStep.CENTERING_FRONT]: 'Centering front',
    [StudioAppStep.CENTERING_BACK]: 'Centering back',
    [StudioAppStep.VIDEO_CAPTURE]: 'Video',
    [StudioAppStep.ANALYSIS]: 'Analysis',
    [StudioAppStep.RESULTS]: 'Results',
    [StudioAppStep.CERTIFICATE]: 'Certificate',
    [StudioAppStep.SETTINGS]: 'Settings',
    [StudioAppStep.HISTORY]: 'History',
  };

  const wizardSteps = [
    { id: 'upload', label: 'Upload', appSteps: [StudioAppStep.UPLOAD] },
    { id: 'crop', label: 'Crop', appSteps: [StudioAppStep.CROP_FRONT, StudioAppStep.CROP_BACK] },
    {
      id: 'center',
      label: 'Center',
      appSteps: [StudioAppStep.CENTERING_FRONT, StudioAppStep.CENTERING_BACK],
    },
    { id: 'video', label: 'Video', appSteps: [StudioAppStep.VIDEO_CAPTURE], skippable: true },
    { id: 'analysis', label: 'Analysis', appSteps: [StudioAppStep.ANALYSIS] },
    { id: 'cert', label: 'Certificate', appSteps: [StudioAppStep.CERTIFICATE] },
  ] as const;

  const showWizardBreadcrumb = wizardSteps.some((w) => w.appSteps.includes(step));
  const videoStepSkipped =
    skipVideoByDefault &&
    (videoSkippedNotice ||
      step === StudioAppStep.ANALYSIS ||
      step === StudioAppStep.CERTIFICATE);

  return (
    <div className="min-h-[100dvh] bg-black text-white flex flex-col">
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between gap-4">
        <h1 className="text-lg font-black uppercase tracking-widest text-poke-gold">RawGraded Studio</h1>
        <nav className="flex gap-2 text-[10px] font-bold uppercase tracking-widest">
          <button type="button" onClick={reset} className="px-3 py-1 text-gray-400 hover:text-white">
            New scan
          </button>
          <button
            type="button"
            onClick={() => {
              loadHistory();
              setStep(StudioAppStep.HISTORY);
            }}
            className="px-3 py-1 text-gray-400 hover:text-white"
          >
            History
          </button>
          <button
            type="button"
            onClick={() => (onOpenSettings ? onOpenSettings() : setStep(StudioAppStep.SETTINGS))}
            className="px-3 py-1 text-gray-400 hover:text-white"
          >
            Settings
          </button>
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto rg-safe-pb">
      {showWizardBreadcrumb ? (
        <div className="px-4 py-2 border-b border-white/5">
          <div className="flex flex-wrap items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-widest">
            {wizardSteps.map((w, i) => {
              const active = w.appSteps.includes(step);
              const skipped = w.id === 'video' && videoStepSkipped && !active;
              return (
                <React.Fragment key={w.id}>
                  {i > 0 && <span className="text-gray-700 px-0.5">›</span>}
                  <span
                    className={
                      active
                        ? 'text-poke-gold'
                        : skipped
                          ? 'text-gray-600 line-through'
                          : 'text-gray-600'
                    }
                  >
                    {w.label}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
          {videoSkippedNotice && (
            <p className="text-center text-[10px] text-amber-500/90 mt-1">
              Guided video skipped — enable in Settings → uncheck &ldquo;Skip guided video scan&rdquo;.
            </p>
          )}
        </div>
      ) : (
        <p className="text-center text-[10px] text-gray-600 uppercase tracking-widest py-1">{stepLabel[step]}</p>
      )}

      {step === StudioAppStep.SETTINGS &&
        (mobile ? (
          <MobileSettings onClose={() => setStep(StudioAppStep.UPLOAD)} />
        ) : (
          <DesktopSettings onClose={() => setStep(StudioAppStep.UPLOAD)} />
        ))}

      {step === StudioAppStep.HISTORY && (
        <div className="max-w-lg mx-auto p-6">
          <button type="button" onClick={() => setStep(StudioAppStep.UPLOAD)} className="text-xs text-gray-400 mb-4 uppercase">
            Back
          </button>
          <h2 className="text-sm font-bold uppercase tracking-widest text-poke-gold mb-4">Local history</h2>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">No scans saved yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h, i) => (
                <li key={i} className="text-sm border border-white/10 rounded p-3">
                  {(h.name as string) || 'Card'} — Overall {(h.overall as number) ?? '—'}
                  <span className="text-gray-500 text-xs block">{h.savedAt as string}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === StudioAppStep.UPLOAD && (
        <div className="max-w-xl mx-auto p-6 sm:p-8 space-y-8 text-center">
          <p className="text-gray-400 text-sm">
            {mobile
              ? 'Grade privately on your phone with your Gemini API key.'
              : 'Grade privately on your PC with Gemini or Ollama.'}
          </p>
          {mobile && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setCameraSide('front')}
                className="w-full py-4 bg-poke-gold text-black text-sm font-bold uppercase tracking-widest rounded-xl"
              >
                Camera — front
              </button>
              <button
                type="button"
                onClick={() => setCameraSide('back')}
                className="w-full py-4 bg-poke-blue text-white text-sm font-bold uppercase tracking-widest rounded-xl"
              >
                Camera — back
              </button>
            </div>
          )}
          <p className="text-[10px] text-gray-600 uppercase tracking-widest">{mobile ? 'Or upload from gallery' : 'Upload images'}</p>
          <div className="text-left">
            <label className="text-[10px] text-gray-500 uppercase tracking-widest">
              Card name / keywords <span className="normal-case text-gray-600">(optional)</span>
            </label>
            <input
              value={identificationHint}
              onChange={(e) => setIdentificationHint(e.target.value)}
              maxLength={120}
              placeholder="e.g. Team Magma Numel Double Crisis"
              className="mt-2 w-full rounded-lg border border-white/10 bg-[#0a0a0a] px-4 py-3 text-sm text-white outline-none focus:border-poke-gold/50"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block border border-dashed border-white/20 rounded-xl p-8 cursor-pointer hover:border-poke-gold/50">
              <span className="text-xs font-bold uppercase tracking-widest text-poke-gold">Front image</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile('front', e.target.files[0])} />
              {cardData.frontRaw && <img src={cardData.frontRaw} alt="" className="mt-4 max-h-32 mx-auto rounded" />}
            </label>
            <label className="block border border-dashed border-white/20 rounded-xl p-8 cursor-pointer hover:border-poke-gold/50">
              <span className="text-xs font-bold uppercase tracking-widest text-poke-gold">Back image</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile('back', e.target.files[0])} />
              {cardData.backRaw && <img src={cardData.backRaw} alt="" className="mt-4 max-h-32 mx-auto rounded" />}
            </label>
          </div>
          {!mobile && (
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => setCameraSide('front')} className="px-4 py-2 bg-poke-blue text-xs font-bold uppercase tracking-widest rounded">
                Webcam front
              </button>
              <button type="button" onClick={() => setCameraSide('back')} className="px-4 py-2 bg-poke-blue text-xs font-bold uppercase tracking-widest rounded">
                Webcam back
              </button>
            </div>
          )}
          <button
            type="button"
            disabled={!cardData.frontRaw || !cardData.backRaw}
            onClick={() => setStep(StudioAppStep.CROP_FRONT)}
            className="px-8 py-3 bg-poke-gold text-black font-bold uppercase tracking-widest rounded disabled:opacity-40"
          >
            Continue to crop
          </button>
        </div>
      )}

      {cameraSide &&
        (mobile ? (
          <CameraCapture
            side={cameraSide}
            onClose={() => setCameraSide(null)}
            onCapture={(url, meta: CaptureMetadata) => {
              setCardData((p) =>
                cameraSide === 'front'
                  ? { ...p, frontRaw: url, frontMetadata: meta }
                  : { ...p, backRaw: url, backMetadata: meta }
              );
              setCameraSide(null);
            }}
          />
        ) : (
          <WebcamCapture
            side={cameraSide}
            onClose={() => setCameraSide(null)}
            onCapture={(url, meta: CaptureMetadata) => {
              setCardData((p) =>
                cameraSide === 'front'
                  ? { ...p, frontRaw: url, frontMetadata: meta }
                  : { ...p, backRaw: url, backMetadata: meta }
              );
              setCameraSide(null);
            }}
          />
        ))}

      {step === StudioAppStep.CROP_FRONT && cardData.frontRaw && (
        <Cropper imageSrc={cardData.frontRaw} onConfirm={handleCropConfirm} title="Crop Front" initialMetadata={cardData.frontMetadata} />
      )}
      {step === StudioAppStep.CROP_BACK && cardData.backRaw && (
        <Cropper imageSrc={cardData.backRaw} onConfirm={handleCropConfirm} title="Crop Back" initialMetadata={cardData.backMetadata} />
      )}
      {step === StudioAppStep.CENTERING_FRONT && cardData.frontCropped && (
        <CenteringTool
          imageSrc={cardData.frontCropped}
          side="front"
          onConfirm={handleCenteringConfirm}
          onBack={() => setStep(StudioAppStep.CROP_BACK)}
        />
      )}
      {step === StudioAppStep.CENTERING_BACK && cardData.backCropped && (
        <CenteringTool
          imageSrc={cardData.backCropped}
          side="back"
          onConfirm={handleCenteringConfirm}
          onBack={() => setStep(StudioAppStep.CENTERING_FRONT)}
        />
      )}
      {step === StudioAppStep.VIDEO_CAPTURE && (
        <VideoCapture onCapture={handleVideoCapture} onSkip={handleSkipVideo} />
      )}
      {step === StudioAppStep.ANALYSIS && (
        <div className="max-w-md mx-auto p-12 text-center space-y-4">
          <div className="w-12 h-12 border-2 border-poke-gold border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-300">{analysisStatus || 'Analyzing...'}</p>
          {analysisError && (
            <div className="space-y-2">
              <p className="text-red-400 text-sm">{analysisError}</p>
              <div className="flex flex-wrap justify-center gap-3">
                <button type="button" onClick={() => runAnalysis()} className="text-xs text-poke-gold uppercase font-bold">
                  Retry analysis
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisError(null);
                    analysisStarted.current = false;
                    setStep(StudioAppStep.VIDEO_CAPTURE);
                  }}
                  className="text-xs text-gray-400 uppercase font-bold hover:text-white"
                >
                  Re-capture video
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {step === StudioAppStep.CERTIFICATE && cardData.userGrade && (
        <StudioCertificate
          cardData={cardData}
          grade={cardData.userGrade}
          onDone={reset}
          mobile={mobile}
          onReidentify={(hint) => runIdentityReidentifyViaPc(hint)}
          onFullRegrade={(hint) =>
            runAnalysis({ identificationHint: hint, reanalysis: true, reanalysisMode: 'full' })
          }
          onCancelReanalysis={cancelReanalysis}
          isReanalyzing={isReanalyzing}
          reanalysisStatus={reanalysisStatus}
          reanalysisError={reanalysisError}
          portfolioCard={portfolioCard}
          portfolioLoading={portfolioLoading}
          portfolioError={portfolioError}
          portfolioSaved={portfolioSaved}
          onFetchPrices={!mobile && window.desktop?.pricingRefreshCard ? () => void fetchPrices() : undefined}
          onAddToPortfolio={!mobile && window.desktop?.portfolioAddFromGrading ? () => void addToPortfolio() : undefined}
          priceNeedsPick={priceNeedsPick}
          onPickListing={() => setPcPickOpen(true)}
          pcPickOpen={pcPickOpen}
          pcCandidates={pcCandidates}
          pcSearchUrl={pcSearchUrl}
          pcPickLoading={pcPickLoading}
          onPcPick={(url) => void handlePcPick(url)}
          onPcPickClose={() => setPcPickOpen(false)}
        />
      )}
      </div>
    </div>
  );
};

export default StudioApp;
