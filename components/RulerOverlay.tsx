import React, { useState } from 'react';

interface RulerOverlayProps {
  imageSrc: string;
}

const RulerOverlay: React.FC<RulerOverlayProps> = ({ imageSrc }) => {
  const [gridOpacity, setGridOpacity] = useState(0.5);
  const [gridType, setGridType] = useState<'standard' | 'centering'>('standard');

  return (
    <div className="relative w-full h-full group">
      <img src={imageSrc} alt="Card to Measure" className="w-full h-auto rounded-md" />
      
      {/* Overlay Container */}
      <div 
        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
        style={{ opacity: gridOpacity }}
      >
        {gridType === 'standard' ? (
             <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
             <defs>
               <pattern id="smallGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                 <path d="M 20 0 L 0 0 0 20" fill="none" stroke="cyan" strokeWidth="0.5" />
               </pattern>
               <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
                 <rect width="100" height="100" fill="url(#smallGrid)" />
                 <path d="M 100 0 L 0 0 0 100" fill="none" stroke="cyan" strokeWidth="1" />
               </pattern>
             </defs>
             <rect width="100%" height="100%" fill="url(#grid)" />
           </svg>
        ) : (
            <div className="w-full h-full relative">
                {/* 60/40 Centering Lines (Approximate visual aid) */}
                <div className="absolute top-0 bottom-0 left-[45%] w-[10%] border-l border-r border-yellow-400 opacity-70 bg-yellow-400/10"></div>
                <div className="absolute left-0 right-0 top-[45%] h-[10%] border-t border-b border-yellow-400 opacity-70 bg-yellow-400/10"></div>
                
                {/* Center Crosshair */}
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-red-500/80"></div>
                <div className="absolute left-1/2 top-0 h-full w-0.5 bg-red-500/80"></div>
            </div>
        )}
      </div>

      {/* Controls */}
      <div className="absolute bottom-2 left-2 right-2 bg-black/60 backdrop-blur-sm p-2 rounded flex items-center justify-between pointer-events-auto">
        <div className="flex space-x-2">
            <button 
                onClick={() => setGridType('standard')}
                className={`text-xs px-2 py-1 rounded ${gridType === 'standard' ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300'}`}
            >
                Grid
            </button>
             <button 
                onClick={() => setGridType('centering')}
                className={`text-xs px-2 py-1 rounded ${gridType === 'centering' ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-300'}`}
            >
                Centering
            </button>
        </div>
        <input 
            type="range" min="0" max="1" step="0.1" 
            value={gridOpacity} 
            onChange={(e) => setGridOpacity(parseFloat(e.target.value))}
            className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
        />
      </div>
    </div>
  );
};

export default RulerOverlay;