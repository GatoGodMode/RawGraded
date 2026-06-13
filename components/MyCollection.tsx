import React, { useState, useRef, useEffect } from 'react';
import SlabSlip from './SlabSlip';
import { renderToString } from 'react-dom/server';
import EnvelopeScanPlugin from './EnvelopeScanPlugin';
import { EnvelopeExtractResult, generateMicroReliefHeightGrid } from '../services/geminiService';
import InsuranceLedger from './InsuranceLedger';
import VaultNumberingPlugin, { VaultNumberingPluginHandle } from './VaultNumberingPlugin';
import PSAVaultPlugin, { PSAVaultPluginHandle } from './PSAVaultPlugin';
import DisplayVaultControlPlugin, { DisplayVaultControlPluginHandle } from './DisplayVaultControlPlugin';
import PrivacyControlPlugin from './PrivacyControlPlugin';
import { MarketValuePlugin } from './MarketValuePlugin';
import type { UserProfile } from '../types';
import ReidentifyPlugin from './ReidentifyPlugin';
import CollectOnlyModePlugin from './CollectOnlyModePlugin';
import RemoveBgVaultDisplayPlugin from './RemoveBgVaultDisplayPlugin';
import Card3DViewer from './Card3DViewer';

interface MyCollectionProps {
    user: UserProfile;
    onSelect: (id: string) => void;
    onRegrade?: (id: string) => void;
    onOpenDraft?: () => void;
    onOpenProfile?: () => void;
    onRefreshUser?: () => Promise<void> | void;
    onAuthenticate?: (slabId: number) => void;
}

