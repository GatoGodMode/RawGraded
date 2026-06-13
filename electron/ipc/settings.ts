import type { IpcMain } from 'electron';
import Store from 'electron-store';

export type LocalImageCompressionPreset = 'full' | 'balanced' | 'fast';
export type LocalAnalysisDepth = 'standard' | 'deep';

export interface DesktopSettings {
  llmProvider: 'gemini' | 'ollama';
  geminiApiKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  webcamDeviceId: string;
  skipVideoByDefault: boolean;
  useMeasuredCentering: boolean;
  localImageCompressionEnabled: boolean;
  localImageCompressionPreset: LocalImageCompressionPreset;
  bootstrapComplete: boolean;
  installerChoseOllama: boolean;
  autoCaptureWhenGreen: boolean;
  localAnalysisDepth: LocalAnalysisDepth;
  settingsSchemaVersion: number;
}

const CURRENT_SETTINGS_SCHEMA_VERSION = 2;

const defaults: DesktopSettings = {
  llmProvider: 'gemini',
  geminiApiKey: '',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'rawgraded-local',
  webcamDeviceId: '',
  skipVideoByDefault: false,
  useMeasuredCentering: true,
  localImageCompressionEnabled: false,
  localImageCompressionPreset: 'full',
  bootstrapComplete: false,
  installerChoseOllama: false,
  autoCaptureWhenGreen: false,
  localAnalysisDepth: 'standard',
  settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
};

const store = new Store<DesktopSettings>({
  name: 'rawgraded-studio-settings',
  defaults,
});

function applySettingsMigrations(): DesktopSettings {
  const version = store.get('settingsSchemaVersion') ?? 0;
  if (version < CURRENT_SETTINGS_SCHEMA_VERSION) {
    store.set({
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      skipVideoByDefault: false,
    });
  }
  return store.store;
}

applySettingsMigrations();

const historyStore = new Store<{ items: Record<string, unknown>[] }>({
  name: 'rawgraded-studio-history',
  defaults: { items: [] },
});

export function registerSettingsIpc(ipcMain: IpcMain): void {
  ipcMain.handle('settings:get', () => {
    const s = store.store;
    return { ...s, geminiApiKey: s.geminiApiKey ? '***' : '' };
  });

  ipcMain.handle('settings:getFull', () => applySettingsMigrations());

  ipcMain.handle('settings:set', (_e, partial: Partial<DesktopSettings>) => {
    if (partial.geminiApiKey === '***') delete partial.geminiApiKey;
    store.set(partial);
    return { ok: true };
  });

  ipcMain.handle(
    'settings:testOllama',
    async (_e, opts?: { baseUrl?: string; model?: string }) => {
      const { buildHealthReport } = await import('./aiLauncher');
      const report = await buildHealthReport({
        baseUrl: opts?.baseUrl,
        model: opts?.model,
        provider: 'ollama',
      });
      if (report.ollama.running) {
        return {
          ok: true,
          models: report.ollama.models,
          modelPresent: report.ollama.modelPresent,
        };
      }
      return { ok: false, error: report.ollama.error || 'Ollama is not reachable.' };
    }
  );

  ipcMain.handle('history:list', () => {
    const history = historyStore.get('items');
    return Array.isArray(history) ? history : [];
  });

  ipcMain.handle('history:save', (_e, entry: Record<string, unknown>) => {
    const list = [...(historyStore.get('items') || [])];
    list.unshift({ ...entry, savedAt: new Date().toISOString() });
    historyStore.set('items', list.slice(0, 200));
    return { ok: true };
  });
}

export function getSettingsStore(): Store<DesktopSettings> {
  return store;
}
