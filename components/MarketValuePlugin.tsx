import React, { useState, useEffect, useRef } from 'react';

export interface MarketValueProps {
    certId: string;
    overallGrade?: string | number | null;
    cardName: string;
    initialUnlocked?: boolean;
    initialDataJson?: string | null;
    userRole: string;
    paidCredits: number;
    onCreditUsed?: (newCredits: number) => void;
    onUnlocked?: (cardName: string, cardSet: string) => void;
    cardSet?: string;
    compact?: boolean;
}

const SPARKLE_COUNT = 12;

const burstStyles = `
@keyframes mvp-lock-burst {
    0%   { transform: scale(1) rotate(0deg); opacity: 1; }
    40%  { transform: scale(1.7) rotate(-12deg); opacity: 0.9; filter: drop-shadow(0 0 12px #D4AF37); }
    100% { transform: scale(3.5) rotate(20deg); opacity: 0; }
}
@keyframes mvp-spark {
    0%   { transform: translate(0,0) scale(1); opacity: 1; }
    80%  { opacity: 0.6; }
    100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
}
@keyframes mvp-shimmer {
    0%   { opacity: 0; transform: scaleX(0); }
    50%  { opacity: 1; }
    100% { opacity: 0; transform: scaleX(1); }
}
@keyframes mvp-fadein {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
}
.mvp-burst       { animation: mvp-lock-burst 0.6s cubic-bezier(.36,.07,.19,.97) forwards; }
.mvp-spark       { animation: mvp-spark 0.7s ease-out forwards; }
.mvp-shimmer     { animation: mvp-shimmer 0.8s ease-out forwards; }
.mvp-data-reveal { animation: mvp-fadein 0.5s ease-out 0.25s both; }
`;

