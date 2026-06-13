declare const __BUILD_ID__: number | undefined;

declare const __DESKTOP__: boolean;

declare const __MOBILE__: boolean;



interface MobileDesktopSettings {

  llmProvider: 'gemini' | 'ollama';

  geminiApiKey: string;

  ollamaBaseUrl?: string;

  ollamaModel?: string;

  webcamDeviceId?: string;

  skipVideoByDefault?: boolean;

  useMeasuredCentering?: boolean;

  localImageCompressionEnabled?: boolean;

  localImageCompressionPreset?: 'full' | 'balanced' | 'fast';

  geminiFreeTierMode?: boolean;

  bootstrapComplete?: boolean;

  installerChoseOllama?: boolean;

  autoCaptureWhenGreen?: boolean;

  settingsSchemaVersion?: number;

}



interface PortfolioRefreshProgressEvent {

  cardId: string;

  index: number;

  total: number;

  ok: boolean;

  error?: string;

}



interface PcSearchCandidate {
  url: string;
  label: string;
  setHint?: string;
  cardNumber?: string;
  score?: number;
}

interface PricingRefreshResult {
  ok: boolean;
  card?: Record<string, unknown>;
  error?: string;
  needsPick?: boolean;
  candidates?: PcSearchCandidate[];
  searchUrl?: string;
}



interface PortfolioListResult {

  items: Record<string, unknown>[];

  total: number;

}



interface MobileDesktopBridge {

  isDesktop?: boolean;

  getSettingsFull?: () => Promise<MobileDesktopSettings>;

  setSettings?: (partial: Partial<MobileDesktopSettings>) => Promise<{ ok: boolean }>;

  detectBorders?: (dataUrl: string, side?: 'front' | 'back') => Promise<{
    outerTop: number;
    outerBottom: number;
    outerLeft: number;
    outerRight: number;
    innerTop: number;
    innerBottom: number;
    innerLeft: number;
    innerRight: number;
  }>;

  listHistory?: () => Promise<Record<string, unknown>[]>;

  saveHistory?: (entry: Record<string, unknown>) => Promise<{ ok: boolean }>;

  portfolioList?: (params?: Record<string, unknown>) => Promise<PortfolioListResult>;

  portfolioGet?: (id: string) => Promise<Record<string, unknown> | null>;

  portfolioDelete?: (id: string) => Promise<{ ok: boolean }>;

  portfolioArchive?: (id: string, archived: boolean) => Promise<Record<string, unknown> | null>;

  portfolioUpdateProvenance?: (id: string, provenance: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

  portfolioAddFromGrading?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

  pricingRefreshCard?: (id: string) => Promise<PricingRefreshResult>;

  pricingRefreshWithPcUrl?: (id: string, url: string) => Promise<PricingRefreshResult>;

  pricingRefreshBatch?: (opts?: { maxAgeMs?: number; ids?: string[] }) => Promise<{ ok: boolean; total: number }>;

  pricingSearchPriceCharting?: (q: string) => Promise<PcSearchCandidate[]>;

  shellOpenEdge?: (urls: string | string[]) => Promise<{ ok: boolean; opened: number; error?: string }>;

  shellOpenExternal?: (url: string) => Promise<{ ok: boolean }>;

  onPortfolioRefreshProgress?: (callback: (event: PortfolioRefreshProgressEvent) => void) => () => void;

}



interface Window {

  desktop?: MobileDesktopBridge;

}

