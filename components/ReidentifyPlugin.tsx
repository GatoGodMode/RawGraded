import React, { useState } from 'react';
import { identifyAndInitialGrade } from '../services/geminiService';

interface ReidentifyPluginProps {
    certId: string;
    onSuccess: () => void;
    paidCredits: number;
    freeCredits: number;
}

const ReidentifyPlugin: React.FC<ReidentifyPluginProps> = ({ certId, onSuccess, paidCredits, freeCredits }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [hint, setHint] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState('');
    const [error, setError] = useState('');

    const hasCredits = freeCredits > 0 || paidCredits > 0;

    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent triggering the parent card click (opens certificate)
        setHint('');
        setError('');
        setIsOpen(true);
    };

    const handleClose = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!isLoading) setIsOpen(false);
    };

    const handleReidentify = async () => {
        if (!hint.trim()) {
            setError('Please provide a short hint.');
            return;
        }
        setIsLoading(true);
        setError('');

        try {
            // Step 1: Fetch card images on demand
            setLoadingMsg('Fetching card images...');
            const imgResp = await fetch(`api/collection.php?action=fetch_image&id=${certId}`, {
                credentials: 'include'
            });
            if (!imgResp.ok) throw new Error('Could not fetch card images.');
            const imgData = await imgResp.json();
            if (!imgData.front) throw new Error('Card images not found in database.');

            // Step 2: Run Phase 1 re-identification with hint + PokeAPI
            setLoadingMsg('Running AI identification...');
            const result = await identifyAndInitialGrade(
                imgData.front,
                imgData.back || imgData.front,
                'Pokemon',
                hint.trim()
            );

            if (!result) throw new Error('AI failed to re-identify this card.');

            // Step 3: Save result to backend
            setLoadingMsg('Saving new identity...');
            const resp = await fetch('api/plugin_reidentify.php', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cert_id: certId,
                    metadata: {
                        name: result.detectedName,
                        character: result.detectedCharacter,
                        set: result.detectedSet,
                        year: result.detectedYear,
                        edition: result.detectedEdition,
                        number: result.detectedCardNumber,
                        artist: result.detectedArtist,
                        is_first_edition: (result.detectedEdition || '').toLowerCase().includes('1st') ? 1 : 0,
                        is_holographic: result.isHolographic ? 1 : 0,
                        holo_pattern: result.holoPattern || 'none'
                    },
                    predicted_grades: result.predictedGrades
                })
            });

            const data = await resp.json();
            if (data.success) {
                setIsOpen(false);
                onSuccess();
            } else {
                throw new Error(data.error || 'Failed to save re-identification.');
            }
        } catch (e: any) {
            console.error('Re-identification error:', e);
            setError(e.message || 'An unexpected error occurred.');
        } finally {
            setIsLoading(false);
            setLoadingMsg('');
        }
    };

    return (
        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
            {/* Compact luxury trigger row */}
            <button
                onClick={handleOpen}
                className="w-full flex items-center justify-between px-3 py-2 border border-white/[0.07] hover:border-[#D4AF37]/30 bg-white/[0.02] hover:bg-[#D4AF37]/5 text-white/40 hover:text-[#D4AF37] transition-all group"
            >
                <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]">
                    <i className="fas fa-dna text-[9px]"></i>
                    Re-Identify Card
                </span>
                <span className="text-[9px] font-bold text-white/20 group-hover:text-[#D4AF37]/50 uppercase tracking-widest">1 Credit</span>
            </button>

            {isOpen && (
                <div
                    className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
                    onClick={handleClose}
                >
                    <div
                        className="bg-[#0a0a0a] border border-white/10 w-full max-w-sm rounded-2xl p-6 shadow-[0_0_60px_rgba(212,175,55,0.08)] relative"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close button */}
                        <button
                            onClick={handleClose}
                            disabled={isLoading}
                            className="absolute top-4 right-4 w-6 h-6 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"
                        >
                            <i className="fas fa-times text-[11px]"></i>
                        </button>

                        {/* Header */}
                        <div className="mb-5">
                            <div className="flex items-center gap-2 mb-1">
                                <i className="fas fa-dna text-[#D4AF37] text-[11px]"></i>
                                <h3 className="text-[13px] font-black text-white uppercase tracking-[0.15em]">Re-Identify Card</h3>
                            </div>
                            <p className="text-[10px] text-white/30 leading-relaxed">
                                Provide a hint and RawGraded AI will cross-reference the Official Pokémon TCG API to correct the card's identity.
                            </p>
                            <p className="text-[9px] text-[#D4AF37]/50 mt-1.5 font-bold uppercase tracking-widest">
                                ⚠ Consumes 1 scan credit · Clears cached market data
                            </p>
                        </div>

                        {!hasCredits ? (
                            <div className="border border-red-500/20 bg-red-900/10 text-red-400/70 p-3 text-[10px] font-bold uppercase tracking-widest text-center">
                                No scan credits remaining
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[9px] font-black text-white/30 uppercase tracking-widest block mb-1.5">
                                        Card Hint <span className="text-white/15 normal-case font-normal">(max 100 chars)</span>
                                    </label>
                                    <textarea
                                        value={hint}
                                        onChange={(e) => setHint(e.target.value)}
                                        maxLength={100}
                                        placeholder="e.g. Reverse Holo Charizard from Evolutions"
                                        className="w-full bg-black/60 border border-white/10 focus:border-[#D4AF37]/40 rounded-lg p-3 text-[12px] text-white/80 outline-none font-medium placeholder-white/15 resize-none transition-colors"
                                        rows={2}
                                        disabled={isLoading}
                                    />
                                    <div className="text-right text-[9px] text-white/20 font-bold mt-0.5">{hint.length}/100</div>
                                </div>

                                {/* Loading state */}
                                {isLoading && loadingMsg && (
                                    <div className="flex items-center gap-2 text-[10px] text-[#D4AF37]/70 font-bold uppercase tracking-widest">
                                        <i className="fas fa-circle-notch fa-spin text-[10px]"></i>
                                        {loadingMsg}
                                    </div>
                                )}

                                {/* Error */}
                                {error && (
                                    <div className="text-[10px] text-red-400/80 bg-red-900/10 border border-red-500/20 px-3 py-2 rounded">
                                        {error}
                                    </div>
                                )}

                                {/* Run button */}
                                <button
                                    onClick={handleReidentify}
                                    disabled={isLoading || !hint.trim()}
                                    className={`w-full py-2.5 text-[11px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all rounded-lg ${
                                        isLoading || !hint.trim()
                                            ? 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
                                            : 'bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 hover:bg-[#D4AF37]/20 hover:border-[#D4AF37]/60'
                                    }`}
                                >
                                    {isLoading
                                        ? <><i className="fas fa-circle-notch fa-spin"></i> {loadingMsg || 'Processing...'}</>
                                        : <><i className="fas fa-bolt"></i> Spend 1 Credit &amp; Run</>
                                    }
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReidentifyPlugin;
