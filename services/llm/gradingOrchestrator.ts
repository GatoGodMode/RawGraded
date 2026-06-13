import { loadDesktopLlmSettings } from '../desktopSettings';
import { checkAiHealth } from '../ai/healthCheck';
import type { GradingResult } from '../../types';
import { geminiProvider } from './geminiProvider';
import { ollamaProvider } from './ollamaProvider';
import type { LlmProvider, RunGradingInput } from './types';

const providers = {
  gemini: geminiProvider,
  ollama: ollamaProvider,
};

export async function getActiveLlmProvider(): Promise<LlmProvider> {
  const s = await loadDesktopLlmSettings();
  return providers[s.llmProvider] || geminiProvider;
}

export async function runStudioGrading(input: RunGradingInput): Promise<GradingResult | null> {
  const health = await checkAiHealth();
  if (!health.ready) {
    if (health.provider === 'ollama') {
      if (!health.ollama.installed) throw new Error('Install Ollama from the launcher before grading.');
      if (!health.ollama.running) throw new Error('Start Ollama from the launcher before grading.');
      if (!health.ollama.modelPresent) throw new Error('Download the vision model from the launcher before grading.');
    } else {
      throw new Error('Add a Gemini API key in the launcher before grading.');
    }
  }

  const settings = await loadDesktopLlmSettings();
  if (settings.llmProvider === 'gemini' && !settings.geminiApiKey) {
    throw new Error('Add a Gemini API key in Settings, or switch to Ollama.');
  }
  const provider = await getActiveLlmProvider();
  return provider.runFullGrading({
    ...input,
    useMeasuredCentering: input.useMeasuredCentering ?? true,
  });
}