export const MarketValuePlugin: React.FC<MarketValueProps> = ({
    certId,
    overallGrade,
    cardName,
    cardSet = '',
    initialUnlocked = false,
    initialDataJson = null,
    userRole,
    paidCredits,
    onCreditUsed,
    onUnlocked,
    compact = false
}) => {
    const isAdmin = userRole === 'admin';
    const [unlocked, setUnlocked]   = useState(initialUnlocked);
    const [loading, setLoading]     = useState(false);
    const [bursting, setBursting]   = useState(false);
    const [error, setError]         = useState<string | null>(null);
    const [compactExpanded, setCompactExpanded] = useState(false);
    const [expanded, setExpanded]   = useState(false);
    const [marketData, setMarketData] = useState<any | null>(() => {
        if (initialDataJson) {
            try { return JSON.parse(initialDataJson); } catch { return null; }
        }
        return null;
    });
    const styleInjected = useRef(false);

    // Inject keyframe styles once
    useEffect(() => {
        if (styleInjected.current) return;
        styleInjected.current = true;
        const el = document.createElement('style');
        el.textContent = burstStyles;
        document.head.appendChild(el);
    }, []);

    // If already unlocked but no market data yet, auto-load silently (no credit cost)
    useEffect(() => {
        if (initialUnlocked && !marketData && certId && !loading) {
            doFetch(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const doFetch = async (refresh: boolean) => {
        setLoading(true);
        setError(null);
        try {
            const res  = await fetch('api/plugin_market_price.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cert_id: certId, refresh })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                setMarketData(data.market_data);
                if (!unlocked) {
                    // Trigger burst before showing data
                    setBursting(true);
                    setTimeout(() => {
                        setBursting(false);
                        setUnlocked(true);
                        if (onUnlocked) onUnlocked(cardName, cardSet);
                    }, 700);
                }
                if (onCreditUsed && typeof data.paid_credits === 'number') {
                    onCreditUsed(data.paid_credits);
                }
            } else {
                setError(
                    data.code === 'CREDITS_REQUIRED'
                        ? 'Not enough Pro Credits. 1 Credit required.'
                        : data.error || 'Failed to fetch market data'
                );
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleUnlock = () => {
        if (!isAdmin && paidCredits < 1) {
            setError('Not enough Pro Credits. 1 Credit required.');
            return;
        }
        doFetch(false);
    };

    // ── Sparkle positions (radiating outward in circle) ──────────────
    const sparks = Array.from({ length: SPARKLE_COUNT }, (_, i) => {
        const angle = (360 / SPARKLE_COUNT) * i;
        const rad   = (angle * Math.PI) / 180;
        const dist  = 55 + Math.random() * 30;
        return {
            tx: `${Math.cos(rad) * dist}px`,
            ty: `${Math.sin(rad) * dist}px`,
            color: i % 3 === 0 ? '#D4AF37' : i % 3 === 1 ? '#ffffff' : '#dc2626',
            size: 3 + Math.random() * 4,
            delay: Math.random() * 0.15
        };
    });

    // ─────────────────────────────────────────────────────────────────
    // LOCKED VIEW (or mid-burst)
    // ─────────────────────────────────────────────────────────────────
    if (!unlocked || bursting) {
        return (
            <div
                className={`relative overflow-hidden flex flex-col items-center justify-center
                    ${compact ? 'mt-3 p-3' : 'mt-6 p-6'} bg-[#080808] border border-white/5`}
                style={{ minHeight: compact ? 90 : 160 }}
            >
                {/* Burst sparkles */}
                {bursting && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                        {sparks.map((s, i) => (
                            <span
                                key={i}
                                className="mvp-spark absolute rounded-full"
                                style={{
                                    '--tx': s.tx,
                                    '--ty': s.ty,
                                    width:  s.size,
                                    height: s.size,
                                    background: s.color,
                                    animationDelay: `${s.delay}s`,
                                    boxShadow: `0 0 6px 2px ${s.color}88`
                                } as React.CSSProperties}
                            />
                        ))}
                        {/* Shimmer ring */}
                        <span
                            className="mvp-shimmer absolute rounded-full border-2"
                            style={{ width: 90, height: 90, borderColor: '#D4AF37', opacity: 0 }}
                        />
                    </div>
                )}

                <div className="relative z-10 flex flex-col items-center text-center w-full">
                    {/* Lock icon — bursts away on unlock */}
                    <i
                        className={`fas fa-lock ${compact ? 'text-xl mb-1' : 'text-4xl mb-3'} ${bursting ? 'mvp-burst' : ''}`}
                        style={{ color: '#D4AF37', display: 'block' }}
                    />

                    {!bursting && (
                        <>
                            <h4 className={`font-black uppercase tracking-widest text-[#D4AF37]
                                ${compact ? 'text-[9px] mb-2' : 'text-sm mb-4'}`}>
                                Live Market Data
                            </h4>

                            {error && (
                                <div className="text-red-400 text-[10px] font-bold mb-2 bg-red-600/10
                                    px-2 py-1 w-full text-center">
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={(e) => { e.stopPropagation(); handleUnlock(); }}
                                disabled={loading}
                                className={`w-full bg-[#111] hover:bg-red-600 text-white border border-[#D4AF37]/30
                                    hover:border-red-600 transition-all font-black uppercase tracking-widest
                                    flex items-center justify-center gap-2
                                    ${compact ? 'text-[9px] py-1.5' : 'text-xs py-3'}`}
                            >
                                {loading
                                    ? <><i className="fas fa-circle-notch fa-spin" /> Unlocking...</>
                                    : <><i className="fas fa-key" /> UNLOCK {isAdmin ? '(ADMIN: FREE)' : '(1 PRO CREDIT)'}</>
                                }
                            </button>

                            {!compact && (
                                <p className="text-[10px] text-white/30 uppercase font-bold mt-3 max-w-[200px] leading-tight">
                                    Access real-time RAW &amp; Graded values · All copies unlock together
                                </p>
                            )}
                        </>
                    )}

                    {bursting && (
                        <span className="text-[10px] font-black uppercase tracking-widest"
                            style={{ color: '#D4AF37' }}>
                            Unlocking…
                        </span>
                    )}
                </div>
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // LOADING OVERLAY (after unlock confirmed but awaiting data)
    // ─────────────────────────────────────────────────────────────────
    if (loading && !marketData) {
        return (
            <div className={`flex flex-col items-center justify-center
                ${compact ? 'mt-3 p-3' : 'mt-6 p-6'} bg-[#080808] border border-white/5`}>
                <i className="fas fa-circle-notch fa-spin text-[#D4AF37] text-xl mb-2" />
                <span className="text-[9px] text-[#D4AF37] font-black uppercase tracking-widest animate-pulse">
                    Scanning Market…
                </span>
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // NO DATA / ERROR STATE
    // ─────────────────────────────────────────────────────────────────
    if (!marketData || marketData.no_data) {
        return (
            <div className={`flex items-center justify-center
                ${compact ? 'mt-3 p-2' : 'mt-6 p-4'}
                bg-white/[0.02] border border-white/5 text-[9px] font-bold text-white/40 uppercase tracking-widest`}>
                <i className="fas fa-exclamation-triangle mr-2" /> No market data found for this card
                {isAdmin && (
                    <button
                        onClick={(e) => { e.stopPropagation(); doFetch(true); }}
                        className="ml-3 text-white hover:text-[#D4AF37] transition-colors"
                        title="Force refresh from API"
                    >
                        <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`} />
                    </button>
                )}
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // UNLOCKED: COMPACT TILE VIEW
    let { prices, gradedPrices, projectedValue, pokewallet } = marketData;

    // Locally derive projectedValue if the backend JSON lacked it 
    if (!projectedValue && overallGrade) {
        const numGrade = Math.round(Number(overallGrade));
        if (numGrade >= 5 && numGrade <= 10 && gradedPrices) {
            const price = gradedPrices[`psa${numGrade}`];
            if (price > 0) {
                projectedValue = { grade: numGrade, price };
            }
        }
    }

    // Correct fallback using new pokewallet prices array shape
    const pwTcgRaw = pokewallet?.tcgplayer?.prices?.[0]?.market_price
                  || pokewallet?.tcgplayer?.prices?.[1]?.market_price
                  || null;
    const rawMarket = prices?.market || prices?.mid || pwTcgRaw || 0;
    const psa10     = gradedPrices?.psa10 || 0;
    const psa9      = gradedPrices?.psa9  || 0;
    const psa8      = gradedPrices?.psa8  || 0;
    const psa7      = gradedPrices?.psa7  || 0;
    const psa6      = gradedPrices?.psa6  || 0;
    const psa5      = gradedPrices?.psa5  || 0;
    const hasLowerPsa = psa8 > 0 || psa7 > 0 || psa6 > 0 || psa5 > 0;

    if (compact) {

        // All available graded tiers for compact expand
        const allPsa = [
            { label: 'PSA 10', grade: 10, price: psa10 },
            { label: 'PSA 9',  grade: 9,  price: psa9 },
            { label: 'PSA 8',  grade: 8,  price: psa8 },
            { label: 'PSA 7',  grade: 7,  price: psa7 },
            { label: 'PSA 6',  grade: 6,  price: psa6 },
            { label: 'PSA 5',  grade: 5,  price: psa5 },
        ].filter(g => g.price > 0);

        const pwCmTrendCompact = pokewallet?.cardmarket?.prices?.[0]?.trend || null;
        const fmtC = (v: number | null | undefined) => v && v > 0 ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---';

        return (
            <div
                className="mvp-data-reveal mt-3 overflow-hidden border border-[#D4AF37]/20 bg-[#080808] relative group/market"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="absolute top-0 right-0 p-1 opacity-10 group-hover/market:opacity-20 transition-opacity">
                    <i className="fas fa-chart-line text-3xl" style={{ color: '#D4AF37' }} />
                </div>

                {/* Summary row */}
                <div className="flex justify-between items-end relative z-10 border-b border-[#D4AF37]/20 p-3 pb-2">
                    <div className="flex flex-col">
                        <span className="text-[7px] font-black uppercase tracking-[0.2em] mb-1"
                            style={{ color: '#D4AF37' }}>Raw Market Value</span>
                        <span className="text-lg font-black text-white leading-none tracking-tight">
                            <span className="text-sm mr-0.5" style={{ color: '#D4AF37' }}>$</span>
                            {rawMarket.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {isAdmin && (
                            <button
                                onClick={(e) => { e.stopPropagation(); doFetch(true); }}
                                className="w-6 h-6 flex items-center justify-center bg-white/5 border border-white/10
                                    text-white/40 hover:text-white hover:bg-white/10 transition-all"
                                title="Refresh"
                            >
                                <i className={`fas fa-sync-alt text-[10px] ${loading ? 'fa-spin' : ''}`} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Key grades row */}
                <div className="flex items-center relative z-10 px-3 py-2">
                    <div className="flex flex-col">
                        <span className="text-[7px] text-white/40 font-bold uppercase tracking-widest mb-0.5">PSA 10</span>
                        <span className="text-[10px] font-black text-white">
                            {psa10 > 0 ? `$${psa10.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
                        </span>
                    </div>
                    <div className="h-4 w-px bg-white/10 mx-2" />
                    <div className="flex flex-col">
                        <span className="text-[7px] text-white/40 font-bold uppercase tracking-widest mb-0.5">PSA 9</span>
                        <span className="text-[10px] font-black text-white">
                            {psa9 > 0 ? `$${psa9.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '---'}
                        </span>
                    </div>
                    {projectedValue && projectedValue.price > 0 && (
                        <>
                            <div className="h-4 w-px bg-white/10 mx-2" />
                            <div className="flex flex-col">
                                <span className="text-[7px] text-[#D4AF37] font-bold uppercase tracking-widest mb-0.5">EST PSA {projectedValue.grade}</span>
                                <span className="text-[10px] font-black" style={{ color: '#D4AF37' }}>
                                    ${Number(projectedValue.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                        </>
                    )}
                    <div className="flex-1" />
                    {(allPsa.length > 2 || pwTcgRaw || pwCmTrendCompact) && (
                        <button
                            onClick={() => setCompactExpanded(e => !e)}
                            className="text-[8px] font-black uppercase tracking-widest text-white/30 hover:text-white/70 flex items-center gap-1 transition-colors"
                        >
                            <i className={`fas fa-chevron-${compactExpanded ? 'up' : 'down'} text-[7px]`} />
                            {compactExpanded ? 'Less' : 'More'}
                        </button>
                    )}
                </div>

                {/* Expand accordion */}
                {compactExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-white/5 animate-fade-in space-y-3">
                        {/* All PSA grades */}
                        {allPsa.length > 0 && (
                            <div>
                                <div className="text-[7px] font-black text-red-500/70 uppercase tracking-[0.2em] mb-1.5">PSA Grades</div>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {allPsa.map(g => (
                                        <div key={g.label} className={`p-1.5 border text-center ${
                                            projectedValue?.grade === g.grade
                                                ? 'border-[#D4AF37]/40 bg-[#D4AF37]/10'
                                                : 'border-white/10 bg-white/5'
                                        }`}>
                                            <div className={`text-[7px] font-black uppercase ${projectedValue?.grade === g.grade ? 'text-[#D4AF37]' : 'text-white/40'}`}>{g.label}</div>
                                            <div className="text-[10px] font-black text-white">{fmtC(g.price)}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* Alternative markets */}
                        {(pwTcgRaw || pwCmTrendCompact) && (
                            <div>
                                <div className="text-[7px] font-black text-sky-400/70 uppercase tracking-[0.2em] mb-1.5">Market Sources</div>
                                <div className="grid grid-cols-2 gap-1.5">
                                    {pwTcgRaw != null && (
                                        <div className="p-1.5 border border-white/10 bg-white/5">
                                            <div className="text-[7px] font-black text-sky-400/70 uppercase flex items-center gap-1">
                                                <i className="fas fa-store text-[6px]" /> TCGPlayer
                                            </div>
                                            <div className="text-[10px] font-black text-white">{fmtC(pwTcgRaw)}</div>
                                        </div>
                                    )}
                                    {pwCmTrendCompact != null && (
                                        <div className="p-1.5 border border-white/10 bg-white/5">
                                            <div className="text-[7px] font-black text-sky-300/70 uppercase flex items-center gap-1">
                                                <i className="fas fa-shopping-cart text-[6px]" /> CardMkt Trend
                                            </div>
                                            <div className="text-[10px] font-black text-white">${(pwCmTrendCompact * 1.09).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // UNLOCKED: FULL CERTIFICATE VIEW (Collapsible Accordion)
    // ─────────────────────────────────────────────────────────────────

    // Helper to format prices
    const fmt = (v: number | null | undefined) => v && v > 0 ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;

    // PokéWallet — get first normal/holofoil TCG market price
    const pwTcgPrice = pokewallet?.tcgplayer?.prices?.[0]?.market_price || pokewallet?.tcgplayer?.prices?.[1]?.market_price || null;
    const pwCmTrend  = pokewallet?.cardmarket?.prices?.[0]?.trend || null;

    // Build a clean PSA rows array (only grades with data)
    const psaGrades = [
        { label: 'PSA 10', grade: 10, price: psa10 },
        { label: 'PSA 9',  grade: 9,  price: psa9 },
        { label: 'PSA 8',  grade: 8,  price: psa8 },
        { label: 'PSA 7',  grade: 7,  price: psa7 },
        { label: 'PSA 6',  grade: 6,  price: psa6 },
        { label: 'PSA 5',  grade: 5,  price: psa5 },
    ].filter(g => g.price > 0);

    const bgsGrades = [
        { label: 'BGS 10', price: gradedPrices?.bgs10 || 0 },
        { label: 'BGS 9',  price: pokewallet?.gradedPrices?.bgs9  || 0 },
        { label: 'BGS 8',  price: pokewallet?.gradedPrices?.bgs8  || 0 },
        { label: 'BGS 7',  price: pokewallet?.gradedPrices?.bgs7  || 0 },
    ].filter(g => g.price > 0);

    const cgcGrades = [
        { label: 'CGC 10', price: gradedPrices?.cgc10 || 0 },
        { label: 'CGC 9',  price: pokewallet?.gradedPrices?.cgc9  || 0 },
        { label: 'CGC 8',  price: pokewallet?.gradedPrices?.cgc8  || 0 },
        { label: 'CGC 7',  price: pokewallet?.gradedPrices?.cgc7  || 0 },
    ].filter(g => g.price > 0);

    return (
        <div className="mvp-data-reveal mt-6 border border-[#D4AF37]/30 bg-[#080808] relative overflow-hidden">
            <div className="absolute top-0 right-0 opacity-5 pointer-events-none">
                <i className="fas fa-chart-line text-[120px]"
                    style={{ color: '#D4AF37', transform: 'translate(20%,-20%)' }} />
            </div>

            {/* ── ALWAYS VISIBLE HEADER ── */}
            <div className="bg-[#D4AF37]/10 border-b border-[#D4AF37]/20 px-5 py-3 flex justify-between items-center relative z-10">
                <div className="flex items-center gap-3">
                    <i className="fas fa-chart-pie text-lg" style={{ color: '#D4AF37' }} />
                    <h3 className="font-black text-white tracking-widest uppercase text-sm">Real-Time Market Data</h3>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] bg-[#D4AF37] text-black px-2 py-0.5">LIVE</span>
                    {isAdmin && (
                        <button
                            onClick={(e) => { e.stopPropagation(); doFetch(true); }}
                            className="text-white/40 hover:text-white transition-colors"
                            title="Force Refresh"
                        >
                            <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`} />
                        </button>
                    )}
                </div>
            </div>

            {/* ── SUMMARY ROW (always visible) ── */}
            <div className="px-5 py-4 flex flex-wrap gap-6 items-end relative z-10 border-b border-white/5">
                <div className="flex flex-col">
                    <span className="text-[8px] font-black uppercase tracking-[0.2em] mb-1" style={{ color: '#D4AF37' }}>Ungraded Market</span>
                    <div className="flex items-baseline gap-0.5">
                        <span className="text-lg" style={{ color: '#D4AF37' }}>$</span>
                        <span className="text-3xl font-black text-white tracking-tighter">
                            {rawMarket.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </div>
                    {(prices?.low || pwTcgPrice) && (
                        <div className="flex gap-3 mt-1 text-[9px] font-bold text-white/30 uppercase">
                            {prices?.low  != null && <span>Low: <span className="text-white/60">${prices.low.toFixed(2)}</span></span>}
                            {prices?.high != null && <span>High: <span className="text-white/60">${prices.high.toFixed(2)}</span></span>}
                        </div>
                    )}
                </div>

                {projectedValue && projectedValue.price > 0 && (
                    <div className="flex flex-col p-3 border border-[#D4AF37]/40 bg-[#D4AF37]/10">
                        <span className="text-[8px] font-black uppercase tracking-widest text-[#D4AF37] mb-1">EST PSA {projectedValue.grade} Value</span>
                        <span className="text-2xl font-black text-white">
                            ${Number(projectedValue.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                    </div>
                )}

                <div className="ml-auto">
                    <button
                        onClick={() => setExpanded(e => !e)}
                        className="flex items-center gap-2 px-4 py-2 border border-white/10 bg-white/5 hover:bg-white/10
                            text-white/60 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all"
                    >
                        <i className={`fas fa-chevron-${expanded ? 'up' : 'down'} text-[8px]`} />
                        {expanded ? 'Hide Details' : 'Show All Grades'}
                    </button>
                </div>
            </div>

            {/* ── EXPANDED GRADES ACCORDION ── */}
            {expanded && (
                <div className="px-5 py-5 relative z-10 animate-fade-in space-y-6">

                    {/* PSA Grades */}
                    {psaGrades.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-[8px] font-black text-red-500 uppercase tracking-[0.2em]">PSA Grades</span>
                                <div className="flex-1 h-px bg-red-500/20" />
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                                {psaGrades.map(g => (
                                    <div key={g.label} className={`flex flex-col p-2 border ${projectedValue?.grade === g.grade ? 'border-[#D4AF37]/50 bg-[#D4AF37]/10' : 'border-white/10 bg-white/5'}`}>
                                        <span className={`text-[7px] font-black uppercase tracking-widest mb-1 ${projectedValue?.grade === g.grade ? 'text-[#D4AF37]' : 'text-red-500/70'}`}>{g.label}</span>
                                        <span className="text-[11px] font-black text-white">{fmt(g.price)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* BGS Grades */}
                    {bgsGrades.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-[8px] font-black text-blue-400 uppercase tracking-[0.2em]">BGS Grades</span>
                                <div className="flex-1 h-px bg-blue-400/20" />
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                                {bgsGrades.map(g => (
                                    <div key={g.label} className="flex flex-col p-2 border border-white/10 bg-white/5">
                                        <span className="text-[7px] font-black uppercase tracking-widest mb-1 text-blue-400/70">{g.label}</span>
                                        <span className="text-[11px] font-black text-white">{fmt(g.price)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* CGC Grades */}
                    {cgcGrades.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-[8px] font-black text-purple-400 uppercase tracking-[0.2em]">CGC Grades</span>
                                <div className="flex-1 h-px bg-purple-400/20" />
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                                {cgcGrades.map(g => (
                                    <div key={g.label} className="flex flex-col p-2 border border-white/10 bg-white/5">
                                        <span className="text-[7px] font-black uppercase tracking-widest mb-1 text-purple-400/70">{g.label}</span>
                                        <span className="text-[11px] font-black text-white">{fmt(g.price)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Alternative Raw Markets */}
                    {(pwTcgPrice || pwCmTrend) && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className="text-[8px] font-black text-sky-400 uppercase tracking-[0.2em]">Alternative Raw Markets</span>
                                <div className="flex-1 h-px bg-sky-400/20" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {pwTcgPrice != null && (
                                    <div className="flex flex-col p-3 border border-white/10 bg-white/5">
                                        <span className="text-[7px] font-black uppercase tracking-widest mb-1 flex items-center gap-1 text-sky-400">
                                            <i className="fas fa-store text-[8px]" /> TCGPlayer Market
                                        </span>
                                        <span className="text-lg font-black text-white">{fmt(pwTcgPrice)}</span>
                                        {pokewallet?.tcgplayer?.url && (
                                            <a href={pokewallet.tcgplayer.url} target="_blank" rel="noopener noreferrer"
                                                className="text-[8px] text-sky-400/60 hover:text-sky-400 mt-1 truncate transition-colors">
                                                View on TCGPlayer →
                                            </a>
                                        )}
                                    </div>
                                )}
                                {pwCmTrend != null && (
                                    <div className="flex flex-col p-3 border border-white/10 bg-white/5">
                                        <span className="text-[7px] font-black uppercase tracking-widest mb-1 flex items-center gap-1 text-sky-300">
                                            <i className="fas fa-shopping-cart text-[8px]" /> CardMarket Trend
                                        </span>
                                        <span className="text-lg font-black text-white">${(pwCmTrend * 1.09).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                        {pokewallet?.cardmarket?.url && (
                                            <a href={pokewallet.cardmarket.url} target="_blank" rel="noopener noreferrer"
                                                className="text-[8px] text-sky-400/60 hover:text-sky-400 mt-1 truncate transition-colors">
                                                View on CardMarket →
                                            </a>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="px-5 py-2 border-t border-white/5 flex justify-between items-center text-[7px] text-white/20 uppercase font-bold tracking-widest relative z-10">
                <span>Powered by PokemonPriceTracker &amp; PokéWallet</span>
                <span>Values refresh every 24h · All copies synchronized</span>
            </div>
        </div>
    );
};

