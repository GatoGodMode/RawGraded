import React from 'react';

/**
 * Presentational vault card tile — same template as MyCollection card.
 * Used for homepage value-tabs preview and anywhere we need to show "what a vault card looks like."
 */
export interface VaultCardTileData {
  name: string;
  card_set?: string;
  year?: string;
  overall_grade: string;
  front_img?: string | null;
  user_notes?: string | null;
  acq_price?: string | null;
  acq_tax?: string | null;
  acq_shipping?: string | null;
  acq_source?: string | null;
  acq_date?: string | null;
  date_scanned?: string | null;
  estimated_value?: number | string | null;
}

interface VaultCardTileProps {
  data: VaultCardTileData;
  /** When true, no hover/click actions — static preview only */
  isPreview?: boolean;
  className?: string;
}

const VaultCardTile: React.FC<VaultCardTileProps> = ({ data, isPreview = false, className = '' }) => {
  const hasAcq = !!(data.acq_price || data.acq_source);
  const acqTotal = hasAcq
    ? (
        parseFloat(data.acq_price || '0') +
        parseFloat(data.acq_tax || '0') +
        parseFloat(data.acq_shipping || '0')
      ).toLocaleString(undefined, { minimumFractionDigits: 2 })
    : '0.00';

  return (
    <div
      className={`bg-[#080808] border border-white/10 overflow-hidden flex flex-col ${isPreview ? '' : 'cursor-pointer group hover:border-white/30 transition-all'} ${className}`}
      role={isPreview ? 'img' : undefined}
      aria-label={isPreview ? 'Example vault card' : undefined}
    >
      {/* Card Image */}
      <div className="relative h-64 bg-black flex items-center justify-center overflow-hidden border-b border-white/5">
        {data.front_img ? (
          <img
            src={data.front_img}
            alt=""
            className={`h-full w-full object-contain ${!isPreview ? 'transform group-hover:scale-110 transition-transform duration-500' : ''}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/10">
            <i className="fas fa-layer-group text-4xl" aria-hidden />
          </div>
        )}
        {/* Grade badge */}
        {(() => {
          const numGrade = parseFloat(data.overall_grade || '0');
          let bgStyle = 'linear-gradient(135deg, #8b0000 0%, #4a0000 100%)'; // Velvet red default
          let textColor = '#ffffff';
          let borderStyle = '1px solid rgba(255,0,0,0.3)';
          
          if (data.overall_grade === '10' || data.overall_grade === '10.0') {
              bgStyle = 'linear-gradient(135deg, #F3E5AB 0%, #D4AF37 50%, #8A6F1C 100%)';
              textColor = '#000000';
              borderStyle = '1px solid #F3E5AB';
          } else if (numGrade >= 9.0 && numGrade < 10) {
              bgStyle = 'linear-gradient(135deg, #E0E0E0 0%, #BDBDBD 50%, #757575 100%)';
              textColor = '#000000';
              borderStyle = '1px solid #ffffff';
          }

          return (
              <div className="absolute top-3 right-3 px-3 py-1.5 flex items-center gap-2 shadow-xl" style={{ background: bgStyle, border: borderStyle }}>
                  <span className="text-[10px] font-black uppercase" style={{ color: textColor === '#000000' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)' }}>Grade</span>
                  <span className="text-lg font-black" style={{ color: textColor }}>{data.overall_grade}</span>
              </div>
          );
        })()}
        {/* Value badge — Gold */}
        {data.estimated_value != null && Number(data.estimated_value) > 0 && (
          <div className="absolute bottom-3 left-3 px-3 py-1 text-xs font-black" style={{background:'rgba(0,0,0,0.85)',color:'#D4AF37',border:'1px solid rgba(212,175,55,0.4)'}}>
            ${Number(data.estimated_value).toLocaleString()}
          </div>
        )}
      </div>

      {/* Info body */}
      <div className="p-4 flex flex-col flex-1">
        <div className="mb-4 relative">
          <h3 className={`font-bold text-white truncate text-lg leading-tight flex-1 ${!isPreview ? 'group-hover:text-white/80 transition-colors' : ''}`}>
            {data.name}
          </h3>
          <div className="text-[10px] text-white/30 font-medium uppercase tracking-widest flex items-center gap-2 flex-wrap mt-1">
            <span>{[data.card_set, data.year].filter(Boolean).join(' · ') || '—'}</span>
          </div>
        </div>

        {/* Notes box */}
        <div className="bg-white/[0.02] p-3 text-xs text-white/40 min-h-[60px] border border-white/5 flex-1">
          {data.user_notes ? (
            <p className="italic leading-relaxed">&ldquo;{data.user_notes}&rdquo;</p>
          ) : (
            <p className="opacity-30">Add personal vault notes...</p>
          )}
        </div>

        {/* Acquisition block */}
        {hasAcq ? (
          <div className="relative group/acq mt-3 overflow-hidden border border-white/5 p-3" style={{background:'rgba(255,255,255,0.02)'}}>
            <div className="absolute top-0 right-0 p-1 opacity-10 text-white/50">
              <i className="fas fa-file-invoice-dollar text-3xl" aria-hidden />
            </div>
            <div className="flex justify-between items-end relative z-10">
              <div className="flex flex-col">
                <span className="text-[7px] font-black uppercase tracking-[0.2em] mb-1" style={{color:'#D4AF37'}}>Vault Investment</span>
                <span className="text-lg font-black text-white leading-none tracking-tight">
                  <span className="text-sm mr-0.5" style={{color:'#D4AF37'}}>$</span>
                  {acqTotal}
                </span>
                {isPreview && (data.acq_price || data.acq_tax != null || data.acq_shipping) && (
                  <p className="text-[9px] text-white/30 mt-0.5">
                    Price ${data.acq_price ?? '0'} · Tax ${data.acq_tax ?? '0'} · Ship ${data.acq_shipping ?? '0'}
                  </p>
                )}
              </div>
              <div className="flex flex-col text-right">
                <span className="text-[7px] font-black uppercase tracking-[0.2em] mb-1" style={{color:'#D4AF37'}}>Origin</span>
                <span className="text-[10px] font-bold text-white/50 truncate max-w-[100px]">{data.acq_source || 'Unknown'}</span>
              </div>
            </div>
            {data.acq_date && (
              <div className="mt-2 pt-2 border-t border-white/5">
                <span className="text-[7px] text-white/30 font-bold uppercase tracking-widest">Acquired {new Date(data.acq_date).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        ) : null}

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center text-[10px] uppercase font-bold tracking-widest text-white/30">
          <div className="flex flex-col">
            <span className="text-[8px] text-white/20 mb-0.5">Latest Audit</span>
            <span className="text-white/50">{data.date_scanned ? new Date(data.date_scanned).toLocaleDateString() : '—'}</span>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <span className="bg-white/5 border border-white/10 text-white px-4 py-2 font-black uppercase tracking-widest group-hover:bg-red-600 group-hover:border-red-600 group-hover:text-white transition-all flex items-center gap-2 text-[10px]">
              OPEN
              <i className="fas fa-arrow-right" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VaultCardTile;
