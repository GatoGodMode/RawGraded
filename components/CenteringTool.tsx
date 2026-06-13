import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { BorderGuideState, CenteringRatioSet } from '../types';
import { formatRatioLabel, psaCenteringSubgrade, ratiosFromGuides } from '../services/centering/psaFromRatios';

const DEFAULT_GUIDES: BorderGuideState = {
  outerTop: 8,
  outerBottom: 92,
  outerLeft: 12,
  outerRight: 88,
  innerTop: 14,
  innerBottom: 86,
  innerLeft: 18,
  innerRight: 82,
};

type GuideKey = keyof BorderGuideState;
type DragAxis = 'x' | 'y';

interface CenteringToolProps {
  imageSrc: string;
  side: 'front' | 'back';
  initialGuides?: BorderGuideState;
  onConfirm: (ratios: CenteringRatioSet, guides: BorderGuideState) => void;
  onBack?: () => void;
}

const CenteringTool: React.FC<CenteringToolProps> = ({
  imageSrc,
  side,
  initialGuides,
  onConfirm,
  onBack,
}) => {
  const [guides, setGuides] = useState<BorderGuideState>(initialGuides || DEFAULT_GUIDES);
  const [ratios, setRatios] = useState<CenteringRatioSet | null>(null);
  const [autoMsg, setAutoMsg] = useState('');
  const [overrideInvalid, setOverrideInvalid] = useState(false);
  const [dragging, setDragging] = useState<{ key: GuideKey; axis: DragAxis } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLayout, setImgLayout] = useState({ left: 0, top: 0, width: 100, height: 100 });

  const ruleLabel = side === 'back' ? '75/25' : '55/45';

  const updateImageLayout = useCallback(() => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img || !img.naturalWidth) return;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const cAspect = cW / cH;
    let w: number;
    let h: number;
    let left: number;
    let top: number;
    if (imgAspect > cAspect) {
      w = cW;
      h = w / imgAspect;
      left = 0;
      top = (cH - h) / 2;
    } else {
      h = cH;
      w = h * imgAspect;
      top = 0;
      left = (cW - w) / 2;
    }
    setImgLayout({
      left: (left / cW) * 100,
      top: (top / cH) * 100,
      width: (w / cW) * 100,
      height: (h / cH) * 100,
    });
  }, []);

  useEffect(() => {
    setRatios(ratiosFromGuides(guides, side));
    setOverrideInvalid(false);
  }, [guides, side]);

  useEffect(() => {
    updateImageLayout();
    window.addEventListener('resize', updateImageLayout);
    return () => window.removeEventListener('resize', updateImageLayout);
  }, [updateImageLayout, imageSrc]);

  useEffect(() => {
    let cancelled = false;
    const runAutoDetect = async () => {
      if (!window.desktop?.detectBorders) return;
      setAutoMsg('Detecting card edges...');
      try {
        const detected = await window.desktop.detectBorders(imageSrc, side);
        if (cancelled) return;
        setGuides(detected);
        setAutoMsg('Edges detected — verify outer (cyan) and inner (yellow) lines, then adjust if needed.');
      } catch {
        if (!cancelled) setAutoMsg('Auto-detect failed — align guides manually or tap Auto-align.');
      }
    };
    void runAutoDetect();
    return () => {
      cancelled = true;
    };
  }, [imageSrc, side]);

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const imgLeft = rect.left + (imgLayout.left / 100) * rect.width;
      const imgTop = rect.top + (imgLayout.top / 100) * rect.height;
      const imgW = (imgLayout.width / 100) * rect.width;
      const imgH = (imgLayout.height / 100) * rect.height;
      const xPct = ((clientX - imgLeft) / imgW) * 100;
      const yPct = ((clientY - imgTop) / imgH) * 100;
      setGuides((g) => {
        const next = { ...g };
        const v = dragging.axis === 'x' ? Math.max(1, Math.min(99, xPct)) : Math.max(1, Math.min(99, yPct));
        next[dragging.key] = Math.round(v * 10) / 10;
        return next;
      });
    },
    [dragging, imgLayout]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => updateFromPointer(e.clientX, e.clientY);
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, updateFromPointer]);

  const startDrag = (key: GuideKey, axis: DragAxis) => (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging({ key, axis });
  };

  const handleAutoAlign = async () => {
    setAutoMsg('Detecting borders...');
    try {
      if (window.desktop?.detectBorders) {
        const detected = await window.desktop.detectBorders(imageSrc, side);
        setGuides(detected);
        setAutoMsg('Auto-align applied. Adjust inner lines to the print border if needed.');
      } else {
        setAutoMsg('Auto-align available in desktop app only.');
      }
    } catch {
      setAutoMsg('Detection failed — adjust guides manually.');
    }
  };

  const psa = ratios ? (ratios.psaHint ?? psaCenteringSubgrade(ratios, side)) : null;
  const invalid = ratios?.centeringValid === false;
  const canConfirm = ratios && (!invalid || overrideInvalid);

  const line = (key: GuideKey, axis: DragAxis, color: string, vertical: boolean) => {
    const pct = guides[key];
    const style: React.CSSProperties = vertical
      ? { left: `${pct}%`, top: 0, bottom: 0, width: 2, transform: 'translateX(-50%)' }
      : { top: `${pct}%`, left: 0, right: 0, height: 2, transform: 'translateY(-50%)' };
    return (
      <div
        key={key}
        className="absolute z-20 cursor-grab active:cursor-grabbing touch-none"
        style={style}
        onPointerDown={startDrag(key, axis)}
      >
        <div className={`w-full h-full ${color} shadow-lg`} />
        <div
          className={`absolute ${vertical ? 'top-1/2 -translate-y-1/2 -left-2' : 'left-1/2 -translate-x-1/2 -top-2'} w-4 h-4 rounded-full bg-white border-2 border-yellow-400`}
        />
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold uppercase tracking-widest text-poke-gold">
          Centering — {side}
        </h2>
        {onBack && (
          <button type="button" onClick={onBack} className="text-xs text-gray-400 hover:text-white uppercase tracking-widest">
            Back
          </button>
        )}
      </div>
      <p className="text-sm text-gray-400">
        Drag outer (cyan) lines to the card edge and inner (yellow) lines to the print border.
      </p>

      <div ref={containerRef} className="relative w-full aspect-[5/7] bg-black rounded-lg overflow-hidden select-none">
        <img
          ref={imgRef}
          src={imageSrc}
          alt={`${side} centering`}
          className="w-full h-full object-contain pointer-events-none"
          draggable={false}
          onLoad={updateImageLayout}
        />
        <div
          className="absolute"
          style={{
            left: `${imgLayout.left}%`,
            top: `${imgLayout.top}%`,
            width: `${imgLayout.width}%`,
            height: `${imgLayout.height}%`,
          }}
        >
          <div className="absolute inset-0 border border-yellow-500/20" />
          {line('outerLeft', 'x', 'bg-cyan-400', true)}
          {line('outerRight', 'x', 'bg-cyan-400', true)}
          {line('innerLeft', 'x', 'bg-yellow-400', true)}
          {line('innerRight', 'x', 'bg-yellow-400', true)}
          {line('outerTop', 'y', 'bg-cyan-400', false)}
          {line('outerBottom', 'y', 'bg-cyan-400', false)}
          {line('innerTop', 'y', 'bg-yellow-400', false)}
          {line('innerBottom', 'y', 'bg-yellow-400', false)}
        </div>
      </div>

      {ratios && (
        <div className="bg-[#111] border border-white/10 rounded-lg p-4 flex flex-wrap gap-4 items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-widest">Measured</p>
            <p className="font-mono text-sm text-white">{formatRatioLabel(ratios)}</p>
            {ratios.limitingLabel && (
              <p className="text-[10px] text-gray-500 mt-1">
                Limiting: {ratios.limitingAxis} {ratios.limitingLabel} → grade {ratios.limitingGrade ?? psa}
              </p>
            )}
          </div>
          {psa != null && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-widest">
                PSA hint ({side} · {ruleLabel})
              </p>
              <p className="text-2xl font-black text-poke-gold">{psa}</p>
            </div>
          )}
        </div>
      )}

      {invalid && !overrideInvalid && (
        <p className="text-xs text-amber-500">
          Guides may be misaligned — adjust inner lines or re-run Auto-align. Border geometry looks inconsistent for a reliable PSA hint.
        </p>
      )}

      {autoMsg && <p className="text-xs text-gray-400">{autoMsg}</p>}

      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" onClick={handleAutoAlign} className="px-4 py-2 bg-poke-blue text-white text-xs font-bold uppercase tracking-widest rounded">
          Auto-align
        </button>
        <button type="button" onClick={() => setGuides(DEFAULT_GUIDES)} className="px-4 py-2 bg-gray-800 text-gray-300 text-xs font-bold uppercase tracking-widest rounded">
          Reset
        </button>
        {invalid && (
          <button
            type="button"
            onClick={() => setOverrideInvalid(true)}
            className="px-4 py-2 border border-amber-500/40 text-amber-400 text-xs font-bold uppercase tracking-widest rounded"
          >
            Use anyway
          </button>
        )}
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => ratios && onConfirm(ratios, guides)}
          className="ml-auto px-6 py-2 bg-poke-gold text-black text-xs font-bold uppercase tracking-widest rounded disabled:opacity-40"
        >
          Use for grade
        </button>
      </div>
    </div>
  );
};

export default CenteringTool;
