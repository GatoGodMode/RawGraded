import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import type { UserProfile } from '../types';

// ─── Types ─────────────────────────────────────────────────────────────────────

type GradingHouse = 'PSA' | 'BGS' | 'CGC';
type SearchStep = 'idle' | 'loading' | 'results' | 'error';

interface SlabLookupResult {
  card_name?: string;
  card_set?: string;
  card_year?: string;
  card_number?: string;
  psa_grade?: string;
  psa_grade_desc?: string;
  front_img_url?: string;
  psa_pop?: number | null;
  psa_pop_higher?: number | null;
  total_population?: number | null;
  already_in_vault?: boolean;
  is_claimed?: boolean;
}

interface MarketPrices {
  raw?: number | null;
  psa10?: number | null;
  psa9?: number | null;
  psa8?: number | null;
}

export interface SlabSearchPluginProps {
  user: UserProfile | null;
  onClaimSlab: () => void;
  onRequestLogin: () => void;
  /** When true the floating button is not rendered */
  hidden?: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(v: number | null | undefined): string {
  if (!v) return '—';
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function extractSerial(text: string, grader: GradingHouse): string {
  if (grader === 'PSA') {
    const urlMatch = text.match(/(?:cert\/|uid=)(\d{7,10})/i);
    if (urlMatch?.[1]) return urlMatch[1];
    const numMatch = text.match(/\b(\d{7,10})\b/);
    if (numMatch?.[1]) return numMatch[1];
    return '';
  }
  const cleaned = text.replace(/[^a-zA-Z0-9]/g, '');
  return cleaned.length >= 7 ? cleaned : '';
}

// ─── Main Component ────────────────────────────────────────────────────────────

const SlabSearchPlugin: React.FC<SlabSearchPluginProps> = ({
  user,
  onClaimSlab,
  onRequestLogin,
  hidden = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<SearchStep>('idle');
  const [grader, setGrader] = useState<GradingHouse>('PSA');
  const [serial, setSerial] = useState('');
  const [scannerActive, setScannerActive] = useState(false);
  const [slabData, setSlabData] = useState<SlabLookupResult | null>(null);
  const [marketPrices, setMarketPrices] = useState<MarketPrices | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qrRef = useRef<Html5Qrcode | null>(null);
  const isScanningRef = useRef(false);

  // ── QR Scanner ────────────────────────────────────────────────────────────────

  const stopScanner = useCallback(() => {
    isScanningRef.current = false;
    const qr = qrRef.current;
    if (qr) {
      qr.stop().then(() => qr.clear()).catch(() => {});
      qrRef.current = null;
    }
    setScannerActive(false);
  }, []);

  useEffect(() => () => { stopScanner(); }, [stopScanner]);

  const startScanner = async () => {
    setScannerActive(true);
    isScanningRef.current = true;
    await new Promise(r => setTimeout(r, 120));
    try {
      const qr = new Html5Qrcode('slab-qr-reader');
      qrRef.current = qr;
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 100 }, aspectRatio: 1.5 },
        (decoded) => {
          if (!isScanningRef.current) return;
          const extracted = extractSerial(decoded, grader);
          if (extracted) {
            isScanningRef.current = false;
            qr.stop().then(() => qr.clear()).catch(() => {});
            qrRef.current = null;
            setScannerActive(false);
            setSerial(extracted);
            runLookup(extracted, grader);
          }
        },
        () => {}
      );
    } catch (e) {
      console.error('[SlabSearch] Scanner start failed', e);
      setScannerActive(false);
    }
  };

  // ── Lookup — always takes values as explicit arguments ────────────────────────

