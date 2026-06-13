import React, { useState, useRef, useEffect } from 'react';
import type { UserProfile } from '../types';
import { analyzeListingImages } from '../services/geminiService';

// --- COVERT MODE COMPONENT ---
interface CovertBubbleGameProps {
  onCapture: (b64: string) => void;
  onAssess: (priceOverride?: string) => void;
  onExit: () => void;
  result: SniperResult | null;
  loading: boolean;
  error: string | null;
  onSetPrice: (p: string) => void;
  onReplaceImage: (i: number, b64: string) => void;
  capturedImages: string[];
  price: string;
}

const CropContainer: React.FC<{ src: string, onRef: (ref: HTMLDivElement | null) => void, onTransformChange: (x: number, y: number, scale: number) => void }> = ({ src, onRef, onTransformChange }) => {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const startTouch = useRef<{x: number, y: number} | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    startTouch.current = { x: e.clientX, y: e.clientY };
    startPos.current = { ...pos };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startTouch.current) return;
    const dx = e.clientX - startTouch.current.x;
    const dy = e.clientY - startTouch.current.y;
    const nx = startPos.current.x + dx;
    const ny = startPos.current.y + dy;
    setPos({ x: nx, y: ny });
    onTransformChange(nx, ny, scale);
  };

  const handlePointerUp = () => {
    startTouch.current = null;
  };

  return (
    <div className="w-full h-full relative" ref={onRef}>
      <div className="absolute inset-0 bg-black overflow-hidden flex items-center justify-center">
        <img 
          src={src} 
          alt="" 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="max-w-none origin-center cursor-move touch-none"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, width: '100%', height: '100%', objectFit: 'contain' }}
          draggable={false}
        />
      </div>
      <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3 bg-black/50 p-2 rounded-xl backdrop-blur-sm" data-html2canvas-ignore="true">
        <i className="fas fa-search-minus text-white/50 text-xs pointer-events-none"></i>
        <input 
          type="range" 
          min="1" max="5" step="0.1" 
          value={scale} 
          onChange={e => {
            const s = parseFloat(e.target.value);
            setScale(s);
            onTransformChange(pos.x, pos.y, s);
          }} 
          className="flex-1 accent-purple-500"
        />
        <i className="fas fa-search-plus text-white/50 text-xs pointer-events-none"></i>
      </div>
      <div className="absolute inset-6 border-[3px] border-white/30 border-dashed pointer-events-none rounded-xl" data-html2canvas-ignore="true"></div>
    </div>
  );
};

