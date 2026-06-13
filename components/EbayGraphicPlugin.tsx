import React, { useRef, useState, useEffect } from 'react';
import type { CardData, GradingResult, UserProfile } from '../types';
import EvidenceCrop from './EvidenceCrop';
import LogoR from './LogoR';
import { generateEbaySnippet } from '../services/geminiService';

declare const html2canvas: any;

function getSourceImageByIndex(
  data: CardData,
  imageIndex: number | undefined,
  defect?: { imageData?: string }
): string | null {
  if (defect?.imageData && typeof defect.imageData === 'string' && defect.imageData.length > 50) {
    return defect.imageData;
  }
  if (typeof imageIndex === 'number' && imageIndex >= 2 && Array.isArray(data.videoFrames) && data.videoFrames.length > imageIndex - 2) {
    const frame = data.videoFrames[imageIndex - 2];
    if (frame && typeof frame === 'string' && frame.length > 50) return frame;
  }
  if (imageIndex === 1) return data.backCropped || data.backRaw || null;
  if (imageIndex === 0) return data.frontCropped || data.frontRaw || null;
  return data.frontCropped || data.frontRaw || null;
}

export interface EbayGraphicPluginProps {
  data: CardData;
  finalGrade: GradingResult;
  onClose: () => void;
  user: UserProfile | null;
  displayFrontUrl?: string | null;
  displayBackUrl?: string | null;
  onCreditsUpdated?: (credits: { free: number; paid: number; scan_limit?: number; scans_this_week?: number }) => void;
}

