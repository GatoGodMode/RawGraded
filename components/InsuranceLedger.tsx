import React, { useMemo, useState, useCallback, useRef } from 'react';
import { UserProfile } from '../types';

interface InsuranceLedgerProps {
    user: UserProfile;
    scans: any[];
    psaSlabs?: any[];
    unlockedMarketKeys?: Set<string>;
    onClose: () => void;
}

const LOGO_PATH = '/assets/logo/RawGraded Rectangle.svg';

// CDN globals
declare const jspdf: any;
declare const html2canvas: any;

const getImageUrl = (scan: any, type: 'front' | 'back' = 'front') => {
    if (!scan) return '';
    const thumbKey = `${type}_thumb`;
    const imgKey = `${type}_img`;
    const hasKey = `has_${type}_img`;
    if (typeof scan[thumbKey] === 'string' && scan[thumbKey].length > 10) return scan[thumbKey];
    if (typeof scan[imgKey] === 'string' && scan[imgKey].length > 10) return scan[imgKey];
    if (scan[hasKey] === 1 || scan[hasKey] === '1' || scan[hasKey] === true)
        return `api/collection.php?action=serve_image&id=${scan.id}&type=${type}`;
    return '';
};

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a: number, b: number) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : 'â€”';

type ExportState = 'idle' | 'print' | 'download';

const resolveMarketValue = (scan: any, unlockedKeys: Set<string>): number | null => {
    // If it's a PSA slab, no unlocked market data yet, use its stored estimated value if provided
    if (scan.is_psa_slab) return parseFloat(scan.estimated_value) || 0;

    const key = `${scan.name}|${scan.card_set}`;
    if (!unlockedKeys.has(key) || !scan.market_price_json) {
        return parseFloat(scan.estimated_value) || 0;
    }

    try {
        const pd = JSON.parse(scan.market_price_json);
        if (pd && typeof pd === 'object') {
            const rawMarket = pd.prices?.market || pd.prices?.mid || 0;
            const grades = Array.isArray(pd.psa_grades) ? pd.psa_grades : [];
            const psaRowsStat = grades
                .filter((g: any) => g.price > 0 && g.grade)
                .map((g: any) => ({ l: g.grade.replace('PSA ', ''), v: g.price }));
            const pwTcgStat = pd.sources?.tcgplayer?.market ?? null;
            const pwCmTStat = pd.sources?.cardmarket?.trend ?? null;
            
            // Replicate liveMktTotal logic from CardStatRow
            let gradeStr = scan.overall_grade > 0 ? scan.overall_grade.toString() : null;
            if (gradeStr && gradeStr.endsWith('.0')) gradeStr = gradeStr.slice(0, -2);
            const matchingTier = psaRowsStat.find((r: any) => r.l === gradeStr);
            const liveMktTotal = matchingTier ? matchingTier.v : (rawMarket || pwTcgStat || (pwCmTStat ? pwCmTStat * 1.09 : null));

            return liveMktTotal ?? (parseFloat(scan.estimated_value) || 0);
        }
    } catch { }

    return parseFloat(scan.estimated_value) || 0;
};

