import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopSettings } from './ipc/settings';
import type { BorderGuidePositions } from './ipc/borderDetect';
import type {
  AiHealthReport,
  BootstrapOptions,
  BootstrapResult,
  InstallOllamaResult,
  PullModelResult,
  PullProgressEvent,
  SetupPending,
} from './ipc/aiLauncherTypes';

const desktopApi = {
  isDesktop: true as const,
  getSettings: (): Promise<Omit<DesktopSettings, never> & { geminiApiKey: string }> =>
    ipcRenderer.invoke('settings:get'),
  getSettingsFull: (): Promise<DesktopSettings> => ipcRenderer.invoke('settings:getFull'),
  setSettings: (partial: Partial<DesktopSettings>): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:set', partial),
  testOllama: (opts?: { baseUrl?: string; model?: string }): Promise<{
    ok: boolean;
    models?: string[];
    modelPresent?: boolean;
    error?: string;
  }> => ipcRenderer.invoke('settings:testOllama', opts),
  detectBorders: (dataUrl: string, side?: 'front' | 'back'): Promise<BorderGuidePositions> =>
    ipcRenderer.invoke('border:detect', dataUrl, side),
  listHistory: (): Promise<Record<string, unknown>[]> => ipcRenderer.invoke('history:list'),
  saveHistory: (entry: Record<string, unknown>): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('history:save', entry),
  checkAiHealth: (overrides?: {
    baseUrl?: string;
    model?: string;
    provider?: 'gemini' | 'ollama';
  }): Promise<AiHealthReport> => ipcRenderer.invoke('ai:healthCheck', overrides),
  installOllama: (): Promise<InstallOllamaResult> => ipcRenderer.invoke('ai:installOllama'),
  openOllamaDownload: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('ai:openOllamaDownload'),
  ensureOllamaRunning: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('ai:ensureOllamaRunning'),
  pullOllamaModel: (model?: string): Promise<PullModelResult> =>
    ipcRenderer.invoke('ai:pullModel', model),
  getSetupPending: (): Promise<SetupPending | null> => ipcRenderer.invoke('ai:getSetupPending'),
  runBootstrap: (opts?: BootstrapOptions): Promise<BootstrapResult> =>
    ipcRenderer.invoke('ai:runBootstrap', opts),
  clearSetupPending: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('ai:clearSetupPending'),
  markBootstrapComplete: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('ai:markBootstrapComplete'),
  onPullProgress: (callback: (event: PullProgressEvent) => void): (() => void) => {
    const handler = (_: unknown, payload: PullProgressEvent) => callback(payload);
    ipcRenderer.on('ai:pullProgress', handler);
    return () => ipcRenderer.removeListener('ai:pullProgress', handler);
  },
  portfolioList: (params?: Record<string, unknown>) => ipcRenderer.invoke('portfolio:list', params),
  portfolioGet: (id: string) => ipcRenderer.invoke('portfolio:get', id),
  portfolioDelete: (id: string) => ipcRenderer.invoke('portfolio:delete', id),
  portfolioArchive: (id: string, archived: boolean) => ipcRenderer.invoke('portfolio:archive', id, archived),
  portfolioUpdateProvenance: (id: string, provenance: Record<string, unknown>) =>
    ipcRenderer.invoke('portfolio:updateProvenance', id, provenance),
  portfolioAddFromGrading: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('portfolio:addFromGrading', input),
  pricingRefreshCard: (id: string) => ipcRenderer.invoke('pricing:refreshCard', id),
  pricingRefreshWithPcUrl: (id: string, url: string) =>
    ipcRenderer.invoke('pricing:refreshWithPcUrl', id, url),
  pricingRefreshBatch: (opts?: { maxAgeMs?: number; ids?: string[] }) =>
    ipcRenderer.invoke('pricing:refreshBatch', opts),
  pricingSearchPriceCharting: (q: string) => ipcRenderer.invoke('pricing:searchPriceCharting', q),
  shellOpenEdge: (urls: string | string[]) => ipcRenderer.invoke('shell:openEdge', urls),
  shellOpenExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  onPortfolioRefreshProgress: (
    callback: (event: { cardId: string; index: number; total: number; ok: boolean; error?: string }) => void
  ): (() => void) => {
    const handler = (_: unknown, payload: unknown) => callback(payload as never);
    ipcRenderer.on('portfolio:refreshProgress', handler);
    return () => ipcRenderer.removeListener('portfolio:refreshProgress', handler);
  },
};

contextBridge.exposeInMainWorld('desktop', desktopApi);

export type DesktopApi = typeof desktopApi;