const CovertBubbleGame: React.FC<CovertBubbleGameProps> = ({ onCapture, onAssess, onExit, result, loading, error, onSetPrice, onReplaceImage, capturedImages, price }) => {
  const GRID_ROWS = 8;
  const GRID_COLS = 6;
  const BUBBLE_COLORS = [
    'radial-gradient(circle at 30% 30%, #fca5a5, #ef4444 70%)',
    'radial-gradient(circle at 30% 30%, #93c5fd, #3b82f6 70%)',
    'radial-gradient(circle at 30% 30%, #86efac, #22c55e 70%)',
    'radial-gradient(circle at 30% 30%, #fde047, #eab308 70%)',
    'radial-gradient(circle at 30% 30%, #d8b4fe, #a855f7 70%)',
  ];

  const videoRef = useRef<HTMLVideoElement>(null);
  const [score, setScore] = useState(0);
  const [captures, setCaptures] = useState(0);
  const scoreCardRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const touchStartY = useRef<number | null>(null);

  const [showPip, setShowPip] = useState(false);
  const [wagerInput, setWagerInput] = useState(price);
  const cropRef = useRef<HTMLDivElement | null>(null);
  const cropTransform = useRef({ x: 0, y: 0, scale: 1 });

  const [grid, setGrid] = useState<number[][]>(() =>
    Array(GRID_ROWS).fill(0).map(() => Array(GRID_COLS).fill(0).map(() => Math.floor(Math.random() * BUBBLE_COLORS.length)))
  );

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      } 
    })
      .then(s => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(err => console.error("Camera error:", err));
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleCapture = () => {
    if (captures >= 2 || result || loading) return;
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const video = videoRef.current;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        
        const containerAspect = 3 / 4;
        const videoAspect = vw / vh;
        
        let drawW = vw;
        let drawH = vh;
        let offX = 0;
        let offY = 0;

        if (videoAspect > containerAspect) {
          drawW = vh * containerAspect;
          offX = (vw - drawW) / 2;
        } else {
          drawH = vw / containerAspect;
          offY = (vh - drawH) / 2;
        }

        const z = zoomRef.current;
        const finalW = drawW / z;
        const finalH = drawH / z;
        const finalX = offX + (drawW - finalW) / 2;
        const finalY = offY + (drawH - finalH) / 2;

        canvas.width = finalW;
        canvas.height = finalH;
        ctx.drawImage(video, finalX, finalY, finalW, finalH, 0, 0, finalW, finalH);
        
        onCapture(canvas.toDataURL('image/jpeg', 0.95));
        const next = captures + 1;
        setCaptures(next);
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    touchStartY.current = e.clientY;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (touchStartY.current === null) return;
    const dy = touchStartY.current - e.clientY;
    let newZoom = zoomRef.current + (dy * 0.015);
    newZoom = Math.max(1, Math.min(newZoom, 5));
    setZoom(newZoom);
  };

  const handlePointerUp = (e: React.PointerEvent, r: number, c: number) => {
    if (touchStartY.current === null) return;
    const dy = Math.abs(touchStartY.current - e.clientY);
    touchStartY.current = null;
    zoomRef.current = zoom;
    
    // Tap (no drag)
    if (dy < 10) {
      handleBubbleClick(r, c);
    }
  };

  const handleBubbleClick = (r: number, c: number) => {
    // Trigger auto-focus if supported
    if (videoRef.current && videoRef.current.srcObject && !loading && !result) {
      const stream = videoRef.current.srcObject as MediaStream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          track.applyConstraints({ advanced: [{ focusMode: "single-shot" } as any] })
            .then(() => {
               setTimeout(() => {
                 track.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] }).catch(() => {});
               }, 2000);
            })
            .catch(() => {});
        } catch (_) {}
      }
    }

    if (result || loading) {
       // Allow popping visually, but do not process capturing mechanics if loading?
       // Let users play while loading!
    } else {
       // if result is present, do nothing
       if (result) return;
    }
    
    const color = grid[r][c];
    if (color === -1) return;

    // Flood fill to find connected matching bubbles
    const toPop: [number, number][] = [];
    const visited = new Set<string>();
    const stack: [number, number][] = [[r, c]];

    while (stack.length > 0) {
      const [cr, cc] = stack.pop()!;
      const key = `${cr},${cc}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (grid[cr][cc] === color) {
        toPop.push([cr, cc]);
        if (cr > 0) stack.push([cr - 1, cc]);
        if (cr < GRID_ROWS - 1) stack.push([cr + 1, cc]);
        if (cc > 0) stack.push([cr, cc - 1]);
        if (cc < GRID_COLS - 1) stack.push([cr, cc + 1]);
      }
    }

    if (toPop.length >= 2) {
      setScore(s => s + (toPop.length * 10));
      setGrid(prev => {
        const next = prev.map(row => [...row]);
        toPop.forEach(([pr, pc]) => { next[pr][pc] = -1; });

        // Collapse columns and fill new bubbles at the top
        for (let col = 0; col < GRID_COLS; col++) {
          let writeRow = GRID_ROWS - 1;
          for (let row = GRID_ROWS - 1; row >= 0; row--) {
            if (next[row][col] !== -1) {
              next[writeRow][col] = next[row][col];
              if (writeRow !== row) next[row][col] = -1;
              writeRow--;
            }
          }
          for (let row = writeRow; row >= 0; row--) {
            next[row][col] = Math.floor(Math.random() * BUBBLE_COLORS.length);
          }
        }
        return next;
      });
    }
  };

  const handleConfirmPip = async () => {
    onSetPrice(wagerInput);
    if (cropRef.current && capturedImages[0]) {
      const rect = cropRef.current.getBoundingClientRect();
      const imgNode = cropRef.current.querySelector('img');
      if (imgNode) {
        const nw = imgNode.naturalWidth;
        const nh = imgNode.naturalHeight;
        
        const containerAspect = rect.width / rect.height;
        const imgAspect = nw / nh;
        
        let renderW, renderH;
        if (imgAspect > containerAspect) {
          renderW = rect.width;
          renderH = rect.width / imgAspect;
        } else {
          renderH = rect.height;
          renderW = rect.height * imgAspect;
        }
        
        const { x: dx, y: dy, scale: displayScale } = cropTransform.current;
        const outScale = 3; 
        const canvas = document.createElement('canvas');
        canvas.width = rect.width * outScale;
        canvas.height = rect.height * outScale;
        const ctx = canvas.getContext('2d');
        if (ctx) {
           ctx.fillStyle = '#000';
           ctx.fillRect(0, 0, canvas.width, canvas.height);
           
           const targetW = renderW * displayScale * outScale;
           const targetH = renderH * displayScale * outScale;
           const targetX = ((rect.width - renderW)/2 + dx) * outScale - ((targetW - renderW * outScale)/2);
           const targetY = ((rect.height - renderH)/2 + dy) * outScale - ((targetH - renderH * outScale)/2);
           
           ctx.drawImage(imgNode, targetX, targetY, targetW, targetH);
           onReplaceImage(0, canvas.toDataURL('image/jpeg', 0.95));
        }
      }
    }
    setShowPip(false);
    onAssess(wagerInput);
  };

  const handleSaveAsImage = async () => {
    if (!scoreCardRef.current) return;
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(scoreCardRef.current, { scale: 2, useCORS: true, backgroundColor: '#111' });
      const link = document.createElement('a');
      link.download = `BubbleScore-${new Date().getTime()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (_) {}
  };

  const renderDisguisedResult = () => {
    if (!result) return null;
    let rank = 'Novice';
    if (result.verdict === 'snipe_spotted') rank = 'Grandmaster (S-Tier)';
    else if (result.verdict === 'potential_gem') rank = 'Expert (A-Tier)';
    else if (result.verdict === 'fair') rank = 'Pro (B-Tier)';
    else if (result.verdict === 'overpriced_or_misgraded') rank = 'Rookie (F-Tier)';

    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
        <div ref={scoreCardRef} className="w-full max-w-sm bg-[#0a0a0a] border border-[#ff4d4d]/30 rounded-[2rem] p-8 text-center shadow-[0_0_50px_rgba(255,0,0,0.15)] relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-[#ff4d4d]/10 to-transparent pointer-events-none"></div>
          <h2 className="text-3xl font-black text-white mb-1 tracking-[0.1em] drop-shadow-md">GAME OVER</h2>
          <p className="text-[#ff4d4d] font-black uppercase tracking-widest text-xs mb-8">Final Score: {score + 10000}</p>

          <div className="bg-[#111] rounded-2xl p-5 mb-8 text-left border border-white/5 relative">
            <p className="text-[10px] text-white/40 uppercase font-black tracking-widest mb-1">Rank Achieved</p>
            <p className="text-lg text-[#D4AF37] font-black mb-5 drop-shadow-[0_0_8px_rgba(191,149,63,0.3)]">{rank}</p>

            <p className="text-[10px] text-white/40 uppercase font-black tracking-widest mb-1">Play Style</p>
            <p className="text-sm text-white/90 font-bold mb-5">{result.condition_estimate}</p>

            <p className="text-[10px] text-[#ff4d4d] uppercase font-black tracking-widest mb-2">Match Stats</p>
            <p className="text-xs text-gray-400 font-serif leading-relaxed line-clamp-4">{result.reasoning}</p>
          </div>

          <div className="flex flex-col gap-4">
            <button onClick={handleSaveAsImage} className="w-full py-4 rounded-xl bg-gradient-to-r from-[#990000] to-[#550000] text-white font-black uppercase text-xs tracking-[0.2em] hover:from-[#aa0000] hover:to-[#660000] transition-all shadow-[0_4px_20px_rgba(153,0,0,0.4)] border border-[#ff4d4d]/20">
              Save High Score
            </button>
            <button onClick={onExit} className="w-full py-4 rounded-xl bg-transparent border border-white/10 text-white/70 font-black uppercase text-xs tracking-widest hover:bg-white/5 hover:text-white transition-colors">
              Exit Game
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] overflow-hidden font-sans">
      <style>{`
        .black-bubble {
          animation: pulseBlack 2s infinite ease-in-out;
          background: radial-gradient(circle at 30% 30%, #444, #000 70%);
          box-shadow: inset 0 0 10px rgba(255,255,255,0.2), 0 0 20px rgba(0,0,0,0.8);
          border: 2px solid rgba(255,255,255,0.1);
          z-index: 10;
          -webkit-tap-highlight-color: transparent;
        }
      `}</style>
      
      {/* HUD */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start z-20 pointer-events-none">
        <div>
          <p className="text-white/50 text-[10px] font-black uppercase tracking-widest">Score</p>
          <p className="text-white text-2xl font-black">{score}</p>
        </div>
        <button onClick={onExit} className="pointer-events-auto w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center backdrop-blur-md">
          <i className="fas fa-times"></i>
        </button>
      </div>

      {loading && (
        <div className="absolute top-20 left-0 right-0 text-center z-20 pointer-events-none">
          <p className="text-white font-black uppercase tracking-widest animate-pulse">Calculating Score...</p>
        </div>
      )}
      
      {error && !loading && !result && (
        <div className="absolute top-20 left-0 right-0 text-center z-20 pointer-events-none px-4">
          <p className="text-red-400 font-bold bg-black/50 p-2 rounded-lg backdrop-blur-sm">{error}</p>
        </div>
      )}

      {/* Camera View & Game Board Disguise */}
      <div className="absolute inset-x-0 top-24 bottom-40 flex items-center justify-center p-4 z-0 pointer-events-none">
        <div className="w-full max-w-sm aspect-[3/4] relative bg-black/80 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/5">
          {/* Camera feed as the game background */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover transition-all duration-300"
            style={{ transform: `scale(${zoom})`, opacity: loading ? 0 : 0.6 }}
          />
          <div className="absolute inset-0 bg-[#0a0a0a]/40 backdrop-blur-[2px]"></div>
          
          {/* Scope Reticle overlaying grid center */}
          {!result && !loading && !showPip && (
             <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-10">
               <div className="w-20 h-20 rounded-full border border-red-500/50 flex items-center justify-center animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.3)] bg-red-500/10">
                 <div className="w-1.5 h-1.5 bg-red-400 rounded-full shadow-[0_0_5px_rgba(255,255,255,1)]"></div>
                 <div className="absolute w-[120%] h-[1px] bg-red-500/50"></div>
                 <div className="absolute h-[120%] w-[1px] bg-red-500/50"></div>
               </div>
             </div>
          )}

          {/* Bubble Grid Surface */}
          {!result && !showPip && (
            <div className="absolute inset-0 grid grid-rows-8 grid-cols-6 gap-[2px] p-2 pointer-events-auto">
              {grid.map((row, r) => 
                row.map((colorIdx, c) => (
                  <div
                    key={`${r}-${c}`}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={(e) => handlePointerUp(e, r, c)}
                    onPointerCancel={(e) => handlePointerUp(e, r, c)}
                    className="w-full h-full rounded-full cursor-pointer transition-transform active:scale-90 touch-none"
                    style={{
                      background: BUBBLE_COLORS[colorIdx],
                      boxShadow: 'inset 0 0 10px rgba(255,255,255,0.4), 0 0 5px rgba(0,0,0,0.5)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      opacity: 0.85
                    }}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* PIP Crop Modal */}
      {showPip && !result && !loading && (
        <div className="absolute inset-x-4 top-20 bottom-24 z-50 bg-[#0a0a0a]/95 rounded-[2rem] border border-[#ff4d4d]/20 p-5 shadow-[0_0_50px_rgba(0,0,0,0.9)] flex flex-col backdrop-blur-xl">
           <h3 className="font-black uppercase text-sm mb-4 tracking-[0.2em] text-center text-[#ff4d4d] drop-shadow-md">Bonus Wager</h3>
           
           <div className="flex-1 relative bg-[#050505] rounded-2xl overflow-hidden mb-4 border border-white/5 shadow-inner">
             {capturedImages[0] && (
               <CropContainer 
                 src={capturedImages[0]} 
                 onRef={(r) => cropRef.current = r} 
                 onTransformChange={(x, y, s) => { cropTransform.current = { x, y, scale: s }; }} 
               />
             )}
           </div>
           
           <p className="text-[9px] text-white/40 mb-4 text-center uppercase tracking-widest font-black">Center the target to apply wager modifier.</p>

           <div className="mb-6">
              <label className="text-[10px] font-black text-white/60 uppercase tracking-widest mb-2 block">Modifier Value <span className="text-[#ff4d4d]">*</span></label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <span className="text-gray-500 font-bold">$</span>
                </div>
                <input 
                  type="number" 
                  value={wagerInput}
                  onChange={e => setWagerInput(e.target.value)}
                  placeholder="Auto-detect"
                  className="w-full bg-[#111] text-white rounded-xl pl-8 pr-4 py-4 border border-white/10 focus:outline-none focus:border-[#ff4d4d] focus:ring-1 focus:ring-[#ff4d4d] font-mono text-sm placeholder:text-white/20 transition-all shadow-inner"
                />
              </div>
           </div>

           <button 
             onClick={handleConfirmPip}
             className="w-full py-4 rounded-xl bg-gradient-to-r from-[#990000] to-[#550000] font-black text-white uppercase tracking-[0.15em] text-sm hover:from-[#aa0000] hover:to-[#660000] transition-all shadow-[0_4px_20px_rgba(153,0,0,0.4)] border border-[#ff4d4d]/20 mb-3"
           >
             Lock In Wager
           </button>
           <button 
             onClick={() => setShowPip(false)}
             className="w-full py-3 rounded-xl bg-transparent font-black text-white/40 uppercase tracking-widest text-xs hover:text-white/80 transition-colors"
           >
             Cancel
           </button>
        </div>
      )}

      {/* Shutter Bubble */}
      {!result && !loading && !showPip && captures < 2 && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
          <div 
            onClick={handleCapture}
            className="w-20 h-20 rounded-full black-bubble cursor-pointer flex items-center justify-center transition-transform active:scale-90"
          >
            <div className="w-8 h-8 rounded-full bg-white/10 pointer-events-none" />
          </div>
          <p className="text-white/30 text-[10px] font-bold uppercase tracking-widest mt-4 pointer-events-none">Tap to play</p>
        </div>
      )}

      {/* Manual Assess Button */}
      {!result && !loading && !showPip && captures > 0 && (
        <div className="absolute bottom-40 left-1/2 -translate-x-1/2 z-20">
           <button 
             onClick={() => setShowPip(true)}
             className="px-8 py-4 rounded-full bg-gradient-to-r from-[#990000] to-[#550000] text-white font-black text-xs uppercase tracking-[0.2em] shadow-[0_0_25px_rgba(153,0,0,0.5)] border border-[#ff4d4d]/30 hover:scale-105 transition-all whitespace-nowrap"
           >
             Submit Score
           </button>
        </div>
      )}

      {renderDisguisedResult()}
    </div>
  );
};
// --- END COVERT MODE COMPONENT ---

const MAX_IMAGES = 2;
const MIN_IMAGES = 1;
const MAX_REASSESS = 2;

interface SniperResult {
  verdict: string;
  condition_estimate: string;
  reasoning: string;
  confidence?: number;
  is_holographic?: boolean | null;
}

interface SniperViewProps {
  user: UserProfile;
  onOpenShop: () => void;
  onCreditsUsed: () => void;
}

const cleanBase64 = (dataUrl: string): string => {
  if (!dataUrl) return '';
  if (dataUrl.includes(',')) return dataUrl.split(',')[1];
  return dataUrl;
};

const EMPTY_SLOTS: string[] = ['', ''];

const SniperView: React.FC<SniperViewProps> = ({ user, onOpenShop, onCreditsUsed }) => {
  const [images, setImages] = useState<string[]>(() => [...EMPTY_SLOTS]);
  const [listedPrice, setListedPrice] = useState<string>('');
  const [freeShipping, setFreeShipping] = useState(true);
  const [shippingCost, setShippingCost] = useState<string>('');
  const [title, setTitle] = useState('');
  const [assessmentCount, setAssessmentCount] = useState(0);
  const [result, setResult] = useState<SniperResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [extractingPrice, setExtractingPrice] = useState(false);
  const [isCovertMode, setIsCovertMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultCardRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<string[]>([]);
  const listedPriceRef = useRef<string>('');
  const shippingCostRef = useRef<string>('');
  const titleRef = useRef<string>('');

  const imageCount = images.filter((s) => s.length > 0).length;

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(() => {
    listedPriceRef.current = listedPrice;
    shippingCostRef.current = shippingCost;
    titleRef.current = title;
  }, [listedPrice, shippingCost, title]);

  useEffect(() => {
    if (imageCount < 1) return;
    const t = setTimeout(() => {
      const withData = imagesRef.current.filter((s) => s && s.length > 0);
      if (withData.length === 0) return;
      setExtractingPrice(true);
      setError(null);
      analyzeListingImages(withData)
        .then((out) => {
          const currentPrice = listedPriceRef.current.trim();
          const currentShipping = shippingCostRef.current.trim();
          const currentTitle = titleRef.current.trim();
          if (out.suggestedPrice != null && (out.suggestedPrice > 0 || currentPrice === '')) {
            setListedPrice(String(out.suggestedPrice));
          }
          if (out.freeShipping !== undefined) setFreeShipping(out.freeShipping);
          if (out.suggestedShippingCost != null && (out.suggestedShippingCost > 0 || currentShipping === '')) {
            setShippingCost(String(out.suggestedShippingCost));
            if (out.suggestedShippingCost > 0) setFreeShipping(false);
          }
          if (out.suggestedTitle && currentTitle === '') setTitle(out.suggestedTitle);
        })
        .catch(() => {})
        .finally(() => setExtractingPrice(false));
    }, 600);
    return () => clearTimeout(t);
  }, [imageCount]);
  const isAdmin = user?.role === 'admin';
  const paidCredits = user?.paid_credits ?? 0;
  const canRun = isAdmin || paidCredits >= 1;
  const isReassess = assessmentCount >= 1;
  const canReassess = assessmentCount >= 1 && assessmentCount <= MAX_REASSESS;
  const hasEnoughInput = imageCount >= MIN_IMAGES && listedPrice.trim() !== '' && !isNaN(parseFloat(listedPrice));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = (ev.target?.result as string) ?? '';
      setImages((prev) => {
        const next = [...prev];
        if (next.length < MAX_IMAGES) next.length = MAX_IMAGES;
        next[index] = dataUrl;
        return next;
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCovertCapture = (b64: string) => {
    setImages(prev => {
      const next = [...prev];
      const emptyIdx = next.findIndex(s => !s);
      if (emptyIdx !== -1) {
        next[emptyIdx] = b64;
      }
      return next;
    });
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const next = [...prev];
      if (next.length < MAX_IMAGES) next.length = MAX_IMAGES;
      next[index] = '';
      return next;
    });
  };

  const handleRescanPriceAndTitle = async () => {
    const withData = images.filter((s) => s.length > 0);
    if (withData.length < 1) return;
    setExtractingPrice(true);
    setError(null);
    try {
      const out = await analyzeListingImages(withData);
      const currentPrice = listedPriceRef.current.trim();
      const currentShipping = shippingCostRef.current.trim();
      const currentTitle = titleRef.current.trim();
      if (out.suggestedPrice != null && (out.suggestedPrice > 0 || currentPrice === '')) {
        setListedPrice(String(out.suggestedPrice));
      }
      if (out.freeShipping !== undefined) setFreeShipping(out.freeShipping);
      if (out.suggestedShippingCost != null && (out.suggestedShippingCost > 0 || currentShipping === '')) {
        setShippingCost(String(out.suggestedShippingCost));
        if (out.suggestedShippingCost > 0) setFreeShipping(false);
      }
      if (out.suggestedTitle && currentTitle === '') setTitle(out.suggestedTitle);
    } catch (_) {
      setError('Could not read price or card from photos.');
    } finally {
      setExtractingPrice(false);
    }
  };

  const runAssess = async (reassess: boolean, overrideCovertPrice?: string) => {
    const finalPrice = overrideCovertPrice !== undefined ? overrideCovertPrice : listedPrice;
    const finalHasEnough = imageCount >= MIN_IMAGES && finalPrice.trim() !== '' && !isNaN(parseFloat(finalPrice));

    if (!finalHasEnough) {
      if (overrideCovertPrice !== undefined) setError('Invalid wager value.');
      return;
    }
    if (!reassess && !canRun) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        images: images.filter((s) => s.length > 0).map((img) => cleanBase64(img)),
        listedPrice: parseFloat(finalPrice),
        shippingCost: freeShipping ? 0 : parseFloat(shippingCost || '0') || 0,
        freeShipping,
        title: title.trim() || undefined,
        reassess,
      };
      const res = await fetch('api/sniper.php?action=assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 402) {
          setError('Use 1 pro credit to run Sniper.');
          onOpenShop?.();
        } else {
          setError(data?.error || 'Assessment failed.');
        }
        return;
      }
      setResult({
        verdict: data.verdict ?? 'unknown',
        condition_estimate: data.condition_estimate ?? '',
        reasoning: data.reasoning ?? '',
        confidence: data.confidence,
        is_holographic: data.is_holographic,
      });
      setAssessmentCount((c) => c + 1);
      if (!reassess && data.paid_credits !== undefined) onCreditsUsed?.();
    } catch (_) {
      setError('Request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAsImage = async () => {
    if (!resultCardRef.current) return;
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(resultCardRef.current, { scale: 2, useCORS: true });
      const link = document.createElement('a');
      link.download = `RawGraded-Sniper-v1.2-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (_) {
      setError('Export failed.');
    }
  };

  const verdictLabel = (v: string) => {
    if (v === 'snipe_spotted') return 'Snipe Spotted';
    if (v === 'potential_gem') return 'Potential gem';
    if (v === 'fair') return 'Fair';
    if (v === 'overpriced_or_misgraded') return 'Overpriced / misgraded';
    return v;
  };

  if (isCovertMode) {
    return (
      <CovertBubbleGame
        onCapture={handleCovertCapture}
        onAssess={(p) => runAssess(false, p)}
        onExit={() => setIsCovertMode(false)}
        result={result}
        loading={loading}
        error={error}
        onSetPrice={(p) => setListedPrice(p)}
        onReplaceImage={(i, b64) => {
           setImages(prev => {
             const next = [...prev];
             next[i] = b64;
             return next;
           });
        }}
        capturedImages={images}
        price={listedPrice}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-black uppercase tracking-[0.15em] text-white drop-shadow-md mb-2 flex items-center gap-3">
        <i className="fas fa-crosshairs text-[#BF953F]"></i> Sniper
      </h1>
      
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <p className="text-sm text-gray-400 flex-1">Upload 1 or 2 listing photos, set assumptions, then authorize a tactical AI assessment.</p>
        <button
           type="button"
           onClick={() => {
             setImages(["", ""]);
             setResult(null);
             setIsCovertMode(true);
           }}
           className="px-4 py-2 bg-[#050505] text-[#ff4d4d] border border-[#ff4d4d]/30 rounded-lg font-black uppercase tracking-widest text-[10px] hover:bg-[#111] hover:border-[#ff4d4d]/60 hover:shadow-[0_0_15px_rgba(255,77,77,0.2)] transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
           <i className="fas fa-user-secret"></i> Covert Mode
        </button>
      </div>

      {/* Image slots */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {[0, 1].map((i) => (
          <div key={i} className={`aspect-[4/5] border border-dashed rounded-xl overflow-hidden flex items-center justify-center relative transition-all duration-300 ${images[i] ? 'border-[#BF953F]/50 bg-[#111] shadow-[0_0_20px_rgba(191,149,63,0.05)]' : 'border-white/20 bg-[#0a0a0a]'}`}>
            {images[i] ? (
              <>
                <img src={images[i]} alt="" className="w-full h-full object-contain p-2" />
                <button type="button" onClick={() => removeImage(i)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white flex items-center justify-center hover:bg-[#990000] hover:border-[#990000] transition-colors shadow-lg">
                  <i className="fas fa-times"></i>
                </button>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-gray-500">
                <label className="cursor-pointer flex w-3/4 items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white/5 border border-white/10 shadow-sm hover:border-[#BF953F]/50 hover:text-[#BF953F] hover:bg-white/10 transition-all font-black text-[10px] uppercase tracking-[0.2em]">
                  <i className="fas fa-camera text-sm"></i> Live
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e, i)} />
                </label>
                <label className="cursor-pointer flex w-3/4 items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white/5 border border-white/10 shadow-sm hover:border-[#BF953F]/50 hover:text-[#BF953F] hover:bg-white/10 transition-all font-black text-[10px] uppercase tracking-[0.2em]">
                  <i className="fas fa-upload text-sm"></i> Photo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e, i)} />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center w-full mb-3 px-1">
        {extractingPrice ? (
          <p className="text-[10px] text-[#BF953F] font-black uppercase tracking-widest animate-pulse"><i className="fas fa-circle-notch fa-spin mr-1"></i> Intercepting Data...</p>
        ) : (
          <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Metadata Assumptions</p>
        )}
        <button type="button" onClick={handleRescanPriceAndTitle} disabled={imageCount < 1 || extractingPrice} className="text-[10px] font-black uppercase tracking-widest text-[#BF953F] hover:text-[#D4AF37] transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer">
          <i className="fas fa-radar"></i> Force Re-Scan
        </button>
      </div>

      <div className="space-y-4 mb-8 bg-[#0a0a0a] p-6 rounded-xl border border-white/10 shadow-lg">
        <div>
          <label className="block text-[10px] font-black tracking-widest uppercase text-gray-400 mb-2">Listed Price (USD) <span className="text-[#BF953F]">*</span></label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <span className="text-gray-500 font-bold">$</span>
            </div>
            <input type="number" min="0" step="0.01" value={listedPrice} onChange={(e) => setListedPrice(e.target.value)} className="w-full bg-[#111] text-white border border-white/10 focus:border-[#BF953F] focus:ring-1 focus:ring-[#BF953F] outline-none rounded-lg pl-8 pr-4 py-3 transition-colors text-sm font-mono" placeholder="0.00" />
          </div>
        </div>
        
        <label className="flex items-center gap-3 cursor-pointer group">
          <div className="relative flex items-center justify-center">
            <input type="checkbox" checked={freeShipping} onChange={(e) => setFreeShipping(e.target.checked)} className="peer sr-only" />
            <div className="w-5 h-5 border border-white/30 rounded bg-[#111] peer-checked:bg-[#BF953F] peer-checked:border-[#BF953F] transition-all flex items-center justify-center">
               <i className={`fas fa-check text-black text-[10px] transition-opacity ${freeShipping ? 'opacity-100' : 'opacity-0'}`}></i>
            </div>
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-gray-300 group-hover:text-white transition-colors">Free Shipping</span>
        </label>
        
        {!freeShipping && (
           <div className="animate-fade-in pl-8">
             <label className="block text-[10px] font-black tracking-widest uppercase text-gray-400 mb-2">Shipping Cost (USD)</label>
             <div className="relative">
               <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                 <span className="text-gray-500 font-bold">$</span>
               </div>
               <input type="number" min="0" step="0.01" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} className="w-full bg-[#111] text-white border border-white/10 focus:border-[#BF953F] focus:ring-1 focus:ring-[#BF953F] outline-none rounded-lg pl-8 pr-4 py-3 transition-colors text-sm font-mono" placeholder="0.00" />
             </div>
           </div>
        )}
        
        <div className="pt-2">
          <label className="block text-[10px] font-black tracking-widest uppercase text-gray-400 mb-2">Listing Title / Custom Info</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Charizard NM" className="w-full bg-[#111] text-white border border-white/10 focus:border-[#BF953F] focus:ring-1 focus:ring-[#BF953F] outline-none rounded-lg px-4 py-3 placeholder-gray-600 transition-colors text-sm" />
        </div>
      </div>

      {!canRun && !isReassess && (
        <div className="mb-6 p-4 rounded-xl bg-[#0a0a0a] border border-[#BF953F]/30 text-xs text-white flex flex-col md:flex-row gap-4 items-center justify-between shadow-lg">
          <p>Requires <span className="font-bold text-[#D4AF37]">1 Pro Credit</span> to execute tactical analysis.</p>
          <button type="button" onClick={onOpenShop} className="font-black text-black bg-[#BF953F] hover:bg-[#D4AF37] transition-colors py-2 px-6 rounded uppercase tracking-widest whitespace-nowrap border-none">Acquire Credits</button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <button
          type="button"
          onClick={() => runAssess(false)}
          disabled={!hasEnoughInput || loading || assessmentCount > 0 || !canRun}
          className="flex-1 py-4 rounded-lg bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-black font-black uppercase tracking-[0.2em] transform transition duration-300 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(191,149,63,0.3)] disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none text-sm flex justify-center items-center gap-3 border-none"
        >
          {loading ? <><i className="fas fa-circle-notch fa-spin"></i> Analyzing Target…</> : <><i className="fas fa-crosshairs"></i> Execute Sniper Scan</>}
        </button>
        {canReassess && (
          <button type="button" onClick={() => runAssess(true)} disabled={loading} className="px-6 py-4 rounded-lg bg-[#111] border border-white/20 text-white hover:border-white/50 font-black uppercase tracking-widest text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
            Recalculate ({assessmentCount}/{MAX_REASSESS + 1})
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-500/30 text-center shadow-inner">
          <p className="text-red-400 text-xs font-bold uppercase tracking-widest"><i className="fas fa-exclamation-triangle mr-2"></i>{error}</p>
        </div>
      )}

      {result && (
        <div ref={resultCardRef} className="mb-10 p-6 rounded-2xl border border-[#BF953F]/30 bg-[#0a0a0a] shadow-[0_0_40px_rgba(191,149,63,0.1)] relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-bl from-[#BF953F]/10 to-transparent pointer-events-none"></div>
          
          <div className="flex justify-between items-start mb-6">
             <div>
               <p className="text-[9px] font-black text-white/40 uppercase tracking-[0.3em] mb-1"><i className="fas fa-check-circle text-[#BF953F] mr-1"></i> Tactical Analysis Complete</p>
               <h2 className="text-2xl font-black uppercase text-[#D4AF37] drop-shadow-[0_0_10px_rgba(191,149,63,0.3)] tracking-tight">{verdictLabel(result.verdict)}</h2>
             </div>
             {result.confidence != null && (
               <div className="text-right">
                 <p className="text-[8px] font-black text-white/30 uppercase tracking-widest mb-1">Confidence</p>
                 <p className="text-sm font-black text-white">{result.confidence}%</p>
               </div>
             )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6 relative">
            <div className="bg-[#111] border border-white/5 p-4 rounded-xl">
               <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-1"><i className="fas fa-search-plus mr-1 opacity-50"></i> Est. Condition</p>
               <p className="text-sm font-bold text-white">{result.condition_estimate}</p>
            </div>
            <div className="bg-[#111] border border-white/5 p-4 rounded-xl">
               <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-1"><i className="fas fa-sparkles mr-1 opacity-50"></i> Surface Type</p>
               <p className="text-sm font-bold text-white">{result.is_holographic ? 'Holographic/Foil' : 'Standard/Non-holo'}</p>
            </div>
          </div>
          
          <div className="bg-[#111] border border-white/5 p-5 rounded-xl mb-6 relative">
            <p className="text-[10px] text-[#BF953F] uppercase tracking-widest font-black mb-3">AI Reasoning</p>
            <p className="text-sm text-gray-300 font-serif leading-relaxed whitespace-pre-wrap">{result.reasoning}</p>
          </div>

          <button type="button" onClick={handleSaveAsImage} className="w-full text-center py-4 border border-white/10 rounded-xl text-xs font-black text-white/70 uppercase tracking-widest hover:bg-white/5 hover:text-white transition-colors hover:border-[#BF953F]/30 shadow-sm">
            <i className="fas fa-download mr-2 text-[#BF953F]"></i> Export Assessment
          </button>
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-white/10 text-[10px] text-gray-500 space-y-3 leading-relaxed">
        <p><strong className="text-white/70">Disclaimer:</strong> This is not investment advice. Do not buy solely because the AI says it is a good buy. Make the decision yourself; you are responsible for your financial future. Do not buy into FOMO. If you are curious, run the scan again.</p>
        <p>RawGraded does not own any shops, has no affiliations with any online stores, and makes no commissions or incentives based on these results.</p>
        <p>These results are not saved and are not considered owned or purchased. If you want to keep a record, use &quot;Export Assessment&quot; to download the intelligence to your device.</p>
      </div>
    </div>
  );
};

export default SniperView;
