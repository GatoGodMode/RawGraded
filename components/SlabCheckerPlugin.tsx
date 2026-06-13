import React, { useState, useRef, useCallback } from 'react';
import type { UserProfile } from '../types';
import { checkSlabAuthenticity, SlabCheckResult, SlabCheck } from '../services/geminiService';
import { resizeImage } from '../services/imageUtils';
import VideoCapture from './VideoCapture';

// ─── Types ────────────────────────────────────────────────────────────────────
type GradingHouse = 'PSA' | 'BGS' | 'CGC' | 'Other';
type PluginStep = 'capture' | 'confirm_credit' | 'scanning' | 'qr_scan' | 'results' | 'conflict';

interface SlabCheckerPluginProps {
  user: UserProfile | null;
  vaultSlabId?: number;
  initialFrontImg?: string | null;
  initialBackImg?: string | null;
  onClose: () => void;
  onSaved: (psaSlabId?: number) => void;
  onRequestLogin: () => void;
  onRequestShop: () => void;
}

// ─── Helper Components ─────────────────────────────────────────────────────────
const VerdictBadge: React.FC<{ verdict: SlabCheckResult['verdict'] }> = ({ verdict }) => {
  const cfg = {
    'LIKELY AUTHENTIC': { bg: 'from-green-600 to-green-800', border: 'border-green-400/40', text: 'text-green-100', icon: 'fa-shield-check', label: 'LIKELY AUTHENTIC' },
    'INCONCLUSIVE': { bg: 'from-yellow-600 to-yellow-800', border: 'border-yellow-400/40', text: 'text-yellow-100', icon: 'fa-exclamation-triangle', label: 'INCONCLUSIVE' },
    'LIKELY FAKE': { bg: 'from-red-700 to-red-900', border: 'border-red-400/40', text: 'text-red-100', icon: 'fa-ban', label: 'LIKELY FAKE' },
  }[verdict];
  return (
    <div className={`inline-flex items-center gap-3 px-5 py-2.5 rounded-full bg-gradient-to-r ${cfg.bg} border ${cfg.border}`}>
      <i className={`fas ${cfg.icon} text-lg ${cfg.text}`} />
      <span className={`font-black tracking-[0.2em] text-sm uppercase ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
};

const ScoreBar: React.FC<{ score: number; pass: boolean }> = ({ score, pass }) => (
  <div className="flex items-center gap-2 flex-1">
    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${pass ? 'bg-green-400' : score >= 50 ? 'bg-yellow-400' : 'bg-red-500'}`}
        style={{ width: `${score}%` }}
      />
    </div>
    <span className={`text-xs font-mono w-8 text-right ${pass ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>{score}</span>
  </div>
);

const SlabImagePanel: React.FC<{
  label: string;
  icon: string;
  image: string | null;
  isLandscape?: boolean;
  onCamera: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}> = ({ label, icon, image, isLandscape = true, onCamera, onUpload, onClear }) => (
  <div className={`bg-[#0a0a0a] p-5 rounded-xl border transition-all ${image ? 'border-[#BF953F]/50 shadow-[0_0_25px_rgba(191,149,63,0.08)]' : 'border-white/5'}`}>
    <div className="flex justify-between items-center mb-4">
      <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-2 text-white">
        <i className={`fas ${icon} text-[#BF953F]`} /> {label}
      </h3>
      {image && <i className="fas fa-check-circle text-[#BF953F]" />}
    </div>
    {image ? (
      <div className={`relative w-full bg-[#050505] rounded-md border border-white/10 overflow-hidden ${isLandscape ? 'aspect-[3.5/2.5]' : 'aspect-[2.5/3.5]'}`}>
        <img src={image} alt={label} className="w-full h-full object-contain" />
        <button
          onClick={onClear}
          className="absolute top-2 right-2 bg-black/70 text-white rounded-full w-7 h-7 flex items-center justify-center hover:bg-red-900 transition-colors"
        >
          <i className="fas fa-times text-xs" />
        </button>
      </div>
    ) : (
      <div className={`w-full space-y-2 ${isLandscape ? 'aspect-[3.5/2.5]' : ''} flex flex-col justify-center`}>
        <button
          onClick={onCamera}
          className="w-full py-3 rounded-lg bg-gradient-to-b from-[#990000] to-[#660000] border border-red-500/20 text-white font-bold flex items-center justify-center gap-2 text-sm"
        >
          <i className="fas fa-camera" /> Scan Camera
        </button>
        <div className="relative">
          <input type="file" accept="image/*" onChange={onUpload} className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10" />
          <button className="w-full py-2.5 rounded-lg bg-[#111] border border-white/10 text-gray-300 font-bold flex items-center justify-center gap-2 text-sm hover:bg-[#1a1a1a]">
            <i className="fas fa-upload opacity-60" /> Upload File
          </button>
        </div>
        <p className="text-[10px] text-center text-gray-500 mt-1">
          {isLandscape ? 'Capture the full slab in landscape orientation' : 'Capture this side of the slab'}
        </p>
      </div>
    )}
  </div>
);

// ─── Main Component ────────────────────────────────────────────────────────────
const SlabCheckerPlugin: React.FC<SlabCheckerPluginProps> = ({
  user, vaultSlabId, initialFrontImg, initialBackImg, onClose, onSaved, onRequestLogin, onRequestShop
}) => {
  const [step, setStep] = useState<PluginStep>('capture');
  const [gradingHouse, setGradingHouse] = useState<GradingHouse>('PSA');
  const [frontImg, setFrontImg] = useState<string | null>(initialFrontImg || null);
  const [backImg, setBackImg] = useState<string | null>(initialBackImg || null);
  const [videoFrames, setVideoFrames] = useState<string[]>([]);
  const [showCamera, setShowCamera] = useState<'front' | 'back' | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [result, setResult] = useState<SlabCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSlabId, setSavedSlabId] = useState<number | null>(null);
  const [certVerification, setCertVerification] = useState<{ status: 'idle' | 'loading' | 'success' | 'not_found' | 'error', data?: any }>({ status: 'idle' });
  const [conflictData, setConflictData] = useState<{psa_slab_id: number} | null>(null);
  const [transferResponse, setTransferResponse] = useState<'pending' | 'success' | 'error' | null>(null);

  const requestTransfer = async () => {
    if (!conflictData?.psa_slab_id) return;
    setTransferResponse('pending');
    try {
      const res = await fetch('api/plugin_slab_checker.php?action=request_transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ psa_slab_id: conflictData.psa_slab_id })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      setTransferResponse('success');
    } catch (e) {
      setTransferResponse('error');
    }
  };

  // Camera capture inline (reuse CameraCapture component internally)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target?.result as string;
      if (side === 'front') setFrontImg(data);
      else setBackImg(data);
    };
    reader.readAsDataURL(file);
  };

  const handleVideoCapture = (_url: string, frames: string[]) => {
    setVideoFrames(frames);
    setShowVideo(false);
  };

  // ── Credit gate ──────────────────────────────────────────────────────────────
  const canUsePaid = user?.role === 'admin' || ((user?.paid_credits ?? 0) > 0);

  const runAnalysis = useCallback(async () => {
    if (!frontImg || !backImg) return;
    setError(null);
    setStep('scanning');

    try {
      setAnalysisStatus('Resizing images...');
      const [rFront, rBack] = await Promise.all([
        resizeImage(frontImg, 1024, 0.85),
        resizeImage(backImg, 1024, 0.85),
      ]);

      const analysisResult = await checkSlabAuthenticity(
        rFront, rBack, videoFrames, gradingHouse,
        (s) => setAnalysisStatus(s)
      );

      if (!analysisResult) throw new Error('Analysis returned no result. Please try again.');
      setResult(analysisResult);
      setStep('results');
    } catch (err: any) {
      setError(err?.message || 'Analysis failed. Please try again.');
      setStep('capture');
    }
  }, [frontImg, backImg, videoFrames, gradingHouse]);

  // ── Cert Verification ────────────────────────────────────────────────────────
  const verifyCert = async () => {
    if (!result?.serial_detected) return;
    setCertVerification({ status: 'loading' });
    try {
      const res = await fetch(`api/plugin_slab_checker.php?action=verify_cert&serial=${encodeURIComponent(result.serial_detected)}&grader=${encodeURIComponent(result.grading_house)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setCertVerification({ status: data.found === false ? 'not_found' : 'error', data });
      } else {
        setCertVerification({ status: 'success', data });
      }
    } catch (err) {
      setCertVerification({ status: 'error' });
    }
  };

  // ── Save to vault ─────────────────────────────────────────────────────────────
  const saveToVault = async () => {
    if (!result || isSaving) return;
    setIsSaving(true);
    try {
      const payload: Record<string, any> = {
        grading_house: result.grading_house,
        authenticity_score: result.authenticity_score,
        verdict: result.verdict,
        ai_reasoning: result.ai_reasoning,
        checks: result.checks,
        front_img: frontImg,
        back_img: backImg,
        serial_detected: result.serial_detected,
        card_name_detected: result.card_name_detected,
        video_frames: videoFrames.slice(0, 4),
      };
      if (vaultSlabId) {
        payload.psa_slab_id = vaultSlabId;
      }

      const bodyStr = JSON.stringify(payload);
      console.log('[SlabChecker] Save payload size:', (bodyStr.length / 1024).toFixed(1), 'KB');

      const res = await fetch('api/plugin_slab_checker.php?action=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: bodyStr,
      });

      const rawText = await res.text();
      console.log('[SlabChecker] Save response status:', res.status, 'body:', rawText.substring(0, 500));

      let data: any = {};
      try { data = JSON.parse(rawText); } catch (e) {
        console.error('[SlabChecker] Non-JSON response:', rawText.substring(0, 1000));
        throw new Error('Server returned invalid response (not JSON). Check PHP errors. Response: ' + rawText.substring(0, 200));
      }
      if (!res.ok || data.error) throw new Error(data.error || `Save failed (HTTP ${res.status})`);
      
      if (data.status === 'ownership_conflict') {
        setConflictData({ psa_slab_id: data.psa_slab_id });
        setStep('conflict');
        return;
      }
      
      console.log('[SlabChecker] Save success! psa_slab_id:', data.psa_slab_id, 'check_id:', data.check_id);
      setSavedSlabId(data.psa_slab_id ?? null);
      onSaved(data.psa_slab_id);
    } catch (err: any) {
      console.error('[SlabChecker] Save error:', err);
      setError(err?.message || 'Save failed. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Inline camera overlay (delegates to native camera via CameraCapture) ──────
  
  if (step === 'conflict' && conflictData) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-6 backdrop-blur-sm">
        <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-6 animate-scale-in border border-silver">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500 flex flex-col items-center justify-center mx-auto mb-4 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
              <i className="fas fa-shield-alt text-2xl"></i>
            </div>
            <h2 className="text-xl font-black text-gray-900 mb-2 uppercase tracking-wide">Anti-Piracy Lock</h2>
            <p className="text-sm text-gray-600 mb-4 leading-relaxed font-medium">
              This authenticated slab is currently registered and protected by another user's secure vault.
            </p>
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-widest">
                Did you recently acquire this slab?
              </p>
            </div>
          </div>
          
          <div className="space-y-3">
            <button 
              onClick={requestTransfer}
              disabled={transferResponse === 'pending' || transferResponse === 'success'}
              className="w-full py-4 rounded-xl bg-poke-accent font-black text-white hover:opacity-90 disabled:opacity-50 tracking-widest text-xs flex items-center justify-center gap-2 transition-all shadow-md"
            >
              {transferResponse === 'pending' ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-paper-plane"></i>}
              {transferResponse === 'success' ? 'REQUEST SENT' : 'YES, REQUEST CUSTODY'}
            </button>
            {transferResponse !== 'success' && (
              <button 
                onClick={onClose}
                className="w-full py-3 rounded-xl text-gray-500 hover:text-gray-900 font-bold tracking-widest text-xs transition-colors"
              >
                BACK TO VAULT
              </button>
            )}
          </div>
          
          {transferResponse === 'success' && (
            <div className="mt-4 p-4 border border-green-500/30 bg-green-50 rounded-xl text-green-700 text-xs font-bold text-center">
              Request sent. The previous owner must release custody to you.
              <button onClick={onClose} className="w-full mt-3 block py-2.5 bg-green-600 hover:bg-green-700 font-bold tracking-widest text-white rounded-lg transition-colors">CLOSE WINDOW</button>
            </div>
          )}
          {transferResponse === 'error' && (
             <div className="text-red-500 text-xs text-center font-bold">Failed to send request.</div>
          )}
        </div>
      </div>
    );
  }

  if (showCamera) {
    // Dynamically import CameraCapture to avoid circular dep
    const CameraCapture = React.lazy(() => import('./CameraCapture'));
    return (
      <React.Suspense fallback={<div className="fixed inset-0 bg-black flex items-center justify-center"><i className="fas fa-spinner fa-spin text-white text-2xl" /></div>}>
        <CameraCapture
          side={showCamera}
          onCapture={(img) => {
            if (showCamera === 'front') setFrontImg(img);
            else setBackImg(img);
            setShowCamera(null);
          }}
          onClose={() => setShowCamera(null)}
        />
      </React.Suspense>
    );
  }

  if (showVideo) {
    return (
      <VideoCapture
        onCapture={handleVideoCapture}
        onSkip={() => setShowVideo(false)}
        type="slab"
      />
    );
  }

  // ─── Scanning overlay ──────────────────────────────────────────────────────────
  if (step === 'scanning') {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="text-center p-8 max-w-sm">
          <div className="w-20 h-20 mx-auto mb-6 relative">
            <div className="absolute inset-0 rounded-full border-4 border-[#BF953F]/20" />
            <div className="absolute inset-0 rounded-full border-4 border-t-[#BF953F] animate-spin" />
            <i className="fas fa-shield-alt text-[#BF953F] text-2xl absolute inset-0 flex items-center justify-center" style={{ display: 'flex' }} />
          </div>
          <h2 className="text-white font-black text-xl mb-3 uppercase tracking-widest">Analyzing Slab</h2>
          <p className="text-[#BF953F] text-sm font-mono">{analysisStatus}</p>
          <p className="text-gray-500 text-xs mt-4">Analyzing Slab Authenticity using {gradingHouse} authenticity criteria</p>
        </div>
      </div>
    );
  }

  // ─── Credit confirmation modal ─────────────────────────────────────────────────
  if (step === 'confirm_credit') {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
        <div className="bg-[#0d0d0d] border border-[#BF953F]/30 rounded-2xl p-8 max-w-sm w-full text-center shadow-[0_0_60px_rgba(191,149,63,0.12)]">
          <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-[#BF953F]/10 border border-[#BF953F]/30 flex items-center justify-center">
            <i className="fas fa-coins text-[#BF953F] text-2xl" />
          </div>
          <h2 className="text-white font-black text-lg mb-2 uppercase tracking-widest">1 Pro Credit</h2>
          <p className="text-gray-400 text-sm mb-1">This analysis costs <span className="text-[#BF953F] font-bold">1 Pro Credit</span>.</p>
          <p className="text-gray-500 text-xs mb-6">Free credits are not eligible. Results are stored in your Slab Vault.</p>
          {!canUsePaid ? (
            <>
              <p className="text-red-400 text-sm mb-4">You have no Pro Credits. Purchase more to continue.</p>
              <button onClick={onRequestShop} className="w-full py-3 rounded-xl bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-black font-black text-sm uppercase tracking-wider mb-3">
                Get Pro Credits
              </button>
              <button onClick={() => setStep('capture')} className="w-full py-2.5 rounded-xl bg-white/5 text-gray-400 text-sm">
                Go Back
              </button>
            </>
          ) : (
            <div className="flex gap-3">
              <button onClick={() => setStep('capture')} className="flex-1 py-3 rounded-xl bg-white/5 text-gray-300 text-sm font-bold">
                Cancel
              </button>
              <button
                onClick={runAnalysis}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#BF953F] to-[#B38728] text-black font-black text-sm uppercase tracking-wider"
              >
                Confirm
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Results Screen ────────────────────────────────────────────────────────────
  if (step === 'results' && result) {
    const scoreColor = result.authenticity_score >= 75 ? '#4ade80' : result.authenticity_score >= 50 ? '#facc15' : '#f87171';
    const circumference = 2 * Math.PI * 40;
    const strokeDashoffset = circumference - (result.authenticity_score / 100) * circumference;

    return (
      <div className="fixed inset-0 z-50 bg-[#040404] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#040404]/95 backdrop-blur-md border-b border-white/5 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <i className="fas fa-shield-alt text-[#BF953F]" />
            <span className="text-white font-black text-sm uppercase tracking-widest">Slab Analysis Report</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10">
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="max-w-2xl mx-auto px-5 py-8 space-y-6">
          {/* Score & Verdict */}
          <div className="flex flex-col items-center gap-4 py-6">
            <svg width="120" height="120" className="-rotate-90">
              <circle cx="60" cy="60" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
              <circle
                cx="60" cy="60" r="40" fill="none"
                stroke={scoreColor} strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                style={{ transition: 'stroke-dashoffset 1s ease' }}
              />
              <text x="60" y="60" textAnchor="middle" dominantBaseline="middle" fill={scoreColor}
                fontSize="22" fontWeight="900" transform="rotate(90,60,60)">
                {result.authenticity_score}
              </text>
            </svg>
            <VerdictBadge verdict={result.verdict} />
            {result.card_name_detected && (
              <p className="text-gray-300 text-sm text-center">{result.card_name_detected}</p>
            )}
            {result.serial_detected && (
              <p className="text-gray-500 text-xs font-mono">Serial: {result.serial_detected}</p>
            )}
          </div>

          {/* AI Reasoning */}
          <div className="bg-[#0a0a0a] border border-white/5 rounded-xl p-5">
            <h3 className="text-[#BF953F] text-xs font-black uppercase tracking-widest mb-3">AI Assessment</h3>
            <p className="text-gray-300 text-sm leading-relaxed">{result.ai_reasoning}</p>
          </div>

          {/* Database Verification */}
          {result.serial_detected && result.grading_house !== 'Other' && (
            <div className="bg-[#0a0a0a] border border-white/5 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white text-xs font-black uppercase tracking-widest">Database Verification</h3>
                {certVerification.status === 'idle' && (
                  <button onClick={verifyCert} className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-bold transition-all">
                    Verify {result.grading_house} Cert
                  </button>
                )}
              </div>

              {certVerification.status === 'loading' && (
                <p className="text-gray-400 text-sm flex items-center gap-2"><i className="fas fa-spinner fa-spin text-[#BF953F]" /> Checking {result.grading_house} database...</p>
              )}
              {certVerification.status === 'not_found' && (
                <div className="flex items-start gap-3 bg-red-900/20 border border-red-500/30 p-3 rounded-lg">
                  <i className="fas fa-exclamation-triangle text-red-400 mt-0.5" />
                  <div>
                    <p className="text-red-400 text-sm font-bold">Cert Not Found</p>
                    <p className="text-gray-400 text-xs mt-1">This serial number does not exist in the official {result.grading_house} database.</p>
                  </div>
                </div>
              )}
              {certVerification.status === 'error' && (
                <p className="text-red-400 text-sm">Failed to verify cert. Please try again later.</p>
              )}
              {certVerification.status === 'success' && certVerification.data && (
                <div className="flex items-start gap-3 bg-green-900/20 border border-green-500/30 p-3 rounded-lg">
                  <i className="fas fa-check-circle text-green-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-green-400 text-sm font-bold">Cert Verified Active</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                      {certVerification.data.card_name && <><span className="text-gray-500">Subject:</span><span className="text-white text-right truncate">{certVerification.data.card_name}</span></>}
                      {certVerification.data.grade_desc && <><span className="text-gray-500">Grade:</span><span className="text-white text-right">{certVerification.data.grade_desc}</span></>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Per-check Breakdown */}
          <div className="bg-[#0a0a0a] border border-white/5 rounded-xl p-5">
            <h3 className="text-white text-xs font-black uppercase tracking-widest mb-4">Check Breakdown</h3>
            <div className="space-y-3">
              {result.checks.map((check, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-3">
                    <i className={`fas ${check.pass ? 'fa-check-circle text-green-400' : check.score >= 50 ? 'fa-exclamation-circle text-yellow-400' : 'fa-times-circle text-red-400'} text-xs w-4`} />
                    <span className="text-white text-xs font-bold uppercase tracking-wider flex-1">{check.name.replace(/_/g, ' ')}</span>
                    <ScoreBar score={check.score} pass={check.pass} />
                  </div>
                  <p className="text-gray-500 text-[11px] leading-snug pl-7">{check.detail}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          {savedSlabId !== null ? (
            <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4 text-center">
              <i className="fas fa-check-circle text-green-400 text-2xl mb-2" />
              <p className="text-green-300 font-bold text-sm">Saved to your Slab Vault!</p>
              <button onClick={onClose} className="mt-3 text-gray-400 text-xs underline">Close</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pb-8">
              <button
                onClick={saveToVault}
                disabled={isSaving}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-black font-black text-sm uppercase tracking-wider disabled:opacity-50"
              >
                {isSaving ? <><i className="fas fa-spinner fa-spin mr-2" />Saving...</> : 'Add to Slab Vault (1 Pro Credit)'}
              </button>
              <button
                onClick={() => { setStep('capture'); setResult(null); setError(null); }}
                className="w-full py-3 rounded-xl bg-white/5 text-gray-300 text-sm font-bold"
              >
                Scan Another Slab
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Capture Step ─────────────────────────────────────────────────────────────
  const canProceed = !!frontImg && !!backImg;

  return (
    <div className="fixed inset-0 z-50 bg-[#040404] overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#040404]/95 backdrop-blur-md border-b border-white/5 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <i className="fas fa-shield-alt text-[#BF953F]" />
          <div>
            <h1 className="text-white font-black text-sm uppercase tracking-widest">Graded Slab Check</h1>
            <p className="text-gray-500 text-[10px]">AI-Powered Authenticity Verification</p>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10">
          <i className="fas fa-times" />
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-6 space-y-6">
        <p className="text-gray-500 text-xs">
          <a
            href="/guides/identify-fake-slabs.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#BF953F] hover:underline font-bold"
          >
            Manual fake-slab checklist
          </a>
          {' '}
          — same detection rules as this tool (PSA / BGS / CGC).
        </p>

        {/* Grading House Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Grading Company</label>
          <div className="flex gap-2 flex-wrap">
            {(['PSA', 'BGS', 'CGC', 'Other'] as GradingHouse[]).map(h => (
              <button
                key={h}
                onClick={() => setGradingHouse(h)}
                className={`px-4 py-2 rounded-lg text-sm font-black uppercase tracking-wider border transition-all ${gradingHouse === h
                    ? 'bg-[#BF953F] border-[#BF953F] text-black'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-[#BF953F]/50'
                  }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        {/* Image Captures */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SlabImagePanel
            label="Slab Front"
            icon="fa-image"
            image={frontImg}
            isLandscape={true}
            onCamera={() => setShowCamera('front')}
            onUpload={(e) => handleFileUpload(e, 'front')}
            onClear={() => setFrontImg(null)}
          />
          <SlabImagePanel
            label="Slab Back"
            icon="fa-undo"
            image={backImg}
            isLandscape={true}
            onCamera={() => setShowCamera('back')}
            onUpload={(e) => handleFileUpload(e, 'back')}
            onClear={() => setBackImg(null)}
          />
        </div>

        {/* Video Capture (optional but recommended) */}
        <div className="bg-[#0a0a0a] border border-white/5 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white text-sm font-black uppercase tracking-wider">Side-to-Side Video</h3>
              <p className="text-gray-500 text-xs mt-0.5">Recommended — helps detect logo reflections & seal integrity</p>
            </div>
            {videoFrames.length > 0 ? (
              <div className="flex items-center gap-2">
                <i className="fas fa-check-circle text-[#BF953F]" />
                <span className="text-[#BF953F] text-xs font-bold">{videoFrames.length} frames</span>
                <button onClick={() => setVideoFrames([])} className="text-gray-500 hover:text-red-400 text-xs ml-2">Clear</button>
              </div>
            ) : (
              <button
                onClick={() => setShowVideo(true)}
                className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-bold hover:border-[#BF953F]/50 transition-all flex items-center gap-2"
              >
                <i className="fas fa-video text-[#BF953F]" /> Record
              </button>
            )}
          </div>
        </div>

        {/* Credit notice */}
        <div className="bg-[#BF953F]/5 border border-[#BF953F]/20 rounded-xl p-4 flex items-start gap-3">
          <i className="fas fa-coins text-[#BF953F] mt-0.5 text-sm" />
          <div>
            <p className="text-[#BF953F] text-xs font-bold">Requires 1 Pro Credit</p>
            <p className="text-gray-500 text-[10px] mt-0.5">Free credits are not eligible for Slab Checking. {user ? `You have ${user.paid_credits ?? 0} Pro Credits.` : 'Login to continue.'}</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* Primary CTA */}
        {!user ? (
          <button
            onClick={onRequestLogin}
            className="w-full py-4 rounded-xl bg-white/10 border border-white/20 text-white font-black text-sm uppercase tracking-wider"
          >
            <i className="fas fa-lock mr-2" /> Sign In to Continue
          </button>
        ) : (
          <button
            disabled={!canProceed}
            onClick={() => setStep('confirm_credit')}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-black font-black text-sm uppercase tracking-[0.2em] disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-[0_0_25px_rgba(191,149,63,0.3)]"
          >
            Initialize Slab Check <i className="fas fa-arrow-right ml-2" />
          </button>
        )}

        {!canProceed && (
          <p className="text-center text-gray-600 text-xs">Front and back photos of the slab are required to proceed.</p>
        )}
      </div>
    </div>
  );
};

export default SlabCheckerPlugin;
