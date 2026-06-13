import React, { useRef, useState, useEffect, useCallback } from 'react';
import { CropSettings, CaptureMetadata } from '../types';
import { getAutoCropSettings } from '../services/geminiService';

interface CropperProps {
  imageSrc: string;
  onConfirm: (croppedImage: string) => void;
  title: string;
  initialMetadata?: CaptureMetadata;
}

type ToolType = 'zoom' | 'rotate' | 'pan-x' | 'pan-y' | 'tilt-x' | 'tilt-y';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 8.0;

const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const clampPan = (v: number): number => Math.min(100, Math.max(0, v));

const DEFAULT_SETTINGS: CropSettings = {
  x: 50,
  y: 50,
  zoom: 1.0,
  rotation: 0,
  tiltX: 0,
  tiltY: 0,
};

const Cropper: React.FC<CropperProps> = ({ imageSrc, onConfirm, title, initialMetadata: _initialMetadata }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startSettingsX: number;
    startSettingsY: number;
  } | null>(null);

  const [settings, setSettings] = useState<CropSettings>({ ...DEFAULT_SETTINGS });
  const [activeTool, setActiveTool] = useState<ToolType>('zoom');
  const [loadingAI, setLoadingAI] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const CANVAS_WIDTH = 1200;
  const CANVAS_HEIGHT = 1680;

  const draw = useCallback((showGuides: boolean = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;

      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);

      const scaleX = canvas.width / img.width;
      const scaleY = canvas.height / img.height;
      const safeBaseScale = Math.min(scaleX, scaleY) * 0.9;

      ctx.rotate((settings.rotation * Math.PI) / 180);
      ctx.transform(1, settings.tiltY * 0.01, settings.tiltX * 0.01, 1, 0, 0);

      const finalScale = safeBaseScale * settings.zoom;
      ctx.scale(finalScale, finalScale);

      const offsetX = -((settings.x - 50) / 100) * img.width;
      const offsetY = -((settings.y - 50) / 100) * img.height;

      ctx.translate(offsetX, offsetY);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();

      if (showGuides) {
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);

        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(233, 69, 96, 0.4)';
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, 0);
        ctx.lineTo(canvas.width / 2, canvas.height);
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      }
    };
  }, [imageSrc, settings]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (loadingAI) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.002);
      setSettings((prev) => ({ ...prev, zoom: clampZoom(prev.zoom * factor) }));
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [loadingAI]);

  const handleAutoOptimize = async () => {
    setLoadingAI(true);
    const result = await getAutoCropSettings(imageSrc);
    if (result) {
      setSettings((prev) => ({
        ...prev,
        x: clampPan(result.x),
        y: clampPan(result.y),
        zoom: clampZoom(Math.max(result.zoom, ZOOM_MIN)),
        rotation: result.rotation,
        tiltX: result.tiltX || 0,
        tiltY: result.tiltY || 0,
      }));
    }
    setLoadingAI(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      draw(false);
      onConfirm(canvas.toDataURL('image/jpeg', 0.9));
    }
  };

  const applyDialChange = (prop: keyof CropSettings, raw: number) => {
    let value = raw;
    if (prop === 'zoom') value = clampZoom(raw);
    if (prop === 'x' || prop === 'y') value = clampPan(raw);
    setSettings((prev) => ({ ...prev, [prop]: value }));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (loadingAI || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startSettingsX: settings.x,
      startSettingsY: settings.y,
    };
    setIsDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const dxPercent = (-dx / rect.width) * 100;
    const dyPercent = (-dy / rect.height) * 100;

    setSettings((prev) => ({
      ...prev,
      x: clampPan(drag.startSettingsX + dxPercent),
      y: clampPan(drag.startSettingsY + dyPercent),
    }));
  };

  const endPointerDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      dragRef.current = null;
      setIsDragging(false);
    }
  };

  const getToolDisplayName = (tool: ToolType) => {
    switch (tool) {
      case 'zoom':
        return 'Zoom';
      case 'rotate':
        return 'Straighten';
      case 'pan-x':
        return 'Pos X';
      case 'pan-y':
        return 'Pos Y';
      case 'tilt-x':
        return 'Tilt X';
      case 'tilt-y':
        return 'Tilt Y';
    }
  };

  const getToolIcon = (tool: ToolType) => {
    switch (tool) {
      case 'zoom':
        return 'fa-search-plus';
      case 'rotate':
        return 'fa-sync-alt';
      case 'pan-x':
        return 'fa-arrows-alt-h';
      case 'pan-y':
        return 'fa-arrows-alt-v';
      case 'tilt-x':
        return 'fa-italic';
      case 'tilt-y':
        return 'fa-level-down-alt';
    }
  };

  const renderDial = () => {
    let prop: keyof CropSettings = 'zoom';
    let min = ZOOM_MIN;
    let max = ZOOM_MAX;
    let step = 0.01;
    let val = settings.zoom;

    if (activeTool === 'rotate') {
      prop = 'rotation';
      min = -45;
      max = 45;
      step = 0.1;
      val = settings.rotation;
    }
    if (activeTool === 'pan-x') {
      prop = 'x';
      min = 0;
      max = 100;
      step = 0.5;
      val = settings.x;
    }
    if (activeTool === 'pan-y') {
      prop = 'y';
      min = 0;
      max = 100;
      step = 0.5;
      val = settings.y;
    }
    if (activeTool === 'tilt-x') {
      prop = 'tiltX';
      min = -20;
      max = 20;
      step = 0.5;
      val = settings.tiltX;
    }
    if (activeTool === 'tilt-y') {
      prop = 'tiltY';
      min = -20;
      max = 20;
      step = 0.5;
      val = settings.tiltY;
    }

    return (
      <div className="w-full space-y-4 animate-slide-up">
        <div className="flex justify-between items-center px-4">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{getToolDisplayName(activeTool)}</span>
          <span className="text-poke-gold font-mono font-bold">{val.toFixed(2)}</span>
        </div>

        <div className="relative px-8 h-20 flex items-center">
          <div className="absolute inset-x-8 h-px bg-silver pointer-events-none"></div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-10 bg-poke-accent shadow-[0_0_10px_rgba(233,69,96,0.8)] z-10 pointer-events-none"></div>

          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={val}
            onChange={(e) => applyDialChange(prop, parseFloat(e.target.value))}
            className="w-full accent-transparent bg-transparent h-12 appearance-none cursor-pointer z-20 relative"
            style={{ WebkitAppearance: 'none' }}
          />

          <div className="absolute inset-x-8 flex justify-between px-2 pointer-events-none opacity-20">
            {Array.from({ length: 21 }).map((_, i) => (
              <div key={i} className={`w-0.5 ${i % 5 === 0 ? 'h-4 bg-white' : 'h-2 bg-gray-500'}`}></div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const canvasCursor = loadingAI
    ? 'cursor-wait'
    : isDragging
      ? 'cursor-grabbing'
      : 'cursor-grab';

  return (
    <div className="fixed inset-0 z-[60] bg-surface flex flex-col no-print">
      <div className="px-4 pb-2 rg-safe-pt flex justify-between items-center bg-white border-b border-silver shadow-sm">
        <div>
          <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
            <i className="fas fa-crop-alt text-poke-accent"></i>
            {title}
          </h2>
          <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-widest">Drag to pan · Scroll to zoom</p>
        </div>
        <button
          onClick={handleAutoOptimize}
          className="text-xs bg-poke-blue/10 text-poke-blue border border-poke-blue/30 px-3 py-1.5 rounded-full font-bold hover:bg-poke-blue/20 transition-all flex items-center gap-2 disabled:opacity-50 self-start"
          disabled={loadingAI}
        >
          <i className={`fas ${loadingAI ? 'fa-spinner fa-spin' : 'fa-magic'}`}></i>
          AI AUTO-FIT
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden bg-muted/30 flex items-center justify-center p-4">
        <div
          ref={previewRef}
          className="relative w-full h-full max-w-[500px] max-h-[70vh] flex items-center justify-center"
        >
          <canvas
            ref={canvasRef}
            className={`w-full h-full object-contain shadow-xl rounded-lg border-2 border-silver touch-none select-none ${canvasCursor}`}
            style={{ filter: loadingAI ? 'blur(10px) grayscale(1)' : 'none', transition: 'filter 0.5s ease' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointerDrag}
            onPointerCancel={endPointerDrag}
          />
          {loadingAI && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="w-16 h-16 border-4 border-t-poke-accent border-silver rounded-full animate-spin"></div>
              <p className="mt-4 text-gray-700 font-bold tracking-widest text-xs animate-pulse">ANALYZING GEOMETRY</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-t border-silver rg-safe-pb pt-4 px-2 space-y-6 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <div className="max-w-md mx-auto h-24 flex items-center">{renderDial()}</div>

        <div className="flex overflow-x-auto no-scrollbar gap-2 px-4 pb-2">
          {(['zoom', 'rotate', 'pan-x', 'pan-y', 'tilt-x', 'tilt-y'] as ToolType[]).map((tool) => (
            <button
              key={tool}
              type="button"
              onClick={() => setActiveTool(tool)}
              className={`flex-shrink-0 flex flex-col items-center justify-center p-3 rounded-xl min-w-[80px] transition-all border-2 ${activeTool === tool ? 'bg-poke-accent border-poke-accent text-white shadow-lg' : 'bg-muted/30 border-silver text-gray-600 hover:bg-muted/50 hover:text-gray-900'}`}
            >
              <i className={`fas ${getToolIcon(tool)} text-lg mb-1`}></i>
              <span className="text-[10px] font-black uppercase tracking-tighter">{getToolDisplayName(tool)}</span>
            </button>
          ))}
        </div>

        <div className="px-4 flex gap-4">
          <button
            type="button"
            onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
            className="flex-1 py-4 text-xs font-bold text-gray-500 hover:text-gray-900 transition-colors"
          >
            RESET
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-[2] bg-poke-accent hover:opacity-90 text-white py-4 px-8 rounded-xl font-black transition-all shadow-lg flex items-center justify-center gap-2 transform active:scale-95"
          >
            CONFIRM CROP <i className="fas fa-arrow-right"></i>
          </button>
        </div>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        @keyframes slide-up {
            from { transform: translateY(10px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up { animation: slide-up 0.3s ease-out; }

        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            height: 40px;
            width: 40px;
            border-radius: 50%;
            background: transparent;
            cursor: pointer;
            border: 2px solid rgba(255,255,255,0.1);
        }
      `}</style>
    </div>
  );
};

export default Cropper;
