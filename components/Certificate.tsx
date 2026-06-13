import React, { useRef, useState, useEffect } from 'react';
import { CardData, GradingResult, UserProfile } from '../types';
import EvidenceCrop from './EvidenceCrop';
import LogoR from './LogoR';
import { getCardValuation } from '../services/geminiService';
import SlabSlip from './SlabSlip';
import EbayGraphicPlugin from './EbayGraphicPlugin';
import { MarketValuePlugin } from './MarketValuePlugin';
import { renderToString } from 'react-dom/server';

const DATA_URL_MAX_LEN = 1500000; // ~1.5MB; many browsers fail or truncate longer data URLs
function dataUrlToBlobUrl(dataUrl: string): string | null {
    try {
        const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) return null;
        const bin = atob(m[2]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return URL.createObjectURL(new Blob([arr], { type: m[1] }));
    } catch {
        return null;
    }
}

interface CertificateProps {
    data: CardData;
    finalGrade: GradingResult;
    user?: UserProfile | null;
    onCreditsUpdated?: (credits: { free: number; paid: number; scan_limit?: number; scans_this_week?: number }) => void;
}

// Declare global for html2canvas from CDN
declare const html2canvas: any;

const Certificate: React.FC<CertificateProps> = ({ data, finalGrade, user, onCreditsUpdated }) => {
    const certRef = useRef<HTMLDivElement>(null);
    const fullExportRef = useRef<HTMLDivElement>(null);
    const socialExportRef = useRef<HTMLDivElement>(null);
    const socialExportLightRef = useRef<HTMLDivElement>(null);
    const slabSlipRef = useRef<HTMLDivElement>(null);
    const receiptRef = useRef<HTMLDivElement>(null);
    const certId = data.id.substring(0, 8).toUpperCase();
    const blobUrlsRef = useRef<string[]>([]);
    const [displayFrontUrl, setDisplayFrontUrl] = useState<string | null>(null);
    const [displayBackUrl, setDisplayBackUrl] = useState<string | null>(null);
    const [ebayGraphicOpen, setEbayGraphicOpen] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark'>('dark');
    
    // Social Export Toggles
    const [showMarketData, setShowMarketData] = useState(false);
    const [showCrossGrades, setShowCrossGrades] = useState(false);
    const isCollectOnly = data.assessmentMode === 'collect_only';

    // Art Galleria Luxury Tiers - Strictly mapped to 10 (Gold), 9 (Silver), 8 and under (Bronze Velvet)
    const getGradeGradient = (grade: number | string | undefined) => {
        const numGrade = Number(grade);
        if (isNaN(numGrade)) return '#1f2937'; // default dark gray
        if (numGrade === 10) return 'linear-gradient(135deg, #F3E5AB 0%, #D4AF37 40%, #8A6F1C 80%, #D4AF37 100%)';
        if (numGrade >= 9) return 'linear-gradient(135deg, #FFFFFF 0%, #E8E8E8 30%, #A0A0A0 70%, #686868 100%)';
        // Low-grade: bronze luxe (avoid casino-red)
        return 'linear-gradient(135deg, #B38728 0%, #8A6F1C 45%, #4A3A12 100%)';
    };

    // Defer heavy blob conversion so the cert shell paints first (keeps archive flow responsive).
    useEffect(() => {
        const front = data.frontRaw || data.frontCropped;
        const back = data.backRaw || data.backCropped;
        blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
        blobUrlsRef.current = [];
        const run = () => {
            if (typeof front === 'string' && front.length > DATA_URL_MAX_LEN) {
                const u = dataUrlToBlobUrl(front);
                if (u) { blobUrlsRef.current.push(u); setDisplayFrontUrl(u); } else setDisplayFrontUrl(null);
            } else setDisplayFrontUrl(null);
            if (typeof back === 'string' && back.length > DATA_URL_MAX_LEN) {
                const u = dataUrlToBlobUrl(back);
                if (u) { blobUrlsRef.current.push(u); setDisplayBackUrl(u); } else setDisplayBackUrl(null);
            } else setDisplayBackUrl(null);
        };
        const t = setTimeout(run, 0);
        return () => { clearTimeout(t); blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u)); blobUrlsRef.current = []; };
    }, [data.frontRaw, data.frontCropped, data.backRaw, data.backCropped]);


    // Appraisal State
    const [isAppraising, setIsAppraising] = React.useState(false);
    const [showAppraiseModal, setShowAppraiseModal] = React.useState(false);
    const [valuation, setValuation] = React.useState<{ estimated_value_usd: number, confidence_score: number, notes: string } | null>(null);
    // Acquisition State
    const [acqPrice, setAcqPrice] = React.useState<string>('');
    const [acqTax, setAcqTax] = React.useState<string>('');
    const [acqShipping, setAcqShipping] = React.useState<string>('');
    const [acqState, setAcqState] = React.useState<string>('');
    const [acqSource, setAcqSource] = React.useState<string>('');
    const [acqCity, setAcqCity] = React.useState<string>('');
    const [acqDate, setAcqDate] = React.useState<string>('');
    const [acqTrackingNumber, setAcqTrackingNumber] = React.useState<string>('');
    const [acqOrderId, setAcqOrderId] = React.useState<string>('');

    // Sync State with Props
    React.useEffect(() => {
        if (data) {
            setAcqPrice(data.acqPrice?.toString() || '');
            setAcqTax(data.acqTax?.toString() || '');
            setAcqShipping(data.acqShipping?.toString() || '');
            setAcqDate(data.acqDate ? data.acqDate.split(' ')[0] : new Date().toISOString().split('T')[0]);
            setAcqSource(data.acqSource || '');
            setAcqCity(data.acqCity || '');
            setAcqState(data.acqState || '');
            setAcqTrackingNumber((data as any).tracking_number || data.acqTrackingNumber || '');
            setAcqOrderId((data as any).order_id || data.acqOrderId || '');
        }
    }, [data.id]);

    const handleAppraise = async (force: boolean = false) => {
        setShowAppraiseModal(true);

        // If force is true OR no existing value, run appraisal
        if (force || !data.metadata.estimated_value) {
            setIsAppraising(true);
            setValuation(null);
            const result = await getCardValuation(data, finalGrade);
            setIsAppraising(false);
            if (result) {
                setValuation(result);
            }
        } else if (data.metadata.estimated_value && !valuation) {
            // Initializing with existing value if modal just opened
            setValuation({
                estimated_value_usd: data.metadata.estimated_value,
                confidence_score: 100, // Manual/Historical
                notes: "Current Value from Vault Data"
            });
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const handleDownloadImage = async (type: 'full' | 'social' | 'social_light' | 'slab' | 'receipt') => {
        const targetRef = type === 'full' ? fullExportRef : type === 'social' ? socialExportRef : type === 'social_light' ? socialExportLightRef : type === 'slab' ? slabSlipRef : receiptRef;
        if (targetRef.current && typeof html2canvas !== 'undefined') {
            try {
                const el = targetRef.current;
                const isSocialDark = type === 'social';
                const isSocialLight = type === 'social_light';
                const options: Record<string, unknown> = {
                    logging: false,
                    scale: type === 'slab' ? 1.5 : 2,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: isSocialDark
                        ? '#1a1a2e'
                        : isSocialLight
                            ? '#faf9f7'
                            : type === 'full' && theme === 'light'
                                ? '#FBF9F6'
                                : '#ffffff',
                    imageTimeout: 0,
                    removeContainer: true,
                    windowWidth: el.scrollWidth,
                    windowHeight: el.scrollHeight
                };

                const canvas = await html2canvas(el, options);

                const link = document.createElement('a');
                const exportLabel = type === 'social' ? 'SOCIAL_DARK' : type === 'social_light' ? 'SOCIAL_LIGHT' : type.toUpperCase();
                link.download = `rawgraded-certificate-${exportLabel}-${certId}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
            } catch (error) {
                console.error("Image generation failed", error);
                alert("Could not generate image. Please try Print -> Save as PDF.");
            }
        }
    };

    const handlePrintSlab = () => {
        if (!slabSlipRef.current) return;

        // Create a hidden iframe for clean printing
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow?.document;
        if (!doc) return;

        // Copy styles + content
        const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
            .map(s => s.outerHTML)
            .join('');

        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
                <head>
                    <title>RawGraded Slab Slip</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                    <script>
                        tailwind.config = {
                            theme: {
                                extend: {
                                    colors: {
                                        poke: {
                                            dark: '#1a1a2e',
                                            light: '#16213e',
                                            accent: '#ed1c24',
                                            gold: '#ffd700',
                                            blue: '#0f3460',
                                        },
                                    },
                                    fontFamily: {
                                        sans: ['Inter', 'sans-serif'],
                                    },
                                },
                            },
                        }
                    </script>
                    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
                    <style>
                        @page { size: 8.5in 11in; margin: 0; }
                        body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        .print-wrapper {
                            width: 2.5in;
                            height: 3.5in;
                            margin: 1in auto; /* Center on the physical page */
                            padding: 0;
                            overflow: hidden;
                            border: none;
                            background: white;
                        }
                        .print-wrapper > div {
                            transform: scale(0.32);
                            transform-origin: top left;
                            width: 750px;
                            height: 1050px;
                        }
                        /* Color overrides for high-fidelity printing */
                        .bg-black { background-color: black !important; }
                        .text-white { color: white !important; }
                        .bg-white { background-color: white !important; }
                        .border-black { border-color: black !important; }
                    </style>
                </head>
                <body>
                    <div class="print-wrapper">
                        <div>${renderToString(<SlabSlip data={data} finalGrade={finalGrade} />)}</div>
                    </div>
                </body>
            </html>
        `);
        doc.close();

        // Print after styles load
        setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => document.body.removeChild(iframe), 1000);
        }, 1000);
    };

    const getSourceImageByIndex = (imageIndex: number | undefined, defect?: any): string | null => {
        // 1. Check for surgically embedded frame data (Primary source for persistence)
        if (defect?.imageData && typeof defect.imageData === 'string' && defect.imageData.length > 50) {
            return defect.imageData;
        }

        // 2. Check current session video frames
        if (typeof imageIndex === 'number' && imageIndex >= 2 && Array.isArray(data.videoFrames) && data.videoFrames.length > (imageIndex - 2)) {
            const frame = data.videoFrames[imageIndex - 2];
            if (frame && typeof frame === 'string' && frame.length > 50) {
                return frame;
            }
        }

        // 3. Fallback to front/back crops (or raw if crops missing)
        if (imageIndex === 1) return data.backCropped || data.backRaw || null;
        if (imageIndex === 0) return data.frontCropped || data.frontRaw || null;

        // If index is missing or out of bounds, try to safely return front as an absolute last resort 
        // to avoid completely black boxes if front image exists.
        return data.frontCropped || data.frontRaw || null;
    };

    const handleAdminReset = async (certId: string) => {
        if (!user || user.role !== 'admin') return;
        if (!confirm(`ADMIN: Are you sure you want to BREAK the chain for this card?`)) return;

        try {
            const resp = await fetch('api/collection.php?action=admin_reset_links', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: certId, mode: 'selective' })
            });
            const result = await resp.json();
            if (result.success) {
                alert("Chain broken successfully.");
                window.location.reload(); // Simple reload to reflect changes
            } else {
                alert("Admin reset failed: " + result.error);
            }
        } catch (e) {
            console.error("Admin reset error", e);
        }
    };

    // Calculate Lineage for Display & Filtering
    const fullLineage = React.useMemo(() => {
        return [
            ...(data.history || []),
            {
                id: data.id,
                name: data.metadata.name,
                overall_grade: finalGrade.overall,
                estimated_value: data.metadata.estimated_value || 0,
                date_scanned: data.dateScanned
            },
            ...(data.descendants || [])
        ]
            .filter(item => item.id) // Ensure valid IDs
            // Remove duplicates just in case
            .filter((item, index, self) =>
                index === self.findIndex((t) => (t.id === item.id))
            )
            .sort((a, b) => new Date(a.date_scanned).getTime() - new Date(b.date_scanned).getTime());
    }, [data, finalGrade]);

    const verifiedIds = React.useMemo(() => fullLineage.map(x => x.id), [fullLineage]);
    const historyCount = fullLineage.length;
    const displayedHistory = fullLineage.slice(-5);
    const hiddenCount = Math.max(0, historyCount - 5);

    // Eligibility Reactivity
    React.useEffect(() => {
        // Eligibility logic maintained but silent
    }, [data, user, fullLineage]);

    return (
        <>
            <div className="flex flex-col items-center space-y-4">

                {/* Appraisal Modal */}
                {showAppraiseModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-fade-in relative">
                            <button
                                onClick={() => setShowAppraiseModal(false)}
                                className="absolute top-4 right-4 text-gray-400 hover:text-black z-10"
                            >
                                <i className="fas fa-times text-xl"></i>
                            </button>

                            <div className="p-6">
                                <h2 className="text-2xl font-black uppercase text-poke-blue mb-2 flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-2">
                                        <i className="fas fa-chart-line text-poke-gold"></i> AI Market Appraisal
                                    </span>
                                    {valuation && !isAppraising && (
                                        <button
                                            onClick={() => handleAppraise(true)}
                                            className="text-[10px] bg-blue-50 text-blue-600 px-3 py-1 rounded-full border border-blue-200 hover:bg-blue-600 hover:text-white transition-all font-bold uppercase tracking-widest"
                                            title="Run a fresh AI Market Search"
                                        >
                                            <i className="fas fa-sync-alt mr-1"></i> Re-Run AI Scan
                                        </button>
                                    )}
                                </h2>
                                <p className="text-sm text-gray-500 mb-6">Generated by RawGraded AI based on current market trends.</p>

                                {isAppraising ? (
                                    <div className="flex flex-col items-center justify-center py-10 space-y-4">
                                        <div className="w-12 h-12 border-4 border-poke-blue border-t-transparent rounded-full animate-spin"></div>
                                        <p className="font-bold text-gray-400 animate-pulse">Analyzing sales data...</p>
                                    </div>
                                ) : valuation ? (
                                    <div className="space-y-6">
                                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-gray-400 uppercase">Estimated Value</p>
                                                <p className="text-4xl font-black text-green-600">${valuation.estimated_value_usd}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs font-bold text-gray-400 uppercase">Confidence</p>
                                                <div className="flex items-center gap-1 justify-end">
                                                    <span className={`font-bold ${valuation.confidence_score > 70 ? 'text-green-500' : 'text-orange-500'}`}>
                                                        {valuation.confidence_score}%
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                                            <p className="text-xs font-bold text-blue-400 uppercase mb-1">Market Notes</p>
                                            <p className="text-sm text-blue-900 italic">"{valuation.notes}"</p>
                                        </div>

                                        {/* Acquisition Details Plugin */}
                                        <div className="border-t border-gray-100 pt-6 space-y-4">
                                            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                                                <i className="fas fa-file-invoice-dollar text-poke-blue"></i> Private Acquisition Tracking
                                            </h3>
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Price (USD)</label>
                                                    <div className="relative">
                                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                                                        <input
                                                            type="number"
                                                            value={acqPrice}
                                                            onChange={e => setAcqPrice(e.target.value)}
                                                            className="w-full pl-6 pr-2 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-poke-blue outline-none"
                                                            placeholder="0.00"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Tax</label>
                                                    <div className="relative">
                                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                                                        <input
                                                            type="number"
                                                            value={acqTax}
                                                            onChange={e => setAcqTax(e.target.value)}
                                                            className="w-full pl-6 pr-2 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-poke-blue outline-none"
                                                            placeholder="0.00"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Shipping</label>
                                                    <div className="relative">
                                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                                                        <input
                                                            type="number"
                                                            value={acqShipping}
                                                            onChange={e => setAcqShipping(e.target.value)}
                                                            className="w-full pl-6 pr-2 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-poke-blue outline-none"
                                                            placeholder="0.00"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Acquisition Date</label>
                                                    <input
                                                        type="date"
                                                        value={acqDate}
                                                        onChange={e => setAcqDate(e.target.value)}
                                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-poke-blue outline-none"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Source / Marketplace</label>
                                                    <input
                                                        type="text"
                                                        value={acqSource}
                                                        onChange={e => setAcqSource(e.target.value)}
                                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-poke-blue outline-none"
                                                        placeholder="e.g. eBay, LCS"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">City</label>
                                                    <input
                                                        type="text"
                                                        value={acqCity}
                                                        onChange={e => setAcqCity(e.target.value)}
                                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-poke-blue outline-none"
                                                        placeholder="New York"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">State</label>
                                                    <input
                                                        type="text"
                                                        value={acqState}
                                                        onChange={e => setAcqState(e.target.value)}
                                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-poke-blue outline-none"
                                                        placeholder="NY"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Tracking #</label>
                                                    <input
                                                        type="text"
                                                        value={acqTrackingNumber}
                                                        onChange={e => setAcqTrackingNumber(e.target.value)}
                                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-poke-blue outline-none font-mono"
                                                        placeholder="9400111899..."
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Order ID</label>
                                                    <input
                                                        type="text"
                                                        value={acqOrderId}
                                                        onChange={e => setAcqOrderId(e.target.value)}
                                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-poke-blue outline-none font-mono"
                                                        placeholder="12-34567..."
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-center pb-2">
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const userId = user?.id || (data as any).userId || 'guest_user';
                                                        const res = await fetch(`api/collection.php?action=update_valuation&user_id=${userId}`, {
                                                            method: 'POST',
                                                            credentials: 'include',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                id: data.id,
                                                                estimated_value: valuation.estimated_value_usd,
                                                                acq_price: acqPrice ? parseFloat(acqPrice) : null,
                                                                acq_tax: acqTax ? parseFloat(acqTax) : null,
                                                                acq_shipping: acqShipping ? parseFloat(acqShipping) : null,
                                                                acq_date: acqDate || null,
                                                                acq_source: acqSource || null,
                                                                acq_city: acqCity || null,
                                                                acq_state: acqState || null,
                                                                tracking_number: acqTrackingNumber || null,
                                                                order_id: acqOrderId || null
                                                            })
                                                        });
                                                        const json = await res.json();
                                                        if (json.success) {
                                                            alert("Data Saved to Vault!");
                                                            window.location.reload();
                                                        } else {
                                                            alert(`Failed to save: ${json.error || "Unknown Error"}\n\nDetails: ${json.details || "Check server logs."}\nFile: ${json.file || "N/A"} Line: ${json.line || "N/A"}`);
                                                        }
                                                    } catch (e) {
                                                        alert("Network error saving data");
                                                    }
                                                }}
                                                className="bg-green-600 text-white px-6 py-2 rounded-full font-bold shadow hover:bg-green-700 transition-colors flex items-center gap-2"
                                            >
                                                <i className="fas fa-save"></i> Save to Vault & Vault Tracking
                                            </button>
                                            <button
                                                onClick={() => handleDownloadImage('receipt')}
                                                className="bg-gray-800 text-white px-6 py-2 rounded-full font-bold shadow hover:bg-black transition-colors flex items-center gap-2 ml-2"
                                            >
                                                <i className="fas fa-file-invoice"></i> Save Receipt
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center text-red-500 py-4">
                                        <p>Valuation failed. Please try again.</p>
                                        <button
                                            onClick={() => handleAppraise()}
                                            className="mt-4 text-black underline text-sm font-bold"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Action Bar */}
                <div className="w-full max-w-4xl flex flex-wrap justify-end gap-3 no-print p-2">
                    {/* Public Actions (Visible to everyone) */}
                    <button
                        onClick={() => {
                            const url = `${window.location.origin}${window.location.pathname}?cert=${data.id}`;
                            navigator.clipboard.writeText(url);
                            alert("Certificate link copied to clipboard!");
                        }}
                        className="bg-[#090909] text-[#AA9155] border border-[#3A3121] px-4 py-2 rounded-sm shadow-lg hover:bg-[#111] hover:text-[#D4AF37] hover:border-[#D4AF37] transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest"
                    >
                        <i className="fas fa-share-alt text-[12px]"></i> Share
                    </button>
                    <button
                        onClick={handlePrint}
                        className="bg-[#090909] text-[#AA9155] border border-[#3A3121] px-4 py-2 rounded-sm shadow-lg hover:bg-[#111] hover:text-[#D4AF37] hover:border-[#D4AF37] transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest"
                    >
                        <i className="fas fa-print text-[12px]"></i> Print Full PDF
                    </button>
                    <button
                        onClick={() => handleDownloadImage('full')}
                        className="bg-[#090909] text-[#AA9155] border border-[#3A3121] px-4 py-2 rounded-sm shadow-lg hover:bg-[#111] hover:text-[#D4AF37] hover:border-[#D4AF37] transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest"
                    >
                        <i className="fas fa-file-image text-[12px]"></i> Download Full Image
                    </button>
                    
                    {/* Social Export UI Toggles */}
                    <div className="flex bg-[#040404] p-1 rounded-sm border border-[#2A2416] ml-2 mr-2">
                        <button
                            onClick={() => setShowCrossGrades(!showCrossGrades)}
                            className={`px-3 py-1.5 text-[9px] rounded-sm font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${showCrossGrades ? 'bg-[#D4AF37] text-black shadow-md' : 'text-[#887440] hover:text-[#D4AF37]'}`}
                        >
                            <i className="fas fa-list-ol"></i> Cross-Grades
                        </button>
                        <button
                            onClick={() => setShowMarketData(!showMarketData)}
                            className={`px-3 py-1.5 text-[9px] rounded-sm font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${showMarketData ? 'bg-[#E8C55A] text-black shadow-md' : 'text-[#887440] hover:text-[#D4AF37]'}`}
                        >
                            <i className="fas fa-dollar-sign"></i> Est. Value
                        </button>
                    </div>

                    <button
                        onClick={() => handleDownloadImage('social')}
                        className="bg-[#D4AF37] text-black border border-[#E8C55A] px-4 py-2 rounded-sm shadow-lg hover:bg-[#E8C55A] transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest"
                    >
                        <i className="fas fa-camera-retro text-[12px]"></i> Social (Dark)
                    </button>
                    <button
                        onClick={() => handleDownloadImage('social_light')}
                        className="bg-[#FBF9F6] text-[#1A1A1A] border border-[#DFD5C5] px-4 py-2 rounded-sm shadow-lg hover:bg-[#fff] transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest"
                    >
                        <i className="fas fa-camera-retro text-[12px]"></i> Social (Light)
                    </button>
                    {user && (
                        <button
                            onClick={() => setEbayGraphicOpen(true)}
                            className="bg-[#090909] text-[#AA9155] border border-[#3A3121] px-4 py-2 rounded-sm shadow-lg hover:bg-[#111] hover:text-[#D4AF37] hover:border-[#D4AF37] transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest ml-2"
                            title="eBay sales graphic (1 free or 1 pro credit)"
                        >
                            <i className="fas fa-shopping-cart text-[12px]"></i> eBay Graphic
                        </button>
                    )}

                    {/* Theme Toggle Widget */}
                    <div className="flex bg-[#040404] rounded-sm p-1 ml-auto mr-auto shadow-inner border border-[#2A2416]">
                        <button
                            onClick={() => setTheme('light')}
                            className={`px-3 py-1.5 text-xs rounded-sm transition-all ${theme === 'light' ? 'bg-[#FBF9F6] text-[#1A1A1A] shadow-md border border-[#DFD5C5]' : 'text-[#887440] hover:text-[#D4AF37]'}`}
                            title="Light Theme"
                        >
                            <i className="fas fa-sun"></i>
                        </button>
                        <button
                            onClick={() => setTheme('dark')}
                            className={`px-3 py-1.5 text-xs rounded-sm transition-all ${theme === 'dark' ? 'bg-[#090909] text-[#D4AF37] shadow-md border border-[#3A3121]' : 'text-[#887440] hover:text-[#D4AF37]'}`}
                            title="Dark Luxury Theme"
                        >
                            <i className="fas fa-moon"></i>
                        </button>
                    </div>

                    {/* Restricted Actions (Owner or Admin) */}
                    {(user && data.userId && (String(user.id).trim() === String(data.userId).trim() || user.role === 'admin')) && (
                        <>
                            <button
                                onClick={() => handleDownloadImage('slab')}
                                className="bg-[#090909] text-[#AA9155] border border-[#3A3121] px-4 py-2 rounded-sm shadow-lg hover:bg-[#111] hover:text-[#D4AF37] hover:border-[#D4AF37] transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest"
                            >
                                <i className="fas fa-ticket-alt text-[12px]"></i> Save Slab Slip
                            </button>
                            <button
                                onClick={handlePrintSlab}
                                className="bg-[#090909] text-[#AA9155] border border-[#3A3121] px-4 py-2 rounded-sm shadow-lg hover:bg-[#111] hover:text-[#D4AF37] hover:border-[#D4AF37] transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest"
                            >
                                <i className="fas fa-print text-[12px]"></i> Print Slip
                            </button>
                            <button
                                onClick={() => handleAppraise()}
                                className="bg-[#090909] text-[#AA9155] border border-[#3A3121] px-4 py-2 rounded-sm shadow-lg hover:bg-[#111] hover:text-[#D4AF37] hover:border-[#D4AF37] transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest"
                                title="Get AI Valuation"
                            >
                                <i className="fas fa-tag text-[12px]"></i>
                                {(data.metadata.estimated_value || 0) > 0 ? 'RE-APPRAISE' : 'Appraise'}
                            </button>
                            <button
                                onClick={async () => {
                                    const isArchived = data.is_archived === 1 || data.is_archived === true;
                                    if (!confirm(`${isArchived ? 'Restore' : 'Archive'} this certificate? ${isArchived ? '' : 'It will be hidden from your stats and main Vault view.'}`)) return;

                                    try {
                                        const resp = await fetch('api/archive.php', {
                                            method: 'POST',
                                            credentials: 'include',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ id: data.id, archive: isArchived ? 0 : 1 })
                                        });
                                        const result = await resp.json();
                                        if (result.success) {
                                            alert(result.message);
                                            window.location.reload();
                                        } else {
                                            alert("Action failed: " + result.error);
                                        }
                                    } catch (e) {
                                        console.error("Archive error", e);
                                    }
                                }}
                                className={`px-4 py-2 rounded-sm shadow-lg transition-all flex items-center gap-2 font-bold text-[10px] uppercase tracking-widest border ${data.is_archived ? 'bg-[#111] text-[#D4AF37] border-[#D4AF37]' : 'bg-[#090909] text-[#887440] border-[#3A3121] hover:text-[#D4AF37] hover:border-[#D4AF37] hover:bg-[#111]'}`}
                                title={data.is_archived ? 'Restore to Vault' : 'Archive (Hide from Stats)'}
                            >
                                <i className={`fas ${data.is_archived ? 'fa-box-open' : 'fa-archive'} text-[12px]`}></i>
                                {data.is_archived ? 'RESTORE' : 'ARCHIVE'}
                            </button>
                        </>
                    )}
                </div>

                {/* Certificate Container */}
                <div ref={certRef} className={`w-full max-w-4xl mx-auto p-8 shadow-2xl relative overflow-hidden print:shadow-none print:w-full ${theme === 'dark' ? 'bg-[#0a0a0a] text-white print:bg-white print:text-black' : 'bg-[#FBF9F6] text-black'}`}>

                    {/* Background Watermark */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
                        <img src="/assets/logo/R Solo.svg" className="w-[500px] h-[500px] object-contain" alt="" />
                    </div>


                    {/* Header */}
                    <div className={`border-b-4 pb-6 mb-8 flex justify-between items-end ${theme === 'dark' ? 'border-white/20 print:border-black' : 'border-black'}`}>
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3">
                                <img src="/assets/logo/R Solo.svg" className="h-10 w-auto object-contain" alt="" />
                                <h1 className={`text-4xl font-black italic tracking-tighter ${theme === 'dark' ? 'text-white print:text-black' : ''}`}>RAWGRADED</h1>
                            </div>
                            <p className={`text-xl font-bold ${theme === 'dark' ? 'text-gray-400 print:text-gray-600' : 'text-gray-600'}`}>Graded Card Certificate of Scan</p>
                        </div>
                        <div className="text-right">
                            <p className="font-mono text-sm text-gray-500">CERTIFICATE ID</p>
                            <div className="flex flex-col items-end">
                                <p className="font-mono text-2xl font-bold tracking-widest leading-none">{certId}</p>

                                {/* ADMIN: Break Chain */}
                                {user?.role === 'admin' && (data.parentScanId || (data.descendants && data.descendants.length > 0)) && (
                                    <button
                                        onClick={() => handleAdminReset(data.id)}
                                        className="mt-1 text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded border border-red-200 hover:bg-red-600 hover:text-white transition-colors font-bold uppercase tracking-wider"
                                    >
                                        <i className="fas fa-unlink mr-1"></i> Break Chain
                                    </button>
                                )}

                                {/* USER: Merge & Re-assess (Visible if chain exists) */}
                                {user && (String(user.id) === String(data.userId) || user.role === 'admin') && (data.parentScanId || (fullLineage.length >= 2)) && (
                                    <button
                                        onClick={async () => {
                                            if (!confirm("Start 'Merge & Re-assess' Process? (Cost: 1 Credit)")) return;

                                            // 1. Fetch Chain
                                            try {
                                                const chainRes = await fetch(`api/plugin_get_chain.php?id=${data.id}`, { credentials: 'include' });
                                                const rawText = await chainRes.text();
                                                let chainJson;
                                                try {
                                                    chainJson = JSON.parse(rawText);
                                                } catch (parseErr) {
                                                    console.error("JSON Parse Error. Raw Response:", rawText);
                                                    alert("CRITICAL ERROR: The server returned an invalid (non-JSON) response. This usually means a PHP crash. Please contact admin. Raw: " + rawText.substring(0, 200));
                                                    return;
                                                }

                                                if (!chainJson.chain || chainJson.chain.length < 2) {
                                                    alert("Chain too short to merge.");
                                                    return;
                                                }

                                                // 2. Run AI Re-assess
                                                const { reassessChain } = await import('../services/geminiService');
                                                // Minimal Loading UI?
                                                const statusDiv = document.createElement('div');
                                                statusDiv.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:9999;color:white;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:bold;flex-direction:column;";
                                                statusDiv.innerHTML = '<div><i class="fas fa-brain fa-spin"></i> RawGraded AI is Re-assessing...</div><div id="ai-status" style="font-size:16px;margin-top:20px;color:#ccc">Analyzing Forensic Audit History...</div>';
                                                document.body.appendChild(statusDiv);

                                                const result = await reassessChain(chainJson.chain, (s) => {
                                                    const el = document.getElementById('ai-status');
                                                    if (el) el.innerText = s;
                                                });

                                                if (!result) {
                                                    document.body.removeChild(statusDiv);
                                                    alert("AI Re-assessment failed. Please try again.");
                                                    return;
                                                }

                                                // 3. Save & Merge
                                                const el = document.getElementById('ai-status');
                                                if (el) el.innerText = "Finalizing Merge...";

                                                const chain = chainJson.chain;
                                                const mergedIds = chain.map((c: any) => c.id);

                                                // Consolidate Notes (Oldest to Newest)
                                                const consolidatedNotes = chain
                                                    .slice()
                                                    .reverse()
                                                    .map((c: any) => c.user_notes)
                                                    .filter((n: string) => n && n.trim() !== '')
                                                    .join(' | ');

                                                // Consolidate Acquisition (Pick first non-empty found in chain)
                                                const consolidatedAcq = {
                                                    acqPrice: chain.find((c: any) => parseFloat(c.acq_price) > 0)?.acq_price,
                                                    acqTax: chain.find((c: any) => parseFloat(c.acq_tax) > 0)?.acq_tax,
                                                    acqShipping: chain.find((c: any) => parseFloat(c.acq_shipping) > 0)?.acq_shipping,
                                                    acqDate: chain.find((c: any) => c.acq_date && c.acq_date !== '0000-00-00')?.acq_date,
                                                    acqSource: chain.find((c: any) => c.acq_source && c.acq_source.trim() !== '')?.acq_source,
                                                    acqCity: chain.find((c: any) => c.acq_city && c.acq_city.trim() !== '')?.acq_city,
                                                    acqState: chain.find((c: any) => c.acq_state && c.acq_state.trim() !== '')?.acq_state
                                                };

                                                // Prepare new cert object
                                                const newCert = {
                                                    ...data,
                                                    id: undefined, // Let backend generate new ID
                                                    userGrade: result, // AI Result
                                                    metadata: { ...data.metadata, estimated_value: 0 }, // Reset value needed?
                                                    user_notes: consolidatedNotes,
                                                    ...consolidatedAcq
                                                    // Maintain images
                                                };

                                                const saveRes = await fetch('api/plugin_merge_save.php', {
                                                    method: 'POST',
                                                    credentials: 'include',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                        certificate: newCert,
                                                        merged_ids: mergedIds
                                                    })
                                                });

                                                const saveRawText = await saveRes.text();
                                                let saveJson;
                                                try {
                                                    saveJson = JSON.parse(saveRawText);
                                                } catch (parseErr) {
                                                    console.error("SAVE JSON Parse Error. Raw Response:", saveRawText);
                                                    document.body.removeChild(statusDiv);
                                                    alert("SAVE ERROR: Server returned invalid response. Raw: " + saveRawText.substring(0, 200));
                                                    return;
                                                }
                                                document.body.removeChild(statusDiv);

                                                if (saveJson.success) {
                                                    alert("Merge Successful! The chain has been consolidated.");
                                                    window.location.href = `/?cert=${saveJson.id}`;
                                                } else {
                                                    alert("Merge Failed: " + saveJson.error);
                                                }

                                            } catch (e) {
                                                console.error(e);
                                                alert("Error during merge process.");
                                                const div = document.querySelector('div[style*="z-index:9999"]');
                                                if (div) document.body.removeChild(div);
                                            }
                                        }}
                                        className="mt-2 text-[10px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded border border-purple-200 hover:bg-purple-600 hover:text-white transition-colors font-bold uppercase tracking-wider animate-pulse"
                                    >
                                        <i className="fas fa-layer-group mr-1"></i> Merge & Re-assess
                                    </button>
                                )}
                            </div>
                            {data.metadata.estimated_value && data.metadata.estimated_value > 0 && (
                                <div className="mt-2 bg-green-100 border border-green-300 px-3 py-1 rounded-full inline-flex items-center gap-2">
                                    <i className="fas fa-chart-line text-green-600 text-xs"></i>
                                    <span className="text-green-800 font-black text-sm uppercase tracking-wide">
                                        Valuated: ${data.metadata.estimated_value}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Main Content Grid */}
                    <div className="grid grid-cols-12 gap-8">

                        {/* Left Col: Card Info & Grades */}
                        <div className="col-span-7 space-y-6">

                            <div className={`${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-300'} p-4 rounded-lg border print:bg-gray-100 print:border-gray-300`}>
                                <h3 className={`text-sm uppercase font-bold mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Card Information</h3>
                                <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                                    <div className="col-span-2">
                                        <p className="text-xs text-gray-500">NAME</p>
                                        <p className="font-bold text-xl">{data.metadata.name || "Unknown"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">SET</p>
                                        <p className="font-bold">{data.metadata.set || "Unknown"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">YEAR</p>
                                        <p className="font-bold">{data.metadata.year || "Unknown"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">EDITION</p>
                                        <p className="font-bold text-sm">{data.metadata.edition || "N/A"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">NUMBER</p>
                                        <p className="font-bold text-sm">{data.metadata.cardNumber || "N/A"}</p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-xs text-gray-500">ARTIST</p>
                                        <p className="font-bold text-sm">{data.metadata.artist || "Unknown"}</p>
                                    </div>
                                    <div className={`col-span-2 pt-2 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-300'}`}>
                                        <p className="text-xs text-gray-500">DATE SCANNED</p>
                                        <p className="font-bold">{data.dateScanned}</p>
                                    </div>
                                </div>
                            </div>

                            {!isCollectOnly && (
                                <div className="space-y-4">
                                    <h3 className={`text-sm uppercase font-bold border-b pb-1 ${theme === 'dark' ? 'text-gray-400 border-white/10' : 'text-gray-500 border-gray-300'}`}>Subgrades</h3>

                                    <div className="grid grid-cols-4 gap-2">
                                        <div className={`flex flex-col items-center justify-center p-2 rounded border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-blue-50 border-blue-100'}`}>
                                            <span className={`font-bold text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-blue-900'}`}>CEN</span>
                                            <span className={`font-black text-lg leading-none ${theme === 'dark' ? 'text-white' : 'text-blue-900'}`}>{finalGrade.centering}</span>
                                        </div>
                                        <div className={`flex flex-col items-center justify-center p-2 rounded border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-blue-50 border-blue-100'}`}>
                                            <span className={`font-bold text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-blue-900'}`}>COR</span>
                                            <span className={`font-black text-lg leading-none ${theme === 'dark' ? 'text-white' : 'text-blue-900'}`}>{finalGrade.corners}</span>
                                        </div>
                                        <div className={`flex flex-col items-center justify-center p-2 rounded border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-blue-50 border-blue-100'}`}>
                                            <span className={`font-bold text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-blue-900'}`}>EDG</span>
                                            <span className={`font-black text-lg leading-none ${theme === 'dark' ? 'text-white' : 'text-blue-900'}`}>{finalGrade.edges}</span>
                                        </div>
                                        <div className={`flex flex-col items-center justify-center p-2 rounded border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-blue-50 border-blue-100'}`}>
                                            <span className={`font-bold text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-blue-900'}`}>SUR</span>
                                            <span className={`font-black text-lg leading-none ${theme === 'dark' ? 'text-white' : 'text-blue-900'}`}>{finalGrade.surface}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Predicted Market Grades (company scores) — main cert view */}
                            {!isCollectOnly && finalGrade.predictedGrades && (
                                <div className={`pt-4 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                                    <h4 className="text-gray-400 text-[10px] uppercase font-black tracking-widest mb-3">Predicted Market Grades</h4>
                                    <div className="grid grid-cols-4 gap-3">
                                        <div className={`flex flex-col items-center justify-center p-3 rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-red-50 border-red-100'}`}>
                                            <span className={`font-black text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-red-800'}`}>PSA</span>
                                            <span className={`font-black text-xl leading-none ${theme === 'dark' ? 'text-white' : 'text-red-700'}`}>{finalGrade.predictedGrades.psa ?? (finalGrade.predictedGrades as any).PSA ?? '—'}</span>
                                        </div>
                                        <div className={`flex flex-col items-center justify-center p-3 rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-blue-50 border-blue-100'}`}>
                                            <span className={`font-black text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-blue-800'}`}>BGS</span>
                                            <span className={`font-black text-xl leading-none ${theme === 'dark' ? 'text-white' : 'text-blue-700'}`}>{finalGrade.predictedGrades.bgs ?? (finalGrade.predictedGrades as any).BGS ?? '—'}</span>
                                        </div>
                                        <div className={`flex flex-col items-center justify-center p-3 rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-purple-50 border-purple-100'}`}>
                                            <span className={`font-black text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-purple-800'}`}>CGC</span>
                                            <span className={`font-black text-xl leading-none ${theme === 'dark' ? 'text-white' : 'text-purple-700'}`}>{finalGrade.predictedGrades.cgc ?? (finalGrade.predictedGrades as any).CGC ?? '—'}</span>
                                        </div>
                                        <div className={`flex flex-col items-center justify-center p-3 rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-green-50 border-green-100'}`}>
                                            <span className={`font-black text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-green-800'}`}>TCG</span>
                                            <span className={`font-bold text-xs leading-none text-center ${theme === 'dark' ? 'text-white' : 'text-green-700'}`}>{finalGrade.predictedGrades.tcg ?? (finalGrade.predictedGrades as any).TCG ?? '—'}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="mt-4">
                                <p className="text-xs text-gray-400 uppercase font-bold">
                                    {isCollectOnly ? 'Collect Only Summary' : 'AI Analysis Summary'}
                                </p>
                                <p className={`text-sm italic mt-1 border-l-4 border-poke-accent pl-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                                    "{finalGrade.reasoning}"
                                </p>
                            </div>
                        </div>

                        {/* Right Col: Images & Final Grade */}
                        <div className="col-span-5 flex flex-col items-center">

                            {!isCollectOnly ? (
                                <>
                                    {/* Final Grade Badge */}
                                    {/* Strict Square Grade Block - Web Dashboard Standard */}
                                    <div style={{
                                        width: '180px', height: '180px',
                                        border: '1px solid #D4AF37',
                                        padding: '6px',
                                        marginBottom: '28px',
                                        background: theme === 'dark' ? '#040404' : '#F6F2E9'
                                    }}>
                                        <div style={{
                                            width: '100%', height: '100%',
                                            background: getGradeGradient(finalGrade.overall),
                                            boxShadow: theme === 'dark' ? 'inset 0 0 40px rgba(0,0,0,0.8)' : 'inset 0 0 20px rgba(0,0,0,0.1)',
                                            position: 'relative'
                                        }}>
                                            {/* Centering wrapper - inset flex works reliably in html2canvas */}
                                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <span style={{
                                                    fontSize: '100px', fontWeight: 400, color: '#fff', 
                                                    fontFamily: '"Playfair Display", "Georgia", serif',
                                                    lineHeight: 1, userSelect: 'none', display: 'block'
                                                }}>
                                                    {finalGrade.overall}
                                                </span>
                                            </div>
                                            <span style={{ position: 'absolute', bottom: '8px', left: 0, right: 0, textAlign: 'center', fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                                                {finalGrade.overall === 10 ? 'GEM MINT' : finalGrade.overall >= 9 ? 'MINT' : 'EXCELLENT'}
                                            </span>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2 mb-4 text-center max-w-xs">Get the Final Verdict when you grade with <a href="https://www.psacard.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-poke-accent">PSA</a>, <a href="https://www.cgccards.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-poke-accent">CGC</a>, <a href="https://www.beckett.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-poke-accent">BGS</a>, or <a href="https://www.taggrading.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-poke-accent">TAG</a>.</p>
                                </>
                            ) : (
                                <>
                                    <div style={{
                                        width: '180px', height: '180px',
                                        border: '1px solid #D4AF37',
                                        padding: '6px',
                                        marginBottom: '28px',
                                        background: theme === 'dark' ? '#040404' : '#F6F2E9'
                                    }}>
                                        <div style={{
                                            width: '100%', height: '100%',
                                            background: 'linear-gradient(135deg, rgba(212,175,55,0.14) 0%, rgba(153,0,0,0.10) 100%)',
                                            boxShadow: theme === 'dark' ? 'inset 0 0 40px rgba(0,0,0,0.8)' : 'inset 0 0 20px rgba(0,0,0,0.1)',
                                            position: 'relative',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}>
                                            <div style={{ textAlign: 'center' }}>
                                                <div className="text-[22px] font-black" style={{ color: '#D4AF37' }}>COLLECT</div>
                                                <div className="text-[22px] font-black" style={{ color: '#fff' }}>ONLY</div>
                                                <div className="text-[10px] uppercase tracking-[0.25em] font-bold mt-2" style={{ color: theme === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }}>
                                                    Identification
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2 mb-4 text-center max-w-xs">
                                        Collect Only Mode provides identification + AI description. No numeric grades, defects, or subgrades are shown.
                                    </p>
                                </>
                            )}

                            {/* Images - use blob URLs for very long data URLs so browsers render */}
                            <div className="space-y-4 w-full text-center">
                                {data.id && (
                                    <div className={`border p-1 shadow-sm inline-block ${theme === 'dark' ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}>
                                        <img
                                            src={(displayFrontUrl ?? data.frontRaw ?? data.frontCropped) || ''}
                                            className="max-w-full h-44 object-contain"
                                            alt={data.metadata.name}
                                        />
                                        <span className="text-[10px] text-gray-400 font-bold uppercase mt-1 block">Front Perspective</span>
                                    </div>
                                )}
                                {data.id && (
                                    <div className={`border p-1 shadow-sm inline-block ml-2 ${theme === 'dark' ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'}`}>
                                        <img
                                            src={(displayBackUrl ?? data.backRaw ?? data.backCropped) || ''}
                                            className="max-w-full h-44 object-contain"
                                            alt={data.metadata.name}
                                        />
                                        <span className="text-[10px] text-gray-400 font-bold uppercase mt-1 block">Back Perspective</span>
                                    </div>
                                )}
                            </div>

                            {/* Forensic Evidence - grouped under card images */}
                            {!isCollectOnly && finalGrade.defects && finalGrade.defects.length > 0 && (
                                <div className={`mt-4 pt-4 border-t w-full ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                                    <h3 className="text-gray-500 text-[10px] uppercase font-bold mb-3 flex items-center gap-2">
                                        <i className="fas fa-search-plus"></i> Forensic Evidence
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2">
                                        {finalGrade.defects.slice(0, 4).map((defect, idx) => {
                                            const sourceImg = getSourceImageByIndex(defect.imageIndex, defect);
                                            return (
                                                <div key={idx} className={`flex flex-col items-center p-1.5 rounded border print:bg-gray-50 ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                                    {sourceImg && defect.box2d && defect.box2d.length === 4 ? (
                                                        <EvidenceCrop imageSrc={sourceImg} box={defect.box2d} label={defect.category} />
                                                    ) : (
                                                        <div className={`w-32 h-32 md:w-40 md:h-40 rounded-lg border-2 border-dashed flex items-center justify-center ${theme === 'dark' ? 'bg-black/20 border-white/20' : 'bg-gray-100 border-gray-300'}`}>
                                                            <span className="text-[10px] text-gray-400 text-center px-1">No image</span>
                                                        </div>
                                                    )}
                                                    <p className="text-[8px] text-gray-500 mt-1 leading-tight text-center italic line-clamp-2">
                                                        {defect.description || (defect as any).reasoning || ''}
                                                    </p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {finalGrade.defects.length > 4 && (
                                        <p className="text-[9px] text-gray-400 mt-1.5 text-center italic">
                                            +{finalGrade.defects.length - 4} more flaws in audit.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Valuation History Section */}
                    {/* Valuation History Section */}
                    {fullLineage.length > 1 && (
                        <div className="mt-8 pt-6 border-t border-gray-200">
                            <h3 className="text-gray-500 text-sm uppercase font-bold mb-4 flex items-center gap-2">
                                <i className="fas fa-link text-green-600"></i> Verified Certificate Lineage
                                <span className="ml-2 bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full border border-gray-200">
                                    {historyCount} Linked Scans
                                </span>
                            </h3>

                            {/* Merge & Re-assess Button */}
                            {!isCollectOnly && user && String(user.id) === String(data.userId) && (data.parentScanId || (fullLineage.length >= 2)) && (
                                <div className="mb-4 text-center">
                                    <button
                                        onClick={async () => {
                                            if (!confirm("Start 'Merge & Re-assess' Process? (Cost: 1 Credit)")) return;

                                            try {
                                                // 1. Fetch Chain
                                                const chainRes = await fetch(`api/plugin_get_chain.php?id=${data.id}`, { credentials: 'include' });
                                                const chainJson = await chainRes.json();

                                                if (!chainJson.chain || chainJson.chain.length < 2) {
                                                    alert("Chain too short to merge.");
                                                    return;
                                                }

                                                // 2. Run AI Re-assess
                                                const { reassessChain } = await import('../services/geminiService');

                                                // Loading UI
                                                const statusDiv = document.createElement('div');
                                                statusDiv.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:9999;color:white;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:bold;flex-direction:column;";
                                                statusDiv.innerHTML = '<div><i class="fas fa-brain fa-spin"></i> RawGraded AI is Re-assessing...</div><div id="ai-status" style="font-size:16px;margin-top:20px;color:#ccc">Analyzing Forensic Audit History...</div>';
                                                document.body.appendChild(statusDiv);

                                                const result = await reassessChain(chainJson.chain, (s: string) => {
                                                    const el = document.getElementById('ai-status');
                                                    if (el) el.innerText = s;
                                                });

                                                if (!result) {
                                                    document.body.removeChild(statusDiv);
                                                    alert("AI Re-assessment failed. Please try again.");
                                                    return;
                                                }

                                                // 3. Save & Merge
                                                const el = document.getElementById('ai-status');
                                                if (el) el.innerText = "Finalizing Merge...";

                                                const mergedIds = chainJson.chain.map((c: any) => c.id);

                                                // Prepare new cert object
                                                const newCert = {
                                                    ...data,
                                                    id: undefined, // Let backend generate new ID
                                                    userGrade: result, // AI Result
                                                    metadata: { ...data.metadata, estimated_value: 0 }, // Reset value needed?
                                                };

                                                const saveRes = await fetch('api/plugin_merge_save.php', {
                                                    method: 'POST',
                                                    credentials: 'include',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                        certificate: newCert,
                                                        merged_ids: mergedIds
                                                    })
                                                });

                                                const saveJson = await saveRes.json();
                                                document.body.removeChild(statusDiv);

                                                if (saveJson.success) {
                                                    alert("Merge Successful! The chain has been consolidated.");
                                                    window.location.href = `/?cert=${saveJson.id}`;
                                                } else {
                                                    alert("Merge Failed: " + (saveJson.error || saveJson.message || "Unknown Error"));
                                                }

                                            } catch (e: any) {
                                                console.error("Merge Error:", e);
                                                alert("Error during merge process: " + (e.message || JSON.stringify(e)));
                                                const div = document.querySelector('div[style*="z-index:9999"]');
                                                if (div) document.body.removeChild(div);
                                            }
                                        }}
                                        className="mt-2 text-[10px] bg-purple-100 text-purple-600 px-3 py-1 rounded border border-purple-200 hover:bg-purple-600 hover:text-white transition-colors font-bold uppercase tracking-wider animate-pulse"
                                        style={{ display: isCollectOnly ? 'none' : undefined }}
                                    >
                                        <i className="fas fa-layer-group mr-1"></i> Merge & Re-assess (1 Credit)
                                    </button>
                                </div>
                            )}

                            {hiddenCount > 0 && (
                                <div className="mb-3 text-center">
                                    <span className="text-xs text-gray-400 italic bg-gray-50 px-3 py-1 rounded-full">
                                        + {hiddenCount} earlier verified scans hidden
                                    </span>
                                </div>
                            )}

                            <div className="space-y-3">
                                {displayedHistory.map((item: any, idx: number) => {
                                    // Calculate Delta
                                    // Find index in FULL lineage to get previous item
                                    const realIdx = fullLineage.findIndex((x: any) => x.id === item.id);
                                    const prevItem = realIdx > 0 ? fullLineage[realIdx - 1] : null;

                                    let delta = 0;
                                    if (prevItem) {
                                        delta = Number(item.overall_grade) - Number(prevItem.overall_grade);
                                    }

                                    return (
                                        <div key={item.id} className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${item.id === data.id ? (theme === 'dark' ? 'bg-blue-900/20 border-blue-500/30' : 'bg-blue-50/50 border-blue-100 ring-1 ring-blue-200') : (theme === 'dark' ? 'bg-white/5 border-white/10 hover:border-poke-accent/50' : 'bg-gray-50 border-gray-100 hover:border-poke-accent/30')}`}>
                                            <div className="flex items-center gap-4">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black ${item.id === data.id ? 'bg-poke-blue text-white' : 'bg-gray-200 text-gray-500'}`}>
                                                    {realIdx + 1}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black text-gray-700">
                                                        {item.id.substring(0, 8).toUpperCase()}
                                                        {item.id === data.id && <span className="ml-2 text-[9px] bg-blue-100 text-blue-700 px-1 rounded uppercase">Current</span>}
                                                    </p>
                                                    <p className="text-[10px] text-gray-400">{new Date(item.date_scanned).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-6">
                                                <div className="text-right min-w-[60px]">
                                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Est. Grade</p>
                                                    <div className="flex items-center justify-end gap-1">
                                                        <p className="font-black text-poke-blue text-lg leading-none">{item.overall_grade}</p>
                                                        {prevItem && delta !== 0 && (
                                                            <span className={`text-[9px] font-bold ${delta > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                                {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-right min-w-[80px]">
                                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Valuation</p>
                                                    <p className="font-black text-green-600">${item.estimated_value?.toLocaleString() || '0'}</p>
                                                </div>

                                                {item.id !== data.id ? (
                                                    <a href={`?cert=${item.id}`} className="text-gray-400 hover:text-poke-accent p-2 transition-colors">
                                                        <i className="fas fa-chevron-right"></i>
                                                    </a>
                                                ) : (
                                                    <div className="w-8 flex justify-center">
                                                        <i className="fas fa-map-marker-alt text-poke-blue"></i>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Acquisition Data Section - Private Owner View */}
                    {user && String(user.id) === String(data.userId) && (acqPrice || acqSource) && (
                        <div className="mt-8 pt-6 border-t border-gray-200">
                            <h3 className="text-gray-500 text-sm uppercase font-bold mb-4 flex items-center gap-2">
                                <i className="fas fa-file-invoice-dollar text-green-600"></i> Acquisition Data
                                <span className="ml-2 bg-green-100 text-green-600 text-[10px] px-2 py-0.5 rounded-full border border-green-200 uppercase font-bold">
                                    Private Record
                                </span>
                            </h3>

                            <div className={`rounded-xl border p-6 ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Cost Breakdown */}
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Cost Breakdown</h4>
                                        <div className="space-y-2">
                                            <div className={`flex justify-between text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                                                <span>Purchase Price</span>
                                                <span className="font-bold font-mono">${parseFloat(acqPrice || '0').toFixed(2)}</span>
                                            </div>
                                            <div className={`flex justify-between text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                                                <span>Tax</span>
                                                <span className="font-bold font-mono">${parseFloat(acqTax || '0').toFixed(2)}</span>
                                            </div>
                                            <div className={`flex justify-between text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                                                <span>Shipping</span>
                                                <span className="font-bold font-mono">${parseFloat(acqShipping || '0').toFixed(2)}</span>
                                            </div>
                                            <div className={`pt-3 mt-1 border-t flex justify-between items-center ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                                                <span className="text-xs font-black text-gray-500 uppercase">Total Investment</span>
                                                <span className="text-xl font-black text-green-600 font-mono">
                                                    ${(parseFloat(acqPrice || '0') + parseFloat(acqTax || '0') + parseFloat(acqShipping || '0')).toFixed(2)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Source Details */}
                                    <div className="space-y-4 md:border-l md:border-gray-200 md:pl-8">
                                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">Source Details</h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Source / Platform</span>
                                                <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>{acqSource || "N/A"}</span>
                                            </div>
                                            <div>
                                                <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Date Acquired</span>
                                                <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>{acqDate || "N/A"}</span>
                                            </div>
                                            <div>
                                                <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Location</span>
                                                <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
                                                    {acqCity ? `${acqCity}, ${acqState}` : (acqState || "N/A")}
                                                </span>
                                            </div>
                                            <div className="hidden">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}


                    {/* Similar Scans Section: Close matches (88%+) and Other scans (lower score) */}
                    <div className="mt-8 pt-6 border-t border-gray-200 no-print">
                        <h3 className="text-gray-500 text-sm uppercase font-bold mb-4 flex items-center gap-2">
                            <i className="fas fa-project-diagram text-poke-blue"></i> Potential Matches
                        </h3>
                        <div className="flex flex-col gap-2">
                            {data.similar_scans?.filter((sim: any) => {
                                if (sim.id === data.id) return false;
                                if (verifiedIds.includes(sim.id)) return false;
                                if ((sim.match_score || 0) < 88) return false;
                                return true;
                            }).map((sim: any) => (
                                <a
                                    key={sim.id}
                                    href={`?cert=${sim.id}`}
                                    className={`flex items-center justify-between rounded-lg hover:shadow-md transition-all p-3 group border ${theme === 'dark' ? 'bg-white/5 border-white/10 hover:border-poke-accent/50' : 'bg-white border-gray-200'}`}
                                >
                                    <div className="flex flex-col min-w-0">
                                        <p className={`text-sm font-bold truncate group-hover:text-poke-blue transition-colors gap-2 flex items-center ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
                                            {sim.name || 'Unknown'} <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${theme === 'dark' ? 'text-gray-300 bg-white/10' : 'text-gray-400 bg-gray-100'}`}>{sim.overall_grade}</span>
                                        </p>
                                        <p className="text-xs text-gray-500 truncate">{sim.card_set} • {sim.year} • {new Date(sim.date_scanned).toLocaleDateString()}</p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <div className={`text-xs font-black px-2 py-0.5 rounded ${sim.match_score >= 100 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                            {sim.match_score >= 100 ? '99% Match' : `${Math.min(sim.match_score, 99)}% Confidence`}
                                        </div>
                                        <i className="fas fa-arrow-right text-gray-300 group-hover:text-poke-accent transition-colors"></i>
                                    </div>
                                </a>
                            ))}
                            {data.similar_scans && data.similar_scans.filter((sim: any) => sim.id !== data.id && !verifiedIds.includes(sim.id) && (sim.match_score || 0) >= 88).length === 0 && (
                                <p className="text-xs text-gray-400 italic">No close matches (88%+) found in the archive.</p>
                            )}
                        </div>
                        {/* Other scans in archive (same card name/set, may be different copy) */}
                        {data.similar_scans && data.similar_scans.filter((sim: any) => sim.id !== data.id && !verifiedIds.includes(sim.id) && (sim.match_score || 0) >= 30 && (sim.match_score || 0) < 88).length > 0 && (
                            <div className="mt-4">
                                <h4 className="text-gray-400 text-xs uppercase font-bold mb-2 flex items-center gap-2">
                                    <i className="fas fa-images"></i> Other scans in archive
                                </h4>
                                <div className="flex flex-col gap-2">
                                    {data.similar_scans.filter((sim: any) => sim.id !== data.id && !verifiedIds.includes(sim.id) && (sim.match_score || 0) >= 30 && (sim.match_score || 0) < 88).map((sim: any) => (
                                        <a
                                            key={sim.id}
                                            href={`?cert=${sim.id}`}
                                            className={`flex items-center justify-between rounded-lg hover:shadow transition-all p-2 group border ${theme === 'dark' ? 'bg-white/5 border-white/10 hover:border-poke-accent/50' : 'bg-gray-50 border-gray-100'}`}
                                        >
                                            <div className="flex flex-col min-w-0">
                                                <p className={`text-xs font-bold truncate group-hover:text-poke-blue ${theme === 'dark' ? 'text-white' : 'text-gray-700'}`}>{sim.name || 'Unknown'} <span className="text-[10px] text-gray-400 font-mono">{sim.overall_grade}</span></p>
                                                <p className="text-[10px] text-gray-500 truncate">{sim.card_set} • {new Date(sim.date_scanned).toLocaleDateString()}</p>
                                            </div>
                                            <span className="text-[10px] text-gray-400">{Math.min(sim.match_score || 0, 99)}%</span>
                                            <i className="fas fa-arrow-right text-gray-300 text-xs"></i>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer with Disclaimer and Attribution */}
                <div className={`mt-12 pt-6 flex flex-col gap-6 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-300'}`}>
                    <div className="grid grid-cols-2 gap-8 items-start">
                        <div className={`text-[10px] leading-relaxed text-justify ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                            <p className={`font-bold mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>LEGAL DISCLAIMER & TERMS OF USE</p>
                            <p>
                                This grading analysis is generated by the RawGraded AI-powered tool and is provided for informational and entertainment purposes only.
                                The results presented here may or may not be accurate and are based on digital image analysis which can be limited by lighting, camera quality,
                                and AI interpretation errors. <strong>This is NOT a professional third-party authentication or investment grade.</strong>
                                RawGraded does not guarantee, elude, or suggest results for an actual professional grading service (e.g., PSA, BGS, CGC).
                                Please rely exclusively on recognized professional grading services to obtain an official, market-recognized grade.
                                This document does not constitute a guarantee of value or authenticity.
                            </p>
                        </div>
                        <div className="flex flex-col items-end gap-3 text-right">
                            <div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Ownership & Attribution</p>
                                <p className={`text-sm font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                                    {data.userTwitter || data.ownerUsername ? `Scanned & Claimed by @${(data.userTwitter || data.ownerUsername || '').replace('@', '')}` : 'Anonymous AI Scan'}
                                    {(data.isAlliance || data.userRole === 'admin') && <span className="ml-1 text-yellow-500" title="Alliance Member">ðŸ‘‘</span>}
                                    {data.isPck && <span className="ml-1 text-yellow-500" title="Pokemon Card King">â­</span>}
                                </p>
                                <p className="text-[10px] text-gray-400 mt-1">Timestamp: {data.dateScanned}</p>
                            </div>
                            <div className="flex gap-4 items-center">
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase">Audit Hash</span>
                                    <span className="font-mono text-xs text-gray-500">{data.id.split('-')[0]}...{data.id.split('-').pop()}</span>
                                </div>
                                <div className="w-12 h-12 bg-white flex items-center justify-center border border-gray-200 rounded p-1">
                                    <img
                                        src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`${window.location.origin}/?cert=${data.id}`)}`}
                                        className="w-full h-full object-contain"
                                        alt="Cert QR"
                                        crossOrigin="anonymous"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={`flex justify-center pt-4 border-t ${theme === 'dark' ? 'border-white/5' : 'border-gray-100'}`}>
                        <p className="text-[9px] font-bold text-gray-300 tracking-[0.2em] uppercase">
                            Authenticity Audited by RawGraded AI Engine v2.5
                        </p>
                    </div>
                </div>
            </div >
            {/* --- EXPORT HIDDEN CONTAINERS --- */}
            <div className="fixed left-0 top-0 opacity-0 pointer-events-none -z-50 no-print" style={{ width: '1000px' }}>
                {/* Full Certificate Export (Fixed 800px Width) */}
                <div
                    ref={fullExportRef}
                    className={`relative flex flex-col ${theme === 'dark' ? 'bg-[#0a0a0a] text-white' : 'bg-[#FBF9F6] text-black'}`}
                    style={{ width: '800px', padding: '48px', minHeight: '1200px' }}
                >
                    {/* Safety Spacer */}
                    <div style={{ height: '40px' }} />

                    <div
                        className={`border-b-[3px] flex justify-between items-end ${theme === 'dark' ? 'border-white/20' : 'border-black'}`}
                        style={{ paddingBottom: '20px', marginBottom: '32px' }}
                    >
                        <div className="flex flex-col shrink-0">
                            <div className="flex items-center shrink-0" style={{ lineHeight: '1', marginBottom: '8px' }}>
                                <LogoR size={40} style={{ marginRight: 12 }} />
                                <h1 style={{ fontSize: '36px', fontWeight: '900', fontStyle: 'italic', letterSpacing: '-0.05em', color: theme === 'dark' ? '#fff' : '#ed1c24', margin: 0, padding: 0 }}>RAWGRADED</h1>
                            </div>
                            <p style={{ fontSize: '18px', fontWeight: 'bold', color: theme === 'dark' ? '#9ca3af' : '#4b5563', margin: 0, padding: 0 }}>AI Grading Certificate</p>
                        </div>
                        <div className="text-right">
                            <p className="font-mono text-xs text-gray-500">CERTIFICATE ID</p>
                            <p className="font-mono text-2xl font-bold tracking-widest">{certId}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-12 gap-8">
                        <div className="col-span-7 space-y-6">
                            <div className={`p-6 rounded-xl border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-300'}`}>
                                <h3 className={`text-sm uppercase font-bold mb-3 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Card Information</h3>
                                <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                                    <div className="col-span-2">
                                        <p className="text-xs text-gray-500">NAME</p>
                                        <p className="font-bold text-2xl">{data.metadata.name || "Unknown"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">SET</p>
                                        <p className="font-bold">{data.metadata.set || "Unknown"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">YEAR</p>
                                        <p className="font-bold">{data.metadata.year || "Unknown"}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">ARTIST</p>
                                        <p className="font-bold">{data.metadata?.artist || 'Unknown'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">NUMBER</p>
                                        <p className="font-bold">{data.metadata.cardNumber || "N/A"}</p>
                                    </div>
                                    {(data as any).vault_copy != null && (data as any).vault_copy !== '' && (
                                        <div>
                                            <p className="text-xs text-gray-500">VAULT COPY</p>
                                            <p className="font-bold">#{(data as any).vault_copy}</p>
                                        </div>
                                    )}
                                    <div className="hidden">
                                    </div>
                                    <div className="hidden">
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-4 gap-3">
                                    {['CENTERING', 'CORNERS', 'EDGES', 'SURFACE'].map(key => (
                                        <div key={key} className={`flex flex-col items-center justify-center p-3 rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-blue-50 border-blue-100'}`}>
                                            <span className={`font-bold text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-blue-900'}`}>{key.substring(0, 3)}</span>
                                            <span className={`font-black text-xl leading-none ${theme === 'dark' ? 'text-white' : 'text-blue-900'}`}>{(finalGrade as any)[key.toLowerCase()]}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Export Predicted Equivalents */}
                                {finalGrade.predictedGrades && (
                                    <div className={`pt-4 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                                        <h4 className="text-gray-400 text-[10px] uppercase font-black tracking-widest mb-3">Predicted Market Grades</h4>
                                        <div className="grid grid-cols-4 gap-3">
                                            <div className={`flex flex-col items-center justify-center p-3.5 min-h-[52px] rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-red-50 border-red-100'}`}>
                                                <span className={`font-black text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-red-800'}`}>PSA</span>
                                                <span className={`font-black text-xl leading-none ${theme === 'dark' ? 'text-white' : 'text-red-700'}`}>{finalGrade.predictedGrades.psa}</span>
                                            </div>
                                            <div className={`flex flex-col items-center justify-center p-3.5 min-h-[52px] rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-blue-50 border-blue-100'}`}>
                                                <span className={`font-black text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-blue-800'}`}>BGS</span>
                                                <span className={`font-black text-xl leading-none ${theme === 'dark' ? 'text-white' : 'text-blue-700'}`}>{finalGrade.predictedGrades.bgs}</span>
                                            </div>
                                            <div className={`flex flex-col items-center justify-center p-3.5 min-h-[52px] rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-purple-50 border-purple-100'}`}>
                                                <span className={`font-black text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-purple-800'}`}>CGC</span>
                                                <span className={`font-black text-xl leading-none ${theme === 'dark' ? 'text-white' : 'text-purple-700'}`}>{finalGrade.predictedGrades.cgc}</span>
                                            </div>
                                            <div className={`flex flex-col items-center justify-center p-3.5 min-h-[52px] rounded-lg border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-green-50 border-green-100'}`}>
                                                <span className={`font-black text-[10px] mb-1 ${theme === 'dark' ? 'text-gray-400' : 'text-green-800'}`}>TCG</span>
                                                <span className={`font-bold text-xs leading-none text-center ${theme === 'dark' ? 'text-white' : 'text-green-700'}`}>{finalGrade.predictedGrades.tcg}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="col-span-5 flex flex-col items-center pt-4">
                            {/* Strict Square Grade Block - Web Dashboard Mobile */}
                            <div style={{
                                width: '180px', height: '180px',
                                border: '1px solid #D4AF37',
                                padding: '6px',
                                marginBottom: '28px',
                                background: theme === 'dark' ? '#040404' : '#F6F2E9'
                            }}>
                                <div style={{
                                    width: '100%', height: '100%',
                                    background: getGradeGradient(finalGrade.overall),
                                    boxShadow: theme === 'dark' ? 'inset 0 0 40px rgba(0,0,0,0.8)' : 'inset 0 0 20px rgba(0,0,0,0.1)',
                                    position: 'relative'
                                }}>
                                    {/* Centering wrapper - inset flex works reliably in html2canvas */}
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <span style={{
                                            fontSize: '100px', fontWeight: 400, color: '#fff', 
                                            fontFamily: '"Playfair Display", "Georgia", serif',
                                            lineHeight: 1, userSelect: 'none', display: 'block'
                                        }}>
                                            {finalGrade.overall}
                                        </span>
                                    </div>
                                    <span style={{ position: 'absolute', bottom: '8px', left: 0, right: 0, textAlign: 'center', fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                                        {finalGrade.overall === 10 ? 'GEM MINT' : finalGrade.overall >= 9 ? 'MINT' : 'EXCELLENT'}
                                    </span>
                                </div>
                            </div>
                            <p className="text-xs text-gray-500 mt-2 mb-4 text-center leading-snug pb-1">Get the Final Verdict when you grade with <a href="https://www.psacard.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-poke-accent">PSA</a>, <a href="https://www.cgccards.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-poke-accent">CGC</a>, <a href="https://www.beckett.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-poke-accent">BGS</a>, or <a href="https://www.taggrading.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-poke-accent">TAG</a>.</p>
                            <div className="space-y-6 w-full text-center max-w-full overflow-visible">
                                {(displayFrontUrl ?? data.frontCropped) && (
                                    <div className={`border-4 p-2 shadow-xl inline-block rounded-xl transform rotate-1 max-w-[220px] ${theme === 'dark' ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-100'}`}>
                                        <img src={(displayFrontUrl ?? data.frontCropped) || ''} className="h-52 max-h-52 w-full object-contain rounded-lg" alt="Front" />
                                    </div>
                                )}
                                {(displayBackUrl ?? data.backCropped) && (
                                    <div className={`border-4 p-2 shadow-xl inline-block -ml-6 rounded-xl transform -rotate-2 max-w-[220px] ${theme === 'dark' ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-100'}`}>
                                        <img src={(displayBackUrl ?? data.backCropped) || ''} className="h-52 max-h-52 w-full object-contain rounded-lg" alt="Back" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Evidence Section */}
                    {
                        finalGrade.defects && finalGrade.defects.length > 0 && (
                            <div className={`mt-8 pt-6 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                                <h3 className={`text-sm uppercase font-bold mb-4 flex items-center gap-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                                    <i className="fas fa-search-plus"></i> Forensic Evidence & Identified Flaws
                                </h3>
                                <div className="grid grid-cols-4 gap-4">
                                    {finalGrade.defects.slice(0, 4).map((defect, idx) => {
                                        const sourceImg = getSourceImageByIndex(defect.imageIndex, defect);
                                        return (
                                            <div key={idx} className={`flex flex-col items-center p-2 rounded-xl border ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                                {sourceImg && defect.box2d?.length === 4 ? (
                                                    <EvidenceCrop imageSrc={sourceImg} box={defect.box2d} label={defect.category} />
                                                ) : (
                                                    <div className={`w-40 h-40 rounded-xl border-2 border-dashed flex items-center justify-center ${theme === 'dark' ? 'bg-black/20 border-white/20' : 'bg-gray-100 border-gray-300'}`}>
                                                        <span className="text-xs text-gray-400">No image</span>
                                                    </div>
                                                )}
                                                <p className="text-[10px] text-gray-500 mt-2 leading-tight text-center italic min-h-[2.5rem] pb-2">
                                                    {defect.description || (defect as any).reasoning || ''}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )
                    }

                    <div className="mt-10 p-6 bg-poke-dark/5 rounded-2xl border border-poke-accent/20">
                        <p className={`text-xs uppercase font-black tracking-widest mb-2 flex items-center gap-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-400'}`}>
                            <i className="fas fa-robot text-poke-accent"></i> AI Reasoning
                        </p>
                        <p className={`text-lg italic font-medium leading-relaxed ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                            "{finalGrade.reasoning}"
                        </p>
                    </div>

                    {user && (
                        <MarketValuePlugin 
                            certId={data.id} 
                            overallGrade={(data as any).overall_grade}
                            cardName={data.metadata.name || ''}
                            initialUnlocked={Number((data as any).market_price_unlocked) === 1}
                            initialDataJson={(data as any).market_price_json || null}
                            userRole={(user as any).role || 'user'}
                            paidCredits={(user as any).paid_credits || 0}
                            onCreditUsed={(newBalance) => {
                                if (onCreditsUpdated) {
                                  onCreditsUpdated({ free: (user as any).scans_this_week || 0, paid: newBalance });
                                }
                            }}
                        />
                    )}

                    {/* --- PREVIOUS SCAN ATTRIBUTION (Requested Feature) --- */}
                    {
                        data.history && data.history.length > 0 && (
                            <div className={`mt-6 pt-4 border-t-2 ${theme === 'dark' ? 'border-white/10' : 'border-black/10'}`}>
                                <h3 className="text-xs font-black text-gray-400 uppercase mb-3 flex items-center gap-2">
                                    <i className="fas fa-link text-poke-gold"></i> Previous Scan Verification
                                </h3>
                                <div className={`p-4 rounded-xl border flex items-center justify-between ${theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                    <div className="space-y-1">
                                        <p className="text-[10px] uppercase font-bold text-gray-400">Previous Scan ID</p>
                                        <p className={`font-mono text-sm font-bold ${theme === 'dark' ? 'text-white' : 'text-black'}`}>{data.history[0].id}</p>
                                        <p className="text-[10px] uppercase font-bold text-gray-400 mt-2">Verified URL</p>
                                        <p className="font-mono text-[10px] text-blue-600 break-all">
                                            {window.location.origin}/?cert={data.history[0].id}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-center bg-white p-2 rounded border border-gray-200 ml-4">
                                        {/* QR Code using API - 150x150 */}
                                        <img
                                            src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`${window.location.origin}/?cert=${data.history[0].id}`)}`}
                                            className="w-20 h-20"
                                            alt="Previous Scan QR"
                                            crossOrigin="anonymous"
                                        />
                                        <span className="text-[8px] font-bold text-gray-400 mt-1 uppercase">Scan Logic</span>
                                    </div>
                                </div>
                            </div>
                        )
                    }

                    <div className={`mt-auto pt-10 pb-8 border-t flex justify-between items-end ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
                        <div className="max-w-[500px]">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Legal Attribution & Verification</p>
                            <p className="text-[9px] text-gray-400 leading-tight text-justify min-h-[2.25rem]">
                                Scanned and verified via RawGraded AI Engine v2.5. This certificate provides an AI-augmented
                                view of card condition but does not replace professional physical grading. Ownership claimed
                                by <strong className={theme === 'dark' ? 'text-gray-300' : ''}>@{data.userTwitter || data.ownerUsername || 'Anonymous'}</strong>
                                {(data.isAlliance || data.userRole === 'admin') && <span className="ml-1 text-yellow-600">ðŸ‘‘</span>}
                                {data.isPck && <span className="ml-1 text-yellow-600">â­ </span>}
                                at {data.dateScanned}.
                            </p>
                        </div>
                        <div className="flex gap-4 items-center shrink-0">
                            <div className="text-right">
                                <p className="text-[10px] font-black text-gray-400 uppercase">Audit Hash</p>
                                <p className="font-mono text-xs font-bold">{data.id}</p>
                            </div>
                            <div className="w-16 h-16 shrink-0 bg-white flex items-center justify-center border-2 border-gray-200 rounded-xl p-1">
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`${window.location.origin}/?cert=${data.id}`)}`}
                                    className="w-full h-full object-contain"
                                    alt="Cert QR"
                                    crossOrigin="anonymous"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════
                {/* ═══════════════════════════════════════════════════════
                    SOCIAL EXPORT — DARK ART GALLERIA (SQUARE)
                    ═══════════════════════════════════════════════════════ */}
                <div
                    ref={socialExportRef}
                    style={{
                        width: '800px', height: '800px',
                        background: '#090909',
                        boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                        fontFamily: '"Playfair Display", "Georgia", serif',
                        overflow: 'hidden', position: 'relative',
                        color: '#D4AF37'
                    }}
                >
                    {/* Delicate outer framing lines */}
                    <div style={{ position: 'absolute', top: 12, left: 12, right: 12, bottom: 12, border: '1px solid #2A2416', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: 18, left: 18, right: 18, bottom: 18, border: '1px solid #1A160D', pointerEvents: 'none' }} />

                    {/* HEADER */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '36px 44px 0px 44px', flexShrink: 0, position: 'relative', zIndex: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <LogoR size={36} />
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <p style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '0.05em', color: '#D4AF37', margin: 0, lineHeight: 1 }}>RAWGRADED</p>
                                <p style={{ fontSize: '8px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.4em', textTransform: 'uppercase', color: '#887440', margin: 0, marginTop: '6px' }}>Verified AI Scan</p>
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <p style={{ fontSize: '8px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.4em', textTransform: 'uppercase', color: '#887440', margin: 0 }}>Audit ID</p>
                            <p style={{ fontSize: '20px', fontWeight: 400, letterSpacing: '0.15em', color: '#D4AF37', margin: 0, marginTop: '4px' }}>{certId}</p>
                        </div>
                    </div>

                    {/* MAIN CONTENT */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 44px 0 44px', position: 'relative', zIndex: 10 }}>
                        
                        <div style={{ marginBottom: '30px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <h2 style={{ fontSize: '32px', fontWeight: 400, fontStyle: 'italic', color: '#E8C55A', margin: 0, letterSpacing: '0.02em', overflow: 'visible', whiteSpace: 'normal', lineHeight: '1.4', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', paddingBottom: '4px' }}>{data.metadata.name || 'Unknown Artwork'}</h2>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '12px' }}>
                                <span style={{ width: '40px', height: '1px', background: '#3A3121' }} />
                                <span style={{ fontSize: '11px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.25em', color: '#AA9155', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {data.metadata.set} • {data.metadata.year}
                                    {(data as any).vault_copy != null && (data as any).vault_copy !== '' && ` • #${(data as any).vault_copy}`}
                                </span>
                                <span style={{ width: '40px', height: '1px', background: '#3A3121' }} />
                            </div>
                        </div>

                        {/* Gallery Layout */}
                        <div style={{ display: 'flex', flex: 1, gap: '40px' }}>
                            
                            {/* Left: The Grade (The Square Plaque) */}
                            <div style={{ width: '220px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                
                                {/* Strict Square Grade Block */}
                                <div style={{
                                    width: '180px', height: '180px',
                                    border: '1px solid #D4AF37',
                                    padding: '6px',
                                    marginBottom: '28px',
                                    background: '#040404'
                                }}>
                                    <div style={{
                                        width: '100%', height: '100%',
                                        background: getGradeGradient(finalGrade.overall),
                                        boxShadow: 'inset 0 0 40px rgba(0,0,0,0.8)',
                                        position: 'relative'
                                    }}>
                                        {/* Centering wrapper - inset flex works reliably in html2canvas */}
                                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <span style={{
                                                fontSize: '100px', fontWeight: 400, color: '#fff', 
                                                fontFamily: '"Playfair Display", "Georgia", serif',
                                                lineHeight: 1, userSelect: 'none', display: 'block'
                                            }}>
                                                {finalGrade.overall}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                
                                <span style={{ fontSize: '12px', fontFamily: 'system-ui, sans-serif', fontWeight: 300, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#D4AF37', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {finalGrade.overall === 10 ? 'GEM MINT' : finalGrade.overall >= 9 ? 'MINT' : 'EXCELLENT'}
                                </span>

                                {/* Unified Subgrades & Toggles Container */}
                                <div style={{ width: '100%', borderTop: '1px solid #2A2416', display: 'flex', flexDirection: 'column' }}>
                                    
                                    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {[
                                            { label: 'Centering', val: finalGrade.centering },
                                            { label: 'Corners',   val: finalGrade.corners },
                                            { label: 'Edges',     val: finalGrade.edges },
                                            { label: 'Surface',   val: finalGrade.surface }
                                        ].map(sub => (
                                            <div key={sub.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px' }}>
                                                <span style={{ fontSize: '9px', fontFamily: 'system-ui, sans-serif', fontWeight: 300, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', display: 'flex', alignItems: 'center' }}>{sub.label}</span>
                                                <span style={{ fontSize: '15px', fontFamily: '"Playfair Display", "Georgia", serif', fontWeight: 700, color: '#FBF9F6', display: 'flex', alignItems: 'center' }}>{sub.val != null ? sub.val : 'N/A'}</span>
                                            </div>
                                        ))}
                                    </div>
                                    
                                    {(showCrossGrades || showMarketData) && (
                                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
                                            {showMarketData && Number(valuation?.estimated_value_usd || data.metadata.estimated_value) > 0 && (
                                                <div style={{ borderTop: '1px solid #2A2416', padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '8px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#887440', display: 'flex', alignItems: 'center' }}>Est. Market Value</span>
                                                    <span style={{ fontSize: '20px', fontFamily: '"Playfair Display", "Georgia", serif', fontWeight: 700, color: '#D4AF37', display: 'flex', alignItems: 'center' }}>${Number(valuation?.estimated_value_usd || data.metadata.estimated_value).toFixed(2)}</span>
                                                </div>
                                            )}
                                            {showCrossGrades && (
                                                <div style={{ borderTop: '1px solid #2A2416', padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                    <span style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#5A4D2B', textAlign: 'center' }}>Projected Equivalents</span>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'system-ui, sans-serif' }}>
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}><span style={{ fontSize: '8px', color: '#887440' }}>PSA:</span><span style={{ fontSize: '11px', color: '#D4AF37', fontWeight: 700 }}>{finalGrade.overall}</span></div>
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}><span style={{ fontSize: '8px', color: '#887440' }}>BGS:</span><span style={{ fontSize: '11px', color: '#D4AF37', fontWeight: 700 }}>{finalGrade.overall}</span></div>
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}><span style={{ fontSize: '8px', color: '#887440' }}>CGC:</span><span style={{ fontSize: '11px', color: '#D4AF37', fontWeight: 700 }}>{finalGrade.overall}</span></div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right: The Cards (The Artwork) */}
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
                                {/* Museum Framed Front */}
                                <div style={{
                                    padding: '12px',
                                    background: '#111111',
                                    border: '1px solid #3A3121',
                                    boxShadow: '0 20px 40px #040404',
                                    transform: 'rotate(-1deg)'
                                }}>
                                    <div style={{ border: '1px solid #2A2416', padding: '2px', background: '#090909' }}>
                                        <img src={(displayFrontUrl ?? data.frontCropped) || ''} style={{ height: '240px', width: 'auto', maxWidth: '200px', display: 'block' }} alt="Front" />
                                    </div>
                                </div>
                                
                                {/* Museum Framed Back */}
                                <div style={{
                                    padding: '12px',
                                    background: '#111111',
                                    border: '1px solid #3A3121',
                                    boxShadow: '0 20px 40px #040404',
                                    transform: 'rotate(1.5deg)',
                                    marginTop: '40px'
                                }}>
                                    <div style={{ border: '1px solid #2A2416', padding: '2px', background: '#090909' }}>
                                        <img src={(displayBackUrl ?? data.backCropped) || ''} style={{ height: '230px', width: 'auto', maxWidth: '190px', display: 'block' }} alt="Back" />
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* FOOTER */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 44px 30px 44px', position: 'relative', zIndex: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '24px', height: '24px', border: '1px solid #D4AF37', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: '11px', fontWeight: 600, color: '#D4AF37', fontFamily: 'system-ui, sans-serif', lineHeight: 1, marginTop: '2px' }}>
                                    {(data.userTwitter || data.ownerUsername || 'P').substring(0, 1).toUpperCase()}
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '9px', fontFamily: 'system-ui, sans-serif', fontWeight: 300, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', display: 'flex', alignItems: 'center' }}>Curated by</span>
                                <span style={{ fontSize: '13px', fontWeight: 400, letterSpacing: '0.05em', color: '#D4AF37', display: 'flex', alignItems: 'center' }}>@{data.userTwitter || data.ownerUsername || 'Anonymous'}</span>
                                {data.isAlliance && <span style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '3px 6px', border: '1px solid #4A5D7E', color: '#8BA6D4' }}>Alliance</span>}
                                {data.userRole === 'admin' && <span style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '3px 6px', border: '1px solid #7E3A3A', color: '#D48B8B' }}>Founder</span>}
                                {data.userRole === 'premium' && <span style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '3px 6px', border: '1px solid #7E6A3A', color: '#D4B98B' }}>King</span>}
                                {data.isPck && <span style={{ color: '#D4AF37', fontSize: '11px' }}>&#11088;</span>}
                            </div>
                        </div>
                        <p style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', fontWeight: 300, letterSpacing: '0.4em', textTransform: 'uppercase', color: '#5A4D2B', margin: 0 }}>Neural Engine Audit 2.5</p>
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════
                    SOCIAL EXPORT — LIGHT ART GALLERIA (SQUARE)
                    ═══════════════════════════════════════════════════════ */}
                <div
                    ref={socialExportLightRef}
                    style={{
                        width: '800px', height: '800px',
                        background: '#FBF9F6',
                        boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                        fontFamily: '"Playfair Display", "Georgia", serif',
                        overflow: 'hidden', position: 'relative',
                        color: '#1A1A1A'
                    }}
                >
                    {/* Delicate outer framing lines */}
                    <div style={{ position: 'absolute', top: 12, left: 12, right: 12, bottom: 12, border: '1px solid #EAE0D3', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: 18, left: 18, right: 18, bottom: 18, border: '1px solid #F2EBE1', pointerEvents: 'none' }} />

                    {/* HEADER */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '36px 44px 0px 44px', flexShrink: 0, position: 'relative', zIndex: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <LogoR size={36} />
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <p style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '0.05em', color: '#1A1A1A', margin: 0, lineHeight: 1 }}>RAWGRADED</p>
                                <p style={{ fontSize: '8px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.4em', textTransform: 'uppercase', color: '#8B7355', margin: 0, marginTop: '6px' }}>Verified AI Scan</p>
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <p style={{ fontSize: '8px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.4em', textTransform: 'uppercase', color: '#8B7355', margin: 0 }}>Audit ID</p>
                            <p style={{ fontSize: '20px', fontWeight: 400, letterSpacing: '0.15em', color: '#1A1A1A', margin: 0, marginTop: '4px' }}>{certId}</p>
                        </div>
                    </div>

                    {/* MAIN CONTENT */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 44px 0 44px', position: 'relative', zIndex: 10 }}>
                        
                        <div style={{ marginBottom: '30px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <h2 style={{ fontSize: '32px', fontWeight: 400, fontStyle: 'italic', color: '#2C2518', margin: 0, letterSpacing: '0.02em', overflow: 'visible', whiteSpace: 'normal', lineHeight: '1.4', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', paddingBottom: '4px' }}>{data.metadata.name || 'Unknown Artwork'}</h2>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '12px' }}>
                                <span style={{ width: '40px', height: '1px', background: '#DFD5C5' }} />
                                <span style={{ fontSize: '11px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.25em', color: '#8B7355', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {data.metadata.set} • {data.metadata.year}
                                    {(data as any).vault_copy != null && (data as any).vault_copy !== '' && ` • #${(data as any).vault_copy}`}
                                </span>
                                <span style={{ width: '40px', height: '1px', background: '#DFD5C5' }} />
                            </div>
                        </div>

                        {/* Gallery Layout */}
                        <div style={{ display: 'flex', flex: 1, gap: '40px' }}>
                            
                            {/* Left: The Grade (The Square Plaque) */}
                            <div style={{ width: '220px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                
                                {/* Strict Square Grade Block */}
                                <div style={{
                                    width: '180px', height: '180px',
                                    border: '1px solid #D4AF37',
                                    padding: '6px',
                                    marginBottom: '28px',
                                    background: '#F6F2E9'
                                }}>
                                    <div style={{
                                        width: '100%', height: '100%',
                                        background: getGradeGradient(finalGrade.overall),
                                        boxShadow: 'inset 0 0 20px rgba(0,0,0,0.1)',
                                        position: 'relative'
                                    }}>
                                        {/* Centering wrapper - inset flex works reliably in html2canvas */}
                                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <span style={{
                                                fontSize: '100px', fontWeight: 400, color: '#fff', 
                                                fontFamily: '"Playfair Display", "Georgia", serif',
                                                lineHeight: 1, userSelect: 'none', display: 'block'
                                            }}>
                                                {finalGrade.overall}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                
                                <span style={{ fontSize: '12px', fontFamily: 'system-ui, sans-serif', fontWeight: 300, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#8B7355', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {finalGrade.overall === 10 ? 'GEM MINT' : finalGrade.overall >= 9 ? 'MINT' : 'EXCELLENT'}
                                </span>

                                {/* Unified Subgrades & Toggles Container */}
                                <div style={{ width: '100%', borderTop: '1px solid #EAE0D3', display: 'flex', flexDirection: 'column' }}>
                                    
                                    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {[
                                            { label: 'Centering', val: finalGrade.centering },
                                            { label: 'Corners',   val: finalGrade.corners },
                                            { label: 'Edges',     val: finalGrade.edges },
                                            { label: 'Surface',   val: finalGrade.surface }
                                        ].map(sub => (
                                            <div key={sub.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px' }}>
                                                <span style={{ fontSize: '9px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8B7355', display: 'flex', alignItems: 'center' }}>{sub.label}</span>
                                                <span style={{ fontSize: '15px', fontFamily: '"Playfair Display", "Georgia", serif', fontWeight: 700, color: '#1A1A1A', display: 'flex', alignItems: 'center' }}>{sub.val != null ? sub.val : 'N/A'}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {(showCrossGrades || showMarketData) && (
                                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
                                            {showMarketData && Number(valuation?.estimated_value_usd || data.metadata.estimated_value) > 0 && (
                                                <div style={{ borderTop: '1px solid #EAE0D3', padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '8px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#8B7355', display: 'flex', alignItems: 'center' }}>Est. Market Value</span>
                                                    <span style={{ fontSize: '20px', fontFamily: '"Playfair Display", "Georgia", serif', fontWeight: 700, color: '#2C2518', display: 'flex', alignItems: 'center' }}>${Number(valuation?.estimated_value_usd || data.metadata.estimated_value).toFixed(2)}</span>
                                                </div>
                                            )}
                                            {showCrossGrades && (
                                                <div style={{ borderTop: '1px solid #EAE0D3', padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                    <span style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#AF9D83', textAlign: 'center' }}>Projected Equivalents</span>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'system-ui, sans-serif' }}>
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}><span style={{ fontSize: '8px', color: '#8B7355' }}>PSA:</span><span style={{ fontSize: '11px', color: '#2C2518', fontWeight: 700 }}>{finalGrade.overall}</span></div>
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}><span style={{ fontSize: '8px', color: '#8B7355' }}>BGS:</span><span style={{ fontSize: '11px', color: '#2C2518', fontWeight: 700 }}>{finalGrade.overall}</span></div>
                                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}><span style={{ fontSize: '8px', color: '#8B7355' }}>CGC:</span><span style={{ fontSize: '11px', color: '#2C2518', fontWeight: 700 }}>{finalGrade.overall}</span></div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right: The Cards (The Artwork) */}
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
                                {/* Museum Framed Front */}
                                <div style={{
                                    padding: '12px',
                                    background: '#FFFFFF',
                                    border: '1px solid #EAE0D3',
                                    boxShadow: '0 20px 40px rgba(0,0,0,0.06)',
                                    transform: 'rotate(-1deg)'
                                }}>
                                    <div style={{ border: '1px solid #F2EBE1', padding: '2px', background: '#FAFAFA' }}>
                                        <img src={(displayFrontUrl ?? data.frontCropped) || ''} style={{ height: '240px', width: 'auto', maxWidth: '200px', display: 'block' }} alt="Front" />
                                    </div>
                                </div>
                                
                                {/* Museum Framed Back */}
                                <div style={{
                                    padding: '12px',
                                    background: '#FFFFFF',
                                    border: '1px solid #EAE0D3',
                                    boxShadow: '0 20px 40px rgba(0,0,0,0.06)',
                                    transform: 'rotate(1.5deg)',
                                    marginTop: '40px'
                                }}>
                                    <div style={{ border: '1px solid #F2EBE1', padding: '2px', background: '#FAFAFA' }}>
                                        <img src={(displayBackUrl ?? data.backCropped) || ''} style={{ height: '230px', width: 'auto', maxWidth: '190px', display: 'block' }} alt="Back" />
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* FOOTER */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 44px 30px 44px', position: 'relative', zIndex: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '24px', height: '24px', border: '1px solid #D4AF37', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600, color: '#1A1A1A', fontFamily: 'system-ui, sans-serif' }}>
                                {(data.userTwitter || data.ownerUsername || 'P').substring(0, 1).toUpperCase()}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '9px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8B7355' }}>Curated by</span>
                                <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.05em', color: '#1A1A1A' }}>@{data.userTwitter || data.ownerUsername || 'Anonymous'}</span>
                                {data.isAlliance && <span style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '3px 6px', border: '1px solid #B8D0F6', background: '#EAF1FA', color: '#3A5A8E' }}>Alliance</span>}
                                {data.userRole === 'admin' && <span style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '3px 6px', border: '1px solid #F6B8B8', background: '#FAEAEA', color: '#8E3A3A' }}>Founder</span>}
                                {data.userRole === 'premium' && <span style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '3px 6px', border: '1px solid #F6E2B8', background: '#FAF6EA', color: '#8E6F3A' }}>King</span>}
                                {data.isPck && <span style={{ color: '#D4AF37', fontSize: '11px' }}>&#11088;</span>}
                            </div>
                        </div>
                        <p style={{ fontSize: '7px', fontFamily: 'system-ui, sans-serif', fontWeight: 400, letterSpacing: '0.4em', textTransform: 'uppercase', color: '#AF9D83', margin: 0 }}>Neural Engine Audit 2.5</p>
                    </div>
                </div>

                {/* Slab Slip Export - wrapper with 2px padding so border/logo never on canvas edge */}
                <div ref={slabSlipRef} style={{ width: '754px', height: '1054px', padding: 2, backgroundColor: '#fff', boxSizing: 'border-box' }}>
                    <div style={{ width: 750, height: 1050 }}>
                        <SlabSlip data={data} finalGrade={finalGrade} />
                    </div>
                </div>

                {/* Slab Slip Preview (Visible, Scaled for UI) */}
                <div
                    className="origin-top-left"
                    style={{ transform: 'scale(0.32)', width: '240px', height: '338px', overflow: 'hidden' }}
                >
                    <SlabSlip
                        data={data}
                        finalGrade={finalGrade}
                    />
                </div>
            </div>

            {/* Certificate of Receipt - Private Metadata Export (HIDDEN) */}
            <div className="fixed left-0 top-0 opacity-0 pointer-events-none -z-50">
                <div ref={receiptRef} className="bg-[#0a0a0a] text-[#FBF9F6] flex flex-col" style={{ width: '800px', padding: '48px', border: '8px solid #D4AF37' }}>
                    {/* Safety Spacer */}
                    <div style={{ height: '40px' }} />

                    <div className="border-b-[3px] border-[#D4AF37] flex justify-between items-start" style={{ paddingBottom: '32px', marginBottom: '32px' }}>
                        <div className="flex flex-col">
                            <div className="flex items-center" style={{ lineHeight: '1', marginBottom: '8px' }}>
                                <LogoR size={32} style={{ marginRight: 10 }} />
                                <h1 style={{ fontSize: '28px', fontWeight: '900', fontStyle: 'italic', letterSpacing: '-0.05em', color: '#D4AF37', margin: 0, padding: 0 }}>RAWGRADED</h1>
                            </div>
                            <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#FBF9F6', textTransform: 'uppercase', margin: 0, padding: 0 }}>Certificate of Acquisition</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs font-black text-gray-400 uppercase">Cert ID</p>
                            <p className="text-2xl font-mono font-bold">{certId}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-12">
                        <div className="space-y-6">
                            <div className="bg-[#111111] border border-white/10 p-6 rounded-xl">
                                <h3 className="text-xs font-black text-gray-400 uppercase mb-4 tracking-widest leading-none">Card Details</h3>
                                <p className="text-2xl font-black leading-tight mb-1">{data.metadata.name}</p>
                                <p className="text-lg font-bold text-gray-200">{data.metadata.set} ({data.metadata.year})</p>
                                {isCollectOnly ? (
                                    <p className="text-sm font-bold text-gray-300 mt-2 uppercase">Collect Only (no grade)</p>
                                ) : (
                                    <p className="text-sm font-bold text-gray-300 mt-2 uppercase">Estimated Grade: {finalGrade.overall}</p>
                                )}
                            </div>

                            <div className="border-t-2 border-[#D4AF37] pt-6">
                                <h3 className="text-xs font-black text-gray-400 uppercase mb-4 tracking-widest leading-none">Acquisition Summary</h3>
                                <table className="w-full text-sm">
                                    <tbody className="divide-y divide-white/10">
                                        <tr>
                                            <td className="py-2 text-gray-400 font-bold uppercase text-[10px]">Purchase Price</td>
                                            <td className="py-2 text-right font-black text-lg">${acqPrice || '0.00'}</td>
                                        </tr>
                                        <tr>
                                            <td className="py-2 text-gray-400 font-bold uppercase text-[10px]">Tax Paid</td>
                                            <td className="py-2 text-right font-black text-lg">${acqTax || '0.00'}</td>
                                        </tr>
                                        <tr>
                                            <td className="py-2 text-gray-400 font-bold uppercase text-[10px]">Shipping</td>
                                            <td className="py-2 text-right font-black text-lg">${acqShipping || '0.00'}</td>
                                        </tr>
                                        <tr className="border-t-2 border-[#D4AF37]">
                                            <td className="py-3 text-[#FBF9F6] font-black uppercase text-xs">Total Investment</td>
                                            <td className="py-3 text-right font-black text-2xl">
                                                ${(parseFloat(acqPrice || '0') + parseFloat(acqTax || '0') + parseFloat(acqShipping || '0')).toFixed(2)}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="space-y-6 border-l-2 border-dashed border-white/20 pl-12">
                            <div>
                                <h3 className="text-xs font-black text-gray-400 uppercase mb-4 tracking-widest leading-none">History & Provenance</h3>
                                <div className="space-y-4">
                                    <div>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase">Source / Platform</p>
                                        <p className="text-lg font-black">{acqSource || "Not Recorded"}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase">City</p>
                                            <p className="font-bold">{acqCity || "N/A"}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase">State</p>
                                            <p className="font-bold">{acqState || "N/A"}</p>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase">Acquired On</p>
                                        <p className="font-bold">{acqDate || "N/A"}</p>
                                    </div>

                                    {/* Forensic Evidence on Receipt */}
                                    {!isCollectOnly && finalGrade.defects && finalGrade.defects.length > 0 && (
                                        <div className="mt-8 pt-6 border-t border-white/10">
                                            <p className="text-[10px] text-gray-400 font-bold uppercase mb-4">Forensic Audit Proof</p>
                                            <div className="grid grid-cols-4 gap-3">
                                                {finalGrade.defects.slice(0, 4).map((defect, idx) => {
                                                    const sourceImg = getSourceImageByIndex(defect.imageIndex, defect);
                                                    return (
                                                        <div key={idx} className="flex flex-col items-center bg-[#0a0a0a] p-1.5 rounded border border-white/10">
                                                            <div className="scale-[0.85] origin-top">
                                                                {sourceImg && defect.box2d?.length === 4 ? (
                                                                    <EvidenceCrop imageSrc={sourceImg} box={defect.box2d} label={defect.category} />
                                                                ) : (
                                                                    <div className="w-32 h-32 rounded border-2 border-dashed border-white/20 flex items-center justify-center">
                                                                        <span className="text-[10px] text-gray-400">No image</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-8 flex flex-col items-center justify-center bg-[#111111] p-6 rounded-xl border border-white/10">
                                <div className="w-32 h-32 bg-[#0a0a0a] p-2 border border-white/10 shadow-sm">
                                    <img
                                        src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`${window.location.origin}/?cert=${data.id}`)}`}
                                        className="w-full h-full grayscale"
                                        alt="QR Code"
                                    />
                                </div>
                                <p className="text-[9px] text-gray-400 font-bold uppercase mt-4 text-center">Scan to Verify Digital Asset Certificate</p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-12 pt-8 border-t border-white/10 flex justify-between items-end">
                        <div className="opacity-30 flex gap-4 grayscale">
                            <img src="/assets/logo/RawGraded Rectangle.svg" className="h-6 w-auto object-contain" alt="" />
                        </div>
                        <p className="text-[9px] font-black text-gray-400 tracking-[0.4em] uppercase">Private Internal Asset Record - v1.0 Production</p>
                    </div>
                </div>
            </div>
            {ebayGraphicOpen && user && (
                <EbayGraphicPlugin
                    data={data}
                    finalGrade={finalGrade}
                    onClose={() => setEbayGraphicOpen(false)}
                    user={user}
                    displayFrontUrl={displayFrontUrl}
                    displayBackUrl={displayBackUrl}
                    onCreditsUpdated={onCreditsUpdated}
                />
            )}
        </>
    );
};

export default Certificate;
