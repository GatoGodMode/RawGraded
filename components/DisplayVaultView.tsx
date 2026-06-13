import React, { useState, useEffect } from 'react';
import LogoR from './LogoR';
import Card3DViewer from './Card3DViewer';

interface DisplayVaultViewProps {
    vaultId: string;
}

const DisplayVaultView: React.FC<DisplayVaultViewProps> = ({ vaultId }) => {
    const [loading, setLoading] = useState(true);
    const [vaultData, setVaultData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const [threeDOpen, setThreeDOpen] = useState(false);
    const [threeDBusy, setThreeDBusy] = useState(false);
    const [threeDError, setThreeDError] = useState<string | null>(null);
    const [threeDData, setThreeDData] = useState<null | {
        front_texture: string;
        back_texture: string;
        height_grid_json: string;
        height_grid_meta?: any;
        is_holographic: boolean;
        holo_pattern?: string;
        year: string;
        card_set: string;
    }>(null);

    const parseHeightGridStrength = (meta: any): number | undefined => {
        if (meta == null) return undefined;
        if (typeof meta === 'string') {
            try {
                const parsed = JSON.parse(meta);
                const s = parsed?.strength;
                return typeof s === 'number' && Number.isFinite(s) ? s : (s != null ? Number(s) : undefined);
            } catch {
                return undefined;
            }
        }
        const s = meta?.strength;
        if (typeof s === 'number' && Number.isFinite(s)) return s;
        if (s != null) return Number(s);
        return undefined;
    };

    const open3DForCert = async (certId: string) => {
        setThreeDError(null);
        setThreeDOpen(true);
        setThreeDBusy(true);
        setThreeDData(null);
        try {
            const res = await fetch(
                `api/plugin_3d_card.php?action=public_get_for_vault&vault_id=${encodeURIComponent(vaultId)}&cert_id=${encodeURIComponent(certId)}`
            );
            const json = await res.json();
            if (!json.success) throw new Error(json.error || '3D not available.');
            if (!json.has_3d) throw new Error('3D not generated for this card yet.');
            setThreeDData({
                front_texture: json.front_texture,
                back_texture: json.back_texture,
                height_grid_json: json.height_grid_json,
                height_grid_meta: json.height_grid_meta ?? null,
                is_holographic: Boolean(json.is_holographic),
                holo_pattern: json.holo_pattern ?? 'none',
                year: json.year != null ? String(json.year) : '',
                card_set: json.card_set != null ? String(json.card_set) : '',
            });
        } catch (e: any) {
            setThreeDError(e?.message || String(e));
        } finally {
            setThreeDBusy(false);
        }
    };

    useEffect(() => {
        const fetchVault = async () => {
            setLoading(true);
            try {
                const res = await fetch(`api/plugin_display_vault.php?action=get_public_vault&vault_id=${vaultId}`);
                const data = await res.json();
                if (data.success) {
                    setVaultData(data);
                } else {
                    setError(data.error || 'Vault not found.');
                }
            } catch (e) {
                console.error(e);
                setError('Failed to load vault.');
            }
            setLoading(false);
        };
        fetchVault();
    }, [vaultId]);

    if (loading) {
        return (
            <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50">
                <i className="fas fa-university text-5xl text-[#D4AF37] opacity-20 animate-pulse mb-6"></i>
                <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-[#D4AF37] w-1/3 animate-progress"></div>
                </div>
            </div>
        );
    }

    if (error || !vaultData) {
        return (
            <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50 text-center p-6">
                <i className="fas fa-times-circle text-6xl text-red-500 mb-6 font-thin"></i>
                <h1 className="text-2xl font-black text-white uppercase tracking-widest mb-2">Vault Unavailable</h1>
                <p className="text-white/40 uppercase tracking-widest text-xs max-w-sm mx-auto">{error || 'This curated collection could not be found or is private.'}</p>
                <a href="/" className="mt-8 px-6 py-3 border border-white/20 text-white hover:bg-white hover:text-black transition-all rounded uppercase text-[10px] font-black tracking-widest">Return Home</a>
            </div>
        );
    }

    const { vault, items } = vaultData;
    const championItem = items.find((i: any) => i.is_champion);
    const galleryItems = items.filter((i: any) => !i.is_champion);

    return (
        <div className="min-h-screen bg-[#050505] text-white selection:bg-[#D4AF37] selection:text-black">
            {/* Ambient Background */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-[#D4AF37] opacity-5 blur-[150px] rounded-full"></div>
            </div>

            {/* Header */}
            <header className="relative z-10 p-6 md:p-12 flex flex-col items-center justify-center text-center space-y-4 border-b border-white/5 bg-black/50 backdrop-blur-md">
                <a href="/" className="group mb-4 inline-flex items-center gap-2 opacity-70 group-hover:opacity-100 transition-opacity">
                    <LogoR size={32} />
                    <span className="text-sm font-black uppercase tracking-[0.2em] text-white">RawGraded</span>
                </a>
                <h1 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#F3E5AB] via-[#D4AF37] to-[#8C762E] uppercase tracking-[0.2em]">{vault.title}</h1>
                <div className="flex items-center gap-4 text-[10px] font-bold tracking-widest uppercase text-white/50">
                    <span className="flex items-center gap-2"><i className="fas fa-user-circle"></i>{vault.x_username ? `@${vault.x_username}` : vault.username}</span>
                    <span className="w-1 h-1 rounded-full bg-white/20"></span>
                    <span>Curated Collection</span>
                </div>
            </header>

            <main className="relative z-10 max-w-7xl mx-auto px-6 py-12 md:py-24 space-y-24">
                {/* Champion Display */}
                {championItem && (
                    <section className="flex flex-col items-center">
                        <div className="text-center mb-12 animate-fade-in-up">
                            <h2 className="text-sm font-black text-[#D4AF37] uppercase tracking-[0.3em] flex items-center justify-center gap-3">
                                <i className="fas fa-crown"></i> The Champion <i className="fas fa-crown"></i>
                            </h2>
                            <p className="text-[10px] text-white/30 uppercase mt-2 tracking-widest">Masterpiece Collection</p>
                        </div>
                        
                        <div className="relative group max-w-sm w-full mx-auto animate-float">
                            {/* Golden Glow */}
                            <div className="absolute -inset-4 bg-gradient-to-r from-[#D4AF37]/30 to-[#F3E5AB]/30 blur-2xl opacity-50 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none rounded-full"></div>
                            
                            {/* The Frame */}
                            <div className="relative p-3 rounded-2xl bg-gradient-to-br from-[#F3E5AB] via-[#D4AF37] to-[#8A6F1C] p-[3px] shadow-[0_20px_50px_rgba(212,175,55,0.2)]">
                                <div className="absolute inset-[1px] bg-black rounded-xl z-0"></div>
                                <img src={championItem.front_thumb} alt={championItem.name} className="relative z-10 w-full rounded-xl object-cover shadow-2xl" />
                            </div>

                            {/* Champion Plaque */}
                            <div className="relative z-20 -mt-8 mx-6 bg-black border border-[#D4AF37]/50 rounded-lg p-6 text-center shadow-2xl shadow-black">
                                <h3 className="text-xl font-black text-white uppercase tracking-wider mb-1 line-clamp-2">{championItem.name}</h3>
                                <div className="text-xs text-[#D4AF37] font-bold uppercase tracking-widest mb-4">{championItem.card_set} • {championItem.year}</div>
                                
                                <div className="inline-block px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-black text-white uppercase tracking-widest mb-6">
                                    {championItem.overall_grade ? `Grade: ${championItem.overall_grade}` : 'Raw Asset'}
                                </div>

                                {championItem.has_3d && (
                                    <button
                                        onClick={() => open3DForCert(championItem.item_id)}
                                        className="mb-2 inline-flex items-center justify-center gap-2 px-4 py-2 bg-white/5 border border-white/10 hover:bg-[#D4AF37]/10 transition-colors text-white text-[10px] font-black uppercase tracking-widest"
                                    >
                                        <i className="fas fa-cube text-[#D4AF37]"></i> 3D
                                    </button>
                                )}

                                {/* Transparency Data (If enabled for this item) */}
                                {championItem.transparency_active && (
                                    <div className="pt-4 border-t border-dashed border-white/20 flex items-center justify-between">
                                        <div className="text-left">
                                            <div className="text-[8px] text-white/40 uppercase tracking-widest font-bold mb-1">Acquired</div>
                                            <div className="text-sm font-black text-white">${parseFloat(championItem.acq_price || 0).toLocaleString()}</div>
                                        </div>
                                        {championItem.value_increase_pct != null ? (
                                            <div className="text-right">
                                                <div className="text-[8px] text-green-400/80 uppercase tracking-widest font-bold mb-1">Value Increase</div>
                                                <div className="text-lg font-black text-green-400 flex items-center gap-1 justify-end">
                                                    <i className="fas fa-arrow-trend-up text-xs"></i> 
                                                    {championItem.value_increase_pct > 0 ? '+' : ''}{championItem.value_increase_pct.toFixed(1)}%
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-right">
                                                <div className="text-[8px] text-white/40 uppercase tracking-widest font-bold mb-1">Current Value</div>
                                                <div className="text-sm font-black text-[#D4AF37]">${parseFloat(championItem.market_value || 0).toLocaleString()}</div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                {/* Gallery Grid */}
                {galleryItems.length > 0 && (
                    <section>
                        <div className="text-center mb-16">
                            <h2 className="text-sm font-black text-white uppercase tracking-[0.3em] flex items-center justify-center gap-3 opacity-50">
                                <span className="w-12 h-[1px] bg-white/20"></span>
                                The Gallery
                                <span className="w-12 h-[1px] bg-white/20"></span>
                            </h2>
                        </div>

                        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-16">
                            {galleryItems.map((item: any) => (
                                <div key={item.item_id} className="group relative">
                                    <div className="aspect-[63/88] w-full relative mb-4">
                                        <div className="absolute -inset-2 bg-white/5 opacity-0 group-hover:opacity-100 rounded-xl blur-xl transition-opacity duration-500"></div>
                                        <div className="relative h-full w-full rounded-lg overflow-hidden border border-white/10 group-hover:border-white/30 transition-colors bg-white/5 shadow-2xl">
                                            <img src={item.front_thumb} alt={item.name} className="absolute inset-0 w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700 ease-out" />
                                        </div>
                                    </div>
                                    
                                    <div className="text-center px-2">
                                        <h3 className="text-xs font-black text-white uppercase tracking-wider line-clamp-1 mb-1 group-hover:text-[#D4AF37] transition-colors">{item.name}</h3>
                                        <div className="text-[9px] text-white/40 font-bold uppercase tracking-widest mb-2">{item.card_set}</div>
                                        <div className="inline-block px-3 py-1 rounded bg-white/5 border border-white/5 text-[9px] font-black text-white/70 uppercase">
                                            {item.overall_grade ? `Grade: ${item.overall_grade}` : 'Raw Asset'}
                                        </div>

                                            {item.has_3d && (
                                                <button
                                                    onClick={() => open3DForCert(item.item_id)}
                                                    className="mt-3 inline-flex items-center justify-center gap-2 px-3 py-1 bg-white/5 border border-white/10 hover:bg-[#D4AF37]/10 transition-colors text-white text-[9px] font-black uppercase tracking-widest"
                                                >
                                                    <i className="fas fa-cube text-[#D4AF37]"></i> 3D
                                                </button>
                                            )}

                                        {/* Transparency Data (If enabled for this item) */}
                                        {item.transparency_active && (
                                            <div className="mt-4 pt-4 border-t border-dashed border-white/10 grid grid-cols-2 gap-2 text-left">
                                                <div>
                                                    <div className="text-[7px] text-white/30 uppercase tracking-widest font-bold">Acquired</div>
                                                    <div className="text-[10px] font-black text-white/80">${parseFloat(item.acq_price || 0).toLocaleString()}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-[7px] text-[#D4AF37]/50 uppercase tracking-widest font-bold">Current</div>
                                                    <div className="text-[10px] font-black text-[#D4AF37]">${parseFloat(item.market_value || 0).toLocaleString()}</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </main>

            {threeDOpen && (
                <div className="fixed inset-0 z-[260] flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm">
                    <div className="w-full max-w-4xl bg-[#0b0b0b] border border-white/10 rounded-sm shadow-2xl overflow-hidden max-h-[96vh] sm:max-h-[92vh] flex flex-col">
                        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-full flex items-center justify-center">
                                    <i className="fas fa-cube text-[#D4AF37]"></i>
                                </div>
                                <div>
                                    <div className="text-sm font-black uppercase tracking-widest">3D View</div>
                                    <div className="text-[10px] text-white/40 uppercase tracking-widest">Rotate & zoom</div>
                                </div>
                            </div>
                            <button
                                className="w-10 h-10 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-white/70 hover:text-white"
                                onClick={() => setThreeDOpen(false)}
                                aria-label="Close 3D viewer"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="p-2 sm:p-4 flex-1 overflow-auto">
                            {threeDError && (
                                <div className="mb-3 p-3 border border-red-500/30 bg-red-500/10 text-red-300 text-sm font-bold rounded">
                                    {threeDError}
                                </div>
                            )}
                            {threeDBusy ? (
                                <div className="flex flex-col items-center justify-center py-14 text-center">
                                    <i className="fas fa-circle-notch fa-spin text-4xl text-[#D4AF37] mb-4" aria-hidden />
                                    <div className="text-[#D4AF37] font-black uppercase tracking-widest text-sm">Loading 3D…</div>
                                    <div className="text-white/45 text-xs mt-2 max-w-sm">Fetching textures and relief data for this vault item.</div>
                                </div>
                            ) : threeDData ? (
                                <Card3DViewer
                                    frontTexture={threeDData.front_texture}
                                    backTexture={threeDData.back_texture}
                                    heightGridJson={threeDData.height_grid_json}
                                    isHolographic={threeDData.is_holographic}
                                    holoPattern={threeDData.holo_pattern ?? 'none'}
                                    year={threeDData.year}
                                    cardSet={threeDData.card_set}
                                    normalStrength={parseHeightGridStrength(threeDData.height_grid_meta) ?? undefined}
                                    showLightingControls={true}
                                    className="w-full max-w-[320px] sm:max-w-[500px] mx-auto"
                                />
                            ) : null}
                        </div>
                    </div>
                </div>
            )}

            <footer className="relative z-10 border-t border-white/10 py-12 text-center bg-black/50">
                <a href="/" className="inline-flex items-center gap-2 mb-4 opacity-30 hover:opacity-100 transition-opacity">
                    <LogoR size={22} />
                    <span className="text-xs font-black uppercase tracking-widest text-white">RawGraded</span>
                </a>
                <p className="text-[9px] text-white/20 uppercase tracking-[0.2em] font-black">
                    Verified Digital Asset Collection
                </p>
                <p className="text-[8px] text-white/10 mt-2 uppercase tracking-widest">
                    &copy; {new Date().getFullYear()} RawGraded. All Rights Reserved.
                </p>
            </footer>

            <style>{`
                @keyframes float {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }
                .animate-float { animation: float 6s ease-in-out infinite; }
                @keyframes progress {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(300%); }
                }
                .animate-progress { animation: progress 2s linear infinite; }
            `}</style>
        </div>
    );
};

export default DisplayVaultView;
