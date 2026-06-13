import React, { useState, useEffect } from 'react';
import type { CardData, UserProfile } from '../types';

interface PreSaveLinkingPluginProps {
  user: UserProfile | null;
  cardData: CardData;
  onLinkSelected: (parentId: string | null) => void;
  onVaultCopyChange: (vaultCopy: string) => void;
}

/**
 * PRE-SAVE LINKING PLUGIN
 * ------------------------
 * Allows user to search/select a parent certificate and set vault copy before saving.
 * Reduces monolithic code in App.tsx by isolating linking UI.
 */
const PreSaveLinkingPlugin: React.FC<PreSaveLinkingPluginProps> = ({ user, cardData, onLinkSelected, onVaultCopyChange }) => {
  const [linkingSearch, setLinkingSearch] = useState('');
  const [linkingResults, setLinkingResults] = useState<any[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [vaultCopyInput, setVaultCopyInput] = useState('');

  // Auto-search for similar certificates when component mounts or card metadata changes (only when logged in)
  useEffect(() => {
    if (!user?.id) {
      setLinkingResults([]);
      return;
    }
    
    const query = `${cardData.metadata.name || ''} ${cardData.metadata.set || ''}`.trim();
    if (query.length < 2) {
      setLinkingResults([]);
      return;
    }

    const autoSearch = async () => {
      setIsLoadingSuggestions(true);
      try {
        const url = `api/collection.php?user_id=${user.id}&q=${encodeURIComponent(query)}&stream=0`;
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) {
          console.warn("[PreSaveLinkingPlugin] Auto-suggest HTTP error:", resp.status);
          setLinkingResults([]);
          return;
        }
        const data = await resp.json();
        const filtered = (Array.isArray(data) ? data : []).filter((c: any) => c.id !== cardData.id).slice(0, 5);
        setLinkingResults(filtered);
      } catch (e) {
        console.warn("[PreSaveLinkingPlugin] Auto-suggest failed:", e);
        setLinkingResults([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    };

    autoSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardData.metadata.name, cardData.metadata.set, user?.id]);

  // Manual search when user types
  useEffect(() => {
    if (!linkingSearch || linkingSearch.length < 2) {
      return;
    }

    const search = async () => {
      setIsLoadingSuggestions(true);
      try {
        const url = `api/collection.php?user_id=${user?.id}&q=${encodeURIComponent(linkingSearch)}&stream=0`;
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) {
          console.error("Manual search HTTP error:", resp.status);
          setLinkingResults([]);
          setIsLoadingSuggestions(false);
          return;
        }
        const data = await resp.json();
        const filtered = (Array.isArray(data) ? data : []).filter((c: any) => c.id !== cardData.id).slice(0, 5);
        setLinkingResults(filtered);
      } catch (e) {
        console.error("Manual search failed", e);
        setLinkingResults([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    };

    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [linkingSearch, cardData.id, user]);

  const handleVaultCopyChange = (val: string) => {
    setVaultCopyInput(val);
    onVaultCopyChange(val);
  };

  // If user isn't logged in, show simplified vault copy input only
  if (!user) {
    return (
      <div className="space-y-2">
        <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider flex items-center gap-2">
          <i className="fas fa-hashtag text-poke-accent"></i> Vault Copy Number (Optional)
        </label>
        <input
          type="text"
          inputMode="numeric"
          className="w-full bg-poke-dark border border-gray-700 p-2.5 rounded-lg text-white text-sm focus:border-poke-accent outline-none"
          value={vaultCopyInput}
          onChange={(e) => handleVaultCopyChange(e.target.value)}
          placeholder="e.g. 131 (for duplicate cards)"
        />
        <p className="text-[9px] text-gray-500 italic">Log in to enable linking to previous scans.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Vault Copy Number */}
      <div className="space-y-2">
        <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider flex items-center gap-2">
          <i className="fas fa-hashtag text-poke-accent"></i> Vault Copy Number (Optional)
        </label>
        <input
          type="text"
          inputMode="numeric"
          className="w-full bg-poke-dark border border-gray-700 p-2.5 rounded-lg text-white text-sm focus:border-poke-accent outline-none"
          value={vaultCopyInput}
          onChange={(e) => handleVaultCopyChange(e.target.value)}
          placeholder="e.g. 131 (for duplicate cards)"
        />
        <p className="text-[9px] text-gray-500 italic">
          Use this to number duplicate cards (e.g., if you have 3 Pikachu from the same set, number them #1, #2, #3).
        </p>
      </div>

      {/* Pre-Link to Previous Scan */}
      <div className="space-y-2">
        <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider flex items-center gap-2">
          <i className="fas fa-link text-teal-400"></i> Link to Previous Scan (Optional)
        </label>
        <p className="text-[9px] text-gray-500 italic mb-2">
          If this is a re-grade of a card you already scanned, link it to create an audit trail.
        </p>
        <input
          type="text"
          className="w-full bg-poke-dark border border-gray-700 p-2.5 rounded-lg text-white text-sm focus:border-poke-accent outline-none"
          value={linkingSearch}
          onChange={(e) => setLinkingSearch(e.target.value)}
          placeholder="Search your collection to link..."
        />

        {isLoadingSuggestions && (
          <div className="text-center py-3 text-gray-500 text-xs">
            <i className="fas fa-spinner fa-spin mr-2"></i> Searching...
          </div>
        )}

        {linkingResults.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {linkingResults.map(cert => {
              const isCurrentParent = cert.id === cardData.parentScanId;
              return (
                <div
                  key={cert.id}
                  onClick={() => onLinkSelected(isCurrentParent ? null : cert.id)}
                  className={`flex gap-3 items-center p-3 rounded-lg border transition-all cursor-pointer ${
                    isCurrentParent
                      ? 'bg-teal-900/40 border-teal-500/50 ring-2 ring-teal-500/30'
                      : 'bg-poke-dark/50 border-gray-700 hover:border-teal-500/50 hover:bg-teal-900/20'
                  }`}
                >
                  <div className="w-12 h-16 bg-black rounded overflow-hidden flex-shrink-0">
                    {cert.has_front_img && (
                      <img
                        src={`api/collection.php?action=serve_image&id=${cert.id}&type=front`}
                        className="w-full h-full object-cover"
                        alt={cert.name}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-sm truncate">{cert.name}</p>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider">{cert.card_set} • Grade {cert.overall_grade}</p>
                    <p className="text-[9px] text-gray-500 font-mono">{new Date(cert.date_scanned).toLocaleDateString()}</p>
                  </div>
                  {isCurrentParent && (
                    <div className="flex-shrink-0">
                      <div className="bg-teal-500/20 text-teal-400 px-2 py-1 rounded text-[9px] font-black uppercase flex items-center gap-1.5">
                        <i className="fas fa-check-circle"></i> Linked
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isLoadingSuggestions && linkingResults.length === 0 && linkingSearch.length > 0 && (
          <p className="text-center py-3 text-gray-500 text-xs italic">No matches found.</p>
        )}

        {cardData.parentScanId && (
          <div className="bg-teal-900/30 border border-teal-500/30 rounded-lg p-3 flex items-center gap-3">
            <i className="fas fa-link text-teal-400 text-lg"></i>
            <div className="flex-1">
              <p className="text-teal-300 font-bold text-xs uppercase">Linked Scan</p>
              <p className="text-teal-400/80 text-[10px]">This certificate will be linked to a previous scan. Acquisition data and vault copy will be inherited if missing.</p>
            </div>
            <button
              onClick={() => onLinkSelected(null)}
              className="text-poke-accent hover:text-[#D4AF37] text-xs"
              title="Remove link"
            >
              <i className="fas fa-times-circle"></i>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PreSaveLinkingPlugin;
