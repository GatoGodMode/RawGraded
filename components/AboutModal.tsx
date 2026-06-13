import React, { useState } from 'react';

const AboutModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    const [step, setStep] = useState(0);

    if (!isOpen) return null;

    const steps = [
        {
            title: "The Ultimate AI Grading Experience",
            icon: "fas fa-rocket",
            content: (
                <div className="space-y-4 text-center">
                    <p className="text-gray-300 leading-relaxed">
                        Welcome to <strong className="text-poke-accent">RawGraded</strong>, the world's most advanced AI-powered card grading system.
                    </p>
                    <p className="text-gray-400 text-sm">
                        While other apps use basic image recognition, we leverage <strong className="text-poke-accent">RawGraded Forensic AI</strong> to analyze your cards with sub-millimeter precision.
                    </p>
                    <div className="py-4">
                        <span className="bg-poke-accent/20 text-poke-accent px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest border border-poke-accent/50">
                            Currently in Free Beta
                        </span>
                    </div>
                </div>
            )
        },
        {
            title: "How It Works: 3 Simple Steps",
            icon: "fas fa-list-ol",
            content: (
                <div className="space-y-6 text-left">
                    <div className="flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full bg-poke-accent text-black flex items-center justify-center font-black shrink-0">1</div>
                        <div>
                            <h4 className="font-bold text-white">Scan & Upload</h4>
                            <p className="text-xs text-gray-400">Take a photo of the front and back of your card. Our AI instantly identifies the card set, year, and edition.</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full bg-poke-accent text-black flex items-center justify-center font-black shrink-0">2</div>
                        <div>
                            <h4 className="font-bold text-white">Forensic Video Scan</h4>
                            <p className="text-xs text-gray-400">Record a short video of the card. We analyze light reflections to detect micro-scratches and surface imperfections invisible to the naked eye.</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full bg-poke-accent text-black flex items-center justify-center font-black shrink-0">3</div>
                        <div>
                            <h4 className="font-bold text-white">Instant Grade & Value</h4>
                            <p className="text-xs text-gray-400">Receive a comprehensive report with sub-grades for Centering, Corners, Edges, and Surface, plus an estimated market value. Forensic analysis takes about <strong className="text-poke-accent">~2 - 3 minutes</strong> after which you can save your scan.</p>
                        </div>
                    </div>
                </div>
            )
        },
        {
            title: "Why We Are Better",
            icon: "fas fa-crown",
            content: (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-center mt-2">
                        {[
                            { icon: "fas fa-search-plus", title: "Forensic Scan", color: "text-poke-accent", desc: "Video-level analysis" },
                            { icon: "fas fa-brain", title: "Pro AI", color: "text-poke-accent", desc: "Neural networks" },
                            { icon: "fas fa-file-invoice-dollar", title: "Expenses", color: "text-blue-400", desc: "Track every dollar" },
                            { icon: "fas fa-map-marker-alt", title: "Origin", color: "text-green-400", desc: "Card history" },
                            { icon: "fas fa-barcode", title: "Serial IDs", color: "text-purple-400", desc: "Unique collection" },
                            { icon: "fas fa-chart-line", title: "AI Appraisal", color: "text-yellow-400", desc: "Instant estimates" },
                            { icon: "fas fa-link", title: "Chaining", color: "text-pink-400", desc: "Scan history" },
                            { icon: "fas fa-microscope", title: "HI-FI Evidence", color: "text-cyan-400", desc: "Accurate scores" },
                            { icon: "fas fa-calculator", title: "Cost Calc", color: "text-orange-400", desc: "Profit margins" },
                        ].map((item, idx) => (
                            <div key={idx} className="bg-black/30 p-2 rounded-xl border border-gray-800/50 hover:border-poke-accent/30 transition-all flex flex-col items-center justify-center gap-1 group">
                                <i className={`${item.icon} ${item.color} text-xl group-hover:scale-110 transition-transform`}></i>
                                <div className="font-bold text-white text-[10px] uppercase tracking-tight">{item.title}</div>
                                <div className="text-[8px] text-gray-500 leading-tight">{item.desc}</div>
                            </div>
                        ))}
                    </div>
                    <p className="text-gray-400 text-[10px] italic text-center mt-2 opacity-60">
                        "The precision of a professional grader, in your pocket."
                    </p>
                </div>
            )
        }
    ];

    const handleNext = () => {
        if (step < steps.length - 1) {
            setStep(step + 1);
        } else {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-fade-in" onClick={onClose}>
            <div className="bg-poke-dark border border-poke-accent/30 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-gradient-to-r from-poke-dark to-gray-900 p-6 border-b border-gray-800 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-black text-white italic tracking-wider">ABOUT RAWGRADED</h2>
                        <p className="text-sm text-gray-400 font-bold uppercase tracking-widest">The Future of Card Grading</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="p-8 flex-1 overflow-y-auto">
                    <div className="flex flex-col items-center space-y-6 animate-fade-in" key={step}>
                        <div className="w-16 h-16 bg-gradient-to-br from-poke-accent to-yellow-600 rounded-full flex items-center justify-center shadow-lg shadow-poke-accent/20 mb-2 shrink-0">
                            <i className={`${steps[step].icon} text-3xl text-black`}></i>
                        </div>
                        <h3 className="text-2xl font-bold text-poke-accent text-center leading-tight">{steps[step].title}</h3>
                        {steps[step].content}
                    </div>
                </div>

                {/* Footer / Navigation */}
                <div className="p-6 border-t border-gray-800 bg-black/20 flex justify-between items-center">
                    <div className="flex gap-2">
                        {steps.map((_, i) => (
                            <div
                                key={i}
                                className={`h-2 rounded-full transition-all duration-300 ${i === step ? 'bg-poke-accent w-8' : 'bg-gray-700 w-2'}`}
                            ></div>
                        ))}
                    </div>

                    <button
                        onClick={handleNext}
                        className="bg-poke-accent hover:bg-red-600 text-white px-6 py-2 rounded-lg font-bold text-sm transition-all shadow-lg flex items-center gap-2 transform active:scale-95"
                    >
                        {step < steps.length - 1 ? (
                            <>Next <i className="fas fa-chevron-right"></i></>
                        ) : (
                            <>Get Started <i className="fas fa-check"></i></>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AboutModal;
