import React from 'react';

interface VideoGuideOverlayProps {
  type: 'card' | 'slab';
  stage: number;
}

const VideoGuideOverlay: React.FC<VideoGuideOverlayProps> = ({ type, stage }) => {
  // Slab stages: 0=Label, 1=Holo, 2=Edges, 3=Micro, 4=Back
  // Card stages: 0=Front, 1=Tilt L/R, 2=Tilt U/D, 3=Macro, 4=Back
  
  const getTransform = () => {
    if (type === 'slab') {
      switch (stage) {
        case 0: return 'scale(1.1) translateY(10px)'; // Zoom top
        case 1: return 'scale(1.1) translateY(10px)'; // Zoom top
        case 2: return 'scale(1)'; // Full view
        case 3: return 'scale(1.8) translate(5px, 20px)'; // Broader zoom on text/hologram region
        case 4: return 'scale(1) rotateY(180deg)'; // Flipped
        default: return 'scale(1)';
      }
    } else {
      switch (stage) {
        case 0: return 'scale(1)';
        case 1: return 'scale(1.1)'; // CSS will handle tilt
        case 2: return 'scale(1.1)'; // CSS will handle tilt
        case 3: return 'scale(1.5) translateY(-10px)'; // Center zoom
        case 4: return 'scale(1) rotateY(180deg)'; // Flipped
        default: return 'scale(1)';
      }
    }
  };

  const getAnimationClass = () => {
    if (type === 'slab' && stage === 1) return 'animate-tilt-lr';
    if (type === 'slab' && stage === 4) return 'animate-tilt-back';
    if (type === 'card' && stage === 1) return 'animate-tilt-lr';
    if (type === 'card' && stage === 2) return 'animate-tilt-ud';
    return '';
  };

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden z-20">
      <div 
        className={`relative w-[50%] max-w-[250px] aspect-[2/3] transition-all duration-1000 ease-in-out ${getAnimationClass()}`}
        style={{ transform: getTransform(), transformStyle: 'preserve-3d' }}
      >
        <svg viewBox="0 0 100 150" className="w-full h-full drop-shadow-md opacity-30">
          {type === 'slab' ? (
            <g className="fill-none" strokeWidth="1.5">
              {/* Outer Case */}
              <rect x="5" y="5" width="90" height="140" rx="4" 
                className={`transition-colors duration-500 ${stage === 2 ? 'stroke-yellow-400 stroke-[2.5px] drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]' : 'stroke-white/50'}`} />
              
              {/* Inner Label Window */}
              <rect x="10" y="10" width="80" height="30" rx="2" 
                className={`transition-colors duration-500 ${stage === 0 ? 'stroke-green-400 stroke-[2px] drop-shadow-[0_0_8px_rgba(74,222,128,0.8)] fill-green-400/10' : 'stroke-white/40'}`} />
              
              {/* Text Lines */}
              <line x1="15" y1="18" x2="60" y2="18" 
                className={`transition-colors duration-500 ${stage === 3 ? 'stroke-sky-400 stroke-[2px] drop-shadow-[0_0_6px_rgba(56,189,248,1)]' : 'stroke-white/30'}`} strokeWidth="1" />
              <line x1="15" y1="24" x2="50" y2="24" className="stroke-white/30" strokeWidth="1" />
              <line x1="15" y1="30" x2="35" y2="30" className="stroke-white/30" strokeWidth="1" />
              
              {/* Grade Box */}
              <rect x="70" y="15" width="15" height="15" rx="1" 
                className={`transition-colors duration-500 ${stage === 3 ? 'stroke-sky-400 stroke-[2px] drop-shadow-[0_0_6px_rgba(56,189,248,1)]' : 'stroke-white/40'}`} />
              
              {/* Hologram Circle */}
              <circle cx="80" cy="35" r="3" 
                className={`transition-all duration-500 ${stage === 1 ? 'stroke-purple-400 stroke-[2px] fill-purple-400/40 animate-pulse drop-shadow-[0_0_12px_rgba(192,132,252,1)]' : 'stroke-white/40'}`} />
              
              {/* Card Window */}
              <rect x="15" y="45" width="70" height="95" rx="2" className={`transition-colors duration-500 ${stage === 4 ? 'stroke-green-400/50 fill-white/5' : 'stroke-white/20'}`} />

              {/* Back Hologram Sticker (Only visible on back tilt) */}
              <g className={`transition-opacity duration-500 ${stage === 4 ? 'opacity-100' : 'opacity-0'}`}>
                <rect x="40" y="125" width="20" height="10" rx="1" 
                  className={`transition-all duration-500 ${stage === 4 ? 'stroke-purple-400 stroke-[2px] fill-purple-400/40 animate-pulse drop-shadow-[0_0_12px_rgba(192,132,252,1)]' : 'stroke-white/40'}`} />
              </g>
            </g>
          ) : (
            <g className="fill-none" strokeWidth="1.5">
              {/* Card Outline */}
              <rect x="10" y="10" width="80" height="130" rx="4" 
                className={`transition-colors duration-500 ${stage === 0 ? 'stroke-green-400 stroke-[2px] drop-shadow-[0_0_8px_rgba(74,222,128,0.8)] fill-green-400/5' : 'stroke-white/50'}`} />
              
              {/* Image Window */}
              <rect x="15" y="20" width="70" height="50" rx="2" 
                className={`transition-colors duration-500 ${stage === 3 ? 'stroke-sky-400 stroke-[2px] drop-shadow-[0_0_8px_rgba(56,189,248,0.8)] fill-sky-400/10' : 'stroke-white/30'}`} />
                
              {/* Text Lines */}
              <line x1="15" y1="80" x2="60" y2="80" className="stroke-white/30" strokeWidth="1" />
              <line x1="15" y1="88" x2="85" y2="88" className="stroke-white/30" strokeWidth="1" />
              <line x1="15" y1="96" x2="75" y2="96" className="stroke-white/30" strokeWidth="1" />
              <circle cx="80" cy="120" r="4" className={`transition-colors duration-500 ${stage === 1 ? 'stroke-purple-400 fill-purple-400/30 drop-shadow-[0_0_8px_rgba(192,132,252,1)]' : 'stroke-white/30'}`} />
            </g>
          )}
        </svg>
        
        {/* Helper Text Bubbles for stages */}
        {type === 'slab' && stage === 0 && (
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-green-500 text-black text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap animate-bounce">
            Align Label Here
          </div>
        )}
        {type === 'slab' && stage === 1 && (
          <div className="absolute top-[32%] right-[-60px] bg-purple-500 text-white text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap animate-pulse">
            Catch Light
          </div>
        )}
        {type === 'slab' && stage === 2 && (
          <div className="absolute top-1/2 -right-8 bg-yellow-400 text-black text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap">
            Check Edges
          </div>
        )}
        {type === 'slab' && stage === 3 && (
          <div className="absolute top-[10%] left-[10%] bg-sky-500 text-black text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap">
            Focus Grade
          </div>
        )}
        {type === 'slab' && stage === 4 && (
          <div className="absolute top-[80%] left-1/2 -translate-x-1/2 bg-purple-500 text-white text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap animate-pulse">
            Catch Back Holo
          </div>
        )}
      </div>
      
      <style>{`
        @keyframes tilt-lr {
          0%, 100% { transform: perspective(800px) rotateY(-20deg) scale(1.1); }
          50% { transform: perspective(800px) rotateY(20deg) scale(1.1); }
        }
        .animate-tilt-lr {
          animation: tilt-lr 3s ease-in-out infinite;
        }
        @keyframes tilt-ud {
          0%, 100% { transform: perspective(800px) rotateX(-20deg) scale(1.1); }
          50% { transform: perspective(800px) rotateX(20deg) scale(1.1); }
        }
        .animate-tilt-ud {
          animation: tilt-ud 3s ease-in-out infinite;
        }
        @keyframes tilt-back {
          0%, 100% { transform: perspective(800px) rotateY(160deg) scale(1.1); }
          50% { transform: perspective(800px) rotateY(200deg) scale(1.1); }
        }
        .animate-tilt-back {
          animation: tilt-back 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default VideoGuideOverlay;
