import { Preferences } from '@capacitor/preferences';
import type { DesktopLlmSettings } from '../llm/types';

const SETTINGS_KEY = 'rawgraded_studio_settings';

const mobileDefaults: DesktopLlmSettings & { geminiFreeTierMode?: boolean } = {
  llmProvider: 'gemini',
  geminiApiKey: '',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.2-vision',
  skipVideoByDefault: false,
  useMeasuredCentering: true,
  geminiFreeTierMode: true,
};

export type MobileStudioSettings = DesktopLlmSettings & {
  geminiFreeTierMode?: boolean;
  bootstrapComplete?: boolean;
};

export async function loadMobileSettings(): Promise<MobileStudioSettings> {
  const { value } = await Preferences.get({ key: SETTINGS_KEY });
  if (!value) {
    return { ...mobileDefaults };
  }
  try {
    const parsed = JSON.parse(value) as Partial<MobileStudioSettings>;
    return {
      ...mobileDefaults,
      ...parsed,
      llmProvider: 'gemini',
    };
  } catch {
    return { ...mobileDefaults };
  }
}

export async function saveMobileSettings(partial: Partial<MobileStudioSettings>): Promise<void> {
  const current = await loadMobileSettings();
  const next: MobileStudioSettings = {
    ...current,
    ...partial,
    llmProvider: 'gemini',
  };
  await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(next) });
}

export async function clearMobileSettingsCache(): Promise<void> {
  /* Preferences are always read fresh; no in-memory layer here */
}
