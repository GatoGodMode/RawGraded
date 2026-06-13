import React, { useState, useMemo, forwardRef, useImperativeHandle } from 'react';

/**
 * VaultNumberingPlugin
 * --------------------
 * A modular "addon" component that restores the specialized vault numbering system.
 * It handles:
 * 1. Orphan Tracking (Uncounted duplicates grouping)
 * 2. Orphan Toggle & Stack View UI
 * 3. Numbering Wizard (Sequencing mode with COPY X overlays)
 * 4. OrphanGroupModal (Managing individual cards in a stack)
 */

export interface VaultNumberingPluginProps {
    scans: any[];
    user: any;
    onRefresh: () => void;
    onSelect: (id: string) => void;
    onRegrade: (id: string) => void;
}

export interface VaultNumberingPluginHandle {
    showOrphans: boolean;
    isNumberingMode: boolean;
    numberingAnchor: { name: string, set: string, year: string } | null;
    selectedSequence: string[];
    handleToggleNumbering: (scan: any) => void;
    handleUncount: (id: string, e?: React.MouseEvent) => Promise<void>;
    renderCardOverlay: (scan: any) => React.ReactNode;
    orphanGroups: Record<string, any[]>;
    orphans: any[];
}

const VaultNumberingPlugin = forwardRef<VaultNumberingPluginHandle, VaultNumberingPluginProps>((props, ref) => {
    const { scans, user, onRefresh, onSelect, onRegrade } = props;

    // -------------------------------------------------------------------------
    // 1. STATE
    // -------------------------------------------------------------------------
    const [showOrphans, setShowOrphans] = useState(false);
    const [isNumberingMode, setIsNumberingMode] = useState(false);
    const [numberingAnchor, setNumberingAnchor] = useState<{ name: string, set: string, year: string } | null>(null);
    const [selectedSequence, setSelectedSequence] = useState<string[]>([]);
    const [orphanGroupModal, setOrphanGroupModal] = useState<{ key: string, name: string, set: string, year: string, cards: any[] } | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // -------------------------------------------------------------------------
    // 2. DATA PROCESSING
    // -------------------------------------------------------------------------

    const hasVaultCopy = (s: any) => {
        const v = s.vault_copy;
        return v != null && v !== '' && Number(v) > 0;
    };
    const noVaultCopy = (s: any) => !hasVaultCopy(s);

    const sameStack = (a: any, b: any) =>
        a.name === b.name && a.card_set === b.card_set &&
        (a.year === b.year || (String(a.year || '').trim() === '' && String(b.year || '').trim() === ''));

    // Duplicate stacks = any group of 2+ cards with same name/set/year (so user can open modal and run wizard).
    const duplicateStacks = useMemo(() => {
        const groups: Record<string, any[]> = {};
        scans.forEach(scan => {
            const key = `${scan.name}-${scan.card_set}-${scan.year}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(scan);
        });
        return Object.fromEntries(Object.entries(groups).filter(([, cards]) => cards.length >= 2));
    }, [scans]);

    // Orphans (strict) = certs with no vault_copy that have at least one sibling that IS numbered. Matches backend orphaned_copies.
    const orphans = useMemo(() => {
        return scans.filter(s => {
            if (!noVaultCopy(s)) return false;
            return scans.some(o => o.id !== s.id && sameStack(o, s) && hasVaultCopy(o));
        });
    }, [scans]);

    // Groups of orphans only (for backward compat / ref); UI uses duplicateStacks so button and modal show for any duplicate stack.
    const orphanGroups = useMemo(() => {
        const groups: Record<string, any[]> = {};
        orphans.forEach(scan => {
            const key = `${scan.name}-${scan.card_set}-${scan.year}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(scan);
        });
        return groups;
    }, [orphans]);

    // -------------------------------------------------------------------------
    // 3. ACTIONS
    // -------------------------------------------------------------------------

    const handleToggleNumbering = (scan: any) => {
        if (isNumberingMode) {
            // Check if card matches anchor (name, set, and year)
            if (
                numberingAnchor?.name === scan.name &&
                numberingAnchor?.set === scan.card_set &&
                numberingAnchor?.year === scan.year
            ) {
                setSelectedSequence(prev => {
                    if (prev.includes(scan.id)) return prev.filter(id => id !== scan.id);
                    return [...prev, scan.id];
                });
            }
        } else {
            // Enter mode
            setNumberingAnchor({ name: scan.name, set: scan.card_set, year: scan.year });
            setIsNumberingMode(true);
            setSelectedSequence([]);
        }
    };

    const handleSaveSequence = async () => {
        if (selectedSequence.length === 0) return;
        setIsSaving(true);
        try {
            const response = await fetch('api/collection.php?action=update_vault_copies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: user.id,
                    ids: selectedSequence
                })
            });
            const result = await response.json();
            if (result.success) {
                setIsNumberingMode(false);
                setNumberingAnchor(null);
                setSelectedSequence([]);
                onRefresh();
            } else {
                alert("Save failed: " + result.error);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleUncount = async (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (!confirm("Remove copy number and return to Orphan stack?")) return;
        try {
            const response = await fetch('api/collection.php?action=uncount_copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            const result = await response.json();
            if (result.success) onRefresh();
        } catch (err) {
            console.error(err);
        }
    };

    // -------------------------------------------------------------------------
    // 4. EXTERNAL INTERFACE (Exposed to MyCollection)
    // -------------------------------------------------------------------------

    useImperativeHandle(ref, () => ({
        showOrphans,
        isNumberingMode,
        numberingAnchor,
        selectedSequence,
        handleToggleNumbering,
        handleUncount,
        orphanGroups,
        orphans,
        renderCardOverlay: (scan: any) => {
            if (!isNumberingMode || !numberingAnchor) return null;
            if (scan.name !== numberingAnchor.name || scan.card_set !== numberingAnchor.set || scan.year !== numberingAnchor.year) return null;

            const index = selectedSequence.indexOf(scan.id);
            const isSelected = index !== -1;

            return (
                <div
                    onClick={(e) => { e.stopPropagation(); handleToggleNumbering(scan); }}
                    className={`absolute inset-0 z-50 flex items-center justify-center transition-all cursor-pointer ${isSelected ? 'bg-poke-accent/40 border-4 border-poke-accent' : 'bg-black/60 hover:bg-black/40'}`}
                >
                    <div className={`px-4 py-2 rounded-full font-black text-xl shadow-2xl ${isSelected ? 'bg-poke-accent text-white scale-110' : 'bg-white/20 text-white/50 border border-white/30'}`}>
                        {isSelected ? `COPY ${index + 1}` : 'TAP TO NUMBER'}
                    </div>
                </div>
            );
        }
    }));

    // -------------------------------------------------------------------------
    // 5. INTERNAL UI (Floaters & Modals)
    // -------------------------------------------------------------------------

    return (
        <>
            {/* FLOATER: Duplicate stacks / Orphans — show when any stack has 2+ copies so modal is reachable */}
            {!isNumberingMode && Object.keys(duplicateStacks).length > 0 && (
                <button
                    onClick={() => setShowOrphans(!showOrphans)}
                    className={`fixed bottom-6 right-6 z-[100] px-6 py-3 rounded-full font-black uppercase tracking-widest shadow-[0_0_30px_rgba(0,0,0,0.5)] flex items-center gap-3 transition-all border-2 ${showOrphans ? 'bg-poke-accent text-white border-poke-accent scale-110' : 'bg-gray-900 text-gray-400 border-gray-800 hover:border-poke-accent hover:text-poke-accent'}`}
                >
                    <i className={`fas ${showOrphans ? 'fa-times-circle' : 'fa-layer-group text-poke-accent'}`}></i>
                    {showOrphans ? 'Close Stacks' : `${Object.keys(duplicateStacks).length} Duplicate Stacks`}
                </button>
            )}

            {/* FLOATER: Numbering Control Bar */}
            {isNumberingMode && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] bg-gray-900/95 border-2 border-poke-accent p-2 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] flex items-center gap-4 animate-slide-up backdrop-blur-md">
                    <div className="px-4 py-2 bg-black/40 rounded-xl border border-white/5">
                        <span className="text-[10px] text-gray-500 font-black uppercase tracking-widest block leading-none mb-1">Sequencing Mode</span>
                        <span className="text-sm font-bold text-white leading-none whitespace-nowrap">{numberingAnchor?.name}</span>
                    </div>

                    <div className="h-10 w-px bg-white/10 hidden sm:block"></div>

                    <button
                        onClick={() => { setIsNumberingMode(false); setNumberingAnchor(null); }}
                        className="px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-all"
                    >
                        Cancel
                    </button>

                    <button
                        disabled={selectedSequence.length === 0 || isSaving}
                        onClick={handleSaveSequence}
                        className={`px-8 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 ${selectedSequence.length > 0 ? 'bg-poke-accent text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] hover:scale-105 active:scale-95' : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}
                    >
                        {isSaving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-save font-bold"></i>}
                        Save {selectedSequence.length} Copies
                    </button>
                </div>
            )}

            {/* MODAL: Orphan Group Viewer */}
            {orphanGroupModal && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm shadow-2xl">
                    <div className="bg-gray-900 border border-white/10 rounded-3xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl relative animate-zoom-in">
                        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-poke-accent/10 to-transparent">
                            <div>
                                <h2 className="text-2xl font-black text-white uppercase tracking-tighter">{orphanGroupModal.name}</h2>
                                <p className="text-xs text-gray-400 uppercase font-bold tracking-widest">{orphanGroupModal.set} • {orphanGroupModal.year} • {orphanGroupModal.cards.length} Physical Scans</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        const anchor = { name: orphanGroupModal.name, set: orphanGroupModal.set, year: orphanGroupModal.year };
                                        setOrphanGroupModal(null);
                                        setShowOrphans(false);
                                        setNumberingAnchor(anchor);
                                        setIsNumberingMode(true);
                                        setSelectedSequence([]);
                                    }}
                                    className="bg-poke-accent text-white px-6 py-2 rounded-xl font-black uppercase text-xs tracking-widest shadow-lg hover:bg-red-600 transition-all flex items-center gap-2"
                                >
                                    <i className="fas fa-sort-numeric-down"></i> Launch Wizard
                                </button>
                                <button onClick={() => setOrphanGroupModal(null)} className="text-gray-500 hover:text-white transition-colors p-2">
                                    <i className="fas fa-times text-2xl"></i>
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {orphanGroupModal.cards.map(scan => (
                                    <div key={scan.id} className="group relative bg-black/40 rounded-2xl border border-white/5 overflow-hidden hover:border-poke-accent/30 transition-all shadow-lg">
                                        <div className="aspect-[3/4] overflow-hidden">
                                            <img src={`api/collection.php?action=serve_image&id=${scan.id}&type=front`} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                        </div>
                                        <div className="p-3 bg-gradient-to-t from-black to-transparent">
                                            <div className="flex items-center justify-between gap-1">
                                                <span className="text-[10px] font-black text-white/50 uppercase truncate">ID: {scan.id.slice(-6)}</span>
                                                <div className="flex gap-1.5 translate-y-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-hover:translate-y-0 transition-all duration-300">
                                                    <button onClick={() => onRegrade(scan.id)} className="w-8 h-8 rounded-lg bg-teal-500 text-white flex items-center justify-center hover:bg-teal-400 shadow-lg">
                                                        <i className="fas fa-microscope text-xs"></i>
                                                    </button>
                                                    <button onClick={() => onSelect(scan.id)} className="w-8 h-8 rounded-lg bg-poke-accent text-white flex items-center justify-center hover:bg-red-500 shadow-lg">
                                                        <i className="fas fa-external-link-alt text-xs"></i>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* DUPLICATE STACKS OVERLAY — lists all stacks of 2+ (same name/set/year); click opens modal */}
            {showOrphans && (
                <div className="bg-black/80 backdrop-blur-3xl rounded-3xl p-8 border border-white/5 shadow-2xl animate-fade-in mb-12">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                        <div>
                            <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-2 flex items-center gap-4">
                                <i className="fas fa-layer-group text-poke-accent"></i>
                                Duplicate Stacks
                            </h2>
                            <p className="text-gray-400 font-bold uppercase tracking-[0.2em] text-xs">Grouped by Name, Set, and Year • Click a stack to open and run the numbering wizard</p>
                        </div>
                        <button onClick={() => setShowOrphans(false)} className="px-8 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white font-black uppercase text-xs tracking-widest transition-all flex items-center gap-3">
                            <i className="fas fa-arrow-left"></i> Back to Main Vault
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8">
                        {Object.entries(duplicateStacks).map(([key, cards]) => {
                            const first = cards[0];
                            return (
                                <div
                                    key={key}
                                    onClick={() => setOrphanGroupModal({ key, name: first.name, set: first.card_set, year: first.year, cards })}
                                    className="group relative cursor-pointer"
                                >
                                    {/* The Stack Effect */}
                                    <div className="absolute inset-x-4 -top-3 h-full bg-poke-accent/20 rounded-3xl border border-poke-accent/30 scale-95 transition-all group-hover:-top-5"></div>
                                    <div className="absolute inset-x-2 -top-1.5 h-full bg-poke-accent/40 rounded-3xl border border-poke-accent/50 scale-[0.97] transition-all group-hover:-top-2.5"></div>

                                    <div className="relative aspect-[3/4] bg-gray-900 rounded-3xl border border-white/10 overflow-hidden shadow-2xl transition-all group-hover:scale-105 group-hover:border-poke-accent">
                                        <img src={`api/collection.php?action=serve_image&id=${first.id}&type=front`} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 opacity-60 group-hover:opacity-100" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent"></div>

                                        {/* Count Badge */}
                                        <div className="absolute top-4 right-4 bg-poke-accent text-white w-12 h-12 rounded-2xl flex flex-col items-center justify-center shadow-lg border-2 border-white/20">
                                            <span className="text-[10px] font-black leading-none mb-0.5">X</span>
                                            <span className="text-xl font-black leading-none">{cards.length}</span>
                                        </div>

                                        <div className="absolute bottom-6 left-6 right-6">
                                            <h3 className="text-lg font-black text-white leading-tight uppercase tracking-tight mb-1 group-hover:text-poke-accent transition-colors">{first.name}</h3>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest whitespace-nowrap overflow-hidden text-ellipsis">{first.card_set} • {first.year}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {Object.keys(duplicateStacks).length === 0 && (
                        <div className="py-24 flex flex-col items-center justify-center text-center opacity-30">
                            <i className="fas fa-check-circle text-6xl mb-6"></i>
                            <h3 className="text-2xl font-black uppercase tracking-widest">No Duplicate Stacks</h3>
                            <p className="text-xs font-bold uppercase tracking-widest mt-2 text-gray-400">No name/set/year has more than one scan</p>
                        </div>
                    )}
                </div>
            )}
        </>
    );
});

VaultNumberingPlugin.displayName = 'VaultNumberingPlugin';

export default VaultNumberingPlugin;
