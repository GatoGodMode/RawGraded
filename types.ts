export enum StudioAppStep {
  UPLOAD = 'UPLOAD',
  CROP_FRONT = 'CROP_FRONT',
  CROP_BACK = 'CROP_BACK',
  CENTERING_FRONT = 'CENTERING_FRONT',
  CENTERING_BACK = 'CENTERING_BACK',
  VIDEO_CAPTURE = 'VIDEO_CAPTURE',
  ANALYSIS = 'ANALYSIS',
  RESULTS = 'RESULTS',
  CERTIFICATE = 'CERTIFICATE',
  SETTINGS = 'SETTINGS',
  HISTORY = 'HISTORY',
}

export interface CenteringRatioSet {
  leftPct: number;
  rightPct: number;
  topPct: number;
  bottomPct: number;
  psaHint?: number;
  centeringValid?: boolean;
  limitingAxis?: 'L/R' | 'T/B';
  limitingLabel?: string;
  limitingGrade?: number;
}

export interface CenteringMeasurement {
  front?: CenteringRatioSet;
  back?: CenteringRatioSet;
}

export interface BorderGuideState {
  outerTop: number;
  outerBottom: number;
  outerLeft: number;
  outerRight: number;
  innerTop: number;
  innerBottom: number;
  innerRight: number;
  innerLeft: number;
}

export enum AppStep {
  UPLOAD = 'UPLOAD',
  CROP_FRONT = 'CROP_FRONT',
  CROP_BACK = 'CROP_BACK',
  VIDEO_CAPTURE = 'VIDEO_CAPTURE',
  ANALYSIS = 'ANALYSIS',
  RESULTS = 'RESULTS',
  CERTIFICATE = 'CERTIFICATE',
  ARCHIVE = 'ARCHIVE',
  PUBLIC_ARCHIVE = 'PUBLIC_ARCHIVE',
  COLLECTION = 'COLLECTION',
  SNIPER = 'SNIPER',
  PRIVACY = 'PRIVACY',
  TERMS_USE = 'TERMS_USE',
  TERMS_SERVICE = 'TERMS_SERVICE',
}

export interface CropSettings {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  tiltX: number;
  tiltY: number;
}

export interface CaptureMetadata {
  tiltBeta: number;
  tiltGamma: number;
  suboptimalLighting?: boolean;
  lightingIssues?: string[];
  captureFocusScore?: number;
  captureWasSoft?: boolean;
}

export interface CardMetadata {
  name: string;
  character: string;
  set: string;
  year: string;
  edition: string;
  is_first_edition?: boolean | number;
  is_holographic?: boolean | number;
  holo_pattern?: string;
  rarity?: string | null;
  cardNumber: string;
  artist: string;
  estimated_value?: number;
  category?: string;
}

export interface Defect {
  category: string;
  description: string;
  imageIndex: number; // 0=Front, 1=Back, 2+=Frame[index-2]
  confidence: number;
  box2d: number[]; // [ymin, xmin, ymax, xmax] normalized 0-1000 (Gemini Standard)
  imageData?: string; // Optional surgical frame embedding for persistence on reload
  inferred?: boolean; // Added by defectConsistency when inferred from subgrades
}

export interface GradingResult {
  centering: number;
  corners: number;
  edges: number;
  surface: number;
  overall: number;
  centeringAi?: number;
  centeringMeasured?: number;
  reasoning: string;
  defects: Defect[];
  riskFactors?: string[];
  predictedGrades?: {
    psa: number;
    bgs: number;
    cgc: number;
    tcg: string;
  };
  // Metadata fields flattened into the result for better AI schema support
  detectedName: string;
  detectedCharacter: string;
  detectedSet: string;
  detectedYear: string;
  detectedEdition: string;
  detectedCardNumber: string;
  detectedArtist: string;
  /** Set by Phase 1 when a holographic/foil surface is detected; used to bump JPEG quality to 0.80 for Phase 2 scratch analysis. */
  isHolographic?: boolean;
  /** Detected foil pattern type (cosmos, galaxy, cracked_ice, swirl, reverse, full_art, standard, none). */
  holoPattern?: string;
  /** 3×3 forensic chunk thumbnails for phased evidence UI (imageIndex 100–108 front, 200–208 back). */
  analysisChunks?: AnalysisChunkRef[];
}

export interface AnalysisChunkRef {
  imageIndex: number;
  label: string;
  dataUrl: string;
}

export type IdentityAuthority = 'pricecharting' | 'user_hint' | 'llm';

export interface ResolvedCardIdentity {
  detectedName: string;
  detectedSet: string;
  detectedCardNumber: string;
  detectedYear?: string;
  detectedArtist?: string;
  source: IdentityAuthority;
  pricechartingUrl?: string;
}

export interface StoreSettings {
  defaultAcceptedTokens: string[];
  defaultShippingCost: number;
  defaultShippingMethod: 'crypto' | 'fiat';
}

