import React, { useState } from 'react';
import type { PcSearchCandidate } from '../../services/portfolio/portfolioBridgeTypes';
import { canonicalizePricechartingUrl } from '../../services/pricing/pricechartingCanonical';

const truncateUrl = (url: string, max = 48): string =>
  url.length <= max ? url : `${url.slice(0, max - 1)}…`;

export const PriceChartingPickModal: React.FC<{
  open: boolean;
  candidates: PcSearchCandidate[];
  searchUrl?: string;
  loading?: boolean;
  onPick: (url: string) => void;
  onClose: () => void;
}> = ({ open, candidates, searchUrl, loading = false, onPick, onClose }) => {
  const [manualUrl, setManualUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  if (!open) return null;

  const openSearch = () => {
    if (searchUrl && window.desktop?.shellOpenExternal) {
      void window.desktop.shellOpenExternal(searchUrl);
    }
  };

  const openCandidate = (url: string) => {
    if (window.desktop?.shellOpenExternal) {
      void window.desktop.shellOpenExternal(url);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      setUrlError('Could not copy to clipboard.');
    }
  };

  const pasteFromClipboard = async () => {
    setUrlError('');
    try {
      const text = await navigator.clipboard.readText();
      setManualUrl(text.trim());
    } catch {
      setUrlError('Could not read clipboard — paste manually with Ctrl+V.');
    }
  };

  const applyManualUrl = () => {
    setUrlError('');
    const canonical = canonicalizePricechartingUrl(manualUrl);
    if (!canonical) {
      setUrlError('Enter a valid PriceCharting product URL (pricecharting.com).');
      return;
    }
    onPick(canonical);
  };

  return (
    <div className="fixed inset-0 z-[130] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-[#080808] p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-poke-gold">Pick PriceCharting listing</h3>
            <p className="text-xs text-gray-500 mt-2">
              Multiple products match this card. Choose the correct listing — raw price will not be saved until one resolves.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-white">
            Close
          </button>
        </div>

        {candidates.length > 0 ? (
          <ul className="space-y-2 max-h-48 overflow-auto">
            {candidates.map((c) => (
              <li key={c.url} className="rounded border border-white/10 bg-black/40 p-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium truncate">{c.label}</p>
                  {c.setHint && <p className="text-[10px] text-gray-500 mt-0.5">{c.setHint}</p>}
                  {c.cardNumber && <p className="text-[10px] text-gray-600">#{c.cardNumber}</p>}
                  <p className="text-[10px] text-gray-600 mt-1 truncate select-all" title={c.url}>
                    {truncateUrl(c.url, 56)}
                  </p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => onPick(c.url)}
                    className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded bg-poke-gold text-black disabled:opacity-40"
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    onClick={() => openCandidate(c.url)}
                    className="px-3 py-1 text-[10px] uppercase text-gray-500 hover:text-white"
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyLink(c.url)}
                    className="px-3 py-1 text-[10px] uppercase text-gray-500 hover:text-white"
                  >
                    {copiedUrl === c.url ? 'Copied' : 'Copy link'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500">No automatic matches — paste a product URL below or search PriceCharting.</p>
        )}

        <fieldset className="space-y-2 border border-white/10 rounded p-3">
          <legend className="text-[10px] font-bold uppercase tracking-widest text-gray-500 px-1">Paste product URL</legend>
          <p className="text-[10px] text-gray-600">
            Found the right listing in your browser? Copy its URL from the address bar and paste here.
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={manualUrl}
              onChange={(e) => {
                setManualUrl(e.target.value);
                setUrlError('');
              }}
              placeholder="https://www.pricecharting.com/game/..."
              className="flex-1 min-w-0 rounded border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-gray-600"
              disabled={loading}
            />
            {window.desktop?.shellOpenExternal && (
              <button
                type="button"
                onClick={() => void pasteFromClipboard()}
                disabled={loading}
                className="shrink-0 px-3 py-2 text-[10px] font-bold uppercase tracking-widest rounded border border-white/20 text-gray-400 hover:text-white disabled:opacity-40"
              >
                Paste
              </button>
            )}
          </div>
          {urlError && <p className="text-[10px] text-red-400">{urlError}</p>}
          <button
            type="button"
            disabled={loading || !manualUrl.trim()}
            onClick={applyManualUrl}
            className="w-full py-2 text-[10px] font-bold uppercase tracking-widest rounded bg-poke-gold text-black disabled:opacity-40"
          >
            Apply URL
          </button>
        </fieldset>

        {searchUrl && (
          <button
            type="button"
            onClick={openSearch}
            className="w-full py-2 text-[10px] font-bold uppercase tracking-widest rounded border border-poke-gold/30 text-poke-gold"
          >
            Search on PriceCharting
          </button>
        )}
      </div>
    </div>
  );
};

export default PriceChartingPickModal;
