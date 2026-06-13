import React, { useMemo, useState } from 'react';
import { resizeImage, generateImageHash } from '../services/imageUtils';
import { identifyCollectOnly } from '../services/geminiService';

type CreditMode = 'free' | 'paid';

type Slot = {
  id: string;
  frontDataUrl?: string | null;
  backDataUrl?: string | null;
  frontHash?: string | null;
  backHash?: string | null;
};

interface CollectOnlyModePluginProps {
  freeCredits: number;
  paidCredits: number;
  onUpgradeClick?: () => void;
  onDone?: () => void;
  onRefreshUser?: () => Promise<void> | void;
}

const MAX_PAID_CARDS = 10;

const fileToDataUrl = async (file: File): Promise<string> => {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve((ev.target?.result as string) || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const CollectOnlyModePlugin: React.FC<CollectOnlyModePluginProps> = ({
  freeCredits,
  paidCredits,
  onUpgradeClick,
  onDone,
  onRefreshUser,
}) => {
  const [open, setOpen] = useState(false);
  const [creditMode, setCreditMode] = useState<CreditMode>('free');
  const [slots, setSlots] = useState<Slot[]>(() => [{ id: crypto.randomUUID() }]);

  const [isRunning, setIsRunning] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState<string>('');

  const maxCards = useMemo(() => (creditMode === 'paid' ? MAX_PAID_CARDS : 1), [creditMode]);
  const canUseFree = freeCredits > 0;
  const canUsePaid = paidCredits > 0;

  const visibleSlots = slots.slice(0, maxCards);

  const resetToPlan = (mode: CreditMode) => {
    setCreditMode(mode);
    if (mode === 'free') setSlots((prev) => prev.length ? [prev[0]] : [{ id: crypto.randomUUID() }]);
  };

  const handleAddSlot = () => {
    if (slots.length >= MAX_PAID_CARDS) return;
    setSlots((prev) => [...prev, { id: crypto.randomUUID() }]);
  };

  const handleRemoveSlot = (slotId: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== slotId));
  };

  const setSlotImage = async (slotId: string, side: 'front' | 'back', file: File) => {
    const raw = await fileToDataUrl(file);
    const resized = await resizeImage(raw, 1024, 0.72);
    const hash = await generateImageHash(resized);
    setSlots((prev) =>
      prev.map((s) =>
        s.id !== slotId
          ? s
          : {
              ...s,
              ...(side === 'front'
                ? { frontDataUrl: resized, frontHash: hash }
                : { backDataUrl: resized, backHash: hash }),
            }
      )
    );
  };

  const run = async () => {
    setIsRunning(true);
    setError('');
    setLoadingMsg('');

    try {
      if (creditMode === 'free' && !canUseFree) {
        setError('No free credits remaining.');
        return;
      }
      if (creditMode === 'paid' && !canUsePaid) {
        if (onUpgradeClick) onUpgradeClick();
        setError('Insufficient pro credits.');
        return;
      }

      const usedSlots = visibleSlots;
      if (usedSlots.length < 1) {
        setError('Add at least one card.');
        return;
      }

      // Validate inputs before AI calls.
      for (let i = 0; i < usedSlots.length; i++) {
        const s = usedSlots[i];
        if (!s.frontDataUrl || !s.frontHash) throw new Error(`Missing front image for card #${i + 1}.`);
      }

      const payloadCards: any[] = [];

      for (let i = 0; i < usedSlots.length; i++) {
        const s = usedSlots[i];
        const backData = s.backDataUrl || s.frontDataUrl; // front-only submission
        const backHash = s.backHash || s.frontHash;

        setLoadingMsg(`Identifying card ${i + 1}/${usedSlots.length} (TCGDex + Gemini Flash)…`);

        const result = await identifyCollectOnly(s.frontDataUrl!, backData!, 'Pokemon');
        if (!result) throw new Error(`AI identification failed for card #${i + 1}.`);

        payloadCards.push({
          id: s.id,
          front_img: s.frontDataUrl,
          back_img: backData,
          front_hash: s.frontHash,
          back_hash: backHash,
          metadata: {
            name: result.detectedName,
            category: 'Pokemon',
            set: result.detectedSet,
            character: result.detectedCharacter,
            year: result.detectedYear,
            edition: result.detectedEdition,
            number: result.detectedCardNumber,
            artist: result.detectedArtist,
            is_first_edition: result.isFirstEdition ? 1 : 0,
            is_holographic: result.isHolographic ? 1 : 0,
            holo_pattern: result.holoPattern || 'none',
            rarity: result.rarity || null,
          },
          ai_description: result.aiDescription,
        });
      }

      setLoadingMsg('Saving to vault…');
      const res = await fetch('api/plugin_collect_only.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credit_mode: creditMode, cards: payloadCards }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `Collect Only failed (HTTP ${res.status}).`;
        if (res.status === 402 && onUpgradeClick) onUpgradeClick();
        throw new Error(msg);
      }

      // Refresh credit UI + vault list.
      if (onRefreshUser) await onRefreshUser();
      if (onDone) onDone();

      setOpen(false);
    } catch (e: any) {
      console.error('[CollectOnlyModePlugin]', e);
      setError(e?.message || 'Collect Only failed.');
    } finally {
      setIsRunning(false);
      setLoadingMsg('');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError('');
          setLoadingMsg('');
          setIsRunning(false);
          setCreditMode('free');
          setSlots([{ id: crypto.randomUUID() }]);
        }}
        className="w-full py-2.5 bg-white/5 border border-white/10 text-[10px] font-black uppercase text-white/70 tracking-[0.15em] hover:bg-white/10 hover:border-white/30 transition-all shadow flex items-center justify-center gap-2"
        title="Instant identification + vaulting (no numeric grades)"
      >
        <i className="fas fa-layer-plus text-[#D4AF37]"></i> Collect Only Mode
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[130] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => {
            if (!isRunning) setOpen(false);
          }}
        >
          <div
            className="bg-[#0a0a0a] border border-white/10 w-full max-w-2xl rounded-2xl p-6 shadow-[0_0_60px_rgba(212,175,55,0.08)] relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => !isRunning && setOpen(false)}
              disabled={isRunning}
              className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-md text-white/20 hover:text-white/60 transition-colors disabled:opacity-40"
              aria-label="Close"
            >
              <i className="fas fa-times text-[12px]"></i>
            </button>

            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <i className="fas fa-wand-magic-sparkles text-[#D4AF37] text-[11px]"></i>
                <h3 className="text-[13px] font-black text-white uppercase tracking-[0.15em]">
                  Collect Only Mode
                </h3>
              </div>
              <p className="text-[10px] text-white/30 leading-relaxed">
                Instant TCGDex + Gemini Flash identification and AI description. No numeric grades or defects.
              </p>
            </div>

            <div className="flex gap-3 mb-4">
              <button
                type="button"
                onClick={() => resetToPlan('free')}
                disabled={isRunning}
                className={`flex-1 py-2 rounded-lg border transition-all text-[11px] font-black uppercase tracking-widest ${
                  creditMode === 'free'
                    ? 'bg-[#D4AF37]/15 border-[#D4AF37]/40 text-[#D4AF37]'
                    : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:border-white/30'
                }`}
              >
                Free: 1 card / 1 credit
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!canUsePaid && onUpgradeClick) {
                    onUpgradeClick();
                  }
                  resetToPlan('paid');
                }}
                disabled={isRunning}
                className={`flex-1 py-2 rounded-lg border transition-all text-[11px] font-black uppercase tracking-widest ${
                  creditMode === 'paid'
                    ? 'bg-[#990000]/15 border-[#990000]/40 text-[#FF6B6B]'
                    : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:border-white/30'
                }`}
              >
                Pro: up to 10 cards / 1 credit
              </button>
            </div>

            <div className="space-y-4">
              {visibleSlots.map((s, idx) => (
                <div key={s.id} className="border border-white/10 rounded-xl p-4 space-y-3 bg-white/[0.02]">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/60">
                      Card {idx + 1} of {maxCards}
                    </p>
                    {creditMode === 'paid' && visibleSlots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSlot(s.id)}
                        disabled={isRunning}
                        className="text-[10px] text-red-400 hover:text-white transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black uppercase tracking-widest text-white/30 block">
                        Front (required)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={isRunning}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setSlotImage(s.id, 'front', f).catch((err) => {
                            console.error(err);
                            setError('Front upload failed.');
                          });
                          e.currentTarget.value = '';
                        }}
                        className="w-full text-[10px] text-white/40"
                      />
                      {s.frontDataUrl && (
                        <img src={s.frontDataUrl} alt="" className="w-full h-28 object-cover rounded-lg border border-white/10 bg-black/30" />
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black uppercase tracking-widest text-white/30 block">
                        Back (optional)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={isRunning}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setSlotImage(s.id, 'back', f).catch((err) => {
                            console.error(err);
                            setError('Back upload failed.');
                          });
                          e.currentTarget.value = '';
                        }}
                        className="w-full text-[10px] text-white/40"
                      />
                      {s.backDataUrl ? (
                        <img src={s.backDataUrl} alt="" className="w-full h-28 object-cover rounded-lg border border-white/10 bg-black/30" />
                      ) : s.frontDataUrl ? (
                        <p className="text-[10px] text-white/30 italic">Will reuse front</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}

              {creditMode === 'paid' && visibleSlots.length < MAX_PAID_CARDS && (
                <button
                  type="button"
                  onClick={handleAddSlot}
                  disabled={isRunning}
                  className="w-full py-3 bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-[0.15em] hover:bg-white/10 hover:border-white/30 transition-all shadow flex items-center justify-center gap-2"
                >
                  <i className="fas fa-plus"></i> Add another card slot
                </button>
              )}
            </div>

            {error && (
              <div className="mt-4 border border-red-500/25 bg-red-900/10 text-red-400/80 rounded-lg p-3 text-[10px] font-bold uppercase tracking-widest text-center">
                {error}
              </div>
            )}

            {isRunning && (
              <div className="mt-4 text-[11px] text-[#D4AF37]/70 font-black uppercase tracking-widest flex items-center gap-2">
                <i className="fas fa-circle-notch fa-spin"></i> {loadingMsg || 'Processing…'}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isRunning}
                className="flex-1 py-3 border border-white/10 bg-white/5 text-white/50 font-black uppercase tracking-widest text-[10px] rounded-xl hover:bg-white/10 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={isRunning}
                className="flex-1 py-3 bg-[#D4AF37]/15 hover:bg-[#D4AF37]/25 border border-[#D4AF37]/30 text-[#D4AF37] font-black uppercase tracking-widest text-[10px] rounded-xl transition-all disabled:opacity-40"
              >
                <i className="fas fa-bolt mr-2"></i> Collect & Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CollectOnlyModePlugin;

