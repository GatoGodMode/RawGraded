import React from 'react';
import { CardData, GradingResult } from '../types';
import LogoR from './LogoR';

interface SlabSlipProps {
    data: CardData;
    finalGrade: GradingResult;
}

const SlabSlip: React.FC<SlabSlipProps> = ({ data, finalGrade }) => {
    const certId = data.id?.substring(0, 8).toUpperCase() || 'UNKNOWN';
    const isCollectOnly = data.assessmentMode === 'collect_only';

    const formatSubgrade = (grade: number | string) => {
        if (grade === 10) return '10+';
        return String(grade);
    };

    const getGradeGradient = (grade: number | string | undefined) => {
        const numGrade = Number(grade);
        if (isNaN(numGrade)) return 'linear-gradient(135deg, #1f2937 0%, #000000 100%)'; 
        if (numGrade === 10) return 'linear-gradient(135deg, #F3E5AB 0%, #D4AF37 50%, #8A6F1C 100%)';
        if (numGrade >= 9) return 'linear-gradient(135deg, #E8E8E8 0%, #B0B0B0 50%, #686868 100%)';
        // Low-grade: bronze luxe (avoid casino-red)
        return 'linear-gradient(135deg, #8A6F1C 0%, #4A3A12 100%)';
    };

    return (
        <div
            className="w-[750px] bg-[#FBF9F6] text-black border-[6px] border-black flex flex-col font-sans uppercase"
            style={{ height: '1050px', paddingTop: 18, paddingBottom: 18, paddingLeft: 40, paddingRight: 40 }}
        >
            {/* Header - LogoR is inline SVG so it never clips */}
            <div
                className="bg-[#FBF9F6] text-black flex flex-col items-center justify-center border-b-[3px] border-black shrink-0"
                style={{ minHeight: '80px', paddingTop: 16, paddingBottom: 10, marginBottom: 10 }}
            >
                <div className="flex items-center shrink-0" style={{ lineHeight: '1' }}>
                    <LogoR size={40} style={{ marginRight: 12 }} />
                    <span style={{ fontSize: '36px', fontWeight: '900', fontStyle: 'italic', letterSpacing: '-0.05em', color: '#D4AF37' }}>
                        RAWGRADED
                    </span>
                </div>
            </div>

            {/* Main 3-Column Layout - overflow-visible so text never clips */}
            <div className="flex gap-4 flex-1 overflow-visible">
                {/* LEFT COLUMN: Grade Badge - narrower to give middle more room */}
                <div className="flex flex-col items-center shrink-0 w-[152px]">
                    <div 
                        className="rounded-2xl w-[140px] h-[140px] border-[3px] border-black relative shadow-lg overflow-visible"
                        style={{ background: isCollectOnly ? '#0f172a' : getGradeGradient(finalGrade.overall) }}
                    >
                        {!isCollectOnly ? (
                            <>
                                <div className="absolute top-3 left-0 right-0 flex justify-center z-10">
                                    <span className="text-white/80 text-[13px] font-bold tracking-[0.3em]" style={{ textShadow: '0px 1px 2px rgba(0,0,0,0.5)' }}>GRADE</span>
                                </div>
                                {/* Grade number: mathematically centered with transform */}
                                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ margin: 0, padding: 0 }}>
                                    <span className="text-white text-[88px] font-black leading-none block text-center" style={{ lineHeight: 1 }}>{finalGrade.overall}</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="absolute top-4 left-0 right-0 flex justify-center z-10">
                                    <span className="text-white/80 text-[14px] font-bold tracking-[0.25em]" style={{ textShadow: '0px 1px 2px rgba(0,0,0,0.5)' }}>
                                        COLLECT
                                    </span>
                                </div>
                                <div className="absolute left-1/2 top-[62px] -translate-x-1/2 -translate-y-1/2" style={{ margin: 0, padding: 0 }}>
                                    <span className="text-white text-[52px] font-black leading-none block text-center" style={{ lineHeight: 1 }}>
                                        ONLY
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                    <span className="text-[14px] font-bold text-gray-600 mt-5 tracking-[0.2em]">ID: {certId}</span>
                </div>

                {/* MIDDLE COLUMN: Card Info & Subgrades - min width so text never clips; padding-right keeps clear of QR */}
                <div className="flex-1 flex flex-col min-w-[320px] overflow-visible" style={{ paddingRight: 40 }}>
                    {/* Card Name - centered, generous padding so no clipping */}
                    <div className="text-center border-b-[4px] border-black pb-4 mb-4 pt-5 min-h-[100px] flex items-center justify-center w-full min-w-0">
                        <h2 className="text-[28px] font-black leading-tight tracking-tight line-clamp-2 uppercase text-black w-full max-w-full box-border" style={{ paddingLeft: 20, paddingRight: 20 }}>
                            {data.metadata.name}
                        </h2>
                    </div>

                    {!isCollectOnly ? (
                        <div className="grid grid-cols-2 gap-x-6 gap-y-5 mb-6">
                            <div className="flex flex-col items-center justify-center min-h-[3rem] text-center">
                                <span className="block text-[13px] font-bold text-gray-400 uppercase tracking-widest mb-1">Center</span>
                                <span className="block text-[32px] font-black text-black leading-none border-t-[2px] border-black/5 pt-2 w-full text-center">{formatSubgrade(finalGrade.centering)}</span>
                            </div>
                            <div className="flex flex-col items-center justify-center min-h-[3rem] text-center">
                                <span className="block text-[13px] font-bold text-gray-400 uppercase tracking-widest mb-1">Corners</span>
                                <span className="block text-[32px] font-black text-black leading-none border-t-[2px] border-black/5 pt-2 w-full text-center">{formatSubgrade(finalGrade.corners)}</span>
                            </div>
                            <div className="flex flex-col items-center justify-center min-h-[3rem] text-center">
                                <span className="block text-[13px] font-bold text-gray-400 uppercase tracking-widest mb-1">Edges</span>
                                <span className="block text-[32px] font-black text-black leading-none border-t-[2px] border-black/5 pt-2 w-full text-center">{formatSubgrade(finalGrade.edges)}</span>
                            </div>
                            <div className="flex flex-col items-center justify-center min-h-[3rem] text-center">
                                <span className="block text-[13px] font-bold text-gray-400 uppercase tracking-widest mb-1">Surface</span>
                                <span className="block text-[32px] font-black text-black leading-none border-t-[2px] border-black/10 pt-2 w-full text-center">{formatSubgrade(finalGrade.surface)}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-2 mb-6 w-full">
                            <div className="border-t-[3px] border-black pt-4 mb-3">
                                <h3 className="text-[14px] font-black text-black uppercase tracking-widest">AI Identification</h3>
                            </div>
                            <p className="text-[16px] text-black leading-snug whitespace-pre-wrap">{finalGrade.reasoning}</p>
                        </div>
                    )}

                    {/* Card Metadata - labels and values lined up; values left-aligned after label for consistent alignment */}
                    <div className="mt-3 w-full overflow-visible">
                        <div className="grid border-b-[2px] border-gray-100 py-2.5 gap-x-4" style={{ gridTemplateColumns: '90px 1fr' }}>
                            <span className="text-[14px] font-bold text-gray-500 tracking-widest uppercase">SET</span>
                            <span className="text-[18px] font-black text-black break-words leading-tight text-left">{data.metadata.set}</span>
                        </div>
                        <div className="grid border-b-[2px] border-gray-100 py-2.5 gap-x-4" style={{ gridTemplateColumns: '90px 1fr' }}>
                            <span className="text-[14px] font-bold text-gray-500 tracking-widest uppercase">YEAR</span>
                            <span className="text-[18px] font-black text-black text-left">{data.metadata.year}</span>
                        </div>
                        <div className="grid border-b-[2px] border-gray-100 py-2.5 gap-x-4" style={{ gridTemplateColumns: '90px 1fr' }}>
                            <span className="text-[14px] font-bold text-gray-500 tracking-widest uppercase">ARTIST</span>
                            <span className="text-[18px] font-black text-black break-words leading-tight text-left">{data.metadata.artist || 'Unknown'}</span>
                        </div>
                        <div className="grid border-b-[2px] border-gray-100 py-2.5 gap-x-4" style={{ gridTemplateColumns: '90px 1fr' }}>
                            <span className="text-[14px] font-bold text-gray-500 tracking-widest uppercase">SCAN DATE</span>
                            <span className="text-[18px] font-black text-black text-left">{new Date(data.dateScanned).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: QR - compact so middle has room */}
                <div className="flex flex-col items-center justify-start shrink-0 pt-2 w-[116px]">
                    <div className="border-[4px] border-black p-1.5 bg-[#FBF9F6] shadow-sm">
                        <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(`https://rawgraded.com/cert/${data.id}`)}`}
                            className="w-[92px] h-[92px] object-contain"
                            alt="QR Code"
                        />
                    </div>
                    <span className="text-[16px] font-black text-gray-600 mt-3 tracking-[0.2em]">VERIFY</span>
                </div>
            </div>

            {/* Bottom Section: Barcode & User - generous padding so barcode and footer never clip */}
            <div className="border-t-[3px] border-black mt-5 pt-5 pb-6">
                {/* Barcode */}
                <div className="flex flex-col items-center mb-4 pt-4">
                    <div className="flex items-center gap-0.5 h-[50px] overflow-hidden">
                        {Array.from({ length: 60 }).map((_, i) => {
                            const charCode = certId.charCodeAt(i % certId.length);
                            const width = (charCode + i) % 2 === 0 ? 2 : 4;
                            const isGap = (charCode * (i + 1)) % 7 === 0;
                            if (isGap && i % 5 === 0) return <div key={i} className="w-1.5" />;
                            return (
                                <div
                                    key={i}
                                    className="bg-black h-full shrink-0"
                                    style={{ width: `${width}px` }}
                                />
                            );
                        })}
                    </div>
                    <span className="text-[18px] font-black text-black tracking-[0.5em] mt-1">{certId}</span>
                </div>

                {/* User Info - pb so @handle and card name never clip */}
                <div className="flex items-center justify-center gap-3 pb-3 flex-wrap">
                    <span className="text-[22px] font-black text-black">@{data.userTwitter || data.ownerUsername || 'Anonymous'}</span>
                    <span className="text-[22px] font-black text-gray-400 truncate max-w-[250px]">{data.metadata.name}</span>
                    {/* Alliance/PCK Badges */}
                    {data.isAlliance && (
                        <span className="bg-black text-white text-[11px] font-black px-2.5 py-1 rounded flex items-center gap-1.5">
                            <i className="fas fa-crown text-[9px]"></i> ALLIANCE
                        </span>
                    )}
                    {data.isPck && (
                        <span className="bg-black text-white text-[11px] font-black px-2.5 py-1 rounded flex items-center gap-1.5">
                            <i className="fas fa-crown text-[9px]"></i> PCK
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SlabSlip;