const EbayGraphicPlugin: React.FC<EbayGraphicPluginProps> = ({
  data,
  finalGrade,
  onClose,
  user,
  displayFrontUrl,
  displayBackUrl,
  onCreditsUpdated
}) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [snippet, setSnippet] = useState('');
  const [snippetLoading, setSnippetLoading] = useState(false);
  const [snippetError, setSnippetError] = useState<string | null>(null);
  const [exportWithRawGraded, setExportWithRawGraded] = useState(true);
  const [customLogoUrl, setCustomLogoUrl] = useState('');
  const [customBrandName, setCustomBrandName] = useState('');
  const [customTagline, setCustomTagline] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const frontUrl = displayFrontUrl ?? data.frontCropped ?? data.frontRaw ?? '';
  const backUrl = displayBackUrl ?? data.backCropped ?? data.backRaw ?? '';

  const freeRemaining = user && user.role !== 'admin' ? Math.max(0, (user.scan_limit ?? 0) - (user.scans_this_week ?? 0)) : 999;
  const paidRemaining = user && user.role !== 'admin' ? (user.paid_credits ?? 0) : 999;
  const canExportRawGraded = freeRemaining > 0 || (user?.role === 'admin');
  const canExportCustom = paidRemaining > 0 || (user?.role === 'admin');

  useEffect(() => {
    return () => {
      if (customLogoUrl) URL.revokeObjectURL(customLogoUrl);
    };
  }, [customLogoUrl]);

  const handleGenerateSnippet = async () => {
    setSnippetLoading(true);
    setSnippetError(null);
    try {
      const conditionSummary = (finalGrade.reasoning || '').slice(0, 500) || 'Condition assessed from scan.';
      const text = await generateEbaySnippet(
        { name: data.metadata?.name || 'Card', set: data.metadata?.set || '', year: data.metadata?.year || '' },
        conditionSummary
      );
      setSnippet(text);
    } catch (e) {
      setSnippetError(e instanceof Error ? e.message : 'Could not generate snippet.');
      setSnippet('Condition as shown. See photos for details.');
    } finally {
      setSnippetLoading(false);
    }
  };

  const handleExport = async () => {
    if (!previewRef.current || typeof html2canvas === 'undefined') {
      setExportError('Export not available.');
      return;
    }
    const useFree = exportWithRawGraded;
    if (useFree && !canExportRawGraded) {
      setExportError('No free credits left this week.');
      return;
    }
    if (!useFree && !canExportCustom) {
      setExportError('No pro credits remaining.');
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch('api/plugin_ebay_export.php', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ use_free_credit: useFree })
      });
      const json = await res.json().catch(() => ({}));
      if (res.status !== 200) {
        setExportError(json.error || 'Credit could not be applied.');
        return;
      }
      const canvas = await html2canvas(previewRef.current, {
        logging: false,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#faf9f7',
        imageTimeout: 0,
        removeContainer: true,
        windowWidth: previewRef.current.scrollWidth,
        windowHeight: previewRef.current.scrollHeight
      });
      const link = document.createElement('a');
      link.download = `rawgraded-ebay-${(data.metadata?.name || 'card').replace(/\s+/g, '-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      if (json.credits_remaining && onCreditsUpdated) {
        onCreditsUpdated(json.credits_remaining);
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const handleCopySnippet = () => {
    if (snippet) {
      navigator.clipboard.writeText(snippet).then(() => alert('Snippet copied to clipboard.')).catch(() => {});
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (customLogoUrl) URL.revokeObjectURL(customLogoUrl);
    setCustomLogoUrl(URL.createObjectURL(file));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-[#0a0a0a] text-[#FBF9F6] rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-bold text-white">eBay Sales Graphic</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-auto flex flex-row flex-wrap lg:flex-nowrap gap-4 p-4">
          <div className="w-full lg:w-80 space-y-4 shrink-0">
            <div className="border border-gray-200 rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-gray-600 uppercase tracking-wider">Branding</p>
              <p className="text-xs text-gray-500">Choose mode first. Each export costs 1 credit.</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={exportWithRawGraded} onChange={() => setExportWithRawGraded(true)} className="rounded-full" />
                <span>RawGraded (1 free credit)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={!exportWithRawGraded} onChange={() => setExportWithRawGraded(false)} className="rounded-full" />
                <span>My branding (1 pro credit)</span>
              </label>
              {!exportWithRawGraded && (
                <div className="pl-5 space-y-2 text-sm">
                  <div>
                    <label className="block text-gray-600 mb-1">Logo</label>
                    <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="block w-full text-xs" />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Brand name</label>
                    <input type="text" value={customBrandName} onChange={(e) => setCustomBrandName(e.target.value)} placeholder="Your brand" className="w-full border border-gray-300 rounded px-2 py-1" />
                  </div>
                  <div>
                    <label className="block text-gray-600 mb-1">Tagline (optional)</label>
                    <input type="text" value={customTagline} onChange={(e) => setCustomTagline(e.target.value)} placeholder="e.g. Verified condition" className="w-full border border-gray-300 rounded px-2 py-1" />
                  </div>
                </div>
              )}
            </div>
            <div className="border border-gray-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-bold text-gray-600 uppercase tracking-wider">Listing copy</p>
              <textarea value={snippet} onChange={(e) => setSnippet(e.target.value)} placeholder="Generate or type listing copy…" rows={4} className="w-full border border-gray-300 rounded-lg p-2 text-sm resize-y" />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleGenerateSnippet} disabled={snippetLoading} className="px-3 py-1.5 bg-gray-800 text-white text-sm font-bold rounded-lg disabled:opacity-50">
                  {snippetLoading ? 'Generating…' : 'Generate snippet'}
                </button>
                <button type="button" onClick={handleCopySnippet} disabled={!snippet} className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-bold rounded-lg">Copy snippet</button>
              </div>
              {snippetError && <p className="text-xs text-poke-accent">{snippetError}</p>}
            </div>
            <div className="border border-gray-200 rounded-xl p-3">
              <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Export</p>
              <p className="text-xs text-gray-500 mb-2">
                {exportWithRawGraded ? `1 free credit (${freeRemaining} left)` : `1 pro credit (${paidRemaining} left)`}
              </p>
              <button type="button" onClick={handleExport} disabled={exporting || (exportWithRawGraded ? !canExportRawGraded : !canExportCustom)} className="w-full px-4 py-2 bg-poke-accent text-white font-bold rounded-lg disabled:opacity-50">
                {exporting ? 'Exporting…' : 'Export image'}
              </button>
              {exportError && <p className="text-xs text-poke-accent mt-2">{exportError}</p>}
            </div>
          </div>
          <div className="flex-1 min-w-0 flex items-start justify-center">
            <div className="bg-[#111111] rounded-xl p-4 overflow-auto max-h-[70vh]">
              <div
                ref={previewRef}
                className="w-[800px] min-h-[900px] bg-[#0a0a0a] flex flex-col text-[#FBF9F6] overflow-visible"
                style={{ padding: '28px 32px', boxSizing: 'border-box' }}
              >
                <header className="w-full flex items-center z-10 shrink-0 pb-4 border-b border-white/10">
                  {exportWithRawGraded ? (
                    <div className="flex items-center shrink-0" style={{ lineHeight: '1' }}>
                      <LogoR size={32} style={{ marginRight: 10 }} />
                      <div className="flex flex-col">
                        <h1 className="text-2xl font-black italic tracking-tight text-poke-accent" style={{ margin: 0, padding: 0, lineHeight: '1' }}>RAWGRADED</h1>
                        <p className="text-gray-500 font-bold uppercase tracking-wider text-[10px]" style={{ margin: 0, padding: 0, marginTop: '2px' }}>Verified AI Scan</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 shrink-0">
                      {customLogoUrl && <img src={customLogoUrl} alt="" className="h-10 w-10 object-contain" />}
                      <div>
                        <h1 className="text-xl font-bold text-[#FBF9F6]" style={{ margin: 0, lineHeight: '1.2' }}>{customBrandName || 'Your brand'}</h1>
                        {customTagline && <p className="text-gray-400 text-xs" style={{ margin: 0, marginTop: 2 }}>{customTagline}</p>}
                      </div>
                    </div>
                  )}
                </header>
                {/* Magazine layout: left = words/details, right = images */}
                <div className="flex gap-8 pt-4 flex-1 min-h-0">
                  <div className="flex-1 min-w-0 flex flex-col gap-4">
                    <div>
                      <p className="font-bold text-lg text-gray-900 leading-tight">{data.metadata?.name || 'Card'}</p>
                      <p className="text-sm text-gray-500">{data.metadata?.set}{data.metadata?.year ? ` · ${data.metadata.year}` : ''}</p>
                    </div>
                    {finalGrade.defects && finalGrade.defects.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {finalGrade.defects.slice(0, 4).map((defect, idx) => {
                          const sourceImg = getSourceImageByIndex(data, defect.imageIndex, defect);
                          return (
                            <div key={idx} className="flex flex-col items-center bg-[#111111] p-2 rounded-lg border border-white/10">
                              <div className="origin-center flex items-center justify-center w-full" style={{ transform: 'scale(0.45)' }}>
                                {sourceImg && defect.box2d?.length === 4 ? (
                                  <EvidenceCrop imageSrc={sourceImg} box={defect.box2d} label={defect.category} hideLabel />
                                ) : (
                                  <div className="w-24 h-24 rounded border border-white/20 flex items-center justify-center bg-white/5 text-[9px] text-gray-300">No image</div>
                                )}
                              </div>
                              <span className="text-[10px] font-bold text-gray-300 uppercase mt-1">{defect.category}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {snippet && (
                      <div className="flex-1 min-h-0 p-4 rounded-xl bg-[#111111] border border-white/10 flex flex-col">
                        <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap flex-1">{snippet}</p>
                      </div>
                    )}
                  </div>
                  <div className="w-[280px] shrink-0 flex flex-col gap-4">
                    <div className="rounded-xl border border-white/10 overflow-hidden bg-[#111111] flex items-center justify-center" style={{ aspectRatio: '2.5/3.5' }}>
                      <img src={frontUrl} alt="Front" className="max-w-full max-h-full w-auto h-auto object-contain" style={{ objectFit: 'contain' }} />
                    </div>
                    <div className="rounded-xl border border-white/10 overflow-hidden bg-[#111111] flex items-center justify-center" style={{ aspectRatio: '2.5/3.5' }}>
                      <img src={backUrl} alt="Back" className="max-w-full max-h-full w-auto h-auto object-contain" style={{ objectFit: 'contain' }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EbayGraphicPlugin;
