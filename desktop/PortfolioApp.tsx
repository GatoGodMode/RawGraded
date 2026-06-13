import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudioPortfolioCard, StudioPortfolioProvenance } from '../services/portfolio/studioPortfolioTypes';
import type { PortfolioListResult, PcSearchCandidate } from '../services/portfolio/portfolioBridgeTypes';
import PriceChartingPickModal from '../components/pricing/PriceChartingPickModal';
import { fmtMoney } from '../services/pricing/tcgConditionPrice';
import MarketPriceCell from '../components/pricing/MarketPriceCell';
import ExternalMarketLinks from '../components/pricing/ExternalMarketLinks';
import PortfolioCertificateModal from './PortfolioCertificateModal';

type ViewFilter = 'active' | 'archived';

interface PortfolioAppProps {
  onOpenSettings?: () => void;
  onOpenStudio?: () => void;
}

const PAGE_SIZE = 50;

const PortfolioApp: React.FC<PortfolioAppProps> = ({ onOpenSettings, onOpenStudio }) => {
  const [items, setItems] = useState<StudioPortfolioCard[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<ViewFilter>('active');
  const [sort, setSort] = useState<'updated' | 'name' | 'raw'>('updated');
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [batchRefreshing, setBatchRefreshing] = useState(false);
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});
  const [editCard, setEditCard] = useState<StudioPortfolioCard | null>(null);
  const [provenanceDraft, setProvenanceDraft] = useState<StudioPortfolioProvenance>({});
  const [pcPickCardId, setPcPickCardId] = useState<string | null>(null);
  const [pcCandidates, setPcCandidates] = useState<PcSearchCandidate[]>([]);
  const [pcSearchUrl, setPcSearchUrl] = useState<string | undefined>();
  const [pcPickLoading, setPcPickLoading] = useState(false);
  const [certCard, setCertCard] = useState<StudioPortfolioCard | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (!window.desktop?.portfolioList) return;
    setLoading(true);
    try {
      const res = (await window.desktop.portfolioList({
        limit: PAGE_SIZE,
        offset,
        search: debouncedSearch || undefined,
        includeArchived: filter === 'archived',
        sort,
      })) as PortfolioListResult;
      setItems(res.items || []);
      setTotal(res.total || 0);
    } finally {
      setLoading(false);
    }
  }, [offset, debouncedSearch, filter, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!window.desktop?.onPortfolioRefreshProgress) return;
    return window.desktop.onPortfolioRefreshProgress((ev) => {
      if (!ev.ok && ev.error) {
        setRefreshErrors((prev) => ({ ...prev, [ev.cardId]: ev.error! }));
      }
    });
  }, []);

  const totals = useMemo(() => {
    let rawSum = 0;
    let tcgSum = 0;
    for (const c of items) {
      if (typeof c.raw === 'number' && Number.isFinite(c.raw)) rawSum += c.raw;
      if (typeof c.tcgMarket === 'number' && Number.isFinite(c.tcgMarket)) tcgSum += c.tcgMarket;
    }
    return { rawSum, tcgSum };
  }, [items]);

  const refreshOne = async (id: string) => {
    if (!window.desktop?.pricingRefreshCard) return;
    setRefreshingId(id);
    setRefreshErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const res = await window.desktop.pricingRefreshCard(id);
      if (res.ok && res.card) {
        setItems((prev) => prev.map((c) => (c.id === id ? (res.card as StudioPortfolioCard) : c)));
      } else if (res.needsPick) {
        setPcPickCardId(id);
        setPcCandidates(res.candidates || []);
        setPcSearchUrl(res.searchUrl);
        setRefreshErrors((prev) => ({ ...prev, [id]: res.error || 'Pick a PriceCharting listing' }));
      } else if (!res.ok) {
        setRefreshErrors((prev) => ({ ...prev, [id]: res.error || 'Refresh failed' }));
      }
    } finally {
      setRefreshingId(null);
    }
  };

  const refreshStale = async () => {
    if (!window.desktop?.pricingRefreshBatch) return;
    setBatchRefreshing(true);
    try {
      await window.desktop.pricingRefreshBatch({ maxAgeMs: 24 * 60 * 60 * 1000 });
      await load();
    } finally {
      setBatchRefreshing(false);
    }
  };

  const archive = async (id: string, archived: boolean) => {
    if (!window.desktop?.portfolioArchive) return;
    await window.desktop.portfolioArchive(id, archived);
    await load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this card from your local portfolio?')) return;
    if (!window.desktop?.portfolioDelete) return;
    await window.desktop.portfolioDelete(id);
    await load();
  };

  const openProvenance = (card: StudioPortfolioCard) => {
    setEditCard(card);
    setProvenanceDraft({ ...card.provenance });
  };

  const saveProvenance = async () => {
    if (!editCard || !window.desktop?.portfolioUpdateProvenance) return;
    const updated = await window.desktop.portfolioUpdateProvenance(editCard.id, provenanceDraft);
    if (updated) {
      setItems((prev) => prev.map((c) => (c.id === editCard.id ? (updated as StudioPortfolioCard) : c)));
    }
    setEditCard(null);
  };

  const gradeLabel = (c: StudioPortfolioCard) => {
    const g = c.grading;
    if (!g) return '—';
    const tcg = g.predictedGrades?.tcg;
    const overall = g.overall;
    return [tcg, overall != null ? `Overall ${overall}` : null].filter(Boolean).join(' · ');
  };

  const handlePcPick = async (url: string) => {
    if (!pcPickCardId || !window.desktop?.pricingRefreshWithPcUrl) return;
    setPcPickLoading(true);
    try {
      const res = await window.desktop.pricingRefreshWithPcUrl(pcPickCardId, url);
      if (res.ok && res.card) {
        setItems((prev) => prev.map((c) => (c.id === pcPickCardId ? (res.card as StudioPortfolioCard) : c)));
        setRefreshErrors((prev) => {
          const next = { ...prev };
          delete next[pcPickCardId];
          return next;
        });
        setPcPickCardId(null);
      } else {
        setRefreshErrors((prev) => ({ ...prev, [pcPickCardId]: res.error || 'Pick failed' }));
        if (res.candidates?.length) setPcCandidates(res.candidates);
      }
    } finally {
      setPcPickLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-black uppercase tracking-[0.3em] text-poke-gold">Portfolio</h1>
          <p className="text-[10px] text-gray-500 mt-1">Local SQLite · PriceCharting + TCGPlayer</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onOpenStudio && (
            <button type="button" onClick={onOpenStudio} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-white/15 rounded">
              Scan Studio
            </button>
          )}
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border border-white/15 rounded">
              Settings
            </button>
          )}
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            placeholder="Search name, set, number…"
            className="flex-1 min-w-[12rem] rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm outline-none focus:border-poke-gold/40"
          />
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as ViewFilter);
              setOffset(0);
            }}
            className="rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2 text-xs uppercase tracking-widest"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2 text-xs uppercase tracking-widest"
          >
            <option value="updated">Updated</option>
            <option value="name">Name</option>
            <option value="raw">Raw price</option>
          </select>
          <button
            type="button"
            disabled={batchRefreshing}
            onClick={() => void refreshStale()}
            className="px-4 py-2 bg-poke-gold text-black text-[10px] font-black uppercase tracking-widest rounded disabled:opacity-40"
          >
            {batchRefreshing ? 'Refreshing…' : 'Refresh stale'}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-gray-500 border-b border-white/10">
                <th className="px-3 py-3 text-left">Card</th>
                <th className="px-3 py-3 text-left">Grade</th>
                <th className="px-3 py-3 text-right">PC / TCG</th>
                <th className="px-3 py-3 text-center">Links</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                    No cards yet. Grade a scan and add it from the certificate screen.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((card) => (
                  <tr key={card.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-3 align-middle">
                      <div className="flex items-center gap-3 min-w-[10rem]">
                        {card.frontImage ? (
                          <img src={card.frontImage} alt="" className="w-10 h-14 object-cover rounded border border-white/10" />
                        ) : (
                          <div className="w-10 h-14 rounded border border-white/10 bg-white/5" />
                        )}
                        <div>
                          <p className="font-semibold text-white">{card.name || 'Unknown'}</p>
                          <p className="text-xs text-gray-500">
                            {card.set || '—'} #{card.cardNumber || '—'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle text-xs text-gray-400 max-w-[8rem]">{gradeLabel(card)}</td>
                    <td className="px-3 py-3 align-middle">
                      <MarketPriceCell card={card} error={refreshErrors[card.id]} />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <ExternalMarketLinks card={card} compact />
                    </td>
                    <td className="px-3 py-3 align-middle text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {card.grading && (
                          <button
                            type="button"
                            onClick={() => setCertCard(card)}
                            className="px-2 py-1 text-[9px] uppercase tracking-wider border border-poke-gold/30 text-poke-gold rounded"
                          >
                            Cert
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={refreshingId === card.id}
                          onClick={() => void refreshOne(card.id)}
                          className="px-2 py-1 text-[9px] uppercase tracking-wider border border-white/15 rounded disabled:opacity-40"
                        >
                          {refreshingId === card.id ? '…' : 'Refresh'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openProvenance(card)}
                          className="px-2 py-1 text-[9px] uppercase tracking-wider border border-white/15 rounded"
                        >
                          Prov.
                        </button>
                        <button
                          type="button"
                          onClick={() => void archive(card.id, !card.isArchived)}
                          className="px-2 py-1 text-[9px] uppercase tracking-wider border border-white/15 rounded"
                        >
                          {card.isArchived ? 'Restore' : 'Archive'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(card.id)}
                          className="px-2 py-1 text-[9px] uppercase tracking-wider border border-red-500/30 text-red-400 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500 border-t border-white/10 pt-4">
          <div>
            Page total — PC raw: <span className="text-emerald-400 tabular-nums">{fmtMoney(totals.rawSum)}</span>
            {' · '}
            TCG: <span className="text-blue-400 tabular-nums">{fmtMoney(totals.tcgSum)}</span>
            {' · '}
            {total} card{total === 1 ? '' : 's'}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset <= 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="px-3 py-1 border border-white/15 rounded disabled:opacity-30"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="px-3 py-1 border border-white/15 rounded disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </footer>
      </div>

      {editCard && (
        <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#080808] p-5">
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-poke-gold">Provenance</h3>
            <p className="text-xs text-gray-500 mt-1">{editCard.name}</p>
            <div className="mt-4 space-y-3">
              <label className="block text-[10px] uppercase tracking-widest text-gray-500">
                Acquisition price
                <input
                  type="number"
                  step="0.01"
                  value={provenanceDraft.acqPrice ?? ''}
                  onChange={(e) =>
                    setProvenanceDraft((p) => ({
                      ...p,
                      acqPrice: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                  className="mt-1 w-full rounded border border-white/10 bg-black px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500">
                Acquisition date
                <input
                  type="date"
                  value={provenanceDraft.acqDate ?? ''}
                  onChange={(e) => setProvenanceDraft((p) => ({ ...p, acqDate: e.target.value || undefined }))}
                  className="mt-1 w-full rounded border border-white/10 bg-black px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500">
                Source
                <input
                  value={provenanceDraft.source ?? ''}
                  onChange={(e) => setProvenanceDraft((p) => ({ ...p, source: e.target.value || undefined }))}
                  className="mt-1 w-full rounded border border-white/10 bg-black px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500">
                Notes
                <textarea
                  rows={3}
                  value={provenanceDraft.notes ?? ''}
                  onChange={(e) => setProvenanceDraft((p) => ({ ...p, notes: e.target.value || undefined }))}
                  className="mt-1 w-full resize-none rounded border border-white/10 bg-black px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setEditCard(null)} className="flex-1 py-2 text-xs uppercase border border-white/15 rounded">
                Cancel
              </button>
              <button type="button" onClick={() => void saveProvenance()} className="flex-1 py-2 text-xs uppercase bg-poke-gold text-black font-bold rounded">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {pcPickCardId && (
        <PriceChartingPickModal
          open={Boolean(pcPickCardId)}
          candidates={pcCandidates}
          searchUrl={pcSearchUrl}
          loading={pcPickLoading}
          onPick={(url) => void handlePcPick(url)}
          onClose={() => setPcPickCardId(null)}
        />
      )}

      {certCard?.grading && (
        <PortfolioCertificateModal
          card={certCard}
          onClose={() => setCertCard(null)}
          onCardUpdated={(updated) => {
            setCertCard(updated);
            setItems((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          }}
        />
      )}
    </div>
  );
};

export default PortfolioApp;
