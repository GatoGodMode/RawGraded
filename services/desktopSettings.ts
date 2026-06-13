import type { DesktopLlmSettings, LlmProviderId } from './llm/types';

declare const __MOBILE__: boolean;

const defaults: DesktopLlmSettings = {
  llmProvider: 'gemini',
  geminiApiKey: '',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'rawgraded-local',
};

let memoryCache: DesktopLlmSettings | null = null;

function isMobileRuntime(): boolean {
  return typeof __MOBILE__ !== 'undefined' && __MOBILE__;
}

export async function loadDesktopLlmSettings(): Promise<DesktopLlmSettings> {
  if (typeof window !== 'undefined' && window.desktop?.getSettingsFull) {
    const s = await window.desktop.getSettingsFull();
    memoryCache = {
      llmProvider: isMobileRuntime() ? 'gemini' : (s.llmProvider as LlmProviderId),
      geminiApiKey: s.geminiApiKey || '',
      ollamaBaseUrl: s.ollamaBaseUrl || defaults.ollamaBaseUrl,
      ollamaModel: s.ollamaModel || defaults.ollamaModel,
      webcamDeviceId: s.webcamDeviceId,
      skipVideoByDefault: s.skipVideoByDefault ?? (isMobileRuntime() ? true : false),
      useMeasuredCentering: s.useMeasuredCentering ?? true,
      localImageCompressionEnabled: s.localImageCompressionEnabled ?? false,
      localImageCompressionPreset: s.localImageCompressionPreset ?? 'full',
      geminiFreeTierMode: s.geminiFreeTierMode ?? (isMobileRuntime() ? true : undefined),
      autoCaptureWhenGreen: s.autoCaptureWhenGreen ?? false,
      localAnalysisDepth: s.localAnalysisDepth ?? 'standard',
    };
    return memoryCache;
  }
  if (memoryCache) return memoryCache;
  memoryCache = {
    ...defaults,
    geminiApiKey: '',
    geminiFreeTierMode: isMobileRuntime() ? true : undefined,
  };
  return memoryCache;
}

export function clearDesktopSettingsCache(): void {
  memoryCache = null;
}

export async function saveDesktopLlmSettings(partial: Partial<DesktopLlmSettings>): Promise<void> {
  if (window.desktop?.setSettings) {
    const payload = isMobileRuntime() ? { ...partial, llmProvider: 'gemini' as const } : partial;
    await window.desktop.setSettings(payload);
    clearDesktopSettingsCache();
    return;
  }
  memoryCache = { ...(await loadDesktopLlmSettings()), ...partial };
}