const CardStatRow: React.FC<{
    item: any;
    isProUnlocked: boolean;
    liveMktTotal: number | null;
    bestGradeOpportunity: number | null;
    marketDetails: any;
    psaRowsStat: any[];
    pwTcgStat: number | null;
    pwCmTStat: number | null;
}> = ({ item, isProUnlocked, liveMktTotal, bestGradeOpportunity, marketDetails, psaRowsStat, pwTcgStat, pwCmTStat }) => {
    const [rowOpen, setRowOpen] = useState(false);
    return (
        <div>
            <div
                className={`bg-white/5 hover:bg-white/[0.08] border ${rowOpen ? 'border-[#D4AF37]/30' : 'border-white/10 hover:border-white/20'} p-3 flex items-center gap-3 transition-all group cursor-pointer`}
                onClick={() => isProUnlocked && setRowOpen(o => !o)}
                title={isProUnlocked ? 'Click to view market data' : undefined}
            >
                <div className="w-9 h-9 overflow-hidden bg-black flex-shrink-0 border border-white/10">
                    <img src={item.thumb} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt={item.name} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-black text-white uppercase italic truncate flex items-center gap-1.5">
                        {item.name}
                        {isProUnlocked && <i className={`fas fa-chevron-${rowOpen ? 'up' : 'down'} text-[7px] text-[#D4AF37]/60`} />}
                    </div>
                    <div className="text-[9px] text-white/30 font-bold uppercase truncate">{item.set} • {item.year}</div>
                </div>
                <div className="flex gap-4 items-center border-l border-white/10 pl-3">
                    <div className="text-center">
                        <div className="text-[11px] font-black text-white/60 leading-none">x{item.count}</div>
                        <div className="text-[8px] text-white/30 font-bold uppercase">Owned</div>
                    </div>
                    <div className="text-center">
                        <div className="text-[11px] font-black text-poke-accent">{item.avgGrade}</div>
                        <div className="text-[8px] text-white/30 font-bold uppercase">Avg</div>
                    </div>
                    <div className="text-center">
                        <div className="text-[11px] font-black leading-none text-white/70">${item.totalValue.toLocaleString()}</div>
                        <div className="text-[8px] text-white/30 font-bold uppercase">Invest.</div>
                    </div>
                    <div className="text-center min-w-[52px]">
                        {isProUnlocked && liveMktTotal != null ? (
                            <>
                                <div className="text-[11px] font-black leading-none" style={{ color: '#D4AF37' }}>${liveMktTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                <div className="text-[8px] text-white/30 font-bold uppercase">Live Mkt</div>
                            </>
                        ) : (
                            <>
                                <div className="text-[11px] text-white/20"><i className="fas fa-lock text-[9px]" /></div>
                                <div className="text-[8px] text-white/20 font-bold uppercase">Live Mkt</div>
                            </>
                        )}
                    </div>
                    <div className="text-center min-w-[52px]">
                        {isProUnlocked && bestGradeOpportunity != null ? (
                            <>
                                <div className="text-[11px] font-black leading-none bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-transparent bg-clip-text">${bestGradeOpportunity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                <div className="text-[8px] text-white/30 font-bold uppercase">PSA 10</div>
                            </>
                        ) : (
                            <>
                                <div className="text-[11px] text-white/20"><i className="fas fa-lock text-[9px]" /></div>
                                <div className="text-[8px] text-white/20 font-bold uppercase">PSA 10</div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Inline market panel */}
            {rowOpen && marketDetails && (
                <div className="border border-[#D4AF37]/20 border-t-0 bg-[#080808] p-3 animate-fade-in">
                    <div className="flex flex-wrap gap-4">
                        <div>
                            <div className="text-[7px] font-black text-[#D4AF37] uppercase tracking-widest mb-0.5">Raw Market</div>
                            <div className="text-sm font-black text-white">
                                ${(marketDetails.prices?.market || marketDetails.prices?.mid || pwTcgStat || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </div>
                        </div>
                        {psaRowsStat.length > 0 && (
                            <div className="flex-1">
                                <div className="text-[7px] font-black text-red-500/70 uppercase tracking-widest mb-1">PSA Grades</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {psaRowsStat.map((r: any) => (
                                        <div key={r.l} className="text-center px-2 py-1 border border-white/10 bg-white/5">
                                            <div className="text-[7px] text-white/40 uppercase">{r.l}</div>
                                            <div className="text-[9px] font-black text-white">${r.v.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {(pwTcgStat || pwCmTStat) && (
                            <div>
                                <div className="text-[7px] font-black text-sky-400/70 uppercase tracking-widest mb-1">Sources</div>
                                <div className="flex gap-1.5">
                                    {pwTcgStat && <div className="px-2 py-1 border border-white/10 bg-white/5">
                                        <div className="text-[7px] text-sky-400/70 uppercase">TCGPlayer</div>
                                        <div className="text-[9px] font-black text-white">${pwTcgStat.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                    </div>}
                                    {pwCmTStat && <div className="px-2 py-1 border border-white/10 bg-white/5">
                                        <div className="text-[7px] text-sky-300/70 uppercase">CardMkt</div>
                                        <div className="text-[9px] font-black text-white">${(pwCmTStat * 1.09).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                    </div>}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
const getImageUrl = (obj: any, type: 'front' | 'back' = 'front') => {
    if (!obj) return '';
    const thumbKey = `${type}_thumb`;
    const imgKey = `${type}_img`;
    const hasKey = `has_${type}_img`;

    if (typeof obj[thumbKey] === 'string' && obj[thumbKey].length > 10) return obj[thumbKey];
    if (typeof obj[imgKey] === 'string' && obj[imgKey].length > 10) return obj[imgKey];

    if (obj[hasKey] === 1 || obj[hasKey] === '1' || obj[hasKey] === true) {
        return `api/collection.php?action=serve_image&id=${obj.id}&type=${type}`;
    }

    return '';
};

const MyCollection: React.FC<MyCollectionProps> = ({ user, onSelect, onRegrade, onOpenDraft, onOpenProfile, onRefreshUser, onAuthenticate }) => {
    const [scans, setScans] = useState<any[]>([]);
    const [showArchived, setShowArchived] = useState(false);
    const [stats, setStats] = useState({
        total_scans: 0,
        total_unique_cards: 0,
        total_value: 0,
        total_investment: 0,
        investment_breakdown: { price: 0, tax: 0, shipping: 0 },
        avg_score: 0,
        total_valuations: 0
    });
    const receiptRef = React.useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('date_scanned');
    const [editingNotes, setEditingNotes] = useState<{ id: string, text: string } | null>(null);
    const [editingRename, setEditingRename] = useState<{
        id: string;
        name: string;
        isFirstEdition: boolean;
        isHolographic: boolean;
        originalName: string;
        originalIsFirstEdition: boolean;
        originalIsHolographic: boolean;
    } | null>(null);
    const [editingSetName, setEditingSetName] = useState<{ id: string, card_set: string, year: string } | null>(null);
    const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
    const [linkingCert, setLinkingCert] = useState<any | null>(null);
    const [linkingSearch, setLinkingSearch] = useState('');
    const [linkingResults, setLinkingResults] = useState<any[]>([]);
    const [badges, setBadges] = useState<any[]>([]);
    const [psaSlabs, setPsaSlabs] = useState<any[]>([]);
    const [unlockedMarketKeys, setUnlockedMarketKeys] = useState<Set<string>>(new Set());

    const handleMarketUnlocked = (cardName: string, cardSet: string) => {
        const key = `${cardName}|${cardSet}`;
        setUnlockedMarketKeys(prev => new Set(prev).add(key));
    };
    const [userRank, setUserRank] = useState<string>('Trainer');
    const [totalBonusScans, setTotalBonusScans] = useState<number>(0);
    const [editingAcquisition, setEditingAcquisition] = useState<any | null>(null);
    const [acqFormData, setAcqFormData] = useState<any>({
        acq_price: '',
        acq_tax: '',
        acq_shipping: '',
        acq_date: '',
        acq_source: '',
        acq_city: '',
        acq_state: '',
        tracking_number: '',
        order_id: '',
        vault_copy: '',
        user_notes: '',
        envelope_receipt_img: undefined as string | undefined
    });
    
    // Plugin Refs
    const numberingPluginRef = useRef<VaultNumberingPluginHandle>(null);
    const psaVaultRef = useRef<PSAVaultPluginHandle>(null);
    const [showPsaVault, setShowPsaVault] = useState(false);
    const displayVaultRef = useRef<DisplayVaultControlPluginHandle>(null);

    const [activeTab, setActiveTab] = useState<'badges' | 'stats' | 'drafts'>('stats');
    const [draftExists, setDraftExists] = useState<boolean | null>(null);
    const [showLedger, setShowLedger] = useState(false);

    // --- 3D viewer modal (three.js) ---
    const [threeDOpen, setThreeDOpen] = useState(false);
    const [threeDBusy, setThreeDBusy] = useState(false);
    const [threeDError, setThreeDError] = useState<string | null>(null);
    const [threeDCertId, setThreeDCertId] = useState<string | null>(null);
    const [threeDFrontTexture, setThreeDFrontTexture] = useState<string | null>(null);
    const [threeDBackTexture, setThreeDBackTexture] = useState<string | null>(null);
    const [threeDHeightGridJson, setThreeDHeightGridJson] = useState<string | null>(null);
    const [threeDHeightGridMeta, setThreeDHeightGridMeta] = useState<any>(null);
    const [threeDShareUrl, setThreeDShareUrl] = useState<string>('');
    const [threeDNeedsGeneration, setThreeDNeedsGeneration] = useState<boolean | null>(null);
    const [threeDIsHolographic, setThreeDIsHolographic] = useState(false);
    const [threeDHoloPattern, setThreeDHoloPattern] = useState<string>('none');
    const [threeDHoloPatternOverride, setThreeDHoloPatternOverride] = useState<string | null>(null);
    const [threeDHoloPatternNeedsReview, setThreeDHoloPatternNeedsReview] = useState(false);
    const [threeDYear, setThreeDYear] = useState<string>('');
    const [threeDCardSet, setThreeDCardSet] = useState<string>('');

    const VALID_HOLO_PATTERNS = ['cosmos', 'galaxy', 'cracked_ice', 'swirl', 'reverse', 'full_art', 'standard', 'none'] as const;
    const normalizeHoloPattern = (value: any): string => {
        const normalized = String(value ?? 'none').toLowerCase().replace(/[\s-]+/g, '_');
        return (VALID_HOLO_PATTERNS as readonly string[]).includes(normalized) ? normalized : 'none';
    };

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
    const inferHoloPatternFromMeta = (meta: {
        is_holographic?: any;
        holo_pattern?: any;
        card_set?: any;
        set?: any;
        rarity?: any;
        edition?: any;
        name?: any;
    }): { pattern: string; needsReview: boolean } => {
        const isHolo = meta?.is_holographic === true || Number(meta?.is_holographic) === 1;
        const rawPattern = normalizeHoloPattern(meta?.holo_pattern);
        if (!isHolo) return { pattern: 'none', needsReview: false };

        const sourceText = [
            meta?.card_set,
            meta?.set,
            meta?.rarity,
            meta?.edition,
            meta?.name,
        ].map(v => String(v ?? '')).join(' ').toLowerCase();

        const inferred = (() => {
            if (/\breverse\b/.test(sourceText)) return 'reverse';
            if (/\b(full[\s_-]*art|alt[\s_-]*art|illustration[\s_-]*rare|special[\s_-]*illustration|rainbow|hyper[\s_-]*rare)\b/.test(sourceText)) return 'full_art';
            if (/\bswirl\b/.test(sourceText)) return 'swirl';
            if (/\bgalaxy|star\b/.test(sourceText)) return 'galaxy';
            if (/\bcosmos|bubble\b/.test(sourceText)) return 'cosmos';
            if (/\bcracked[\s_-]*ice|shatter(ed)?\b/.test(sourceText)) return 'cracked_ice';
            return 'standard';
        })();

        const uncertain = rawPattern === 'none' || rawPattern === 'standard';
        return {
            pattern: uncertain ? inferred : rawPattern,
            needsReview: uncertain,
        };
    };
    const threeDEffectiveHoloPattern = normalizeHoloPattern(
        threeDHoloPatternOverride ?? (threeDIsHolographic ? threeDHoloPattern : 'none')
    );

    const open3DForCert = async (certId: string) => {
        const scan = scans.find((s: any) => s.id === certId);
        const inferredFromScan = inferHoloPatternFromMeta({
            is_holographic: scan?.is_holographic,
            holo_pattern: scan?.holo_pattern,
            card_set: scan?.card_set,
            set: scan?.set,
            rarity: scan?.rarity,
            edition: scan?.edition,
            name: scan?.name,
        });
        const holoFromScan = Boolean(scan?.is_holographic && Number(scan.is_holographic) !== 0);

        setThreeDOpen(true);
        setThreeDError(null);
        setThreeDBusy(true);
        setThreeDShareUrl('');
        setThreeDCertId(certId);
        setThreeDFrontTexture(null);
        setThreeDBackTexture(null);
        setThreeDHeightGridJson(null);
        setThreeDHeightGridMeta(null);
        setThreeDNeedsGeneration(null);
        setThreeDIsHolographic(holoFromScan);
        setThreeDHoloPattern(inferredFromScan.pattern);
        setThreeDHoloPatternOverride(null);
        setThreeDHoloPatternNeedsReview(holoFromScan && inferredFromScan.needsReview);
        setThreeDYear(scan?.year != null ? String(scan.year) : '');
        setThreeDCardSet(scan?.card_set != null ? String(scan.card_set) : '');

        const applyMetaFromJson = (j: any) => {
            const inferred = inferHoloPatternFromMeta({
                is_holographic: j?.is_holographic,
                holo_pattern: j?.holo_pattern,
                card_set: j?.card_set,
                set: j?.set,
                rarity: j?.rarity,
                edition: j?.edition,
                name: j?.name,
            });
            if (typeof j?.is_holographic === 'boolean') setThreeDIsHolographic(j.is_holographic);
            else if (j?.is_holographic != null) setThreeDIsHolographic(Number(j.is_holographic) === 1);
            setThreeDHoloPattern(inferred.pattern);
            setThreeDHoloPatternNeedsReview((typeof j?.is_holographic === 'boolean' ? j.is_holographic : Number(j?.is_holographic) === 1) && inferred.needsReview);
            if (j?.year != null && String(j.year).trim() !== '') setThreeDYear(String(j.year));
            if (j?.card_set != null && String(j.card_set).trim() !== '') setThreeDCardSet(String(j.card_set));
        };

        const runAfterInitialGrid = async (json: any) => {
            applyMetaFromJson(json);
            let front = json.front_texture as string;
            let back = json.back_texture as string;
            const has3d = Boolean(json.has_3d);

            if (!front) throw new Error('Missing front texture for 3D.');
            if (!back) back = front;
            if (back === '') throw new Error('Missing back texture for 3D.');

            if (!has3d) {
                setThreeDNeedsGeneration(true);
                const heightGrid = await generateMicroReliefHeightGrid(front, back, 'Pokemon', { certId });
                if (!heightGrid) throw new Error('AI height grid generation failed.');

                const storeRes = await fetch('api/plugin_3d_card.php?action=store_height_grid', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cert_id: certId,
                        height_grid: heightGrid.height,
                        height_grid_meta: { strength: heightGrid.strength, model: 'gemini-2.5-flash', size: heightGrid.size }
                    })
                });
                const storeJson = await storeRes.json();
                if (!storeJson?.success) throw new Error(storeJson?.error || 'Failed to store 3D data.');

                const refRes = await fetch(`api/plugin_3d_card.php?action=get_height_grid&cert_id=${encodeURIComponent(certId)}`, {
                    credentials: 'include'
                });
                const refJson = await refRes.json();
                if (!refJson?.success) throw new Error(refJson?.error || 'Failed to refresh 3D data');

                applyMetaFromJson(refJson);
                front = refJson.front_texture as string;
                back = refJson.back_texture as string;
                setThreeDHeightGridJson(refJson.height_grid_json as string);
                setThreeDHeightGridMeta(refJson.height_grid_meta ?? null);
            } else {
                setThreeDNeedsGeneration(false);
                setThreeDHeightGridJson(json.height_grid_json as string);
                setThreeDHeightGridMeta(json.height_grid_meta ?? null);
            }

            setThreeDFrontTexture(front);
            setThreeDBackTexture(back);
        };

        try {
            const fetchGrid = async () => {
                let res = await fetch(`api/plugin_3d_card.php?action=get_height_grid&cert_id=${encodeURIComponent(certId)}`, {
                    credentials: 'include'
                });
                if (res.status === 401) {
                    const sessionRes = await fetch('api/auth.php?action=check_session', { credentials: 'include' });
                    const sessionJson = await sessionRes.json();
                    if (!sessionRes.ok || !sessionJson?.success) {
                        throw new Error('Your session expired. Please sign in again to use 3D.');
                    }
                    res = await fetch(`api/plugin_3d_card.php?action=get_height_grid&cert_id=${encodeURIComponent(certId)}`, {
                        credentials: 'include'
                    });
                    if (res.status === 401) {
                        throw new Error('Session is not authorized for 3D. Please sign in again.');
                    }
                }
                return res.json();
            };

            const json = await fetchGrid();
            if (!json?.success) throw new Error(json?.error || 'Failed to load 3D data');
            await runAfterInitialGrid(json);
        } catch (e: any) {
            setThreeDError(e?.message || String(e));
        } finally {
            setThreeDBusy(false);
        }
    };

    const create3DShareLink = async () => {
        if (!threeDCertId) return;
        setThreeDError(null);
        setThreeDBusy(true);
        try {
            const res = await fetch(`api/plugin_3d_card.php?action=create_share_token&cert_id=${encodeURIComponent(threeDCertId)}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cert_id: threeDCertId })
            });
            const json = await res.json();
            if (!json?.success) throw new Error(json?.error || 'Share token failed');
            const token = json.token as string;
            const url = `${window.location.origin}/?card3d=${encodeURIComponent(token)}`;
            setThreeDShareUrl(url);
        } catch (e: any) {
            setThreeDError(e?.message || String(e));
        } finally {
            setThreeDBusy(false);
        }
    };

    const regenerate3DForCert = async (certId: string) => {
        // Force overwrite: always regenerate micro-relief and replace stored 3D.
        const prevFront = threeDFrontTexture;
        const prevBack = threeDBackTexture;
        const prevGrid = threeDHeightGridJson;
        const prevMeta = threeDHeightGridMeta;
        const prevNeeds = threeDNeedsGeneration;

        setThreeDError(null);
        setThreeDBusy(true);
        setThreeDNeedsGeneration(true);

        // Show the loading state immediately.
        setThreeDFrontTexture(null);
        setThreeDBackTexture(null);
        setThreeDHeightGridJson(null);
        setThreeDHeightGridMeta(null);
        setThreeDCertId(certId);

        try {
            // Re-fetch textures so "back" uses the latest remove.bg cut-out (back_thumb) if available.
            let res = await fetch(`api/plugin_3d_card.php?action=get_height_grid&cert_id=${encodeURIComponent(certId)}`, {
                credentials: 'include'
            });
            if (res.status === 401) {
                try {
                    const sessionRes = await fetch('api/auth.php?action=check_session', { credentials: 'include' });
                    const sessionJson = await sessionRes.json();
                    if (!sessionRes.ok || !sessionJson?.success) {
                        throw new Error('Your session expired. Please sign in again to regenerate 3D.');
                    }
                    res = await fetch(`api/plugin_3d_card.php?action=get_height_grid&cert_id=${encodeURIComponent(certId)}`, {
                        credentials: 'include'
                    });
                    if (res.status === 401) {
                        throw new Error('Session is not authorized for 3D. Please sign in again.');
                    }
                } catch (sessionErr: any) {
                    throw new Error(sessionErr?.message || 'Authentication required for 3D regeneration.');
                }
            }

            const json = await res.json();
            if (!json?.success) throw new Error(json?.error || 'Failed to load 3D textures');

            let front = json.front_texture as string;
            let back = json.back_texture as string;

            if (!front) throw new Error('Missing front texture for 3D.');
            if (!back) back = front;
            if (back === '') throw new Error('Missing back texture for 3D.');

            // Auto-remove backdrop for missing cutouts so regen quality is consistent.
            // remove.bg costs 1 Pro Credit per call (front and back are separate calls in this implementation).
            if (!json.has_front_thumb) {
                const cutFront = await fetch('api/plugin_remove_bg.php', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cert_id: certId, sides: ['front'], format: 'png' }),
                });
                const cutFrontJson = await cutFront.json().catch(() => ({}));
                if (!cutFront.ok || !cutFrontJson?.success) {
                    throw new Error(cutFrontJson?.error || 'remove.bg front cut-out failed.');
                }
            }
            if (!json.has_back_thumb) {
                const cutBack = await fetch('api/plugin_remove_bg.php', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cert_id: certId, sides: ['back'], format: 'png' }),
                });
                const cutBackJson = await cutBack.json().catch(() => ({}));
                if (!cutBack.ok || !cutBackJson?.success) {
                    throw new Error(cutBackJson?.error || 'remove.bg back cut-out failed.');
                }
            }

            // Refresh textures again after remove.bg updates thumbs.
            if (!json.has_front_thumb || !json.has_back_thumb) {
                const refRes = await fetch(`api/plugin_3d_card.php?action=get_height_grid&cert_id=${encodeURIComponent(certId)}`, {
                    credentials: 'include'
                });
                const refJson = await refRes.json();
                if (!refJson?.success) throw new Error(refJson?.error || 'Failed to refresh textures after remove.bg');
                front = refJson.front_texture as string;
                back = refJson.back_texture as string;
            }

            // Update holo preset data (for v3 foil) from API response if present.
            const inferred = inferHoloPatternFromMeta({
                is_holographic: json?.is_holographic,
                holo_pattern: json?.holo_pattern,
                card_set: json?.card_set,
                set: json?.set,
                rarity: json?.rarity,
                edition: json?.edition,
                name: json?.name,
            });
            if (typeof json?.is_holographic === 'boolean') setThreeDIsHolographic(json.is_holographic);
            else if (json?.is_holographic != null) setThreeDIsHolographic(Number(json.is_holographic) === 1);
            setThreeDHoloPattern(inferred.pattern);
            setThreeDHoloPatternNeedsReview((typeof json?.is_holographic === 'boolean' ? json.is_holographic : Number(json?.is_holographic) === 1) && inferred.needsReview);
            if (json?.year != null) setThreeDYear(String(json.year));
            if (json?.card_set != null) setThreeDCardSet(String(json.card_set));

            const heightGrid = await generateMicroReliefHeightGrid(front, back, 'Pokemon', { certId });
            if (!heightGrid) throw new Error('AI height grid generation failed.');

            const storeRes = await fetch('api/plugin_3d_card.php?action=store_height_grid', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cert_id: certId,
                    height_grid: heightGrid.height,
                    height_grid_meta: { strength: heightGrid.strength, model: 'gemini-2.5-flash', size: heightGrid.size },
                    force: true
                })
            });
            const storeJson = await storeRes.json();
            if (!storeJson?.success) throw new Error(storeJson?.error || 'Failed to overwrite 3D data.');

            const refRes = await fetch(`api/plugin_3d_card.php?action=get_height_grid&cert_id=${encodeURIComponent(certId)}`, {
                credentials: 'include'
            });
            const refJson = await refRes.json();
            if (!refJson?.success) throw new Error(refJson?.error || 'Failed to refresh 3D data after regeneration');

            setThreeDFrontTexture(refJson.front_texture as string);
            setThreeDBackTexture(refJson.back_texture as string);
            setThreeDHeightGridJson(refJson.height_grid_json as string);
            setThreeDHeightGridMeta(refJson.height_grid_meta ?? null);
            setThreeDNeedsGeneration(false);
        } catch (e: any) {
            setThreeDError(e?.message || String(e));
            // Restore previous viewer so we don't leave the modal blank on failure.
            setThreeDFrontTexture(prevFront);
            setThreeDBackTexture(prevBack);
            setThreeDHeightGridJson(prevGrid);
            setThreeDHeightGridMeta(prevMeta);
            setThreeDNeedsGeneration(prevNeeds ?? false);
        } finally {
            setThreeDBusy(false);
        }
    };

    // Bulk Edit State
    const [isBulkMode, setIsBulkMode] = useState(false);
    const [selectedCerts, setSelectedCerts] = useState<Set<string>>(new Set());

    const toggleStack = (id: string) => {
        setExpandedStacks(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const fetchCollection = async () => {
        setLoading(true);
        setScans([]); // Clear previous scans
        try {
            const url = `api/collection.php?user_id=${user.id}&q=${encodeURIComponent(search)}&sort=${sort}&stream=1${showArchived ? '&archived=1' : ''}`;
            const response = await fetch(url, { credentials: 'include' });

            if (!response.body) throw new Error("ReadableStream not supported");

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");

                // Keep the last partial line in the buffer
                buffer = lines.pop() || "";

                if (lines.length > 0) {
                    const newScans = lines
                        .filter(line => line.trim() !== "")
                        .map(line => {
                            try { return JSON.parse(line); } catch (e) { return null; }
                        })
                        .filter(Boolean); // Remove nulls/errors

                    setScans(prev => {
                        if (prev.length === 0 && newScans.length > 0) setLoading(false);
                        return [...prev, ...newScans];
                    });
                }
            }

            // Process any remaining buffer
            if (buffer.trim() !== "") {
                try {
                    const lastScan = JSON.parse(buffer);
                    setScans(prev => [...prev, lastScan]);
                } catch (e) { /* ignore partial/bad end */ }
            }

            // Ensure loading is false even if empty result
            setLoading(false);

            // Fetch Stats AFTER or concurrently (independent)
            const statsResp = await fetch(`api/collection.php?action=stats&user_id=${user.id}`);
            const statsData = await statsResp.json();
            if (statsData && !statsData.error) {
                setStats(statsData);
            }

        } catch (e) {
            console.error("Failed to fetch collection stream", e);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateNotes = async () => {
        if (!editingNotes) return;
        try {
            await fetch('api/collection.php?action=update_notes&user_id=' + user.id, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: editingNotes.id, notes: editingNotes.text })
            });
            setEditingNotes(null);
            fetchCollection();
        } catch (e) {
            console.error("Note update failed", e);
        }
    };

    const handleRename = async () => {
        if (!editingRename) return;
        try {
            const id = editingRename.id;
            const nameChanged = editingRename.name !== editingRename.originalName;
            const tagsChanged =
                editingRename.isFirstEdition !== editingRename.originalIsFirstEdition ||
                editingRename.isHolographic !== editingRename.originalIsHolographic;

            let nameChangedAt: string | undefined;

            if (nameChanged) {
                const resp = await fetch('api/collection.php?action=rename_cert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, new_name: editingRename.name })
                });
                const result = await resp.json();
                if (!result.success) {
                    alert('Rename failed: ' + result.error);
                    return;
                }
                const lastHistory = Array.isArray(result?.name_history) && result.name_history.length > 0
                    ? result.name_history[result.name_history.length - 1]
                    : null;
                nameChangedAt = lastHistory?.changed_at;
            }

            if (tagsChanged) {
                const resp = await fetch('api/collection.php?action=bulk_update', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ids: [id],
                        updates: {
                            is_first_edition: editingRename.isFirstEdition ? 1 : 0,
                            is_holographic: editingRename.isHolographic ? 1 : 0
                        }
                    })
                });
                const result = await resp.json();
                if (!result.success) {
                    alert('Tag update failed: ' + result.error);
                    return;
                }
            }

            setScans(prev => prev.map(s => {
                if (s.id !== id) return s;
                const updated: any = { ...s };

                if (nameChanged) {
                    updated.name = editingRename.name;
                    if (nameChangedAt) updated.name_updated_at = nameChangedAt;
                }
                if (tagsChanged) {
                    updated.is_first_edition = editingRename.isFirstEdition ? 1 : 0;
                    updated.is_holographic = editingRename.isHolographic ? 1 : 0;
                }
                return updated;
            }));

            // Keep the 3D viewer in sync if it's currently open for this card.
            if (tagsChanged && threeDOpen && threeDCertId && String(threeDCertId) === String(id)) {
                setThreeDIsHolographic(editingRename.isHolographic);
                setThreeDHoloPatternOverride(null);
            }

            setEditingRename(null);
        } catch (e) {
            console.error("Rename failed", e);
            alert("Rename failed. Please try again.");
        }
    };

    const handleSetNameUpdate = async () => {
        if (!editingSetName) return;
        try {
            const resp = await fetch('api/collection.php?action=bulk_update', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [editingSetName.id], updates: { card_set: editingSetName.card_set, year: editingSetName.year || null } })
            });
            const result = await resp.json();
            if (result.success) {
                setScans(prev => prev.map(s => s.id === editingSetName.id ? { ...s, card_set: editingSetName.card_set, year: editingSetName.year || null } : s));
                setEditingSetName(null);
            } else {
                alert('Set name update failed: ' + result.error);
            }
        } catch (e) {
            console.error("Set name update failed", e);
            alert("Set name update failed. Please try again.");
        }
    };

    const handleBulkAction = async (actionType: 'mark_1st' | 'unmark_tags' | 'mark_holo' | 'change_set' | 'hide' | 'unhide') => {
        if (selectedCerts.size === 0) return;

        // Handle hide/unhide via privacy API
        if (actionType === 'hide' || actionType === 'unhide') {
            const hideVal = actionType === 'hide' ? 1 : 0;
            const confirmMsg = actionType === 'hide'
                ? `Hide ${selectedCerts.size} certificate(s) from Public Archive? (Will still count in your stats)`
                : `Show ${selectedCerts.size} certificate(s) in Public Archive?`;
            
            if (!confirm(confirmMsg)) return;

            try {
                const resp = await fetch('api/privacy.php?action=bulk_hide', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: Array.from(selectedCerts), hide: hideVal })
                });
                const result = await resp.json();
                if (result.success) {
                    setSelectedCerts(new Set());
                    setIsBulkMode(false);
                    fetchCollection();
                } else {
                    alert('Bulk hide failed: ' + result.error);
                }
            } catch (e) {
                console.error('Bulk hide failed', e);
                alert('Bulk hide failed. Check connection.');
            }
            return;
        }

        // Handle other bulk actions (mark 1st, change set, etc.)
        let updates: any = {};
        if (actionType === 'mark_1st') updates.is_first_edition = 1;
        if (actionType === 'mark_holo') updates.is_holographic = 1;
        if (actionType === 'unmark_tags') { updates.is_first_edition = 0; updates.is_holographic = 0; }
        if (actionType === 'change_set') {
            const newSet = prompt(`Enter new set name for ${ selectedCerts.size } items: `);
            if (newSet === null) return;
            updates.card_set = newSet;
        }

        try {
            const resp = await fetch('api/collection.php?action=bulk_update', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedCerts), updates })
            });
            const result = await resp.json();

            if (result.success) {
                setScans(prev => prev.map(s => {
                    if (selectedCerts.has(s.id)) {
                        return { ...s, ...updates };
                    }
                    return s;
                }));
                setSelectedCerts(new Set());
                if (actionType === 'change_set') setIsBulkMode(false);
            } else {
                alert('Bulk update failed: ' + result.error);
            }
        } catch (e) {
            console.error("Bulk update failed", e);
            alert("Bulk update failed. Check connection.");
        }
    };

    const handleDownloadReceipt = async (scan: any) => {
        // 1. Populate data for receipt rendering
        setEditingAcquisition(scan);
        setAcqFormData({
            acq_price: scan.acq_price || '',
            acq_tax: scan.acq_tax || '',
            acq_shipping: scan.acq_shipping || '',
            acq_date: scan.acq_date || '',
            acq_source: scan.acq_source || '',
            acq_city: scan.acq_city || '',
            acq_state: scan.acq_state || '',
            tracking_number: scan.tracking_number || '',
            order_id: scan.order_id || '',
            user_notes: scan.user_notes || '',
            envelope_receipt_img: scan.envelope_receipt_img || undefined
        });

        // 2. Wait for render (short delay for DOM update)
        setTimeout(async () => {
            if (receiptRef.current) {
                try {
                    const html2canvas = (await import('html2canvas')).default;
                    const canvas = await html2canvas(receiptRef.current, {
                        scale: 2,
                        useCORS: true,
                        backgroundColor: '#ffffff',
                        logging: false,
                        width: 800
                    });
                    const link = document.createElement('a');
                    link.download = `RawGraded - RECEIPT - ${ scan.id.substring(0, 8).toUpperCase() }.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                } catch (error) {
                    console.error("Receipt generation failed", error);
                } finally {
                    // Close the "background" modal state
                    setEditingAcquisition(null);
                }
            }
        }, 300);
    };

    const handleBulkPrint = () => {
        // Create a hidden iframe for printing
        const iframe = document.createElement('iframe');
        iframe.id = 'bulk-print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.top = '0';
        iframe.style.left = '0';
        iframe.style.width = '100vw';
        iframe.style.height = '100vh';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        iframe.style.zIndex = '-9999';
        document.body.appendChild(iframe);

        const printDoc = iframe.contentWindow?.document;
        if (!printDoc) return;

        // Collect "latest" scans only
        const printableScans = scans.filter(s => s.overall_grade && (parseInt(s.child_count) === 0 || s.child_count === 0));

        if (printableScans.length === 0) {
            alert("No graded cards to print!");
            document.body.removeChild(iframe);
            return;
        }

        // Generate the HTML for all slips
        const slipsHtml = printableScans.map(scan => {
            const slipData = {
                id: scan.id,
                metadata: {
                    name: scan.name,
                    character: scan.character_name || scan.character || '',
                    set: scan.card_set,
                    year: scan.year,
                    artist: scan.artist || '',
                },
                dateScanned: scan.date_scanned,
                userTwitter: scan.user_twitter || scan.x_username || 'RawGraded',
                isAlliance: !!scan.is_alliance,
                isPck: !!scan.is_pck,
                userRole: scan.user_role
            };

            const gradingResult = {
                overall: scan.overall_grade,
                centering: scan.centering,
                corners: scan.corners,
                edges: scan.edges,
                surface: scan.surface
            };

            return `< div class="slip-wrapper" > <div>${renderToString(<SlabSlip data={slipData as any} finalGrade={gradingResult as any} />)}</div></div > `;
        }).join('');

        const html = `
    < !DOCTYPE html >
        <html>
            <head>
                <title>RawGraded Bulk Slab Slips</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
                    <style>
                        @page {
                            size: 8.5in 11in;
                        margin: 0;
                        }
                        @media print {
                            body {margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        .print-grid {
                            display: block;
                        width: 7.5in; /* 3 slips x 2.5in each = 7.5in */
                        margin: 0 auto; /* Center on 8.5in page */
                        padding-top: 0.2in;
                        font-size: 0; /* Remove whitespace between inline-block elements */
                        line-height: 0;
                            }
                        .slip-wrapper {
                            display: inline-block;
                        width: 2.5in;
                        height: 3.5in;
                        vertical-align: top;
                        page-break-inside: avoid;
                        margin: 0;
                        padding: 0;
                            }
                            .slip-wrapper > div {
                            transform: scale(0.32);
                        transform-origin: top left;
                        width: 750px;
                        height: 1050px;
                            }
                         }
                        body {
                            font - family: sans-serif;
                        background: white;
                        color: black;
                        margin: 0;
                        padding: 0;
                        }
                        .print-grid {
                            padding: 0.5in;
                        }
                        .slip-wrapper {
                            display: inline-block;
                        width: 2.5in;
                        height: 3.5in;
                        margin: 0;
                        }
                        /* Extra Tailwind overrides to ensure print colors work */
                        .bg-black {background - color: black !important; }
                        .text-white {color: white !important; }
                        .bg-white {background - color: white !important; }
                        .border-black {border - color: black !important; }
                    </style>
            </head>
            <body>
                <div class="print-grid">
                    ${slipsHtml}
                </div>
                <script>
                    window.addEventListener('load', () => {
                        setTimeout(() => {
                            window.print();
                            setTimeout(() => {
                                window.parent.document.body.removeChild(window.frameElement);
                            }, 1000);
                        }, 2000);
                    });
                </script>
            </body>
        </html>
`;

        printDoc.open();
        printDoc.write(html);
        printDoc.close();
    };

    const handleUpdateAcquisition = async () => {
        if (!editingAcquisition) return;
        try {
            // Build the payload
            const payload: any = {
                action: 'update_valuation',
                cert_id: editingAcquisition.id,
                acq_price: parseFloat(acqFormData.acq_price) || 0,
                acq_tax: parseFloat(acqFormData.acq_tax) || 0,
                acq_shipping: parseFloat(acqFormData.acq_shipping) || 0,
                acq_date: acqFormData.acq_date,
                acq_source: acqFormData.acq_source,
                acq_city: acqFormData.acq_city,
                acq_state: acqFormData.acq_state,
                user_notes: acqFormData.user_notes,
                tracking_number: acqFormData.tracking_number,
                order_id: acqFormData.order_id,
                vault_copy: acqFormData.vault_copy !== '' ? acqFormData.vault_copy : null,
                estimated_value: editingAcquisition.estimated_value || 0, // Keep existing estimated_value
            };

            // If we have an image string from the OCR scanner, attach it
            if (acqFormData.envelope_receipt_img) {
                payload.envelope_receipt_img = acqFormData.envelope_receipt_img;
            }

            const response = await fetch('api/collection.php?action=update_valuation', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (result.success) {
                setEditingAcquisition(null);
                fetchCollection();
            } else {
                alert("Update failed: " + result.error);
            }
        } catch (e) {
            console.error("Acquisition update failed", e);
        }
    };

    const handleClearValuations = async () => {
        if (!editingAcquisition) return;
        if (!confirm("Are you sure you want to clear AI valuations for this asset? This cannot be undone, though acquisition data will remain intact.")) return;

        try {
            const response = await fetch('api/collection.php?action=clear_valuations', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'clear_valuations',
                    id: editingAcquisition.id
                })
            });
            const result = await response.json();
            if (result.success) {
                setEditingAcquisition(null);
                fetchCollection();
            } else {
                alert("Clear failed: " + result.error);
            }
        } catch (e) {
            console.error("Clear valuations failed", e);
        }
    };

    const handleManualLink = async (targetId: string, parentId: string | null) => {
        if (parentId && targetId === parentId) {
            alert("Cannot link a certificate to itself.");
            return;
        }
        try {
            const resp = await fetch('api/collection.php?action=update_parent', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_parent',
                    id: targetId,
                    parent_id: parentId
                })
            });
            const result = await resp.json();
            if (result.success) {
                setLinkingCert(null);
                fetchCollection(); // Refresh
            } else {
                alert("Linking failed: " + result.error);
            }
        } catch (e) {
            console.error("Linking failed", e);
        }
    };

    const handleEnvelopeExtracted = (data: any) => {
        setAcqFormData((prev: any) => {
            const noteParts: string[] = [];
            if (data.cardCount) noteParts.push(`Card Count: ${ data.cardCount } `);

            const appendedNote = noteParts.length
                ? (prev.user_notes ? `${ prev.user_notes } \n${ noteParts.join(' | ') } ` : noteParts.join(' | '))
                : prev.user_notes;

            return {
                ...prev,
                acq_city: data.city || prev.acq_city,
                acq_state: data.state || prev.acq_state,
                tracking_number: data.trackingNumber || prev.tracking_number,
                order_id: data.orderId || prev.order_id,
                acq_source: data.source || prev.acq_source,
                user_notes: appendedNote,
                envelope_receipt_img: data.imageDataUrl || undefined // Store the base64 image if user toggled it
            };
        });
    };

    const handleAdminReset = async (certId: string, mode: 'selective' | 'complete') => {
        if (!confirm(`ADMIN: Are you sure you want to ${ mode === 'complete' ? 'COMPLETELY DISSOLVE' : 'BREAK' } this chain ? `)) return;
        try {
            const resp = await fetch('api/collection.php?action=admin_reset_links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: certId, mode })
            });
            const result = await resp.json();
            if (result.success) {
                setLinkingCert(null);
                fetchCollection();
            } else {
                alert("Admin reset failed: " + result.error);
            }
        } catch (e) {
            console.error("Admin reset error", e);
        }
    };

    const fetchBadges = async () => {
        try {
            // 1. Trigger blocking badge sync/check for first load
            await fetch('api/badges.php?action=check').catch(() => { });

            // 2. Fetch the actual list
            const res = await fetch('api/badges.php?action=list&mode=user');
            if (!res.ok) throw new Error(`HTTP ${ res.status } `);

            const data = await res.json();
            const earnedBadges = data.badges || [];
            setBadges(earnedBadges);

            // Calculate rank based on earned badges
            const ranks = earnedBadges.map((b: any) => b.rank_level);
            if (ranks.includes('Master')) setUserRank('Master');
            else if (ranks.includes('Leader')) setUserRank('Leader');
            else setUserRank('Trainer');

            // Sum bonus scans from earned badges correctly
            const total = earnedBadges.reduce((sum: number, b: any) => sum + (parseInt(b.bonus_scans) || 0), 0);
            setTotalBonusScans(total);
        } catch (err) {
            console.error('Failed to fetch badges', err);
        }
    };

    useEffect(() => {
        fetchCollection();
        fetchBadges();
    }, [search, sort, showArchived]);

    useEffect(() => {
        if (activeTab !== 'drafts') return;
        let cancelled = false;
        setDraftExists(null);
        fetch('api/drafts.php?action=get', { credentials: 'include' })
            .then(res => res.json())
            .then((data: { draft?: string | null }) => {
                if (!cancelled) setDraftExists(!!(data.draft && typeof data.draft === 'string' && data.draft.length > 2));
            })
            .catch(() => { if (!cancelled) setDraftExists(false); });
        return () => { cancelled = true; };
    }, [activeTab]);

    useEffect(() => {
        if (!linkingCert || linkingSearch.length > 0) return;

        // Auto-search for matches on modal open
        fetch(`api/collection.php?action=suggest_parents&id=${linkingCert.id}&user_id=${user.id}`)
            .then(r => r.json())
            .then(data => setLinkingResults(Array.isArray(data) ? data : []));
    }, [linkingCert]);

    useEffect(() => {
        if (linkingSearch.length > 2) {
            const delayDebounceFn = setTimeout(() => {
                fetch(`api/collection.php?user_id=${user.id}&q=${encodeURIComponent(linkingSearch)}`)
                    .then(r => r.json())
                    .then(data => setLinkingResults(Array.isArray(data) ? data.filter(s => s.id !== linkingCert?.id) : []));
            }, 300);
            return () => clearTimeout(delayDebounceFn);
        } else if (linkingSearch.length === 0 && linkingCert) {
            // Re-trigger auto-search if cleared
            fetch(`api/collection.php?action=suggest_parents&id=${linkingCert.id}&user_id=${user.id}`)
                .then(r => r.json())
                .then(data => setLinkingResults(Array.isArray(data) ? data : []));
        }
    }, [linkingSearch]);

    // --- Grouping Logic ---
    // A card is a "Head" if no other card in the list has it as a parent
    // We group previous scans under their respective heads
    const getGroupedScans = () => {
        // Map of id -> [previous scans]
        const heads: any[] = [];
        const parentIds = new Set(scans.map((s: any) => s.parent_id).filter(Boolean));

        // A "Head" is a card that is not anybody's parent in the current set
        // (i.e. it's the latest version we have)
        scans.forEach((scan: any) => {
            if (!parentIds.has(scan.id)) {
                heads.push(scan);
            }
        });

        // Second pass: recursively find ancestors for each head
        const findAncestors = (parentId: string): any[] => {
            if (!parentId) return [];
            const ancestors = scans.filter(s => s.id === parentId);
            if (ancestors.length === 0) return [];
            const ancestor = ancestors[0];
            return [ancestor, ...findAncestors(ancestor.parent_id)];
        };

        return heads.map((head: any) => ({
            ...head,
            history: findAncestors(head.parent_id)
        }));
    };

    const groupedScans = getGroupedScans();

    // --- Inventory Stats Logic ---
    const getCardInventory = () => {
        const inventory: Record<string, {
            name: string;
            set: string;
            year: string;
            number: string;
            count: number;
            totalValue: number;
            avgGrade: number;
                gradeCount: number;
            thumb: string;
            scans: any[];
        }> = {};

        // Helper to normalize year strings (e.g. "1999-2000" -> "2000")
        const normalizeYear = (yearStr: string) => {
            if (!yearStr) return '';
            // Handle ranges: take the last year in the range
            const parts = yearStr.split(/[-–—]/);
            return parts[parts.length - 1].trim();
        };

        groupedScans.forEach(scan => {
            const normYear = normalizeYear(scan.year);
            // Create a unique key for grouping (Case-insensitive)
            const key = `${ scan.name }| ${ scan.card_set }| ${ normYear }| ${ scan.card_number || '' } `.toLowerCase().trim();

            if (!inventory[key]) {
                inventory[key] = {
                    name: scan.name,
                    set: scan.card_set,
                    year: normYear, // Use normalized year for the display in inventory too
                    number: scan.card_number || 'N/A',
                    count: 0,
                    totalValue: 0,
                    avgGrade: 0,
                        gradeCount: 0,
                    thumb: getImageUrl(scan, 'front'),
                    scans: []
                };
            }

            const item = inventory[key];
            item.count += 1;
            item.totalValue += parseFloat(scan.estimated_value || '0');
                if (scan.overall_grade !== null && scan.overall_grade !== undefined && scan.overall_grade !== '') {
                    item.avgGrade += parseFloat(scan.overall_grade || '0');
                    item.gradeCount += 1;
                }
            item.scans.push(scan);
        });

        // Final calculation for averages
        Object.values(inventory).forEach(item => {
                item.avgGrade = item.gradeCount > 0 ? Math.round((item.avgGrade / item.gradeCount) * 2) / 2 : 0;
        });

        return Object.values(inventory).sort((a, b) => b.totalValue - a.totalValue);
    };

    const cardInventory = getCardInventory();

    return (
        <div className="w-full max-w-7xl mx-auto p-6 animate-fade-in space-y-8">
            {/* Badges & Rank Section */}
            <div className="relative overflow-hidden bg-[#080808] border border-white/10 p-8">
                <div className="absolute -top-24 -right-24 w-64 h-64 bg-red-600/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none"></div>

                <div className="relative z-10 flex flex-col md:flex-row gap-8 items-center md:items-stretch">
                    <div className="flex flex-col p-6 bg-black/40 border border-white/10 min-w-[240px] text-center">
                        <div className="flex flex-col items-center mb-4">
                            <div className="relative mb-3">
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center border-4 shadow ${
                                    userRank === 'Master' ? 'border-purple-500 bg-purple-50' :
                                    userRank === 'Leader' ? 'border-white/30 bg-white/5' :
                                    'border-red-600 bg-red-600/10'
                                }`}>
                                    <i className={`fas fa-user-shield text-2xl ${
                                        userRank === 'Master' ? 'text-purple-600' :
                                        userRank === 'Leader' ? 'text-white/70' :
                                        'text-red-600'
                                    }`}></i>
                                </div>
                                <div className="absolute -bottom-2 right-0 bg-red-600 text-white text-[8px] font-black px-1.5 py-0.5 uppercase">
                                    LVL {badges.length}
                                </div>
                            </div>
                            <h2 className="text-xl font-black text-white uppercase tracking-widest mb-0.5">{userRank}</h2>
                            <p className="text-[8px] text-white/30 font-bold uppercase tracking-widest leading-none">Vault Status</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-4">
                            <div className="space-y-1">
                                <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block">Physical</span>
                                <span className="text-sm font-black text-white leading-none">{stats.total_unique_cards}</span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block">Audits</span>
                                <span className="text-sm font-black text-white leading-none">{stats.total_scans}</span>
                            </div>
                        </div>

                                <div className="mt-4">
                            <button
                                onClick={() => setShowLedger(true)}
                                className="w-full py-2 bg-white/5 border border-white/10 text-[10px] font-black uppercase text-white/60 tracking-[0.15em] hover:bg-white hover:text-black transition-all shadow flex items-center justify-center gap-2 group"
                            >
                                <i className="fas fa-file-invoice-dollar group-hover:scale-110 transition-transform"></i> View Insurance Ledger
                            </button>
                        </div>

                                <div className="mt-3">
                                    <CollectOnlyModePlugin
                                        freeCredits={Math.max(0, (user.scan_limit || 0) - (user.scans_this_week || 0))}
                                        paidCredits={user.paid_credits || 0}
                                        onUpgradeClick={onOpenProfile}
                                        onDone={fetchCollection}
                                        onRefreshUser={onRefreshUser}
                                    />
                                </div>

                        <div className="mt-4 pt-4 border-t border-white/10 group relative cursor-help">
                            <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block mb-1">Vault Investment</span>
                            <span className="text-lg font-black leading-none" style={{color:'#D4AF37'}}>${(stats.total_investment || 0).toLocaleString()}</span>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-40 bg-white text-gray-900 text-[10px] p-3 rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 border border-silver shadow-xl">
                                <div className="space-y-2">
                                    <div className="flex justify-between border-b border-silver pb-1">
                                        <span className="text-gray-500 font-bold uppercase text-[8px]">Est. Value</span>
                                        <span className="font-black leading-none" style={{color:'#D4AF37'}}>${(stats.total_value || 0).toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-500 font-bold uppercase text-[8px]">Avg Grade</span>
                                        <span className="font-black text-poke-accent">{stats.avg_score}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 space-y-4">
                        <div className="flex justify-between items-center border-b border-white/10 pb-2">
                            <div className="flex gap-6">
                                <button
                                    onClick={() => setActiveTab('stats')}
                                    className={`text-sm font-black uppercase tracking-widest flex items-center gap-2 pb-2 transition-all relative ${activeTab === 'stats' ? 'text-[#D4AF37]' : 'text-white/40 hover:text-white'}`}
                                >
                                    <i className="fas fa-chart-pie text-xs"></i> Card Stats
                                    {activeTab === 'stats' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#D4AF37] animate-fade-in"></div>}
                                </button>
                                <button
                                    onClick={() => setActiveTab('badges')}
                                    className={`text-sm font-black uppercase tracking-widest flex items-center gap-2 pb-2 transition-all relative ${activeTab === 'badges' ? 'text-red-500' : 'text-white/40 hover:text-white'}`}
                                >
                                    <i className="fas fa-medal text-xs"></i> Achievement Vault
                                    {activeTab === 'badges' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-red-500 animate-fade-in"></div>}
                                </button>
                                <button
                                    onClick={() => setActiveTab('drafts')}
                                    className={`text-sm font-black uppercase tracking-widest flex items-center gap-2 pb-2 transition-all relative ${activeTab === 'drafts' ? 'text-yellow-400' : 'text-white/40 hover:text-white'}`}
                                >
                                    <i className="fas fa-file-alt text-xs"></i> Drafts
                                    {activeTab === 'drafts' && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-yellow-400 animate-fade-in"></div>}
                                </button>
                            </div>
                            <span className="text-[10px] text-white/30 font-bold uppercase">
                                {activeTab === 'badges' ? `${badges.length} Earned` : activeTab === 'stats' ? `${cardInventory.length} Unique Asset Types` : 'Draft'}
                            </span>
                        </div>

                        {activeTab === 'drafts' ? (
                            <div className="animate-fade-in">
                                {draftExists === null && <p className="text-sm text-gray-500 py-4">Checking for draft…</p>}
                                {draftExists === false && (
                                    <div className="py-12 text-center bg-[#0a0a0a] rounded-xl border-2 border-dashed border-white/20">
                                        <i className="fas fa-file-alt text-4xl text-white/30 mb-3"></i>
                                        <p className="text-sm font-bold text-white/50">No draft</p>
                                        <p className="text-xs text-white/30 mt-1">Save a draft from the analysis screen to resume later.</p>
                                    </div>
                                )}
                                {draftExists === true && onOpenDraft && (
                                    <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-xl p-6">
                                        <p className="text-sm font-bold text-amber-500 mb-2">You have a saved draft</p>
                                        <p className="text-xs text-amber-500/70 mb-4">Resume your analysis and finish saving your certificate.</p>
                                        <button onClick={onOpenDraft} className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-black rounded-xl font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                                            <i className="fas fa-external-link-alt"></i> Open draft
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : activeTab === 'badges' ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 animate-fade-in">
                                {badges.map((badge) => (
                                    <div key={badge.id} className="group relative bg-white/5 hover:bg-white/10 border-2 border-white/10 hover:border-white/30 rounded-xl p-4 transition-all duration-300 shadow-sm">
                                        <div className="relative w-12 h-12 mx-auto mb-3">
                                            {badge.icon_url ? (
                                                <img src={badge.icon_url} alt={badge.name} className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(255,215,0,0.3)] group-hover:scale-110 transition-transform" />
                                            ) : (
                                                <div className="w-full h-full bg-red-600/10 flex items-center justify-center border border-red-600/20">
                                                    <i className="fas fa-medal text-red-600"></i>
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-center">
                                            <div className="text-white font-black text-[10px] uppercase truncate mb-0.5">{badge.name}</div>
                                            <div className="text-red-600 font-bold text-[9px]">+{badge.bonus_scans} SCANS</div>
                                        </div>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-[#050505] text-white text-[10px] p-3 shadow-xl border border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                                            <div className="font-black text-red-600 mb-1 uppercase">{badge.name}</div>
                                            <div className="text-white/40 leading-relaxed font-medium">{badge.description}</div>
                                        </div>
                                    </div>
                                ))}

                                {badges.length === 0 && (
                                    <div className="col-span-full py-8 text-center bg-white/[0.01] border border-dashed border-white/10">
                                        <i className="fas fa-shield-alt text-3xl text-white/10 mb-2"></i>
                                        <p className="text-xs text-white/30 font-bold uppercase tracking-widest">No badges earned yet</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-2 animate-fade-in h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                {cardInventory.length > 0 ? (() => {
                                    let totalInvest = 0, totalLiveMkt = 0, anyUnlocked = false;

                                    const rows = cardInventory.map((item, idx) => {
                                            // -- Pro-gated market data resolution --
                                            // Find any scan with this name+set that has unlocked market data
                                            const matchingScans = (scans ?? []).filter((s: any) =>
                                                s.name === item.name && s.card_set === item.set &&
                                                Number(s.market_price_unlocked) === 1 && s.market_price_json
                                            );
                                            let liveMktTotal: number | null = null;
                                            let bestGradeOpportunity: number | null = null;
                                            let marketDetails: any = null;

                                            if (matchingScans.length > 0) {
                                                let mktSum = 0, bestOpp = 0;
                                                for (const s of matchingScans) {
                                                    try {
                                                        const md = JSON.parse(s.market_price_json);
                                                        if (!md || md.no_data) continue;
                                                        marketDetails = md;

                                                        // Resolve card-specific projected value
                                                        let projectedPrice = md.projectedValue?.price;
                                                        if (!projectedPrice && s.overall_grade) {
                                                            const ng = Math.round(Number(s.overall_grade));
                                                            if (ng >= 5 && ng <= 10 && md.gradedPrices) {
                                                                projectedPrice = md.gradedPrices[`psa${ng}`];
                                                            }
                                                        }
                                                        mktSum += Number(projectedPrice || md.prices?.market || md.prices?.mid || md.pokewallet?.tcgplayer?.prices?.[0]?.market_price || 0);
                                                        const psa10val = md.gradedPrices?.psa10 || 0;
                                                        if (psa10val > bestOpp) bestOpp = psa10val;
                                                    } catch { /* skip */ }
                                                }
                                                if (mktSum > 0) { liveMktTotal = mktSum; anyUnlocked = true; totalLiveMkt += mktSum; }
                                                if (bestOpp > 0) bestGradeOpportunity = bestOpp;
                                            }

                                            totalInvest += item.totalValue;
                                            const isProUnlocked = matchingScans.length > 0;

                                            // Inline market panel data
                                            const gp = marketDetails?.gradedPrices || {};
                                            const pw = marketDetails?.pokewallet;
                                            const pwTcgStat = pw?.tcgplayer?.prices?.[0]?.market_price || null;
                                            const pwCmTStat = pw?.cardmarket?.prices?.[0]?.trend || null;
                                            const psaRowsStat = [
                                                { l: 'PSA 10', v: gp.psa10 }, { l: 'PSA 9', v: gp.psa9 },
                                                { l: 'PSA 8', v: gp.psa8 }, { l: 'PSA 7', v: gp.psa7 },
                                                { l: 'PSA 6', v: gp.psa6 }, { l: 'PSA 5', v: gp.psa5 },
                                            ].filter((r: any) => r.v > 0);
                                            return { item, idx, isProUnlocked, liveMktTotal, bestGradeOpportunity, marketDetails, psaRowsStat, pwTcgStat, pwCmTStat };
                                        });

                                    return (
                                        <>
                                            <div className="grid grid-cols-1 gap-1.5">
                                                {rows.map((rowProps, idx) => (
                                                    <CardStatRow key={idx} {...rowProps} />
                                                ))}
                                            </div>

                                            {/* Totals row */}
                                            <div className="sticky bottom-0 mt-1 bg-[#0a0a0a] border border-white/10 p-2.5 flex items-center gap-4">
                                                <div className="text-[8px] font-black text-white/30 uppercase tracking-widest flex-1">Totals</div>
                                                <div className="text-center">
                                                    <div className="text-[11px] font-black text-white/70">${totalInvest.toLocaleString()}</div>
                                                    <div className="text-[7px] text-white/30 uppercase font-bold">Invest.</div>
                                                </div>
                                                {anyUnlocked && (
                                                    <div className="text-center min-w-[60px]">
                                                        <div className="text-[11px] font-black" style={{ color: '#D4AF37' }}>${totalLiveMkt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                        <div className="text-[7px] text-white/30 uppercase font-bold">Live Mkt Total</div>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    );
                                })() : (
                                    <div className="py-12 text-center bg-white/[0.02] border border-dashed border-white/10">
                                        <i className="fas fa-chart-line text-3xl text-white/10 mb-2"></i>
                                        <p className="text-xs text-white/30 font-bold uppercase tracking-widest">No inventory data available</p>
                                        <p className="text-[9px] text-white/20 mt-1 uppercase italic">Linked scans are automatically grouped as single physical assets.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Privacy Control Plugin */}
            <PrivacyControlPlugin user={user} onRefresh={fetchCollection} />

            <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-silver pb-6">
                <div>
                    <h2 className="text-3xl font-serif font-medium text-[#D4AF37] relative pb-2 border-b border-[#D4AF37]/20">My Vault</h2>
                    <p className="text-[#FBF9F6]/40 text-sm">Managing {stats.total_unique_cards} physical cards across {stats.total_scans} audits</p>
                </div>

                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <i className="fas fa-search absolute left-3 top-2.5 text-gray-500"></i>
                        <input
                            type="text"
                            placeholder="Search your collection..."
                            className="w-full bg-[#050505] border border-white/10 p-2 pl-10 text-sm text-white placeholder-white/20 focus:border-[#D4AF37] focus:bg-white/5 outline-none transition-all"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <select
                        className="bg-[#050505] border border-white/10 p-2 text-sm text-white outline-none focus:border-[#D4AF37] focus:bg-white/5 transition-all"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                    >
                        <option value="date_scanned">Newest First</option>
                        <option value="overall_grade">Highest Grade</option>
                        <option value="name">Card Name</option>
                        <option value="card_set">Set Name</option>
                    </select>
                    <button
                        onClick={() => {
                            if (isBulkMode) setSelectedCerts(new Set());
                            setIsBulkMode(!isBulkMode);
                        }}
                        className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow flex items-center gap-2 ${isBulkMode ? 'bg-[#D4AF37] text-black shadow-[0_0_15px_rgba(212,175,55,0.2)]' : 'bg-[#0a0a0a] border border-white/10 text-white/50 hover:text-white hover:border-white/30'}`}
                        title="Toggle Bulk Edit Mode"
                    >
                        <i className="fas fa-check-square"></i>
                        {isBulkMode ? 'Exit Bulk Edit' : 'Bulk Edit'}
                    </button>
                    <button
                        onClick={handleBulkPrint}
                        className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all bg-[#0a0a0a] border border-white/10 text-white/50 hover:text-[#D4AF37] hover:border-[#D4AF37]/50 flex items-center gap-2"
                        title="Print all Slab Slips in your collection"
                    >
                        <i className="fas fa-print"></i>
                        Bulk Print Slips
                    </button>
                    <button
                        onClick={() => setShowArchived(!showArchived)}
                        className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${showArchived ? 'bg-[#050505] border border-[#D4AF37] text-[#D4AF37] shadow-[0_0_10px_rgba(212,175,55,0.2)]' : 'bg-[#0a0a0a] border border-white/10 text-white/50 hover:text-white hover:border-white/30'}`}
                    >
                        <i className={`fas ${showArchived ? 'fa-box-open' : 'fa-archive'}`}></i>
                        {showArchived ? 'Viewing Archived' : 'Show Archived'}
                    </button>
                    <button
                        onClick={() => { setShowPsaVault(v => !v); psaVaultRef.current?.open(); }}
                        className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 bg-gradient-to-br from-[#D4AF37]/20 to-[#D4AF37]/10 border border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.15)]"
                        title="Open Slab Vault"
                    >
                        <i className="fas fa-shield-alt"></i>
                        Slab Vault
                    </button>
                    <button
                        onClick={() => displayVaultRef.current?.show()}
                        className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 bg-gradient-to-br from-[#D4AF37]/20 to-[#D4AF37]/10 border border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.15)]"
                        title="Manage Display Vaults"
                    >
                        <i className="fas fa-university"></i>
                        Display Vaults
                    </button>
                </div>
            </div>

            {
                loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {Array(6).fill(0).map((_, i) => <div key={i} className="bg-[#050505] border border-white/10 h-48 rounded-2xl animate-pulse"></div>)}
                    </div>
                ) : groupedScans.length > 0 ? (
                    <>
                        <div className={`mt-8 ${ showArchived ? 'opacity-50' : '' }`}>
                            <div className="flex flex-col md:flex-row gap-6 items-start">
                                {/* Vault Stats Panel (Removed to prevent duplication with top Achievement Vault) */}

                                {/* Main Collection Grid */}
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                    {groupedScans.map(scan => (
                                        <div key={scan.id} className="space-y-4">
                                            <div
                                                className={`cursor-pointer bg-[#080808] border border-white/10 overflow-hidden transition-all group flex flex-col relative
                                                        ${isBulkMode && !selectedCerts.has(scan.id) ? 'opacity-60 grayscale-[50%] border-silver' : ''}
                                                        ${isBulkMode && selectedCerts.has(scan.id) ? 'border-red-600 ring-2 ring-red-600/40' : 'border-white/10 hover:border-white/30'}
                                                        ${numberingPluginRef.current?.isNumberingMode ? 'opacity-40 grayscale-[0.5]' : 'hover:border-poke-accent'}
                                                `}
                                                onClick={() => {
                                                    if (numberingPluginRef.current?.isNumberingMode) return; // Disable click if numbering mode is active
                                                    if (isBulkMode) {
                                                        const next = new Set(selectedCerts);
                                                        if (next.has(scan.id)) next.delete(scan.id);
                                                        else next.add(scan.id);
                                                        setSelectedCerts(next);
                                                    } else {
                                                        onSelect(scan.id);
                                                    }
                                                }}
                                            >
                                                {/* Numbering UI Overlay */}
                                                {numberingPluginRef.current?.renderCardOverlay(scan)}

                                                {/* Stack Visual Effect */}
                                                {scan.history.length > 0 && (
                                                    <>
                                                        <div className="absolute -bottom-1.5 left-2 right-2 h-4 bg-white/10 border border-white/20 rounded-2xl -z-10 translate-y-2 opacity-70"></div>
                                                        <div className="absolute -bottom-3 left-4 right-4 h-4 bg-white/5 border border-white/10 rounded-2xl -z-20 translate-y-4 opacity-50"></div>
                                                    </>
                                                )}

                                                {isBulkMode && (
                                                    <div className="absolute top-4 left-4 z-20">
                                                        <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${selectedCerts.has(scan.id) ? 'bg-poke-accent border-poke-accent' : 'bg-white/90 border-silver'}`}>
                                                            {selectedCerts.has(scan.id) && <i className="fas fa-check text-white text-xs"></i>}
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="relative h-64 bg-[#0a0a0a] flex items-center justify-center overflow-hidden border-b border-white/10" onClick={(e) => {
                                                    // Prevent the image click from doing nothing if we are not in bulk mode and want to open the modal
                                                    // The parent onClick will handle it unless we stop propagation here, which we don't want to do generally.
                                                }}>
                                                    <img
                                                        src={getImageUrl(scan, 'front')}
                                                        className="h-full w-full object-contain transform group-hover:scale-110 transition-transform duration-500"
                                                        alt={scan.name}
                                                        loading="lazy"
                                                        decoding="async"
                                                    />
                                                    {(() => {
                                                    if (scan.overall_grade === null || scan.overall_grade === undefined || scan.overall_grade === '') return null;

                                                        const numGrade = parseFloat(scan.overall_grade || '0');
                                                        let bgStyle = 'linear-gradient(135deg, #8b0000 0%, #4a0000 100%)'; // Velvet red default
                                                        let textColor = '#ffffff';
                                                        let borderStyle = '1px solid rgba(255,0,0,0.3)';
                                                        
                                                        if (scan.overall_grade === '10' || scan.overall_grade === '10.0') {
                                                            bgStyle = 'linear-gradient(135deg, #F3E5AB 0%, #D4AF37 50%, #8A6F1C 100%)';
                                                            textColor = '#000000';
                                                            borderStyle = '1px solid #F3E5AB';
                                                        } else if (numGrade >= 9.0 && numGrade < 10) {
                                                            bgStyle = 'linear-gradient(135deg, #E0E0E0 0%, #BDBDBD 50%, #757575 100%)';
                                                            textColor = '#000000';
                                                            borderStyle = '1px solid #ffffff';
                                                        }

                                                        return (
                                                            <div className="absolute top-3 right-3 px-3 py-1.5 flex items-center gap-2 shadow-xl" style={{ background: bgStyle, border: borderStyle }}>
                                                                <span className="text-[10px] font-black uppercase" style={{ color: textColor === '#000000' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)' }}>Grade</span>
                                                                <span className="text-lg font-black" style={{ color: textColor }}>{scan.overall_grade}</span>
                                                            </div>
                                                        );
                                                    })()}
                                                    {(() => {
                                                        const isUnlocked = Number(scan.market_price_unlocked) === 1 || Object.hasOwn(window, 'unlockedMarketKeys') || unlockedMarketKeys.has(`${scan.name}|${scan.card_set}`);
                                                        let displayValue = parseFloat(scan.estimated_value || '0');
                                                        let label = "";

                                                        if (isUnlocked && scan.market_price_json) {
                                                            try {
                                                                const md = JSON.parse(scan.market_price_json);
                                                                if (md && !md.no_data) {
                                                                    let projVal = md.projectedValue;
                                                                    if (!projVal && scan.overall_grade) {
                                                                        const numGrade = Math.round(Number(scan.overall_grade));
                                                                        if (numGrade >= 5 && numGrade <= 10 && md.gradedPrices) {
                                                                            const price = md.gradedPrices[`psa${numGrade}`];
                                                                            if (price > 0) projVal = { grade: numGrade, price };
                                                                        }
                                                                    }

                                                                    if (projVal && projVal.price > 0) {
                                                                        displayValue = Number(projVal.price);
                                                                        label = `EST PSA ${projVal.grade} `;
                                                                    } else if (md.prices && (md.prices.market || md.prices.mid)) {
                                                                        displayValue = Number(md.prices.market || md.prices.mid);
                                                                        label = "RAW MKT ";
                                                                    } else if (md.pokewallet?.tcgplayer?.market_price) {
                                                                        displayValue = Number(md.pokewallet.tcgplayer.market_price);
                                                                        label = "RAW MKT ";
                                                                    }
                                                                }
                                                            } catch (e) { }
                                                        }

                                                        if (displayValue > 0) {
                                                            let valBgStyle = 'linear-gradient(135deg, #8b0000 0%, #4a0000 100%)';
                                                            let valTextColor = '#ffffff';
                                                            let valBorderStyle = '1px solid rgba(255,0,0,0.3)';
                                                            
                                                            const isEstGrade = label.includes('EST PSA');
                                                            let gradeVal = 0;
                                                            if (isEstGrade) {
                                                                const match = label.match(/PSA\s(\d+)/i);
                                                                if (match) gradeVal = parseInt(match[1]);
                                                            }

                                                            if (isEstGrade && gradeVal === 10) {
                                                                valBgStyle = 'linear-gradient(135deg, #F3E5AB 0%, #D4AF37 50%, #8A6F1C 100%)';
                                                                valTextColor = '#000000';
                                                                valBorderStyle = '1px solid rgba(212,175,55,0.4)';
                                                            } else if (isEstGrade && gradeVal === 9) {
                                                                valBgStyle = 'linear-gradient(135deg, #E0E0E0 0%, #BDBDBD 50%, #757575 100%)';
                                                                valTextColor = '#000000';
                                                                valBorderStyle = '1px solid rgba(255,255,255,0.4)';
                                                            } else if (!isEstGrade) {
                                                                // Raw market gets a dark neutral style
                                                                valBgStyle = 'rgba(0,0,0,0.85)';
                                                                valTextColor = '#D4AF37';
                                                                valBorderStyle = '1px solid rgba(212,175,55,0.4)';
                                                            }

                                                            return (
                                                                <div className="absolute bottom-3 left-3 px-3 py-1 text-xs font-black shadow-xl" style={{background: valBgStyle, border: valBorderStyle}}>
                                                                    <span style={{ color: valTextColor === '#000000' ? 'rgba(0,0,0,0.7)' : (isEstGrade ? 'rgba(255,255,255,0.8)' : '#D4AF37') }}>
                                                                        {label}
                                                                    </span>
                                                                    <span style={{ color: valTextColor }} className="ml-1 mr-0.5">$</span>
                                                                    <span style={{ color: valTextColor }}>{displayValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                    {scan.history.length > 0 && (
                                                        <div className="absolute top-3 left-3 bg-white/10 text-white px-2 py-1 text-[10px] font-black flex items-center gap-1.5 uppercase border border-white/20">
                                                            <i className="fas fa-layer-group"></i>
                                                            {scan.history.length + 1} Audits
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="p-4 flex flex-col flex-1">
                                                    <div className="mb-4 relative">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <h3 className="font-bold text-white group-hover:text-white/70 transition-colors truncate text-lg leading-tight flex-1 flex items-center gap-2">
                                                                {scan.is_first_edition === 1 || scan.is_first_edition === true ? (
                                                                    <span className="bg-poke-gold/30 text-gray-800 border border-poke-gold/50 text-[9px] px-1.5 py-0.5 rounded uppercase font-black tracking-widest shrink-0">1st ED</span>
                                                                ) : null}
                                                                {scan.name}
                                                            </h3>
                                                            {(user.role === 'admin' || user.id === scan.user_id) && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const isFirstEdition = scan.is_first_edition === 1 || scan.is_first_edition === true;
                                                                        const isHolographic = scan.is_holographic === 1 || scan.is_holographic === true;
                                                                        setEditingRename({
                                                                            id: scan.id,
                                                                            name: scan.name,
                                                                            isFirstEdition,
                                                                            isHolographic,
                                                                            originalName: scan.name,
                                                                            originalIsFirstEdition: isFirstEdition,
                                                                            originalIsHolographic: isHolographic
                                                                        });
                                                                    }}
                                                                    className="opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-white transition-all shrink-0"
                                                                    title="Rename Certificate"
                                                                >
                                                                    <i className="fas fa-edit text-xs"></i>
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-white/30 font-medium uppercase tracking-wider flex items-center gap-2 flex-wrap mt-1">
                                                            {scan.rarity && (
                                                                <span className="text-white/30 bg-white/5 border border-white/10 px-1.5 py-0.5 text-[9px] tracking-widest leading-none">{scan.rarity}</span>
                                                            )}
                                                            <span className="flex items-center gap-1">
                                                                {scan.card_set} • {scan.year}
                                                                {(user.role === 'admin' || user.id === scan.user_id) && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); setEditingSetName({ id: scan.id, card_set: scan.card_set || '', year: scan.year ?? '' }); }}
                                                                        className="opacity-0 group-hover:opacity-100 p-0.5 text-white/30 hover:text-white transition-all"
                                                                        title="Edit Set & Year"
                                                                    >
                                                                        <i className="fas fa-edit text-[10px]"></i>
                                                                    </button>
                                                                )}
                                                            </span>
                                                            {scan.vault_copy != null && scan.vault_copy !== '' && (
                                                                <span className="bg-red-600/20 text-red-500 border border-red-600/40 px-1.5 py-0.5 text-[9px] font-black tracking-widest shrink-0" title="Vault copy number">#{scan.vault_copy}</span>
                                                            )}
                                                        </div>
                                                        {scan.name_updated_at && (
                                                            <div className="text-[8px] text-gray-500 uppercase font-bold tracking-widest mt-1">
                                                                <i className="fas fa-pen-nib mr-1"></i> Renamed {new Date(scan.name_updated_at).toLocaleDateString()}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="bg-white/[0.02] p-3 text-xs text-white/30 min-h-[60px] relative group/note border border-white/5 flex-1" onClick={(e) => e.stopPropagation()}>
                                                        {scan.user_notes ? (
                                                            <p className="italic leading-relaxed">"{scan.user_notes}"</p>
                                                        ) : (
                                                            <p className="opacity-30">Add personal vault notes...</p>
                                                        )}
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setEditingNotes({ id: scan.id, text: scan.user_notes || '' }); }}
                                                            className="absolute top-2 right-2 opacity-0 group-hover/note:opacity-100 bg-red-600 text-white w-6 h-6 flex items-center justify-center transition-all hover:bg-red-700"
                                                            title="Edit Notes"
                                                        >
                                                            <i className="fas fa-pen text-[10px]"></i>
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingAcquisition(scan);
                                                                setAcqFormData({
                                                                    acq_price: scan.acq_price || '',
                                                                    acq_tax: scan.acq_tax || '',
                                                                    acq_shipping: scan.acq_shipping || '',
                                                                    acq_date: scan.acq_date ? scan.acq_date.split(' ')[0] : '',
                                                                    acq_source: scan.acq_source || '',
                                                                    acq_city: scan.acq_city || '',
                                                                    acq_state: scan.acq_state || '',
                                                                    tracking_number: scan.tracking_number || '',
                                                                    order_id: scan.order_id || '',
                                                                    vault_copy: scan.vault_copy != null && scan.vault_copy !== '' ? String(scan.vault_copy) : '',
                                                                    user_notes: scan.user_notes || '',
                                                                    envelope_receipt_img: undefined
                                                                });
                                                            }}
                                                            className="absolute top-2 right-10 opacity-0 group-hover/note:opacity-100 bg-white/10 text-white w-6 h-6 flex items-center justify-center transition-all hover:bg-white/20"
                                                            title="Edit Acquisition Info"
                                                        >
                                                            <i className="fas fa-file-invoice-dollar text-[10px]"></i>
                                                        </button>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const isArchived = scan.is_archived === 1 || scan.is_archived === true;
                                                                if (!confirm(`${ isArchived ? 'Restore' : 'Archive' } this certificate ? `)) return;
                                                                try {
                                                                    const resp = await fetch('api/archive.php', {
                                                                        method: 'POST',
                                                                        credentials: 'include',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ id: scan.id, archive: isArchived ? 0 : 1 })
                                                                    });
                                                                    const result = await resp.json();
                                                                    if (result.success) fetchCollection();
                                                                    else alert("Action failed: " + result.error);
                                                                } catch (err) { console.error("Archive error", err); }
                                                            }}
                                                            className={`absolute top-2 right-[72px] opacity-0 group-hover/note:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center transition-all shadow text-white ${scan.is_archived ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-gray-400 hover:bg-gray-500'}`}
                                                            title={scan.is_archived ? 'Restore' : 'Archive'}
                                                        >
                                                            <i className={`fas ${ scan.is_archived ? 'fa-box-open' : 'fa-archive' } text-[10px]`}></i>
                                                        </button>
                                                    </div>

                                                    {/* Acquisition Quick View - WOW Factor */}
                                                    {scan.acq_price || scan.acq_source ? (
                                                        <div className="relative group/acq mt-3 overflow-hidden border border-white/5 p-3 bg-white/[0.02]" onClick={(e) => e.stopPropagation()}>
                                                            <div className="absolute top-0 right-0 p-1 opacity-20 group-hover/acq:opacity-40 transition-opacity text-poke-blue">
                                                                <i className="fas fa-file-invoice-dollar text-3xl"></i>
                                                            </div>
                                                            <div className="flex justify-between items-end relative z-10">
                                                                <div className="flex flex-col">
                                                                    <span className="text-[7px] font-black uppercase tracking-[0.2em] mb-1" style={{color:'#D4AF37'}}>Vault Investment</span>
                                                                    <span className="text-lg font-black text-white leading-none tracking-tight">
                                                                        <span className="text-sm mr-0.5" style={{color:'#D4AF37'}}>$</span>
                                                                        {(parseFloat(scan.acq_price || '0') + parseFloat(scan.acq_tax || '0') + parseFloat(scan.acq_shipping || '0')).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                                    </span>
                                                                </div>
                                                                <div className="flex flex-col text-right">
                                                                    <span className="text-[7px] font-black uppercase tracking-[0.2em] mb-1" style={{color:'#D4AF37'}}>Origin</span>
                                                                    <span className="text-[10px] font-bold text-gray-700 truncate max-w-[100px]">{scan.acq_source || 'Unknown'}</span>
                                                                </div>
                                                            </div>
                                                            {scan.acq_date && (
                                                                <div className="mt-2 pt-2 border-t border-white/5 flex justify-between items-center">
                                                                    <span className="text-[7px] text-gray-500 font-bold uppercase">Acquired {new Date(scan.acq_date).toLocaleDateString()}</span>
                                                                    {scan.acq_city && <span className="text-[7px] text-gray-500 font-bold uppercase">{scan.acq_city}, {scan.acq_state}</span>}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div onClick={(e) => e.stopPropagation()}>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setEditingAcquisition(scan);
                                                                    setAcqFormData({
                                                                        acq_price: '', acq_tax: '', acq_shipping: '', acq_date: '', acq_source: '', acq_city: '', acq_state: '', tracking_number: '', order_id: '', vault_copy: '', user_notes: '', envelope_receipt_img: undefined
                                                                    });
                                                                }}
                                                                className="mt-3 w-full py-2 bg-white/5 border border-white/10 text-[10px] font-black text-white/50 uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                                                            >
                                                                <i className="fas fa-plus-circle"></i> Add Acquisition Info
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* MARKET VALUE PLUGIN (COMPACT VIEW) */}
                                                    <MarketValuePlugin 
                                                        certId={scan.id} 
                                                        overallGrade={scan.overall_grade}
                                                        cardName={scan.name || ''}
                                                        cardSet={scan.card_set || ''}
                                                        initialUnlocked={
                                                            Number(scan.market_price_unlocked) === 1 ||
                                                            unlockedMarketKeys.has(`${scan.name}|${scan.card_set}`)
                                                        }
                                                        initialDataJson={scan.market_price_json || null}
                                                        userRole={user.role || 'user'}
                                                        paidCredits={user.paid_credits || 0}
                                                        onUnlocked={handleMarketUnlocked}
                                                        compact={true}
                                                    />

                                                    {/* RE-IDENTIFY PLUGIN */}
                                                    {(user.role === 'admin' || user.id === scan.user_id) && (
                                                        <ReidentifyPlugin
                                                            certId={scan.id}
                                                            onSuccess={fetchCollection}
                                                            paidCredits={user.paid_credits || 0}
                                                            freeCredits={Math.max(0, (user.scan_limit || 5) - (user.scans_this_week || 0))}
                                                        />
                                                    )}

                                                    {/* Background removal preview plugin (remove.bg) */}
                                                    <RemoveBgVaultDisplayPlugin
                                                        certId={scan.id}
                                                        frontUrl={getImageUrl(scan, 'front')}
                                                        backUrl={getImageUrl(scan, 'back')}
                                                        paidCredits={user.paid_credits || 0}
                                                        isAdmin={(user.role || 'user') === 'admin'}
                                                        onUpgradeClick={onOpenProfile}
                                                        onRefreshUser={onRefreshUser}
                                                    />

                                                    <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center text-[10px] uppercase font-bold tracking-widest text-white/30" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex flex-col">
                                                            <span className="text-[8px] text-white/20 mb-0.5">LATEST AUDIT</span>
                                                            <span className="text-white/50">{new Date(scan.date_scanned).toLocaleDateString()}</span>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-1 max-w-[min(100%,22rem)]">
                                                        <div className="flex gap-2 flex-wrap justify-end">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); numberingPluginRef.current?.handleToggleNumbering(scan); }}
                                                                className="w-8 h-8 flex items-center justify-center transition-all border bg-white/5 text-white/60 border-white/10 hover:bg-red-600 hover:text-white hover:border-red-600"
                                                                title="Manage Copies (Wizard)"
                                                            >
                                                                <i className="fas fa-sort-numeric-down"></i>
                                                            </button>

                                                            {scan.vault_copy && (
                                                                <button
                                                                    onClick={(e) => numberingPluginRef.current?.handleUncount(scan.id, e)}
                                                                    className="w-8 h-8 flex items-center justify-center transition-all border bg-red-600/10 text-red-600 border-red-600/20 hover:bg-red-600 hover:text-white"
                                                                    title="Remove Copy #"
                                                                >
                                                                    <i className="fas fa-times-circle"></i>
                                                                </button>
                                                            )}

                                                            {onRegrade && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); onRegrade(scan.id); }}
                                                                    className="w-8 h-8 flex items-center justify-center transition-all border bg-white/5 text-white/40 border-white/10 hover:bg-white hover:text-black"
                                                                    title="Start Re-grade (linked scan)"
                                                                >
                                                                    <i className="fas fa-microscope text-xs"></i>
                                                                </button>
                                                            )}
                                                            {scan.history.length === 0 && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setLinkingCert(scan); }}
                                                                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all border bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:border-white/30 hover:text-white"
                                                                    title="Link to previous scan"
                                                                >
                                                                    <i className="fas fa-link"></i>
                                                                </button>
                                                            )}
                                                            {scan.history.length > 0 && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); toggleStack(scan.id); }}
                                                                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border ${expandedStacks.has(scan.id) ? 'bg-poke-accent text-white border-poke-accent' : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:border-white/30 hover:text-white'}`}
                                                                    title="View previous scans"
                                                                >
                                                                    <i className={`fas ${expandedStacks.has(scan.id) ? 'fa-chevron-up' : 'fa-history'}`}></i>
                                                                </button>
                                                            )}
                                                            {(scan.acq_price || scan.acq_source) && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setEditingAcquisition(scan);
                                                                        setAcqFormData({
                                                                            acq_price: scan.acq_price || '',
                                                                            acq_tax: scan.acq_tax || '',
                                                                            acq_shipping: scan.acq_shipping || '',
                                                                            acq_date: scan.acq_date ? scan.acq_date.split(' ')[0] : '',
                                                                            acq_source: scan.acq_source || '',
                                                                            acq_city: scan.acq_city || '',
                                                                            acq_state: scan.acq_state || '',
                                                                            tracking_number: scan.tracking_number || '',
                                                                            order_id: scan.order_id || '',
                                                                            vault_copy: scan.vault_copy != null && scan.vault_copy !== '' ? String(scan.vault_copy) : '',
                                                                            user_notes: scan.user_notes || '',
                                                                            envelope_receipt_img: undefined
                                                                        });
                                                                    }}
                                                                    className="w-8 h-8 flex items-center justify-center transition-all border bg-white/5 text-white/30 border-white/10 hover:bg-white/10"
                                                                    title="View Receipt / Acquisition"
                                                                >
                                                                    <i className="fas fa-file-invoice-dollar text-xs"></i>
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); void open3DForCert(scan.id); }}
                                                                className="w-8 h-8 flex items-center justify-center transition-all border bg-white/5 text-white/40 border-white/10 hover:bg-white hover:text-black"
                                                                title="3D card viewer"
                                                                aria-label="Open 3D card viewer"
                                                            >
                                                                <i className="fas fa-cube text-xs"></i>
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onSelect(scan.id); }}
                                                                className="bg-white/5 border border-white/10 text-white px-4 py-2 font-black hover:bg-red-600 hover:border-red-600 hover:text-white transition-all group/btn flex items-center gap-2 text-[10px] uppercase tracking-widest"
                                                            >
                                                                OPEN
                                                                <i className="fas fa-arrow-right group-hover/btn:translate-x-1 transition-transform"></i>
                                                            </button>
                                                        </div>
                                                        <div className="w-full text-[8px] text-white/40 font-bold uppercase tracking-wide text-right leading-tight">
                                                            Remove BG: <span className="text-[#D4AF37]/90">1 Pro</span>/run · 3D: <span className="text-[#D4AF37]/90">2 Pro</span> first enable only
                                                        </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {expandedStacks.has(scan.id) && scan.history.length > 0 && (
                                                <div className="bg-black/50 border-l-4 border-red-600 p-4 ml-4 space-y-3 animate-slide-down border border-white/5">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <p className="text-[10px] font-black text-red-600 uppercase tracking-widest flex items-center gap-2">
                                                            <i className="fas fa-history"></i> Audit Trail
                                                        </p>
                                                        <button
                                                            onClick={() => {
                                                                const tail = scan.history[scan.history.length - 1];
                                                                setLinkingCert(tail);
                                                            }}
                                                            className="text-[10px] bg-poke-accent/10 text-poke-accent px-2 py-1 rounded border border-poke-accent/30 hover:bg-poke-accent hover:text-white transition-all font-black uppercase"
                                                        >
                                                            Extend Chain
                                                        </button>
                                                    </div>
                                                    {scan.history.map((prev: any, pIdx: number) => (
                                                        <div key={prev.id} className="flex flex-col gap-2">
                                                            <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10 hover:border-white/30 hover:bg-white/10 transition-colors group/row">
                                                                <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => onSelect(prev.id)}>
                                                                    <div className="text-xl font-black text-poke-accent group-hover/row:text-white transition-colors">{prev.overall_grade}</div>
                                                                    <div className="flex flex-col text-left">
                                                                        <span className="text-[10px] text-white/70 font-bold uppercase">{new Date(prev.date_scanned).toLocaleDateString()}</span>
                                                                        <span className="text-[9px] text-white/50 font-mono italic">Audit #{scan.history.length - pIdx}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="flex gap-2 flex-wrap">
                                                                    {onRegrade && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); onRegrade(prev.id); }}
                                                                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-teal-500/20 text-teal-400 border border-teal-500/30 hover:bg-teal-500/40 transition-all"
                                                                            title="Start Re-grade (linked scan)"
                                                                        >
                                                                            <i className="fas fa-microscope text-xs"></i>
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        onClick={() => {
                                                                            if (confirm(`Disconnect this record(${ prev.id.substring(0, 8) }) and its history from the current chain ? `)) {
                                                                                const target = pIdx === 0 ? scan.id : scan.history[pIdx - 1].id;
                                                                                handleManualLink(target, null);
                                                                            }
                                                                        }}
                                                                        className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-900/20 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white transition-all"
                                                                        title="Disconnect from chain"
                                                                    >
                                                                        <i className="fas fa-unlink text-xs"></i>
                                                                    </button>
                                                                    <button
                                                                        onClick={() => onSelect(prev.id)}
                                                                        className="text-[10px] font-black text-poke-accent bg-poke-accent/10 px-3 py-2 rounded-lg border border-poke-accent/30 hover:bg-poke-accent hover:text-white transition-all uppercase"
                                                                    >
                                                                        View
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                    </>
                ) : (
                    <div className="text-center py-20 space-y-4">
                        <i className="fas fa-box-open text-6xl text-gray-800"></i>
                        <p className="text-gray-500 font-bold text-xl">Your vault is empty</p>
                        <button className="bg-poke-accent text-white px-8 py-3 rounded-full font-bold shadow-lg shadow-red-500/20">GRADE YOUR FIRST CARD</button>
                    </div>
                )
            }

            {/* Linking Modal */}
            {
                linkingCert && (
                    <div className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-md flex items-center justify-center p-6">
                        <div className="bg-poke-dark border border-gray-700 w-full max-w-xl rounded-3xl p-8 space-y-6 shadow-2xl animate-scale-in relative border-t-4 border-t-poke-accent">
                            <button onClick={() => setLinkingCert(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white text-xl"><i className="fas fa-times"></i></button>

                            <div className="space-y-2 text-center">
                                <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">Link Audit Trail</h3>
                                <p className="text-gray-400 text-xs">You are adding a <strong>Historical Parent</strong> to this record. This creates a chronological chain of scans for a single physical card.</p>
                            </div>

                            <div className="bg-black/50 p-4 rounded-2xl flex gap-4 items-center border border-gray-800">
                                <div className="w-16 h-20 bg-black rounded overflow-hidden relative">
                                    <img src={getImageUrl(linkingCert, 'front')} className="w-full h-full object-contain" alt="Target Scan" />
                                </div>
                                <div>
                                    <div className="text-xs text-poke-accent font-bold uppercase tracking-widest">Target Scan</div>
                                    <div className="text-lg font-black text-white">{linkingCert.name}</div>
                                    <div className="text-xs text-gray-500 font-mono">{linkingCert.id}</div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <label className="text-xs font-black text-gray-500 uppercase tracking-widest">Search Previous Record</label>
                                <div className="relative">
                                    <i className="fas fa-search absolute left-4 top-4 text-gray-500"></i>
                                    <input
                                        type="text"
                                        placeholder="Search by ID, Name or Set..."
                                        className="w-full bg-black border border-gray-800 p-4 pl-12 rounded-2xl text-white focus:border-poke-accent outline-none transition-all shadow-inner"
                                        value={linkingSearch}
                                        onChange={(e) => setLinkingSearch(e.target.value)}
                                        autoFocus
                                    />
                                </div>

                                <div className="max-h-64 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                    <div className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                                        <i className="fas fa-sparkles text-poke-accent"></i>
                                        {linkingSearch.length > 0 ? 'Search Results' : 'Suggested Matches'}
                                    </div>
                                    {linkingResults.length > 0 ? (
                                        linkingResults.map((r) => {
                                            const isSelf = r.id === linkingCert.id;
                                            const isAlreadyParent = parseInt(r.child_count) > 0;
                                            const isCurrentParent = r.id === linkingCert.parent_id;
                                            const isDisabled = isSelf || isAlreadyParent || isCurrentParent;

                                            return (
                                                <div
                                                    key={r.id}
                                                    onClick={() => {
                                                        if (isDisabled) return;
                                                        if (confirm(`Link this scan to ${ r.name } (${ r.id.substring(0, 8) })?`)) {
                                                            handleManualLink(linkingCert.id, r.id);
                                                        }
                                                    }}
                                                    className={`flex gap-4 items-center p-3 rounded-xl border transition-all relative ${
    isDisabled
        ? 'bg-gray-900/20 border-gray-800/50 opacity-40 cursor-not-allowed filter grayscale'
        : r.match_score > 100
            ? 'bg-poke-accent/10 border-poke-accent/30 hover:bg-poke-accent/20 cursor-pointer group'
            : 'bg-gray-900/50 border-gray-800 hover:border-poke-accent hover:bg-gray-800 cursor-pointer group'
} `}
                                                >
                                                    <div className="w-10 h-14 bg-black rounded overflow-hidden relative">
                                                        <img src={getImageUrl(r, 'front')} className="w-full h-full object-contain" alt={r.name} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-bold text-white group-hover:text-poke-accent transition-colors truncate flex items-center gap-2">
                                                            {r.name}
                                                            {isSelf && <span className="text-[7px] bg-red-500/20 text-red-400 px-1 rounded">SELF</span>}
                                                            {isAlreadyParent && <span className="text-[7px] bg-poke-blue/20 text-poke-blue px-1 rounded">OCCUPIED</span>}
                                                            {isCurrentParent && <span className="text-[7px] bg-green-500/20 text-green-400 px-1 rounded">CURRENT PARENT</span>}
                                                        </div>
                                                        <div className="text-[10px] text-gray-500 truncate">{r.card_set} • {r.year}</div>
                                                        {!isDisabled && r.match_score && (
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <div className="h-1 flex-1 bg-gray-800 rounded-full overflow-hidden">
                                                                    <div
                                                                        className={`h-full rounded-full ${ r.match_score > 100 ? 'bg-green-400' : 'bg-poke-accent' }`}
                                                                        style={{ width: `${ Math.min(100, (r.match_score / 150) * 100) }% ` }}
                                                                    ></div>
                                                                </div>
                                                                <span className={`text-[8px] font-black uppercase ${ r.match_score > 100 ? 'text-green-400' : 'text-poke-accent' }`}>
                                                                    {r.match_score > 100 ? 'Physical Match' : 'Metadata Match'}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {isDisabled && (
                                                            <div className="text-[8px] font-black text-gray-600 mt-1 uppercase italic">
                                                                {isSelf ? "Cannot link card to itself" : isAlreadyParent ? "Already linked to another scan" : "Selected as current parent"}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-xl font-black text-white">{r.overall_grade}</div>
                                                        <div className="text-[10px] text-gray-500 uppercase font-black">Grade</div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : linkingSearch.length > 2 ? (
                                        <div className="text-center py-8 text-gray-500 text-sm italic">No matching records found...</div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-600 text-[10px] font-black uppercase tracking-widest">Finding best matches for your card...</div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-4 flex flex-col gap-3">
                                {user.role === 'admin' && (
                                    <div className="border-t border-red-500/20 pt-4 mt-2 space-y-3">
                                        <div className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-2">
                                            <i className="fas fa-radiation"></i> Admin Danger Zone
                                        </div>
                                        <button
                                            onClick={() => handleAdminReset(linkingCert.id, 'complete')}
                                            className="w-full py-3 bg-red-600/10 text-red-500 border border-red-600/50 rounded-xl font-black text-xs hover:bg-red-600 hover:text-white transition-all uppercase tracking-widest"
                                        >
                                            Dissolve This Entire Stack
                                        </button>
                                    </div>
                                )}
                                {linkingCert.parent_id && (
                                    <button
                                        onClick={() => handleManualLink(linkingCert.id, null)}
                                        className="w-full py-4 bg-red-900/20 text-red-500 border border-red-900/50 rounded-2xl font-black text-sm hover:bg-red-500 hover:text-white transition-all uppercase tracking-widest"
                                    >
                                        Disconnect Current Parent
                                    </button>
                                )}
                                <p className="text-[10px] text-gray-500 text-center italic">Tip: Linking scans helps maintain an accurate count of unique physical cards in your collection.</p>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                editingNotes && (
                    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
                        <div className="bg-poke-dark border border-gray-700 w-full max-w-md rounded-2xl p-6 space-y-4 shadow-2xl animate-scale-in">
                            <div className="flex justify-between items-center">
                                <h3 className="font-bold text-poke-accent">Update Personal Notes</h3>
                                <button onClick={() => setEditingNotes(null)} className="text-gray-500 hover:text-white"><i className="fas fa-times"></i></button>
                            </div>
                            <textarea
                                className="w-full bg-black border border-gray-700 p-4 rounded-xl text-sm text-gray-300 h-32 outline-none focus:border-poke-accent"
                                value={editingNotes.text}
                                onChange={(e) => setEditingNotes({ ...editingNotes, text: e.target.value })}
                                placeholder="Add your thoughts on this card, store value, or grading notes..."
                            />
                            <button
                                onClick={handleUpdateNotes}
                                className="w-full bg-poke-accent py-3 rounded-xl font-bold text-white shadow-lg hover:bg-red-600 transition-all"
                            >
                                SAVE NOTES
                            </button>
                        </div>
                    </div>
                )
            }

            {/* Acquisition Edit Modal */}
            {
                editingAcquisition && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
                        <div style={{ background: '#080808', border: '1px solid rgba(212,175,55,0.25)', width: '100%', maxWidth: '580px', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh', position: 'relative' }}>
                            {/* Header */}
                            <div style={{ background: '#040404', padding: '24px 32px', borderBottom: '1px solid rgba(212,175,55,0.15)', position: 'relative', flexShrink: 0 }}>
                                {/* Top gold line */}
                                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg, transparent, #D4AF37, transparent)' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <h2 style={{ fontFamily: '"Playfair Display", serif', fontWeight: 400, fontSize: '22px', color: '#FBF9F6', margin: 0, letterSpacing: '0.05em' }}>Vault Valuation</h2>
                                        <p style={{ fontFamily: 'system-ui, sans-serif', fontWeight: 400, fontSize: '9px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#887440', margin: '6px 0 0' }}>Acquisition Details</p>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                                        <button
                                            onClick={() => handleDownloadReceipt(editingAcquisition)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', border: '1px solid rgba(212,175,55,0.4)', background: 'rgba(212,175,55,0.08)', color: '#D4AF37', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}
                                        >
                                            <i className="fas fa-file-invoice-dollar"></i> Receipt
                                        </button>
                                        <button
                                            onClick={() => setEditingAcquisition(null)}
                                            style={{ width: '32px', height: '32px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '12px' }}
                                        >
                                            <i className="fas fa-times"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', flex: 1 }}>
                                <EnvelopeScanPlugin
                                    onExtracted={handleEnvelopeExtracted}
                                    proRequired
                                    hasPro={user.role === 'admin' || (user.paid_credits ?? 0) > 0}
                                    onUpgradeClick={onOpenProfile}
                                />

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>
                                            <i className="fas fa-tag" style={{ marginRight: '6px', color: '#D4AF37' }}></i>Purchase Price
                                        </label>
                                        <div style={{ position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', fontWeight: 700, fontSize: '14px' }}>$</span>
                                            <input
                                                type="number"
                                                style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '12px 14px 12px 28px', color: '#FBF9F6', fontWeight: 700, fontSize: '16px', outline: 'none', boxSizing: 'border-box' }}
                                                placeholder="0.00"
                                                value={acqFormData.acq_price}
                                                onChange={(e) => setAcqFormData({ ...acqFormData, acq_price: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>
                                            <i className="fas fa-calendar-alt" style={{ marginRight: '6px', color: '#D4AF37' }}></i>Acquisition Date
                                        </label>
                                        <input
                                            type="date"
                                            style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '12px 14px', color: '#FBF9F6', fontWeight: 500, fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                                            value={acqFormData.acq_date}
                                            onChange={(e) => setAcqFormData({ ...acqFormData, acq_date: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>Sales Tax ($)</label>
                                        <input type="number" style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '11px 14px', color: '#FBF9F6', fontWeight: 500, fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} placeholder="0.00" value={acqFormData.acq_tax} onChange={(e) => setAcqFormData({ ...acqFormData, acq_tax: e.target.value })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>Shipping ($)</label>
                                        <input type="number" style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '11px 14px', color: '#FBF9F6', fontWeight: 500, fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} placeholder="0.00" value={acqFormData.acq_shipping} onChange={(e) => setAcqFormData({ ...acqFormData, acq_shipping: e.target.value })} />
                                    </div>
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>
                                        <i className="fas fa-store" style={{ marginRight: '6px', color: '#D4AF37' }}></i>Purchase Source
                                    </label>
                                    <input type="text" style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '11px 14px', color: '#FBF9F6', fontWeight: 500, fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} placeholder="eBay, TCGPlayer, Local Shop name..." value={acqFormData.acq_source} onChange={(e) => setAcqFormData({ ...acqFormData, acq_source: e.target.value })} />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>City</label>
                                        <input type="text" style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '11px 14px', color: '#FBF9F6', fontWeight: 500, fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} placeholder="e.g. Las Vegas" value={acqFormData.acq_city} onChange={(e) => setAcqFormData({ ...acqFormData, acq_city: e.target.value })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>State / Prov</label>
                                        <input type="text" style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '11px 14px', color: '#FBF9F6', fontWeight: 500, fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} placeholder="e.g. NV" value={acqFormData.acq_state} onChange={(e) => setAcqFormData({ ...acqFormData, acq_state: e.target.value })} />
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>Tracking #</label>
                                        <input type="text" style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '11px 14px', color: '#FBF9F6', fontWeight: 500, fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} placeholder="1Z99999..." value={acqFormData.tracking_number} onChange={(e) => setAcqFormData({ ...acqFormData, tracking_number: e.target.value })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>Order ID</label>
                                        <input type="text" style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '11px 14px', color: '#FBF9F6', fontWeight: 500, fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} placeholder="123-456" value={acqFormData.order_id} onChange={(e) => setAcqFormData({ ...acqFormData, order_id: e.target.value })} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>
                                            <i className="fas fa-hashtag" style={{ marginRight: '4px', color: '#D4AF37' }}></i>Vault Copy #
                                        </label>
                                        <input type="text" inputMode="numeric" style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '11px 14px', color: '#FBF9F6', fontWeight: 500, fontSize: '12px', outline: 'none', boxSizing: 'border-box' }} placeholder="e.g. 131" value={acqFormData.vault_copy} onChange={(e) => setAcqFormData({ ...acqFormData, vault_copy: e.target.value })} />
                                    </div>
                                </div>

                                <div>
                                    <label style={{ display: 'block', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#887440', marginBottom: '8px' }}>
                                        <i className="fas fa-sticky-note" style={{ marginRight: '6px', color: '#D4AF37' }}></i>Vault Notes
                                    </label>
                                    <textarea style={{ width: '100%', background: '#040404', border: '1px solid rgba(212,175,55,0.2)', padding: '11px 14px', color: '#FBF9F6', fontWeight: 400, fontSize: '12px', outline: 'none', boxSizing: 'border-box', height: '80px', resize: 'none' }} placeholder="Add permanent notes for this physical asset..." value={acqFormData.user_notes} onChange={(e) => setAcqFormData({ ...acqFormData, user_notes: e.target.value })} />
                                </div>
                            </div>

                            {/* Footer */}
                            <div style={{ background: '#040404', padding: '16px 32px', borderTop: '1px solid rgba(212,175,55,0.15)', display: 'flex', gap: '12px', flexShrink: 0 }}>
                                <button
                                    onClick={handleClearValuations}
                                    style={{ flex: 1, padding: '12px 0', border: '1px solid rgba(212,175,55,0.35)', background: 'rgba(212,175,55,0.08)', color: 'rgba(212,175,55,0.85)', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer' }}
                                >
                                    <i className="fas fa-eraser" style={{ marginRight: '6px' }}></i>Clear AI Data
                                </button>
                                <button
                                    onClick={() => setEditingAcquisition(null)}
                                    style={{ flex: 1, padding: '12px 0', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer' }}
                                >
                                    Discard
                                </button>
                                <button
                                    onClick={handleUpdateAcquisition}
                                    style={{ flex: 2, padding: '12px 0', border: '1px solid #D4AF37', background: 'rgba(212,175,55,0.14)', color: '#D4AF37', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                >
                                    <i className="fas fa-save"></i> Save to Vault
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
            {/* Certificate of Receipt - Private Metadata Export (HIDDEN) */}
            <div className="fixed left-[-9999px] top-0 pointer-events-none">
                {editingAcquisition && (
                    <div ref={receiptRef} className="w-[800px] bg-[#0a0a0a] text-[#FBF9F6] p-12 border-8 border-[#D4AF37]">
                        <div className="border-b-4 border-[#D4AF37] pb-8 mb-8 flex justify-between items-start">
                            <div>
                                <h1 className="text-4xl font-black uppercase tracking-tighter leading-none text-[#D4AF37]">RawGraded</h1>
                                <p className="text-xl font-bold text-gray-200">CERTIFICATE OF ACQUISITION</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs font-black text-gray-400 uppercase">Cert ID</p>
                                <p className="text-2xl font-mono font-bold">{editingAcquisition.id}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-12">
                            <div className="space-y-6">
                                <div className="bg-[#111111] border border-white/10 p-6 rounded-xl">
                                    <h3 className="text-xs font-black text-gray-400 uppercase mb-4 tracking-widest leading-none">Card Details</h3>
                                    <p className="text-2xl font-black leading-tight mb-1">{editingAcquisition.name}</p>
                                    <p className="text-lg font-bold text-gray-200">{editingAcquisition.card_set} ({editingAcquisition.year})</p>
                                    {editingAcquisition.overall_grade !== null && editingAcquisition.overall_grade !== undefined && editingAcquisition.overall_grade !== '' ? (
                                        <p className="text-sm font-bold text-gray-300 mt-2 uppercase">Grade: {editingAcquisition.overall_grade}</p>
                                    ) : (
                                        <p className="text-sm font-bold text-gray-300 mt-2 uppercase">Collect Only (no grade)</p>
                                    )}
                                </div>

                                <div className="border-t-2 border-[#D4AF37] pt-6">
                                    <h3 className="text-xs font-black text-gray-400 uppercase mb-4 tracking-widest leading-none">Acquisition Summary</h3>
                                    <table className="w-full text-sm">
                                        <tbody className="divide-y divide-white/10">
                                            <tr>
                                                <td className="py-2 text-gray-400 font-bold uppercase text-[10px]">Purchase Price</td>
                                                <td className="py-2 text-right font-black text-lg">${acqFormData.acq_price || '0.00'}</td>
                                            </tr>
                                            <tr>
                                                <td className="py-2 text-gray-400 font-bold uppercase text-[10px]">Tax Paid</td>
                                                <td className="py-2 text-right font-black text-lg">${acqFormData.acq_tax || '0.00'}</td>
                                            </tr>
                                            <tr>
                                                <td className="py-2 text-gray-400 font-bold uppercase text-[10px]">Shipping</td>
                                                <td className="py-2 text-right font-black text-lg">${acqFormData.acq_shipping || '0.00'}</td>
                                            </tr>
                                            <tr className="border-t-2 border-[#D4AF37]">
                                                <td className="py-3 text-[#FBF9F6] font-black uppercase text-xs">Total Investment</td>
                                                <td className="py-3 text-right font-black text-2xl">
                                                    ${(parseFloat(acqFormData.acq_price || '0') + parseFloat(acqFormData.acq_tax || '0') + parseFloat(acqFormData.acq_shipping || '0')).toFixed(2)}
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
                                            <p className="text-[10px] text-white/30 font-bold uppercase">Source / Platform</p>
                                            <p className="text-lg font-black">{acqFormData.acq_source || "Not Recorded"}</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-[10px] text-white/30 font-bold uppercase">City</p>
                                                <p className="font-bold">{acqFormData.acq_city || "N/A"}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-white/30 font-bold uppercase">State</p>
                                                <p className="font-bold">{acqFormData.acq_state || "N/A"}</p>
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-white/30 font-bold uppercase">Acquired On</p>
                                            <p className="font-bold">{acqFormData.acq_date || "N/A"}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-8 flex flex-col items-center justify-center bg-[#111111] p-6 rounded-xl border border-white/10">
                                    <div className="w-32 h-32 bg-[#0a0a0a] p-2 border border-white/10 shadow-sm">
                                        <img
                                            src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`https://rawgraded.com/?cert=${editingAcquisition.id}`)}`}
className = "w-full h-full grayscale"
alt = "Verification QR"
    />
                                    </div >
    <p className="text-[9px] text-gray-400 font-bold uppercase mt-4 text-center">Scan to Verify Digital Asset Certificate</p>
                                </div >
                            </div >
                        </div >

    <div className="mt-12 pt-8 border-t border-white/10 flex justify-between items-end">
        <div className="opacity-30 flex gap-4 grayscale">
            <img src="/rawgraded-logo.png" className="h-6" alt="RawGraded Logo" />
        </div>
        <p className="text-[9px] font-black text-gray-400 tracking-[0.4em] uppercase">Private Internal Asset Record - v1.0 Production</p>
    </div>
                    </div >
                )}
            </div >

    {/* 3D Viewer Modal */}
    {threeDOpen && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-4xl bg-[#0b0b0b] border border-white/10 rounded-sm shadow-2xl overflow-hidden max-h-[96vh] sm:max-h-[92vh] flex flex-col">
                <div className="flex items-center justify-between p-3 sm:p-4 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-full flex items-center justify-center">
                            <i className="fas fa-cube text-[#D4AF37]"></i>
                        </div>
                        <div>
                            <div className="text-sm font-black uppercase tracking-widest">3D Card</div>
                            <div className="text-[10px] text-white/40 uppercase tracking-widest">{threeDCertId ? `Cert ${threeDCertId.slice(0, 8)}…` : ''}</div>
                            <div className="text-[9px] text-white/50 font-bold uppercase tracking-wide mt-1">
                                First 3D for this card: <span className="text-[#D4AF37]">2 Pro Credits</span> · reopen anytime free
                            </div>
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

                    {!threeDFrontTexture || !threeDBackTexture || !threeDHeightGridJson ? (
                        <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
                            <i className={`fas fa-circle-notch text-4xl text-[#D4AF37] mb-4 ${threeDBusy ? 'fa-spin' : ''}`} aria-hidden />
                            <div className="text-[#D4AF37] font-black uppercase tracking-widest text-sm">
                                {threeDBusy
                                    ? threeDNeedsGeneration
                                        ? '3D generation started'
                                        : threeDNeedsGeneration === false
                                          ? 'Loading 3D…'
                                          : 'Preparing…'
                                    : 'Could not load 3D'}
                            </div>
                            <div className="text-white/50 text-xs mt-2 max-w-md">
                                {threeDBusy
                                    ? threeDNeedsGeneration
                                        ? 'Building the micro-relief map with AI. This can take up to a minute — keep this tab open.'
                                        : threeDNeedsGeneration === false
                                          ? 'Assembling textures and normal map.'
                                          : 'Contacting server…'
                                    : 'See the message above or close and try again.'}
                            </div>
                            <div className="text-[10px] text-white/35 uppercase tracking-widest mt-4 max-w-md">
                                First-time 3D uses <span className="text-[#D4AF37]">2 Pro Credits</span> per card. After that, viewing is free.
                            </div>
                        </div>
                    ) : (
                        <Card3DViewer
                            frontTexture={threeDFrontTexture}
                            backTexture={threeDBackTexture}
                            heightGridJson={threeDHeightGridJson}
                            isHolographic={threeDIsHolographic}
                            holoPattern={threeDEffectiveHoloPattern}
                            normalStrength={parseHeightGridStrength(threeDHeightGridMeta) ?? undefined}
                            year={threeDYear}
                            cardSet={threeDCardSet}
                            showLightingControls={true}
                            showAdminCameraControls={(user.role || 'user') === 'admin'}
                            className="w-full max-w-[320px] sm:max-w-[500px] mx-auto"
                        />
                    )}

                    {!threeDBusy && threeDHeightGridJson && threeDIsHolographic && (
                        <div className="mt-3 p-3 border border-white/10 bg-white/5 rounded-lg">
                            <div className="text-[10px] font-black uppercase tracking-widest text-white/65">
                                Holo Pattern
                            </div>
                            <div className="text-[10px] text-white/45 mt-1">
                                {threeDHoloPatternNeedsReview
                                    ? 'Detection is uncertain. Pick the closest foil style for accurate 3D shimmer.'
                                    : 'Detected foil style. Change it if this card looks off.'}
                            </div>
                            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    ['standard', 'Standard'],
                                    ['reverse', 'Reverse Holo'],
                                    ['full_art', 'Full Art'],
                                    ['swirl', 'Swirl'],
                                    ['cosmos', 'Cosmos'],
                                    ['galaxy', 'Galaxy'],
                                    ['cracked_ice', 'Cracked Ice'],
                                    ['none', 'Not Holo'],
                                ].map(([id, label]) => {
                                    const active = threeDEffectiveHoloPattern === id;
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => setThreeDHoloPatternOverride(id)}
                                            className={`px-2 py-2 rounded border text-[10px] font-black uppercase tracking-widest transition-colors ${
                                                active
                                                    ? 'border-[#D4AF37]/60 bg-[#D4AF37]/15 text-[#D4AF37]'
                                                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                            {threeDHoloPatternOverride && (
                                <button
                                    type="button"
                                    onClick={() => setThreeDHoloPatternOverride(null)}
                                    className="mt-2 text-[10px] uppercase tracking-widest text-white/55 hover:text-white"
                                >
                                    Use detected pattern ({normalizeHoloPattern(threeDHoloPattern)})
                                </button>
                            )}
                        </div>
                    )}

                    {threeDCertId && threeDHeightGridJson && (
                        <div className="mt-4">
                            <button
                                disabled={threeDBusy || !threeDCertId}
                                onClick={() => { void regenerate3DForCert(threeDCertId); }}
                                className="w-full py-3 bg-[#990000]/15 hover:bg-[#990000]/25 border border-[#990000]/30 text-[#990000] font-black uppercase tracking-widest text-[10px] rounded-xl transition-all disabled:opacity-40"
                            >
                                {threeDBusy
                                    ? <><i className="fas fa-circle-notch fa-spin mr-2"></i> Regenerating…</>
                                    : <><i className="fas fa-wand-magic-sparkles mr-2"></i> Regenerate 3D</>}
                            </button>

                            <div className="mt-2 text-[10px] text-white/35 uppercase tracking-widest">
                                Regenerate 3D charges <span className="text-[#D4AF37] font-bold">2 Pro Credits</span> and overwrites the previous 3D.
                            </div>
                            <div className="mt-1 text-[10px] text-white/30 uppercase tracking-widest">
                                Regeneration will automatically run remove.bg for any missing cut-outs (front_thumb / back_thumb) so your new model uses the clean cut-outs.
                            </div>
                            <div className="mt-1 text-[10px] text-white/30 uppercase tracking-widest">
                                Removing the backdrop costs <span className="text-[#D4AF37] font-bold">1 Pro Credit</span> per remove.bg call (front and/or back).
                            </div>
                        </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-col gap-1 flex-1 min-w-[260px]">
                            <div className="text-[10px] text-white/30 uppercase tracking-widest font-bold">Share Link (Public)</div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    value={threeDShareUrl}
                                    placeholder="Generate a share link to view in 3D"
                                    className="flex-1 bg-white/5 border border-white/10 text-white px-3 py-2 rounded-sm text-xs"
                                />
                                <button
                                    disabled={threeDBusy || !threeDCertId}
                                    onClick={() => { void create3DShareLink(); }}
                                    className="px-4 py-2 bg-[#990000] hover:opacity-90 disabled:opacity-50 text-white font-black rounded-sm text-xs uppercase tracking-widest"
                                >
                                    <i className="fas fa-share-alt mr-2"></i>
                                    Create
                                </button>
                                <button
                                    disabled={!threeDShareUrl}
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(threeDShareUrl);
                                        } catch {
                                            // ignore clipboard failures
                                        }
                                    }}
                                    className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white font-black rounded-sm text-xs uppercase tracking-widest"
                                >
                                    <i className="fas fa-copy mr-2"></i>Copy
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )}

    {/* Plugin Integration at the bottom */ }
    < VaultNumberingPlugin
ref = { numberingPluginRef }
scans = { scans }
user = { user }
onRefresh = { fetchCollection }
onSelect = { onSelect }
onRegrade = { onRegrade || (() => {}) }
    />

    {/* PSA Vault Plugin */}
    <PSAVaultPlugin 
        ref={psaVaultRef} 
        user={user} 
        onSlabsLoaded={(loaded) => setPsaSlabs(loaded)}
        onAuthenticate={(id) => onAuthenticate?.(id)}
    />

    {/* Display Vaults Control Plugin */}
    <DisplayVaultControlPlugin
        ref={displayVaultRef}
        user={user}
        scans={scans}
        psaSlabs={psaSlabs}
        onVaultsChanged={() => fetchCollection()}
    />

    < div className = "flex flex-col items-center gap-2 mt-12 pb-8" >
                <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center border border-white/10 group-hover:border-poke-accent transition-colors">
                    <i className="fas fa-shield-alt text-2xl text-poke-accent/50 group-hover:text-poke-accent transition-colors"></i>
                </div>
                <span className="text-[10px] font-black text-white/30 tracking-[0.2em] group-hover:text-white/50 transition-colors">PRODUCTION VERSION 2.5.0</span>
            </div >

    {/* Rename Modal */ }
{
    editingRename && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-poke-dark border border-gray-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                    <h3 className="font-bold text-white uppercase tracking-wider text-sm"><i className="fas fa-edit text-poke-accent mr-2"></i> Edit Asset</h3>
                    <button onClick={() => setEditingRename(null)} className="text-gray-500 hover:text-white"><i className="fas fa-times"></i></button>
                </div>
                <div className="p-4 space-y-4">
                    <div className="space-y-1">
                        <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">New Title</label>
                        <input
                            type="text"
                            className="w-full bg-black/50 border border-gray-700 p-2 rounded text-white text-sm focus:border-poke-accent outline-none"
                            value={editingRename.name}
                            onChange={e => setEditingRename({ ...editingRename, name: e.target.value })}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-3">
                        <label className="flex items-center justify-between gap-3 cursor-pointer">
                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">First Edition</span>
                            <input
                                type="checkbox"
                                checked={editingRename.isFirstEdition}
                                onChange={e => setEditingRename({ ...editingRename, isFirstEdition: e.target.checked })}
                                className="h-4 w-4 rounded border-gray-700 bg-black/50 text-poke-accent focus:ring-poke-accent/50"
                            />
                        </label>
                        <label className="flex items-center justify-between gap-3 cursor-pointer">
                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Holographic</span>
                            <input
                                type="checkbox"
                                checked={editingRename.isHolographic}
                                onChange={e => setEditingRename({ ...editingRename, isHolographic: e.target.checked })}
                                className="h-4 w-4 rounded border-gray-700 bg-black/50 text-poke-accent focus:ring-poke-accent/50"
                            />
                        </label>
                    </div>

                    <div className="bg-blue-900/20 border border-blue-500/20 p-3 rounded-lg flex gap-3 text-xs text-blue-300 items-start">
                        <i className="fas fa-info-circle mt-0.5"></i>
                        <p>
                            Title edits are permanently recorded in the asset's immutable audit trail for transparency.
                        </p>
                    </div>
                </div>
                <div className="p-4 border-t border-gray-800 flex justify-end gap-2">
                    <button onClick={() => setEditingRename(null)} className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-white uppercase tracking-wider">Cancel</button>
                    <button onClick={handleRename} className="px-4 py-2 text-xs font-black bg-poke-accent text-black rounded uppercase tracking-wider hover:bg-white transition-colors">Save Changes</button>
                </div>
            </div>
        </div>
    )
}

{editingSetName && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-poke-dark border border-gray-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                    <h3 className="font-bold text-white uppercase tracking-wider text-sm"><i className="fas fa-layer-group text-poke-accent mr-2"></i> Edit Set & Year</h3>
                    <button onClick={() => setEditingSetName(null)} className="text-gray-500 hover:text-white"><i className="fas fa-times"></i></button>
                </div>
                <div className="p-4 space-y-4">
                    <div className="space-y-1">
                        <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Set Name</label>
                        <input
                            type="text"
                            className="w-full bg-black/50 border border-gray-700 p-2 rounded text-white text-sm focus:border-poke-accent outline-none"
                            value={editingSetName.card_set}
                            onChange={e => setEditingSetName({ ...editingSetName, card_set: e.target.value })}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Year</label>
                        <input
                            type="text"
                            className="w-full bg-black/50 border border-gray-700 p-2 rounded text-white text-sm focus:border-poke-accent outline-none"
                            placeholder="e.g. 1999"
                            value={editingSetName.year}
                            onChange={e => setEditingSetName({ ...editingSetName, year: e.target.value })}
                        />
                    </div>
                </div>
                <div className="p-4 border-t border-gray-800 flex justify-end gap-2">
                    <button onClick={() => setEditingSetName(null)} className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-white uppercase tracking-wider">Cancel</button>
                    <button onClick={handleSetNameUpdate} className="px-4 py-2 text-xs font-black bg-poke-accent text-black rounded uppercase tracking-wider hover:bg-white transition-colors">Save</button>
                </div>
            </div>
        </div>
    )
}

{/* The Insurance Ledger Modal Overlay */ }
{
    showLedger && (
        <InsuranceLedger
            user={user}
            scans={scans}
            psaSlabs={psaSlabs}
            unlockedMarketKeys={unlockedMarketKeys}
            onClose={() => setShowLedger(false)}
        />
    )
}

{/* Sticky Bulk Action Footer */ }
{
    isBulkMode && selectedCerts.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-poke-dark border-t border-poke-accent/50 p-4 shadow-[0_-10px_30px_rgba(0,0,0,0.8)] z-50 transform transition-transform">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <span className="bg-poke-accent text-white px-3 py-1 rounded-full text-sm font-black shadow-lg">
                        {selectedCerts.size} Selected
                    </span>
                    <span className="text-gray-400 text-sm font-bold uppercase tracking-wider hidden sm:inline">Bulk Actions</span>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => handleBulkAction('mark_1st')}
                        className="bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 hover:bg-yellow-500 hover:text-black px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors shrink-0"
                    >
                        <i className="fas fa-star mr-2"></i>Mark 1st Ed
                    </button>
                    <button
                        onClick={() => handleBulkAction('mark_holo')}
                        className="bg-poke-accent/20 text-poke-accent border border-poke-accent/50 hover:bg-poke-accent hover:text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors shrink-0"
                    >
                        <i className="fas fa-sparkles mr-2"></i>Mark Holo
                    </button>
                    <button
                        onClick={() => handleBulkAction('unmark_tags')}
                        className="bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors shrink-0"
                    >
                        <i className="fas fa-times-circle mr-2"></i>Unmark Tags
                    </button>
                    <button
                        onClick={() => handleBulkAction('change_set')}
                        className="bg-blue-500/20 text-blue-400 border border-blue-500/50 hover:bg-blue-500 hover:text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
                    >
                        <i className="fas fa-layer-group mr-2"></i>Change Set
                    </button>
                    <button
                        onClick={() => handleBulkAction('hide')}
                        className="bg-purple-500/20 text-purple-400 border border-purple-500/50 hover:bg-purple-500 hover:text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
                    >
                        <i className="fas fa-eye-slash mr-2"></i>Hide
                    </button>
                    <button
                        onClick={() => handleBulkAction('unhide')}
                        className="bg-gray-700/50 text-gray-400 border border-gray-600 hover:bg-gray-600 hover:text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
                    >
                        <i className="fas fa-eye mr-2"></i>Unhide
                    </button>
                </div>
            </div>
        </div>
    )
}
        </div >
    );
};

export default MyCollection;











