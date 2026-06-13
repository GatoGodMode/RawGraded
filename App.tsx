import React, { useState, useEffect, useRef, useCallback } from 'react';
import LZString from 'lz-string';
import { AppStep, CardData, GradingResult, CaptureMetadata, INITIAL_METADATA, UserProfile, GlobalStats } from './types';
import Cropper from './components/Cropper';
import RulerOverlay from './components/RulerOverlay';
import Certificate from './components/Certificate';
import CameraCapture from './components/CameraCapture';
import VideoCapture from './components/VideoCapture';
import EvidenceCrop from './components/EvidenceCrop';
import MyCollection from './components/MyCollection';
import PublicArchive from './components/PublicArchive';
import AuthModal from './components/AuthModal';
import MembershipApplicationWizard from './components/MembershipApplicationWizard';
import AdminDashboard from './components/AdminDashboard';
import AboutModal from './components/AboutModal';
import ShopModal from './components/ShopModal';
import UserProfileSettings from './components/UserProfile';
import { AdminDebugConsole } from './components/AdminDebugConsole';
import {
  getAutoCropSettings,
  identifyAndInitialGrade,
  identifyCollectOnly,
  refineGradingChunkGrid,
  surgicalVerification,
  sleep,
  PHASE2_DELAY_AFTER_IDENTIFICATION_MS,
} from './services/geminiService';
import { prepareCardImages, gridToAnalysisChunks } from './services/grading/cardImagePipeline';
import EnvelopeScanPlugin from './components/EnvelopeScanPlugin';
import type { EnvelopeExtractResult } from './services/geminiService';
import { generateImageHash, resizeImage } from './services/imageUtils';
import { storeService, TOTP_TOKEN_KEY, TOTP_REMEMBER_KEY } from './services/storeService';

const VIDEO_FRAME_ANALYSIS_MAX_DIM = 1536;
const VIDEO_FRAME_ANALYSIS_QUALITY = 0.85;
import AcquisitionWizard from './components/AcquisitionWizard';
import { AcquisitionData } from './types';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfUse from './components/TermsOfUse';
import TermsOfService from './components/TermsOfService';
import SniperView from './components/SniperView';
import VaultCardTile from './components/VaultCardTile';
import DisplayVaultView from './components/DisplayVaultView';
import PublicCard3DView from './components/PublicCard3DView.tsx';
import SlabCheckerPlugin from './components/SlabCheckerPlugin';
import MarketplacePlugin from './components/MarketplacePlugin';
import { AuthCertificateModal } from './components/AuthCertificateModal';
import SlabSearchPlugin from './components/SlabSearchPlugin';

const FEATURES_SLIDES: { icon: string; iconColor: string; title: string; copy: string }[] = [
  { icon: 'fa-ruler-combined', iconColor: 'text-poke-blue', title: 'Condition Assessment', copy: 'Centering, corners, edges, and surface are assessed against leading grading house standards. No eyeballing. No guesswork.' },
  { icon: 'fa-video', iconColor: 'text-[#990000]', title: 'Surface Flaw Detection', copy: 'Optional detailed video capture uses directional lighting to reveal surface wear and minor defects that standard photography misses.' },
  { icon: 'fa-fingerprint', iconColor: 'text-poke-gold', title: 'One Scan. One Official Record.', copy: 'Archive your cards to a secure vault or the public index. Keep a permanent log of acquisition cost, receipts, and ownership history.' },
  { icon: 'fa-heart', iconColor: 'text-[#990000]', title: 'For the Serious Collector', copy: 'Determine which ungraded cards merit professional grading—and which do not. Retain a clear record with purchase details and condition notes.' },
  { icon: 'fa-trophy', iconColor: 'text-poke-blue', title: 'For Portfolio Management', copy: 'Review your raw inventory before grading. Document condition immediately upon purchase. Easily share condition reports with potential buyers.' },
  { icon: 'fa-store', iconColor: 'text-poke-gold', title: 'For High-End Dealers', copy: 'Capture clear evidence of condition to build buyer trust. The \'Recorded by RawGraded\' label on your listings gives buyers peace of mind.' },
  { icon: 'fa-certificate', iconColor: 'text-[#990000]', title: 'Grade Estimates', copy: 'Every scanned card receives a predicted grade range spanning the major grading houses. Share the report securely via a direct link.' },
  { icon: 'fa-handshake', iconColor: 'text-poke-blue', title: 'Pre-Grading Clarity', copy: 'RawGraded helps you confidently decide what to grade. Skip the grading fees on cards that won\'t meet your target.' },
  { icon: 'fa-layer-group', iconColor: 'text-poke-blue', title: 'Detailed Condition Review', copy: 'Front and back are inspected separately, then brought together for a consistent grade. Centering, corners, edges, and surfaces individually reviewed.' },
  { icon: 'fa-user-shield', iconColor: 'text-[#990000]', title: 'Anti-Piracy Shield', copy: 'Protect authentic slabs from clones. Slabs not for sale are cryptographically locked to your vault. When sold, custody transfers securely while both parties retain their private provenance.' },
  { icon: 'fa-university', iconColor: 'text-poke-gold', title: 'Private Galleries', copy: 'Curate an exclusive digital display of your finest pieces. Use privacy controls to share your collection only with trusted peers.' },
  { icon: 'fa-microchip', iconColor: 'text-poke-blue', title: 'Precision AI Assessment', copy: 'Our process is powered by advanced visual AI built specifically for card grading, delivering consistent and exceedingly accurate condition scores.' },
  { icon: 'fa-lock', iconColor: 'text-[#990000]', title: 'Data Protection', copy: 'We use continuous monitoring, Google 2FA, and the latest standards to protect your account. Your personal information and uploads remain secure.' },
];

const HOLO_PATTERN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'Unspecified / Auto' },
  { value: 'standard', label: 'Standard Holo' },
  { value: 'reverse', label: 'Reverse Holo' },
  { value: 'full_art', label: 'Full Art Foil' },
  { value: 'cosmos', label: 'Cosmos' },
  { value: 'galaxy', label: 'Galaxy' },
  { value: 'cracked_ice', label: 'Cracked Ice' },
  { value: 'swirl', label: 'Swirl' },
];

const BrushedGoldDefs = () => (
  <svg width="0" height="0" className="absolute pointer-events-none">
    <defs>
      <linearGradient id="brushedGold" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#D4AF37" />
        <stop offset="30%" stopColor="#FFF2CD" />
        <stop offset="50%" stopColor="#AA771C" />
        <stop offset="70%" stopColor="#E6C875" />
        <stop offset="100%" stopColor="#8A5A19" />
      </linearGradient>
      <linearGradient id="brushedGoldDark" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8A5A19" />
        <stop offset="50%" stopColor="#D4AF37" />
        <stop offset="100%" stopColor="#5A3A09" />
      </linearGradient>
      <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
  </svg>
);

