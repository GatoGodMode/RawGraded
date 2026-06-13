import React, { useState, useEffect, useRef } from 'react';
import { UserProfile } from '../types';

/** Lazy-loads front thumb for a card when stream response has has_front_img but no blob. */
function ArchiveCardThumb({ certId, hasImage, name }: { certId: string; hasImage: boolean; name: string }) {
    const [thumbSrc, setThumbSrc] = useState<string | null>(null);
    const fetched = useRef(false);

    useEffect(() => {
        if (!hasImage || !certId || fetched.current) return;
        fetched.current = true;
        fetch(`api/verify.php?id=${encodeURIComponent(certId)}&image=front`, { credentials: 'include' })
            .then((r) => r.json())
            .then((data: { data?: string }) => {
                const url = data?.data;
                if (url && typeof url === 'string') {
                    setThumbSrc(url.startsWith('data:') ? url : `data:image/jpeg;base64,${url}`);
                }
            })
            .catch(() => {});
    }, [certId, hasImage]);

    if (thumbSrc) {
        return (
            <img
                src={thumbSrc}
                className="h-full w-full object-contain transform group-hover:scale-105 transition-transform duration-500"
                alt={name}
            />
        );
    }
    return (
        <div className="text-white/20 flex flex-col items-center gap-2">
            <i className="fas fa-image text-5xl"></i>
            <span className="text-[10px] font-bold uppercase tracking-widest">No Preview</span>
        </div>
    );
}

interface PublicArchiveProps {
    user?: UserProfile | null;
    onSelect: (id: string) => void;
    onViewAuthCert: (authCheckId: number) => void;
}

