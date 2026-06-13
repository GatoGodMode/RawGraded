import React, { forwardRef } from 'react';
import SlabSlip from '../SlabSlip';
import type { CardData, GradingResult } from '../../types';

export interface StudioSlabSlipTargetProps {
  exportCardData: CardData;
  grade: GradingResult;
}

/** Off-screen render target for slab slip PNG export (754×1054 @ scale 1.5 in capture). */
const StudioSlabSlipTarget = forwardRef<HTMLDivElement, StudioSlabSlipTargetProps>(
  function StudioSlabSlipTarget({ exportCardData, grade }, ref) {
    return (
      <div
        ref={ref}
        style={{
          position: 'fixed',
          left: -10000,
          top: 0,
          width: 754,
          height: 1054,
          padding: 2,
          backgroundColor: '#fff',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <SlabSlip data={exportCardData} finalGrade={grade} />
      </div>
    );
  }
);

export default StudioSlabSlipTarget;
