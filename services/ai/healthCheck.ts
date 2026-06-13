import type {
  AiHealthReport,
  BootstrapOptions,
  BootstrapResult,
  InstallOllamaResult,
  PullModelResult,
  SetupPending,
} from './healthTypes';
import { loadDesktopLlmSettings } from '../desktopSettings';
import type { LlmProviderId } from './healthTypes';

export async function checkAiHealth(overrides?: {
  baseUrl?: string;
  model?: string;
  provider?: LlmProviderId;
}): Promise<AiHealthReport> {
  if (window.desktop?.checkAiHealth) {
    return window.desktop.checkAiHealth(overrides);
  }
  const s = await loadDesktopLlmSettings();
  const provider = overrides?.provider ?? s.llmProvider;
  const gemini = { configured: Boolean(s.geminiApiKey?.trim()) };
  return {
    provider,
    gemini,
    ollama: {
      installed: false,
      running: false,
      modelPresent: false,
      models: [],
      error: 'Desktop health checks require the Electron app.',
    },
    ready: provider === 'gemini' ? gemini.configured : false,
  };
}

export async function installOllama(): Promise<InstallOllamaResult> {
  if (!window.desktop?.installOllama) {
    return { ok: false, method: 'manual', message: 'Install is only available in the desktop app.' };
  }
  return window.desktop.installOllama();
}

export async function pullOllamaModel(model?: string): Promise<PullModelResult> {
  if (!window.desktop?.pullOllamaModel) {
    return { ok: false, message: 'Model download is only available in the desktop app.' };
  }
  return window.desktop.pullOllamaModel(model);
}

export async function ensureOllamaRunning(): Promise<{ ok: boolean; message: string }> {
  if (!window.desktop?.ensureOllamaRunning) {
    return { ok: false, message: 'Not available outside the desktop app.' };
  }
  return window.desktop.ensureOllamaRunning();
}

export async function getSetupPending(): Promise<SetupPending | null> {
  if (!window.desktop?.getSetupPending) return null;
  return window.desktop.getSetupPending();
}

export async function runBootstrap(opts?: BootstrapOptions): Promise<BootstrapResult> {
  if (!window.desktop?.runBootstrap) {
    return { ok: false, message: 'Bootstrap is only available in the desktop app.' };
  }
  return window.desktop.runBootstrap(opts);
}

export async function clearSetupPending(): Promise<void> {
  await window.desktop?.clearSetupPending?.();
}

export async function markBootstrapComplete(): Promise<void> {
  await window.desktop?.markBootstrapComplete?.();
}