const PublicArchive: React.FC<PublicArchiveProps> = ({ user, onSelect, onViewAuthCert }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [xUsername, setXUsername] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState<any[]>([]);
    const [selectedPopCard, setSelectedPopCard] = useState<{ name: string, set: string } | null>(null);

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setLoading(true);
        setResults([]);
        try {
            const url = `api/stats.php?q=${encodeURIComponent(searchQuery)}&x_username=${encodeURIComponent(xUsername)}&stream=1`;
            const response = await fetch(url);

            if (!response.body) throw new Error("ReadableStream not supported");

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                if (lines.length > 0) {
                    const newCards = lines
                        .filter(line => line.trim() !== "")
                        .map(line => {
                            try { return JSON.parse(line); } catch (e) { return null; }
                        })
                        .filter(Boolean);

                    setResults(prev => {
                        if (prev.length === 0 && newCards.length > 0) setLoading(false);
                        return [...prev, ...newCards];
                    });
                }
            }

            // Process remaining buffer
            if (buffer.trim() !== "") {
                try {
                    const lastCard = JSON.parse(buffer);
                    setResults(prev => [...prev, lastCard]);
                } catch (e) { /* ignore */ }
            }

            // If we have a specific search term, try to get population for it
            if (searchQuery.length > 2) {
                fetchPopStats(searchQuery);
            } else {
                setStats([]);
            }
        } catch (error) {
            console.error("Search failed", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        handleSearch();
    }, []);

    const fetchPopStats = async (name: string, set: string = '') => {
        try {
            const url = `api/stats.php?action=population&name=${encodeURIComponent(name)}&set=${encodeURIComponent(set)}`;
            const response = await fetch(url);
            const data = await response.json();
            setStats(Array.isArray(data) ? data : []);
            setSelectedPopCard({ name, set });
        } catch (e) {
            console.error("Stats fetch failed", e);
        }
    };

    const handleAdminReset = async (certId: string, mode: 'selective' | 'complete') => {
        if (!confirm(`ADMIN: Are you sure you want to ${mode === 'complete' ? 'COMPLETELY DISSOLVE' : 'BREAK'} this chain?`)) return;
        try {
            const resp = await fetch('api/collection.php?action=admin_reset_links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: certId, mode })
            });
            const result = await resp.json();
            if (result.success) {
                alert("Chain broken successfully.");
                handleSearch(); // Refresh results
            } else {
                alert("Admin reset failed: " + result.error);
            }
        } catch (e) {
            console.error("Admin reset error", e);
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto p-6 animate-fade-in space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-6">
                <div className="flex-1 w-full space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">Intelligence Registry</p>
                    <h2 className="text-4xl font-serif font-medium text-white">Public Archive</h2>
                    <p className="text-white/50 text-sm font-light">Search verified certificates and confirm their authenticity.</p>
                </div>
                <form onSubmit={(e) => handleSearch(e)} className="flex flex-wrap gap-2 w-full md:w-auto">
                    <div className="relative flex-1 min-w-[200px]">
                        <i className="fas fa-search absolute left-3 top-3 text-white/30"></i>
                        <input
                            type="text"
                            placeholder="Search Card, Character, Set..."
                            className="w-full bg-[#050505] border border-white/10 p-2 pl-10 text-white placeholder-white/20 focus:border-[#D4AF37] focus:bg-white/5 focus:outline-none transition-colors"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="relative w-full md:w-48">
                        <span className="absolute left-3 top-2 text-white/30 text-sm">@</span>
                        <input
                            type="text"
                            placeholder="X Username"
                            className="w-full bg-[#050505] border border-white/10 p-2 pl-8 text-white placeholder-white/20 focus:border-[#D4AF37] focus:bg-white/5 focus:outline-none transition-colors"
                            value={xUsername}
                            onChange={(e) => setXUsername(e.target.value)}
                        />
                    </div>
                    <button type="submit" className="px-6 py-2 font-black uppercase tracking-widest text-[11px] text-black transition-all bg-gradient-to-r from-[#BF953F] via-[#E8C881] to-[#B38728] hover:from-[#D4AF37] hover:via-[#FCF6BA] hover:to-[#B38728]">
                        SEARCH
                    </button>
                </form>
            </div>

            {/* Population Report */}
            {selectedPopCard && stats.length > 0 && (
                <div className="bg-[#050505] border border-white/10 p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <i className="fas fa-chart-pie text-[#D4AF37] text-xl drop-shadow-[0_0_10px_rgba(212,175,55,0.3)]"></i>
                        <div>
                            <h3 className="text-lg font-bold text-white">Population Report: {selectedPopCard.name}</h3>
                            <p className="text-[10px] text-white/40 font-mono uppercase tracking-widest">{selectedPopCard.set || 'Global Records'}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {stats.map((stat, idx) => (
                            <div key={idx} className="bg-black border border-white/10 p-4 text-center" style={{borderColor:'rgba(191,149,63,0.12)'}}>
                                <div className="text-[10px] text-white/40 font-bold mb-1 uppercase tracking-widest">Est. Grade {stat.overall_grade}</div>
                                <div className="text-2xl font-black bg-gradient-to-b from-[#FCF6BA] via-[#C5A059] to-[#886b2b] text-transparent bg-clip-text">{stat.count}</div>
                                <div className="text-[10px] text-white/30 uppercase tracking-widest">Certified</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* CTA blurb */}
            <p className="text-sm text-white/40 text-center max-w-2xl mx-auto">
                Got one like this? Get it RawGraded to get the best estimated grade before submitting to{' '}
                <a href="https://www.psacard.com" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white border-b border-white/20 hover:border-white transition-colors font-semibold">PSA</a>,{' '}
                <a href="https://www.beckett.com" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white border-b border-white/20 hover:border-white transition-colors font-semibold">BGS</a>,{' '}
                <a href="https://www.cgccards.com" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white border-b border-white/20 hover:border-white transition-colors font-semibold">CGC</a>, or{' '}
                <a href="https://www.taggrading.com" target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white border-b border-white/20 hover:border-white transition-colors font-semibold">TAG</a>.
            </p>

            {/* Results Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    Array(6).fill(0).map((_, i) => (
                        <div key={i} className="bg-[#050505] h-48 animate-pulse border border-white/5"></div>
                    ))
                ) : results.length > 0 ? (
                    results.map(card => (
                        <div
                            key={card.id}
                        className="bg-[#080808] border border-white/10 hover:border-[rgba(191,149,63,0.3)] transition-all duration-300 group cursor-pointer flex flex-col"
                            style={{boxShadow:'none'}}
                            onMouseEnter={e => (e.currentTarget.style.boxShadow='0 8px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(191,149,63,0.15)')}
                            onMouseLeave={e => (e.currentTarget.style.boxShadow='none')}
                            onClick={() => {
                                if (card.is_slab && card.auth_check_id) {
                                    onViewAuthCert(card.auth_check_id);
                                } else {
                                    onSelect(card.id);
                                }
                            }}
                        >
                            {/* Card Image */}
                            <div className="relative h-64 bg-black flex items-center justify-center overflow-hidden border-b border-white/5">
                                {card.is_slab && card.auth_check_id && (
                                    <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-md border border-[#D4AF37]/50 rounded-lg px-2 py-1 flex items-center gap-1.5 z-10 shadow-[0_0_10px_rgba(212,175,55,0.15)]">
                                        <i className="fas fa-shield-check text-[#D4AF37] text-xs"></i>
                                        <span className="text-[#D4AF37] text-[9px] font-black uppercase tracking-widest">AI Verified</span>
                                    </div>
                                )}
                                {card.front_thumb || card.front_img ? (
                                    <img
                                        src={card.front_thumb || card.front_img}
                                        className="h-full w-full object-contain transform group-hover:scale-105 transition-transform duration-500"
                                        alt={card.name}
                                    />
                                ) : card.has_front_img ? (
                                    <ArchiveCardThumb certId={card.id} hasImage name={card.name || ''} />
                                ) : (
                                    <div className="text-white/20 flex flex-col items-center gap-2">
                                        <i className="fas fa-image text-5xl"></i>
                                        <span className="text-[10px] font-bold uppercase tracking-widest">No Preview</span>
                                    </div>
                                )}
                                {/* Grade badge — brushed brass */}
                                <div className="absolute top-3 right-3 px-3 py-1.5 flex flex-col items-center" style={{
                                    background: card.is_slab ? 'linear-gradient(135deg, #a855f7, #c084fc, #9333ea)' : 'linear-gradient(135deg,#BF953F,#FCF6BA,#B38728)',
                                    boxShadow: card.is_slab ? '0 0 16px rgba(168,85,247,0.35)' : '0 0 16px rgba(191,149,63,0.35)'
                                }}>
                                    <span className="text-[8px] font-black uppercase tracking-widest leading-none mb-0.5" style={{ color: card.is_slab ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)' }}>
                                        {card.is_slab && card.grader ? card.grader : 'Est. Grade'}
                                    </span>
                                    <span className="text-xl font-black leading-none" style={{ color: card.is_slab ? '#ffffff' : '#000000' }}>{card.overall_grade}</span>
                                </div>
                            </div>

                            {/* Card Info */}
                            <div className="p-5 flex flex-col flex-1">
                                <div className="mb-4">
                                    <h3 className="font-bold text-lg text-white group-hover:text-white/80 transition-colors truncate leading-tight mb-1">{card.name}</h3>
                                    <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-[10px] font-bold text-white/30 uppercase tracking-widest">
                                        <div className="truncate font-black text-white/50">{card.card_set}</div>
                                        <div className="text-right">{card.year}</div>
                                        <div>{card.edition || 'N/A'}</div>
                                        <div className="text-right">#{card.card_number || '---'}</div>
                                    </div>

                                    {user?.role === 'admin' && (card.parent_id || card.child_count > 0) && (
                                        <div className="mt-3 pt-2 border-t border-white/5">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleAdminReset(card.id, 'selective');
                                                }}
                                                className="w-full bg-red-600/10 text-red-600 border border-red-600/30 py-1 text-[10px] font-black uppercase tracking-wider hover:bg-red-600 hover:text-white transition-all flex items-center justify-center gap-2"
                                            >
                                                <i className="fas fa-link-slash"></i> Break Chain
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] text-white/30 font-bold uppercase mb-0.5 leading-none tracking-widest">
                                            {card.is_slab ? 'Authenticated' : 'Scanned'}
                                        </span>
                                        <span className="text-xs text-white/50 font-medium">{new Date(card.date_scanned).toLocaleDateString()}</span>
                                    </div>
                                    <button 
                                        className="px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all"
                                        style={card.is_slab ? {
                                            background: 'linear-gradient(to right, rgba(168,85,247,0.2), rgba(126,34,206,0.2))',
                                            color: '#c084fc',
                                            border: '1px solid rgba(168,85,247,0.3)'
                                        } : {
                                            background: 'linear-gradient(to right, #BF953F, #E8C881, #B38728)',
                                            color: 'black'
                                        }}
                                    >
                                        {card.is_slab ? 'Verify Auth' : 'Verify Audit'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="col-span-full py-20 text-center space-y-4">
                        <i className="fas fa-search text-6xl text-white/10"></i>
                        <p className="text-white/30 text-xl font-bold">No certificates found matching your criteria</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PublicArchive;