  const runLookup = async (serialNum: string, graderCode: GradingHouse) => {
    const s = serialNum.trim();
    if (!s) {
      setError('Please enter a serial number.');
      return;
    }

    // Stop any active scanner first
    stopScanner();

    setStep('loading');
    setError(null);
    setSlabData(null);
    setMarketPrices(null);

    try {
      const url = `api/plugin_psa_vault.php?action=lookup&serial=${encodeURIComponent(s)}&grader=${encodeURIComponent(graderCode)}`;
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json().catch(() => ({ error: 'Invalid server response' }));

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Lookup failed (HTTP ${res.status})`);
      }

      const slab: SlabLookupResult = data.slab ?? data;
      setSlabData(slab);
      setStep('results');

      // Fetch market silently in background
      fetchMarket(s, graderCode, slab.card_name, slab.card_set);
    } catch (e: any) {
      setError(e?.message ?? 'Lookup failed. Try again.');
      setStep('error');
    }
  };

  const fetchMarket = async (
    serialNum: string,
    graderCode: GradingHouse,
    cardName?: string,
    cardSet?: string,
  ) => {
    if (!cardName) return;
    setMarketLoading(true);
    try {
      const res = await fetch('api/plugin_psa_vault.php?action=market_quick', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: serialNum, grader: graderCode, card_name: cardName, card_set: cardSet }),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (data?.prices) setMarketPrices(data.prices);
    } catch { /* best-effort */ } finally {
      setMarketLoading(false);
    }
  };

  // ── Open / Close ──────────────────────────────────────────────────────────────

  const openModal = () => {
    setIsOpen(true);
    setStep('idle');
    setSerial('');
    setSlabData(null);
    setMarketPrices(null);
    setError(null);
  };

  const closeModal = () => {
    stopScanner();
    setIsOpen(false);
  };

  const resetSearch = () => {
    stopScanner();
    setStep('idle');
    setSerial('');
    setSlabData(null);
    setMarketPrices(null);
    setError(null);
  };

  // ── Claim ────────────────────────────────────────────────────────────────────

  const isClaimed = !!(slabData?.already_in_vault || slabData?.is_claimed);

  const handleClaimSlab = () => {
    closeModal();
    onClaimSlab();
  };

  // ── Floating action button ───────────────────────────────────────────────────

  if (hidden) return null;

  // ── Styles (reused) ───────────────────────────────────────────────────────────

  const s = {
    btn: {
      background: 'linear-gradient(135deg,#D4AF37,#B8962E)',
      border: 'none',
      borderRadius: 12,
      padding: '14px 16px',
      color: '#000',
      fontWeight: 900,
      fontSize: 13,
      cursor: 'pointer',
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      minHeight: 52,
    },
    btnGhost: {
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 12,
      padding: '13px 16px',
      color: 'rgba(255,255,255,0.55)',
      fontWeight: 700,
      fontSize: 12,
      cursor: 'pointer',
      letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      minHeight: 48,
    },
    label: {
      fontSize: 9,
      fontWeight: 900,
      color: 'rgba(255,255,255,0.28)',
      letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
      marginBottom: 4,
    },
    value: {
      fontSize: 15,
      fontWeight: 900,
      color: '#D4AF37',
    },
  };

  return (
    <>
      {/* ─ Floating Button ─ */}
      {!isOpen && (
        <button
          id="slab-search-fab"
          onClick={openModal}
          aria-label="Slab Search"
          style={{
            position: 'fixed',
            bottom: 100,
            right: 18,
            zIndex: 350,
            background: 'linear-gradient(135deg,#D4AF37,#B8962E)',
            border: 'none',
            borderRadius: '50%',
            width: 58,
            height: 58,
            boxShadow: '0 6px 28px rgba(212,175,55,0.5)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <i className="fas fa-barcode" style={{ color: '#000', fontSize: 22 }} />
        </button>
      )}

      {/* ─ Modal Overlay ─ */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 500,
            background: 'rgba(0,0,0,0.82)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end', // sheet from bottom on mobile
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            style={{
              background: 'linear-gradient(170deg,#0e0e12 0%,#111116 100%)',
              borderTop: '1px solid rgba(212,175,55,0.22)',
              borderLeft: '1px solid rgba(212,175,55,0.1)',
              borderRight: '1px solid rgba(212,175,55,0.1)',
              borderRadius: '20px 20px 0 0',
              width: '100%',
              maxWidth: 520,
              maxHeight: '88vh',
              overflowY: 'auto',
              margin: '0 auto',
              boxShadow: '0 -24px 80px rgba(0,0,0,0.7)',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {/* ─ Sticky Header ─ */}
            <div style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              background: 'rgba(14,14,18,0.97)',
              backdropFilter: 'blur(16px)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              padding: '16px 18px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontWeight: 900, color: '#D4AF37', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="fas fa-barcode" /> Slab Search
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                  Scan or type a cert serial number to look up any graded slab
                </div>
              </div>
              <button
                onClick={closeModal}
                style={{ background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 8, padding: '7px 12px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 14, minHeight: 36, minWidth: 36 }}
              >
                <i className="fas fa-times" />
              </button>
            </div>

            {/* ─ Body ─ */}
            <div style={{ padding: '16px 18px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* ── IDLE / ERROR ── */}
              {(step === 'idle' || step === 'error') && (
                <>
                  {/* Grader selector */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['PSA', 'BGS', 'CGC'] as GradingHouse[]).map(g => (
                      <button
                        key={g}
                        onClick={() => setGrader(g)}
                        style={{
                          flex: 1,
                          minHeight: 44,
                          borderRadius: 10,
                          border: grader === g ? '1.5px solid #D4AF37' : '1px solid rgba(255,255,255,0.1)',
                          background: grader === g ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.03)',
                          color: grader === g ? '#D4AF37' : 'rgba(255,255,255,0.4)',
                          fontSize: 12,
                          fontWeight: 900,
                          cursor: 'pointer',
                          letterSpacing: '0.05em',
                          WebkitTapHighlightColor: 'transparent',
                        }}
                      >
                        {g}
                      </button>
                    ))}
                  </div>

                  {/* Camera button — only show if not already scanning */}
                  {scannerActive ? (
                    <div style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div id="slab-qr-reader" style={{ width: '100%', minHeight: 180, borderRadius: 8, overflow: 'hidden', background: '#000' }} />
                      <div style={{ textAlign: 'center', fontSize: 10, color: '#D4AF37', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        <i className="fas fa-circle animate-pulse" style={{ fontSize: 6, marginRight: 6 }} />
                        Point at slab barcode or QR code
                        <i className="fas fa-circle animate-pulse" style={{ fontSize: 6, marginLeft: 6 }} />
                      </div>
                      <button onClick={stopScanner} style={{ ...s.btnGhost, minHeight: 44 }}>
                        <i className="fas fa-stop" /> Stop Scanner
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={startScanner}
                      style={{
                        background: 'rgba(212,175,55,0.07)',
                        border: '1px solid rgba(212,175,55,0.2)',
                        borderRadius: 12,
                        padding: '16px',
                        color: '#D4AF37',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 900,
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        minHeight: 52,
                        width: '100%',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <i className="fas fa-camera" /> Scan Barcode / QR Code
                    </button>
                  )}

                  {/* Divider */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0' }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.22)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>or enter manually</span>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                  </div>

                  {/* Serial input + Search button */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={serial}
                      onChange={e => setSerial(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) runLookup(v, grader); } }}
                      placeholder={`${grader} cert #…`}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      style={{
                        flex: 1,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 10,
                        padding: '13px 14px',
                        color: 'white',
                        fontSize: 16, // 16px prevents iOS zoom
                        outline: 'none',
                        fontFamily: 'monospace',
                        minHeight: 52,
                        WebkitAppearance: 'none',
                      }}
                    />
                    <button
                      onClick={() => {
                        const v = serial.trim();
                        if (v) runLookup(v, grader);
                        else setError('Enter a serial number first.');
                      }}
                      style={{
                        background: serial.trim() ? 'linear-gradient(135deg,#D4AF37,#B8962E)' : 'rgba(255,255,255,0.06)',
                        border: 'none',
                        borderRadius: 10,
                        padding: '13px 18px',
                        color: serial.trim() ? '#000' : 'rgba(255,255,255,0.3)',
                        fontWeight: 900,
                        fontSize: 12,
                        cursor: 'pointer',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                        minHeight: 52,
                        WebkitTapHighlightColor: 'transparent',
                        transition: 'background 0.18s',
                      }}
                    >
                      <i className="fas fa-search" style={{ marginRight: 6 }} />
                      Search
                    </button>
                  </div>

