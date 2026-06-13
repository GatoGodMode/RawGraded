import { nativeImage, type IpcMain } from 'electron';

import {

  bitmapToGrayscale,

  defaultGuides,

  detectBordersFromGrayscale,

  type BorderDetectSide,

  type BorderGuidePositions,

  validateGuideOrdering,

} from '../shared/borderDetectCore';



export type { BorderDetectSide, BorderGuidePositions };



/** Normalized 0–100 positions for card border guides. */

export function detectBordersFromImageDataUrl(

  dataUrl: string,

  side: BorderDetectSide = 'front'

): BorderGuidePositions | null {

  try {

    const img = nativeImage.createFromDataURL(dataUrl);

    if (img.isEmpty()) return validateGuideOrdering(defaultGuides());

    const { width: w, height: h } = img.getSize();

    if (w < 50 || h < 50) return validateGuideOrdering(defaultGuides());

    const bitmap = img.toBitmap();

    const gray = bitmapToGrayscale(bitmap, w, h);

    return detectBordersFromGrayscale(gray, w, h, side);

  } catch {

    return null;

  }

}



export function registerBorderDetectIpc(ipcMain: IpcMain): void {

  ipcMain.handle('border:detect', (_e, dataUrl: string, side?: BorderDetectSide) => {

    const result = detectBordersFromImageDataUrl(dataUrl, side || 'front');

    return result || defaultGuides();

  });

}