const InsuranceLedger: React.FC<InsuranceLedgerProps> = ({ user, scans, psaSlabs = [], unlockedMarketKeys = new Set(), onClose }) => {
    const [exportState, setExportState] = useState<ExportState>('idle');
    const [exportProgress, setExportProgress] = useState(0);
    const [filterSet, setFilterSet] = useState('');
    const [filterName, setFilterName] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);

    // Insurance Ledger includes ALL scans (including hidden) but excludes archived
    // Hidden certs are still owned assets that need insurance coverage
    const activeScans = useMemo(() => {
        const validScans = scans.filter(s => s.is_archived !== 1 && s.is_archived !== true);
        const mappedSlabs = psaSlabs
            .filter(s => s.status === 'active') // Only actual active slabs, skip pending/archived
            .map(s => ({
                id: s.psa_serial, // use serial as pseudo-id
                name: s.card_name || 'PSA Slab',
                card_set: s.card_set,
                year: s.card_year,
                overall_grade: parseFloat(s.psa_grade) || 0,
                acq_price: s.acq_price,
                acq_tax: 0,
                acq_shipping: (s.acq_shipping || 0) + (s.acq_grading_fee || 0),
                estimated_value: s.acq_price || 0, // Fallback if no market data
                is_psa_slab: true,
                front_thumb: s.front_img_url,
                rarity: '',
                is_first_edition: false
            }));
        return [...validScans, ...mappedSlabs];
    }, [scans, psaSlabs]);

    const uniqueSets = useMemo(() => {
        const sets = new Set<string>();
        activeScans.forEach(s => { if (s.card_set) sets.add(s.card_set); });
        return Array.from(sets).sort();
    }, [activeScans]);

    const uniqueNames = useMemo(() => {
        const names = new Set<string>();
        activeScans.forEach(s => { if (s.name) names.add(s.name); });
        return Array.from(names).sort();
    }, [activeScans]);

    const filteredScans = useMemo(() => activeScans.filter(s => {
        const setMatch = !filterSet || s.card_set === filterSet;
        const nameMatch = !filterName || s.name.toLowerCase().includes(filterName.toLowerCase());
        return setMatch && nameMatch;
    }), [activeScans, filterSet, filterName]);

    const isFiltered = filterSet !== '' || filterName !== '';
    const reportLabel = filterName
        ? `"${filterName}"${filterSet ? ` â€” ${filterSet}` : ''}`
        : filterSet || 'Full Collection';

    const totals = useMemo(() => {
        let itemsWithAcqData = 0, totalInvestment = 0, totalValue = 0, totalGraded = 0, gradeSum = 0;
        filteredScans.forEach(scan => {
            const cost = (parseFloat(scan.acq_price) || 0) + (parseFloat(scan.acq_tax) || 0) + (parseFloat(scan.acq_shipping) || 0);
            if (cost > 0) itemsWithAcqData++;
            totalInvestment += cost;
            totalValue += resolveMarketValue(scan, unlockedMarketKeys) || 0;
            const g = parseFloat(scan.overall_grade) || 0;
            if (g > 0) { totalGraded++; gradeSum += g; }
        });
        return { itemsWithAcqData, totalInvestment, totalValue, totalGraded, avgGrade: totalGraded > 0 ? (gradeSum / totalGraded).toFixed(1) : 'â€”' };
    }, [filteredScans, unlockedMarketKeys]);

    const populationReport = useMemo(() => {
        const setMap: Record<string, { totalCards: number; totalInvestment: number; cards: Record<string, { count: number; gradeSum: number; gradeCount: number; investment: number; rarity?: string; is_first_edition?: boolean; rawName?: string }>; }> = {};
        filteredScans.forEach(scan => {
            const set = scan.card_set || 'Unknown Set';
            const rawName = scan.name || 'Unknown Card';
            const isFirst = scan.is_first_edition === 1 || scan.is_first_edition === true;
            const rarity = scan.rarity || '';
            const nameKey = `${rawName}__${isFirst ? '1' : '0'}__${rarity}`;

            if (!setMap[set]) setMap[set] = { totalCards: 0, totalInvestment: 0, cards: {} };
            const entry = setMap[set];
            entry.totalCards++;
            const cost = (parseFloat(scan.acq_price) || 0) + (parseFloat(scan.acq_tax) || 0) + (parseFloat(scan.acq_shipping) || 0);
            entry.totalInvestment += cost;
            if (!entry.cards[nameKey]) entry.cards[nameKey] = { count: 0, gradeSum: 0, gradeCount: 0, investment: 0, rawName, is_first_edition: isFirst, rarity };
            entry.cards[nameKey].count++;
            entry.cards[nameKey].investment += cost;
            const g = parseFloat(scan.overall_grade) || 0;
            if (g > 0) { entry.cards[nameKey].gradeSum += g; entry.cards[nameKey].gradeCount++; }
        });
        return Object.entries(setMap).sort(([a], [b]) => a.localeCompare(b)).map(([set, data]) => ({
            set, totalCards: data.totalCards, totalInvestment: data.totalInvestment,
            cards: Object.values(data.cards).sort((a, b) => b.count - a.count).map(c => ({
                name: c.rawName || 'Unknown',
                count: c.count, investment: c.investment,
                isFirst: c.is_first_edition, rarity: c.rarity,
                avgGrade: c.gradeCount > 0 ? (c.gradeSum / c.gradeCount).toFixed(1) : 'â€”',
            }))
        }));
    }, [filteredScans]);

    // â”€â”€ Download PDF via jsPDF + html2canvas â”€â”€
    const handleDownloadPDF = useCallback(async () => {
        const el = contentRef.current;
        if (!el) { alert('Report content not found.'); return; }

        const hasJsPDF = typeof jspdf !== 'undefined';
        const hasHtml2Canvas = typeof html2canvas !== 'undefined';

        if (!hasJsPDF || !hasHtml2Canvas) {
            alert('PDF library not loaded yet. Please wait a moment and try again.');
            return;
        }

        setExportState('download');
        setExportProgress(0);
        // Yield to React so loading state renders
        await new Promise(r => setTimeout(r, 250));

        try {
            const { jsPDF } = jspdf;
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            const margin = 8;
            const usableW = pageW - margin * 2;
            const usableH = pageH - margin * 2;

            const sections = Array.from(el.querySelectorAll<HTMLElement>('[data-pdf-section]'));
            const total = Math.max(sections.length, 1);

            for (let i = 0; i < sections.length; i++) {
                setExportProgress(Math.round(((i + 0.5) / total) * 100));

                const canvas = await html2canvas(sections[i], {
                    scale: 2,
                    useCORS: true,
                    allowTaint: false,
                    backgroundColor: '#ffffff',
                    logging: false,
                    windowWidth: 1200,
                });

                const canvasW = canvas.width;
                const canvasH = canvas.height;
                // Height of the full canvas when rendered at usableW mm wide
                const renderH = (canvasH / canvasW) * usableW;

                let yRendered = 0;
                let firstPage = true;

                while (yRendered < renderH && yRendered < canvasH) { // Prevent infinite blank pages
                    if (!firstPage) pdf.addPage();
                    firstPage = false;

                    const sliceRenderedH = Math.min(usableH, renderH - yRendered);
                    // Make sure we don't try to render a height of 0
                    if (sliceRenderedH <= 0) break;

                    // Corresponding source pixels
                    const srcY = Math.round((yRendered / renderH) * canvasH);
                    const srcH = Math.round((sliceRenderedH / renderH) * canvasH);

                    if (srcH <= 0) break;

                    const slice = document.createElement('canvas');
                    slice.width = canvasW;
                    slice.height = srcH;
                    const ctx = slice.getContext('2d')!;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvasW, srcH);
                    ctx.drawImage(canvas, 0, srcY, canvasW, srcH, 0, 0, canvasW, srcH);

                    const sliceData = slice.toDataURL('image/jpeg', 0.90);
                    pdf.addImage(sliceData, 'JPEG', margin, margin, usableW, sliceRenderedH);
                    yRendered += sliceRenderedH;
                }

                if (i < sections.length - 1) pdf.addPage();
                setExportProgress(Math.round(((i + 1) / total) * 100));
            }

            const safeName = (filterName || filterSet || 'collection').replace(/[^a-z0-9]/gi, '_').toLowerCase();
            pdf.save(`rawgraded_ledger_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
        } catch (err) {
            console.error('PDF generation error:', err);
            alert('PDF generation failed. Try the Print button as a fallback.');
        } finally {
            setExportState('idle');
            setExportProgress(0);
        }
    }, [filterName, filterSet]);

    // â”€â”€ Print via browser dialog â”€â”€
    const handlePrint = useCallback(async () => {
        setExportState('print');
        // Wait for React to re-render and remove overflow so the browser can see full content
        await new Promise(r => setTimeout(r, 400));
        // Add body class so CSS can isolate only the ledger during print
        document.body.classList.add('ledger-printing');
        window.print();
        await new Promise(r => setTimeout(r, 300));
        document.body.classList.remove('ledger-printing');
        setExportState('idle');
    }, []);

    const generatedDate = new Date().toLocaleString();
    const busy = exportState !== 'idle';

    return (
        // CRITICAL: Remove overflow during both download AND print so full content is accessible
        <div id="insurance-ledger-root" className={`fixed inset-0 z-[200] print:static print:inset-auto print:overflow-visible bg-white text-black font-sans ${(exportState === 'download' || exportState === 'print') ? '' : 'overflow-y-auto custom-scrollbar'}`}>

            {/* Loading Overlay */}
            {busy && (
                <div className="fixed inset-0 z-[300] bg-white/95 flex flex-col items-center justify-center gap-6 print:hidden">
                    <div className="w-16 h-16 border-4 border-gray-200 border-t-black rounded-full animate-spin" />
                    <div className="text-center">
                        {exportState === 'download' ? (
                            <>
                                <p className="text-xl font-black uppercase tracking-tight">Building PDFâ€¦</p>
                                <div className="w-64 h-2 bg-gray-200 rounded-full mt-3 overflow-hidden">
                                    <div className="h-full bg-black rounded-full transition-all duration-300" style={{ width: `${exportProgress}%` }} />
                                </div>
                                <p className="text-sm text-gray-500 font-bold mt-2">{exportProgress}% â€” {filteredScans.length} assets</p>
                            </>
                        ) : (
                            <>
                                <p className="text-xl font-black uppercase tracking-tight">Preparing for Printâ€¦</p>
                                <p className="text-sm text-gray-500 font-bold mt-1">Print dialog opening shortly</p>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* â”€â”€ Sticky Action Bar (print:hidden) â”€â”€ */}
            <div className="sticky top-0 bg-gray-100 border-b border-gray-300 p-3 print:hidden shadow-sm z-10">
                <div className="flex flex-wrap gap-3 items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onClose}
                            className="w-9 h-9 rounded-full bg-white hover:bg-gray-200 border border-gray-300 flex items-center justify-center transition-colors text-gray-700"
                            title="Close">
                            <i className="fas fa-arrow-left text-sm"></i>
                        </button>
                        <div>
                            <h2 className="text-lg font-black uppercase tracking-tight leading-none">Insurance Ledger</h2>
                            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                                {filteredScans.length} assets
                                {isFiltered && <span className="ml-2 text-poke-accent">FILTERED: {reportLabel}</span>}
                            </p>
                        </div>
                    </div>

                    {/* Filter Controls */}
                    <div className="flex items-center gap-2 flex-1 max-w-xl">
                        <div className="relative flex-1">
                            <select value={filterSet} onChange={e => setFilterSet(e.target.value)}
                                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-black appearance-none pr-8">
                                <option value="">All Sets</option>
                                {uniqueSets.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <i className="fas fa-chevron-down absolute right-3 top-3 text-gray-400 text-xs pointer-events-none"></i>
                        </div>
                        <div className="relative flex-1">
                            <input type="text" list="ledger-card-names" placeholder="Filter by card nameâ€¦"
                                value={filterName} onChange={e => setFilterName(e.target.value)}
                                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-black" />
                            <datalist id="ledger-card-names">
                                {uniqueNames.map(n => <option key={n} value={n} />)}
                            </datalist>
                        </div>
                        {isFiltered && (
                            <button onClick={() => { setFilterSet(''); setFilterName(''); }}
                                className="px-3 py-2 text-xs font-black uppercase bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700 whitespace-nowrap transition-colors">
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Export Buttons */}
                    <div className="flex items-center gap-2">
                        <button onClick={handleDownloadPDF} disabled={busy}
                            className="bg-black text-white px-4 py-2 rounded-lg font-black uppercase tracking-wider hover:bg-gray-800 disabled:opacity-50 transition-all shadow-md flex items-center gap-2 text-sm">
                            <i className={`fas ${exportState === 'download' ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                            {exportState === 'download' ? `${exportProgress}%` : 'Download PDF'}
                        </button>
                        <button onClick={handlePrint} disabled={busy}
                            className="bg-white text-black border-2 border-black px-4 py-2 rounded-lg font-black uppercase tracking-wider hover:bg-gray-100 disabled:opacity-50 transition-all flex items-center gap-2 text-sm">
                            <i className={`fas ${exportState === 'print' ? 'fa-spinner fa-spin' : 'fa-print'}`}></i>
                            Print
                        </button>
                    </div>
                </div>
            </div>

            {/* â”€â”€ All printable/downloadable content â”€â”€ */}
            <div ref={contentRef}>

                {/* â•â•â•â• PAGE 1 â€” Cover + Overview â•â•â•â• */}
                <div data-pdf-section className="max-w-4xl mx-auto px-12 py-14 print:px-10 print:py-10">

                    <div className="flex flex-col items-start gap-1 mb-10">
                        <img src={LOGO_PATH} className="h-12 mb-2" alt="RawGraded"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        <h1 className="text-5xl font-black uppercase tracking-tighter leading-none">Asset Insurance<br />Ledger</h1>
                        {isFiltered && (
                            <div className="mt-2 bg-black text-white px-4 py-1.5 rounded-lg inline-flex items-center gap-2 text-sm font-black uppercase tracking-wider">
                                <i className="fas fa-filter text-xs"></i> Filtered: {reportLabel}
                            </div>
                        )}
                        <p className="text-sm font-bold text-gray-500 uppercase tracking-[0.3em] mt-2">Statement of Authenticity &amp; Valuation</p>
                    </div>

                    <div className="border-2 border-black rounded-2xl p-5 mb-8 bg-gray-50 grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Account Holder</p>
                            <p className="text-2xl font-black">@{user.x_username || user.id}</p>
                            <p className="text-xs font-mono text-gray-500 mt-1">UID: {String(user.id)}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Generated On</p>
                            <p className="font-mono text-sm font-bold">{generatedDate}</p>
                            <p className="text-[9px] text-gray-400 uppercase tracking-widest mt-1">RAWGRADED.COM â€” PRIVATE DOCUMENT</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-10">
                        {[
                            { label: 'Total Assets on Record', value: filteredScans.length.toLocaleString(), sub: `${totals.totalGraded} with AI forensic grading` },
                            { label: 'Average Grade (Graded)', value: totals.avgGrade, sub: 'AI Forensic Assessment Score' },
                            { label: 'Total Cost / Investment', value: `$${fmt(totals.totalInvestment)}`, sub: `Documented across ${totals.itemsWithAcqData} items` },
                            { label: 'Estimated Market Value', value: `$${fmt(totals.totalValue)}`, sub: 'Based on current market estimates' },
                        ].map(({ label, value, sub }) => (
                            <div key={label} className="border border-gray-200 p-5 rounded-xl bg-white shadow-sm">
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{label}</p>
                                <p className="text-3xl font-black">{value}</p>
                                <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase">{sub}</p>
                            </div>
                        ))}
                    </div>

                </div>

                {/* Population Report chunks */}
                {Array.from({ length: Math.ceil(populationReport.length / 5) || 1 }).map((_, chunkIdx) => {
                    const chunkSets = populationReport.slice(chunkIdx * 5, (chunkIdx + 1) * 5);
                    return (
                        <div key={`pop-chunk-${chunkIdx}`} data-pdf-section className="max-w-4xl mx-auto px-12 py-8 print:px-10 print:py-4">
                            {chunkIdx === 0 && (
                                <h2 className="text-sm font-black uppercase tracking-widest border-b-2 border-black pb-2 mb-5">
                                    Population Report
                                    <span className="ml-3 text-gray-400 font-bold normal-case tracking-normal text-xs">
                                        {populationReport.length} set{populationReport.length !== 1 ? 's' : ''} Â· {filteredScans.length} total cards
                                    </span>
                                </h2>
                            )}
                            <div className="space-y-6">
                                {chunkSets.map(({ set, totalCards, totalInvestment, cards }) => (
                                    <div key={set} className="border border-gray-200 rounded-xl overflow-hidden">
                                        <div className="bg-gray-900 text-white px-5 py-3 flex justify-between items-center">
                                            <div>
                                                <p className="font-black text-base leading-none">{set}</p>
                                                <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mt-0.5">
                                                    {totalCards} card{totalCards !== 1 ? 's' : ''} Â· {pct(totalCards, filteredScans.length)} of report
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Set Investment</p>
                                                <p className="font-black text-lg">${fmt(totalInvestment)}</p>
                                            </div>
                                        </div>
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b border-gray-200 bg-gray-50">
                                                    <th className="text-left px-5 py-2 font-black text-gray-500 uppercase tracking-wider">Card Name</th>
                                                    <th className="text-center px-3 py-2 font-black text-gray-500 uppercase tracking-wider">Count</th>
                                                    <th className="text-center px-3 py-2 font-black text-gray-500 uppercase tracking-wider">Avg Grade</th>
                                                    <th className="text-right px-5 py-2 font-black text-gray-500 uppercase tracking-wider">Cost Basis</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {cards.map((card, idx) => (
                                                    <tr key={`${card.name}-${idx}`} className="hover:bg-gray-50">
                                                        <td className="px-5 py-2 font-bold text-gray-800">
                                                            <div className="flex items-center gap-2">
                                                                {card.isFirst && <span className="text-[8px] bg-yellow-500/20 border border-yellow-500/50 text-yellow-700 px-1 py-0.5 rounded uppercase font-black tracking-widest leading-none">1st ED</span>}
                                                                {card.name}
                                                                {card.rarity && <span className="ml-1 text-[9px] text-gray-500 font-medium tracking-widest">{card.rarity}</span>}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            <span className="inline-flex items-center justify-center bg-black text-white font-black rounded-full w-7 h-7 text-[11px]">{card.count}</span>
                                                        </td>
                                                        <td className="px-3 py-2 text-center font-mono font-bold">{card.avgGrade}</td>
                                                        <td className="px-5 py-2 text-right font-mono font-bold">{card.investment > 0 ? `$${fmt(card.investment)}` : 'â€”'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}

                {/* â•â•â•â• PAGE 2 â€” Asset Index chunks â•â•â•â• */}
                {Array.from({ length: Math.ceil(filteredScans.length / 40) || 1 }).map((_, chunkIdx) => {
                    const chunkScans = filteredScans.slice(chunkIdx * 40, (chunkIdx + 1) * 40);
                    return (
                        <div key={`index-chunk-${chunkIdx}`} data-pdf-section className="max-w-4xl mx-auto px-12 py-10 print:px-10 print:py-10 print:break-after-page border-t-4 border-dashed border-gray-200 print:border-none">
                            {chunkIdx === 0 && (
                                <h2 className="text-sm font-black uppercase tracking-widest border-b-2 border-black pb-2 mb-4">
                                    Asset Index
                                    <span className="ml-3 text-gray-400 font-bold normal-case tracking-normal text-xs">{filteredScans.length} records</span>
                                </h2>
                            )}
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-gray-300">
                                        <th className="text-left py-2 font-black text-gray-500 uppercase tracking-wider w-8">#</th>
                                        <th className="text-left py-2 font-black text-gray-500 uppercase tracking-wider">Card Name</th>
                                        <th className="text-left py-2 font-black text-gray-500 uppercase tracking-wider">Set / Year</th>
                                        <th className="text-right py-2 font-black text-gray-500 uppercase tracking-wider">Grade</th>
                                        <th className="text-right py-2 font-black text-gray-500 uppercase tracking-wider">Cost Basis</th>
                                        <th className="text-right py-2 font-black text-gray-500 uppercase tracking-wider">Market Value</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {chunkScans.map((scan, i) => {
                                        const actualIndex = chunkIdx * 40 + i;
                                        const cost = (parseFloat(scan.acq_price) || 0) + (parseFloat(scan.acq_tax) || 0) + (parseFloat(scan.acq_shipping) || 0);
                                        const marketValue = resolveMarketValue(scan, unlockedMarketKeys) || 0;
                                        return (
                                            <tr key={scan.id} className="hover:bg-gray-50">
                                                <td className="py-1.5 text-gray-400 font-mono">{actualIndex + 1}</td>
                                                <td className="py-1.5 font-bold">{scan.name}</td>
                                                <td className="py-1.5 text-gray-500">{scan.card_set} {scan.year}</td>
                                                <td className="py-1.5 text-right font-mono">{scan.overall_grade > 0 ? Number(scan.overall_grade).toFixed(1) : 'â€”'}</td>
                                                <td className="py-1.5 text-right font-mono">{cost > 0 ? `$${fmt(cost)}` : 'â€”'}</td>
                                                <td className="py-1.5 text-right font-mono">{marketValue > 0 ? `$${fmt(marketValue)}` : 'Ã¢â‚¬â€'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    );
                })}

                {/* â•â•â•â• PAGES 3+ â€” Itemized Schedule chunks â•â•â•â• */}
                {Array.from({ length: Math.ceil(filteredScans.length / 4) || 1 }).map((_, chunkIdx) => {
                    const chunkScans = filteredScans.slice(chunkIdx * 4, (chunkIdx + 1) * 4);
                    const isLastChunk = chunkIdx === Math.ceil(filteredScans.length / 4) - 1 || filteredScans.length === 0;

                    return (
                        <div key={`schedule-chunk-${chunkIdx}`} data-pdf-section className="max-w-4xl mx-auto px-12 py-8 print:px-8 print:py-4">
                            {chunkIdx === 0 && (
                                <h2 className="text-xl font-black uppercase tracking-tight mb-6 border-b-4 border-black pb-3 print:text-base">
                                    Itemized Schedule
                                    <span className="ml-3 text-base font-bold normal-case tracking-normal text-gray-400 print:text-sm">
                                        {filteredScans.length} asset{filteredScans.length !== 1 ? 's' : ''}
                                    </span>
                                </h2>
                            )}

                            <div className="space-y-8">
                                {chunkScans.map((scan, index) => {
                                    const actualIndex = chunkIdx * 4 + index;
                                    const price = parseFloat(scan.acq_price) || 0;
                                    const tax = parseFloat(scan.acq_tax) || 0;
                                    const ship = parseFloat(scan.acq_shipping) || 0;
                                    const totalCost = price + tax + ship;
                                    const marketValue = resolveMarketValue(scan, unlockedMarketKeys) || 0;
                                    let defects: any[] = [];
                                    try { if (scan.defects_json) defects = JSON.parse(scan.defects_json); } catch (_) { }
                                    const frontUrl = getImageUrl(scan, 'front');
                                    const backUrl = getImageUrl(scan, 'back');

                                    return (
                                        <div key={scan.id} className="border border-gray-300 rounded-xl overflow-hidden shadow-sm break-inside-avoid print:break-inside-avoid block bg-white">
                                            <div className="bg-black text-white p-4 flex justify-between items-start">
                                                <div className="flex items-start gap-3">
                                                    <span className="text-gray-500 font-mono text-sm font-bold pt-0.5 min-w-[28px]">{actualIndex + 1}.</span>
                                                    <div>
                                                        <h3 className="font-black text-lg leading-tight flex items-center gap-2">
                                                            {scan.is_first_edition === 1 || scan.is_first_edition === true ? <span className="bg-yellow-500 text-black text-[9px] px-1.5 py-0.5 rounded uppercase font-black tracking-widest shrink-0">1st ED</span> : null}
                                                            {scan.name}
                                                        </h3>
                                                        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">{scan.card_set} ({scan.year}){scan.artist ? ` Â· ${scan.artist}` : ''}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right flex flex-col items-end gap-1.5 shrink-0 pl-4">
                                                    {scan.overall_grade > 0 && (
                                                        <div className="bg-white/10 border border-white/20 px-3 py-1 rounded-lg flex gap-2 items-center">
                                                            <span className="text-[9px] text-gray-400 uppercase font-black">Grade</span>
                                                            <span className="text-lg font-black text-white leading-none">{Number(scan.overall_grade).toFixed(1)}</span>
                                                        </div>
                                                    )}
                                                    {marketValue > 0 && (
                                                        <div className="bg-white/10 border border-white/20 px-3 py-1 rounded-lg flex gap-2 items-center">
                                                            <span className="text-[9px] text-gray-400 uppercase font-black">Market</span>
                                                            <span className="text-sm font-black text-white leading-none">${fmt(marketValue)}</span>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest">Cert ID</p>
                                                        <p className="font-mono text-[11px] text-gray-300 break-all">{scan.id}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Refactored GRID to FLEX for print safety */}
                                            <div className="p-5 flex flex-col md:flex-row gap-6 items-start">
                                                {/* Left Column */}
                                                <div className="w-full md:w-2/3 space-y-5">
                                                    <div className="flex flex-col sm:flex-row gap-6">
                                                        {/* Investment */}
                                                        <div className="flex-1">
                                                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 pb-1 mb-2">Investment Breakdown</h4>
                                                            <table className="w-full text-sm">
                                                                <tbody className="divide-y divide-gray-100">
                                                                    <tr><td className="py-1.5 text-gray-500 font-bold uppercase text-[10px]">Purchase Price</td><td className="py-1.5 text-right font-black">${price.toFixed(2)}</td></tr>
                                                                    <tr><td className="py-1.5 text-gray-500 font-bold uppercase text-[10px]">Taxes Paid</td><td className="py-1.5 text-right font-black">${tax.toFixed(2)}</td></tr>
                                                                    <tr><td className="py-1.5 text-gray-500 font-bold uppercase text-[10px]">Shipping</td><td className="py-1.5 text-right font-black">${ship.toFixed(2)}</td></tr>
                                                                    <tr className="bg-gray-50"><td className="py-1.5 px-2 text-black font-black uppercase text-[10px]">Total Cost Basis</td><td className="py-1.5 px-2 text-right font-black text-base">${fmt(totalCost)}</td></tr>
                                                                    <tr className="bg-blue-50"><td className="py-1.5 px-2 text-blue-900 font-black uppercase text-[10px]">Current Market Estimate</td><td className="py-1.5 px-2 text-right font-black text-base text-blue-900">{marketValue > 0 ? `$${fmt(marketValue)}` : '--'}</td></tr>
                                                                </tbody>
                                                            </table>
                                                        </div>

                                                        {/* Provenance + Details */}
                                                        <div className="flex-1 space-y-4">
                                                            <div>
                                                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 pb-1 mb-2">Provenance / Source</h4>
                                                                <div className="space-y-2 text-sm">
                                                                    <div><p className="text-[9px] text-gray-400 font-black uppercase">Vendor / Platform</p><p className="font-black">{scan.acq_source || 'Unspecified'}</p></div>
                                                                    {(scan.acq_city || scan.acq_state) && <div><p className="text-[9px] text-gray-400 font-black uppercase">Location</p><p className="font-bold text-gray-700">{scan.acq_city}{scan.acq_city && scan.acq_state ? ', ' : ''}{scan.acq_state}</p></div>}
                                                                    {scan.acq_date && <div><p className="text-[9px] text-gray-400 font-black uppercase">Date Acquired</p><p className="font-bold text-gray-700">{scan.acq_date}</p></div>}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 pb-1 mb-2">Card Details</h4>
                                                                <div className="space-y-1.5 text-sm">
                                                                    {scan.rarity && <div><p className="text-[9px] text-gray-400 font-black uppercase">Rarity</p><p className="font-bold text-gray-800">{scan.rarity}</p></div>}
                                                                    <div><p className="text-[9px] text-gray-400 font-black uppercase">Set</p><p className="font-bold text-gray-800">{scan.card_set || 'â€”'}</p></div>
                                                                    <div><p className="text-[9px] text-gray-400 font-black uppercase">Year of Release</p><p className="font-bold text-gray-800">{scan.year || 'â€”'}</p></div>
                                                                    {scan.artist && <div><p className="text-[9px] text-gray-400 font-black uppercase">Artist</p><p className="font-bold text-gray-800">{scan.artist}</p></div>}
                                                                    {scan.character_name && scan.character_name !== scan.name && <div><p className="text-[9px] text-gray-400 font-black uppercase">Character</p><p className="font-bold text-gray-800">{scan.character_name}</p></div>}
                                                                </div>
                                                                {scan.name_history && (
                                                                    <div className="mt-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
                                                                        <h4 className="text-[9px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-2 mb-2"><i className="fas fa-history text-gray-400"></i> Asset Audit Trail</h4>
                                                                        <div className="space-y-2">
                                                                            {(() => {
                                                                                try {
                                                                                    const history = JSON.parse(scan.name_history);
                                                                                    if (!Array.isArray(history) || history.length === 0) return <p className="text-xs text-gray-400 italic">No history available</p>;
                                                                                    return history.map((entry: any, i: number) => (
                                                                                        <div key={i} className="text-[10px] text-gray-600 font-mono">
                                                                                            <span className="font-bold text-black">{entry.old_name}</span>
                                                                                            <i className="fas fa-arrow-right mx-1 text-gray-400 text-[8px]"></i>
                                                                                            <span className="font-bold text-black">{entry.new_name}</span>
                                                                                            <br /><span className="text-gray-400 tracking-tight">Edited {new Date(entry.changed_at).toLocaleString()} by Entity</span>
                                                                                        </div>
                                                                                    ));
                                                                                } catch (e) { return <p className="text-[10px] text-gray-400">History malformed.</p>; }
                                                                            })()}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Tracking + Forensic â€” ONLY 2 columns, vault notes is BELOW */}
                                                    <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-4 space-y-3">
                                                        <div className="flex gap-4">
                                                            <div className="flex-1">
                                                                <h4 className="text-[9px] font-black text-blue-600 uppercase tracking-widest pb-1 border-b border-blue-200/50 mb-2">Order Tracking</h4>
                                                                <div className="space-y-1.5 text-xs">
                                                                    {scan.tracking_number
                                                                        ? <div className="flex justify-between items-center"><span className="text-gray-500 font-bold uppercase text-[10px]">Tracking</span><span className="font-mono font-bold text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-100">{scan.tracking_number}</span></div>
                                                                        : <div className="text-gray-400 italic text-[11px]">No tracking recorded.</div>}
                                                                    {scan.order_id
                                                                        ? <div className="flex justify-between items-center"><span className="text-gray-500 font-bold uppercase text-[10px]">Order ID</span><span className="font-mono font-bold text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-100">{scan.order_id}</span></div>
                                                                        : <div className="text-gray-400 italic text-[11px]">No order number recorded.</div>}
                                                                </div>
                                                            </div>
                                                            <div className="flex-1">
                                                                <h4 className="text-[9px] font-black text-blue-600 uppercase tracking-widest pb-1 border-b border-blue-200/50 mb-2">Forensic Analysis</h4>
                                                                {scan.overall_grade > 0 ? (
                                                                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                                                                        {[['Centering', scan.centering], ['Corners', scan.corners], ['Edges', scan.edges], ['Surface', scan.surface]].map(([lbl, val]) => (
                                                                            <div key={String(lbl)} className="flex justify-between border-b border-blue-100 pb-0.5">
                                                                                <span className="text-gray-500 font-bold uppercase">{lbl}</span>
                                                                                <span className="font-black text-gray-800">{Number(val).toFixed(1)}</span>
                                                                            </div>
                                                                        ))}
                                                                        {defects.length > 0 && <div className="col-span-2 mt-1 text-[9px] text-red-700 italic border-l-2 border-red-300 pl-2">{defects.length} defect(s) detected</div>}
                                                                    </div>
                                                                ) : <div className="text-[10px] text-gray-400 italic">No AI valuation stored.</div>}
                                                            </div>
                                                        </div>
                                                        {scan.user_notes && (
                                                            <div className="border-t border-blue-200/50 pt-3">
                                                                <h4 className="text-[9px] font-black text-blue-600 uppercase tracking-widest pb-1 mb-2">Vault Notes</h4>
                                                                <p className="text-xs italic text-gray-600 bg-white p-2 rounded border border-blue-100 whitespace-pre-wrap leading-relaxed">"{scan.user_notes}"</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Right Column (Images) */}
                                                <div className="w-full md:w-1/3 flex flex-col gap-3">
                                                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 pb-1 text-center">Physical Asset</h4>
                                                    <div className="flex gap-2">
                                                        <div className="flex-1 bg-gray-100 p-1.5 rounded-lg border border-gray-200 flex flex-col items-center justify-center min-h-[130px]">
                                                            {frontUrl ? <img src={frontUrl} alt="Front" className="max-h-36 rounded object-contain" crossOrigin="anonymous" /> : <span className="text-[10px] text-gray-400 font-bold uppercase">No Image</span>}
                                                            <span className="text-[8px] mt-1 text-gray-400 font-bold uppercase">Front</span>
                                                        </div>
                                                        <div className="flex-1 bg-gray-100 p-1.5 rounded-lg border border-gray-200 flex flex-col items-center justify-center min-h-[130px]">
                                                            {backUrl ? <img src={backUrl} alt="Back" className="max-h-36 rounded object-contain" crossOrigin="anonymous" /> : <span className="text-[10px] text-gray-400 font-bold uppercase">No Image</span>}
                                                            <span className="text-[8px] mt-1 text-gray-400 font-bold uppercase">Back</span>
                                                        </div>
                                                    </div>
                                                    {scan.envelope_receipt_img && (
                                                        <div>
                                                            <h4 className="text-[9px] font-black text-blue-500 uppercase tracking-widest text-center mt-2 mb-1 flex items-center justify-center gap-1">
                                                                <i className="fas fa-receipt"></i> Receipt
                                                            </h4>
                                                            <div className="bg-blue-50 p-1.5 rounded-lg border border-blue-200 flex items-center justify-center">
                                                                <img src={scan.envelope_receipt_img} alt="Receipt" className="max-w-full rounded object-contain" crossOrigin="anonymous" />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {isLastChunk && (
                                <div className="text-center pt-12 pb-8 border-t-2 border-dashed border-gray-300 mt-8">
                                    <p className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">End of Insurance Schedule</p>
                                    {isFiltered && <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase">Report Scope: {reportLabel}</p>}
                                    <p className="text-[10px] font-bold text-gray-400 mt-1">PRIVATE ASSET LEDGER â€¢ RAWGRADED.COM â€¢ {generatedDate}</p>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default InsuranceLedger;
