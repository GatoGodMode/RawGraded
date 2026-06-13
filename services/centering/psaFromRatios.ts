import type { CenteringRatioSet } from '../../types';

/** Worst-axis deviation from 50/50 (e.g. 55/45 → 5). */
function maxDeviation(r: CenteringRatioSet): number {
  return Math.max(
    Math.abs(r.leftPct - 50),
    Math.abs(r.rightPct - 50),
    Math.abs(r.topPct - 50),
    Math.abs(r.bottomPct - 50)
  );
}

export type LimitingAxis = 'L/R' | 'T/B';

/** PSA-style centering subgrade from measured L/R T/B (front stricter than back). */
export function psaCenteringSubgrade(r: CenteringRatioSet, side: 'front' | 'back'): number {
  const dev = maxDeviation(r);
  if (side === 'back') {
    if (dev <= 25) return 10;
    if (dev <= 30) return 9;
    if (dev <= 35) return 8;
    if (dev <= 40) return 7;
    return 6;
  }
  if (dev <= 5) return 10;
  if (dev <= 10) return 9;
  if (dev <= 15) return 8;
  if (dev <= 20) return 7;
  return 6;
}

/** Border-width ratios: left/(left+right) etc. — matches physical centering tool logic. */
function borderWidthRatios(g: {
  outerTop: number;
  outerBottom: number;
  outerLeft: number;
  outerRight: number;
  innerTop: number;
  innerBottom: number;
  innerLeft: number;
  innerRight: number;
}): CenteringRatioSet {
  const leftBorder = Math.max(0.05, g.innerLeft - g.outerLeft);
  const rightBorder = Math.max(0.05, g.outerRight - g.innerRight);
  const topBorder = Math.max(0.05, g.innerTop - g.outerTop);
  const bottomBorder = Math.max(0.05, g.outerBottom - g.innerBottom);
  const hTotal = leftBorder + rightBorder;
  const vTotal = topBorder + bottomBorder;
  return {
    leftPct: Math.round((leftBorder / hTotal) * 1000) / 10,
    rightPct: Math.round((rightBorder / hTotal) * 1000) / 10,
    topPct: Math.round((topBorder / vTotal) * 1000) / 10,
    bottomPct: Math.round((bottomBorder / vTotal) * 1000) / 10,
  };
}

function checkCenteringSanity(
  g: {
    outerTop: number;
    outerBottom: number;
    outerLeft: number;
    outerRight: number;
    innerTop: number;
    innerBottom: number;
    innerLeft: number;
    innerRight: number;
  },
  thickness: CenteringRatioSet
): boolean {
  const cardW = g.outerRight - g.outerLeft;
  const cardH = g.outerBottom - g.outerTop;
  if (cardW <= 5 || cardH <= 5) return false;

  const leftBand = ((g.innerLeft - g.outerLeft) / cardW) * 100;
  const rightBand = ((g.outerRight - g.innerRight) / cardW) * 100;
  const topBand = ((g.innerTop - g.outerTop) / cardH) * 100;
  const bottomBand = ((g.outerBottom - g.innerBottom) / cardH) * 100;

  const bands = [leftBand, rightBand, topBand, bottomBand];
  const maxBand = Math.max(...bands);
  const minBand = Math.min(...bands);
  if (maxBand > 16 && minBand < 6) return false;
  if (maxBand > 20) return false;
  if (minBand < 2.5) return false;

  const dev = maxDeviation(thickness);
  if (dev <= 4 && maxBand > 13) return false;
  if (dev <= 2 && minBand < 4) return false;

  const outerNearEdge =
    g.outerTop <= 12 && g.outerBottom >= 88 && g.outerLeft <= 15 && g.outerRight >= 85;
  if (!outerNearEdge && dev <= 3) return false;

  return true;
}

export function getLimitingAxis(r: CenteringRatioSet): { axis: LimitingAxis; label: string; grade: number; side: 'front' | 'back' } | null {
  const lrDev = Math.max(Math.abs(r.leftPct - 50), Math.abs(r.rightPct - 50));
  const tbDev = Math.max(Math.abs(r.topPct - 50), Math.abs(r.bottomPct - 50));
  if (lrDev >= tbDev) {
    return {
      axis: 'L/R',
      label: `L ${r.leftPct}% / R ${r.rightPct}%`,
      grade: psaCenteringSubgrade(
        { leftPct: r.leftPct, rightPct: r.rightPct, topPct: 50, bottomPct: 50 },
        'front'
      ),
      side: 'front',
    };
  }
  return {
    axis: 'T/B',
    label: `T ${r.topPct}% / B ${r.bottomPct}%`,
    grade: psaCenteringSubgrade(
      { leftPct: 50, rightPct: 50, topPct: r.topPct, bottomPct: r.bottomPct },
      'front'
    ),
    side: 'front',
  };
}

export function ratiosFromGuides(
  g: {
    outerTop: number;
    outerBottom: number;
    outerLeft: number;
    outerRight: number;
    innerTop: number;
    innerBottom: number;
    innerLeft: number;
    innerRight: number;
  },
  side: 'front' | 'back' = 'front'
): CenteringRatioSet {
  const thickness = borderWidthRatios(g);
  const limiting = getLimitingAxis(thickness);
  const limitingGrade = limiting
    ? psaCenteringSubgrade(
        limiting.axis === 'L/R'
          ? { leftPct: thickness.leftPct, rightPct: thickness.rightPct, topPct: 50, bottomPct: 50 }
          : { leftPct: 50, rightPct: 50, topPct: thickness.topPct, bottomPct: thickness.bottomPct },
        side
      )
    : psaCenteringSubgrade(thickness, side);

  const set: CenteringRatioSet = { ...thickness };
  set.psaHint = limitingGrade;
  set.centeringValid = checkCenteringSanity(g, thickness);
  if (limiting) {
    set.limitingAxis = limiting.axis;
    set.limitingLabel = limiting.label;
    set.limitingGrade = limitingGrade;
  }
  return set;
}

export function formatRatioLabel(r: CenteringRatioSet): string {
  const valid = r.centeringValid === false ? ' (needs review)' : '';
  return `L ${r.leftPct}% / R ${r.rightPct}% · T ${r.topPct}% / B ${r.bottomPct}%${valid}`;
}

export function isValidCenteringRatio(r?: CenteringRatioSet): boolean {
  return !!r && r.centeringValid !== false;
}

export function measuredCenteringSubgrade(
  measurement: { front?: CenteringRatioSet; back?: CenteringRatioSet } | undefined
): number | null {
  if (!measurement?.front && !measurement?.back) return null;
  const grades: number[] = [];
  if (measurement.front && isValidCenteringRatio(measurement.front)) {
    grades.push(measurement.front.limitingGrade ?? psaCenteringSubgrade(measurement.front, 'front'));
  }
  if (measurement.back && isValidCenteringRatio(measurement.back)) {
    grades.push(measurement.back.limitingGrade ?? psaCenteringSubgrade(measurement.back, 'back'));
  }
  return grades.length ? Math.min(...grades) : null;
}

export function stricterCenteringSubgrade(ai: number, measured: number | null): number {
  if (measured == null || !Number.isFinite(measured)) return ai;
  if (!Number.isFinite(ai) || ai <= 0) return measured;
  return Math.min(ai, measured);
}

export function resolveFinalCentering(ai: number, measured: number | null, useMeasured: boolean): number {
  if (!useMeasured || measured == null || !Number.isFinite(measured)) return ai;
  return stricterCenteringSubgrade(ai, measured);
}
