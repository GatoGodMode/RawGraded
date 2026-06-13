import type { CardMetadata, CenteringMeasurement, CaptureMetadata, GradingResult } from '../../types';
import { buildAdvisoryCenteringContext } from '../grading/centeringAssessment';

export type LlmProviderId = 'gemini' | 'ollama';

export interface GradingProgressCallback {
  (status: string): void;
}

export type ReanalysisMode = 'identity' | 'full';

export interface RunGradingInput {
  front: string;
  back: string;
  frames: string[];
  category?: string;
  identificationHint?: string;
  centeringMeasurement?: CenteringMeasurement;
  useMeasuredCentering?: boolean;
  frontMetadata?: CaptureMetadata;
  backMetadata?: CaptureMetadata;
  onStatus?: GradingProgressCallback;
  /** When set with existingResult, runs identity-only re-analysis (Phase 1 + math, no forensic passes). */
  reanalysisMode?: ReanalysisMode;
  /** Prior grading to preserve defects/condition evidence during identity re-analysis. */
  existingResult?: GradingResult;
  /** Optional cancel from Studio re-analysis modal. */
  signal?: AbortSignal;
}

export interface LlmProvider {
  id: LlmProviderId;
  runFullGrading(input: RunGradingInput): Promise<GradingResult | null>;
  getAutoCropSettings?(imageBase64: string): Promise<{
    x: number;
    y: number;
    zoom: number;
    rotation: number;
    tiltX: number;
    tiltY: number;
  } | null>;
}

export type LocalImageCompressionPreset = 'full' | 'balanced' | 'fast';
export type LocalAnalysisDepth = 'standard' | 'deep';

export interface DesktopLlmSettings {
  llmProvider: LlmProviderId;
  geminiApiKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  webcamDeviceId?: string;
  skipVideoByDefault?: boolean;
  useMeasuredCentering?: boolean;
  localImageCompressionEnabled?: boolean;
  localImageCompressionPreset?: LocalImageCompressionPreset;
  /** Mobile: use gemini-2.5-flash for Phase 2 to stay within free tier limits */
  geminiFreeTierMode?: boolean;
  autoCaptureWhenGreen?: boolean;
  /** Local Ollama: standard (faster) or deep (phased chunks + synthesis) */
  localAnalysisDepth?: LocalAnalysisDepth;
}

export function buildCenteringContext(_meta: CardMetadata, m?: CenteringMeasurement): string {
  return buildAdvisoryCenteringContext(m);
}