const RawGradeIconSVG = ({ className = "w-10 h-10" }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="3" y="2" width="14" height="20" rx="2" stroke="url(#brushedGoldDark)" strokeWidth="1" fill="#111" />
    <rect x="5" y="4" width="10" height="10" rx="1" stroke="url(#brushedGold)" strokeWidth="1" fill="#1a1a1a" />
    <circle cx="16" cy="16" r="5" stroke="url(#brushedGold)" strokeWidth="1.5" fill="#111" />
    <path d="M19.5 19.5L23 23" stroke="url(#brushedGold)" strokeWidth="2" strokeLinecap="round" />
    <path d="M14.5 16h3M16 14.5v3" stroke="url(#brushedGold)" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

const CollectIconSVG = ({ className = "w-10 h-10" }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M4 8l8-4 8 4-8 4-8-4z" stroke="url(#brushedGoldDark)" strokeWidth="1" fill="#1a1a1a" />
    <path d="M4 12l8 4 8-4" stroke="url(#brushedGoldDark)" strokeWidth="1" />
    <path d="M4 16l8 4 8-4" stroke="url(#brushedGoldDark)" strokeWidth="1" />
    <circle cx="12" cy="12" r="4" fill="#111" stroke="url(#brushedGold)" strokeWidth="1" />
    <path d="M12 10v4M10 12h4" stroke="url(#brushedGold)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SlabIconSVG = ({ className = "w-10 h-10" }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="4" y="2" width="16" height="20" rx="3" stroke="url(#brushedGold)" strokeWidth="1.5" fill="#1a1a1a" />
    <rect x="6" y="4" width="12" height="4" rx="1" stroke="url(#brushedGoldDark)" strokeWidth="1" fill="#111" />
    <text x="16" y="7" fontSize="2.5" fontWeight="900" fill="url(#brushedGold)" textAnchor="end" style={{ fontFamily: 'sans-serif' }}>10</text>
    <rect x="6" y="10" width="12" height="10" rx="1" stroke="url(#brushedGoldDark)" strokeWidth="1" fill="#111" />
    <path d="M12 13c-1.5 0-2.5-.5-2.5-.5v2.5c0 1.5 2.5 2.5 2.5 2.5s2.5-1 2.5-2.5v-2.5s-1 .5-2.5 .5z" stroke="url(#brushedGold)" strokeWidth="1" fill="#111" />
  </svg>
);

const SnipeIconSVG = ({ className = "w-10 h-10" }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="9" stroke="url(#brushedGoldDark)" strokeWidth="1" strokeDasharray="2 2" fill="#111" />
    <circle cx="12" cy="12" r="5" stroke="url(#brushedGold)" strokeWidth="1" />
    <circle cx="12" cy="12" r="1.5" fill="url(#brushedGold)" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="url(#brushedGold)" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 12L18 6" stroke="url(#brushedGold)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.UPLOAD);
  const [uploadMode, setUploadMode] = useState<'none' | 'rawgrade' | 'collect' | 'slab'>('none');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isApplicationWizardOpen, setIsApplicationWizardOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isShopOpen, setIsShopOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'signup'>('login');
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  const [freeBannerDismissed, setFreeBannerDismissed] = useState(() => {
    if (typeof sessionStorage === 'undefined') return false;
    return sessionStorage.getItem('rg_free_banner_dismissed') === '1';
  });
  // Ref for the acquisition notes textarea — enables cursor-aware pre-fill
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const skipWaitWithPaidRef = useRef(false);
  const paymentFulfillAttemptedRef = useRef(false);
  const scrollToPricingRef = useRef(false);
  const cardDataRef = useRef<CardData | null>(null);
  const [cardData, setCardData] = useState<CardData>({
    id: crypto.randomUUID(),
    frontRaw: null,
    backRaw: null,
    frontCropped: null,
    backCropped: null,
    videoRaw: null,
    videoFrames: [],
    userGrade: null,
    aiGrade: null,
    metadata: INITIAL_METADATA,
    dateScanned: new Date().toLocaleString(),
    userTwitter: ''
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string>('Initializing AI Grader...');
  const [useFreeCredit, setUseFreeCredit] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [draftFetched, setDraftFetched] = useState(false);
  const [cameraSide, setCameraSide] = useState<'front' | 'back' | null>(null);
  const [archiveCollectOnlyBusy, setArchiveCollectOnlyBusy] = useState(false);
  const [archiveCollectOnlyError, setArchiveCollectOnlyError] = useState<string>('');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isSlabCheckerOpen, setIsSlabCheckerOpen] = useState(false);
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState(false);
  const [viewingAuthCheckId, setViewingAuthCheckId] = useState<number | null>(null);
  const [authVaultSlabId, setAuthVaultSlabId] = useState<number | undefined>(undefined);

  const [featuresSlideIndex, setFeaturesSlideIndex] = useState(0);
  const [valueTabsIndex, setValueTabsIndex] = useState(0);
  const [deepLinkCertId, setDeepLinkCertId] = useState<string | null>(null);
  const [certLoadError, setCertLoadError] = useState<string | null>(null);
  const [videoPreviewFailed, setVideoPreviewFailed] = useState(false);
  const [publicVaultId, setPublicVaultId] = useState<string | null>(null);
  const [publicCard3dToken, setPublicCard3dToken] = useState<string | null>(null);
  type FeaturedCert = {
    id: string;
    name: string;
    card_set: string;
    year?: string;
    overall_grade: string;
    date_scanned: string;
    front_img: string;
    back_img?: string;
    reasoning?: string;
    centering?: number;
    corners?: number;
    edges?: number;
    surface?: number;
    predicted_grades?: { psa?: number; bgs?: number; cgc?: number; tcg?: string };
    forensics_images?: string[];
    defects_json?: string;
    market?: { raw?: number | null; psa10?: number | null; psa9?: number | null } | null;
  };
  const [featuredData, setFeaturedData] = useState<{ total_graded: number; featured: FeaturedCert[] } | null>(null);
  const [heroFeatured, setHeroFeatured] = useState<FeaturedCert | null>(null);
  const [valuationFeatured, setValuationFeatured] = useState<FeaturedCert | null>(null);

  const refreshUser = async () => {
    try {
      const fresh = await storeService.checkSession();
      if (fresh) setUser(fresh);
    } catch (_) { /* no session or error */ }
  };

  const goToPlatformStep = useCallback((target: AppStep) => {
    if (user && user.role !== 'admin' && user.has_platform_access === false) {
      setIsShopOpen(true);
      return;
    }
    setStep(target);
  }, [user]);

  const platformLocked = Boolean(user && user.role !== 'admin' && user.has_platform_access === false);

  const shopCtaLabel = user?.has_purchased_credits ? 'Top it off' : 'Get Pro Credits!';

  useEffect(() => {
    const checkUser = async () => {
      try {
        const currentUser = await storeService.checkSession();
        if (currentUser) setUser(currentUser);
        else setUser(storeService.getCurrentUser());
      } catch (e) {
        setUser(storeService.getCurrentUser());
      }
    };
    checkUser();

    // Deep Link Handling: Check for ?cert= in URL (QR / direct link — always show cert for verification)
    const params = new URLSearchParams(window.location.search);
    const vaultId = params.get('vault');
    if (vaultId) {
      setPublicVaultId(vaultId);
      return;
    }

    const card3dToken = params.get('card3d');
    if (card3dToken) {
      setPublicCard3dToken(card3dToken);
      return;
    }

    const certId = params.get('cert');
    if (certId) {
      setDeepLinkCertId(certId);
      handleSelectCertificate(certId);
      return;
    }

    if (params.get('slabcheck') === '1') {
      setIsSlabCheckerOpen(true);
    }
  }, []);

  // Cache version check: if server version > stored, reload once so users get updates after admin flush
  useEffect(() => {
    const key = 'rg_cache_v';
    fetch('api/auth.php?action=cache_version', { credentials: 'include' })
      .then(res => res.json())
      .then((data: { data?: number }) => {
        const server = typeof data?.data === 'number' ? data.data : 0;
        const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
        if (stored === null) {
          sessionStorage.setItem(key, String(server));
          return;
        }
        const storedNum = parseInt(stored, 10);
        if (server > storedNum) {
          sessionStorage.setItem(key, String(server));
          window.location.reload();
        }
      })
      .catch(() => { });
  }, []);

  // Stripe return: pack purchase fulfill_session, or subscription checkout (refresh profile only)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const paymentSuccess = params.get('payment') === 'success';
    const subscriptionSuccess = params.get('subscription') === 'success';
    if (!user || !sessionId || paymentFulfillAttemptedRef.current) return;
    if (!paymentSuccess && !subscriptionSuccess) return;
    paymentFulfillAttemptedRef.current = true;
    (async () => {
      try {
        if (paymentSuccess) {
          const res = await fetch('api/stripe.php?action=fulfill_session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ session_id: sessionId })
          });
          const data = await res.json();
          if (data.success && typeof data.paid_credits === 'number') {
            setUser(prev => prev ? { ...prev, paid_credits: data.paid_credits, has_purchased_credits: true } : null);
          }
        }
        await refreshUser();
      } catch (_) { }
      const u = new URL(window.location.href);
      u.searchParams.delete('payment');
      u.searchParams.delete('subscription');
      u.searchParams.delete('session_id');
      window.history.replaceState({}, '', u.pathname + (u.search || ''));
      if (paymentSuccess) goToPlatformStep(AppStep.COLLECTION);
    })();
  }, [user, goToPlatformStep]);

  useEffect(() => {
    const fetchFeatured = async () => {
      try {
        const res = await fetch('api/stats.php?action=featured', { credentials: 'include' });
        const data = await res.json();
        setFeaturedData(data);
        if (data?.featured?.length) {
          const pool = data.featured;
          setHeroFeatured(pool[Math.floor(Math.random() * pool.length)]);
          // Pick a cert with real market data for the valuation showcase
          const withMkt = pool.filter((c: FeaturedCert) => c.market?.psa10);
          setValuationFeatured(withMkt.length > 0 ? withMkt[Math.floor(Math.random() * withMkt.length)] : pool[0]);
        }
      } catch (e) {
        console.error('Failed to fetch featured cert', e);
      }
    };
    fetchFeatured();
    const interval = setInterval(fetchFeatured, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (step !== AppStep.ANALYSIS) {
      setDraftFetched(false);
      return;
    }
    if (!user || draftFetched) return;
    let cancelled = false;
    fetch('api/drafts.php?action=get', { credentials: 'include' })
      .then(res => res.json())
      .then((data: { draft?: string | null }) => {
        if (!cancelled && data.draft && typeof data.draft === 'string' && data.draft.length > 2) setHasDraft(true);
        if (!cancelled) setDraftFetched(true);
      })
      .catch(() => { if (!cancelled) setDraftFetched(true); });
    return () => { cancelled = true; };
  }, [step, user, draftFetched]);

  const handleRotateImage = (side: 'front' | 'back') => {
    const imageData = side === 'front' ? cardData.frontRaw : cardData.backRaw;
    if (!imageData) return;

    const img = new Image();
    img.src = imageData;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const rotatedData = canvas.toDataURL('image/jpeg', 0.9);
      setCardData(prev => ({
        ...prev,
        [side === 'front' ? 'frontRaw' : 'backRaw']: rotatedData
      }));
    };
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (ev: ProgressEvent<FileReader>) => {
        if (ev.target?.result) {
          setCardData((prev: CardData) => ({
            ...prev,
            [side === 'front' ? 'frontRaw' : 'backRaw']: ev.target?.result as string
          }));
        }
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleCameraCapture = (imageData: string, metadata: CaptureMetadata) => {
    if (cameraSide) {
      setCardData((prev: CardData) => ({
        ...prev,
        [cameraSide === 'front' ? 'frontRaw' : 'backRaw']: imageData,
        [cameraSide === 'front' ? 'frontMetadata' : 'backMetadata']: metadata
      }));
      setCameraSide(null);
    }
  };

  const handleCropConfirm = (croppedImg: string) => {
    if (step === AppStep.CROP_FRONT) {
      setCardData((prev: CardData) => ({ ...prev, frontCropped: croppedImg }));
      setStep(AppStep.CROP_BACK);
    } else {
      setCardData((prev: CardData) => ({ ...prev, backCropped: croppedImg }));
      setStep(AppStep.VIDEO_CAPTURE);
    }
  };

  const submitArchivalCollectOnly = async () => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }
    if (!cardData.frontRaw) {
      setArchiveCollectOnlyError('Front image is required.');
      return;
    }
    if (archiveCollectOnlyBusy) return;

    setArchiveCollectOnlyError('');
    setArchiveCollectOnlyBusy(true);

    try {
      const canUseFree = user.role === 'admin'
        ? true
        : ((user.scan_limit ?? 0) - (user.scans_this_week ?? 0) > 0) || (user.bonus_scans ?? 0) > 0;
      const canUsePaid = user.role === 'admin' ? true : (user.paid_credits ?? 0) > 0;

      const creditMode: 'free' | 'paid' = canUseFree ? 'free' : 'paid';
      if (!canUsePaid && creditMode === 'paid') {
        throw new Error('Insufficient credits. Add Pro Credits to use ungraded archival collection.');
      }

      setAnalysisStatus('Running Rapid AI Grade & Vaulting…');

      // Resize + hash (match CollectOnlyModePlugin defaults)
      const frontResized = await resizeImage(cardData.frontRaw, 1024, 0.72);
      const backSourceRaw = cardData.backRaw ?? cardData.frontRaw;
      const backResized = await resizeImage(backSourceRaw, 1024, 0.72);

      const [frontHash, backHash] = await Promise.all([
        generateImageHash(frontResized),
        generateImageHash(backResized),
      ]);

      const category = cardData.metadata.category || 'Pokemon';
      const result = await identifyCollectOnly(frontResized, backResized, category);
      if (!result) throw new Error('Collect Only identification failed. Please try again.');

      const cardId = crypto.randomUUID();
      const payloadCards = [
        {
          id: cardId,
          front_img: frontResized,
          back_img: cardData.backRaw ? backResized : frontResized, // front-only -> mirror on backend, but keep consistent payload
          front_hash: frontHash,
          back_hash: cardData.backRaw ? backHash : frontHash,
          metadata: {
            name: result.detectedName,
            category,
            set: result.detectedSet,
            character: result.detectedCharacter,
            year: result.detectedYear,
            edition: result.detectedEdition,
            number: result.detectedCardNumber,
            artist: result.detectedArtist,
            is_first_edition: result.isFirstEdition ? 1 : 0,
            is_holographic: result.isHolographic ? 1 : 0,
            holo_pattern: result.holoPattern || 'none',
            rarity: result.rarity || null,
          },
          ai_description: result.aiDescription,
          grades: result.grades,
        },
      ];

      const res = await fetch('api/plugin_collect_only.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          credit_mode: creditMode,
          cards: payloadCards,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.error || `Collect Only failed (HTTP ${res.status}).`);
      }

      await refreshUser();
      goToPlatformStep(AppStep.COLLECTION);
      setCardData({
        id: crypto.randomUUID(),
        frontRaw: null,
        backRaw: null,
        frontCropped: null,
        backCropped: null,
        videoRaw: null,
        videoFrames: [],
        userGrade: null,
        aiGrade: null,
        metadata: INITIAL_METADATA,
        dateScanned: new Date().toLocaleString(),
        userTwitter: '',
      });
    } catch (e: any) {
      console.error('[submitArchivalCollectOnly]', e);
      setArchiveCollectOnlyError(e?.message || 'Failed to add to collection.');
    } finally {
      setArchiveCollectOnlyBusy(false);
    }
  };

  const handleVideoCapture = (videoDataUrl: string, frames: string[]) => {
    const now = new Date().toLocaleString();
    const frontCropped = cardData.frontCropped!;
    const backCropped = cardData.backCropped!;
    setCardData((prev: CardData) => ({ ...prev, videoRaw: videoDataUrl, videoFrames: frames, dateScanned: now }));
    setStep(AppStep.ANALYSIS);
    // Credit choice is shown on ANALYSIS step before starting; do not call runAnalysis here.
  };

  const handleSkipVideo = () => {
    const now = new Date().toLocaleString();
    const frontCropped = cardData.frontCropped!;
    const backCropped = cardData.backCropped!;
    setCardData((prev: CardData) => ({ ...prev, dateScanned: now }));
    setStep(AppStep.ANALYSIS);
    // Credit choice is shown on ANALYSIS step before starting; do not call runAnalysis here.
  };

  const runAnalysis = async (front: string, back: string, frames: string[], usePaidCredit?: boolean) => {
    if (isAnalyzing) return;
    if (usePaidCredit) {
      setCardData(prev => ({ ...prev, _draftMeta: { credit_type: 'paid' as const, reanalysis_count: (prev as any)._draftMeta?.reanalysis_count ?? 0 } }));
    }
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisStatus(user?.role === 'admin' || usePaidCredit ? 'Using VIP Pass...' : 'Optimizing Assets...');

    const applyFinalResult = (finalResult: GradingResult) => {
      setCardData(prev => ({
        ...prev,
        id: crypto.randomUUID(),
        aiGrade: finalResult,
        userGrade: finalResult,
        analysisChunks: finalResult.analysisChunks,
        metadata: {
          ...prev.metadata,
          name: finalResult.detectedName || prev.metadata.name || '',
          set: finalResult.detectedSet || prev.metadata.set || '',
          year: finalResult.detectedYear || prev.metadata.year || '',
          edition: finalResult.detectedEdition || prev.metadata.edition || '',
          is_first_edition: (finalResult.detectedEdition || '').toLowerCase().includes('1st') ? 1 : (prev.metadata.is_first_edition || 0),
          is_holographic: finalResult.isHolographic ? 1 : (prev.metadata.is_holographic || 0),
          holo_pattern: finalResult.holoPattern || prev.metadata.holo_pattern || 'none',
          cardNumber: finalResult.detectedCardNumber || prev.metadata.cardNumber || '',
          artist: finalResult.detectedArtist || prev.metadata.artist || '',
        }
      }));
    };

    const doDirectAnalysis = async (rFront: string, rBack: string, rFrames: string[], frontRaw: string, backRaw: string, framesRaw: string[]) => {
      const setStatus = (s: string) => setAnalysisStatus(s);
      const qualityHolo = 0.80;

      // We skip the duplicate resize here by using the already resized rFront, rBack, rFrames
      setStatus('Identifying Asset');
      const initialGrade = await identifyAndInitialGrade(rFront, rBack, cardData.metadata.category || 'Pokemon');
      if (!initialGrade) throw new Error("Phase 1 Identification Failed");
      const useHoloQuality = initialGrade.isHolographic === true;
      const prep = (s: string) =>
        useHoloQuality ? resizeImage(s, 1024, qualityHolo) : resizeImage(s, 1024);
      const prepared = await prepareCardImages(frontRaw, backRaw, prep, prep);
      const phase2Frames = await Promise.all(
        (framesRaw || []).map((f) => resizeImage(f, VIDEO_FRAME_ANALYSIS_MAX_DIM, VIDEO_FRAME_ANALYSIS_QUALITY))
      );
      const analysisChunks = gridToAnalysisChunks(prepared.frontGrid, prepared.backGrid);
      setStatus('Preparing forensics...');
      await sleep(PHASE2_DELAY_AFTER_IDENTIFICATION_MS);
      setStatus('Forensic grid (3×3)...');
      const chunkResult = await refineGradingChunkGrid(
        prepared.frontGrid,
        prepared.backGrid,
        initialGrade,
        setStatus
      );
      const mergedResult: GradingResult = {
        ...chunkResult,
        centering: 0,
        corners: 0,
        edges: 0,
        surface: 0,
        overall: 0,
        analysisChunks,
      };
      setStatus('RawGrading...');
      const finalResult = await surgicalVerification(
        prepared.frontPrep,
        prepared.backPrep,
        phase2Frames,
        mergedResult,
        setStatus
      );
      if (finalResult) {
        if (analysisChunks.length) finalResult.analysisChunks = analysisChunks;
        applyFinalResult(finalResult);
      }
      return finalResult ?? undefined;
    };

    try {
      const [resizedFront, resizedBack, resizedFrames] = await Promise.all([
        resizeImage(front, 1024),
        resizeImage(back, 1024),
        Promise.all((frames || []).map((f) => resizeImage(f, VIDEO_FRAME_ANALYSIS_MAX_DIM, VIDEO_FRAME_ANALYSIS_QUALITY)))
      ]);

      const QUEUE_POLL_MS = 3000;
      const QUEUE_TIMEOUT_MS = 90000;
      let usedQueue = false;

      // Admin and pro (usePaidCredit) skip queue — direct analysis only, so no generic "Analyzing..." wait
      skipWaitWithPaidRef.current = false;
      const useQueue = user && user.role !== 'admin' && !usePaidCredit;
      if (useQueue) {
        try {
          const submitBody: Record<string, unknown> = {
            front: resizedFront,
            back: resizedBack,
            frames: resizedFrames,
            category: cardData.metadata.category || 'Pokemon',
          };
          const submitRes = await fetch('api/ai.php?action=submit', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submitBody),
          });
          if (!submitRes.ok) {
            const body = await submitRes.json().catch(() => ({}));
            console.error('AI submit failed', submitRes.status, body?.error ?? body);
          } else {
            let submitData = await submitRes.json();
            let job_id = submitData.job_id;
            let mustWait = submitData.must_wait === true;
            let waitSeconds = typeof submitData.wait_seconds === 'number' ? submitData.wait_seconds : 45;
            let upsellMessage = submitData.upsell_message ?? 'Buy Pro Credits to Bypass Wait Time';
            let timeoutMs = waitSeconds * 1000;
            setAnalysisStatus(mustWait ? upsellMessage : 'Analyzing...');
            let deadline = Date.now() + timeoutMs;
            let thisRunIsPaid = !!usePaidCredit;
            while (Date.now() < deadline) {
              if (skipWaitWithPaidRef.current) {
                skipWaitWithPaidRef.current = false;
                thisRunIsPaid = true;
                setCardData(prev => ({ ...prev, _draftMeta: { credit_type: 'paid' as const, reanalysis_count: 0 } }));
                const retryBody = { ...submitBody, use_paid_credit: true };
                const retryRes = await fetch('api/ai.php?action=submit', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(retryBody),
                });
                if (!retryRes.ok) break;
                submitData = await retryRes.json();
                job_id = submitData.job_id;
                mustWait = false;
                deadline = Date.now() + (typeof submitData.wait_seconds === 'number' ? submitData.wait_seconds : 45) * 1000;
              }
              await new Promise(r => setTimeout(r, QUEUE_POLL_MS));
              const pollRes = await fetch(`api/ai.php?action=poll&job_id=${job_id}`, { credentials: 'include' });
              if (!pollRes.ok) {
                const pollBody = await pollRes.json().catch(() => ({}));
                console.error('AI poll failed', pollRes.status, pollBody?.error ?? pollBody);
                break;
              }
              const pollData = await pollRes.json();
              if (pollData.status === 'done' && pollData.result && typeof pollData.result === 'object' && typeof (pollData.result as GradingResult).overall === 'number') {
                applyFinalResult(pollData.result as GradingResult);
                const isPaidRun = thisRunIsPaid || (cardData as any)._draftMeta?.credit_type === 'paid';
                if (isPaidRun) {
                  const dm = (cardData as any)._draftMeta;
                  const newCount = Math.min(2, (dm?.reanalysis_count ?? 0) + 1);
                  await updateDraftSilent(buildDraftPayload({ ...cardData, userGrade: pollData.result }, { credit_type: 'paid', reanalysis_count: newCount }));
                  setCardData(prev => ({ ...prev, _draftMeta: { credit_type: 'paid' as const, reanalysis_count: newCount } }));
                }
                setIsAnalyzing(false);
                usedQueue = true;
                return;
              }
              if (pollData.status === 'failed') {
                setAnalysisError(pollData.error_msg || 'Analysis failed');
                setIsAnalyzing(false);
                return;
              }
              const statusLine = mustWait ? `${upsellMessage} (${Math.round((deadline - Date.now()) / 1000)}s left)` : 'Analyzing...';
              setAnalysisStatus(statusLine);
            }
          }
        } catch (_) { /* fall through to direct */ }
      }

      if (!usedQueue) {
        const isVipRun = user?.role === 'admin' || usePaidCredit === true || (cardData as any)._draftMeta?.credit_type === 'paid';
        if (isVipRun) setAnalysisStatus('Using VIP Pass...');
        const directResult = await doDirectAnalysis(resizedFront, resizedBack, resizedFrames, front, back, frames || []);
        const dm = (cardData as any)._draftMeta;
        const isPaidRun = usePaidCredit === true || dm?.credit_type === 'paid';
        if (isPaidRun && directResult) {
          const nextCount = Math.min(2, (dm?.reanalysis_count ?? 0) + 1);
          await updateDraftSilent(buildDraftPayload({ ...cardData, userGrade: directResult }, { credit_type: 'paid', reanalysis_count: nextCount }));
          setCardData(prev => ({ ...prev, _draftMeta: { credit_type: 'paid' as const, reanalysis_count: nextCount } }));
        }
      }
      setIsAnalyzing(false);
    } catch (err) {
      console.error("Critical AI Analysis Error:", err);
      setAnalysisError(err instanceof Error ? err.message : "Analysis Interrupted");
      setIsAnalyzing(false);
      setCardData(prev => ({ ...prev, userGrade: null, aiGrade: null }));
    }
  };

  const saveToArchive = async () => {
    if (!cardData.userGrade) {
      alert("No grading data to save!");
      return;
    }

    setIsAnalyzing(true);
    try {
      const payload = {
        id: cardData.id,
        frontCropped: cardData.frontCropped,
        backCropped: cardData.backCropped,
        front_thumb: cardData.frontCropped, // Use same for thumb
        back_thumb: cardData.backCropped,
        frontHash: cardData.frontHash,
        backHash: cardData.backHash,
        metadata: cardData.metadata,
        userGrade: {
          ...cardData.userGrade,
          defects: cardData.userGrade.defects ? LZString.compressToBase64(JSON.stringify(cardData.userGrade.defects)) : null
        },
        userTwitter: user?.x_username || '',
        user_notes: cardData.userNotes || '',
        parent_id: cardData.parentScanId || null,
        acqPrice: cardData.acqPrice,
        acqTax: cardData.acqTax,
        acqShipping: cardData.acqShipping,
        acqDate: cardData.acqDate,
        acqSource: cardData.acqSource,
        acqCity: cardData.acqCity,
        acqState: cardData.acqState,
        tracking_number: cardData.acqTrackingNumber,
        order_id: cardData.acqOrderId,
        vault_copy: cardData.vaultCopy || null,
        video_frames_json: cardData.videoFrames,
        use_free_credit: (cardData as any)._draftMeta?.credit_type === 'paid' ? false : useFreeCredit,
      };

      const doSave = (signal?: AbortSignal) => fetch('api/save.php', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: signal ?? undefined,
      });

      const SAVE_TIMEOUT_MS = 120000;
      let response: Response;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), SAVE_TIMEOUT_MS);
        response = await doSave(ctrl.signal);
        clearTimeout(t);
      } catch (firstErr: unknown) {
        const isNetwork = (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          return /load failed|failed to fetch|networkerror|aborted/i.test(msg);
        };
        if (isNetwork(firstErr)) {
          try {
            const ctrl2 = new AbortController();
            const t2 = setTimeout(() => ctrl2.abort(), SAVE_TIMEOUT_MS);
            response = await doSave(ctrl2.signal);
            clearTimeout(t2);
          } catch (retryErr) {
            console.error("Save error (after retry):", retryErr);
            alert("Save request failed. Try Save draft first, then Issue Certificate from Drafts, or try again on a stronger connection (e.g. Wi‑Fi).");
            return;
          }
        } else {
          throw firstErr;
        }
      }

      let result: { success?: boolean; error?: string; id?: string; credits_remaining?: { free: number; paid: number } };
      try {
        result = await response.json();
      } catch {
        alert("Server returned an invalid response. Try again or save draft first.");
        return;
      }

      if (result.error) {
        alert(`Save failed: ${result.error}`);
        setIsAnalyzing(false);
        return;
      }

      if (result.success) {
        if (result.id) setCardData(prev => ({ ...prev, id: result.id! }));
        if (result.credits_remaining && user) {
          const cr = result.credits_remaining as { free: number; paid: number };
          setUser(prev => prev ? { ...prev, paid_credits: cr.paid, scans_this_week: prev.scan_limit - cr.free } : null);
        }
        await refreshUser();
        if ((cardData as any)._draftMeta) {
          await fetch('api/drafts.php?action=delete', { method: 'POST', credentials: 'include' }).catch(() => { });
          setHasDraft(false);
          setDraftFetched(false);
        }
        setStep(AppStep.CERTIFICATE);
      } else {
        alert("Save failed: Unknown error");
      }
    } catch (error) {
      console.error("Save error:", error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (/load failed|failed to fetch|networkerror/i.test(msg)) {
        alert("Save request failed. Try Save draft first, then Issue Certificate from Drafts, or try again on a stronger connection (e.g. Wi‑Fi).");
      } else {
        alert(`Network error: ${msg}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const buildDraftPayload = (data: typeof cardData, meta?: { credit_type: 'paid'; reanalysis_count: number }) => {
    const base: Record<string, unknown> = {
      id: data.id,
      frontCropped: data.frontCropped,
      backCropped: data.backCropped,
      frontHash: data.frontHash,
      backHash: data.backHash,
      metadata: data.metadata,
      userGrade: data.userGrade,
      userNotes: data.userNotes,
      videoFrames: data.videoFrames ?? [],
      acqPrice: data.acqPrice,
      acqTax: data.acqTax,
      acqShipping: data.acqShipping,
      acqDate: data.acqDate,
      acqSource: data.acqSource,
      acqCity: data.acqCity,
      acqState: data.acqState,
      acqTrackingNumber: data.acqTrackingNumber,
      acqOrderId: data.acqOrderId,
      parentScanId: data.parentScanId,
      vaultCopy: data.vaultCopy,
    };
    if (meta) base._draftMeta = meta;
    return base;
  };

  useEffect(() => { cardDataRef.current = cardData; }, [cardData]);
  useEffect(() => { setVideoPreviewFailed(false); }, [cardData.videoRaw, cardData.id]);

  const featuredList = featuredData?.featured ?? [];
  const resolveFeaturedMarketValue = (cert?: FeaturedCert | null) => {
    if (!cert?.market) return null;
    const grade = parseFloat(String(cert.overall_grade ?? '0'));
    if (!Number.isNaN(grade) && grade >= 9.5 && cert.market?.psa10) return cert.market.psa10;
    if (!Number.isNaN(grade) && grade >= 8.5 && cert.market?.psa9) return cert.market.psa9;
    return cert.market?.raw ?? cert.market?.psa9 ?? cert.market?.psa10 ?? null;
  };
  const formatUsdExact = (value?: number | null) => value == null
    ? '--'
    : value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatShortDate = (value?: string) => {
    if (!value) return '--';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? '--'
      : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const vaultExampleCard = featuredList[0] ?? null;
  const ledgerPreviewCard = valuationFeatured ?? heroFeatured ?? vaultExampleCard;
  const ledgerPreviewMarketValue = resolveFeaturedMarketValue(ledgerPreviewCard);
  const displayVaultBaseCard = vaultExampleCard ?? heroFeatured ?? valuationFeatured ?? null;
  const displayVaultExamplesCount = featuredList.length;
  const displayVaultPreviewGrades = [
    { grade: '10', role: 'Champion' },
    { grade: '9', role: 'Gallery' },
    { grade: '8', role: 'Gallery' },
    { grade: '8', role: 'Gallery' },
    { grade: '7', role: 'Gallery' },
  ];

  const saveDraft = async () => {
    const data = cardDataRef.current ?? cardData;
    if (!data.frontCropped || !data.backCropped) return;
    const dm = (data as any)._draftMeta;
    const isProDraft = dm?.credit_type === 'paid';
    if (!user || (user.role !== 'admin' && !isProDraft)) return;
    try {
      const meta = isProDraft ? { credit_type: 'paid' as const, reanalysis_count: dm.reanalysis_count ?? 0 } : undefined;
      const draftPayload = buildDraftPayload(data, meta);
      const res = await fetch('api/drafts.php?action=save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftPayload),
      });
      const json = await res.json().catch(() => ({}));
      if (json.error) {
        alert(json.error);
        return;
      }
      if (!res.ok) {
        alert(json.error || `Save draft failed (${res.status})`);
        return;
      }
      if (meta) setCardData(prev => ({ ...prev, _draftMeta: meta }));
      setHasDraft(true);
      await refreshUser();
    } catch (e) {
      console.error('Save draft failed', e);
      const msg = e instanceof Error ? e.message : 'Failed to save draft';
      if (/load failed|failed to fetch|networkerror/i.test(msg)) {
        alert('Draft save failed. Check your connection and try again, or try on Wi‑Fi.');
      } else {
        alert(msg);
      }
    }
  };

  const updateDraftSilent = async (payload: Record<string, unknown>) => {
    try {
      await fetch('api/drafts.php?action=save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error('Update draft failed', e);
    }
  };

  const discardDraft = async () => {
    if (!confirm('Discard this draft? You will lose the credit used for this pro scan. Need help? support@rawgraded.com or @GatoGodMode on X')) return;
    try {
      await fetch('api/drafts.php?action=delete', { method: 'POST', credentials: 'include' });
      setHasDraft(false);
      setDraftFetched(false);
      setCardData(prev => {
        const { _draftMeta, ...rest } = prev as any;
        return rest;
      });
      handleGoHome();
    } catch (e) {
      console.error('Discard draft failed', e);
      alert('Failed to discard draft');
    }
  };

  const loadDraft = async () => {
    try {
      const res = await fetch('api/drafts.php?action=get', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      const raw = data.draft;
      if (!raw || typeof raw !== 'string') return;
      const parsed = JSON.parse(raw) as Partial<CardData>;
      const hasEvidence = parsed?.frontCropped && parsed?.backCropped;
      if (parsed && (parsed.metadata || parsed.userGrade || hasEvidence)) {
        setCardData(prev => ({ ...prev, ...parsed, videoFrames: parsed.videoFrames ?? prev.videoFrames ?? [] }));
        setHasDraft(false);
      }
    } catch (e) {
      console.error('Load draft failed', e);
      alert('Failed to load draft');
    }
  };

  const handleOpenDraft = async () => {
    try {
      const res = await fetch('api/drafts.php?action=get', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      const raw = data.draft;
      if (!raw || typeof raw !== 'string') return;
      const parsed = JSON.parse(raw) as Partial<CardData>;
      const hasEvidence = parsed?.frontCropped && parsed?.backCropped;
      if (parsed && (parsed.metadata || parsed.userGrade || hasEvidence)) {
        setCardData(prev => ({ ...prev, ...parsed, videoFrames: parsed.videoFrames ?? prev.videoFrames ?? [] }));
        setStep(AppStep.ANALYSIS);
        setDraftFetched(true);
        setHasDraft(true);
      }
    } catch (e) {
      console.error('Open draft failed', e);
      alert('Failed to open draft');
    }
  };

  const startOver = () => {
    handleGoHome();
  };

  // ── Notes pre-fill helpers ─────────────────────────────────────────────────
  // card count = how many of this card are already in DB + 1 (this new scan)
  const cardCountInDb = (cardData.similar_scans?.length ?? 0) + 1;

  const insertAtCursor = (text: string) => {
    const el = notesRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = cardData.userNotes || '';
    const next = current.slice(0, start) + text + current.slice(end);
    setCardData(prev => ({ ...prev, userNotes: next }));
    // Restore cursor position after React re-renders
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const PREFILLS = [
    { label: `#${cardCountInDb}:`, text: `Number: ${cardCountInDb}` },
    { label: `#${cardCountInDb}: (of)`, text: `Number: ${cardCountInDb} (of)` },
    { label: `#${cardCountInDb}: ESUS`, text: `Number: ${cardCountInDb} - ESUS` },
    { label: `#${cardCountInDb}: (of) ESUS`, text: `Number: ${cardCountInDb} (of) - ESUS` },
  ];

  // ── Envelope OCR handler ───────────────────────────────────────────────────
  const handleEnvelopeExtracted = (data: EnvelopeExtractResult) => {
    setCardData(prev => {
      const noteParts: string[] = [];
      if (data.cardCount) noteParts.push(`Card Count: ${data.cardCount}`);
      const appendedNote = noteParts.length
        ? (prev.userNotes ? `${prev.userNotes}\n${noteParts.join(' | ')}` : noteParts.join(' | '))
        : prev.userNotes || '';

      // ESUS logic: If tracking starts with ESUS, force source to eBay
      let finalSource = data.source || prev.acqSource;
      if (data.trackingNumber && data.trackingNumber.toUpperCase().startsWith('ESUS')) {
        finalSource = 'eBay';
      }

      return {
        ...prev,
        acqPrice: data.price !== undefined ? data.price : prev.acqPrice,
        acqTrackingNumber: data.trackingNumber || prev.acqTrackingNumber,
        acqSource: finalSource,
        acqOrderId: data.orderId || prev.acqOrderId,
        acqCity: data.city || prev.acqCity,
        acqState: data.state || prev.acqState,
        userNotes: appendedNote,
      };
    });
  };

  const handleLogout = async () => {
    await storeService.logout();
    setUser(null);
    handleGoHome();
  };

  const handleAcquisitionApply = (data: AcquisitionData) => {
    setCardData(prev => ({
      ...prev,
      acqPrice: data.price,
      acqTax: data.tax,
      acqShipping: data.shipping,
      acqSource: data.source,
      acqTrackingNumber: data.tracking_number,
      acqOrderId: data.order_id,
      userNotes: prev.userNotes ? `${prev.userNotes}\n\n[Acquisition Notes]: ${data.notes}` : `[Acquisition Notes]: ${data.notes}`
    }));
  };

  const handleSelectCertificate = async (id: string) => {
    setIsAnalyzing(true);
    setCertLoadError(null);
    try {
      const resp = await fetch(`api/verify.php?id=${id}`, { credentials: 'include' });
      const raw = await resp.json();

      if (raw.error) {
        setCertLoadError(resp.status === 404 ? 'Certificate not found.' : raw.error || 'Could not load certificate.');
        return;
      }

      const toDataUrl = (v: string | null | undefined): string | null => {
        if (!v || typeof v !== 'string') return null;
        return v.startsWith('data:') ? v : `data:image/jpeg;base64,${v}`;
      };

      const isCollectOnly =
        raw.overall_grade === null ||
        raw.overall_grade === undefined ||
        raw.overall_grade === '';

      const mappedCard: CardData = {
        id: raw.id,
        frontRaw: toDataUrl(raw.front_img) ?? null,
        backRaw: toDataUrl(raw.back_img) ?? null,
        frontCropped: toDataUrl(raw.front_thumb || raw.front_img) ?? null,
        backCropped: toDataUrl(raw.back_thumb || raw.back_img) ?? null,
        videoRaw: null,
        videoFrames: (() => {
          const v = raw.video_frames_json;
          if (Array.isArray(v)) return v;
          if (typeof v === 'string' && v.trim()) {
            try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
          }
          return [];
        })(),
        metadata: {
          name: raw.name || '',
          character: raw.character_name || '',
          set: raw.card_set || '',
          year: raw.year || '',
          edition: raw.edition || '',
          cardNumber: raw.card_number || '',
          artist: raw.artist || '',
          estimated_value: parseFloat(raw.estimated_value) || 0,
          rarity: raw.rarity || '',
          is_first_edition: !!raw.is_first_edition
        },
        assessmentMode: isCollectOnly ? 'collect_only' : 'graded',
        userGrade: isCollectOnly
          ? {
            centering: 0,
            corners: 0,
            edges: 0,
            surface: 0,
            overall: 0,
            reasoning: raw.reasoning || raw.user_notes || '',
            defects: [],
            predictedGrades: undefined,
            detectedName: raw.name || '',
            detectedCharacter: raw.character_name || '',
            detectedSet: raw.card_set || '',
            detectedYear: raw.year || '',
            detectedEdition: raw.edition || '',
            detectedCardNumber: raw.card_number || '',
            detectedArtist: raw.artist || '',
          }
          : {
            centering: parseFloat(raw.centering) || 10,
            corners: parseFloat(raw.corners) || 10,
            edges: parseFloat(raw.edges) || 10,
            surface: parseFloat(raw.surface) || 10,
            overall: parseFloat(raw.overall_grade) || 10,
            reasoning: raw.reasoning || raw.user_notes || '',
            defects: (() => {
              let list: any[] = [];
              if (Array.isArray(raw.defects_json)) {
                list = raw.defects_json;
              } else if (typeof raw.defects_json === 'string') {
                try {
                  let s = raw.defects_json.trim();
                  if (!s) return [];
                  // Strip JSON string wrappers: \"...\" or "..." (from legacy double-encode or save.php storing raw string)
                  if (s.startsWith('\\"') && s.endsWith('\\"')) s = s.slice(2, -2);
                  while (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
                    const inner = s.slice(1, -1);
                    if (inner.includes('"')) break;
                    s = inner;
                  }
                  if (s.match(/^\s*\[/)) {
                    const parsed = JSON.parse(s);
                    list = Array.isArray(parsed) ? parsed : [];
                  } else {
                    const decomp = LZString.decompressFromBase64(s) ?? LZString.decompressFromEncodedURIComponent(s);
                    let toParse: string | null = decomp;
                    if (!toParse && s.match(/^\s*[\[{]/)) toParse = s;
                    let parsed: any = null;
                    if (typeof toParse === 'string') parsed = toParse.match(/^\s*\[/) ? JSON.parse(toParse) : null;
                    else if (Array.isArray(toParse)) parsed = toParse;
                    if (!parsed && decomp && typeof decomp === 'object' && Array.isArray((decomp as any).defects)) parsed = (decomp as any).defects;
                    list = Array.isArray(parsed) ? parsed : [];
                  }
                } catch (e) {
                  console.warn('Certificate defects_json decode failed', e);
                  list = [];
                }
              }
              return (list || []).map((d: any) => ({
                ...d,
                description: d.description ?? d.reasoning ?? '',
                box2d: Array.isArray(d.box2d) ? d.box2d : (d.box_2d && Array.isArray(d.box_2d) ? d.box_2d : undefined),
                imageIndex: typeof d.imageIndex === 'number' ? d.imageIndex : (typeof d.image_index === 'number' ? d.image_index : 0)
              }));
            })(),
            predictedGrades: raw.predicted_grades ? {
              psa: raw.predicted_grades.psa ?? raw.predicted_grades.PSA,
              bgs: raw.predicted_grades.bgs ?? raw.predicted_grades.BGS,
              cgc: raw.predicted_grades.cgc ?? raw.predicted_grades.CGC,
              tcg: raw.predicted_grades.tcg ?? raw.predicted_grades.TCG
            } : undefined,
            detectedName: raw.name || '',
            detectedCharacter: raw.character_name || '',
            detectedSet: raw.card_set || '',
            detectedYear: raw.year || '',
            detectedEdition: raw.edition || '',
            detectedCardNumber: raw.card_number || '',
            detectedArtist: raw.artist || '',
          },
        aiGrade: null,
        dateScanned: raw.date_scanned,
        userNotes: raw.user_notes,
        parentScanId: raw.parent_id,
        acqPrice: parseFloat(raw.acq_price) || 0,
        acqTax: parseFloat(raw.acq_tax) || 0,
        acqShipping: parseFloat(raw.acq_shipping) || 0,
        acqDate: raw.acq_date,
        acqSource: raw.acq_source,
        acqCity: raw.acq_city,
        acqState: raw.acq_state,
        acqTrackingNumber: raw.tracking_number,
        acqOrderId: raw.order_id,
        userId: raw.user_id,
        history: raw.history || [],
        descendants: raw.descendants || [],
        similar_scans: raw.similar_scans || [],
        isAlliance: !!raw.is_alliance,
        isPck: !!raw.is_pck,
        userRole: raw.user_role,
        userTwitter: raw.x_username || raw.user_twitter || '',
        ownerUsername: raw.username || ''
      };

      // Fallback: if verify did not include inline images, fetch them explicitly (so forensics can render).
      if (raw.id) {
        if (!mappedCard.frontCropped && !mappedCard.frontRaw) {
          try {
            const fr = await fetch(`api/verify.php?id=${encodeURIComponent(raw.id)}&image=front`, { credentials: 'include' });
            const fj = await fr.json();
            if (fj.data) {
              const url = typeof fj.data === 'string' && !fj.data.startsWith('data:') ? `data:image/jpeg;base64,${fj.data}` : fj.data;
              mappedCard.frontCropped = url;
              mappedCard.frontRaw = url;
            }
          } catch (_) { /* ignore */ }
        }
        if (!mappedCard.backCropped && !mappedCard.backRaw) {
          try {
            const br = await fetch(`api/verify.php?id=${encodeURIComponent(raw.id)}&image=back`, { credentials: 'include' });
            const bj = await br.json();
            if (bj.data) {
              const url = typeof bj.data === 'string' && !bj.data.startsWith('data:') ? `data:image/jpeg;base64,${bj.data}` : bj.data;
              mappedCard.backCropped = url;
              mappedCard.backRaw = url;
            }
          } catch (_) { /* ignore */ }
        }
      }

      setCardData(mappedCard);
      setStep(AppStep.CERTIFICATE);
      setDeepLinkCertId(null);
    } catch (error) {
      console.error("Failed to load certificate", error);
      setCertLoadError('Network error. Open the link again or try from a browser.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGoHome = () => {
    setUploadMode('none');
    setDeepLinkCertId(null);
    setCertLoadError(null);
    setCardData({
      id: crypto.randomUUID(),
      frontRaw: null,
      backRaw: null,
      frontCropped: null,
      backCropped: null,
      videoRaw: null,
      videoFrames: [],
      userGrade: null,
      aiGrade: null,
      metadata: INITIAL_METADATA,
      dateScanned: new Date().toLocaleString(),
      userTwitter: ''
    });
    setStep(AppStep.UPLOAD);
  };

  const handlePricingClick = () => {
    if (step !== AppStep.UPLOAD) {
      scrollToPricingRef.current = true;
      setStep(AppStep.UPLOAD);
    } else {
      document.getElementById('credits-and-drafts')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleScrollToFeatures = () => {
    if (step !== AppStep.UPLOAD) {
      setStep(AppStep.UPLOAD);
      setTimeout(() => document.getElementById('all-features')?.scrollIntoView({ behavior: 'smooth' }), 150);
    } else {
      document.getElementById('all-features')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (step === AppStep.UPLOAD && scrollToPricingRef.current) {
      scrollToPricingRef.current = false;
      const t = setTimeout(() => {
        document.getElementById('credits-and-drafts')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [step]);

  const handleStartRegrade = async (certId: string) => {
    // Always initialize a fresh re-grade session, but keep parent ledger notes/acquisition
    // so "do nothing new" does not wipe existing metadata.
    setCardData({
      id: crypto.randomUUID(),
      frontRaw: null,
      backRaw: null,
      frontCropped: null,
      backCropped: null,
      videoRaw: null,
      videoFrames: [],
      userGrade: null,
      aiGrade: null,
      metadata: INITIAL_METADATA,
      dateScanned: new Date().toLocaleString(),
      userTwitter: '',
      parentScanId: certId,
      // Acquisition + notes are filled after we fetch the parent cert.
    } as any);
    setStep(AppStep.UPLOAD);

    const parseOptionalFloat = (v: any): number | undefined => {
      if (v === null || v === undefined || v === '') return undefined;
      const n = parseFloat(String(v));
      return Number.isFinite(n) ? n : undefined;
    };

    try {
      const resp = await fetch(`api/verify.php?id=${encodeURIComponent(certId)}`, { credentials: 'include' });
      const raw = await resp.json().catch(() => ({}));
      if (!resp.ok || raw?.error) return;

      setCardData(prev => ({
        ...prev,
        userNotes: raw.user_notes ?? '',
        acqPrice: parseOptionalFloat(raw.acq_price),
        acqTax: parseOptionalFloat(raw.acq_tax),
        acqShipping: parseOptionalFloat(raw.acq_shipping),
        acqDate: raw.acq_date ? String(raw.acq_date).split(' ')[0] : undefined,
        acqSource: raw.acq_source ?? '',
        acqCity: raw.acq_city ?? '',
        acqState: raw.acq_state ?? '',
        acqTrackingNumber: raw.tracking_number ?? '',
        acqOrderId: raw.order_id ?? '',
        userTwitter: raw.x_username || raw.user_twitter || '',
      }));
    } catch (e) {
      console.warn('Regrade prefill failed', e);
    }
  };

  const getSourceImageByIndex = (index: number, defect?: any) => {
    // Priority: Persistent ImageData
    if (defect?.imageData) return defect.imageData;

    if (index === 0) return cardData.frontCropped;
    if (index === 1) return cardData.backCropped;
    if (index >= 2 && cardData.videoFrames && cardData.videoFrames[index - 2]) {
      return cardData.videoFrames[index - 2];
    }
    return null;
  };

  const getStepLabel = (s: AppStep) => {
    switch (s) {
      case AppStep.UPLOAD: return 'Identification';
      case AppStep.CROP_FRONT:
      case AppStep.CROP_BACK: return 'Precision Crop';
      case AppStep.VIDEO_CAPTURE: return 'Evidence Capture';
      case AppStep.ANALYSIS: return 'AI Integrity Scan';
      case AppStep.CERTIFICATE: return 'Audit Complete';
      default: return 'Ready';
    }
  };

  const renderProgressBadge = () => {
    const auditSteps = [AppStep.UPLOAD, AppStep.CROP_FRONT, AppStep.CROP_BACK, AppStep.VIDEO_CAPTURE, AppStep.ANALYSIS, AppStep.CERTIFICATE];
    if (!auditSteps.includes(step)) return null;

    const label = getStepLabel(step);

    return (
      <div className="flex items-center gap-3 bg-[#990000]/5 border border-poke-accent/20 px-4 py-1.5 rounded-full shadow-lg backdrop-blur-sm animate-fade-in group hover:bg-[#990000]/10 transition-all cursor-default">
        <div className="relative">
          <div className="w-2 h-2 bg-[#990000] rounded-full animate-pulse shadow-[0_0_8px_rgba(233,69,96,0.8)]"></div>
          <div className="absolute inset-0 w-2 h-2 bg-[#990000] rounded-full animate-ping opacity-40"></div>
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#990000]/80 group-hover:text-[#990000] transition-colors">{label}</span>
      </div>
    );
  };

  if (step === AppStep.PRIVACY) return <PrivacyPolicy onBack={() => setStep(AppStep.UPLOAD)} />;
  if (step === AppStep.TERMS_USE) return <TermsOfUse onBack={() => setStep(AppStep.UPLOAD)} />;
  if (step === AppStep.TERMS_SERVICE) return <TermsOfService onBack={() => setStep(AppStep.UPLOAD)} />;

  const renderUploadStep = () => {
    const renderUploadSection = (showIntro: boolean) => (
      <section
        id="upload-section"
        className={`w-full border-y ${showIntro ? 'py-20 md:py-24' : 'py-10 md:py-12'}`}
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <div className="w-full bg-transparent">
          {showIntro && (
            <div className="w-full max-w-3xl mx-auto px-4 md:px-6 text-center mb-10">
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] mb-3" style={{ color: '#D4AF37' }}>Diagnostic Initiation</p>
              <h2 className="font-serif font-medium text-white mb-4" style={{ fontSize: 'clamp(2rem,4.5vw,3.4rem)' }}>
                Standardized Capture Process.
              </h2>
              <p className="text-base sm:text-lg font-light" style={{ color: '#a0aec0', lineHeight: 1.8 }}>
                Submit high-resolution diagnostic data. Establish the baseline for your asset's Condition Report.
              </p>
            </div>
          )}
          <div className={`w-full max-w-5xl mx-auto px-4 md:px-6 flex flex-col items-center justify-center space-y-8 animate-fade-in ${showIntro ? 'py-12 min-h-[60vh]' : 'py-2 min-h-0'}`}>
            {cardData.parentScanId && (
              <div className="w-full max-w-2xl bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center gap-4 animate-fade-in">
                <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                  <i className="fas fa-link text-teal-600 text-xl"></i>
                </div>
                <div>
                  <p className="text-teal-800 font-black text-sm uppercase tracking-wider">Linked re-scan</p>
                  <p className="text-teal-700 text-xs mt-0.5">This audit will be linked to your previous certificate. Capture the same card to add a new audit to the chain.</p>
                </div>
              </div>
            )}

            {uploadMode === 'none' ? (
              <div className="w-full max-w-4xl mx-auto space-y-8 animate-fade-in pb-10">
                <p className="text-center text-sm font-bold uppercase tracking-widest text-[#D4AF37]">Select a Tool</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <button onClick={() => setUploadMode('rawgrade')} className="bg-[#0a0a0a] border border-[#BF953F]/10 hover:border-[#D4AF37]/50 p-6 rounded-xl text-left transition-all duration-300 group flex flex-col gap-2 hover:shadow-[0_0_30px_rgba(212,175,55,0.15)]">
                    <div className="flex items-center gap-4 mb-2">
                      <RawGradeIconSVG className="w-8 h-8 drop-shadow-[0_0_12px_rgba(212,175,55,0.1)] group-hover:scale-110 transition-transform duration-300" />
                      <h3 className="text-xl font-serif tracking-wider text-white group-hover:text-[#D4AF37] transition-colors">PRO GRADE</h3>
                    </div>
                    <p className="text-sm text-gray-400 font-medium leading-relaxed group-hover:text-gray-300 transition-colors">Grade using the rules of PSA, CGC, or BGS. (Requires Good Lighting)</p>
                  </button>

                  <button onClick={() => setUploadMode('collect')} className="bg-[#0a0a0a] border border-[#BF953F]/10 hover:border-[#D4AF37]/50 p-6 rounded-xl text-left transition-all duration-300 group flex flex-col gap-2 hover:shadow-[0_0_30px_rgba(212,175,55,0.15)]">
                    <div className="flex items-center gap-4 mb-2">
                      <CollectIconSVG className="w-8 h-8 drop-shadow-[0_0_12px_rgba(212,175,55,0.1)] group-hover:scale-110 transition-transform duration-300" />
                      <h3 className="text-xl font-serif tracking-wider text-white group-hover:text-[#D4AF37] transition-colors">FAST GRADE</h3>
                    </div>
                    <p className="text-sm text-gray-400 font-medium leading-relaxed group-hover:text-gray-300 transition-colors">Get a fast grade for your card. (Good for poor lighting)</p>
                  </button>

                  <button onClick={() => { setCardData({ ...cardData, metadata: { ...cardData.metadata, category: 'Graded Slab' } }); setUploadMode('slab'); }} className="bg-[#0a0a0a] border border-[#BF953F]/10 hover:border-[#D4AF37]/50 p-6 rounded-xl text-left transition-all duration-300 group flex flex-col gap-2 hover:shadow-[0_0_30px_rgba(212,175,55,0.15)]">
                    <div className="flex items-center gap-4 mb-2">
                      <SlabIconSVG className="w-8 h-8 drop-shadow-[0_0_12px_rgba(212,175,55,0.1)] group-hover:scale-110 transition-transform duration-300" />
                      <h3 className="text-xl font-serif tracking-wider text-white group-hover:text-[#D4AF37] transition-colors">ADD SLAB</h3>
                    </div>
                    <p className="text-sm text-gray-400 font-medium leading-relaxed group-hover:text-gray-300 transition-colors">Add and verify an authenticated slab (requires good lighting)</p>
                  </button>

                  <button onClick={() => goToPlatformStep(AppStep.SNIPER)} className="bg-[#0a0a0a] border border-[#BF953F]/10 hover:border-[#D4AF37]/50 p-6 rounded-xl text-left transition-all duration-300 group flex flex-col gap-2 hover:shadow-[0_0_30px_rgba(212,175,55,0.15)]">
                    <div className="flex items-center gap-4 mb-2">
                      <SnipeIconSVG className="w-8 h-8 drop-shadow-[0_0_12px_rgba(212,175,55,0.1)] group-hover:scale-110 transition-transform duration-300" />
                      <h3 className="text-xl font-serif tracking-wider text-white group-hover:text-[#D4AF37] transition-colors">SNIPE</h3>
                    </div>
                    <p className="text-sm text-gray-400 font-medium leading-relaxed group-hover:text-gray-300 transition-colors">Find deals, avoid rip-offs online or in the streets.</p>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="w-full max-w-4xl mx-auto flex justify-start mb-6">
                  <button onClick={() => setUploadMode('none')} className="text-[10px] font-bold uppercase tracking-widest text-[#a0aec0] hover:text-[#D4AF37] transition-colors flex items-center gap-2">
                    <i className="fas fa-arrow-left"></i> Change Tool
                  </button>
                </div>

                {/* Main tool: category + Front/Back + Initialize Audit */}
                {uploadMode !== 'slab' && (
                  <div className="w-full max-w-sm">
                    <label className="text-[10px] text-gray-400 uppercase font-black tracking-widest block mb-2 text-center">Asset Classification</label>
                    <div className="relative">
                      <select
                        className="w-full bg-[#0a0a0a] border border-white/10 p-4 rounded-lg text-white text-center font-bold focus:border-[#BF953F] focus:ring-1 focus:ring-[#BF953F] outline-none transition-all shadow-md text-base appearance-none"
                        value={cardData.metadata.category || 'Pokemon'}
                        onChange={(e) => setCardData({ ...cardData, metadata: { ...cardData.metadata, category: e.target.value } })}
                      >
                        <option value="Pokemon">Pokemon</option>
                        <option value="Magic">Magic: The Gathering</option>
                        <option value="Yu-Gi-Oh">Yu-Gi-Oh!</option>
                        <option value="Sports">Sports</option>
                        <option value="OnePiece">One Piece</option>
                        <option value="Lorcana">Lorcana</option>
                        <option value="Other">Other</option>
                      </select>
                      <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                        <i className="fas fa-chevron-down text-[#BF953F] text-xs"></i>
                      </div>
                    </div>
                  </div>
                )}

                {showIntro && (
                  <p className="text-center max-w-2xl mx-auto text-sm text-gray-400 space-y-1 mb-6 mt-4">
                    <span className="block font-black text-transparent bg-clip-text bg-gradient-to-r from-gray-200 to-gray-500 uppercase tracking-widest text-[10px]">Topographic Capture Standards</span>
                    <span className="block text-xs italic opacity-70">Adhere to strict environmental control: even illumination, neutral substrate, maximum optical resolution.</span>
                  </p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
                  <div className={`bg-[#0a0a0a] p-6 rounded-xl border transition-all duration-300 group flex flex-col items-center shadow-2xl ${cardData.frontRaw ? 'border-[#BF953F]/50 bg-[#111111] shadow-[0_0_30px_rgba(191,149,63,0.1)]' : 'border-white/5 hover:border-[#BF953F]/30 hover:shadow-[0_0_20px_rgba(191,149,63,0.05)]'}`}>
                    <div className="w-full flex justify-between items-center mb-6">
                      <h3 className="text-lg font-black uppercase tracking-wider flex items-center gap-3 text-white">
                        <i className="fas fa-image text-[#BF953F]"></i> Front
                      </h3>
                      <div className="flex items-center gap-2 group" title="RawGraded Grader">
                        {cardData.frontRaw && (
                          <button
                            onClick={() => handleRotateImage('front')}
                            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 hover:border-[#BF953F] hover:text-[#BF953F] text-gray-400 flex items-center justify-center transition-all shadow-md"
                            title="Rotate 90Â°"
                          >
                            <i className="fas fa-sync-alt text-xs"></i>
                          </button>
                        )}
                        {cardData.frontRaw && <i className="fas fa-check-circle text-[#BF953F] text-xl drop-shadow-[0_0_8px_rgba(191,149,63,0.4)]"></i>}
                      </div>
                    </div>
                    {cardData.frontRaw ? (
                      <div className="relative w-full aspect-[2.5/3.5] bg-[#050505] rounded-md border border-white/10 overflow-hidden mb-4 shadow-inner">
                        <img src={cardData.frontRaw} alt="Front" className="w-full h-full object-contain" />
                        <button onClick={() => setCardData(prev => ({ ...prev, frontRaw: null }))} className="absolute top-3 right-3 bg-black/60 backdrop-blur-md border border-white/20 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-[#990000] hover:border-[#990000] transition-colors shadow-lg">
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    ) : (
                      <div className="w-full space-y-3">
                        <button
                          onClick={() => setCameraSide('front')}
                          className="w-full py-4 rounded-lg bg-gradient-to-b from-[#990000] to-[#660000] hover:from-[#aa0000] hover:to-[#770000] border border-[#ff4d4d]/20 text-white font-bold flex items-center justify-center gap-3 transition-all shadow-lg hover:shadow-[#990000]/20"
                        >
                          <i className="fas fa-camera text-xl opacity-80"></i> Add to Collection
                        </button>
                        <p className="text-[10px] text-white/30 text-center">
                          Snap when framed in the lens guide.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className={`bg-[#0a0a0a] p-6 rounded-xl border transition-all duration-300 group flex flex-col items-center shadow-2xl ${cardData.backRaw ? 'border-[#BF953F]/50 bg-[#111111] shadow-[0_0_30px_rgba(191,149,63,0.1)]' : 'border-white/5 hover:border-[#BF953F]/30 hover:shadow-[0_0_20px_rgba(191,149,63,0.05)]'}`}>
                    <div className="w-full flex justify-between items-center mb-6">
                      <h3 className="text-lg font-black uppercase tracking-wider flex items-center gap-3 text-white">
                        <i className="fas fa-undo text-[#BF953F]"></i> Back
                      </h3>
                      <div className="flex items-center gap-3">
                        {cardData.backRaw && (
                          <button
                            onClick={() => handleRotateImage('back')}
                            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 hover:border-[#BF953F] hover:text-[#BF953F] text-gray-400 flex items-center justify-center transition-all shadow-md"
                            title="Rotate 90Â°"
                          >
                            <i className="fas fa-sync-alt text-xs"></i>
                          </button>
                        )}
                        {cardData.backRaw && <i className="fas fa-check-circle text-[#BF953F] text-xl drop-shadow-[0_0_8px_rgba(191,149,63,0.4)]"></i>}
                      </div>
                    </div>
                    {cardData.backRaw ? (
                      <div className="relative w-full aspect-[2.5/3.5] bg-[#050505] rounded-md border border-white/10 overflow-hidden mb-4 shadow-inner">
                        <img src={cardData.backRaw} alt="Back" className="w-full h-full object-contain" />
                        <button onClick={() => setCardData(prev => ({ ...prev, backRaw: null }))} className="absolute top-3 right-3 bg-black/60 backdrop-blur-md border border-white/20 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-[#990000] hover:border-[#990000] transition-colors shadow-lg">
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    ) : (
                      <div className="w-full space-y-3">
                        <button
                          onClick={() => setCameraSide('back')}
                          className="w-full py-4 rounded-lg bg-gradient-to-b from-[#990000] to-[#660000] hover:from-[#aa0000] hover:to-[#770000] border border-[#ff4d4d]/20 text-white font-bold flex items-center justify-center gap-3 transition-all shadow-lg hover:shadow-[#990000]/20"
                        >
                          <i className="fas fa-camera text-xl opacity-80"></i> {uploadMode === 'rawgrade' ? 'Add Back Capture' : 'Add Back (Optional)'}
                        </button>
                        <p className="text-[10px] text-white/30 text-center px-4">
                          {uploadMode === 'rawgrade' ? (
                            <>Back image & Verification Video are <span className="text-white font-bold drop-shadow-[0_0_5px_rgba(255,255,255,0.3)]">REQUIRED</span> for full RawGrade Audits.</>
                          ) : uploadMode === 'collect' ? (
                            <>Back is optional when using <span className="text-white font-bold">Add To My Collection</span>.</>
                          ) : (
                            <>Back is optional.</>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {uploadMode === 'slab' && (
                  <button
                    disabled={!cardData.frontRaw}
                    onClick={() => {
                      if (!user) { setIsAuthOpen(true); return; }
                      setAuthVaultSlabId(undefined); // New slab, no existing ID
                      setIsSlabCheckerOpen(true);
                    }}
                    className="mt-6 rounded-lg bg-[#0a0a0a] border border-[#BF953F]/30 text-white font-black py-4 px-14 transform transition duration-300 hover:bg-[#111111] hover:border-[#BF953F] disabled:opacity-30 disabled:cursor-not-allowed text-lg flex items-center justify-center gap-3 uppercase tracking-[0.12em] w-full shadow-[0_4px_20px_rgba(191,149,63,0.1)]"
                    title="Authenticate and Vault Graded Slab"
                  >
                    <i className="fas fa-shield-alt text-[#D4AF37]"></i> Authenticate Slab & Vault
                  </button>
                )}

                {uploadMode === 'collect' && (
                  <>
                    <button
                      disabled={!cardData.frontRaw || archiveCollectOnlyBusy}
                      onClick={() => {
                        void submitArchivalCollectOnly();
                      }}
                      className="mt-6 rounded-lg bg-[#0a0a0a] border border-white/10 text-white font-black py-4 px-14 transform transition duration-300 hover:bg-[#111111] disabled:opacity-30 disabled:cursor-not-allowed text-lg flex items-center justify-center gap-3 uppercase tracking-[0.12em]"
                      title="Identify card, run Rapid AI Grade, and vault it securely"
                    >
                      {archiveCollectOnlyBusy ? (
                        <>
                          <i className="fas fa-circle-notch fa-spin"></i> Assessing & Vaulting…
                        </>
                      ) : (
                        <>
                          <i className="fas fa-layer-plus text-[#D4AF37] drop-shadow-md"></i> Add To My Collection
                        </>
                      )}
                    </button>
                    {archiveCollectOnlyError && (
                      <div className="mt-3 text-[10px] text-red-400 font-bold uppercase tracking-widest text-center">
                        {archiveCollectOnlyError}
                      </div>
                    )}
                  </>
                )}

                {uploadMode === 'rawgrade' && (
                  <button
                    disabled={!cardData.frontRaw || !cardData.backRaw}
                    onClick={() => {
                      if (!user) {
                        setIsAuthOpen(true);
                        return;
                      }
                      setStep(AppStep.CROP_FRONT);
                    }}
                    title={!cardData.backRaw ? 'Back photo required to run audits.' : 'Execute the audit (grading)'}
                    className="mt-6 rounded-lg bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-black font-black py-5 px-14 transform transition duration-300 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(191,149,63,0.3)] disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none text-lg flex items-center justify-center gap-3 uppercase tracking-[0.2em]"
                  >
                    <span className="drop-shadow-sm">Execute Diagnostic Scan</span> <i className="fas fa-arrow-right drop-shadow-sm"></i>
                  </button>
                )}

              </>
            )}
          </div>
        </div>
      </section>
    );

    return (
      <div className="w-full" style={{ background: '#111111' }}>
        <section className="border-b border-white/10 bg-[#0b0b0b]">
          <div className="w-full max-w-6xl mx-auto px-6 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: '#a0aec0' }}>
              Application-only access &middot; 7-day trial (no card) &middot; Google SSO + 2FA
            </p>
            <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#718096' }}>
              <span>Membership billing via Stripe</span>
              <span>PSA / BGS / CGC workflows</span>
            </div>
          </div>
        </section>

        {user && user.has_platform_access === false && (
          <section className="border-b border-amber-900/40 bg-amber-950/30">
            <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-sm text-amber-100/90">
                Your trial has ended or billing needs attention. Subscribe to continue using scans, vault, and tools.
              </p>
              <button
                type="button"
                onClick={() => setIsShopOpen(true)}
                className="shrink-0 px-5 py-2 text-[11px] font-black uppercase tracking-widest text-black"
                style={{ background: 'linear-gradient(90deg,#BF953F,#E8C881,#B38728)' }}
              >
                View plans
              </button>
            </div>
          </section>
        )}

        {user && user.has_platform_access !== false && renderUploadSection(false)}

        <section className="w-full max-w-6xl mx-auto px-6 pt-20 pb-12 md:pt-28 md:pb-16 flex flex-col lg:flex-row gap-14 lg:gap-28 items-center">
          <div className="flex-1 min-w-0 text-center lg:text-left order-2 lg:order-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.42em] mb-6" style={{ color: '#a0aec0' }}>
              RawGraded &middot; Est. 2026
            </p>
            <h1 className="font-serif font-medium leading-[0.96] tracking-tight mb-7" style={{ fontSize: 'clamp(3rem,6.15vw,5.6rem)', color: '#ffffff' }}>
              Condition intelligence for serious collectors.
            </h1>
            <p className="text-[1.02rem] sm:text-[1.12rem] max-w-[40rem] font-light mb-10" style={{ color: '#cbd5e0', lineHeight: 1.88 }}>
              Apply for access. If approved, you get a 7-day trial with no card on file—then choose a membership cadence that fits how you work. Estimates are informational, not guarantees from third-party graders.
            </p>

            <div className="max-w-[42rem] mb-10 border-y" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <div className="grid grid-cols-1 sm:grid-cols-2">
                {[
                  {
                    label: 'Snapshot',
                    value: heroFeatured?.overall_grade ? `RG ${heroFeatured.overall_grade}` : 'Grade band',
                    copy: 'Structured read on centering, corners, and surface before you submit or sell.'
                  },
                  {
                    label: 'Context',
                    value: heroFeatured?.market?.raw ? `$${Number(heroFeatured.market.raw).toLocaleString()}` : 'Market ref.',
                    copy: 'Raw vs graded context to support decisions—not a promise of slab outcomes.'
                  },
                  {
                    label: 'Record',
                    value: 'Vaulted',
                    copy: 'Private vault with optional sharing. You control what is visible.'
                  },
                  {
                    label: 'Continuity',
                    value: 'Linked history',
                    copy: 'Re-scans can chain to prior certificates when you want a paper trail.'
                  },
                ].map(({ label, value, copy }, index) => (
                  <div key={label} className="py-6 text-left sm:px-6" style={{ borderLeft: index % 2 === 1 ? '1px solid rgba(255,255,255,0.1)' : 'none', borderTop: index > 1 ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
                    <p className="text-[8px] font-bold uppercase tracking-[0.32em] mb-2.5" style={{ color: '#718096' }}>{label}</p>
                    <p className="text-[1.05rem] font-semibold text-white mb-1.5">{value}</p>
                    <p className="text-[13px] font-light max-w-[17rem]" style={{ color: '#a0aec0', lineHeight: 1.65 }}>{copy}</p>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[13px] max-w-[38rem] mb-9" style={{ color: '#8d97a7', lineHeight: 1.8 }}>
              Tools below are for members. Public archive remains browsable; grading and vault require an active trial or subscription.
            </p>

            <div className="flex flex-wrap gap-4 justify-center lg:justify-start">
              <button
                type="button"
                onClick={() => (user ? document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' }) : document.getElementById('apply-zone')?.scrollIntoView({ behavior: 'smooth' }))}
                className="min-h-[56px] px-8 py-4 font-sans font-bold uppercase tracking-[0.18em] text-[12px] transition-all bg-white text-black hover:bg-gray-200"
              >
                {user ? 'Open tools' : 'Apply for access'}
              </button>
              <button
                type="button"
                onClick={() => heroFeatured && handleSelectCertificate(heroFeatured.id)}
                className="min-h-[56px] px-8 py-4 font-sans font-bold uppercase tracking-[0.18em] text-[12px] border transition-all hover:bg-white hover:text-black"
                style={{ borderColor: 'rgba(255,255,255,0.2)', color: '#ffffff', background: 'transparent' }}
              >
                Inspect a Graded Asset
              </button>
            </div>

            {!user && (
              <div className="mt-4 flex flex-wrap items-center justify-center lg:justify-start gap-x-4 gap-y-2 text-sm" style={{ color: '#718096' }}>
                <button
                  type="button"
                  onClick={() => setIsApplicationWizardOpen(true)}
                  className="font-bold uppercase tracking-[0.18em] text-[11px] transition-all"
                  style={{ color: '#D4AF37' }}
                >
                  Start application <i className="fas fa-arrow-right ml-2 text-[10px]"></i>
                </button>
                <span>Existing member of The Registry?</span>
                <button
                  type="button"
                  onClick={() => { setAuthInitialMode('login'); setIsAuthOpen(true); }}
                  className="font-bold border-b border-white/50 hover:text-white"
                  style={{ color: '#ffffff' }}
                >
                  Sign in
                </button>
              </div>
            )}
          </div>

          <div className="w-full lg:max-w-[450px] flex-shrink-0 order-1 lg:order-2">
            {heroFeatured ? (
              <div className="relative" style={{ filter: 'drop-shadow(0 28px 72px rgba(0,0,0,0.72))' }}>
                <button
                  type="button"
                  onClick={() => handleSelectCertificate(heroFeatured.id)}
                  className="w-full text-left border overflow-hidden group"
                  style={{ background: 'linear-gradient(165deg,rgba(24,24,24,0.98) 0%,rgba(10,10,10,1) 100%)', borderColor: 'rgba(197,160,89,0.22)' }}
                >
                  <div className="aspect-[2.5/3.4] w-full overflow-hidden border-b" style={{ background: '#151515', borderColor: 'rgba(197,160,89,0.16)' }}>
                    <img
                      src={heroFeatured.front_img}
                      alt={heroFeatured.name}
                      className="w-full h-full object-contain p-6 group-hover:scale-[1.02] transition-transform duration-500"
                    />
                  </div>
                  <div className="p-7 space-y-5">
                    <div className="flex items-center justify-between gap-3 pb-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
                      <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#D4AF37' }}>Featured condition record</p>
                      <p className="text-[10px] font-mono" style={{ color: '#718096' }}>Audit #{heroFeatured.id}</p>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-black text-white text-base leading-tight truncate">{heroFeatured.name}</p>
                        <p className="text-xs font-medium mt-1" style={{ color: '#a0aec0' }}>{[heroFeatured.year, heroFeatured.card_set].filter(Boolean).join(' · ')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-bold uppercase tracking-[0.22em]" style={{ color: '#718096' }}>Likely grade</p>
                        <p className="text-3xl font-black" style={{ color: '#ffffff' }}>{heroFeatured.overall_grade}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="border p-3" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}>
                        <p className="text-[8px] font-bold uppercase tracking-[0.24em] mb-1" style={{ color: '#718096' }}>Centering</p>
                        <p className="text-sm font-semibold text-white">{heroFeatured.centering ?? '--'}</p>
                      </div>
                      <div className="border p-3" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}>
                        <p className="text-[8px] font-bold uppercase tracking-[0.24em] mb-1" style={{ color: '#718096' }}>Corners</p>
                        <p className="text-sm font-semibold text-white">{heroFeatured.corners ?? '--'}</p>
                      </div>
                      <div className="border p-3" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}>
                        <p className="text-[8px] font-bold uppercase tracking-[0.24em] mb-1" style={{ color: '#718096' }}>Predicted PSA</p>
                        <p className="text-sm font-semibold text-white">{heroFeatured.predicted_grades?.psa ?? '--'}</p>
                      </div>
                      <div className="border p-3" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}>
                        <p className="text-[8px] font-bold uppercase tracking-[0.24em] mb-1" style={{ color: '#718096' }}>Raw market</p>
                        <p className="text-sm font-semibold text-white">
                          {heroFeatured.market?.raw ? `$${Number(heroFeatured.market.raw).toLocaleString()}` : '--'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#718096' }}>Shareable record</p>
                        <p className="text-xs mt-1" style={{ color: '#8d97a7' }}>Useful for review, resale, and documentation.</p>
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#D4AF37' }}>
                        View certificate <i className="fas fa-arrow-right ml-1"></i>
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            ) : (
              <div className="w-full aspect-[2.5/3.4] border flex items-center justify-center" style={{ borderColor: 'rgba(197,160,89,0.2)', background: 'rgba(255,255,255,0.03)' }}>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#4a5568' }}>Loading asset...</span>
              </div>
            )}
          </div>
        </section>

        <section className="border-y" style={{ borderColor: 'rgba(197,160,89,0.12)', background: 'linear-gradient(180deg, rgba(191,149,63,0.04), rgba(255,255,255,0.01))' }}>
          <div className="w-full max-w-6xl mx-auto px-6 py-7 md:py-8 grid grid-cols-1 md:grid-cols-5 gap-5 md:gap-6">
            {[
              {
                label: 'Live audited assets',
                value: featuredData != null ? featuredData.total_graded.toLocaleString() : 'Live',
                copy: 'Real certificate records and featured audits on the platform.'
              },
              {
                label: 'PSA / BGS / CGC support',
                value: 'PSA · BGS · CGC',
                copy: 'Likely outcome bands framed for pre-submission judgment.'
              },
              {
                label: 'Transferable condition records',
                value: 'Structured certificate records',
                copy: 'Structured records built for review, listings, and documentation.'
              },
              {
                label: 'Vault + archive continuity',
                value: 'Vault + archive continuity',
                copy: 'Private records, public visibility controls, and linked history.'
              },
              {
                label: 'Pre-submission estimates',
                value: 'Pre-submission estimates',
                copy: 'Useful for decisions, not presented as grading guarantees.'
              },
            ].map(({ label, value, copy }, index) => (
              <div key={label} className="text-center md:text-left py-1 md:py-0" style={{ borderLeft: index > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none', paddingLeft: index > 0 ? '1rem' : '0' }}>
                <p className="text-[8px] font-bold uppercase tracking-[0.32em] mb-2" style={{ color: '#718096' }}>{label}</p>
                <p className={`${index === 0 ? 'text-[2rem] md:text-[2.18rem] font-serif font-medium' : 'text-[1rem] font-semibold'} text-white mb-2`}>{value}</p>
                <p className="text-[13px] font-light max-w-[15rem]" style={{ color: '#a0aec0', lineHeight: 1.6 }}>{copy}</p>
              </div>
            ))}
          </div>
          <div className="w-full max-w-6xl mx-auto px-6 pb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-[10px] font-medium" style={{ color: '#718096' }}>
              Predictions are pre-submission estimates, not guarantees of third-party grading outcomes.
            </p>
            <button
              type="button"
              onClick={() => setStep(AppStep.ARCHIVE)}
              className="text-left md:text-right text-[11px] font-bold uppercase tracking-[0.18em] transition-all"
              style={{ color: '#D4AF37' }}
            >
              Explore public archive <i className="fas fa-arrow-right ml-2"></i>
            </button>
          </div>
        </section>

        {!user && (
          <section id="apply-zone" className="w-full border-y py-16 md:py-20" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <div className="w-full max-w-xl mx-auto px-6 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] mb-3" style={{ color: '#D4AF37' }}>Members only</p>
              <h2 className="font-serif font-medium text-white mb-4" style={{ fontSize: 'clamp(1.5rem,3vw,2rem)' }}>
                Grader, vault, and tools unlock after application
              </h2>
              <p className="text-sm font-light mb-8" style={{ color: '#a0aec0', lineHeight: 1.75 }}>
                Complete a short questionnaire. Most requests clear automatically; some are reviewed by hand. Then create your account for a 7-day trial—no card required.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => setIsApplicationWizardOpen(true)}
                  className="min-h-[48px] px-8 py-3 font-bold uppercase tracking-[0.18em] text-[11px] text-black"
                  style={{ background: 'linear-gradient(90deg,#BF953F,#E8C881,#B38728)' }}
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthInitialMode('login'); setIsAuthOpen(true); }}
                  className="min-h-[48px] px-8 py-3 font-bold uppercase tracking-[0.18em] text-[11px] border border-white/20 text-white hover:bg-white/10"
                >
                  Sign in
                </button>
              </div>
            </div>
          </section>
        )}
        <section className="w-full py-20 md:py-24 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="w-full max-w-6xl mx-auto px-6">
            <div className="text-center max-w-3xl mx-auto mb-14">
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] mb-3" style={{ color: '#D4AF37' }}>Three Pillars</p>
              <h2 className="font-serif font-medium text-white mb-4" style={{ fontSize: 'clamp(1.9rem,4vw,3rem)' }}>
                The Collector&apos;s Suite.
              </h2>
              <p className="text-base sm:text-lg font-light" style={{ color: '#a0aec0', lineHeight: 1.85 }}>
                Every card in your portfolio deserves a precise, unbiased evaluation. Our system delivers clear condition insights before you submit for grading.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-12">
              {[
                {
                  icon: 'fa-ruler-combined',
                  title: 'Condition Assessment',
                  body: 'Review the complete condition profile and predicted grader-band outcomes of your raw inventory before a single submission fee is committed.'
                },
                {
                  icon: 'fa-chart-line',
                  title: 'Market Insights',
                  body: 'Quantify the spread between a raw card and its graded equivalents with live market data before you acquire, list, or commit capital.'
                },
                {
                  icon: 'fa-file-signature',
                  title: 'Provenance Tracking',
                  body: 'A clear Condition Report — subgrades, defect documentation, grade estimates, and purchase history — for any card you choose to track.'
                },
              ].map(({ icon, title, body }) => (
                <div key={title} className="pt-6 border-t" style={{ borderColor: 'rgba(255,255,255,0.14)' }}>
                  <div className="w-11 h-11 flex items-center justify-center mb-5">
                    <i className={`fas ${icon}`} style={{ color: '#D4AF37' }}></i>
                  </div>
                  <h3 className="font-serif text-xl text-white mb-3">{title}</h3>
                  <p className="font-light max-w-[19rem]" style={{ color: '#a0aec0', lineHeight: 1.8 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" role="region" aria-labelledby="how-it-works-heading" className="w-full py-20 md:py-24 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="w-full max-w-5xl mx-auto px-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-center mb-3" style={{ color: '#a0aec0' }}>The Process</p>
            <h2 id="how-it-works-heading" className="text-center font-serif font-medium mb-14 leading-tight" style={{ fontSize: 'clamp(1.8rem,4vw,2.9rem)', color: '#ffffff' }}>
              Three Stages. One Standard. The Platform.
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
              {[
                { n: '01', h: 'Submission.', b: 'Upload front and back photos of your card under good, even lighting.' },
                { n: '02', h: 'Assessment.', b: 'Centering, corners, edges, and surface are analyzed carefully by our grading models.' },
                { n: '03', h: 'Condition Report.', b: 'Subgrades, grader-band projections, condition data, and provenance chain sealed and managable within your Vault Record. Keep track of everything from acquisition to post grading and post sale.' },
              ].map(({ n, h, b }) => (
                <div key={n} className="border-t pt-6" style={{ borderColor: 'rgba(255,255,255,0.18)' }}>
                  <p className="text-4xl font-light font-mono mb-4" style={{ color: 'rgba(255,255,255,0.2)' }}>{n}</p>
                  <p className="text-xl font-serif font-medium text-white mb-3">{h}</p>
                  <p className="font-medium" style={{ color: '#a0aec0', lineHeight: 1.8 }}>{b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="market-value" role="region" aria-labelledby="market-value-heading" className="w-full py-20 md:py-24 relative overflow-hidden border-b" style={{ background: '#090909', borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#990000]/[0.05] rounded-full blur-[100px] pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#C5A059]/[0.05] rounded-full blur-[100px] pointer-events-none"></div>

          <div className="w-full max-w-6xl mx-auto px-6 relative z-10">
            <div className="mb-16 max-w-3xl">
              <p className="text-[10px] font-bold uppercase tracking-[0.4em] mb-5" style={{ color: '#D4AF37' }}>Market Insights</p>
              <h2 id="market-value-heading" className="font-serif font-medium leading-tight text-white mb-6" style={{ fontSize: 'clamp(2rem,5vw,3.6rem)' }}>
                Know the value before you commit.
              </h2>
              <p className="text-lg font-light max-w-2xl" style={{ color: '#a0aec0', lineHeight: 1.95 }}>
                See raw market value, potential graded upside, and current sales data where available. We bring you the data to make better decisions before buying or grading.
              </p>
            </div>

            <div className="flex flex-col lg:flex-row gap-16 lg:gap-20 items-center">
              <div className="flex-1 space-y-8">
                <ul className="space-y-6">
                  {[
                    { icon: 'fa-chart-bar', text: 'Raw inventory valuation and graded market positioning quantified in a single report.' },
                    { icon: 'fa-arrows-left-right', text: 'Market spread analysis informs your decision before you commit capital. Certainty precedes expenditure.' },
                    { icon: 'fa-vault', text: 'Deeper market pricing is unlocked from the Secure Digital Vault on the Pro Credit System. One engagement. Full market depth.' },
                    { icon: 'fa-receipt', text: 'Valuation is indexed against the acquisition ledger and condition record for full portfolio management.' },
                  ].map(({ icon, text }, i) => (
                    <li key={i} className="flex items-start gap-5">
                      <div className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full mt-0.5" style={{ background: 'rgba(191,149,63,0.08)', border: '1px solid rgba(191,149,63,0.2)' }}>
                        <i className={`fas ${icon} text-[11px]`} style={{ color: '#D4AF37' }}></i>
                      </div>
                      <span className="text-base font-light leading-relaxed" style={{ color: '#cbd5e0' }}>{text}</span>
                    </li>
                  ))}
                </ul>
                <div className="pt-4">
                  <button type="button" onClick={() => document.getElementById('credits-and-drafts')?.scrollIntoView({ behavior: 'smooth' })}
                    className="py-4 px-10 font-sans font-bold uppercase tracking-[0.2em] text-[12px] transition-all text-black bg-gradient-to-r from-[#BF953F] via-[#E8C881] to-[#B38728] hover:from-[#D4AF37] hover:via-[#FCF6BA] hover:to-[#B38728]">
                    Review Pro Access <i className="fas fa-arrow-right ml-2 opacity-70"></i>
                  </button>
                  <p className="mt-4 text-[10px] tracking-widest font-bold uppercase" style={{ color: '#4a5568' }}>
                    Market values depend on available comps and card-specific sales data.
                  </p>
                </div>
              </div>

              <div className="w-full lg:w-[520px] shrink-0">
                {(() => {
                  const vc = valuationFeatured;
                  const psa10 = vc?.market?.psa10 ?? null;
                  const raw = vc?.market?.raw ?? null;
                  const spread = (psa10 && raw) ? (psa10 - raw) : null;
                  const fmtUSD = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                  return (
                    <div className="relative" style={{ filter: 'drop-shadow(0 32px 80px rgba(0,0,0,0.7)) drop-shadow(0 0 60px rgba(191,149,63,0.06))' }}>
                      <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg,transparent,#BF953F 30%,#FCF6BA 50%,#B38728 70%,transparent)' }}></div>
                      <div className="border border-white/10 overflow-hidden" style={{ background: 'linear-gradient(160deg,rgba(22,22,22,1) 0%,rgba(10,10,10,1) 100%)' }}>
                        <div className="flex items-stretch gap-0">
                          <div className="w-[130px] shrink-0 relative overflow-hidden" style={{ background: '#0a0a0a' }}>
                            {vc?.front_img ? (
                              <img src={vc.front_img} alt={vc.name}
                                className="w-full h-full object-contain p-3 opacity-90"
                                style={{ minHeight: '180px' }} />
                            ) : (
                              <div className="w-full h-[180px] flex items-center justify-center">
                                <i className="fas fa-image text-white/10 text-3xl"></i>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 p-7 border-l border-white/5 flex flex-col justify-center gap-2">
                            <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: '#D4AF37' }}>
                              {vc ? 'Real vault asset' : 'Loading...'}
                            </p>
                            <p className="font-black text-white text-base leading-tight truncate">{vc?.name ?? '--'}</p>
                            <p className="text-xs font-light" style={{ color: '#718096' }}>{[vc?.year, vc?.card_set].filter(Boolean).join(' · ')}</p>
                            <div className="flex items-center gap-3 mt-2 pt-3 border-t border-white/5">
                              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#4a5568' }}>RG Grade</span>
                              <span className="text-lg font-black text-white">{vc?.overall_grade ?? '--'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="h-px w-full" style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.05) 50%,transparent)' }}></div>

                        <div className="p-7 space-y-6">
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-[0.3em] mb-3" style={{ color: '#4a5568' }}>PSA 10 market</p>
                            {psa10 ? (
                              <div className="flex items-end gap-2">
                                <span className="font-black text-[clamp(2.4rem,7vw,3.8rem)] leading-none bg-gradient-to-b from-[#FCF6BA] via-[#C5A059] to-[#886b2b] text-transparent bg-clip-text" style={{ letterSpacing: '-0.02em' }}>
                                  ${psa10.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-sm font-bold mb-2" style={{ color: '#4a5568' }}>.00 USD</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <span className="text-3xl font-black" style={{ color: '#2d3748' }}>---</span>
                                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#4a5568' }}>No data yet</span>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 border border-white/5" style={{ background: 'rgba(255,255,255,0.025)' }}>
                              <p className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a5568' }}>Raw market</p>
                              <p className="text-xl font-black text-white/80">{raw ? fmtUSD(raw) : '--'}</p>
                            </div>
                            <div className="p-4 border border-white/5" style={{ background: 'rgba(255,255,255,0.025)' }}>
                              <p className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a5568' }}>Graded spread</p>
                              {spread ? (
                                <p className="text-xl font-black bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-transparent bg-clip-text">+{fmtUSD(spread)}</p>
                              ) : (
                                <p className="text-xl font-black text-white/20">--</p>
                              )}
                            </div>
                          </div>

                          <button type="button" onClick={() => document.getElementById('credits-and-drafts')?.scrollIntoView({ behavior: 'smooth' })}
                            className="w-full flex items-center justify-between gap-4 p-4 transition-all group"
                            style={{ background: 'linear-gradient(90deg,rgba(191,149,63,0.1),rgba(179,135,40,0.06))', border: '1px solid rgba(191,149,63,0.25)' }}>
                            <div className="flex items-center gap-3">
                              <i className="fas fa-gem text-sm" style={{ color: '#BF953F' }}></i>
                              <div className="text-left">
                                <p className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: '#D4AF37' }}>Pro credits</p>
                                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.38)' }}>Use one credit to unlock deeper market review.</p>
                              </div>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap group-hover:opacity-80 transition-opacity" style={{ color: '#D4AF37' }}>
                              View access <i className="fas fa-arrow-right ml-1"></i>
                            </span>
                          </button>
                        </div>
                      </div>
                      <div className="h-[1px] w-full" style={{ background: 'linear-gradient(90deg,transparent,rgba(191,149,63,0.3) 50%,transparent)' }}></div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-28 md:py-32 border-b relative overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'radial-gradient(circle at top right, rgba(191,149,63,0.08), transparent 30%), linear-gradient(180deg, #080808 0%, #111111 100%)' }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at left, rgba(153,0,0,0.08), transparent 28%)' }}></div>
          <div className="w-full max-w-6xl mx-auto px-6 relative z-10">
            <div className="max-w-[44rem] mb-16 md:mb-20">
              <p className="text-[9px] font-bold uppercase tracking-[0.38em] mb-4" style={{ color: '#D4AF37' }}>The Condition Report</p>
              <h2 className="font-serif font-medium text-white mb-5" style={{ fontSize: 'clamp(2.25rem,4.8vw,3.9rem)' }}>
                The Definitive Record. For Every Asset of Consequence.
              </h2>
              <p className="text-[1.02rem] sm:text-[1.12rem] font-light max-w-[39rem]" style={{ color: '#a0aec0', lineHeight: 1.92 }}>
                The Scan is the commencement. The Record is the asset: card identity, diagnostic subgrades, grader-band projections, flaw identification, and a permanent Secure Digital Vault reference. Transferable in resale. Authoritative in coverage review. Irrefutable in provenance.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[0.86fr_1.14fr] gap-14 lg:gap-20 items-center">
              <div>
                <div className="space-y-8 mb-10">
                  {[
                    {
                      title: 'Custody-Grade Documentation',
                      body: 'Card identity, high-resolution condition data, and grader-band projections consolidated in a single Condition Report — not scattered across notes, screenshots, or memory.'
                    },
                    {
                      title: 'Provenance Without Dilution',
                      body: 'The Graded Record transfers without degradation. Buyers, underwriters, and trade counterparties receive the full provenance chain via a permanent Secure Digital Vault reference.'
                    },
                    {
                      title: 'Perpetual Institutional Utility',
                      body: 'The Condition Report retains its authority beyond the initial decision. Secure digital vault entry, indemnity documentation, and future resale preparation. One record. Indefinite relevance.'
                    },
                  ].map(({ title, body }) => (
                    <div key={title} className="pt-6 border-t" style={{ borderColor: 'rgba(255,255,255,0.14)' }}>
                      <p className="text-[1.32rem] font-serif text-white mb-2.5">{title}</p>
                      <p className="font-light max-w-[25rem] text-[15px]" style={{ color: '#a0aec0', lineHeight: 1.8 }}>{body}</p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-4 items-center">
                  <button
                    type="button"
                    onClick={() => heroFeatured && handleSelectCertificate(heroFeatured.id)}
                    className="px-8 py-4 font-sans font-bold uppercase tracking-[0.18em] text-[12px] bg-white text-black hover:bg-gray-200 transition-all"
                  >
                    Inspect a Condition Report
                  </button>
                  <p className="text-[11px] uppercase tracking-[0.22em] font-bold" style={{ color: '#718096' }}>
                    Scan ID &middot; Subgrades &middot; Grader-Band Projections &middot; Provenance Chain
                  </p>
                </div>
              </div>

              <div className="relative">
                <div className="absolute -inset-5 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(191,149,63,0.16), transparent 60%)', opacity: 0.45 }}></div>
                <div className="relative border p-6 md:p-8" style={{ background: 'rgba(0,0,0,0.45)', borderColor: 'rgba(197,160,89,0.2)' }}>
                  <div className="border p-7 md:p-10" style={{ background: 'linear-gradient(180deg, #f5efe4 0%, #ece2cf 100%)', borderColor: 'rgba(62,42,10,0.18)', color: '#171717' }}>
                    <div className="flex items-start justify-between gap-4 pb-5 border-b" style={{ borderColor: 'rgba(23,23,23,0.12)' }}>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.32em]" style={{ color: '#72551a' }}>RawGraded condition record</p>
                        <p className="font-serif text-[1.6rem] leading-tight mt-2">{heroFeatured?.name ?? 'Sample Asset'}</p>
                        <p className="text-xs mt-2" style={{ color: '#5b5b5b' }}>{[heroFeatured?.year, heroFeatured?.card_set].filter(Boolean).join(' · ') || 'Certificate preview'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#5b5b5b' }}>Audit ID</p>
                        <p className="font-mono text-sm mt-2">#{heroFeatured?.id ?? 'Preview'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-6 border-b" style={{ borderColor: 'rgba(23,23,23,0.12)' }}>
                      {[
                        { label: 'Centering', value: heroFeatured?.centering ?? '--' },
                        { label: 'Corners', value: heroFeatured?.corners ?? '--' },
                        { label: 'Edges', value: heroFeatured?.edges ?? '--' },
                        { label: 'Surface', value: heroFeatured?.surface ?? '--' },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#72551a' }}>{label}</p>
                          <p className="text-lg font-semibold mt-2">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.2fr] gap-6 py-6 border-b" style={{ borderColor: 'rgba(23,23,23,0.12)' }}>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#72551a' }}>Likely result</p>
                        <p className="font-serif text-[2.6rem] leading-none mt-3">{heroFeatured?.overall_grade ?? '--'}</p>
                        <p className="text-xs mt-3" style={{ color: '#5b5b5b' }}>Pre-submission estimate based on the submitted imagery.</p>
                      </div>
                      <div className="space-y-3">
                        {[
                          { label: 'PSA band', value: heroFeatured?.predicted_grades?.psa ?? '--' },
                          { label: 'BGS band', value: heroFeatured?.predicted_grades?.bgs ?? '--' },
                          { label: 'CGC band', value: heroFeatured?.predicted_grades?.cgc ?? '--' },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0" style={{ borderColor: 'rgba(23,23,23,0.1)' }}>
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: '#5b5b5b' }}>{label}</p>
                            <p className="font-semibold">{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#72551a' }}>Verification</p>
                        <p className="text-sm mt-2" style={{ color: '#4d4d4d' }}>Shareable certificate link for review, listings, and ownership records.</p>
                      </div>
                      <p className="text-[11px] font-mono" style={{ color: '#4d4d4d' }}>rawgraded.com/c/{heroFeatured?.id ?? 'preview'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-20 md:py-24 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="w-full max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-[0.82fr_1.18fr] gap-12 lg:gap-16 items-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] mb-3" style={{ color: '#D4AF37' }}>Indemnity-Ready Scans</p>
              <h2 className="font-serif font-medium text-white mb-4" style={{ fontSize: 'clamp(1.95rem,4vw,3.1rem)' }}>
                The Standardized Record for High-Value Asset Protection.
              </h2>
              <p className="text-base sm:text-lg font-light max-w-xl mb-8" style={{ color: '#a0aec0', lineHeight: 1.85 }}>
                Our Indemnity-Ready Scan exports carry the full spectrum of data required by underwriters: verified asset identity, condition basis, ownership provenance, and current market valuation — in one portfolio-grade document.
              </p>
              <div className="space-y-4">
                {[
                  'Asset identity, condition basis, and current market valuation are consolidated in a single indemnity-grade export.',
                  'Ownership lineage, ledger annotations, and acquisition provenance remain immutably attached to the asset record.',
                  'A single document serves as the institutional standard for coverage review, secure vault entry, and portfolio stewardship.',
                ].map((item) => (
                  <div key={item} className="pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.14)' }}>
                    <p className="text-sm sm:text-base font-light" style={{ color: '#cbd5e0', lineHeight: 1.75 }}>{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="relative border p-5 md:p-7" style={{ background: 'rgba(0,0,0,0.28)', borderColor: 'rgba(197,160,89,0.18)' }}>
                <div className="border p-6 md:p-8" style={{ background: 'linear-gradient(180deg, #f5efe4 0%, #ece2cf 100%)', borderColor: 'rgba(62,42,10,0.18)', color: '#171717' }}>
                  <div className="flex items-start justify-between gap-4 pb-5 border-b" style={{ borderColor: 'rgba(23,23,23,0.12)' }}>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.32em]" style={{ color: '#72551a' }}>Insurance ledger example</p>
                      <p className="font-serif text-[1.5rem] leading-tight mt-2">{ledgerPreviewCard?.name ?? 'Sample asset'}</p>
                      <p className="text-xs mt-2" style={{ color: '#5b5b5b' }}>
                        {[ledgerPreviewCard?.card_set, ledgerPreviewCard?.year].filter(Boolean).join(' / ') || 'Private collection record'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#5b5b5b' }}>Export scope</p>
                      <p className="font-mono text-sm mt-2">1 asset</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-6 border-b" style={{ borderColor: 'rgba(23,23,23,0.12)' }}>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#72551a' }}>Likely grade</p>
                      <p className="text-2xl font-serif mt-2">{ledgerPreviewCard?.overall_grade ?? '--'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#72551a' }}>Estimated market value</p>
                      <p className="text-2xl font-serif mt-2">{formatUsdExact(ledgerPreviewMarketValue)}</p>
                    </div>
                  </div>

                  <div className="py-6 border-b" style={{ borderColor: 'rgba(23,23,23,0.12)' }}>
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.24em] mb-4" style={{ color: '#72551a' }}>Ledger excerpt</h3>
                    <table className="w-full text-sm">
                      <tbody className="divide-y" style={{ borderColor: 'rgba(23,23,23,0.08)' }}>
                        <tr>
                          <td className="py-2 font-bold uppercase text-[10px]" style={{ color: '#5b5b5b' }}>Purchase price</td>
                          <td className="py-2 text-right">
                            <span className="inline-flex items-center justify-center min-w-[6.5rem] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] rounded-[2px] bg-black text-white">
                              Private
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 font-bold uppercase text-[10px]" style={{ color: '#5b5b5b' }}>Market estimate</td>
                          <td className="py-2 text-right font-black">{formatUsdExact(ledgerPreviewMarketValue)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 font-bold uppercase text-[10px]" style={{ color: '#5b5b5b' }}>Condition basis</td>
                          <td className="py-2 text-right font-black">RawGraded scan record</td>
                        </tr>
                        <tr>
                          <td className="py-2 font-bold uppercase text-[10px]" style={{ color: '#5b5b5b' }}>Supporting files</td>
                          <td className="py-2 text-right font-black">Ledger / condition report / notes</td>
                        </tr>
                        <tr>
                          <td className="py-2 font-bold uppercase text-[10px]" style={{ color: '#5b5b5b' }}>Last reviewed</td>
                          <td className="py-2 text-right font-black">{formatShortDate(ledgerPreviewCard?.date_scanned)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 font-bold uppercase text-[10px]" style={{ color: '#5b5b5b' }}>Record type</td>
                          <td className="py-2 text-right font-black">Insurance-ready ledger</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#72551a' }}>Ledger note</p>
                      <p className="text-sm mt-2" style={{ color: '#4d4d4d' }}>Built to keep coverage context, supporting records, and market reference in one export.</p>
                    </div>
                    <p className="text-[11px] font-mono" style={{ color: '#4d4d4d' }}>rawgraded.com / ledger export</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-22 md:py-26 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="w-full max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-14 lg:gap-20 items-start">
            <div className="space-y-12">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.36em] mb-4" style={{ color: '#D4AF37' }}>Portfolio Management &amp; Secure Vault</p>
                <h2 className="font-serif font-medium text-white mb-5" style={{ fontSize: 'clamp(2rem,4.1vw,3.2rem)' }}>
                  Your Collection, Managed with the Care of a Private Fund.
                </h2>
                <p className="text-[1rem] sm:text-[1.08rem] font-light max-w-[38rem] mb-10" style={{ color: '#a0aec0', lineHeight: 1.88 }}>
                  The Platform does not simply scan and forget. We carry the record forward: secure vault controls, a definitive public archive, curated private exhibitions, provenance tracking, and insurance documentation that travels with the card.
                </p>
                <div className="flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={() => setStep(AppStep.ARCHIVE)}
                    className="text-[12px] font-sans font-bold uppercase tracking-[0.18em] transition-all"
                    style={{ color: '#D4AF37' }}
                  >
                    Explore Public Archive <i className="fas fa-arrow-right ml-2"></i>
                  </button>
                  {user && (
                    <button
                      type="button"
                      onClick={() => goToPlatformStep(AppStep.COLLECTION)}
                      className="text-[12px] font-sans font-bold uppercase tracking-[0.18em] transition-all"
                      style={{ color: '#ffffff' }}
                    >
                      Open My Vault <i className="fas fa-arrow-right ml-2"></i>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-8">
                {[
                  {
                    title: 'Private Vault Controls',
                    body: 'Acquisition cost, condition history, ownership lineage, and custody notes — all held within a controlled, secure portfolio environment.'
                  },
                  {
                    title: 'The Official Public Archive',
                    body: 'Selectively publish recorded assets to the permanent public archive when verifiability and discoverability serve your interests.'
                  },
                  {
                    title: 'Curated Private Exhibitions',
                    body: 'Commission an exclusive, invitation-only gallery with a dedicated Secure Digital Vault link — a curated display of your finest assets for private exhibition.'
                  },
                  {
                    title: 'Secure Disclosure Controls',
                    body: 'Determine which recorded assets attain public visibility and which remain within the private vault — on a per-asset basis.'
                  },
                  {
                    title: 'Insurance Documentation',
                    body: 'Retain acquisition receipts, insurance ledgers, and market valuation context securely attached to the asset record — never fragmented.'
                  },
                  {
                    title: 'Ownership & Provenance Tracking',
                    body: 'Link the official PSA certification back to the pre-submission RawGraded scan. The complete chain of custody — from raw card to graded slab — archived in perpetuity.'
                  },
                ].map(({ title, body }) => (
                  <div key={title} className="pt-5 border-t" style={{ borderColor: 'rgba(255,255,255,0.14)' }}>
                    <p className="text-[1.1rem] font-serif text-white mb-2">{title}</p>
                    <p className="font-light text-[14px] max-w-[18rem]" style={{ color: '#a0aec0', lineHeight: 1.72 }}>{body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <div className="relative border overflow-hidden" style={{ background: 'linear-gradient(180deg, #070707 0%, #0b0b0b 100%)', borderColor: 'rgba(197,160,89,0.18)' }}>
                <div className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(197,160,89,0.6), transparent)' }}></div>
                <div className="p-7 md:p-10">
                  <div className="text-center mb-8">
                    <p className="text-[10px] font-bold uppercase tracking-[0.32em]" style={{ color: '#D4AF37' }}>Curated Private Exhibitions</p>
                    <h3 className="font-serif text-white mt-3" style={{ fontSize: 'clamp(1.4rem,2.8vw,2.15rem)' }}>
                      An Exclusive Gallery for Private Exhibition.
                    </h3>
                    <p className="text-[11px] uppercase tracking-[0.22em] mt-3" style={{ color: '#718096' }}>
                      Crown Jewel Placement &middot; Curated Gallery &middot; Vault Disclosure Controls
                    </p>
                  </div>

                  <div className="flex justify-center mb-10">
                    <div className="w-full max-w-[220px]">
                      <div className="text-center mb-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: '#D4AF37' }}>The crown jewel</p>
                      </div>
                      <div className="relative border p-3" style={{ borderColor: 'rgba(212,175,55,0.45)', background: 'linear-gradient(180deg, rgba(212,175,55,0.12), rgba(0,0,0,0.4))', boxShadow: '0 22px 60px rgba(0,0,0,0.55)' }}>
                        <div className="absolute -inset-3 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.14), transparent 65%)' }}></div>
                        <div className="relative aspect-[0.72] flex items-center justify-center overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)' }}>
                          {displayVaultBaseCard?.front_img ? (
                            <img src={displayVaultBaseCard.front_img} alt={displayVaultBaseCard.name} className="w-full h-full object-contain" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <i className="fas fa-image text-white/10 text-3xl"></i>
                            </div>
                          )}
                        </div>
                        <div className="relative pt-4 text-center">
                          <p className="font-black text-white uppercase tracking-[0.14em] text-sm truncate">{displayVaultBaseCard?.name ?? 'Champion asset'}</p>
                          <p className="text-[10px] uppercase tracking-[0.22em] mt-2" style={{ color: '#718096' }}>
                            {[displayVaultBaseCard?.year, displayVaultBaseCard?.card_set].filter(Boolean).join(' / ') || 'Display vault preview'}
                          </p>
                          <div className="mt-4 inline-flex items-center gap-2 border px-4 py-2" style={{ borderColor: 'rgba(212,175,55,0.32)', background: 'rgba(0,0,0,0.45)' }}>
                            <i className="fas fa-crown text-[10px]" style={{ color: '#D4AF37' }}></i>
                            <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: '#D4AF37' }}>Grade 10 champion</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {displayVaultPreviewGrades.slice(1).map(({ grade, role }, index) => (
                        <div key={`${role}-${grade}-${index}`} className="group">
                          <div className="border p-2" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)' }}>
                            <div className="aspect-[0.72] flex items-center justify-center overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)' }}>
                              {displayVaultBaseCard?.front_img ? (
                                <img src={displayVaultBaseCard.front_img} alt={`${displayVaultBaseCard.name} grade ${grade}`} className="w-full h-full object-contain opacity-95" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <i className="fas fa-image text-white/10 text-2xl"></i>
                                </div>
                              )}
                            </div>
                            <div className="pt-3 text-center">
                              <p className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: '#718096' }}>{role}</p>
                              <p className="font-serif text-white text-xl mt-2">{grade}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-22 md:py-26 border-b relative overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)', background: '#0a0a0a' }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at right, rgba(191,149,63,0.05), transparent 40%)' }}></div>
          <div className="w-full max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-14 lg:gap-20 items-center relative z-10">

            <div className="order-2 lg:order-1 relative">
              <div className="relative border p-6 md:p-8" style={{ background: 'rgba(0,0,0,0.4)', borderColor: 'rgba(197,160,89,0.15)' }}>
                <div className="border p-8 md:p-10" style={{ background: 'linear-gradient(180deg, #111111 0%, #080808 100%)', borderColor: 'rgba(255,255,255,0.06)' }}>

                  <div className="flex items-center gap-4 border-b pb-6" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                    <div className="w-12 h-12 rounded-full border flex items-center justify-center shrink-0" style={{ borderColor: 'rgba(212,175,55,0.3)', background: 'rgba(212,175,55,0.08)' }}>
                      <i className="fas fa-shield-alt text-lg" style={{ color: '#D4AF37' }}></i>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.32em]" style={{ color: '#D4AF37' }}>Anti-Piracy Shield</p>
                      <p className="font-serif text-white text-xl mt-1">Status: Protected</p>
                    </div>
                  </div>

                  <div className="py-6 space-y-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#a0aec0' }}>Public Listing</p>
                      <p className="text-xs font-mono" style={{ color: '#e53e3e' }}>Restricted</p>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#a0aec0' }}>Image Extraction</p>
                      <p className="text-xs font-mono" style={{ color: '#e53e3e' }}>Blocked</p>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#a0aec0' }}>Ownership</p>
                      <p className="text-xs font-mono" style={{ color: '#D4AF37' }}>Verified</p>
                    </div>
                  </div>

                  <div className="pt-6">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: '#718096' }}>Registry Handshake</p>
                    <p className="text-sm font-light leading-relaxed" style={{ color: '#a0aec0' }}>
                      When marked sold, custody safely transfers. The buyer receives full digital custody; the seller retains a shadow receipt for provenance. No private data is ever leaked.
                    </p>
                  </div>

                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.38em] mb-4" style={{ color: '#D4AF37' }}>Slab Anti-Piracy</p>
              <h2 className="font-serif font-medium text-white mb-5" style={{ fontSize: 'clamp(2rem,4vw,3.1rem)', lineHeight: 1.1 }}>
                Secure Your Slab.<br />Protect Your Provenance.
              </h2>
              <p className="text-[1rem] sm:text-[1.08rem] font-light max-w-[38rem] mb-8" style={{ color: '#a0aec0', lineHeight: 1.88 }}>
                The public display of high-value certificates is tightly controlled. Slabs not explicitly marked for sale are heavily protected from scraping, preventing piracy and unauthorized forgery.
              </p>
              <div className="space-y-4">
                {[
                  'Asset Protection: Restricts the public generation of high-res slab scans to prevent image theft.',
                  'Secure Transfers: New owners can instantly claim custody of the digital record via a free account.',
                  'Permanent Lineage: Sellers maintain an immutable transaction record while buyers start their own—with zero private data exposed.'
                ].map((item, i) => (
                  <div key={i} className="pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.14)' }}>
                    <p className="text-sm sm:text-[15px] font-light" style={{ color: '#cbd5e0', lineHeight: 1.75 }}>{item}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </section>

        <section className="w-full py-18 md:py-22 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="w-full max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-[0.82fr_1.18fr] gap-12 lg:gap-18 items-start">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.38em] mb-4" style={{ color: '#D4AF37' }}>On the Record</p>
              <h2 className="font-serif font-medium text-white mb-4" style={{ fontSize: 'clamp(1.95rem,4vw,3rem)' }}>
                Pre-Submission Intelligence.
              </h2>
              <p className="text-[1rem] sm:text-[1.08rem] font-light max-w-[38rem]" style={{ color: '#a0aec0', lineHeight: 1.86 }}>
                RawGraded does not replace official certification. It governs the pre-submission decision with precision and preserves a structured provenance record at every stage of the asset's lifecycle.
              </p>
              <div className="space-y-4 mt-9">
                {[
                  'A clear scan creates a reliable, repeatable record you can reference anytime. Memories fade; a Condition Report persists.',
                  'The accuracy of our AI depends entirely on the quality of your scan. You control the capture; we provide the standard.',
                  'Your record stays with you—useful for personal tracking, insurance filing, or providing details to future buyers.',
                ].map((item) => (
                  <div key={item} className="pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.14)' }}>
                    <p className="text-[14px] sm:text-[15px] font-light max-w-[34rem]" style={{ color: '#cbd5e0', lineHeight: 1.72 }}>{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              {[
                {
                  q: 'Why not just eyeball it?',
                  a: 'Our AI provides an unbiased Condition Report with specific subgrades and estimates, giving you a baseline rather than just a guess.'
                },
                {
                  q: 'Why should I scan my cards?',
                  a: 'Because it gives you a recorded baseline. You won\'t have to guess or remember a card\'s condition years down the line.'
                },
                {
                  q: 'Does this replace grading companies like PSA?',
                  a: 'No. RawGraded is a tool to help you decide what to send to PSA, BGS, or CGC. We help you screen your cards before paying grading fees.'
                },
                {
                  q: 'How accurate is the AI?',
                  a: 'Our models are trained on established grading standards, but they aren\'t guaranteed to match exactly. The accuracy depends heavily on the lighting and clarity of the photos you upload.'
                },
              ].map(({ q, a }) => (
                <div key={q} className="pt-6 border-t first:pt-0 first:border-t-0" style={{ borderColor: 'rgba(255,255,255,0.14)' }}>
                  <p className="text-[1.24rem] font-serif text-white mb-3">{q}</p>
                  <p className="font-light text-[15px] max-w-[37rem]" style={{ color: '#a0aec0', lineHeight: 1.74 }}>{a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="credits-and-drafts" role="region" aria-labelledby="credits-heading" className="w-full px-6 py-20 md:py-24 border-b" style={{ background: '#111111', borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="w-full max-w-4xl mx-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-center mb-6" style={{ color: '#a0aec0' }}>Onboarding Process</p>
            <h2 id="credits-heading" className="text-center font-serif font-medium mb-4 leading-tight" style={{ fontSize: 'clamp(1.8rem,4vw,3rem)', color: '#ffffff' }}>
              Select Your Tier of Access.
            </h2>
            <p className="text-center text-base max-w-2xl mx-auto mb-16 font-medium" style={{ color: '#718096', lineHeight: 1.8 }}>
              Membership unlocks the full workflow after a short application. Use weekly free scans during your trial, add Pro Credits for priority runs and deeper market context, and keep access current with a recurring plan.
            </p>

            {user && user.role !== 'admin' && (
              <div className="flex flex-wrap items-center justify-center gap-4 mb-10 p-5 border-y" style={{ background: 'transparent', borderColor: 'rgba(255,255,255,0.1)' }}>
                <span className="text-sm font-bold uppercase tracking-wider" style={{ color: '#a0aec0' }}>
                  Pro credit balance: <span className="font-bold" style={{ color: '#ffffff' }}>{user.paid_credits ?? 0}</span>
                </span>
                <button type="button" onClick={() => setIsShopOpen(true)} className="flex items-center gap-2 py-3 px-6 font-sans font-bold uppercase tracking-[0.2em] text-[13px] transition-all bg-white text-black hover:bg-gray-200">
                  <i className="fas fa-arrow-right"></i> {shopCtaLabel}
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
              <div className="p-8 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.1)' }}>
                <p className="text-[10px] font-sans font-bold uppercase tracking-[0.2em] mb-3" style={{ color: '#718096' }}>Basic Access</p>
                <p className="text-3xl font-serif font-medium text-white mb-2">Free</p>
                <p className="text-sm mb-6" style={{ color: '#718096' }}>Core scans during your membership trial; archive and tools follow the same access rules.</p>
                <ul className="space-y-3 mb-8">
                  {['Weekly free scans', 'Full AI grade & sub-grades', 'Public archive & vault', 'Shareable certificate links', 'PSA / BGS / CGC prediction'].map(item => (
                    <li key={item} className="flex items-center gap-3 text-sm font-medium" style={{ color: '#a0aec0' }}>
                      <i className="fas fa-check text-xs" style={{ color: '#990000' }}></i> {item}
                    </li>
                  ))}
                  {['Skip queue', 'Save draft anytime', 'Sniper listing assessment', 'Envelope & invoice scanner'].map(item => (
                    <li key={item} className="flex items-center gap-3 text-sm font-medium" style={{ color: '#4a5568' }}>
                      <i className="fas fa-times text-xs"></i> {item}
                    </li>
                  ))}
                </ul>
                {!user && (
                  <button type="button" onClick={() => { setAuthInitialMode('signup'); setIsAuthOpen(true); }}
                    className="w-full py-3 rounded-sm font-sans font-semibold uppercase tracking-[0.2em] text-[13px] border border-white/20 transition-all hover:bg-white hover:text-black"
                    style={{ color: '#ffffff', background: 'transparent' }}>
                    Start Free
                  </button>
                )}
              </div>

              <div className="p-8 relative overflow-hidden group border" style={{ background: '#050505', borderColor: 'rgba(255,255,255,0.2)' }}>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{ background: 'linear-gradient(135deg,transparent 0%,rgba(255,255,255,0.02) 40%,rgba(255,255,255,0.05) 50%,rgba(255,255,255,0.02) 60%,transparent 100%)' }}></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#D4AF37' }}>Pro Credits</p>
                    <div className="h-1 w-1 rounded-full bg-[#B38728]"></div>
                  </div>
                  <p className="text-3xl font-serif font-medium mb-1 bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-transparent bg-clip-text">Pro Credits</p>
                  <p className="text-sm mb-6" style={{ color: '#a0aec0' }}>Queue priority, deeper market review, and more complete workflow support when you need it.</p>
                  <ul className="space-y-3 mb-8">
                    {['Everything in Basic', 'Skip the queue and start immediately', 'Unlock live market values & historical data', 'Save draft and resume later', 'Up to 3 re-analyses per credit', 'Sniper v1.2 listing assessment', 'Envelope & invoice auto-fill', 'Add Custom Display Vaults', 'Add Showcase Customizations', 'One-time Pro Credits stack with membership'].map(item => (
                      <li key={item} className="flex items-center gap-3 text-sm font-light" style={{ color: '#e2e8f0' }}>
                        <div className="h-1 w-1 rounded-full flex-shrink-0 bg-gradient-to-r from-[#BF953F] to-[#B38728]"></div> <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => setIsShopOpen(true)}
                    className="w-full py-4 font-sans font-bold uppercase tracking-[0.2em] text-[13px] transition-all text-black bg-gradient-to-r from-[#BF953F] via-[#E8C881] to-[#B38728] hover:from-[#D4AF37] hover:via-[#FCF6BA] hover:to-[#B38728]">
                    View Pro Credits
                  </button>
                  <p className="text-center text-[10px] font-bold mt-4 uppercase tracking-widest" style={{ color: '#4a5568' }}>
                    Recurring membership &middot; Pro Credits optional add-ons
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-7 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.1)' }}>
                <h3 className="text-base font-bold uppercase tracking-wider mb-3" style={{ color: '#ffffff' }}>Save Draft &amp; Re-Scans</h3>
                <p className="text-base font-light mb-3" style={{ color: '#a0aec0', lineHeight: 1.7 }}>
                  Pause anytime. Resume from <strong style={{ color: '#ffffff' }}>My Vault &rarr; Drafts</strong>. One credit. Three analyses.
                </p>
                <a href="mailto:support@rawgraded.com" className="text-sm font-bold border-b border-transparent hover:border-white" style={{ color: '#718096' }}>support@rawgraded.com</a>
              </div>
              <div className="p-7 border" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.1)' }}>
                <h3 className="text-base font-bold uppercase tracking-wider mb-3" style={{ color: '#ffffff' }}>Envelope &amp; Invoice Scanner</h3>
                <p className="text-base font-light" style={{ color: '#a0aec0', lineHeight: 1.7 }}>
                  Snap envelope or receipt. Auto-fill price, source, and tracking while the scan runs, then keep the record inside your collection workflow.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-24 md:py-28 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at top, rgba(191,149,63,0.08), transparent 40%), radial-gradient(circle at bottom, rgba(153,0,0,0.08), transparent 35%)' }}></div>
          <div className="w-full max-w-5xl mx-auto px-6 text-center">
            <p className="text-[9px] font-bold uppercase tracking-[0.38em] mb-4" style={{ color: '#D4AF37' }}>The Platform Awaits</p>
            <h2 className="font-serif font-medium text-white mb-5" style={{ fontSize: 'clamp(2rem,4.2vw,3rem)' }}>
              Start Your First Assessment.
            </h2>
            <p className="text-[1rem] sm:text-[1.08rem] font-light max-w-[40rem] mx-auto mb-11" style={{ color: '#a0aec0', lineHeight: 1.88 }}>
              Apply for membership, start your 7-day trial, then keep full access on a plan that fits how often you grade. The public archive stays open for discovery.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3 mb-11 text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: '#718096' }}>
              <span>Condition Assessment</span>
              <span>Market Insights</span>
              <span>Definitive Condition Report</span>
              <span>Provenance Tracking</span>
            </div>
            <div className="flex flex-wrap gap-4 justify-center">
              <button
                type="button"
                onClick={() => document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-8 py-4 font-sans font-bold uppercase tracking-[0.18em] text-[12px] bg-white text-black hover:bg-gray-200 transition-all"
              >
                Begin Condition Scan
              </button>
              <button
                type="button"
                onClick={() => heroFeatured && handleSelectCertificate(heroFeatured.id)}
                className="px-8 py-4 font-sans font-bold uppercase tracking-[0.18em] text-[12px] border border-white/20 text-white hover:bg-white hover:text-black transition-all"
              >
                View Sample Certificate
              </button>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] font-bold uppercase tracking-[0.2em]">
              <button
                type="button"
                onClick={() => setStep(AppStep.ARCHIVE)}
                style={{ color: '#D4AF37' }}
              >
                Explore Public Archive
              </button>
              {user && (
                <button
                  type="button"
                  onClick={() => goToPlatformStep(AppStep.COLLECTION)}
                  style={{ color: '#ffffff' }}
                >
                  Open My Vault
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ——— END HOMEPAGE ——— */
/* Note: luxury marketing sections removed */}
      </div>
    );
  };

  const isCreditChoiceOnly = !cardData.userGrade && !isAnalyzing && cardData.frontCropped && cardData.backCropped;

  const renderAnalysisStep = () => {
    if (isCreditChoiceOnly && user) {
      const freeRemaining = user.role !== 'admin' ? Math.max(0, user.scan_limit - (user.scans_this_week ?? 0)) : 0;
      const paidRemaining = user.role !== 'admin' ? (user.paid_credits ?? 0) : 0;
      const hasAnyCredit = freeRemaining > 0 || paidRemaining > 0;
      return (
        <div className="w-full max-w-xl mx-auto p-6 animate-fade-in">
          <div className="bg-[#0a0a0a] p-8 rounded-sm border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] text-center space-y-6">
            <h2 className="text-xl font-black text-[#D4AF37] flex items-center justify-center gap-2 uppercase tracking-widest">
              <i className="fas fa-microchip"></i> Run this scan
            </h2>
            <p className="text-sm text-white/50">Choose how to use your credit for this analysis.</p>
            {user.role === 'admin' && (
              <button
                type="button"
                onClick={() => { setAnalysisError(null); runAnalysis(cardData.frontCropped!, cardData.backCropped!, cardData.videoFrames || [], false); }}
                className="w-full py-4 px-5 rounded-none border border-[#BF953F]/40 bg-[#BF953F]/10 hover:bg-[#BF953F]/20 font-black text-[#D4AF37] uppercase tracking-widest text-sm transition-all"
              >
                Run analysis
              </button>
            )}
            {user.role !== 'admin' && hasAnyCredit && (
              <div className="flex flex-col sm:flex-row gap-3">
                {freeRemaining > 0 && (
                  <button
                    type="button"
                    onClick={() => { setAnalysisError(null); runAnalysis(cardData.frontCropped!, cardData.backCropped!, cardData.videoFrames || [], false); }}
                    className="flex-1 py-4 px-5 rounded-none border border-white/20 bg-white/5 hover:bg-white/10 font-black text-white uppercase tracking-widest text-sm transition-all"
                  >
                    Run with free credit (45s wait, then queue)
                  </button>
                )}
                {paidRemaining > 0 && (
                  <button
                    type="button"
                    onClick={() => { setAnalysisError(null); runAnalysis(cardData.frontCropped!, cardData.backCropped!, cardData.videoFrames || [], true); }}
                    className="flex-1 py-4 px-5 rounded-none border border-[#BF953F]/40 bg-[#BF953F]/10 hover:bg-[#BF953F]/20 text-[#D4AF37] font-black uppercase tracking-widest text-sm transition-all"
                  >
                    Run with pro credit (skip wait)
                  </button>
                )}
              </div>
            )}
            {user.role !== 'admin' && !hasAnyCredit && (
              <div className="space-y-4">
                <p className="text-sm font-bold text-[#D4AF37]">No credits remaining. Buy pro scan packs to continue.</p>
                <button
                  type="button"
                  onClick={() => setIsShopOpen(true)}
                  className="w-full py-4 px-5 rounded-none border border-[#BF953F]/40 bg-[#BF953F]/10 hover:bg-[#BF953F]/20 font-black text-[#D4AF37] uppercase tracking-widest text-sm transition-all"
                >
                  <i className="fas fa-shopping-cart mr-2"></i> {shopCtaLabel}
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="w-full max-w-6xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fade-in">
        <div className="space-y-4">
          <h2 className="text-2xl font-black text-[#D4AF37] flex items-center gap-2 uppercase tracking-widest">
            <i className="fas fa-ruler-combined"></i> Inspection
          </h2>
          <div className="bg-[#0a0a0a] rounded-none overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-2 border border-white/10 h-[600px]">
            {cardData.frontCropped && <RulerOverlay imageSrc={cardData.frontCropped} />}
          </div>
          {(cardData.videoRaw || (cardData.videoFrames?.length ?? 0) > 0) && (
            <div className="bg-[#0a0a0a] rounded-none overflow-hidden p-4 border border-white/10">
              <h3 className="text-sm font-bold text-white/50 mb-2 uppercase">Video Evidence</h3>
              {cardData.videoRaw && !videoPreviewFailed ? (
                <video
                  src={cardData.videoRaw}
                  controls
                  className="w-full rounded max-h-60 mx-auto shadow-inner"
                  onError={() => setVideoPreviewFailed(true)}
                />
              ) : (
                <>
                  <p className="text-xs text-white/40 mb-2">
                    {cardData.videoFrames?.length
                      ? `${cardData.videoFrames.length} frame(s) captured for forensic analysis.`
                      : 'Video preview unavailable; evidence still used for analysis.'}
                  </p>
                  {cardData.videoFrames?.length ? (
                    <img
                      src={cardData.videoFrames[0]}
                      alt="First forensic frame"
                      className="w-full rounded max-h-60 mx-auto shadow-inner object-contain bg-[#0a0a0a]"
                    />
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-[#D4AF37] flex items-center gap-2">
            <i className="fas fa-microchip"></i> AI Analysis
          </h2>

          <div className="bg-[#0a0a0a] p-6 rounded-none space-y-6 border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            {/* === ERROR STATE === */}
            {analysisError && (
              <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-none p-5 space-y-4 animate-fade-in">
                <div className="flex items-start gap-3">
                  <i className="fas fa-exclamation-triangle text-[#D4AF37] text-xl mt-0.5 flex-shrink-0"></i>
                  <div>
                    <p className="text-[#D4AF37] font-black text-sm uppercase tracking-wider mb-1">Analysis Failed</p>
                    <p className="text-amber-200 text-xs leading-relaxed">{analysisError}</p>
                    <p className="text-[#D4AF37] text-[10px] mt-2 uppercase tracking-wider">Timeouts or forensics hangups can be retried with Reanalyze.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(AppStep.VIDEO_CAPTURE)}
                    className="flex-1 bg-[#0a0a0a] hover:bg-[#111111] text-[#D4AF37] text-xs font-black uppercase tracking-widest py-3 rounded-lg border-2 border-amber-500/30 transition-all flex items-center justify-center gap-2"
                  >
                    <i className="fas fa-arrow-left"></i> Go Back &amp; Retry
                  </button>
                  <button
                    onClick={() => {
                      setAnalysisError(null);
                      if (cardData.frontCropped && cardData.backCropped) {
                        const usePaid = (cardData as any)._draftMeta?.credit_type === 'paid' && (user?.paid_credits ?? 0) > 0;
                        runAnalysis(cardData.frontCropped, cardData.backCropped, cardData.videoFrames || [], usePaid);
                      } else {
                        alert("Missing image data. Please go back and recapture.");
                        setStep(AppStep.UPLOAD);
                      }
                    }}
                    className="flex-1 bg-poke-accent/10 hover:bg-poke-accent/20 text-poke-accent hover:text-white text-xs font-black uppercase tracking-widest py-3 rounded-lg border border-poke-accent/30 transition-all flex items-center justify-center gap-2"
                  >
                    <i className="fas fa-sync-alt"></i> Reanalyze
                  </button>
                </div>
              </div>
            )}

            {/* Save draft + Shop: visible before and during assessment (pro can save anytime, including mid-scan; free see teaser) */}
            {user && cardData.frontCropped && cardData.backCropped && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {(() => {
                  const canSaveDraft = user.role === 'admin' || (cardData as any)._draftMeta?.credit_type === 'paid';
                  const proScansUsed = (cardData as any)._draftMeta?.credit_type === 'paid' && ((cardData as any)._draftMeta?.reanalysis_count ?? 0) >= 2;
                  const hasEvidence = cardData.frontCropped && cardData.backCropped;
                  const disabled = !canSaveDraft || proScansUsed || !hasEvidence;
                  return (
                    <button
                      type="button"
                      onClick={canSaveDraft && !proScansUsed && hasEvidence ? saveDraft : undefined}
                      disabled={disabled}
                      className={`py-2.5 px-4 rounded-none font-bold text-sm uppercase tracking-wider transition-all flex items-center gap-2 ${canSaveDraft && !proScansUsed && hasEvidence ? 'bg-[#BF953F]/10 border border-[#BF953F]/40 text-[#D4AF37] hover:bg-[#BF953F]/20' : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'}`}
                    >
                      <i className="fas fa-save"></i> Save draft
                      {!canSaveDraft && <span className="bg-white/20 text-white/50 text-[10px] px-1.5 py-0.5 rounded font-black">Pro run only</span>}
                    </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => setIsShopOpen(true)}
                  className="py-2.5 px-4 rounded-none border border-[#BF953F]/40 bg-[#BF953F]/10 hover:bg-[#BF953F]/20 text-[#D4AF37] font-bold text-sm uppercase tracking-wider transition-all flex items-center gap-2"
                >
                  <i className="fas fa-shopping-cart"></i> {shopCtaLabel}
                </button>
              </div>
            )}

            {isAnalyzing && (
              <div className="flex flex-col items-center justify-center p-8 bg-white/5 rounded-none border border-white/10 animate-pulse mb-6">
                {(() => {
                  const isVipRun = user?.role === 'admin' || (cardData as any)._draftMeta?.credit_type === 'paid';
                  const isWaiting = analysisStatus.includes('left') || analysisStatus.includes('Bypass') || analysisStatus.includes('wait');
                  const subtitle = isWaiting
                    ? 'Waiting in line'
                    : analysisStatus.includes('VIP Pass')
                      ? 'Priority queue engaged'
                      : analysisStatus.includes('Identifying Asset')
                        ? 'Specimen acquisition'
                        : analysisStatus.includes('Analyzing Front')
                          ? 'Obverse surface analysis'
                          : analysisStatus.includes('Analyzing Back')
                            ? 'Reverse surface analysis'
                            : analysisStatus.includes('RawGrading')
                              ? 'Synthesizing final grade'
                              : analysisStatus.includes('Optimizing')
                                ? 'Preparing scan'
                                : 'Checking edges, surface & metadata';
                  return (
                    <>
                      <i className={`fa-solid ${isVipRun ? 'fa-crown' : 'fa-microchip'} fa-spin text-4xl mb-4 ${isVipRun ? 'text-amber-500' : 'text-[#D4AF37]'}`}></i>
                      <p className="text-lg font-black text-white uppercase tracking-widest">{analysisStatus}</p>
                      <p className="text-[10px] text-gray-400 mt-2 uppercase tracking-[0.3em]">{subtitle}</p>
                    </>
                  );
                })()}
                {/* Wait screen: Shop + optional skip with paid */}
                <div className="mt-6 flex flex-col gap-3 w-full max-w-sm">
                  {(analysisStatus.includes('left') || analysisStatus.includes('Bypass') || analysisStatus.includes('wait')) && (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsShopOpen(true)}
                        className="py-3 px-4 rounded-none border-2 border-poke-accent/50 bg-poke-accent/10 hover:bg-poke-accent/20 text-poke-accent font-bold uppercase tracking-wider text-sm"
                      >
                        {shopCtaLabel} — skip the wait
                      </button>
                      {(user?.paid_credits ?? 0) > 0 && (cardData as any)._draftMeta?.credit_type !== 'paid' && (
                        <button
                          type="button"
                          onClick={() => { skipWaitWithPaidRef.current = true; }}
                          className="py-3 px-4 rounded-none border-2 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 font-bold uppercase tracking-wider text-sm"
                        >
                          Use a pro credit to skip the wait
                        </button>
                      )}
                    </>
                  )}
                  {(user?.role === 'admin' || (cardData as any)._draftMeta?.credit_type === 'paid') && (
                    <button
                      type="button"
                      onClick={saveDraft}
                      className="py-3 px-4 rounded-none border-2 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 font-bold uppercase tracking-wider text-sm"
                    >
                      <i className="fas fa-save mr-2"></i> Save draft and resume later
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Early Card Identification Preview */}
            {cardData.metadata.name && (
              <div className="bg-white/5 p-4 rounded-none border border-white/10">
                <h3 className="text-xl font-black text-[#D4AF37] mb-1 flex items-center gap-2 uppercase tracking-widest">
                  <i className="fas fa-check-circle"></i> Card Identified
                </h3>
                <p className="text-sm text-white/60">
                  {cardData.metadata.name}{cardData.metadata.character && ` (${cardData.metadata.character})`}
                  {cardData.metadata.set && ` - ${cardData.metadata.set}`}
                </p>
              </div>
            )}

            {/* Card Metadata */}
            <div className="grid grid-cols-2 gap-4 border-b border-white/10 pb-4">
              {['name', 'character', 'set', 'edition', 'artist', 'cardNumber', 'year'].map(field => (
                <div key={field} className="space-y-1">
                  <label className="text-[10px] text-white/40 uppercase font-black tracking-widest">{field}</label>
                  <input
                    className="w-full bg-white/5 border border-white/10 p-2 rounded-lg text-white text-sm focus:border-[#BF953F]/50 outline-none transition-all placeholder-white/20"
                    value={(cardData.metadata as any)[field] || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCardData({ ...cardData, metadata: { ...cardData.metadata, [field]: e.target.value } })}
                    placeholder={`Detected ${field}...`}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-4 pb-4 border-b border-white/10">
              {/* First Edition Toggle */}
              <div className="space-y-1 flex flex-col justify-end">
                <label className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Special Printing</label>
                <button
                  type="button"
                  onClick={() => setCardData(prev => ({ ...prev, metadata: { ...prev.metadata, is_first_edition: prev.metadata.is_first_edition ? 0 : 1 } }))}
                  className={`w-full py-2 px-4 rounded-lg border font-bold text-sm tracking-wider uppercase transition-all flex items-center justify-center gap-2 ${cardData.metadata.is_first_edition ? 'bg-[#BF953F]/15 text-[#D4AF37] border-[#BF953F]/40 shadow-[0_0_15px_rgba(191,149,63,0.15)]' : 'bg-white/5 text-white/40 border-white/10 hover:border-white/20'}`}
                >
                  <i className={`fas fa-star ${cardData.metadata.is_first_edition ? 'animate-pulse' : 'opacity-50'}`}></i>
                  {cardData.metadata.is_first_edition ? '1st Edition Active' : 'Mark 1st Edition'}
                </button>
              </div>

              {/* Holographic Toggle */}
              <div className="space-y-1 flex flex-col justify-end">
                <label className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2 opacity-0 text-transparent select-none whitespace-nowrap overflow-hidden">Holo Toggle</label>
                <button
                  type="button"
                  onClick={() => setCardData(prev => {
                    const nextHolo = prev.metadata.is_holographic ? 0 : 1;
                    return {
                      ...prev,
                      metadata: {
                        ...prev.metadata,
                        is_holographic: nextHolo,
                        // If holo is turned off, clear pattern so stale value cannot leak into save.
                        holo_pattern: nextHolo ? (prev.metadata.holo_pattern || 'none') : 'none',
                      }
                    };
                  })}
                  className={`w-full py-2 px-4 rounded-lg border font-bold text-sm tracking-wider uppercase transition-all flex items-center justify-center gap-2 ${cardData.metadata.is_holographic ? 'bg-[#BF953F]/15 text-[#D4AF37] border-[#BF953F]/40 shadow-[0_0_15px_rgba(191,149,63,0.15)]' : 'bg-white/5 text-white/40 border-white/10 hover:border-white/20'}`}
                >
                  <i className={`fas fa-sparkles ${cardData.metadata.is_holographic ? 'animate-pulse' : 'opacity-50'}`}></i>
                  {cardData.metadata.is_holographic ? 'Holo Active' : 'Mark Holo'}
                </button>
              </div>

              {/* Rarity Dropdown & Input */}
              <div className="space-y-1">
                <label className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Rarity</label>
                <div className="relative">
                  <input
                    list="rarities"
                    className="w-full bg-white/5 border border-white/10 p-2 rounded-lg text-white text-sm focus:border-[#BF953F]/50 outline-none transition-all placeholder-white/20"
                    value={cardData.metadata.rarity || ''}
                    onChange={(e) => setCardData({ ...cardData, metadata: { ...cardData.metadata, rarity: e.target.value } })}
                    placeholder="Select or type..."
                  />
                  <datalist id="rarities">
                    <option value="Common" />
                    <option value="Uncommon" />
                    <option value="Rare" />
                    <option value="Holo Rare" />
                    <option value="Ultra Rare" />
                    <option value="Secret Rare" />
                    <option value="Illustration Rare" />
                    <option value="Special Illustration Rare" />
                    <option value="Promo" />
                    <option value="Base" />
                    <option value="Refractor" />
                  </datalist>
                  <i className="fas fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none text-xs"></i>
                </div>
              </div>
            </div>

            {Boolean(cardData.metadata.is_holographic) && (
              <div className="mt-3 p-3 border border-white/10 bg-white/5 rounded-lg">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[10px] text-white/40 uppercase font-bold tracking-wider">Holo Pattern</label>
                  {(!cardData.metadata.holo_pattern || cardData.metadata.holo_pattern === 'none') && (
                    <div className="text-[10px] text-[#D4AF37] font-black uppercase tracking-wider">
                      AI pattern unclear - choose one
                    </div>
                  )}
                </div>
                <select
                  value={cardData.metadata.holo_pattern || 'none'}
                  onChange={(e) => setCardData(prev => ({
                    ...prev,
                    metadata: { ...prev.metadata, holo_pattern: e.target.value }
                  }))}
                  className="mt-2 w-full bg-white/5 border border-white/10 p-2 rounded-lg text-white text-sm focus:border-[#BF953F]/50 outline-none transition-all"
                >
                  {HOLO_PATTERN_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="bg-white/5 p-4 rounded-none border border-white/10">
              <h3 className="text-xl font-black text-[#D4AF37] uppercase tracking-widest flex items-center gap-2">
                <i className="fas fa-brain"></i> AI Reasoning Analysis
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {['centering', 'corners', 'edges', 'surface'].map(key => (
                  <div key={key} className="space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-black tracking-widest">{key}</label>
                    <div className="flex items-center gap-2 bg-[#0a0a0a] border border-white/10 p-2 rounded-lg">
                      <div className="w-8 h-8 rounded-full bg-poke-blue flex items-center justify-center font-bold text-white text-xs">
                        {cardData.userGrade ? (cardData.userGrade as any)[key] : '-'}
                      </div>
                      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-poke-accent transition-all duration-1000"
                          style={{ width: `${cardData.aiGrade ? (cardData.aiGrade.overall / 10) * 100 : 0}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Category and Financial Tracking container path */}

            {/* Financial Tracking */}
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-[#D4AF37] uppercase tracking-widest flex items-center gap-2">
                  <i className="fas fa-dollar-sign"></i> Financial Tracking
                </h4>
                <button
                  onClick={() => setIsWizardOpen(true)}
                  className="bg-[#BF953F]/10 hover:bg-[#BF953F]/20 text-[#D4AF37] text-[10px] px-3 py-1 rounded-full border border-[#BF953F]/30 transition-all flex items-center gap-2 font-black"
                >
                  <i className="fas fa-calculator"></i> ACQUISITION WIZARD
                </button>
              </div>

              {/* Estimated Value */}
              <div className="space-y-1">
                <label className="text-[10px] text-white/40 uppercase font-black tracking-widest">Estimated Market Value (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full bg-white/5 border border-white/10 p-2 rounded-lg text-white text-sm focus:border-[#BF953F]/50 outline-none transition-all placeholder-white/20"
                  value={cardData.metadata.estimated_value || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCardData({ ...cardData, metadata: { ...cardData.metadata, estimated_value: parseFloat(e.target.value) || 0 } })}
                  placeholder="0.00"
                />
              </div>

              {/* Acquisition Details */}
              <details className="group">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg hover:bg-white/8 transition-all">
                    <span className="text-xs font-bold text-white/50 uppercase tracking-wide">Detailed Acquisition Data</span>
                    <i className="fas fa-chevron-down text-white/30 group-open:rotate-180 transition-transform"></i>
                  </div>
                </summary>
                <div className="grid grid-cols-2 gap-3 mt-3 p-3 bg-white/5 rounded-lg border border-white/10">
                  <div className="space-y-1">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Purchase Price</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full bg-white/5 border border-white/10 p-2 rounded text-white text-sm focus:border-[#BF953F]/50 outline-none"
                      value={cardData.acqPrice || ''}
                      onChange={(e) => setCardData({ ...cardData, acqPrice: parseFloat(e.target.value) || undefined })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Tax</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full bg-white/5 border border-white/10 p-2 rounded text-white text-sm focus:border-[#BF953F]/50 outline-none"
                      value={cardData.acqTax || ''}
                      onChange={(e) => setCardData({ ...cardData, acqTax: parseFloat(e.target.value) || undefined })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Shipping</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full bg-white/5 border border-white/10 p-2 rounded text-white text-sm focus:border-[#BF953F]/50 outline-none"
                      value={cardData.acqShipping || ''}
                      onChange={(e) => setCardData({ ...cardData, acqShipping: parseFloat(e.target.value) || undefined })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Purchase Date</label>
                    <input
                      type="date"
                      className="w-full bg-white/5 border border-white/10 p-2 rounded text-white text-sm focus:border-[#BF953F]/50 outline-none"
                      value={cardData.acqDate || ''}
                      onChange={(e) => setCardData({ ...cardData, acqDate: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Source / Seller</label>
                    <input
                      type="text"
                      className="w-full bg-white/5 border border-white/10 p-2 rounded text-white text-sm focus:border-[#BF953F]/50 outline-none"
                      value={cardData.acqSource || ''}
                      onChange={(e) => setCardData({ ...cardData, acqSource: e.target.value })}
                      placeholder="eBay, Local Shop, etc."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">City</label>
                    <input
                      type="text"
                      className="w-full bg-white/5 border border-white/10 p-2 rounded text-white text-sm focus:border-[#BF953F]/50 outline-none"
                      value={cardData.acqCity || ''}
                      onChange={(e) => setCardData({ ...cardData, acqCity: e.target.value })}
                      placeholder="Chicago"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Tracking Number</label>
                    <input
                      type="text"
                      className="w-full bg-white/5 border border-white/10 p-2 rounded text-white text-sm focus:border-[#BF953F]/50 outline-none font-mono"
                      value={cardData.acqTrackingNumber || ''}
                      onChange={(e) => setCardData({ ...cardData, acqTrackingNumber: e.target.value })}
                      placeholder="1Z999..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Order / Receipt ID</label>
                    <input
                      type="text"
                      className="w-full bg-white/5 border border-white/10 p-2 rounded text-white text-sm focus:border-[#BF953F]/50 outline-none font-mono"
                      value={cardData.acqOrderId || ''}
                      onChange={(e) => setCardData({ ...cardData, acqOrderId: e.target.value })}
                      placeholder="123-456..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">State</label>
                    <input
                      type="text"
                      className="w-full bg-white/5 border border-white/10 p-2 rounded text-white text-sm focus:border-[#BF953F]/50 outline-none"
                      value={cardData.acqState || ''}
                      onChange={(e) => setCardData({ ...cardData, acqState: e.target.value })}
                      placeholder="IL"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    {/* ── Envelope OCR Plugin (Pro-only; does not consume a credit) ─────────────────────────────── */}
                    <EnvelopeScanPlugin
                      onExtracted={handleEnvelopeExtracted}
                      proRequired
                      hasPro={user?.role === 'admin' || (user?.paid_credits ?? 0) > 0}
                      onUpgradeClick={() => setIsProfileOpen(true)}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-[10px] text-white/40 uppercase font-bold tracking-wider flex items-center gap-2">
                      <i className="fas fa-hashtag text-poke-accent"></i> Vault Copy Number (Optional)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-full bg-[#050505] border border-white/10 p-2.5 rounded-lg text-white text-sm focus:border-[#BF953F]/50 outline-none"
                      value={cardData.vaultCopy || ''}
                      onChange={(e) => setCardData(prev => ({ ...prev, vaultCopy: e.target.value }))}
                      placeholder="e.g. 131 (for duplicate cards)"
                    />
                    <p className="text-[9px] text-white/30 italic">
                      Use this to number duplicate cards (e.g., if you have 3 Pikachu from the same set, number them #1, #2, #3).
                    </p>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Notes</label>
                      {/* ── Pre-fill buttons ───────────────────────────────── */}
                      <div className="flex flex-wrap gap-1 justify-end">
                        {PREFILLS.map(({ label, text }) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => insertAtCursor(text)}
                            className="text-[9px] font-bold bg-poke-blue/20 hover:bg-poke-blue/40 border border-poke-blue/30 text-poke-blue px-2 py-0.5 rounded transition-all"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      ref={notesRef}
                      className="w-full bg-[#050505] border border-white/10 p-2 rounded text-white text-xs focus:border-[#BF953F]/50 outline-none h-16 resize-none"
                      value={cardData.userNotes || ''}
                      onChange={(e) => setCardData({ ...cardData, userNotes: e.target.value })}
                      placeholder="Condition notes, purchase history, etc..."
                    />
                  </div>
                </div>
              </details>
            </div>

            <div className="h-px bg-white/10 my-4"></div>

            {!isAnalyzing && (
              <>
                {['Centering', 'Corners', 'Edges', 'Surface'].map((key) => {
                  const k = key.toLowerCase() as keyof GradingResult;
                  const val = cardData.userGrade ? (cardData.userGrade as any)[k] : 10;
                  return (
                    <div key={key} className="space-y-2">
                      <div className="flex justify-between items-center px-1">
                        <label className="font-black text-white/40 uppercase text-[10px] tracking-widest">{key}</label>
                        <span className={`font-black text-2xl ${val >= 9 ? 'text-[#D4AF37]' : 'text-[#990000]'}`}>{val}</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/10 rounded-lg overflow-hidden">
                        <div
                          className="h-full bg-[#990000] transition-all duration-1000"
                          style={{ width: `${(val / 10) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}

                {cardData.userGrade?.defects && cardData.userGrade.defects.length > 0 && (
                  <div className="pt-4 border-t border-white/10">
                    <label className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-4 block flex items-center gap-2">
                      <i className="fas fa-search-plus text-[#D4AF37]"></i> Identified Evidence
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {cardData.userGrade.defects.map((defect, idx) => {
                        const sourceImg = getSourceImageByIndex(defect.imageIndex, defect);
                        if (!sourceImg) return null;
                        return (
                          <div key={idx} className="bg-white/5 p-2 rounded-none border border-white/10 group hover:border-[#BF953F]/30 transition-all">
                            <EvidenceCrop imageSrc={sourceImg} box={defect.box2d} label={defect.category} />
                            <p className="text-[9px] text-white/40 mt-2 font-bold uppercase leading-tight text-center group-hover:text-white/70 transition-colors">{defect.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-white/10">
                  <label className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-2 block">Inspector Remarks (Locked)</label>
                  <textarea
                    readOnly
                    className="w-full bg-white/5 border border-white/10 rounded-none p-3 text-sm text-white/60 h-24 focus:border-[#BF953F]/50 outline-none transition-all resize-none cursor-default"
                    value={cardData.userGrade?.reasoning || ''}
                  />
                </div>

                <div className="flex items-center justify-between bg-white/5 p-6 rounded-sm border border-white/10 shadow-inner mb-4">
                  <span className="text-sm font-black text-white/40 uppercase tracking-[0.2em]">Estimated Grade</span>
                  <span className="text-5xl font-black text-[#D4AF37] italic">{cardData.userGrade?.overall ?? '?'}</span>
                </div>
                <p className="text-xs text-white/40 mb-4 text-center">Get the Final Verdict when you grade with <a href="https://www.psacard.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#D4AF37]">PSA</a>, <a href="https://www.cgccards.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#D4AF37]">CGC</a>, <a href="https://www.beckett.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#D4AF37]">BGS</a>, or <a href="https://www.taggrading.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#D4AF37]">TAG</a>.</p>
                {(cardData.userGrade?.overall == null) && (
                  <p className="text-amber-600 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                    <i className="fas fa-info-circle"></i> Score unavailable — run Reanalyze below (or after fixing any error above).
                  </p>
                )}

                {(() => {
                  const proDraft = (cardData as any)._draftMeta;
                  const proScansUsed = proDraft?.credit_type === 'paid' && ((proDraft?.reanalysis_count ?? 0) >= 2);
                  return proScansUsed ? (
                    <div className="mb-4 p-4 rounded-none bg-[#BF953F]/10 border border-[#BF953F]/30">
                      <p className="text-sm font-bold text-[#D4AF37] mb-2">You&apos;ve used all 3 pro scans for this draft.</p>
                      <p className="text-xs text-white/50 mb-3">Save your certificate or discard this draft. Discarding will use up this credit. Questions? <a href="mailto:support@rawgraded.com" className="underline font-bold text-[#D4AF37]">support@rawgraded.com</a> or <a href="https://x.com/GatoGodMode" target="_blank" rel="noopener noreferrer" className="underline font-bold text-[#D4AF37]">@GatoGodMode</a> on X.</p>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={saveToArchive} className="px-4 py-2 bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-black rounded-none font-bold text-sm">Issue Certificate</button>
                        <button onClick={discardDraft} className="px-4 py-2 bg-[#990000] text-white rounded-none font-bold text-sm hover:bg-[#660000]">Discard draft</button>
                      </div>
                    </div>
                  ) : null;
                })()}

                <div className="flex flex-col gap-4 w-full">
                  <div className="flex flex-wrap items-center gap-2">
                    {hasDraft && (
                      <button
                        type="button"
                        onClick={loadDraft}
                        className="py-2.5 px-4 bg-white/5 border border-white/10 rounded-none font-bold text-white/60 text-sm uppercase tracking-wider hover:bg-white/10 transition-all flex items-center gap-2"
                      >
                        <i className="fas fa-file-import"></i> Load draft
                      </button>
                    )}
                    {(() => {
                      const canSaveDraft = user?.role === 'admin' || (cardData as any)._draftMeta?.credit_type === 'paid';
                      const proScansUsed = (cardData as any)._draftMeta?.credit_type === 'paid' && ((cardData as any)._draftMeta?.reanalysis_count ?? 0) >= 2;
                      return (
                        <button
                          type="button"
                          onClick={canSaveDraft && !proScansUsed ? saveDraft : undefined}
                          disabled={!canSaveDraft || proScansUsed}
                          className={`py-2.5 px-4 rounded-none font-bold text-sm uppercase tracking-wider transition-all flex items-center gap-2 ${canSaveDraft && !proScansUsed ? 'bg-[#BF953F]/10 border border-[#BF953F]/40 text-[#D4AF37] hover:bg-[#BF953F]/20' : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'}`}
                        >
                          <i className="fas fa-save"></i> Save draft
                          {!canSaveDraft && <span className="bg-white/20 text-white/50 text-[10px] px-1.5 py-0.5 rounded font-black">Pro run only</span>}
                        </button>
                      );
                    })()}
                  </div>
                  <div className="flex flex-col md:flex-row gap-4 w-full">
                    {!((cardData as any)._draftMeta?.credit_type === 'paid' && ((cardData as any)._draftMeta?.reanalysis_count ?? 0) >= 2) && (
                      <button
                        onClick={() => {
                          setAnalysisError(null);
                          const usePaid = (cardData as any)._draftMeta?.credit_type === 'paid' && (user?.paid_credits ?? 0) > 0;
                          runAnalysis(cardData.frontCropped!, cardData.backCropped!, cardData.videoFrames || [], usePaid);
                        }}
                        className="w-full md:w-1/3 py-5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-sm font-black text-white shadow transition-all uppercase tracking-widest text-sm flex items-center justify-center gap-2"
                      >
                        <i className="fas fa-sync-alt"></i> Reanalyze
                      </button>
                    )}
                    <div className="w-full md:w-2/3 flex flex-col gap-2">
                      {user && user.role !== 'admin' && (user.scan_limit - (user.scans_this_week ?? 0)) > 0 && (user.paid_credits ?? 0) > 0 && (cardData as any)._draftMeta?.credit_type !== 'paid' && (
                        <label className="flex items-center gap-2 text-sm text-white/50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={useFreeCredit}
                            onChange={(e) => setUseFreeCredit(e.target.checked)}
                            className="rounded border-gray-400 text-[#990000] focus:ring-poke-accent"
                          />
                          <span>Use a free credit (save paid for later)</span>
                        </label>
                      )}
                      <button
                        onClick={saveToArchive}
                        className="w-full py-5 bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] hover:from-[#D4AF37] hover:via-[#FCF6BA] hover:to-[#B38728] rounded-sm font-black text-black shadow-xl transition-all uppercase tracking-widest text-lg"
                      >
                        Issue Certificate
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCertViewStep = (certId: string) => (
    <div className="animate-fade-in p-4 space-y-8">
      <Certificate
        data={cardData}
        finalGrade={cardData.userGrade!}
        user={user}
        onCreditsUpdated={(cr) =>
          setUser((prev) =>
            prev
              ? {
                ...prev,
                paid_credits: cr.paid,
                ...(cr.scan_limit != null && { scan_limit: cr.scan_limit }),
                ...(cr.scans_this_week != null && { scans_this_week: cr.scans_this_week })
              }
              : null
          )
        }
      />
      <div className="text-center no-print flex flex-col items-center gap-4">
        <div className="flex gap-4">
          <button
            onClick={() => setStep(AppStep.ARCHIVE)}
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-6 py-2 rounded-full font-bold transition-all shadow flex items-center gap-2"
          >
            <i className="fas fa-history"></i> Global Archive
          </button>
          <button
            onClick={() => goToPlatformStep(AppStep.COLLECTION)}
            className="bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-black px-6 py-2 rounded-full font-black transition-all shadow-lg shadow-[#BF953F]/20 flex items-center gap-2"
          >
            <i className="fas fa-layer-group"></i> My Vault
          </button>
        </div>
        <button
          onClick={startOver}
          className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest border-b border-white/10 hover:border-white transition-all pb-1"
        >
          Start New Audit
        </button>
      </div>
    </div>
  );

  if (publicVaultId) {
    return <DisplayVaultView vaultId={publicVaultId} />;
  }

  if (publicCard3dToken) {
    return <PublicCard3DView token={publicCard3dToken} onBack={() => { window.history.replaceState({}, '', '/'); }} />;
  }

  return (
    <div className="min-h-screen bg-[#111111] text-white font-sans selection:bg-[#990000] selection:text-white pb-20 overflow-x-hidden">
      <BrushedGoldDefs />
      {/* Background Decor - subtle light accents */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-[#990000]/[0.04] rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-poke-blue/[0.03] rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2"></div>
      </div>

      {cameraSide && (
        <CameraCapture
          side={cameraSide}
          onCapture={handleCameraCapture}
          onClose={() => setCameraSide(null)}
        />
      )}

      {/* 2FA challenge: must enter code before using the app — on-brand light theme */}
      {user?.requires_totp && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#111111]/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm rounded-sm shadow-2xl p-6 border border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 mb-1 flex items-center gap-2">
              <i className="fas fa-shield-alt text-[#990000]" /> Two-factor authentication
            </h2>
            <p className="text-gray-600 text-sm mb-4">Enter the 6-digit code from your authenticator app.</p>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const code = totpCode.replace(/\D/g, '').slice(0, 6);
              if (code.length !== 6) { setTotpError('Enter 6 digits'); return; }
              setTotpError(''); setTotpSubmitting(true);
              try {
                const res = await fetch('api/auth.php?action=totp_verify_login', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ code }),
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                const payload = data.data || data;
                const totpToken = payload.totp_token ?? data.totp_token;
                if (totpToken) localStorage.setItem(TOTP_TOKEN_KEY, totpToken);
                if (payload.remember_token) localStorage.setItem(TOTP_REMEMBER_KEY, payload.remember_token);
                if (payload.user) {
                  setUser({ ...payload.user, requires_totp: false });
                } else if (payload.verified) {
                  // Old backend: no user/totp_token in response — delay then check_session so cookie can be set; modal closes but token won't persist until you deploy updated auth.php
                  setTimeout(async () => {
                    const u = await storeService.checkSession();
                    if (u) setUser({ ...u, requires_totp: false });
                  }, 500);
                }
                setTotpCode('');
                setTotpError('');
              } catch (err: any) {
                setTotpError(err.message || 'Invalid code');
              } finally {
                setTotpSubmitting(false);
              }
            }}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, '')); setTotpError(''); }}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-center text-2xl tracking-[0.5em] font-mono focus:border-poke-accent focus:ring-2 focus:ring-poke-accent/20 outline-none"
                autoFocus
              />
              {totpError && <p className="text-[#990000] text-sm mt-2">{totpError}</p>}
              <button type="submit" disabled={totpSubmitting || totpCode.replace(/\D/g, '').length !== 6} className="w-full mt-4 bg-[#990000] hover:bg-[#990000] text-white font-bold py-3 rounded-lg disabled:opacity-50">
                {totpSubmitting ? 'Verifying…' : 'Verify'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isApplicationWizardOpen && (
        <MembershipApplicationWizard
          isOpen={isApplicationWizardOpen}
          onClose={() => setIsApplicationWizardOpen(false)}
          onComplete={() => {
            setAuthInitialMode('signup');
            setIsApplicationWizardOpen(false);
            setIsAuthOpen(true);
          }}
        />
      )}

      {isAuthOpen && (
        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          onSuccess={(u) => {
            setUser(u);
            setIsAuthOpen(false);
          }}
          onNavigate={(s) => {
            setIsAuthOpen(false);
            setStep(s);
          }}
          initialMode={authInitialMode}
        />
      )}

      {isAdminOpen && user?.role === 'admin' && !user?.requires_totp && (
        <AdminDashboard
          isOpen={isAdminOpen}
          onClose={() => setIsAdminOpen(false)}
          user={user}
        />
      )}

      {user?.role === 'admin' && !user?.requires_totp && <AdminDebugConsole />}

      {isAboutOpen && (
        <AboutModal
          isOpen={isAboutOpen}
          onClose={() => setIsAboutOpen(false)}
        />
      )}

      {isShopOpen && (
        <ShopModal
          isOpen={isShopOpen}
          onClose={() => setIsShopOpen(false)}
          user={user}
          onNavigate={(s) => {
            setIsShopOpen(false);
            setStep(s);
          }}
        />
      )}
      {isProfileOpen && user && (
        <UserProfileSettings
          user={user}
          onClose={() => setIsProfileOpen(false)}
          onUpdate={setUser}
          onOpenShop={() => { setIsProfileOpen(false); setIsShopOpen(true); }}
        />
      )}
      {/* Free sign-up banner (hidden when logged in) */}
      {!freeBannerDismissed && !user && (
        <div className="bg-poke-blue/10 border-b border-poke-blue/20 no-print">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center">
            <p className="text-xs sm:text-sm text-gray-800 font-bold flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <span className="text-[#990000]">7-day trial · no card required</span>
              <span className="hidden sm:inline">—</span>
              <span>Secured with</span>
              <span className="inline-flex items-center gap-1">
                <img src="/assets/brands/google.svg" alt="" className="w-4 h-4 object-contain" aria-hidden />
                <span>Google SSO & 2FA</span>
              </span>
              <span className="hidden sm:inline">·</span>
              <span>Payments by</span>
              <a href="https://stripe.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gray-800 hover:text-[#990000] transition-colors underline underline-offset-2">
                <img src="/assets/brands/stripe.svg" alt="Stripe" className="w-4 h-4 object-contain" />
                <span>Stripe</span>
              </a>
            </p>
            <span className="flex items-center gap-3 flex-shrink-0">
              <a href="https://x.com/gatogodmode" target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-gray-700 hover:text-[#990000] transition-colors uppercase tracking-wider">Contact (X)</a>
              <a href="mailto:support@rawgraded.com" className="text-xs font-bold text-gray-700 hover:text-[#990000] transition-colors uppercase tracking-wider">Support</a>
              <button
                type="button"
                onClick={() => {
                  setFreeBannerDismissed(true);
                  try { sessionStorage.setItem('rg_free_banner_dismissed', '1'); } catch (_) { }
                }}
                className="p-1 rounded text-gray-500 hover:text-gray-700 hover:bg-white/50 transition-colors"
                aria-label="Dismiss"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </span>
          </div>
        </div>
      )}
      {/* Header */}
      <nav className="bg-[#111111] border-b border-white/10 sticky top-0 z-50 no-print shadow-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={handleGoHome}>
            <div className="relative">
              <img
                src="/assets/logo/R%20Solo.svg"
                alt="RawGraded Logo"
                className="w-10 h-10 object-contain group-hover:scale-110 transition-transform duration-300"
              />
              <div className="absolute -inset-1 bg-[#990000]/10 blur-md rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </div>
            <span className="text-lg font-serif font-medium tracking-wide text-white uppercase hidden sm:inline">RawGraded</span>
          </div>
          <div className="hidden md:ml-10 md:block">
            {renderProgressBadge()}
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden lg:flex items-center gap-4 xl:gap-5 mr-6 border-r border-white/10 pr-6 flex-shrink-0">
              <button onClick={handleGoHome} className={`text-[11px] xl:text-xs font-bold uppercase tracking-widest transition-colors whitespace-nowrap ${step === AppStep.UPLOAD && !isMarketplaceOpen ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>Grader</button>
              <button onClick={() => { setStep(AppStep.ARCHIVE); setIsMarketplaceOpen(false); }} className={`text-[11px] xl:text-xs font-bold uppercase tracking-widest transition-colors whitespace-nowrap ${step === AppStep.ARCHIVE && !isMarketplaceOpen ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>Public Archive</button>
              <button onClick={() => setIsMarketplaceOpen(true)} className={`text-[11px] xl:text-xs font-bold uppercase tracking-widest transition-colors whitespace-nowrap ${isMarketplaceOpen ? 'text-white drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]' : 'text-purple-400 hover:text-purple-300'}`}>Market <i className="fas fa-store ml-1" /></button>
              <button onClick={handlePricingClick} className="text-[11px] xl:text-xs font-bold uppercase tracking-widest transition-colors whitespace-nowrap text-gray-500 hover:text-gray-300">Pricing</button>
              {user && (
                <>
                  <button onClick={() => goToPlatformStep(AppStep.SNIPER)} className={`text-[11px] xl:text-xs font-bold uppercase tracking-widest transition-colors whitespace-nowrap ${step === AppStep.SNIPER ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>Sniper</button>
                  <button onClick={() => goToPlatformStep(AppStep.COLLECTION)} className={`text-[11px] xl:text-xs font-bold uppercase tracking-widest transition-colors whitespace-nowrap ${step === AppStep.COLLECTION ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>My Vault</button>
                </>
              )}
              {user ? (
                <button onClick={() => setIsShopOpen(true)} className="flex items-center gap-2 bg-[#990000] hover:bg-[#660000] text-white px-4 py-2 border-none transition-all text-[10px] font-bold uppercase tracking-widest shrink-0">
                  <i className="fas fa-shopping-cart"></i> {shopCtaLabel}
                </button>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => { setAuthInitialMode('signup'); setIsAuthOpen(true); }} className="px-4 py-2 bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors">
                    Sign up free
                  </button>
                  <button onClick={() => { setAuthInitialMode('login'); setIsAuthOpen(true); }} className="px-4 py-2 border border-white/20 bg-transparent text-white text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors">
                    Log in
                  </button>
                </div>
              )}
            </div>

            {user && user.role !== 'admin' && (
              <div className="hidden lg:flex items-center gap-2 mr-6 text-[10px] font-bold text-gray-600 uppercase tracking-wider">
                <span className="tabular-nums"><span className="text-gray-500">Free</span> {Math.max(0, user.scan_limit - (user.scans_this_week ?? 0))}</span>
                <span className="text-silver">·</span>
                <span className="tabular-nums"><span className="text-gray-500">Bonus</span> {user.bonus_scans ?? 0}</span>
                <span className="text-silver">·</span>
                <span className="tabular-nums text-[#990000]"><span className="text-gray-500">Pro</span> {user.paid_credits ?? 0}</span>
              </div>
            )}

            <div className="flex items-center gap-3">
              {user ? (
                <div className="flex items-center gap-4">
                  {user.role === 'admin' && !user.requires_totp && (
                    <button onClick={() => setIsAdminOpen(true)} className="w-10 h-10 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center">
                      <i className="fas fa-shield-alt"></i>
                    </button>
                  )}
                  <button type="button" onClick={() => setIsProfileOpen(true)} className="flex items-center gap-4 text-left focus:outline-none focus:ring-2 focus:ring-white/30">
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-bold uppercase text-white leading-none">{user.username}</span>
                      <span className="text-[10px] text-gray-500 uppercase font-bold mt-1">Profile &amp; Settings</span>
                    </div>
                    <div className="w-10 h-10 bg-[#111111] border border-white/20 flex items-center justify-center font-serif text-white flex-shrink-0">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                  </button>
                  <button onClick={handleLogout} className="text-[10px] text-gray-500 hover:text-white uppercase font-bold">Logout</button>
                </div>
              ) : (
                <button
                  onClick={() => { setAuthInitialMode('login'); setIsAuthOpen(true); }}
                  className="bg-white/5 hover:bg-white/10 border border-white/20 text-white px-6 py-2 text-xs font-bold uppercase tracking-widest transition-all"
                >
                  Member Access
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="lg:hidden border-t border-white/10 py-3">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
            <button onClick={() => { handleGoHome(); setIsMarketplaceOpen(false); }} className={`text-[10px] font-bold uppercase tracking-widest transition-colors px-3 py-1.5 ${step === AppStep.UPLOAD && !isMarketplaceOpen ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}>
              <i className="fas fa-camera mr-1.5"></i>Grader
            </button>
            <button onClick={() => { setStep(AppStep.ARCHIVE); setIsMarketplaceOpen(false); }} className={`text-[10px] font-bold uppercase tracking-widest transition-colors px-3 py-1.5 ${step === AppStep.ARCHIVE && !isMarketplaceOpen ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}>
              <i className="fas fa-archive mr-1.5"></i>Archive
            </button>
            <button onClick={() => setIsMarketplaceOpen(true)} className={`text-[10px] font-bold uppercase tracking-widest transition-colors px-3 py-1.5 ${isMarketplaceOpen ? 'bg-purple-500 text-white' : 'text-purple-400 hover:text-purple-300'}`}>
              <i className="fas fa-store mr-1.5"></i>Market
            </button>
            <button onClick={handlePricingClick} className="text-[10px] font-bold uppercase tracking-widest transition-colors px-3 py-1.5 text-gray-400 hover:text-white">
              <i className="fas fa-tag mr-1.5"></i>Pricing
            </button>
            {user && (
              <>
                <button onClick={() => goToPlatformStep(AppStep.SNIPER)} className={`text-[10px] font-bold uppercase tracking-widest transition-colors px-3 py-1.5 ${step === AppStep.SNIPER ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}>
                  <i className="fas fa-crosshairs mr-1.5"></i>Sniper
                </button>
                <button onClick={() => goToPlatformStep(AppStep.COLLECTION)} className={`text-[10px] font-bold uppercase tracking-widest transition-colors px-3 py-1.5 ${step === AppStep.COLLECTION ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}>
                  <i className="fas fa-vault mr-1.5"></i>My Vault
                </button>
              </>
            )}
            {user ? (
              <button onClick={() => setIsShopOpen(true)} className="text-[10px] font-bold uppercase tracking-widest text-white bg-[#990000] hover:bg-[#660000] px-3 py-1.5 shrink-0">
                <i className="fas fa-shopping-cart mr-1.5"></i>{shopCtaLabel}
              </button>
            ) : (
              <>
                <button onClick={() => { setAuthInitialMode('signup'); setIsAuthOpen(true); }} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 bg-white text-black shrink-0">
                  Sign up free
                </button>
                <button onClick={() => { setAuthInitialMode('login'); setIsAuthOpen(true); }} className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 border border-white/20 text-white bg-transparent shrink-0">
                  Log in
                </button>
              </>
            )}
          </div>
          {user && user.role !== 'admin' && (
            <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-gray-600 uppercase tracking-wider">
              <span className="tabular-nums"><span className="text-gray-500">Free</span> {Math.max(0, user.scan_limit - (user.scans_this_week ?? 0))}</span>
              <span className="text-silver">·</span>
              <span className="tabular-nums"><span className="text-gray-500">Bonus</span> {user.bonus_scans ?? 0}</span>
              <span className="text-silver">·</span>
              <span className="tabular-nums text-[#990000]"><span className="text-gray-500">Pro</span> {user.paid_credits ?? 0}</span>
            </div>
          )}
        </div>
      </nav>

      <main className="w-full">
        {step === AppStep.UPLOAD && deepLinkCertId && (isAnalyzing || certLoadError) ? (
          <div className="max-w-xl mx-auto text-center py-20">
            {isAnalyzing ? (
              <>
                <div className="animate-spin w-12 h-12 border-4 border-poke-accent border-t-transparent rounded-full mx-auto mb-6" />
                <p className="text-gray-600 font-bold">Loading certificate…</p>
                <p className="text-gray-500 text-sm mt-2">Verification link — please wait.</p>
              </>
            ) : (
              <>
                <p className="text-[#990000] font-bold mb-4">{certLoadError}</p>
                <button
                  onClick={() => { setDeepLinkCertId(null); setCertLoadError(null); handleGoHome(); }}
                  className="px-6 py-3 bg-[#990000] text-white font-black uppercase tracking-widest rounded-none hover:opacity-90"
                >
                  Go to Grader
                </button>
              </>
            )}
          </div>
        ) : null}
        {step === AppStep.UPLOAD && !(deepLinkCertId && (isAnalyzing || certLoadError)) && renderUploadStep()}
        {step === AppStep.ARCHIVE && <PublicArchive user={user} onSelect={(id: string | null) => handleSelectCertificate(id || '')} onViewAuthCert={(id: number) => setViewingAuthCheckId(id)} />}
        {user && step === AppStep.COLLECTION && (
          platformLocked ? (
            <div className="max-w-lg mx-auto py-24 px-6 text-center space-y-6 animate-fade-in">
              <h2 className="text-xl font-bold text-white uppercase tracking-widest">Membership required</h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                Your trial has ended or your subscription needs attention. Subscribe to use My Vault, drafts, and the full grader workflow. Pro Credits you already own still apply once access is restored.
              </p>
              <button
                type="button"
                onClick={() => setIsShopOpen(true)}
                className="px-8 py-3 bg-[#990000] hover:bg-[#660000] text-white font-bold uppercase tracking-widest text-xs transition-colors"
              >
                View plans &amp; billing
              </button>
            </div>
          ) : (
            <MyCollection
              user={user}
              onSelect={(id: string) => handleSelectCertificate(id)}
              onRegrade={(id: string) => handleStartRegrade(id)}
              onOpenDraft={handleOpenDraft}
              onOpenProfile={() => setIsProfileOpen(true)}
              onRefreshUser={refreshUser}
              onAuthenticate={(slabId: number) => {
                setCardData(prev => ({ ...prev, metadata: { ...prev.metadata, category: 'Graded Slab' } }));
                setAuthVaultSlabId(slabId);
                setIsSlabCheckerOpen(true);
              }}
            />
          )
        )}
        {user && step === AppStep.SNIPER && (
          platformLocked ? (
            <div className="max-w-lg mx-auto py-24 px-6 text-center space-y-6 animate-fade-in">
              <h2 className="text-xl font-bold text-white uppercase tracking-widest">Membership required</h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                Sniper is part of the member toolkit. Subscribe to restore platform access, then return here with your Pro Credits.
              </p>
              <button
                type="button"
                onClick={() => setIsShopOpen(true)}
                className="px-8 py-3 bg-[#990000] hover:bg-[#660000] text-white font-bold uppercase tracking-widest text-xs transition-colors"
              >
                View plans &amp; billing
              </button>
            </div>
          ) : (
            <SniperView user={user} onOpenShop={() => setIsShopOpen(true)} onCreditsUsed={refreshUser} />
          )
        )}

        {step === AppStep.CROP_FRONT && cardData.frontRaw && <Cropper imageSrc={cardData.frontRaw} onConfirm={handleCropConfirm} title="Crop Front" initialMetadata={cardData.frontMetadata} />}
        {step === AppStep.CROP_BACK && cardData.backRaw && <Cropper imageSrc={cardData.backRaw} onConfirm={handleCropConfirm} title="Crop Back" initialMetadata={cardData.backMetadata} />}
        {step === AppStep.VIDEO_CAPTURE && <VideoCapture onCapture={handleVideoCapture} onSkip={handleSkipVideo} />}
        {step === AppStep.ANALYSIS && renderAnalysisStep()}
        {step === AppStep.CERTIFICATE && cardData.userGrade && renderCertViewStep(cardData.id || '')}
      </main>

      <footer className="w-full pt-16 pb-12 text-center border-t border-white/5 bg-[#111111]">
        <div className="max-w-6xl mx-auto px-6">
          {/* Logo & Copyright */}
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center gap-2 mb-2">
              <img src="/assets/logo/R%20Solo.svg" alt="R" className="w-6 h-6 opacity-80" style={{ filter: 'brightness(0) invert(1)' }} />
              <span className="text-sm font-serif font-medium tracking-wide text-white uppercase">RawGraded</span>
            </div>
            <p className="text-[10px] text-white/50 font-bold uppercase tracking-[0.2em]">
              © RawGraded 2026 — Launch Phase v2.6.1 Echo
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12 text-left border-y border-white/10 py-10">
            {/* Industry Leaders Backlinks */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-[#990000] uppercase tracking-widest border-b border-[#990000]/20 pb-2">Recognized Authorities</h4>
              <p className="text-[10px] text-white/60 font-medium leading-relaxed">
                We advocate for and support the industry leaders whose standards we trust for final authentication.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <a href="https://www.psacard.com/" target="_blank" rel="noreferrer" className="text-[10px] font-bold text-white/70 hover:text-white transition-colors flex items-center gap-2">
                  <i className="fas fa-external-link-alt text-[8px] text-[#990000]"></i> PSA Cards
                </a>
                <a href="https://www.beckett.com/grading" target="_blank" rel="noreferrer" className="text-[10px] font-bold text-white/70 hover:text-white transition-colors flex items-center gap-2">
                  <i className="fas fa-external-link-alt text-[8px] text-[#990000]"></i> BGS (Beckett)
                </a>
                <a href="https://www.cgccards.com/" target="_blank" rel="noreferrer" className="text-[10px] font-bold text-white/70 hover:text-white transition-colors flex items-center gap-2">
                  <i className="fas fa-external-link-alt text-[8px] text-[#990000]"></i> CGC Cards
                </a>
                <a href="https://www.gosgc.com/" target="_blank" rel="noreferrer" className="text-[10px] font-bold text-white/70 hover:text-white transition-colors flex items-center gap-2">
                  <i className="fas fa-external-link-alt text-[8px] text-[#990000]"></i> SGC Grading
                </a>
                <a href="https://taggrading.com/" target="_blank" rel="noreferrer" className="text-[10px] font-bold text-white/70 hover:text-white transition-colors flex items-center gap-2">
                  <i className="fas fa-external-link-alt text-[8px] text-[#990000]"></i> TAG Grading
                </a>
              </div>
            </div>

            {/* Trust & Security */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-[#990000] uppercase tracking-widest border-b border-[#990000]/20 pb-2">Security &amp; Trust</h4>
              <ul className="space-y-2 text-[10px] text-white/70 font-medium">
                <li className="flex items-center gap-2"><i className="fas fa-google text-[#990000] w-4" /> Sign in with Google</li>
                <li className="flex items-center gap-2"><i className="fas fa-shield-alt text-[#990000] w-4" /> 2FA available</li>
                <li className="flex items-center gap-2"><i className="fas fa-lock text-[#990000] w-4" /> Your data protected</li>
                <li className="flex items-center gap-2"><i className="fas fa-user-shield text-[#990000] w-4" /> Privacy-first</li>
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => setStep(AppStep.PRIVACY)} className="text-[10px] font-bold text-white/60 hover:text-white transition-colors uppercase tracking-widest">Privacy</button>
                <span className="text-white/20">·</span>
                <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-white/60 hover:text-white transition-colors uppercase tracking-widest">Full policy</a>
                <span className="text-white/20">·</span>
                <button onClick={() => setStep(AppStep.TERMS_USE)} className="text-[10px] font-bold text-white/60 hover:text-white transition-colors uppercase tracking-widest">Terms</button>
              </div>
            </div>

            {/* Legal Links */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-[#990000] uppercase tracking-widest border-b border-[#990000]/20 pb-2">Compliance</h4>
              <div className="flex flex-col gap-3">
                <button onClick={() => setStep(AppStep.PRIVACY)} className="text-[10px] font-bold text-white/70 hover:text-white text-left transition-colors uppercase tracking-widest">Privacy Policy</button>
                <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-white/70 hover:text-white text-left transition-colors uppercase tracking-widest">Full policy (all products)</a>
                <button onClick={() => setStep(AppStep.TERMS_USE)} className="text-[10px] font-bold text-white/70 hover:text-white text-left transition-colors uppercase tracking-widest">Terms of Use</button>
                <button onClick={() => setStep(AppStep.TERMS_SERVICE)} className="text-[10px] font-bold text-white/70 hover:text-white text-left transition-colors uppercase tracking-widest">Agreements</button>
              </div>
            </div>

            {/* Investment Disclaimer */}
            <div className="space-y-4 font-sans">
              <h4 className="text-[10px] font-black text-[#990000] uppercase tracking-widest border-b border-[#990000]/20 pb-2">Financial Disclosure</h4>
              <p className="text-[10px] text-white/50 leading-relaxed text-justify italic">
                This application does not provide investment advice and should not be taken as an investment tool, shortcut, or bot.
                RawGraded is a collectibles pre-grading tool designed solely to optimize the conditions for submission to recognized professional authorities.
              </p>
            </div>
          </div>

          {/* AI Legal Statement */}
          <div className="max-w-3xl mx-auto space-y-4">
            <p className="text-[10px] text-white/50 leading-relaxed text-center uppercase tracking-wider font-bold">
              AI Scan Methodology & Limitation of Liability
            </p>
            <p className="text-[10px] text-white/50 leading-relaxed text-justify">
              RawGraded provides an AI-augmented condition analysis but <strong>does not replace official grading companies</strong>.
              Our process employs pro-level AI models that, while significantly more accurate than human estimation, are not perfect.
              Results are digital interpretations and are subject to user lighting conditions, camera resolution, shutter speed, physical movement,
              and the general technical interpretation of the AI model. <strong className="text-[#990000]">If a scan appears faulty or inaccurate, do not save it to the registry.</strong>
              No guarantee of a matching grade from any 3rd party service is implied.
            </p>
          </div>

          <div className="mt-12 flex justify-center opacity-60">
            <p className="text-[9px] font-black tracking-[0.5em] text-white/30 uppercase">
              Neural Precision Grader v2.6-I
            </p>
          </div>
        </div>
      </footer>

      <AcquisitionWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onApply={handleAcquisitionApply}
      />

      {isSlabCheckerOpen && (
        <SlabCheckerPlugin
          user={user}
          vaultSlabId={authVaultSlabId}
          initialFrontImg={cardData.frontRaw}
          initialBackImg={cardData.backRaw}
          onClose={() => {
            setIsSlabCheckerOpen(false);
            setAuthVaultSlabId(undefined);
          }}
          onSaved={() => {
            setIsSlabCheckerOpen(false);
            setAuthVaultSlabId(undefined);
            goToPlatformStep(AppStep.COLLECTION);
            setCardData(prev => ({ ...prev, metadata: { ...prev.metadata, category: 'Pokemon' } }));
          }}
          onRequestLogin={() => { setIsSlabCheckerOpen(false); setIsAuthOpen(true); }}
          onRequestShop={() => { setIsSlabCheckerOpen(false); setIsShopOpen(true); }}
        />
      )}
      {isMarketplaceOpen && (
        <MarketplacePlugin
          onClose={() => setIsMarketplaceOpen(false)}
          onViewCert={(id) => {
            setViewingAuthCheckId(id as number);
          }}
        />
      )}

      <AuthCertificateModal
        isOpen={viewingAuthCheckId !== null}
        authCheckId={viewingAuthCheckId}
        onClose={() => setViewingAuthCheckId(null)}
      />

      {/* Slab Search Plugin — floating button + modal, only visible on homepage when no camera active */}
      <SlabSearchPlugin
        user={user}
        hidden={cameraSide !== null || step !== AppStep.UPLOAD}
        onRequestLogin={() => { setAuthInitialMode('login'); setIsAuthOpen(true); }}
        onClaimSlab={() => {
          // Switch to Graded Slab category and open the Slab Checker to begin authentication
          setCardData(prev => ({ ...prev, metadata: { ...prev.metadata, category: 'Graded Slab' } }));
          setStep(AppStep.UPLOAD);
          setAuthVaultSlabId(undefined);
          setIsSlabCheckerOpen(true);
        }}
      />
    </div >
  );

};

export default App;
