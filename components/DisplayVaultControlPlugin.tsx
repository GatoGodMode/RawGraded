import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { UserProfile } from '../types';

export interface DisplayVaultControlPluginHandle {
    show: () => void;
    hide: () => void;
}

interface Props {
    user: UserProfile;
    scans: any[];
    psaSlabs: any[];
    onVaultsChanged?: () => void;
}

const DisplayVaultControlPlugin = forwardRef<DisplayVaultControlPluginHandle, Props>(({ user, scans, psaSlabs, onVaultsChanged }, ref) => {
    const [isOpen, setIsOpen] = useState(false);
    
    // Self-contained PSA slabs state (loads when plugin opens, so it works even if PSAVaultPlugin hasn't loaded)
    const [localPsaSlabs, setLocalPsaSlabs] = useState<any[]>([]);
    
    // Combine scans and slabs into activeScans for the picker
    // Prefer locally-fetched slabs if props are empty
    const mergedSlabs = localPsaSlabs.length > 0 ? localPsaSlabs : psaSlabs;
    const activeScans = [
        ...scans.filter(s => s.is_archived !== 1 && s.is_archived !== true),
        ...mergedSlabs.filter(s => s.status === 'active').map(s => ({ ...s, is_psa_slab: true }))
    ];

    const [vaults, setVaults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    // Title editing state
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');

    // View state
    const [view, setView] = useState<'list' | 'editor'>('list');
    const [selectedVault, setSelectedVault] = useState<any | null>(null);
    const [vaultItems, setVaultItems] = useState<any[]>([]);

    // Picker tab state
    const [pickerTab, setPickerTab] = useState<'certificates' | 'slabs'>('certificates');
    const [pickerSearch, setPickerSearch] = useState('');

    useImperativeHandle(ref, () => ({
        show: () => {
            setIsOpen(true);
            fetchVaults();
            fetchLocalPsaSlabs();
        },
        hide: () => setIsOpen(false)
    }));

    const fetchLocalPsaSlabs = async () => {
        try {
            const res = await fetch('api/plugin_psa_vault.php?action=list', { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (Array.isArray(data)) setLocalPsaSlabs(data);
        } catch (e) {
            // silently fail — psaSlabs prop is the fallback
        }
    };

    const fetchVaults = async () => {
        setLoading(true);
        try {
            const res = await fetch(`api/plugin_display_vault.php?action=list_my_vaults`, { credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                setVaults(data.vaults);
            }
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    const fetchVaultDetails = async (vaultId: string) => {
        setLoading(true);
        try {
            const res = await fetch(`api/plugin_display_vault.php?action=get_public_vault&vault_id=${vaultId}`, { credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                setSelectedVault(data.vault);
                setVaultItems(data.items || []);
                setView('editor');
            }
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    const handleCreateVault = async () => {
        if (!confirm('Creating a new Display Vault costs 1 Pro Credit. Do you want to continue?')) return;
        setLoading(true);
        try {
            const res = await fetch('api/plugin_display_vault.php?action=create_vault', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'My New Vault' })
            });
            const data = await res.json();
            if (data.success) {
                fetchVaults();
                if (onVaultsChanged) onVaultsChanged(); // might trigger a credit refresh in parent
            } else {
                alert(data.error || 'Failed to create vault.');
            }
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    const handlePurchaseUpgrade = async (upgradeType: 'champion' | 'transparency') => {
        if (!selectedVault) return;
        if (!confirm(`Unlocking the ${upgradeType} feature costs 1 Pro Credit. This is a one-time upgrade for this vault. Continue?`)) return;
        
        setLoading(true);
        try {
            const res = await fetch('api/plugin_display_vault.php?action=buy_upgrade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ upgrade_type: upgradeType, vault_id: selectedVault.id })
            });
            const data = await res.json();
            if (data.success) {
                fetchVaultDetails(selectedVault.id);
                if (onVaultsChanged) onVaultsChanged();
            } else {
                alert(data.error || 'Failed to purchase upgrade.');
            }
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    const handleSyncItems = async (newItemsList: any[]) => {
        if (!selectedVault) return;
        setLoading(true);
        try {
            const res = await fetch('api/plugin_display_vault.php?action=manage_items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action_type: 'sync',
                    vault_id: selectedVault.id,
                    items: newItemsList.map(i => ({ item_type: i.item_type, item_id: i.item_id, is_champion: i.is_champion }))
                })
            });
            const data = await res.json();
            if (data.success) {
                fetchVaultDetails(selectedVault.id);
            }
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    const addItem = (scan: any) => {
        const id = scan.is_psa_slab ? scan.psa_serial : scan.id;
        if (vaultItems.some(i => i.item_id === id)) return; // Already exists
        const newItem = {
            item_type: scan.is_psa_slab ? 'psa_slab' : 'certificate',
            item_id: id,
            is_champion: false
        };
        handleSyncItems([...vaultItems, newItem]);
    };

    const removeItem = (itemId: string) => {
        handleSyncItems(vaultItems.filter(i => i.item_id !== itemId));
    };

    const setChampion = async (itemId: string, itemType: string) => {
        if (!selectedVault?.has_champion_upgrade) return alert('Champion upgrade required.');
        setLoading(true);
        try {
             await fetch('api/plugin_display_vault.php?action=manage_items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action_type: 'set_champion',
                    vault_id: selectedVault.id,
                    item_id: itemId,
                    item_type: itemType
                })
            });
            fetchVaultDetails(selectedVault.id);
        } catch (e) {
            console.error(e);
            setLoading(false);
        }
    };

    const handleRenameVault = async () => {
        if (!selectedVault || !titleDraft.trim()) return;
        setLoading(true);
        try {
            const res = await fetch('api/plugin_display_vault.php?action=rename_vault', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vault_id: selectedVault.id, title: titleDraft.trim() })
            });
            const data = await res.json();
            if (data.success) {
                setSelectedVault({ ...selectedVault, title: titleDraft.trim() });
                setEditingTitle(false);
                fetchVaults(); // Refresh list in sidebar
            } else {
                alert(data.error || 'Failed to rename vault.');
            }
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    };

    const toggleTransparency = async (itemId: string, itemType: string, currentState: boolean) => {
        if (!selectedVault?.has_transparency_upgrade) return alert('Transparency upgrade required.');
        setLoading(true);
        try {
             await fetch('api/plugin_display_vault.php?action=toggle_item_transparency', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action_type: 'toggle_item_transparency',
                    vault_id: selectedVault.id,
                    item_id: itemId,
                    item_type: itemType,
                    transparency_active: !currentState
                })
            });
            fetchVaultDetails(selectedVault.id);
        } catch (e) {
            console.error(e);
            setLoading(false);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex flex-col md:flex-row overflow-hidden bg-black/90 backdrop-blur-md">
            {/* Left Sidebar: Control Panel */}
            <div className="w-full md:w-[400px] h-auto md:h-full flex-1 md:flex-none bg-[#080808] border-b border-[#D4AF37]/20 md:border-b-0 md:border-r flex flex-col min-h-0 shadow-2xl">
                <div className="p-5 flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-black to-[#D4AF37]/10">
                    <h2 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#D4AF37] to-[#F3E5AB] uppercase tracking-widest flex items-center gap-2">
                        <i className="fas fa-university"></i> Display Vaults
                    </h2>
                    <button onClick={() => setIsOpen(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="relative flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {loading && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                            <i className="fas fa-spinner fa-spin text-3xl text-[#D4AF37]"></i>
                        </div>
                    )}

                    {view === 'list' ? (
                        <div className="space-y-4">
                            <button 
                                onClick={handleCreateVault}
                                className="w-full p-4 border border-[#D4AF37]/30 bg-[#D4AF37]/10 hover:bg-[#D4AF37]/20 rounded-xl transition-all group flex flex-col items-center justify-center gap-2"
                            >
                                <div className="w-10 h-10 rounded-full bg-[#D4AF37]/20 flex items-center justify-center text-[#D4AF37] group-hover:scale-110 transition-transform">
                                    <i className="fas fa-plus text-lg"></i>
                                </div>
                                <div className="text-center">
                                    <div className="text-sm font-black text-[#D4AF37] uppercase tracking-wider">Create New Vault</div>
                                    <div className="text-[10px] text-[#D4AF37]/60 font-bold uppercase mt-1">Costs 1 Pro Credit <i className="fas fa-coins ml-1"></i></div>
                                </div>
                            </button>

                            <div className="space-y-2 mt-6">
                                <h3 className="text-xs font-black text-white/40 uppercase tracking-widest mb-3 px-1">Your Vaults</h3>
                                {vaults.map(v => (
                                    <div 
                                        key={v.id} 
                                        onClick={() => fetchVaultDetails(v.id)}
                                        className="p-4 border border-white/10 bg-white/5 hover:bg-white/10 hover:border-[#D4AF37]/30 rounded-xl cursor-pointer transition-all flex items-center justify-between group"
                                    >
                                        <div>
                                            <div className="text-sm font-black text-white uppercase">{v.title}</div>
                                            <div className="text-[10px] text-white/40 uppercase mt-1 flex items-center gap-3">
                                                <span><i className="fas fa-layer-group mr-1.5"></i>{v.item_count} Items</span>
                                                {v.has_champion_upgrade == 1 && <span className="text-[#D4AF37]"><i className="fas fa-crown mr-1"></i>Champion</span>}
                                            </div>
                                        </div>
                                        <i className="fas fa-chevron-right text-white/20 group-hover:text-[#D4AF37] transition-colors"></i>
                                    </div>
                                ))}
                                {vaults.length === 0 && !loading && (
                                    <div className="text-center p-8 text-white/30 text-xs uppercase font-bold border border-dashed border-white/10 rounded-xl">
                                        No display vaults yet.<br/>Create one to showcase your collection.
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <button onClick={() => setView('list')} className="text-[10px] font-bold text-white/50 hover:text-white uppercase tracking-wider flex items-center gap-2">
                                <i className="fas fa-arrow-left"></i> Back to Vaults
                            </button>

                            {selectedVault && (
                                <>
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                            <div className="text-[10px] font-black text-white/40 uppercase tracking-widest">Vault Title</div>
                                            {!editingTitle && (
                                                <button
                                                    onClick={() => { setTitleDraft(selectedVault.title); setEditingTitle(true); }}
                                                    className="text-[9px] text-white/30 hover:text-[#D4AF37] transition-colors uppercase font-bold flex items-center gap-1"
                                                >
                                                    <i className="fas fa-pencil-alt" /> Edit
                                                </button>
                                            )}
                                        </div>
                                        {editingTitle ? (
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={titleDraft}
                                                    onChange={e => setTitleDraft(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') handleRenameVault(); if (e.key === 'Escape') setEditingTitle(false); }}
                                                    className="flex-1 bg-black/50 border border-[#D4AF37]/40 focus:border-[#D4AF37] rounded px-3 py-2 text-sm font-black text-white uppercase outline-none transition-colors"
                                                    autoFocus
                                                    maxLength={60}
                                                />
                                                <button onClick={handleRenameVault} className="px-3 py-2 bg-[#D4AF37] text-black text-xs font-black rounded hover:bg-yellow-400 transition-colors"><i className="fas fa-check" /></button>
                                                <button onClick={() => setEditingTitle(false)} className="px-3 py-2 bg-white/10 text-white/50 text-xs font-black rounded hover:bg-white/20 transition-colors"><i className="fas fa-times" /></button>
                                            </div>
                                        ) : (
                                            <div className="text-lg font-black text-white uppercase">{selectedVault.title}</div>
                                        )}
                                        <div className="flex items-center gap-2 mt-2">
                                            <input 
                                                type="text" 
                                                readOnly 
                                                value={`https://rawgraded.com/?vault=${selectedVault.id}`}
                                                className="bg-black/50 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white/50 font-mono w-full"
                                            />
                                            <button 
                                                onClick={() => { navigator.clipboard.writeText(`https://rawgraded.com/?vault=${selectedVault.id}`); alert('Copied!'); }}
                                                className="bg-white/10 hover:bg-white/20 text-white rounded px-3 py-1.5 transition-colors"
                                            >
                                                <i className="fas fa-copy"></i>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        {!selectedVault.has_champion_upgrade ? (
                                            <button onClick={() => handlePurchaseUpgrade('champion')} className="p-3 border border-[#D4AF37]/20 bg-[#D4AF37]/5 hover:bg-[#D4AF37]/10 rounded-lg text-center group transition-colors">
                                                <i className="fas fa-crown text-[#D4AF37] text-xl mb-2 group-hover:scale-110 transition-transform"></i>
                                                <div className="text-[10px] font-black text-[#D4AF37] uppercase tracking-wider">Unlock Champion</div>
                                                <div className="text-[8px] text-[#D4AF37]/60 font-bold uppercase mt-1">-1 Pro Credit</div>
                                            </button>
                                        ) : (
                                            <div className="p-3 border border-[#D4AF37]/50 bg-[#D4AF37]/10 rounded-lg text-center flex flex-col items-center justify-center">
                                                <i className="fas fa-check-circle text-[#D4AF37] mb-1"></i>
                                                <div className="text-[10px] font-black text-[#D4AF37] uppercase tracking-wider">Champion Active</div>
                                            </div>
                                        )}

                                        {!selectedVault.has_transparency_upgrade ? (
                                            <button onClick={() => handlePurchaseUpgrade('transparency')} className="p-3 border border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 rounded-lg text-center group transition-colors">
                                                <i className="fas fa-eye text-sky-400 text-xl mb-2 group-hover:scale-110 transition-transform"></i>
                                                <div className="text-[10px] font-black text-sky-400 uppercase tracking-wider">Unlock Transparency</div>
                                                <div className="text-[8px] text-sky-400/60 font-bold uppercase mt-1">-1 Pro Credit</div>
                                            </button>
                                        ) : (
                                            <div className="p-3 border border-sky-500/50 bg-sky-500/10 rounded-lg text-center flex flex-col items-center justify-center">
                                                <i className="fas fa-check-circle text-sky-400 mb-1"></i>
                                                <div className="text-[10px] font-black text-sky-400 uppercase tracking-wider">Transparency Active</div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                            <h3 className="text-xs font-black text-white/60 uppercase tracking-widest">Vault Items ({vaultItems.length})</h3>
                                        </div>
                                        
                                        {vaultItems.length === 0 ? (
                                            <div className="text-center p-6 bg-white/5 border border-white/5 rounded-lg text-white/30 text-[10px] uppercase font-bold">
                                                Select items from your collection on the right to add them to this vault.
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {vaultItems.map(item => (
                                                    <div key={item.item_id} className={`p-2 border rounded-lg bg-black/50 flex gap-3 relative ${item.is_champion ? 'border-[#D4AF37]/50 shadow-[0_0_15px_rgba(212,175,55,0.1)]' : 'border-white/10'}`}>
                                                        <div className="w-12 h-12 bg-white/5 rounded overflow-hidden flex-shrink-0">
                                                            <img src={item.front_thumb} className="w-full h-full object-cover" />
                                                        </div>
                                                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                                                            <div className="text-[10px] font-black text-white uppercase truncate flex items-center gap-1.5">
                                                                {item.is_champion && <i className="fas fa-crown text-[#D4AF37]"></i>}
                                                                {item.name}
                                                            </div>
                                                            <div className="text-[8px] text-white/40 uppercase font-bold truncate">{item.card_set} • {item.overall_grade ? `Grade: ${item.overall_grade}` : 'Raw'}</div>
                                                            
                                                            <div className="flex items-center gap-2 mt-1.5">
                                                                {selectedVault.has_champion_upgrade && !item.is_champion && (
                                                                    <button onClick={() => setChampion(item.item_id, item.item_type)} className="text-[8px] bg-white/5 hover:bg-[#D4AF37]/20 hover:text-[#D4AF37] px-2 py-0.5 rounded text-white/40 uppercase font-bold transition-colors">Make Champion</button>
                                                                )}
                                                                {selectedVault.has_transparency_upgrade && (
                                                                    <button 
                                                                        onClick={() => toggleTransparency(item.item_id, item.item_type, item.transparency_active)} 
                                                                        className={`text-[8px] px-2 py-0.5 rounded uppercase font-bold transition-colors ${item.transparency_active ? 'bg-sky-500/20 text-sky-400' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                                                                    >
                                                                        {item.transparency_active ? <><i className="fas fa-eye mr-1"></i>Visible</> : <><i className="fas fa-eye-slash mr-1"></i>Hidden</>}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <button onClick={() => removeItem(item.item_id)} className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded text-[10px] transition-colors">
                                                            <i className="fas fa-times"></i>
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {/* Right Area: Collection Picker (Only active when in editor mode) */}
            <div className="flex-1 md:h-full flex flex-col overflow-hidden relative min-h-0">
                {view === 'editor' ? (
                    <div className="flex flex-col h-full">
                        {/* Picker Header */}
                        <div className="p-5 pb-0 border-b border-white/10 bg-black/30">
                            <h3 className="text-base font-black text-white uppercase tracking-widest mb-3 flex items-center justify-between">
                                <span>Collection Picker</span>
                                <span className="text-[9px] text-white/30 font-normal normal-case tracking-normal">Click to add to {selectedVault?.title}</span>
                            </h3>
                            {/* Tabs */}
                            <div className="flex gap-1 mb-0">
                                <button
                                    onClick={() => { setPickerTab('certificates'); setPickerSearch(''); }}
                                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${
                                        pickerTab === 'certificates'
                                            ? 'border-[#D4AF37] text-[#D4AF37]'
                                            : 'border-transparent text-white/40 hover:text-white/70'
                                    }`}
                                >
                                    <i className="fas fa-certificate mr-1.5" />
                                    RawGraded
                                    <span className="ml-2 bg-white/10 text-white/50 text-[8px] px-1.5 py-0.5 rounded-full">
                                        {scans.filter(s => s.is_archived !== 1 && s.is_archived !== true).length}
                                    </span>
                                </button>
                                <button
                                    onClick={() => { setPickerTab('slabs'); setPickerSearch(''); }}
                                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${
                                        pickerTab === 'slabs'
                                            ? 'border-red-500 text-red-400'
                                            : 'border-transparent text-white/40 hover:text-white/70'
                                    }`}
                                >
                                    <i className="fas fa-shield-alt mr-1.5" />
                                    PSA Slabs
                                    <span className="ml-2 bg-white/10 text-white/50 text-[8px] px-1.5 py-0.5 rounded-full">
                                        {mergedSlabs.filter(s => s.status === 'active').length}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* Search */}
                        <div className="px-5 pt-4 pb-2 bg-black/20">
                            <div className="relative">
                                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-white/20 text-xs" />
                                <input
                                    type="text"
                                    value={pickerSearch}
                                    onChange={e => setPickerSearch(e.target.value)}
                                    placeholder={pickerTab === 'certificates' ? 'Search certificates...' : 'Search PSA slabs...'}
                                    className="w-full bg-white/5 border border-white/10 focus:border-[#D4AF37]/40 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-white/20 outline-none transition-colors"
                                />
                                {pickerSearch && (
                                    <button onClick={() => setPickerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/60 transition-colors">
                                        <i className="fas fa-times text-xs" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Grid */}
                        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                            {pickerTab === 'certificates' ? (() => {
                                const certs = scans
                                    .filter(s => s.is_archived !== 1 && s.is_archived !== true)
                                    .filter(s => !pickerSearch || (s.name || '').toLowerCase().includes(pickerSearch.toLowerCase()) || (s.card_set || '').toLowerCase().includes(pickerSearch.toLowerCase()));

                                if (certs.length === 0) return (
                                    <div className="flex flex-col items-center justify-center h-40 text-white/20 text-xs font-bold uppercase tracking-widest">
                                        <i className="fas fa-inbox text-3xl mb-3" />
                                        {pickerSearch ? 'No certificates match your search.' : 'No certificates in your collection.'}
                                    </div>
                                );

                                return (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                        {certs.map(scan => {
                                            const id = scan.id;
                                            const isAdded = vaultItems.some(i => i.item_id === id);
                                            const thumb = scan.front_thumb || (scan.has_front_img ? `api/collection.php?action=serve_image&id=${id}&type=front` : '');
                                            return (
                                                <div
                                                    key={id}
                                                    onClick={() => !isAdded && addItem(scan)}
                                                    className={`relative aspect-[63/88] rounded-xl overflow-hidden border-2 transition-all ${
                                                        isAdded ? 'border-green-500/50 opacity-50 cursor-not-allowed' : 'border-white/10 hover:border-[#D4AF37] cursor-pointer group'
                                                    }`}
                                                >
                                                    <img src={thumb} className="w-full h-full object-cover" />
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent flex flex-col justify-end p-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <div className="text-[9px] font-black text-white uppercase leading-tight line-clamp-2">{scan.name}</div>
                                                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                            <span className="text-[7px] text-[#D4AF37] font-bold uppercase">Grade {scan.overall_grade ?? 'Raw'}</span>
                                                            {scan.vault_copy && (
                                                                <span className="text-[7px] bg-[#D4AF37]/20 text-[#D4AF37] font-black px-1 rounded uppercase">
                                                                    Copy #{scan.vault_copy}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {scan.user_notes && (
                                                            <div className="text-[7px] text-white/50 italic mt-0.5 line-clamp-1">{scan.user_notes}</div>
                                                        )}
                                                    </div>
                                                    {isAdded && (
                                                        <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center backdrop-blur-[1px]">
                                                            <div className="w-8 h-8 rounded-full bg-green-500 text-black flex items-center justify-center text-sm shadow-xl">
                                                                <i className="fas fa-check" />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })() : (() => {
                                const slabs = mergedSlabs
                                    .filter(s => s.status === 'active')
                                    .filter(s => !pickerSearch || (s.card_name || '').toLowerCase().includes(pickerSearch.toLowerCase()) || (s.card_set || '').toLowerCase().includes(pickerSearch.toLowerCase()) || (s.psa_serial || '').includes(pickerSearch));

                                if (slabs.length === 0) return (
                                    <div className="flex flex-col items-center justify-center h-40 text-white/20 text-xs font-bold uppercase tracking-widest">
                                        <i className="fas fa-shield-alt text-3xl mb-3" />
                                        {pickerSearch ? 'No PSA slabs match your search.' : 'No active PSA slabs in your vault.'}
                                    </div>
                                );

                                return (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                        {slabs.map(slab => {
                                            const id = slab.psa_serial;
                                            const isAdded = vaultItems.some(i => i.item_id === id);
                                            const asAnySlab = slab as any;
                                            const thumb = asAnySlab.local_front_img || slab.front_img_url || '';
                                            return (
                                                <div
                                                    key={id}
                                                    onClick={() => !isAdded && addItem({ ...slab, is_psa_slab: true })}
                                                    className={`relative aspect-[63/88] rounded-xl overflow-hidden border-2 transition-all ${
                                                        isAdded ? 'border-green-500/50 opacity-50 cursor-not-allowed' : 'border-white/10 hover:border-red-500 cursor-pointer group'
                                                    }`}
                                                >
                                                    {thumb ? (
                                                        <img src={thumb} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full bg-gradient-to-br from-red-900/30 to-black flex items-center justify-center">
                                                            <i className="fas fa-shield-alt text-2xl text-red-500/40" />
                                                        </div>
                                                    )}
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex flex-col justify-end p-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <div className="text-[9px] font-black text-white uppercase leading-tight line-clamp-2">{slab.card_name}</div>
                                                        <div className="text-[7px] text-red-400 font-bold uppercase mt-0.5">PSA {slab.psa_grade} · #{slab.psa_serial}</div>
                                                    </div>
                                                    {isAdded && (
                                                        <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center backdrop-blur-[1px]">
                                                            <div className="w-8 h-8 rounded-full bg-green-500 text-black flex items-center justify-center text-sm shadow-xl">
                                                                <i className="fas fa-check" />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                        <i className="fas fa-university text-9xl" />
                    </div>
                )}
            </div>
        </div>
    );
});

export default DisplayVaultControlPlugin;
