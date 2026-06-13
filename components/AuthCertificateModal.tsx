import React, { useEffect, useState, useRef } from 'react';

declare const html2canvas: any;

interface AuthCheckResult {
    id: number;
    user_id: number;
    psa_slab_id: number;
    grading_house: string;
    authenticity_score: number;
    verdict: string;
    ai_reasoning: string;
    serial_detected: string;
    card_name_detected: string;
    psa_cert_mismatch: boolean | number;
    front_img: string;
    back_img: string;
    psa_front_img: string; // from vault
    psa_local_front: string; // from vault
    psa_local_back: string; // from vault
    created_at: string;
    checks_json: string; // raw string
    video_frames_json: string; // string array json
}

export interface SlabCheck {
    name: string;
    score: number;
    pass: boolean;
    detail: string;
    box2d?: number[];
    imageIndex?: number;
}

interface AuthCertificateModalProps {
    authCheckId: number | null;
    isOpen: boolean;
    onClose: () => void;
}

export const AuthCertificateModal: React.FC<AuthCertificateModalProps> = ({ authCheckId, isOpen, onClose }) => {
    const [certData, setCertData] = useState<AuthCheckResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const certRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen || !authCheckId) return;
        
        const fetchCert = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`api/plugin_slab_checker.php?action=get_auth_cert&check_id=${authCheckId}`, {
                    credentials: 'include'
                });
                const data = await res.json();
                if (data.success && data.cert) {
                    setCertData(data.cert);
                } else {
                    setError(data.error || 'Failed to load certificate');
                }
            } catch (err) {
                setError('Network error loading certificate');
            } finally {
                setLoading(false);
            }
        };

        fetchCert();
    }, [isOpen, authCheckId]);

    if (!isOpen) return null;

    const SlabEvidenceCrop = ({ box2d, imageUrl, title }: { box2d: number[]; imageUrl: string; title: string }) => {
        const [ymin, xmin, ymax, xmax] = box2d;
        const w = xmax - xmin;
        const h = ymax - ymin;
        if (w <= 0 || h <= 0) return null;
        
        // Use relative clip positioning to perfectly zoom the bounding box
        return (
            <div className="relative w-full aspect-square overflow-hidden rounded-md bg-[#050505] border border-white/10 group">
                <div className="absolute top-1 left-1 bg-black/80 px-1.5 py-0.5 rounded text-[8px] font-bold text-gray-400 uppercase tracking-widest z-10 shadow-sm">
                    {title}
                </div>
                <img 
                    src={imageUrl} 
                    crossOrigin="anonymous"
                    alt="Evidence"
                    className="absolute transition-transform duration-500 group-hover:scale-110"
                    style={{
                        width: `${(1000 / w) * 100}%`,
                        height: `${(1000 / h) * 100}%`,
                        left: `${(-xmin / w) * 100}%`,
                        top: `${(-ymin / h) * 100}%`,
                        objectFit: 'fill' // Force distort if it's not square, but bounds are normalized!
                    }}
                />
            </div>
        );
    };

    const handleDownload = async () => {
        if (!certRef.current || typeof html2canvas === 'undefined') {
            alert("Html2canvas is not loaded or ready.");
            return;
        }
        try {
            const canvas = await html2canvas(certRef.current, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#111111',
                logging: false
            });
            const link = document.createElement('a');
            link.download = `RawGraded-AuthCert-${certData?.grading_house}-${certData?.serial_detected}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (e) {
            console.error(e);
            alert("Failed to export certificate.");
        }
    };

    let checks: SlabCheck[] = [];
    if (certData?.checks_json) {
        try {
            const parsed = JSON.parse(certData.checks_json);
            if (Array.isArray(parsed)) {
                checks = parsed;
            } else if (typeof parsed === 'object' && parsed !== null) {
                // Backward compatibility for old format: {"Label Quality": true}
                checks = Object.entries(parsed).map(([key, val]) => ({
                    name: key,
                    score: val ? 90 : 40,
                    pass: !!val,
                    detail: val ? 'Passed basic verification' : 'Failed basic verification'
                }));
            }
        } catch (e) {}
    }

    let videoFrames: string[] = [];
    if (certData?.video_frames_json) {
        try {
            videoFrames = JSON.parse(certData.video_frames_json);
        } catch (e) {}
    }

    const getImageForIndex = (idx?: number) => {
        if (idx === 0) return certData?.front_img || certData?.psa_local_front;
        if (idx === 1) return certData?.back_img || certData?.psa_local_back;
        if (idx !== undefined && idx >= 2) return videoFrames[idx - 2];
        return null;
    };

    // Determine Gold/Silver/Bronze metallic gradient based on the score
    let scoreColor = '#A0A0A0'; // Silver fallback
    if (certData) {
        if (certData.authenticity_score >= 90) scoreColor = '#D4AF37'; // Gold
        else if (certData.authenticity_score <= 50) scoreColor = '#CD7F32'; // Bronze/Red
    }

    const verdictLabel = certData?.verdict?.toUpperCase() || 'UNKNOWN';
    const isPass = verdictLabel === 'PASS' || certData?.authenticity_score! >= 80;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md overflow-y-auto w-full h-full">
            <div className="bg-[#111111] rounded-2xl w-full max-w-4xl relative shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-[#333] my-8 flex flex-col items-center">
                
                {/* Header Controls */}
                <div className="w-full flex justify-between items-center p-4 border-b border-[#222]">
                    <h3 className="text-[#D4AF37] font-black uppercase tracking-widest text-sm flex items-center gap-2">
                        <i className="fas fa-shield-alt"></i> Authentication Analysis
                    </h3>
                    <div className="flex gap-4">
                        <button 
                            onClick={handleDownload}
                            className="text-xs bg-[#222] hover:bg-[#D4AF37] text-gray-300 hover:text-black px-4 py-2 rounded font-bold transition-colors flex items-center gap-2"
                        >
                            <i className="fas fa-download"></i> EXPORT
                        </button>
                        <button 
                            onClick={onClose}
                            className="w-8 h-8 rounded-full bg-red-900/30 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="p-20 flex flex-col items-center gap-4 text-[#D4AF37]">
                        <i className="fas fa-circle-notch fa-spin text-4xl"></i>
                        <p className="font-bold tracking-widest text-sm animate-pulse">Retrieving Vault Certificate...</p>
                    </div>
                ) : error ? (
                    <div className="p-20 text-center text-red-500 font-bold">{error}</div>
                ) : certData ? (
                    <div className="p-4 md:p-8 w-full">
                        
                        {/* THE CERTIFICATE EXPORT WRAPPER */}
                        <div ref={certRef} className="bg-[#0a0a0a] border border-[#222] rounded-xl overflow-hidden relative shadow-2xl p-6 md:p-10 text-white w-full mx-auto" style={{
                            backgroundImage: 'radial-gradient(circle at 50% 0%, #1a1a1a 0%, #0a0a0a 100%)'
                        }}>
                            
                            {/* Watermark */}
                            <div className="absolute inset-0 flex items-center justify-center opacity-[0.02] pointer-events-none overflow-hidden">
                                <i className="fas fa-check-double text-[400px]"></i>
                            </div>

                            {/* Cert Header */}
                            <div className="flex justify-between items-start border-b border-white/10 pb-6 mb-8 relative z-10">
                                <div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-[#D4AF37] text-black flex items-center justify-center text-xl font-black">R</div>
                                        <h1 className="text-3xl font-black italic tracking-tighter">RAWGRADED</h1>
                                    </div>
                                    <p className="text-sm font-bold text-gray-400 tracking-widest mt-1 uppercase">Slab Authentication Analysis Certificate</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Audit ID</p>
                                    <p className="font-mono text-xl text-[#D4AF37] font-bold tracking-widest">{certData.id.toString().padStart(8, '0')}</p>
                                    <p className="text-[10px] text-gray-500 mt-2">{new Date(certData.created_at).toLocaleDateString()}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10 w-full">
                                
                                {/* Info Column */}
                                <div className="md:col-span-2 space-y-6">
                                    <div className="bg-[#111] border border-[#222] p-5 rounded-lg shadow-inner">
                                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#D4AF37] mb-2 border-b border-[#333] pb-2">Identified Asset</h2>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase">Grader</p>
                                                <p className="font-black text-xl text-white">{certData.grading_house}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase">Serial Number</p>
                                                <p className="font-black text-xl font-mono text-white">{certData.serial_detected || 'N/A'}</p>
                                            </div>
                                            <div className="col-span-2">
                                                <p className="text-[10px] text-gray-500 uppercase">Matched Subject</p>
                                                <p className="font-bold text-md text-gray-300">{certData.card_name_detected || 'Unknown Card'}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-[#111] border border-[#222] p-5 rounded-lg shadow-inner">
                                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#D4AF37] mb-4 border-b border-[#333] pb-2">AI Verification Checklist & Visual Evidence</h2>
                                        <div className="flex flex-col gap-4">
                                            {checks.map((check, i) => {
                                                const label = check.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                                                const evImg = check.box2d ? getImageForIndex(check.imageIndex) : null;
                                                return (
                                                    <div key={i} className={`flex flex-col p-3 rounded-lg border bg-gradient-to-r ${check.pass ? 'from-green-900/10 to-transparent border-green-900/30' : 'from-red-900/10 to-transparent border-red-900/30'}`}>
                                                        <div className="flex items-start gap-3">
                                                            <i className={`fas ${check.pass ? 'fa-check-circle text-green-400' : 'fa-times-circle text-red-500'} mt-0.5 text-lg drop-shadow`}></i>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className={`text-xs font-bold font-mono tracking-tight ${check.pass ? 'text-green-400' : 'text-red-400'}`}>{label}</span>
                                                                    <span className="text-[9px] text-gray-500 uppercase tracking-widest font-bold bg-black/40 px-1 rounded">Score: {check.score}</span>
                                                                </div>
                                                                <p className="text-[10px] text-gray-400 leading-relaxed italic">{check.detail}</p>
                                                            </div>
                                                        </div>
                                                        {evImg && check.box2d && (
                                                            <div className="mt-3 ml-8 max-w-[12rem] border border-white/5 rounded overflow-hidden">
                                                                <SlabEvidenceCrop box2d={check.box2d} imageUrl={evImg} title={check.imageIndex === 0 ? 'Front' : check.imageIndex === 1 ? 'Back' : 'Video Sync'} />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="bg-[#111] border border-[#222] p-5 rounded-lg shadow-inner">
                                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#D4AF37] mb-2 border-b border-[#333] pb-2">Machine Diagnostics</h2>
                                        <p className="text-sm text-gray-400 leading-relaxed italic border-l-2 border-[#333] pl-4 py-1">"{certData.ai_reasoning || 'No additional reasoning provided.'}"</p>
                                    </div>
                                </div>

                                {/* Score & Images Column */}
                                <div className="space-y-6 flex flex-col">
                                    
                                    {/* The Score Badge */}
                                    <div className="bg-[#111] border border-[#222] p-6 rounded-lg shadow-inner text-center flex-grow flex flex-col justify-center items-center">
                                        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-4">Authenticity Score</h2>
                                        
                                        <div className="w-32 h-32 rounded-full flex items-center justify-center mb-4 relative shadow-[0_0_30px_rgba(0,0,0,0.5)]" style={{
                                            background: `linear-gradient(135deg, #111 0%, #000 100%)`,
                                            border: `2px solid ${scoreColor}`
                                        }}>
                                            <div className="absolute inset-1 rounded-full border border-white/5"></div>
                                            <span className="text-5xl font-black" style={{ color: scoreColor }}>{certData.authenticity_score}</span>
                                        </div>

                                        <div className={`text-xl font-black uppercase tracking-widest px-4 py-1 rounded-sm border ${isPass ? 'bg-green-900/20 text-green-400 border-green-500/50' : 'bg-red-900/20 text-red-500 border-red-500/50'}`}>
                                            {verdictLabel}
                                        </div>
                                    </div>

                                    {/* Images */}
                                    <div className="grid grid-cols-2 gap-2 h-40">
                                        <div className="bg-black border border-[#333] rounded overflow-hidden flex items-center justify-center p-1 relative group">
                                            <span className="absolute top-1 left-1 bg-black/80 px-1 py-0.5 text-[8px] font-bold text-gray-500 uppercase z-10">Scan</span>
                                            {certData.front_img || certData.psa_local_front ? (
                                                <img src={certData.front_img || certData.psa_local_front} className="w-full h-full object-contain" alt="Front" crossOrigin="anonymous" />
                                            ) : (
                                                <i className="fas fa-image text-[#333] text-2xl"></i>
                                            )}
                                        </div>
                                        <div className="bg-black border border-[#333] rounded overflow-hidden flex items-center justify-center p-1 relative group">
                                            <span className="absolute top-1 left-1 bg-black/80 px-1 py-0.5 text-[8px] font-bold text-gray-500 uppercase z-10">Ref</span>
                                            {certData.psa_front_img ? (
                                                <img src={certData.psa_front_img} className="w-full h-full object-contain" alt="Ref" crossOrigin="anonymous" />
                                            ) : (
                                                <i className="fas fa-database text-[#333] text-2xl"></i>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-gray-600 text-center uppercase tracking-widest">Captured vs Reference</p>
                                </div>
                            </div>
                        </div>

                    </div>
                ) : null}
            </div>
        </div>
    );
};
