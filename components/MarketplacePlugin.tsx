import React, { useState, useEffect } from 'react';

export interface MarketplaceSlab {
    id: number;
    psa_serial: string;
    grader: string;
    psa_grade: string | null;
    acq_price: number | null;
    added_at: string;
    for_sale: number;
    sale_link: string | null;
    rg_grade: number | null;
    rg_cert_name: string | null;
    owner_username: string | null;
    rg_front_thumb: string | null;
    rg_front_img: string | null;
    rg_cert_id: string | null;
    auth_check_id: number | null;
    authenticity_score: number | null;
    verdict: string | null;
    front_img_url: string | null;
    local_front_img: string | null;
}

interface MarketplacePluginProps {
    onClose: () => void;
    onViewCert: (authCheckId: number) => void;
}

const GradeBadge: React.FC<{ grade: string | null | undefined; label: string }> = ({ grade, label }) => {
    if (!grade) return null;
    let color = 'rgba(255,255,255,0.2)';
    let text = 'white';
    const num = parseFloat(grade);
    if (!isNaN(num)) {
        if (num >= 10) { color = '#D4AF37'; text = '#000'; }
        else if (num >= 9) { color = '#4ade80'; text = '#000'; }
        else if (num >= 8) { color = '#60a5fa'; text = '#000'; }
    }
    return (
        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', border: `1px solid ${color}`, borderRadius: 6, padding: '2px 6px', gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 900, color: text }}>{grade}</span>
        </div>
    );
};

export default function MarketplacePlugin({ onClose, onViewCert }: MarketplacePluginProps) {
    const [slabs, setSlabs] = useState<MarketplaceSlab[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('api/plugin_marketplace.php?action=list')
            .then(r => r.json())
            .then(data => {
                setSlabs(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    return (
        <div className="fixed inset-0 z-[300] bg-black flex flex-col pt-[env(safe-area-inset-top)] animate-fade-in" style={{
            background: 'radial-gradient(circle at 50% 0%, #1a1a24 0%, #0a0a0f 100%)'
        }}>
            {/* Header */}
            <div className="relative flex items-center justify-between p-4 border-b border-white/5 bg-black/40 backdrop-blur-xl">
                <div className="flex items-center gap-3 mt-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-900/20 border border-purple-500/30 flex items-center justify-center">
                        <i className="fas fa-store text-purple-400 text-lg drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
                    </div>
                    <div>
                        <h1 className="text-white font-black text-lg tracking-widest uppercase flex items-center gap-2">
                            Marketplace
                            <span className="bg-purple-500/20 text-purple-400 text-[9px] px-2 py-0.5 rounded-full border border-purple-500/30 uppercase tracking-widest">Live</span>
                        </h1>
                        <p className="text-white/40 text-xs font-bold tracking-wide">Authenticated Digital Assets</p>
                    </div>
                </div>
                <button onClick={onClose} className="w-10 h-10 mt-4 rounded-full bg-white/5 border border-white/10 text-white/50 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">
                    <i className="fas fa-times" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {loading ? (
                    <div className="flex flex-col flex-1 items-center justify-center py-20">
                        <i className="fas fa-circle-notch fa-spin text-purple-500 text-3xl mb-4" />
                        <p className="text-white/50 text-sm font-bold uppercase tracking-widest">Loading Market...</p>
                    </div>
                ) : slabs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6">
                            <i className="fas fa-ghost text-3xl text-white/20" />
                        </div>
                        <h2 className="text-white text-lg font-black uppercase tracking-widest mb-2">No Listings Yet</h2>
                        <p className="text-white/40 text-sm max-w-xs mx-auto leading-relaxed">
                            No authenticated slabs are currently marked for sale on the global marketplace. Check back later!
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {slabs.map(slab => {
                            const fallbackImg = slab.rg_front_thumb || (slab.rg_front_img ? `api/collection.php?action=serve_image&id=${slab.rg_cert_id}&type=front` : null);
                            const displayImg = slab.local_front_img || slab.front_img_url || fallbackImg;
                            
                            return (
                                <div key={slab.id} className="group relative bg-[#111] border border-white/10 hover:border-purple-500/50 rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-[0_0_30px_rgba(168,85,247,0.15)] flex flex-col">
                                    <div className="aspect-[3/4] relative bg-black flex items-center justify-center overflow-hidden">
                                        {displayImg ? (
                                            <img src={displayImg} alt="Slab" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" />
                                        ) : (
                                            <i className="fas fa-image text-4xl text-white/10" />
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-transparent to-transparent opacity-80 pointer-events-none" />
                                        
                                        <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
                                            {slab.auth_check_id && (
                                                <div 
                                                    className="bg-black/80 backdrop-blur-md border border-[#D4AF37]/50 rounded-lg px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-black transition-colors"
                                                    onClick={(e) => { e.stopPropagation(); onViewCert(slab.auth_check_id!); }}
                                                >
                                                    <i className="fas fa-shield-check text-[#D4AF37] text-sm" />
                                                    <span className="text-[#D4AF37] text-[10px] font-black uppercase tracking-widest">AI Verified</span>
                                                </div>
                                            )}
                                            <div className="bg-black/60 backdrop-blur-md border border-white/20 rounded-lg px-3 py-1.5 flex items-center gap-2">
                                                <i className="fas fa-user-circle text-white/50 text-sm" />
                                                <span className="text-white text-[10px] font-black uppercase tracking-widest">{slab.owner_username || 'Anonymous'}</span>
                                            </div>
                                        </div>

                                        <div className="absolute bottom-3 right-3 flex gap-2 z-10">
                                            <GradeBadge grade={slab.psa_grade} label={slab.grader || 'PSA'} />
                                            {slab.rg_grade && <GradeBadge grade={slab.rg_grade.toFixed(1)} label="RG" />}
                                        </div>
                                    </div>
                                    
                                    <div className="p-5 flex flex-col flex-1 gap-4">
                                        <div className="flex-1">
                                            <h3 className="text-white font-black text-sm uppercase tracking-wider leading-tight mb-2 line-clamp-2">
                                                {slab.rg_cert_name || `${slab.grader} Slab #${slab.psa_serial}`}
                                            </h3>
                                            {slab.rg_cert_id ? (
                                                <p className="text-[#60a5fa] text-[10px] uppercase tracking-widest font-bold">
                                                    <i className="fas fa-link mr-1.5" />Linked to RawGraded
                                                </p>
                                            ) : (
                                                <p className="text-white/30 text-[10px] uppercase tracking-widest font-bold">
                                                    Unlinked Physical Asset
                                                </p>
                                            )}
                                        </div>
                                        
                                        <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                                            <div>
                                                <div className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-0.5">Sale Price</div>
                                                <div className="text-white font-black text-lg">
                                                    {slab.acq_price ? `$${slab.acq_price.toFixed(2)}` : 'Make Offer'}
                                                </div>
                                            </div>
                                            
                                            <a 
                                                href={slab.sale_link || '#'} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className={`px-5 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all ${
                                                    slab.sale_link 
                                                        ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_4px_15px_rgba(168,85,247,0.3)]' 
                                                        : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                                                }`}
                                                onClick={e => { if (!slab.sale_link) e.preventDefault(); }}
                                            >
                                                {slab.sale_link ? 'View Listing' : 'No Link'}
                                                {slab.sale_link && <i className="fas fa-external-link-alt" />}
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
