import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  checkAiHealth,
  runBootstrap,
  getSetupPending,
  clearSetupPending,
} from '../services/ai/healthCheck';
import { saveDesktopLlmSettings, clearDesktopSettingsCache } from '../services/desktopSettings';
import type { SetupPending } from '../services/ai/healthTypes';

interface OllamaBootstrapProps {
  onReady: () => void;
  onUseGemini: () => void;
}

const OllamaBootstrap: React.FC<OllamaBootstrapProps> = ({ onReady, onUseGemini }) => {
  const [log, setLog] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthReady, setHealthReady] = useState(false);
  const [pending, setPending] = useState<SetupPending | null>(null);
  const started = useRef(false);

  const refreshHealth = useCallback(async () => {
    const report = await checkAiHealth({ provider: 'ollama' });
    setHealthReady(report.ready);
    return report;
  }, []);

  useEffect(() => {
    if (!window.desktop?.onPullProgress) return;
    return window.desktop.onPullProgress((ev) => {
      if (ev.line) setLog((prev) => prev + ev.line);
      if (ev.done) setBusy(false);
    });
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      const p = await getSetupPending();
      setPending(p);
      setBusy(true);
      setError(null);
      setLog('Setting up local AI for RawGraded Studio…\n\n');

      const preCheck = await refreshHealth();
      if (preCheck.ready) {
        setLog((prev) => prev + 'Local AI is already ready.\n');
        setBusy(false);
        return;
      }

      const result = await runBootstrap({
        installOllama: p?.installOllama ?? true,
        pullModel: p?.pullModel ?? true,
        model: p?.model,
      });

      clearDesktopSettingsCache();
      const report = await refreshHealth();

      if (!result.ok && !report.ready) {
        setError(result.message);
      }
      setBusy(false);
    })();
  }, [refreshHealth]);

  const handleRetry = async () => {
    setBusy(true);
    setError(null);
    setLog((prev) => prev + '\n--- Retry ---\n');
    const result = await runBootstrap({
      installOllama: pending?.installOllama ?? true,
      pullModel: pending?.pullModel ?? true,
      model: pending?.model,
    });
    clearDesktopSettingsCache();
    await refreshHealth();
    if (!result.ok) setError(result.message);
    setBusy(false);
  };

  const handleUseGemini = async () => {
    await clearSetupPending();
    if (window.desktop?.setSettings) {
      await window.desktop.setSettings({ llmProvider: 'gemini', bootstrapComplete: true });
    }
    await saveDesktopLlmSettings({ llmProvider: 'gemini' });
    clearDesktopSettingsCache();
    onUseGemini();
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="p-6 text-center border-b border-white/10">
        <h1 className="text-xl font-black uppercase tracking-widest text-poke-gold">RawGraded Studio</h1>
        <p className="text-sm text-gray-400 mt-2">Setting up local AI (Ollama)</p>
      </header>

      <div className="flex-1 max-w-lg w-full mx-auto p-6 space-y-4">
        {busy && (
          <div className="flex justify-center py-6">
            <div className="w-10 h-10 border-2 border-poke-gold border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <p className="text-xs text-gray-500 uppercase tracking-widest text-center">
          {busy ? 'Installing prerequisites…' : healthReady ? 'Ready' : 'Needs attention'}
        </p>

        {error && (
          <p className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded p-3">{error}</p>
        )}

        {log && (
          <pre className="text-[10px] text-gray-500 bg-[#0a0a0a] border border-white/10 rounded p-3 max-h-48 overflow-auto whitespace-pre-wrap">
            {log}
          </pre>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!healthReady || busy}
            onClick={onReady}
            className="w-full py-3 bg-poke-gold text-black font-bold uppercase tracking-widest rounded disabled:opacity-40"
          >
            Continue to Studio
          </button>
          {!busy && !healthReady && (
            <button
              type="button"
              onClick={handleRetry}
              className="w-full py-2 bg-gray-800 text-gray-200 text-xs font-bold uppercase tracking-widest rounded"
            >
              Retry setup
            </button>
          )}
          <button
            type="button"
            onClick={handleUseGemini}
            className="w-full py-2 text-xs text-gray-500 uppercase tracking-widest hover:text-gray-300"
          >
            Use Gemini (cloud) instead
          </button>
        </div>
      </div>
    </div>
  );
};

export default OllamaBootstrap;
