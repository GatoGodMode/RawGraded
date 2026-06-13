import React, { useState, useEffect } from 'react';
import { clearDesktopSettingsCache, loadDesktopLlmSettings, saveDesktopLlmSettings } from '../services/desktopSettings';
import { clearGeminiApiKeyCache } from '../services/geminiService';
import type { MobileStudioSettings } from '../services/platform/mobileSettings';

interface MobileSettingsProps {
  onClose: () => void;
}

const MobileSettings: React.FC<MobileSettingsProps> = ({ onClose }) => {
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [skipVideoByDefault, setSkipVideoByDefault] = useState(true);
  const [useMeasuredCentering, setUseMeasuredCentering] = useState(true);
  const [geminiFreeTierMode, setGeminiFreeTierMode] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadDesktopLlmSettings().then((s) => {
      const m = s as MobileStudioSettings;
      setGeminiApiKey(s.geminiApiKey || '');
      setSkipVideoByDefault(s.skipVideoByDefault ?? true);
      setUseMeasuredCentering(s.useMeasuredCentering ?? true);
      setGeminiFreeTierMode(m.geminiFreeTierMode ?? true);
    });
  }, []);

  const handleSave = async () => {
    const partial = {
      llmProvider: 'gemini' as const,
      geminiApiKey,
      skipVideoByDefault,
      useMeasuredCentering,
      geminiFreeTierMode,
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

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold uppercase tracking-widest text-poke-gold">Studio Settings</h2>
        <button type="button" onClick={onClose} className="text-xs text-gray-400 uppercase tracking-widest">
          Close
        </button>
      </div>

      <div>
        <label className="text-xs text-gray-500 uppercase tracking-widest">Gemini API Key</label>
        <input
          type="password"
          value={geminiApiKey}
          onChange={(e) => setGeminiApiKey(e.target.value)}
          className="w-full mt-1 bg-[#111] border border-white/20 rounded px-3 py-2 text-sm"
          placeholder="AIza..."
          autoComplete="off"
        />
        <p className="text-xs text-gray-500 mt-2">
          Get a free key from{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-poke-gold underline"
          >
            Google AI Studio
          </a>
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={geminiFreeTierMode}
          onChange={(e) => setGeminiFreeTierMode(e.target.checked)}
        />
        <span>
          <span className="text-white font-medium">Free tier mode</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Uses Gemini Flash for forensics (~1,500 requests/day on free tier). Turn off for Pro-quality Phase 2.
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={skipVideoByDefault} onChange={(e) => setSkipVideoByDefault(e.target.checked)} />
        Skip video capture by default
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={useMeasuredCentering} onChange={(e) => setUseMeasuredCentering(e.target.checked)} />
        Use measured centering for grade
      </label>

      <button
        type="button"
        onClick={handleSave}
        className="w-full py-3 bg-poke-gold text-black font-bold uppercase tracking-widest rounded"
      >
        {saved ? 'Saved' : 'Save settings'}
      </button>
    </div>
  );
};

export default MobileSettings;
