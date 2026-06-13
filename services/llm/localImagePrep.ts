import { resizeImage } from '../imageUtils';
import type { DesktopLlmSettings } from './types';

export type LocalImageCompressionPreset = 'full' | 'balanced' | 'fast';

export interface LocalImagePrepOptions {
  maxDim: number;
  quality: number;
}

export interface LocalImagePresetInfo {
  id: LocalImageCompressionPreset;
  label: string;
  tooltip: string;
  maxDim: number;
  quality: number;
}

export const LOCAL_IMAGE_PRESETS: LocalImagePresetInfo[] = [
  {
    id: 'full',
    label: 'Full detail',
    tooltip: '2048px, JPEG 0.92. Recommended: 8GB+ VRAM / 16GB RAM. Best for edge/corner whitening on vintage backs.',
    maxDim: 2048,
    quality: 0.92,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    tooltip: '1536px, JPEG 0.85. Recommended: 6GB VRAM / 12GB RAM. Good tradeoff for most cards.',
    maxDim: 1536,
    quality: 0.85,
  },
  {
    id: 'fast',
    label: 'Fast',
    tooltip: '1024px, JPEG 0.72. Recommended: 4GB VRAM / 8GB RAM. May miss micro edge wear.',
    maxDim: 1024,
    quality: 0.72,
  },
];

export function resolveLocalImagePrep(settings: DesktopLlmSettings): LocalImagePrepOptions {
  if (!settings.localImageCompressionEnabled) {
    return { maxDim: 2048, quality: 0.92 };
  }
  const preset = LOCAL_IMAGE_PRESETS.find((p) => p.id === settings.localImageCompressionPreset) ?? LOCAL_IMAGE_PRESETS[0];
  return { maxDim: preset.maxDim, quality: preset.quality };
}

export async function prepLocalImage(dataUrl: string, settings: DesktopLlmSettings): Promise<string> {
  const { maxDim, quality } = resolveLocalImagePrep(settings);
  return resizeImage(dataUrl, maxDim, quality);
}

export async function prepLocalImages(
  images: string[],
  settings: DesktopLlmSettings
): Promise<string[]> {
  return Promise.all(images.map((img) => prepLocalImage(img, settings)));
}
