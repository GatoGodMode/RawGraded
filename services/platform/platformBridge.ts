import { loadMobileSettings, saveMobileSettings } from './mobileSettings';
import { loadMobileHistory, saveMobileHistoryEntry } from './mobileHistory';

declare const __MOBILE__: boolean;

export function isMobileApp(): boolean {
  return typeof __MOBILE__ !== 'undefined' && __MOBILE__;
}

/** Install window.desktop shim so StudioApp reuses Electron code paths on Capacitor. */
export async function initMobilePlatformBridge(): Promise<void> {
  if (!isMobileApp()) return;

  window.desktop = {
    getSettingsFull: () => loadMobileSettings(),
    setSettings: async (partial) => {
      await saveMobileSettings(partial);
      return { ok: true };
    },
    listHistory: () => loadMobileHistory(),
    saveHistory: (entry) => saveMobileHistoryEntry(entry),
  };
}