                  {error && (
                    <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)', borderRadius: 10, padding: '12px 14px', color: '#f87171', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <i className="fas fa-exclamation-circle" /> {error}
                    </div>
                  )}
                </>
              )}

              {/* ── LOADING ── */}
              {step === 'loading' && (
                <div style={{ minHeight: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                  <div style={{ position: 'relative', width: 64, height: 64 }}>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid rgba(212,175,55,0.15)' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid transparent', borderTopColor: '#D4AF37', animation: 'slab-spin 0.85s linear infinite' }} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="fas fa-shield-alt" style={{ color: '#D4AF37', fontSize: 20 }} />
                    </div>
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    Looking up slab…
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace' }}>
                    {grader} #{serial}
                  </div>
                </div>
              )}

              {/* ── RESULTS ── */}
              {step === 'results' && slabData && (
                <>
                  {/* Card card */}
                  <div style={{ background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.18)', borderRadius: 14, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', gap: 14, padding: '14px 16px', alignItems: 'flex-start' }}>
                      {slabData.front_img_url ? (
                        <img
                          src={slabData.front_img_url}
                          alt="Slab"
                          style={{ width: 62, height: 88, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(212,175,55,0.3)', flexShrink: 0 }}
                        />
                      ) : (
                        <div style={{ width: 62, height: 88, background: 'rgba(255,255,255,0.04)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <i className="fas fa-image" style={{ color: 'rgba(255,255,255,0.14)', fontSize: 18 }} />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 900, color: 'white', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.3 }}>
                          {slabData.card_name ?? 'Unknown Card'}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', marginTop: 4 }}>
                          {[slabData.card_set, slabData.card_year, slabData.card_number].filter(Boolean).join(' · ')}
                        </div>
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.45)', color: '#D4AF37', fontSize: 12, fontWeight: 900, padding: '4px 10px', borderRadius: 6 }}>
                            {grader} {slabData.psa_grade}
                          </span>
                          {slabData.psa_grade_desc && (
                            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              {slabData.psa_grade_desc}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', marginTop: 8, fontFamily: 'monospace' }}>
                          Serial #{serial}
                        </div>
                      </div>
                    </div>

                    {/* Population row */}
                    {(slabData.psa_pop != null || slabData.total_population != null) && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: `repeat(${[slabData.psa_pop, slabData.psa_pop_higher, slabData.total_population].filter(v => v != null).length}, 1fr)` }}>
                        {slabData.psa_pop != null && (
                          <div style={{ padding: '10px 14px', textAlign: 'center', borderRight: slabData.psa_pop_higher != null || slabData.total_population != null ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                            <div style={s.label}>{grader} {slabData.psa_grade} Pop</div>
                            <div style={s.value}>{slabData.psa_pop.toLocaleString()}</div>
                          </div>
                        )}
                        {slabData.psa_pop_higher != null && (
                          <div style={{ padding: '10px 14px', textAlign: 'center', borderRight: slabData.total_population != null ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                            <div style={s.label}>Pop Higher</div>
                            <div style={{ ...s.value, color: 'rgba(255,255,255,0.65)' }}>{slabData.psa_pop_higher.toLocaleString()}</div>
                          </div>
                        )}
                        {slabData.total_population != null && (
                          <div style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <div style={s.label}>Total Pop</div>
                            <div style={{ ...s.value, color: 'rgba(255,255,255,0.65)' }}>{slabData.total_population.toLocaleString()}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Market prices */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span><i className="fas fa-chart-line" style={{ color: '#D4AF37', marginRight: 6 }} />Live Market</span>
                      {marketLoading && <i className="fas fa-circle-notch fa-spin" style={{ color: '#D4AF37' }} />}
                    </div>
                    {marketLoading && !marketPrices ? (
                      <div style={{ textAlign: 'center', padding: '10px 0', color: 'rgba(255,255,255,0.18)', fontSize: 11 }}>Fetching prices…</div>
                    ) : marketPrices ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {([
                          { label: 'Raw / Ungraded', value: marketPrices.raw },
                          { label: `${grader} 10`, value: marketPrices.psa10 },
                          { label: `${grader} 9`, value: marketPrices.psa9 },
                          { label: `${grader} 8`, value: marketPrices.psa8 },
                        ] as { label: string; value: number | null | undefined }[]).filter(r => r.value).map(({ label, value }) => (
                          <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '9px 11px' }}>
                            <div style={s.label}>{label}</div>
                            <div style={s.value}>{fmtPrice(value)}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '10px 0', color: 'rgba(255,255,255,0.15)', fontSize: 11 }}>
                        <i className="fas fa-minus-circle" style={{ marginRight: 6 }} />Market data unavailable
                      </div>
                    )}
                  </div>

                  {/* Claimed / Claim */}
                  {isClaimed ? (
                    <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 14, padding: '16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className="fas fa-shield-check" style={{ color: '#22c55e', fontSize: 18 }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 900, color: '#22c55e', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          Authentic Slab — Claimed
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.32)', marginTop: 4, lineHeight: 1.5 }}>
                          This slab is registered and vault-protected in RawGraded.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.18)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <i className="fas fa-lock-open" style={{ color: '#D4AF37', fontSize: 14, marginTop: 1 }} />
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)', lineHeight: 1.55 }}>
                          This slab hasn't been claimed. Authenticate and vault it to register ownership.
                        </div>
                      </div>
                      {user ? (
                        <button onClick={handleClaimSlab} style={s.btn}>
                          <i className="fas fa-shield-alt" />
                          Claim Slab — Authenticate &amp; Vault
                        </button>
                      ) : (
                        <button onClick={() => { closeModal(); onRequestLogin(); }} style={{ ...s.btn, background: 'rgba(255,255,255,0.08)', color: 'white', border: '1px solid rgba(255,255,255,0.15)' }}>
                          <i className="fas fa-lock" />
                          Sign In to Claim This Slab
                        </button>
                      )}
                    </div>
                  )}

                  {/* Search another */}
                  <button onClick={resetSearch} style={s.btnGhost}>
                    <i className="fas fa-arrow-left" /> Search Another Slab
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Keyframe */}
      <style>{`@keyframes slab-spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
};

export default SlabSearchPlugin;
