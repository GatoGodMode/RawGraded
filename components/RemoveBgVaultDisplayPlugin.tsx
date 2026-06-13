import React, { useMemo, useState } from 'react';

type Side = 'front' | 'back' | 'both';

interface RemoveBgVaultDisplayPluginProps {
    certId?: string;
    slabId?: number;
    frontUrl?: string;
    backUrl?: string;
    paidCredits: number;
    isAdmin?: boolean;
    onUpgradeClick?: () => void;
    onRefreshUser?: () => Promise<void> | void;
}

const RemoveBgVaultDisplayPlugin: React.FC<RemoveBgVaultDisplayPluginProps> = ({
    certId,
    slabId,
    frontUrl = '',
    backUrl = '',
    paidCredits,
    isAdmin = false,
    onUpgradeClick,
    onRefreshUser
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [side, setSide] = useState<Side>('front');
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string>('');
    const [loadingMsg, setLoadingMsg] = useState<string>('');

    const [processed, setProcessed] = useState<{ front?: string; back?: string }>({});

    const canProcessFront = useMemo(() => !!frontUrl, [frontUrl]);
    const canProcessBack = useMemo(() => !!backUrl, [backUrl]);
    const hasProCredits = useMemo(() => (isAdmin ? true : (paidCredits || 0) > 0), [isAdmin, paidCredits]);

    const availableSides: Side[] = useMemo(() => {
        const s: Side[] = [];
        if (canProcessFront) s.push('front');
        if (canProcessBack) s.push('back');
        if (canProcessFront && canProcessBack) s.push('both');
        return s.length ? s : ['front'];
    }, [canProcessFront, canProcessBack]);

    const normalizeSide = (): Exclude<Side, 'both'>[] | 'both' => {
        if (side === 'both') return 'both';
        return [side];
    };

    const handleRun = async () => {
        setError('');
        setProcessed({});
        setIsBusy(true);
        setLoadingMsg('Calling remove.bg…');

        try {
            if (!certId && !slabId) throw new Error('Missing cert or slab id.');

            if (!hasProCredits) {
                throw new Error('Pro credits required (1 credit per background removal).');
            }

            if (side === 'front' && !canProcessFront) throw new Error('Front image not available.');
            if (side === 'back' && !canProcessBack) throw new Error('Back image not available.');
            if (side === 'both' && (!canProcessFront || !canProcessBack)) throw new Error('Both images not available.');

            const sidesPayload = side === 'both' ? ['front', 'back'] : [side];

            const resp = await fetch('api/plugin_remove_bg.php', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cert_id: certId, slab_id: slabId, sides: sidesPayload, format: 'png' })
            });

            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.success) {
                throw new Error(data?.error || `remove.bg background removal failed (HTTP ${resp.status}).`);
            }

            setProcessed({
                front: data.images?.front,
                back: data.images?.back,
            });

            setLoadingMsg('');

            // Credits may have changed; refresh the user so the UI stays accurate.
            if (onRefreshUser) await onRefreshUser();
        } catch (e: any) {
            console.error('[RemoveBgVaultDisplayPlugin]', e);
            setError(e?.message || 'Background removal failed.');

            if (!hasProCredits && onUpgradeClick) onUpgradeClick();
        } finally {
            setIsBusy(false);
        }
    };

    const sideLabel = side === 'both' ? 'Front + Back' : side === 'front' ? 'Front' : 'Back';

    return (
        <>
            <button
                onClick={(e) => { e.stopPropagation(); setIsOpen(true); }}
                className="w-8 h-8 flex items-center justify-center transition-all border bg-white/5 text-white/30 border-white/10 hover:bg-white/10 hover:text-white"
                title="Background removal preview (remove.bg)"
                disabled={isBusy}
            >
                <i className="fas fa-crop-simple"></i>
            </button>

            {isOpen && (
                <div
                    className="fixed inset-0 z-[135] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
                    onClick={() => { if (!isBusy) setIsOpen(false); }}
                >
                    <div
                        className="bg-[#0a0a0a] border border-white/10 w-full max-w-2xl rounded-2xl p-6 shadow-[0_0_60px_rgba(212,175,55,0.08)] relative"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => { if (!isBusy) setIsOpen(false); }}
                            disabled={isBusy}
                            className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-md text-white/20 hover:text-white/60 transition-colors disabled:opacity-40"
                            aria-label="Close"
                        >
                            <i className="fas fa-times text-[12px]"></i>
                        </button>

                        <div className="mb-4">
                            <div className="flex items-center gap-2 mb-1">
                                <i className="fas fa-magic text-[#D4AF37] text-[11px]"></i>
                                <h3 className="text-[13px] font-black text-white uppercase tracking-[0.15em]">
                                    Background Removal Preview
                                </h3>
                            </div>
                            <p className="text-[10px] text-white/30 leading-relaxed">
                                Uses remove.bg to strip the background so you can preview a clean “cut-out” display for your vault.
                            </p>
                        </div>

                        <div className="mb-4 border border-[#D4AF37]/25 bg-[#D4AF37]/10 rounded-lg p-3 text-[10px] text-[#D4AF37]/80 uppercase font-bold tracking-widest">
                            <span className="text-white/90 normal-case tracking-normal font-bold">
                                Each background removal uses <span className="text-white">1 Pro Credit</span> (visible on mobile — not just hover).
                            </span>
                            {!hasProCredits && onUpgradeClick && (
                                <button
                                    type="button"
                                    className="mt-2 block w-full text-center underline text-[#D4AF37] hover:text-white"
                                    onClick={() => onUpgradeClick()}
                                    disabled={isBusy}
                                >
                                    Upgrade for Pro Credits
                                </button>
                            )}
                        </div>

                        <div className="flex gap-2 mb-4">
                            {availableSides.map((s) => {
                                const active = side === s;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => setSide(s)}
                                        disabled={isBusy}
                                        className={`flex-1 py-2 rounded-lg border text-[11px] font-black uppercase tracking-widest transition-all ${
                                            active
                                                ? 'bg-[#D4AF37]/15 border-[#D4AF37]/40 text-[#D4AF37]'
                                                : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:border-white/30'
                                        }`}
                                    >
                                        {s === 'front' ? 'Front' : s === 'back' ? 'Back' : 'Both'}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleRun}
                                disabled={isBusy || (!hasProCredits && !isAdmin)}
                                className="flex-1 py-3 bg-[#D4AF37]/15 hover:bg-[#D4AF37]/25 border border-[#D4AF37]/30 text-[#D4AF37] font-black uppercase tracking-widest text-[10px] rounded-xl transition-all disabled:opacity-40"
                            >
                                {isBusy ? <><i className="fas fa-circle-notch fa-spin mr-2"></i> Processing</> : <><i className="fas fa-bolt mr-2"></i> Run ({sideLabel})</>}
                            </button>
                            <button
                                onClick={() => { if (!isBusy) setIsOpen(false); }}
                                disabled={isBusy}
                                className="flex-1 py-3 border border-white/10 bg-white/5 text-white/50 font-black uppercase tracking-widest text-[10px] rounded-xl hover:bg-white/10 transition-colors disabled:opacity-40"
                            >
                                Close
                            </button>
                        </div>

                        {loadingMsg && (
                            <div className="mt-3 text-[10px] text-[#D4AF37]/70 font-bold uppercase tracking-widest flex items-center gap-2">
                                <i className="fas fa-spinner fa-spin" />
                                {loadingMsg}
                            </div>
                        )}

                        {error && (
                            <div className="mt-4 border border-red-500/20 bg-red-900/10 text-red-400/80 rounded-lg p-3 text-[10px] font-bold uppercase tracking-widest text-center">
                                {error}
                            </div>
                        )}

                        <div className="mt-5 grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <div className="text-[9px] font-black uppercase tracking-widest text-white/30">
                                    Original
                                </div>
                                {side !== 'back' && canProcessFront && (
                                    <img src={frontUrl} alt="Original front" className="w-full h-56 object-contain rounded-lg border border-white/10 bg-black/30" />
                                )}
                                {side === 'back' && canProcessBack && (
                                    <img src={backUrl} alt="Original back" className="w-full h-56 object-contain rounded-lg border border-white/10 bg-black/30" />
                                )}
                                {side === 'both' && canProcessFront && canProcessBack && (
                                    <div className="text-[10px] text-white/40">Showing original front/back separately below.</div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <div className="text-[9px] font-black uppercase tracking-widest text-white/30">
                                    Remove.bg Output
                                </div>
                                {(side === 'front' || side === 'both') && processed.front && (
                                    <img
                                        src={processed.front}
                                        alt="Processed front"
                                        className="w-full h-56 object-contain rounded-lg border border-white/10 bg-black/30"
                                    />
                                )}
                                {(side === 'back' || side === 'both') && processed.back && (
                                    <img
                                        src={processed.back}
                                        alt="Processed back"
                                        className="w-full h-56 object-contain rounded-lg border border-white/10 bg-black/30 mt-2"
                                    />
                                )}
                                {side !== 'front' && side !== 'back' && !processed.front && !processed.back && (
                                    <div className="text-[10px] text-white/40">Run the job to preview cut-outs.</div>
                                )}
                                {!processed.front && !processed.back && (
                                    <div className="text-[10px] text-white/40">Run the job to preview cut-outs.</div>
                                )}
                            </div>
                        </div>

                        <div className="mt-3 text-[9px] text-white/20 uppercase tracking-widest">
                            Output: PNG with transparency (remove.bg). Display-only; does not modify your vault items.
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default RemoveBgVaultDisplayPlugin;