export interface PremiumSettings {
  primaryTokenId?: string;
  globalPremiumUsd?: number;
  tokenSpecificPremiums?: Record<string, { type: 'fixed' | 'percent', value: number }>;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  joinedDate: string;
  role: 'admin' | 'user';
  scan_limit: number;
  bonus_scans: number;
  paid_credits?: number;
  has_purchased_credits?: boolean;
  scans_this_week: number;
  scan_reset_date?: string;
  isVip?: boolean;
  vipTier?: 1 | 2 | 3;
  vipExpiry?: string;
  storeSettings?: StoreSettings;
  premiumSettings?: PremiumSettings;
  solanaAddress?: string;
  x_username?: string;
  is_alliance?: boolean;
  marketplace_user_id?: string | number;
  totp_enabled?: boolean;
  requires_totp?: boolean;
  /** 0 = remember until logout, 30 = require 2FA every 30 days */
  totp_remember_days?: number;
  google_id?: string;
  google_picture?: string;
  /** Membership: trial, subscription, or grandfathered legacy */
  access_state?: 'grandfathered' | 'trialing' | 'active' | 'past_due' | 'lapsed' | 'none';
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  has_platform_access?: boolean;
  stripe_customer_id?: string | null;
  application_id?: number | null;
  /** Admin-granted: always-on platform access (no subscription); 0 = normal membership rules */
  vip_lifetime?: 0 | 1;
}


export interface AcquisitionData {
  price: number;
  tax: number;
  shipping: number;
  source: string;
  notes?: string;
  tracking_number?: string;
  order_id?: string;
  is_first_edition?: boolean | number;
  is_holographic?: boolean | number;
  rarity?: string | null;
}

export interface AcquisitionPreset {
  id: number;
  name: string;
  pack_type: string;
  pack_amount: number;
  pack_cost: number;
  tax: number;
  shipping: number;
  source: string;
}

export interface GlobalStats {
  total_graded: number;
  recent_scans: any[];
}

export interface CardData {
  id: string;
  frontRaw: string | null;
  backRaw: string | null;
  frontCropped: string | null;
  backCropped: string | null;
  frontThumb?: string | null;
  backThumb?: string | null;
  frontHash?: string | null;
  backHash?: string | null;
  videoRaw: string | null; // For UI playback only
  videoFrames: string[];   // For AI analysis (High Res)
  /** 3×3 forensic chunk thumbnails (imageIndex 100–108 front, 200–208 back). */
  analysisChunks?: AnalysisChunkRef[];
  /** PriceCharting or user-hint identity override for certificate display. */
  authoritativeIdentity?: ResolvedCardIdentity;
  userGrade: GradingResult | null;
  aiGrade: GradingResult | null;
  metadata: CardMetadata;
  frontMetadata?: CaptureMetadata;
  backMetadata?: CaptureMetadata;
  centeringMeasurement?: CenteringMeasurement;
  dateScanned: string;
  userTwitter?: string;
  ownerUsername?: string;
  isAlliance?: boolean;
  isPck?: boolean;
  userRole?: string;
  parentScanId?: string;
  userNotes?: string;
  history?: Array<{ id: string, name: string, overall_grade: number, estimated_value: number, date_scanned: string }>;
  descendants?: Array<{ id: string, name: string, overall_grade: number, estimated_value: number, date_scanned: string }>;
  similar_scans?: any[];
  userId?: string;
  predictedGrades?: {
    psa: number;
    bgs: number;
    cgc: number;
    tcg: string;
  } | null;
  // Acquisition Fields
  acqPrice?: number;
  acqTax?: number;
  acqShipping?: number;
  acqDate?: string;
  acqSource?: string;
  acqCity?: string;
  acqState?: string;
  acqTrackingNumber?: string;
  acqOrderId?: string;
  vaultCopy?: string;
  is_archived?: boolean | number;
  /**
   * Rendering mode for the certificate UI.
   * - 'graded': normal predicted grades + (optional) defects.
   * - 'collect_only': identification only; hide grades/defects in the certificate view.
   */
  assessmentMode?: 'graded' | 'collect_only';
  // First Edition, Holographic, Rarity & Audit
  is_first_edition?: boolean | number;
  is_holographic?: boolean | number;
  rarity?: string | null;
  name_updated_at?: string | null;
  name_updated_by?: string | null;
  name_history?: string | null;
}

export interface PSASlab {
  id: number;
  user_id: number;
  psa_serial: string;
  psa_grade: string | null;
  psa_grade_desc: string | null;
  card_name: string | null;
  card_set: string | null;
  card_year: string | null;
  card_number: string | null;
  front_img_url: string | null;
  cert_id: string | null;
  rg_grade: number | null;
  rg_cert_name: string | null;
  acq_price: number | null;
  acq_grading_fee: number | null;
  acq_shipping: number | null;
  acq_date: string | null;
  acq_source: string | null;
  user_notes: string | null;
  added_at: string;
  auth_check_id?: number | null;
  authenticity_score?: number | null;
  verdict?: string | null;
  // Phase 2 Transfer fields
  status?: 'active' | 'pending_transfer' | 'archived';
  sold_price?: number | null;
  transfer_from_user_id?: number | null;
  req_username?: string | null;
}

export const INITIAL_METADATA: CardMetadata = {
  name: "",
  character: "",
  set: "",
  year: "",
  edition: "",
  holo_pattern: "none",
  cardNumber: "",
  artist: "",
  estimated_value: 0,
  category: "Pokemon"
};

export const INITIAL_GRADE: GradingResult = {
  centering: 10,
  corners: 10,
  edges: 10,
  surface: 10,
  overall: 10,
  reasoning: "Pending analysis...",
  defects: [],
  detectedName: "",
  detectedCharacter: "",
  detectedSet: "",
  detectedYear: "",
  detectedEdition: "",
  detectedCardNumber: "",
  detectedArtist: "",
};