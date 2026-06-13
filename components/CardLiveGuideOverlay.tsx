import React from 'react';
import type { CardFrameQuality } from '../services/camera/cardFrameAnalyzer';

const STATUS_STROKE: Record<CardFrameQuality['status'], string> = {
  green: '#4ade80',
  yellow: '#facc15',
  red: '#f87171',
};

export const CardLiveGuideOverlay: React.FC<{
  quality: CardFrameQuality;
  className?: string;
}> = ({ quality, className = '' }) => {
  const stroke = STATUS_STROKE[quality.status];
  const { quad, hint, lighting } = quality;

  return (
    <div className={`absolute inset-0 pointer-events-none z-30 ${className}`}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1 1" preserveAspectRatio="none">
        {quad ? (
          <polygon
            points={quad.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={stroke}
            strokeWidth={0.008}
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 6px ${stroke})` }}
          />
        ) : (
          <rect
            x={0.15}
            y={0.12}
            width={0.7}
            height={0.76}
            fill="none"
            stroke={stroke}
            strokeWidth={0.006}
            strokeDasharray="0.02 0.015"
            vectorEffect="non-scaling-stroke"
            opacity={0.7}
          />
        )}
      </svg>

      <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center gap-2 px-4">
        <div
          className="px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg backdrop-blur-md"
          style={{
            backgroundColor: `${stroke}22`,
            border: `1px solid ${stroke}`,
            color: stroke,
          }}
        >
          {hint}
        </div>

        {lighting.status !== 'ok' && (
          <div
            className={`max-w-md text-center px-4 py-2 rounded-lg text-[11px] leading-snug backdrop-blur-md ${
              lighting.status === 'poor'
                ? 'bg-red-950/70 border border-red-500/40 text-red-200'
                : 'bg-amber-950/70 border border-amber-500/40 text-amber-100'
            }`}
          >
            <i className="fas fa-sun mr-1.5 opacity-80" />
            {lighting.message}
            {lighting.accuracyWarning && (
              <span className="block mt-1 text-[10px] opacity-80">{lighting.accuracyWarning}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CardLiveGuideOverlay;
