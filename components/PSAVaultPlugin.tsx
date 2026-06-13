import React, {
    useState,
    useEffect,
    forwardRef,
    useImperativeHandle,
} from 'react';
import type { PSASlab, UserProfile } from '../types';
import { Html5Qrcode } from 'html5-qrcode';
import { AuthCertificateModal } from './AuthCertificateModal';
import RemoveBgVaultDisplayPlugin from './RemoveBgVaultDisplayPlugin';

// ─────────────────────────────────────────────────────────────────────────────
// Types & helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface PSAVaultPluginHandle {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    refresh: () => void;
}

interface PSAVaultPluginProps {
    user: UserProfile;
    onSlabsLoaded?: (slabs: PSASlab[]) => void;
    onAuthenticate?: (slabId: number) => void;
}

function computeMatchPct(psaGrade: string | null, rgGrade: number | null): number | null {
    if (psaGrade === null || rgGrade === null) return null;
    const psa = parseFloat(psaGrade);
    if (isNaN(psa)) return null;
    const diff = Math.abs(psa - rgGrade);
    return Math.max(0, Math.min(100, Math.round(100 - diff * 10)));
}

function MatchBadge({ pct }: { pct: number | null }) {
    if (pct === null) return null;
    const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
    return (
        <span
            style={{
                background: `${color}22`,
                border: `1px solid ${color}55`,
                color,
                fontSize: 9,
                fontWeight: 900,
                padding: '2px 6px',
                borderRadius: 4,
                letterSpacing: '0.05em',
                display: 'inline-block',
            }}
        >
            {pct}% MATCH
        </span>
    );
}

function GradeBadge({ grade, label }: { grade: string | null; label: string }) {
    if (!grade) return <span className="text-white/20 text-[10px]">—</span>;
    const num = parseFloat(grade);
    const color = !isNaN(num) && num >= 9 ? '#D4AF37' : '#e2e8f0';
    return (
        <div className="text-center">
            <div style={{ color, fontSize: 13, fontWeight: 900 }}>{grade}</div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
        </div>
    );
}

function fmtCurrency(v: number | null) {
    if (v === null || v === undefined) return '—';
    return `$${v.toFixed(2)}`;
}

