import React, { useState, useEffect, useCallback } from 'react';
import type { AiHealthReport } from '../services/ai/healthTypes';
import {
  checkAiHealth,
  installOllama,
  pullOllamaModel,
  ensureOllamaRunning,
} from '../services/ai/healthCheck';
import { saveDesktopLlmSettings, clearDesktopSettingsCache } from '../services/desktopSettings';
import { clearGeminiApiKeyCache } from '../services/geminiService';
import type { LlmProviderId } from '../services/llm/types';

type LauncherStep = 'choose' | 'ollama' | 'gemini';

interface AiLauncherProps {
  onReady: () => void;
  onOpenSettings?: () => void;
}

const StatusRow: React.FC<{ ok: boolean; label: string; hint?: string }> = ({ ok, label, hint }) => (
  <div className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
    <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${ok ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}>
      {ok ? '✓' : '·'}
    </span>
    <div>
      <p className={`text-sm ${ok ? 'text-white' : 'text-gray-400'}`}>{label}</p>
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  </div>
);

const AiLauncher: React.FC<AiLauncherProps> = ({ onReady, onOpenSettings }) => {
  const [step, setStep] = useState<LauncherStep>('choose');
  const [health, setHealth] = useState<AiHealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [ollamaModel, setOllamaModel] = useState('rawgraded-local');

  const refresh = useCallback(async (provider?: LlmProviderId) => {
    setLoading(true);
    try {
      const report = await checkAiHealth(provider ? { provider } : undefined);
      setHealth(report);
      if (report.ready) return report;
    } finally {
      setLoading(false);
    }
    return null;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!window.desktop?.onPullProgress) return;
    return window.desktop.onPullProgress((ev) => {
      if (ev.line) setLog((prev) => prev + ev.line);
      if (ev.done) setBusy('');
    });
  }, []);

  const selectProvider = async (provider: LlmProviderId) => {
    await saveDesktopLlmSettings({ llmProvider: provider });
    if (window.desktop?.setSettings) await window.desktop.setSettings({ llmProvider: provider });
    clearDesktopSettingsCache();
    setStep(provider === 'ollama' ? 'ollama' : 'gemini');
    await refresh(provider);
  };

  const handleInstallOllama = async () => {
    setBusy('Installing Ollama…');
    setLog('');
    const result = await installOllama();
    setLog(result.message + '\n');
    setBusy('');
    await refresh('ollama');
  };

  const handleEnsureRunning = async () => {
    setBusy('Starting Ollama…');
    const result = await ensureOllamaRunning();
    setLog(result.message + '\n');
    setBusy('');
    await refresh('ollama');
  };

  const handlePullModel = async () => {
    setBusy('Downloading model…');
    setLog('');
    if (window.desktop?.setSettings) {
      await window.desktop.setSettings({ ollamaModel });
    }
    await saveDesktopLlmSettings({ ollamaModel });
    const result = await pullOllamaModel(ollamaModel);
    if (!result.ok) setLog((l) => l + result.message);
    setBusy('');
    await refresh('ollama');
  };

  const handleSaveGemini = async () => {
    if (!geminiKey.trim()) return;
    setBusy('Saving…');
    const partial = { llmProvider: 'gemini' as const, geminiApiKey: geminiKey.trim() };
    if (window.desktop?.setSettings) await window.desktop.setSettings(partial);
    await saveDesktopLlmSettings(partial);
    clearDesktopSettingsCache();
    clearGeminiApiKeyCache();
    setBusy('');
    const report = await refresh('gemini');
    if (report?.ready) onReady();
  };

  const handleContinue = async () => {
    const report = await refresh();
    if (report?.ready) onReady();
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="p-6 text-center border-b border-white/10">
        <h1 className="text-xl font-black uppercase tracking-widest text-poke-gold">RawGraded Studio</h1>
        <p className="text-sm text-gray-400 mt-2">Set up AI grading before you scan cards.</p>
      </header>

      <div className="flex-1 max-w-lg w-full mx-auto p-6 space-y-6">
        {step === 'choose' && (
          <>
            <p className="text-xs text-gray-500 uppercase tracking-widest">Choose your AI</p>
            <button
              type="button"
              onClick={() => selectProvider('ollama')}
              className="w-full text-left p-5 rounded-xl border-2 border-poke-gold/50 bg-poke-gold/5 hover:bg-poke-gold/10 transition-colors"
            >
              <p className="text-xs text-poke-gold font-bold uppercase tracking-widest mb-1">Recommended</p>
              <p className="font-bold text-white">Local & private (Ollama)</p>
              <p className="text-sm text-gray-400 mt-1">Free grading on your PC. We can install Ollama and the vision model for you.</p>
            </button>
            <button
              type="button"
              onClick={() => selectProvider('gemini')}
              className="w-full text-left p-5 rounded-xl border border-white/20 hover:border-white/40 transition-colors"
            >
              <p className="font-bold text-white">Cloud (Google Gemini)</p>
              <p className="text-sm text-gray-400 mt-1">Use your own API key for highest accuracy.</p>
            </button>
          </>
        )}

        {step === 'ollama' && (
          <>
            <button type="button" onClick={() => setStep('choose')} className="text-xs text-gray-500 uppercase tracking-widest hover:text-white">
              ← Change provider
            </button>
            <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Setup checklist</p>
              {loading && !health ? (
                <p className="text-sm text-gray-400">Checking…</p>
              ) : (
                <>
                  <StatusRow
                    ok={health?.ollama.installed ?? false}
                    label="Ollama installed"
                    hint={health?.ollama.installed ? health.ollama.ollamaPath : 'Required to run models locally'}
                  />
                  <StatusRow
                    ok={health?.ollama.running ?? false}
                    label="Ollama running"
                    hint={health?.ollama.error && !health?.ollama.running ? health.ollama.error : 'Service on port 11434'}
                  />
                  <StatusRow
                    ok={health?.ollama.modelPresent ?? false}
                    label={`Vision model: ${ollamaModel}`}
                    hint="~4–8 GB download for card image analysis"
                  />
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {!(health?.ollama.installed) && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={handleInstallOllama}
                  className="px-4 py-2 bg-poke-gold text-black text-xs font-bold uppercase tracking-widest rounded disabled:opacity-50"
                >
                  Install Ollama
                </button>
              )}
              {health?.ollama.installed && !health?.ollama.running && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={handleEnsureRunning}
                  className="px-4 py-2 bg-poke-blue text-white text-xs font-bold uppercase tracking-widest rounded disabled:opacity-50"
                >
                  Start Ollama
                </button>
              )}
              {health?.ollama.running && !health?.ollama.modelPresent && (
                <>
                  <input
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    className="w-full bg-[#111] border border-white/20 rounded px-3 py-2 text-sm mb-2"
                    placeholder="Model name"
                  />
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={handlePullModel}
                    className="px-4 py-2 bg-poke-gold text-black text-xs font-bold uppercase tracking-widest rounded disabled:opacity-50"
                  >
                    Download model
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={!!busy}
                onClick={() => refresh('ollama')}
                className="px-4 py-2 bg-gray-800 text-gray-300 text-xs font-bold uppercase tracking-widest rounded disabled:opacity-50"
              >
                Retry check
              </button>
            </div>

            {busy && <p className="text-xs text-poke-gold">{busy}</p>}
            {log && (
              <pre className="text-[10px] text-gray-500 bg-black border border-white/10 rounded p-3 max-h-32 overflow-auto whitespace-pre-wrap">
                {log}
              </pre>
            )}

            <button
              type="button"
              disabled={!health?.ready || !!busy}
              onClick={handleContinue}
              className="w-full py-3 bg-poke-gold text-black font-bold uppercase tracking-widest rounded disabled:opacity-40"
            >
              Continue to Studio
            </button>
          </>
        )}

        {step === 'gemini' && (
          <>
            <button type="button" onClick={() => setStep('choose')} className="text-xs text-gray-500 uppercase tracking-widest hover:text-white">
              ← Change provider
            </button>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-widest">Gemini API key</label>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className="w-full mt-1 bg-[#111] border border-white/20 rounded px-3 py-2 text-sm"
                placeholder="AIza..."
              />
              <p className="text-xs text-gray-500 mt-2">
                Get a key from{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-poke-gold underline">
                  Google AI Studio
                </a>
              </p>
            </div>
            <button
              type="button"
              disabled={!geminiKey.trim() || !!busy}
              onClick={handleSaveGemini}
              className="w-full py-3 bg-poke-gold text-black font-bold uppercase tracking-widest rounded disabled:opacity-40"
            >
              Save & continue
            </button>
          </>
        )}

        {onOpenSettings && (
          <button type="button" onClick={onOpenSettings} className="w-full text-xs text-gray-500 uppercase tracking-widest hover:text-gray-300">
            Advanced studio settings
          </button>
        )}
      </div>
    </div>
  );
};

export default AiLauncher;
