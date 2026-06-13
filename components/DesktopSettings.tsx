import React, { useState, useEffect } from 'react';
import { clearDesktopSettingsCache, loadDesktopLlmSettings, saveDesktopLlmSettings } from '../services/desktopSettings';
import { clearGeminiApiKeyCache } from '../services/geminiService';
import type { LlmProviderId, LocalAnalysisDepth, LocalImageCompressionPreset } from '../services/llm/types';
import { LOCAL_IMAGE_PRESETS } from '../services/llm/localImagePrep';

interface DesktopSettingsProps {
  onClose: () => void;
}

const DesktopSettings: React.FC<DesktopSettingsProps> = ({ onClose }) => {
  const [llmProvider, setLlmProvider] = useState<LlmProviderId>('gemini');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://127.0.0.1:11434');
  const [ollamaModel, setOllamaModel] = useState('rawgraded-local');
  const [skipVideoByDefault, setSkipVideoByDefault] = useState(false);
  const [useMeasuredCentering, setUseMeasuredCentering] = useState(true);
  const [localImageCompressionEnabled, setLocalImageCompressionEnabled] = useState(false);
  const [localImageCompressionPreset, setLocalImageCompressionPreset] = useState<LocalImageCompressionPreset>('full');
  const [localAnalysisDepth, setLocalAnalysisDepth] = useState<LocalAnalysisDepth>('standard');
  const [autoCaptureWhenGreen, setAutoCaptureWhenGreen] = useState(false);
  const [ollamaTest, setOllamaTest] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const s = window.desktop?.getSettingsFull
        ? await window.desktop.getSettingsFull()
        : await loadDesktopLlmSettings();
      setLlmProvider(s.llmProvider as LlmProviderId);
      setGeminiApiKey(s.geminiApiKey || '');
      setOllamaBaseUrl(s.ollamaBaseUrl || 'http://127.0.0.1:11434');
      setOllamaModel(s.ollamaModel || 'rawgraded-local');
      setSkipVideoByDefault(s.skipVideoByDefault ?? false);
      setUseMeasuredCentering(s.useMeasuredCentering ?? true);
      setLocalImageCompressionEnabled(s.localImageCompressionEnabled ?? false);
      setLocalImageCompressionPreset(s.localImageCompressionPreset ?? 'full');
      setLocalAnalysisDepth(s.localAnalysisDepth ?? 'standard');
      setAutoCaptureWhenGreen(s.autoCaptureWhenGreen ?? false);
    })();
  }, []);

  const handleSave = async () => {
    const partial = {
      llmProvider,
      geminiApiKey,
      ollamaBaseUrl,
      ollamaModel,
      skipVideoByDefault,
      useMeasuredCentering,
      localImageCompressionEnabled,
      localImageCompressionPreset,
      localAnalysisDepth,
      autoCaptureWhenGreen,
    };
    if (window.desktop?.setSettings) {
      await window.desktop.setSettings(partial);
    } else {
      await saveDesktopLlmSettings(partial);
    }
    clearDesktopSettingsCache();
    clearGeminiApiKeyCache();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testOllama = async () => {
    setOllamaTest('Testing...');
    const opts = { baseUrl: ollamaBaseUrl, model: ollamaModel };
    if (window.desktop?.testOllama) {
      const r = await window.desktop.testOllama(opts);
      if (r.ok) {
        const modelNote = r.modelPresent ? 'Model ready.' : `Model "${ollamaModel}" not found — use launcher to pull it.`;
        setOllamaTest(`Connected. Models: ${(r.models || []).slice(0, 5).join(', ')}. ${modelNote}`);
      } else setOllamaTest(`Failed: ${r.error}`);
    } else {
      const report = await import('../services/ai/healthCheck').then((m) =>
        m.checkAiHealth({ ...opts, provider: 'ollama' })
      );
      if (report.ollama.running) {
        setOllamaTest(
          `Running. ${report.ollama.models.length} model(s). ${report.ollama.modelPresent ? 'Vision model ready.' : 'Vision model missing.'}`
        );
      } else {
        setOllamaTest(`Failed: ${report.ollama.error || 'Not reachable'}`);
      }
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold uppercase tracking-widest text-poke-gold">Studio Settings</h2>
        <button type="button" onClick={onClose} className="text-xs text-gray-400 uppercase tracking-widest">
          Close
        </button>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xs text-gray-500 uppercase tracking-widest mb-2">AI Provider</legend>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={llmProvider === 'gemini'} onChange={() => setLlmProvider('gemini')} />
          <span className="text-sm">Google Gemini (your API key)</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={llmProvider === 'ollama'} onChange={() => setLlmProvider('ollama')} />
          <span className="text-sm">Ollama (local, private)</span>
        </label>
      </fieldset>

      {llmProvider === 'gemini' && (
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-widest">Gemini API Key</label>
          <input
            type="password"
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            className="w-full mt-1 bg-[#111] border border-white/20 rounded px-3 py-2 text-sm"
            placeholder="AIza..."
          />
        </div>
      )}

      {llmProvider === 'ollama' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Install <a href="https://ollama.com" className="text-poke-gold underline" target="_blank" rel="noopener noreferrer">Ollama</a>
            , then run: <code className="text-gray-300">ollama pull llama3.2-vision</code>
            {' '}and <code className="text-gray-300">ollama create rawgraded-local -f models\rawgraded-local\Modelfile</code>
          </p>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-widest">Base URL</label>
            <input
              value={ollamaBaseUrl}
              onChange={(e) => setOllamaBaseUrl(e.target.value)}
              className="w-full mt-1 bg-[#111] border border-white/20 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-widest">Vision model</label>
            <input
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              className="w-full mt-1 bg-[#111] border border-white/20 rounded px-3 py-2 text-sm"
            />
          </div>
          <button type="button" onClick={testOllama} className="text-xs text-poke-blue font-bold uppercase tracking-widest">
            Test Ollama
          </button>
          {ollamaTest && <p className="text-xs text-gray-400">{ollamaTest}</p>}
        </div>
      )}

      {llmProvider === 'ollama' && (
        <fieldset className="space-y-3 border border-white/10 rounded p-4">
          <legend className="text-xs text-gray-500 uppercase tracking-widest px-1">Local image quality</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={localImageCompressionEnabled}
              onChange={(e) => setLocalImageCompressionEnabled(e.target.checked)}
            />
            Enable compression (smaller/faster, less detail)
          </label>
          {localImageCompressionEnabled ? (
            <div className="space-y-2">
              {LOCAL_IMAGE_PRESETS.map((preset) => (
                <label key={preset.id} className="flex items-start gap-2 cursor-pointer text-sm" title={preset.tooltip}>
                  <input
                    type="radio"
                    checked={localImageCompressionPreset === preset.id}
                    onChange={() => setLocalImageCompressionPreset(preset.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{preset.label}</span>
                    <span className="block text-xs text-gray-500">{preset.tooltip}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500" title={LOCAL_IMAGE_PRESETS[0].tooltip}>
              Full detail mode: 2048px, JPEG 0.92. Recommended 8GB+ VRAM / 16GB RAM.
            </p>
          )}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-widest">Local analysis depth</label>
            <select
              value={localAnalysisDepth}
              onChange={(e) => setLocalAnalysisDepth(e.target.value as LocalAnalysisDepth)}
              className="w-full mt-1 bg-[#111] border border-white/20 rounded px-3 py-2 text-sm"
            >
              <option value="standard">Standard (faster)</option>
              <option value="deep">Deep (more detailed, ~2× time)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Deep mode uses a 3×3 forensic grid per face, front-only identity bands, and a final synthesis pass (slower, more accurate).
            </p>
          </div>
        </fieldset>
      )}

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={skipVideoByDefault} onChange={(e) => setSkipVideoByDefault(e.target.checked)} />
          Skip guided video scan after centering
        </label>
        <p className="text-xs text-gray-500 pl-6">
          When off, Studio records tilt/macro frames before analysis (recommended for local Ollama grading).
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={useMeasuredCentering} onChange={(e) => setUseMeasuredCentering(e.target.checked)} />
        Use measured centering for grade
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={autoCaptureWhenGreen} onChange={(e) => setAutoCaptureWhenGreen(e.target.checked)} />
        Auto-capture webcam stills when frame is sharp (front/back)
      </label>

      <button
        type="button"
        onClick={handleSave}
        className="w-full py-3 bg-poke-gold text-black font-bold uppercase tracking-widest rounded"
      >
        {saved ? 'Saved' : 'Save settings'}
      </button>

      <p className="text-center text-xs text-gray-500 pt-2">
        <a
          href="https://rawgraded.com/privacy-policy.html#rawgraded"
          target="_blank"
          rel="noopener noreferrer"
          className="text-poke-gold hover:underline"
        >
          Privacy Policy
        </a>
      </p>
    </div>
  );
};

export default DesktopSettings;