function totalCost(slab: PSASlab): number {
    return (slab.acq_price ?? 0) + (slab.acq_grading_fee ?? 0) + (slab.acq_shipping ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Slab Modal
// ─────────────────────────────────────────────────────────────────────────────

interface AddSlabModalProps {
    onClose: () => void;
    onAdded: () => void;
}

const AddSlabModal: React.FC<AddSlabModalProps> = ({ onClose, onAdded }) => {
    const [scorerHouse, setScorerHouse] = useState<'PSA' | 'BGS' | 'CGC'>('PSA');
    const [serial, setSerial] = useState('');
    const [preview, setPreview] = useState<Partial<PSASlab> | null>(null);
    const [lookupError, setLookupError] = useState<string | null>(null);
    const [lookupLoading, setLookupLoading] = useState(false);
    const [acqPrice, setAcqPrice] = useState('');
    const [acqGrading, setAcqGrading] = useState('');
    const [acqShipping, setAcqShipping] = useState('');
    const [acqDate, setAcqDate] = useState('');
    const [acqSource, setAcqSource] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const handleLookup = async (lookupSerial: string = serial) => {
        const target = lookupSerial.trim();
        if (!target) return;
        setSerial(target);
        setLookupLoading(true);
        setLookupError(null);
        setPreview(null);
        try {
            const resp = await fetch(
                `api/plugin_psa_vault.php?action=lookup&serial=${encodeURIComponent(target)}&grader=${encodeURIComponent(scorerHouse)}`,
                { credentials: 'include' }
            );
            const data = await resp.json();
            if (!resp.ok || data.error) {
                setLookupError(data.error ?? 'Lookup failed.');
            } else if (data.already_in_vault) {
                setLookupError('This slab is already in your vault.');
            } else {
                setPreview(data.slab);
            }
        } catch {
            setLookupError('Network error. Check your connection.');
        } finally {
            setLookupLoading(false);
        }
    };

    useEffect(() => {
        if (preview || saving || lookupLoading) return;

        let isScanning = true;
        const qr = new Html5Qrcode('psa-reader');

        const extractSerial = (text: string): string => {
            if (scorerHouse === 'PSA') {
                const matchUrl = text.match(/(?:cert\/|uid=)(\d{7,10})/i);
                if (matchUrl?.[1]) return matchUrl[1];
                const matchDirect = text.match(/\b(\d{7,10})\b/);
                if (matchDirect?.[1]) return matchDirect[1];
                return '';
            } else {
                const cleaned = text.replace(/[^a-zA-Z0-9]/g, '');
                return cleaned.length >= 7 ? cleaned : '';
            }
        };

        qr.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 260, height: 110 }, aspectRatio: 1.5 },
            (decodedText) => {
                if (!isScanning) return;
                const extracted = extractSerial(decodedText);
                if (extracted) {
                    isScanning = false;
                    qr.stop().then(() => qr.clear()).catch(e => console.error(e));
                    handleLookup(extracted);
                }
            },
            () => {}
        ).catch(err => console.error('Slab scanner start failed:', err));

        return () => {
            isScanning = false;
            qr.stop().then(() => qr.clear()).catch(() => {});
        };
    }, [preview, saving, lookupLoading, scorerHouse]);

    const handleSave = async () => {
        if (!preview) return;
        setSaving(true);
        setSaveError(null);
        try {
            const resp = await fetch(`api/plugin_psa_vault.php?action=add`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    psa_serial: serial.trim(),
                    grader: scorerHouse,
                    acq_price: acqPrice ? parseFloat(acqPrice) : null,
                    acq_grading_fee: acqGrading ? parseFloat(acqGrading) : null,
                    acq_shipping: acqShipping ? parseFloat(acqShipping) : null,
                    acq_date: acqDate || null,
                    acq_source: acqSource || null,
                }),
            });
            const data = await resp.json();
            if (!resp.ok || data.error) {
                setSaveError(data.error ?? 'Save failed.');
            } else {
                onAdded();
                onClose();
            }
        } catch {
            setSaveError('Network error. Try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <div
                style={{
                    background: 'linear-gradient(160deg, #0e0e14 0%, #121218 100%)',
                    border: '1px solid rgba(212,175,55,0.25)',
                    borderRadius: 16,
                    width: '100%',
                    maxWidth: 460,
                    boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
                    overflow: 'hidden',
                }}
            >
                {/* Header */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ fontWeight: 900, color: '#D4AF37', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                            <i className="fas fa-plus-circle mr-2" />Add Graded Slab
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Look up a slab cert by serial number</div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 8, padding: '6px 10px', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 14 }}
                    >
                        <i className="fas fa-times" />
                    </button>
                </div>

                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Grader Selection */}
                    {!preview && (
                        <div style={{ display: 'flex', gap: 6 }}>
                            {(['PSA', 'BGS', 'CGC'] as const).map(g => (
                                <button
                                    key={g}
                                    onClick={() => setScorerHouse(g)}
                                    style={{
                                        flex: 1,
                                        padding: '8px 0',
                                        borderRadius: 8,
                                        border: scorerHouse === g ? '1px solid #D4AF37' : '1px solid rgba(255,255,255,0.1)',
                                        background: scorerHouse === g ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.02)',
                                        color: scorerHouse === g ? '#D4AF37' : 'rgba(255,255,255,0.4)',
                                        fontSize: 11,
                                        fontWeight: 900,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {g}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Serial lookup */}
                    {!preview && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {lookupLoading ? (
                                <div style={{ height: 260, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
                                    <i className="fas fa-spinner fa-spin text-3xl text-[#D4AF37]" />
                                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Verifying Slab...</div>
                                </div>
                            ) : (
                                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {/* The scanner renders into this element */}
                                    <div id="psa-reader" style={{ width: '100%', minHeight: 220, borderRadius: 8, overflow: 'hidden', background: '#000' }}></div>
                                    
                                    <div style={{ textAlign: 'center', fontSize: 10, color: '#D4AF37', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                        <i className="fas fa-circle text-[6px] animate-pulse" />
                                        Scanning — point camera at slab barcode or QR code
                                        <i className="fas fa-circle text-[6px] animate-pulse" />
                                    </div>

                                    {/* Manual serial entry fallback */}
                                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <input
                                            type="text"
                                            value={serial}
                                            onChange={e => setSerial(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && serial.trim()) handleLookup(); }}
                                            placeholder="Or enter serial # manually..."
                                            style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 12px', color: 'white', fontSize: 12, outline: 'none', fontFamily: 'monospace' }}
                                        />
                                        <button
                                            onClick={() => handleLookup()}
                                            disabled={!serial.trim()}
                                            style={{ background: 'linear-gradient(135deg,#D4AF37,#B8962E)', border: 'none', borderRadius: 8, padding: '10px 16px', color: '#000', fontWeight: 900, fontSize: 11, cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: serial.trim() ? 1 : 0.4 }}
                                        >
                                            <i className="fas fa-search mr-1" />Lookup
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {lookupError && (
                        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 11, fontWeight: 700 }}>
                            <i className="fas fa-exclamation-circle mr-2" />{lookupError}
                        </div>
                    )}

                    {/* Preview card */}
                    {preview && (
                        <>
                            <div style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: 10, padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                                {preview.front_img_url ? (
                                    <img src={preview.front_img_url} alt="PSA slab" style={{ width: 52, height: 72, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(212,175,55,0.3)' }} />
                                ) : (
                                    <div style={{ width: 52, height: 72, background: 'rgba(255,255,255,0.04)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <i className="fas fa-image" style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16 }} />
                                    </div>
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 900, color: 'white', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{preview.card_name ?? 'Unknown Card'}</div>
                                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{[preview.card_set, preview.card_year, preview.card_number].filter(Boolean).join(' · ')}</div>
                                    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <span style={{ background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.4)', color: '#D4AF37', fontSize: 11, fontWeight: 900, padding: '3px 8px', borderRadius: 5, letterSpacing: '0.06em' }}>
                                            {scorerHouse} {preview.psa_grade}
                                        </span>
                                        {preview.psa_grade_desc && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{preview.psa_grade_desc}</span>}
                                    </div>
                                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 6, fontFamily: 'monospace' }}>Serial #{serial}</div>
                                </div>
                            </div>

                            {/* Acquisition cost fields */}
                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
                                <div style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Acquisition Costs (Optional)</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    {[
                                        { label: 'Purchase Price', value: acqPrice, setter: setAcqPrice, prefix: '$' },
                                        { label: 'Grading Fee', value: acqGrading, setter: setAcqGrading, prefix: '$' },
                                        { label: 'Shipping', value: acqShipping, setter: setAcqShipping, prefix: '$' },
                                        { label: 'Source / Seller', value: acqSource, setter: setAcqSource, prefix: '' },
                                    ].map(({ label, value, setter, prefix }) => (
                                        <div key={label}>
                                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                                            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, overflow: 'hidden' }}>
                                                {prefix && <span style={{ padding: '8px 6px 8px 10px', color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 700 }}>{prefix}</span>}
                                                <input
                                                    type={prefix === '$' ? 'number' : 'text'}
                                                    value={value}
                                                    onChange={e => setter(e.target.value)}
                                                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: prefix ? '8px 10px 8px 0' : '8px 10px', color: 'white', fontSize: 12, fontWeight: 700, minWidth: 0 }}
                                                    min={0}
                                                    step="0.01"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                    <div style={{ gridColumn: '1/-1' }}>
                                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Date Acquired</div>
                                        <input
                                            type="date"
                                            value={acqDate}
                                            onChange={e => setAcqDate(e.target.value)}
                                            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', color: 'white', fontSize: 12, fontWeight: 700, outline: 'none', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {saveError && (
                                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 11, fontWeight: 700 }}>
                                    <i className="fas fa-exclamation-circle mr-2" />{saveError}
                                </div>
                            )}

                            <button
                                onClick={handleSave}
                                disabled={saving}
                                style={{
                                    width: '100%',
                                    background: 'linear-gradient(135deg, #D4AF37, #B8962E)',
                                    border: 'none',
                                    borderRadius: 10,
                                    padding: '12px',
                                    color: '#000',
                                    fontWeight: 900,
                                    fontSize: 12,
                                    cursor: 'pointer',
                                    letterSpacing: '0.1em',
                                    textTransform: 'uppercase',
                                    opacity: saving ? 0.6 : 1,
                                }}
                            >
                                {saving ? <><i className="fas fa-spinner fa-spin mr-2" />Saving…</> : <><i className="fas fa-check-circle mr-2" />Add to PSA Vault</>}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Link-to-Certificate Modal (picker of existing RawGraded certs)
// ─────────────────────────────────────────────────────────────────────────────

interface LinkModalProps {
    slabId: number;
    userId: string;
    onClose: () => void;
    onLinked: () => void;
}

const LinkModal: React.FC<LinkModalProps> = ({ slabId, userId, onClose, onLinked }) => {
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [linking, setLinking] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => {
            if (search.length < 2) { setResults([]); return; }
            fetch(`api/collection.php?user_id=${userId}&q=${encodeURIComponent(search)}`, { credentials: 'include' })
                .then(r => r.json())
                .then(d => setResults(Array.isArray(d) ? d.slice(0, 10) : []));
        }, 300);
        return () => clearTimeout(t);
    }, [search]);

    const handleLink = async (certId: string) => {
        setLinking(true);
        await fetch('api/plugin_psa_vault.php?action=link', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slab_id: slabId, cert_id: certId }),
        });
        setLinking(false);
        onLinked();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <div style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, width: '100%', maxWidth: 400, boxShadow: '0 30px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 900, color: 'white', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}><i className="fas fa-link mr-2 text-blue-400" />Link to RawGraded Cert</div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 14 }}><i className="fas fa-times" /></button>
                </div>
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by card name or set…"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 12px', color: 'white', fontSize: 12, outline: 'none' }}
                        autoFocus
                    />
                    <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {results.length === 0 && search.length >= 2 && (
                            <div style={{ textAlign: 'center', padding: '20px 0', color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>No results found</div>
                        )}
                        {results.map(cert => (
                            <button
                                key={cert.id}
                                onClick={() => handleLink(cert.id)}
                                disabled={linking}
                                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.15s' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                            >
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 800, color: 'white', fontSize: 11, textTransform: 'uppercase' }}>{cert.name}</div>
                                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{cert.card_set} · {cert.year}</div>
                                </div>
                                <div style={{ fontWeight: 900, color: '#D4AF37', fontSize: 13 }}>{cert.overall_grade}</div>
                                <i className="fas fa-chevron-right" style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }} />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Edit Costs Modal
// ─────────────────────────────────────────────────────────────────────────────

interface EditCostsModalProps {
    slab: PSASlab;
    onClose: () => void;
    onSaved: () => void;
}

const EditCostsModal: React.FC<EditCostsModalProps> = ({ slab, onClose, onSaved }) => {
    const [price, setPrice] = useState(slab.acq_price?.toString() ?? '');
    const [grading, setGrading] = useState(slab.acq_grading_fee?.toString() ?? '');
    const [shipping, setShipping] = useState(slab.acq_shipping?.toString() ?? '');
    const [date, setDate] = useState(slab.acq_date ?? '');
    const [source, setSource] = useState(slab.acq_source ?? '');
    const [notes, setNotes] = useState(slab.user_notes ?? '');
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        await fetch('api/plugin_psa_vault.php?action=update_acq', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slab_id: slab.id,
                acq_price: price ? parseFloat(price) : null,
                acq_grading_fee: grading ? parseFloat(grading) : null,
                acq_shipping: shipping ? parseFloat(shipping) : null,
                acq_date: date || null,
                acq_source: source || null,
                user_notes: notes || null,
            }),
        });
        setSaving(false);
        onSaved();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <div style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, width: '100%', maxWidth: 400, boxShadow: '0 30px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 900, color: 'white', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}><i className="fas fa-dollar-sign mr-2 text-green-400" />Edit Acquisition Costs</div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 14 }}><i className="fas fa-times" /></button>
                </div>
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                        { label: 'Purchase Price', value: price, setter: setPrice, type: 'number' },
                        { label: 'Grading Fee', value: grading, setter: setGrading, type: 'number' },
                        { label: 'Shipping', value: shipping, setter: setShipping, type: 'number' },
                        { label: 'Source / Seller', value: source, setter: setSource, type: 'text' },
                        { label: 'Date Acquired', value: date, setter: setDate, type: 'date' },
                        { label: 'Notes', value: notes, setter: setNotes, type: 'text' },
                    ].map(({ label, value, setter, type }) => (
                        <div key={label}>
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                            <input
                                type={type}
                                value={value}
                                onChange={e => setter(e.target.value)}
                                style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '8px 10px', color: 'white', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                                min={type === 'number' ? 0 : undefined}
                                step={type === 'number' ? '0.01' : undefined}
                            />
                        </div>
                    ))}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{ marginTop: 6, width: '100%', background: 'linear-gradient(135deg,#22c55e,#16a34a)', border: 'none', borderRadius: 10, padding: '11px', color: 'white', fontWeight: 900, fontSize: 11, cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase', opacity: saving ? 0.6 : 1 }}
                    >
                        {saving ? <i className="fas fa-spinner fa-spin mr-2" /> : <i className="fas fa-save mr-2" />}Save
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Edit Images Modal
// ─────────────────────────────────────────────────────────────────────────────

interface EditImagesModalProps {
    slab: PSASlab;
    onClose: () => void;
    onSaved: () => void;
}

const EditImagesModal: React.FC<EditImagesModalProps> = ({ slab, onClose, onSaved }) => {
    const asAny = slab as any;
    const [frontImg, setFrontImg] = useState<string>(asAny.local_front_img || '');
    const [backImg, setBackImg] = useState<string>(asAny.local_back_img || '');
    const [uploadingFront, setUploadingFront] = useState(false);
    const [uploadingBack, setUploadingBack] = useState(false);

    const handleUpload = async (side: 'front' | 'back', file: File) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const b64 = e.target?.result as string;
            if (side === 'front') setUploadingFront(true);
            else setUploadingBack(true);

            try {
                const resp = await fetch('api/plugin_psa_vault.php?action=upload_image', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ slab_id: slab.id, side, b64 }),
                });
                const data = await resp.json();
                if (data.success) {
                    if (side === 'front') setFrontImg(b64);
                    else setBackImg(b64);
                    onSaved(); // trigger refetch in parent
                }
            } catch (err) {
                console.error("Upload failed", err);
            } finally {
                if (side === 'front') setUploadingFront(false);
                else setUploadingBack(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const triggerFile = (side: 'front' | 'back') => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e: any) => {
            if (e.target.files && e.target.files[0]) {
                handleUpload(side, e.target.files[0]);
            }
        };
        input.click();
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <div style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 30px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 900, color: 'white', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.1em' }}><i className="fas fa-camera mr-2 text-blue-400" />Slab Media</div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 14 }}><i className="fas fa-times" /></button>
                </div>
                
                <div style={{ padding: 20, display: 'flex', gap: 16 }}>
                    {/* Front Image */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>Front</div>
                        <div 
                            onClick={() => !uploadingFront && triggerFile('front')}
                            style={{ 
                                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, 
                                height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploadingFront ? 'wait' : 'pointer',
                                overflow: 'hidden', position: 'relative'
                            }}
                        >
                            {uploadingFront ? (
                                <i className="fas fa-spinner fa-spin text-white/50 text-2xl" />
                            ) : frontImg ? (
                                <img src={frontImg} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Front" />
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.2)' }}>
                                    <i className="fas fa-plus-circle text-2xl" />
                                    <span style={{ fontSize: 10, fontWeight: 700 }}>Add Front</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Back Image */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>Back</div>
                        <div 
                            onClick={() => !uploadingBack && triggerFile('back')}
                            style={{ 
                                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, 
                                height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploadingBack ? 'wait' : 'pointer',
                                overflow: 'hidden', position: 'relative'
                            }}
                        >
                            {uploadingBack ? (
                                <i className="fas fa-spinner fa-spin text-white/50 text-2xl" />
                            ) : backImg ? (
                                <img src={backImg} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Back" />
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.2)' }}>
                                    <i className="fas fa-plus-circle text-2xl" />
                                    <span style={{ fontSize: 10, fontWeight: 700 }}>Add Back</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
                    <button onClick={onClose} style={{ width: '100%', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 10, padding: 12, color: 'white', fontWeight: 800, fontSize: 11, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Done</button>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Review Modal
// ─────────────────────────────────────────────────────────────────────────────

interface TransferReviewModalProps {
    request: PSASlab;
    onClose: () => void;
    onProcessed: () => void;
}

const TransferReviewModal: React.FC<TransferReviewModalProps> = ({ request, onClose, onProcessed }) => {
    const defaultSoldPrice = request.acq_price?.toString() ?? '';
    const [soldPrice, setSoldPrice] = useState(defaultSoldPrice);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAccept = async () => {
        setLoading(true); setError(null);
        try {
            const resp = await fetch('api/plugin_psa_vault.php?action=transfer_accept', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pending_slab_id: request.id, sold_price: soldPrice ? parseFloat(soldPrice) : null }),
            });
            const data = await resp.json();
            if (data.success) { onProcessed(); onClose(); }
            else setError(data.error || 'Failed to accept transfer.');
        } catch {
            setError('Network error.');
        } finally { setLoading(false); }
    };

    const handleReject = async () => {
        setLoading(true); setError(null);
        try {
            const resp = await fetch('api/plugin_psa_vault.php?action=transfer_reject', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pending_slab_id: request.id }),
            });
            const data = await resp.json();
            if (data.success) { onProcessed(); onClose(); }
            else setError(data.error || 'Failed to reject transfer.');
        } catch {
            setError('Network error.');
        } finally { setLoading(false); }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <div style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, width: '100%', maxWidth: 420, boxShadow: '0 30px 80px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 900, color: 'white', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.1em' }}><i className="fas fa-exchange-alt mr-2 text-yellow-400" />Transfer Request</div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 14 }}><i className="fas fa-times" /></button>
                </div>
                <div style={{ padding: 20 }}>
                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                        User <strong style={{ color: 'white' }}>{request.req_username ?? 'Someone'}</strong> is attempting to add your PSA Slab (<strong style={{ fontFamily: 'monospace', color: '#D4AF37' }}>#{request.psa_serial}</strong>) to their vault.
                    </p>
                    <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 20 }}>
                        If you sold this slab, confirm the transfer to move your record to your <strong>Archived</strong> tab. You will retain your acquisition history. The new owner will not see your cost data.
                    </p>

                    <div style={{ marginBottom: 24 }}>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Record Sold Price (Optional)</div>
                        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px' }}>
                            <span style={{ color: 'rgba(255,255,255,0.4)', marginRight: 8, fontWeight: 700 }}>$</span>
                            <input
                                type="number"
                                value={soldPrice}
                                onChange={e => setSoldPrice(e.target.value)}
                                placeholder="0.00"
                                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'white', fontSize: 14, fontWeight: 700 }}
                            />
                        </div>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}><i className="fas fa-info-circle mr-1" />This value will be saved to your archived record.</div>
                    </div>

                    {error && (
                        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 11, fontWeight: 700, marginBottom: 16 }}>
                            {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 10 }}>
                        <button
                            onClick={handleReject}
                            disabled={loading}
                            style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '12px', color: 'white', fontWeight: 800, fontSize: 11, cursor: 'pointer', letterSpacing: '0.05em', opacity: loading ? 0.6 : 1 }}
                        >
                            Reject Request
                        </button>
                        <button
                            onClick={handleAccept}
                            disabled={loading}
                            style={{ flex: 1.5, background: 'linear-gradient(135deg, #D4AF37, #B8962E)', border: 'none', borderRadius: 10, padding: '12px', color: '#000', fontWeight: 900, fontSize: 11, cursor: 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase', opacity: loading ? 0.6 : 1 }}
                        >
                            {loading ? <i className="fas fa-spinner fa-spin" /> : 'Confirm Transfer'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Plugin Component
// ─────────────────────────────────────────────────────────────────────────────

const PSAVaultPlugin = forwardRef<PSAVaultPluginHandle, PSAVaultPluginProps>(({ user, onSlabsLoaded, onAuthenticate }, ref) => {
    const [isOpen, setIsOpen] = useState(false);
    const [slabs, setSlabs] = useState<PSASlab[]>([]);
    const [loading, setLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [linkingSlabId, setLinkingSlabId] = useState<number | null>(null);
    const [editingCosts, setEditingCosts] = useState<PSASlab | null>(null);
    const [editingImages, setEditingImages] = useState<PSASlab | null>(null);
    const [viewingAuthCheckId, setViewingAuthCheckId] = useState<number | null>(null);
    const [editingSale, setEditingSale] = useState<PSASlab | null>(null);
    const [deleting, setDeleting] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');

    const fetchSlabs = async () => {
        setLoading(true);
        try {
            const resp = await fetch('api/plugin_psa_vault.php?action=list', { credentials: 'include' });
            const data = await resp.json();
            const fetched: PSASlab[] = Array.isArray(data) ? data : [];
            setSlabs(fetched);
            if (onSlabsLoaded) onSlabsLoaded(fetched);
        } catch {
            setSlabs([]);
            if (onSlabsLoaded) onSlabsLoaded([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchSlabs();
    }, [isOpen]);

    useImperativeHandle(ref, () => ({
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        refresh: fetchSlabs,
    }));

    const handleDelete = async (slabId: number) => {
        if (!confirm('Remove this PSA slab from your vault?')) return;
        setDeleting(slabId);
        await fetch('api/plugin_psa_vault.php?action=delete', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slab_id: slabId }),
        });
        setDeleting(null);
        fetchSlabs();
    };

    const handleUnlink = async (slabId: number) => {
        await fetch('api/plugin_psa_vault.php?action=unlink', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slab_id: slabId }),
        });
        fetchSlabs();
    };

    const resolveTransfer = async (slabId: number, resolution: 'accept' | 'decline' | 'dispute') => {
        if (resolution === 'accept' && !confirm('Are you sure you want to transfer digital custody? This cannot be undone.')) return;
        await fetch('api/plugin_psa_vault.php?action=resolve_transfer', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slab_id: slabId, resolution }),
        });
        fetchSlabs();
    };

    const handleSaveSale = async (slabId: number, forSale: boolean, saleLink: string) => {
        await fetch('api/plugin_psa_vault.php?action=toggle_sale', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slab_id: slabId, for_sale: forSale, sale_link: saleLink }),
        });
        setEditingSale(null);
        fetchSlabs();
    };

    // ── Summary stats ──
    const totalSlabs = slabs.length;
    const totalInvestment = slabs.reduce((s, sl) => s + totalCost(sl), 0);
    const linkedCount = slabs.filter(s => s.cert_id).length;
    const avgMatch = (() => {
        const matches = slabs.map(s => computeMatchPct(s.psa_grade, s.rg_grade)).filter((v): v is number => v !== null);
        return matches.length ? Math.round(matches.reduce((a, b) => a + b, 0) / matches.length) : null;
    })();

    if (!isOpen) return null;

    return (
        <>
            {/* Panel overlay */}
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 150,
                    background: 'rgba(0,0,0,0.6)',
                    backdropFilter: 'blur(4px)',
                }}
                onClick={() => setIsOpen(false)}
            />
            <div
                style={{
                    position: 'fixed',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    zIndex: 160,
                    width: '100%',
                    maxWidth: 540,
                    background: 'linear-gradient(180deg, #0a0a10 0%, #0d0d14 100%)',
                    borderLeft: '1px solid rgba(212,175,55,0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '-20px 0 60px rgba(0,0,0,0.7)',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Panel Header */}
                <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#D4AF37,#B8962E)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <i className="fas fa-shield-alt" style={{ fontSize: 12, color: '#000' }} />
                                </div>
                                <div>
                                    <div style={{ fontWeight: 900, color: '#D4AF37', fontSize: 14, letterSpacing: '0.1em', textTransform: 'uppercase' }}>PSA Vault</div>
                                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>Professional Sports Authenticator Slabs</div>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button
                                onClick={() => setShowAddModal(true)}
                                style={{ background: 'linear-gradient(135deg,#D4AF37,#B8962E)', border: 'none', borderRadius: 8, padding: '8px 14px', color: '#000', fontWeight: 900, fontSize: 10, cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase' }}
                            >
                                <i className="fas fa-plus mr-1.5" />Add Slab
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13 }}
                            >
                                <i className="fas fa-times" />
                            </button>
                        </div>
                    </div>

                    {/* Stats bar */}
                    <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                        {[
                            { label: 'Total Slabs', value: totalSlabs },
                            { label: 'Total Invested', value: `$${totalInvestment.toFixed(2)}` },
                            { label: 'RG Linked', value: `${linkedCount}/${totalSlabs}` },
                            { label: 'Avg Match', value: avgMatch !== null ? `${avgMatch}%` : '—' },
                        ].map(({ label, value }) => (
                            <div key={label} style={{ textAlign: 'center', flex: 1 }}>
                                <div style={{ fontWeight: 900, color: 'white', fontSize: 13 }}>{value}</div>
                                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Tabs */}
                    <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', padding: 4, borderRadius: 10, marginTop: 16 }}>
                        {(['active', 'archived'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    flex: 1,
                                    background: activeTab === tab ? 'rgba(255,255,255,0.1)' : 'transparent',
                                    border: 'none',
                                    borderRadius: 6,
                                    padding: '8px 0',
                                    color: activeTab === tab ? 'white' : 'rgba(255,255,255,0.4)',
                                    fontWeight: 800,
                                    fontSize: 11,
                                    cursor: 'pointer',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    transition: 'all 0.2s',
                                }}
                            >
                                {tab} Vault
                            </button>
                        ))}
                    </div>
                </div>

                {/* Slab list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {loading && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                            <i className="fas fa-spinner fa-spin mr-2" />Loading vault…
                        </div>
                    )}

                    {!loading && slabs.length === 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: 12 }}>
                            <div style={{ width: 56, height: 56, background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <i className="fas fa-shield-alt" style={{ fontSize: 22, color: 'rgba(212,175,55,0.4)' }} />
                            </div>
                            <div style={{ fontWeight: 900, color: 'rgba(255,255,255,0.4)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>No PSA Slabs Yet</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center', maxWidth: 260, lineHeight: 1.6 }}>
                                Add your first PSA-graded slab by serial number to begin tracking your physical collection.
                            </div>
                            <button
                                onClick={() => setShowAddModal(true)}
                                style={{ marginTop: 8, background: 'linear-gradient(135deg,#D4AF37,#B8962E)', border: 'none', borderRadius: 10, padding: '10px 20px', color: '#000', fontWeight: 900, fontSize: 11, cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase' }}
                            >
                                <i className="fas fa-plus mr-2" />Add First Slab
                            </button>
                        </div>
                    )}

                    {(() => {
                        const myActiveSlabs = slabs.filter(s => String(s.user_id) === String(user.id) && s.status !== 'archived');
                        const myArchivedSlabs = slabs.filter(s => String(s.user_id) === String(user.id) && s.status === 'archived');

                        const visibleSlabs = activeTab === 'active' ? myActiveSlabs : myArchivedSlabs;

                        return (
                            <>
                                {activeTab === 'archived' && myArchivedSlabs.length === 0 && !loading && (
                                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>No archived slabs history.</div>
                                )}

                                {!loading && visibleSlabs.map(slab => {
                        const matchPct = computeMatchPct(slab.psa_grade, slab.rg_grade);
                        const cost = totalCost(slab);
                        const asAnyInfo = slab as any;
                        const fallbackImg = asAnyInfo.rg_front_thumb || (asAnyInfo.rg_front_img ? `api/collection.php?action=serve_image&id=${asAnyInfo.rg_cert_id}&type=front` : null);
                        const displayImg = asAnyInfo.local_front_img || slab.front_img_url || fallbackImg;
                        return (
                            <div
                                key={slab.id}
                                style={{
                                    background: 'rgba(255,255,255,0.02)',
                                    border: asAnyInfo.transfer_status === 'pending' ? '1px solid rgba(245,158,11,0.5)' : '1px solid rgba(255,255,255,0.07)',
                                    borderRadius: 12,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    overflow: 'hidden',
                                    transition: 'border-color 0.15s',
                                    boxShadow: asAnyInfo.transfer_status === 'pending' ? '0 0 20px rgba(245,158,11,0.1)' : 'none'
                                }}
                            >
                                {/* Pending Transfer Banner */}
                                {asAnyInfo.transfer_status === 'pending' && (
                                    <div style={{ background: 'rgba(245,158,11,0.15)', borderBottom: '1px solid rgba(245,158,11,0.3)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ fontSize: 10, color: '#fcd34d', fontWeight: 700 }}>
                                            <i className="fas fa-handshake mr-2" /> 
                                            <strong style={{ color: 'white' }}>{asAnyInfo.req_username ?? 'A user'}</strong> requested custody
                                        </div>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <button onClick={() => resolveTransfer(slab.id, 'accept')} style={{ background: '#22c55e', border: 'none', color: 'white', padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, cursor: 'pointer', textTransform: 'uppercase' }}>Accept</button>
                                            <button onClick={() => resolveTransfer(slab.id, 'decline')} style={{ background: '#ef4444', border: 'none', color: 'white', padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 900, cursor: 'pointer', textTransform: 'uppercase' }}>Decline</button>
                                        </div>
                                    </div>
                                )}

                                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {/* Top row: image + info + grades */}
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                                    {/* Slab image */}
                                    {displayImg ? (
                                        <img src={displayImg} alt={slab.card_name ?? ''} style={{ width: 44, height: 62, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(212,175,55,0.2)', flexShrink: 0 }} />
                                    ) : (
                                        <div style={{ width: 44, height: 62, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <i className="fas fa-image" style={{ color: 'rgba(255,255,255,0.15)', fontSize: 14 }} />
                                        </div>
                                    )}

                                    {/* Card info */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 900, color: 'white', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.3 }}>{slab.card_name ?? 'Unknown Card'}</div>
                                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
                                            {[slab.card_set, slab.card_year, slab.card_number].filter(Boolean).join(' · ')}
                                        </div>
                                        <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>#{slab.psa_serial}</span>
                                            {matchPct !== null && <MatchBadge pct={matchPct} />}
                                            {slab.status === 'pending_transfer' && (
                                                <span style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.6)', padding: '2px 6px', borderRadius: 4, fontSize: 8, fontWeight: 800, textTransform: 'uppercase' }}>
                                                    Pending Owner Approval
                                                </span>
                                            )}
                                            {slab.status === 'archived' && (
                                                <span style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', padding: '2px 6px', borderRadius: 4, fontSize: 8, fontWeight: 800, textTransform: 'uppercase' }}>
                                                    Archived (Transferred)
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Grade comparison */}
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                                        <GradeBadge grade={slab.psa_grade} label="PSA" />
                                        {slab.rg_grade !== null && (
                                            <>
                                                <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.1)' }} />
                                                <GradeBadge grade={slab.rg_grade?.toFixed(1) ?? null} label="RG" />
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Linked cert bar */}
                                {slab.cert_id && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: 7, padding: '6px 10px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <i className="fas fa-link" style={{ color: '#60a5fa', fontSize: 9 }} />
                                            <span style={{ fontSize: 9, color: '#93c5fd', fontWeight: 700 }}>Linked: {slab.rg_cert_name ?? slab.cert_id.substring(0, 8).toUpperCase()}</span>
                                        </div>
                                        <button
                                            onClick={() => handleUnlink(slab.id)}
                                            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 10, padding: '2px 4px' }}
                                            title="Unlink certificate"
                                        >
                                            <i className="fas fa-unlink" />
                                        </button>
                                    </div>
                                )}

                                {/* Cost + action row */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                                    <div style={{ display: 'flex', gap: 14 }}>
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 900, color: cost > 0 ? 'white' : 'rgba(255,255,255,0.2)' }}>{cost > 0 ? `$${cost.toFixed(2)}` : '—'}</div>
                                            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Cost</div>
                                        </div>
                                        {slab.status === 'archived' && slab.sold_price != null && (
                                            <div>
                                                <div style={{ fontSize: 11, fontWeight: 900, color: '#4ade80' }}>${parseFloat(slab.sold_price.toString()).toFixed(2)}</div>
                                                <div style={{ fontSize: 8, color: '#22c55e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sold For</div>
                                            </div>
                                        )}
                                        {slab.acq_date && (
                                            <div>
                                                <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.5)' }}>{slab.acq_date}</div>
                                                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Acquired</div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        {slab.status === 'active' && (
                                            <>
                                                {!slab.cert_id && (
                                                    <button
                                                        onClick={() => setLinkingSlabId(slab.id)}
                                                        title="Link to RawGraded certificate"
                                                        style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 7, padding: '6px 9px', color: '#60a5fa', cursor: 'pointer', fontSize: 10 }}
                                                    >
                                                        <i className="fas fa-link" />
                                                    </button>
                                                )}
                                                {slab.auth_check_id && (
                                                    <button
                                                        onClick={() => setViewingAuthCheckId(slab.auth_check_id!)}
                                                        title="View Authentication Certificate"
                                                        style={{ background: 'linear-gradient(135deg,rgba(212,175,55,0.25),rgba(184,150,46,0.25))', border: '1px solid rgba(212,175,55,0.5)', borderRadius: 7, padding: '6px 9px', color: '#FFF', textShadow: '0 0 5px rgba(212,175,55,0.5)', cursor: 'pointer', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' }}
                                                    >
                                                        <i className="fas fa-certificate mr-1 text-[#D4AF37]" />Cert
                                                    </button>
                                                )}
                                                {onAuthenticate && (
                                                    <button
                                                        onClick={() => { setIsOpen(false); onAuthenticate(slab.id); }}
                                                        title="Run AI Authenticity Check on this slab"
                                                        style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.35)', borderRadius: 7, padding: '6px 9px', color: '#D4AF37', cursor: 'pointer', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' }}
                                                    >
                                                        <i className="fas fa-shield-alt mr-1" />Auth
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => setEditingImages(slab)}
                                                    title="Upload Slab Media"
                                                    style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 7, padding: '6px 9px', color: '#60a5fa', cursor: 'pointer', fontSize: 10 }}
                                                >
                                                    <i className="fas fa-camera" />
                                                </button>
                                                <RemoveBgVaultDisplayPlugin
                                                    slabId={slab.id}
                                                    frontUrl={displayImg}
                                                    backUrl={asAnyInfo.local_back_img || undefined}
                                                    paidCredits={user.paid_credits || 0}
                                                    isAdmin={user.role === 'admin'}
                                                    onRefreshUser={undefined}
                                                />
                                                <button
                                                    onClick={() => setEditingCosts(slab)}
                                                    title="Edit acquisition costs"
                                                    style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 7, padding: '6px 9px', color: '#4ade80', cursor: 'pointer', fontSize: 10 }}
                                                >
                                                    <i className="fas fa-dollar-sign" />
                                                </button>
                                                {slab.auth_check_id && (
                                                    <button
                                                        onClick={() => setEditingSale(slab)}
                                                        title={asAnyInfo.for_sale ? "Manage Marketplace Listing" : "List on Marketplace"}
                                                        style={{ background: asAnyInfo.for_sale ? 'rgba(34,197,94,0.15)' : 'rgba(168,85,247,0.08)', border: asAnyInfo.for_sale ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(168,85,247,0.2)', borderRadius: 7, padding: '6px 9px', color: asAnyInfo.for_sale ? '#4ade80' : '#c084fc', cursor: 'pointer', fontSize: 10 }}
                                                    >
                                                        <i className="fas fa-store" />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                        {slab.status !== 'pending_transfer' && (
                                            <button
                                                onClick={() => handleDelete(slab.id)}
                                                disabled={deleting === slab.id}
                                                title={slab.status === 'archived' ? "Delete permanently" : "Remove slab"}
                                                style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, padding: '6px 9px', color: '#f87171', cursor: 'pointer', fontSize: 10, opacity: deleting === slab.id ? 0.5 : 1 }}
                                            >
                                                {deleting === slab.id ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-trash-alt" />}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                </div>
                            </div>
                        );
                    })}
                    </>
                        );
                    })()}
                </div>
            </div>

            {/* Sale Listing Modal */}
            {editingSale && (
                <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div style={{ background: '#111', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 16, width: '100%', maxWidth: 400, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}>
                        <h3 style={{ margin: '0 0 16px', color: 'white', fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center' }}>
                            <i className="fas fa-store text-purple-400 mr-2" /> Marketplace Listing
                        </h3>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 20, lineHeight: 1.5 }}>
                            Publish this authenticated slab to the public RawGraded Marketplace. This signals to buyers that the slab is legitimate and actively for sale.
                        </p>
                        
                        <form onSubmit={e => {
                            e.preventDefault();
                            const form = e.target as HTMLFormElement;
                            handleSaveSale(editingSale.id, (form.elements.namedItem('for_sale') as HTMLInputElement).checked, (form.elements.namedItem('sale_link') as HTMLInputElement).value);
                        }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                                <input type="checkbox" name="for_sale" defaultChecked={(editingSale as any).for_sale == 1} style={{ width: 16, height: 16, accentColor: '#a855f7' }} />
                                <span style={{ fontSize: 13, fontWeight: 800, color: 'white' }}>List for Sale Globally</span>
                            </label>
                            
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ display: 'block', margin: '0 0 8px', fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>Ebay / Buy Link (Optional)</label>
                                <input name="sale_link" type="url" defaultValue={(editingSale as any).sale_link ?? ''} placeholder="https://ebay.com/..." style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', padding: '10px 14px', borderRadius: 8, fontSize: 13 }} />
                            </div>
                            
                            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                                <button type="button" onClick={() => setEditingSale(null)} style={{ background: 'transparent', color: 'rgba(255,255,255,0.5)', border: 'none', fontWeight: 800, fontSize: 12, padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" style={{ background: '#a855f7', color: 'white', border: 'none', borderRadius: 8, fontWeight: 900, fontSize: 12, padding: '8px 20px', cursor: 'pointer' }}>Save Settings</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {showAddModal && (
                <AddSlabModal
                    onClose={() => setShowAddModal(false)}
                    onAdded={fetchSlabs}
                />
            )}

            {linkingSlabId !== null && (
                <LinkModal
                    slabId={linkingSlabId}
                    userId={user.id}
                    onClose={() => setLinkingSlabId(null)}
                    onLinked={fetchSlabs}
                />
            )}

            {editingCosts && (
                <EditCostsModal
                    slab={editingCosts}
                    onClose={() => setEditingCosts(null)}
                    onSaved={fetchSlabs}
                />
            )}

            {editingImages && (
                <EditImagesModal
                    slab={editingImages}
                    onClose={() => setEditingImages(null)}
                    onSaved={fetchSlabs}
                />
            )}


            <AuthCertificateModal
                isOpen={viewingAuthCheckId !== null}
                authCheckId={viewingAuthCheckId}
                onClose={() => setViewingAuthCheckId(null)}
            />
        </>
    );
});

PSAVaultPlugin.displayName = 'PSAVaultPlugin';
export default PSAVaultPlugin;
