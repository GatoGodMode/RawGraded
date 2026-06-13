import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

type HeightGridJson = {
  size: number; // NxN
  height: number[]; // length = size*size, normalized 0..1
};

export type Card3DViewerProps = {
  frontTexture: string; // data URL
  backTexture: string; // data URL
  heightGridJson: HeightGridJson | string | null; // stored JSON (client parses)
  normalStrength?: number;
  thickness?: number;
  width?: number; // world units
  heightWorld?: number; // world units
  className?: string;
  /** When true, front face uses foil v3 (MeshPhysical iridescence + era presets). */
  isHolographic?: boolean;
  /** Detected foil pattern: cosmos, galaxy, cracked_ice, swirl, reverse, full_art, standard, none */
  holoPattern?: string;
  year?: string | null;
  cardSet?: string | null;
  /** Override automatic preset from year/set (0–3). */
  foilPreset?: 0 | 1 | 2 | 3;
  /** When true, show a small UI to control lighting (angle + brightness). */
  showLightingControls?: boolean;
  /** Admin-only camera panel for debugging/framing. */
  showAdminCameraControls?: boolean;
};

/** Era / set → iridescence preset index (v3). */
export function resolveFoilPreset(year?: string | null, cardSet?: string | null): 0 | 1 | 2 | 3 {
  const set = (cardSet || '').toLowerCase();
  if (/reverse|rev\s*holo|rev\s*foil|reverse\s*holo/.test(set)) return 3;
  const digits = String(year || '').replace(/\D/g, '');
  const y = parseInt(digits.slice(0, 4), 10);
  if (!Number.isFinite(y) || y < 1900) return 1;
  if (y < 2000) return 0;
  if (y < 2016) return 1;
  return 2;
}

const FOIL_PRESETS: Array<{ ior: number; thick: [number, number]; rough: number; metal: number }> = [
  { ior: 1.22, thick: [180, 640], rough: 0.36, metal: 0.05 },
  { ior: 1.34, thick: [120, 700], rough: 0.28, metal: 0.08 },
  { ior: 1.48, thick: [80, 760], rough: 0.18, metal: 0.12 },
  { ior: 1.52, thick: [110, 780], rough: 0.22, metal: 0.18 },
];

function parseHeightGrid(heightGridJson: HeightGridJson | string | null): HeightGridJson | null {
  if (!heightGridJson) return null;
  if (typeof heightGridJson === 'string') {
    try {
      const parsed = JSON.parse(heightGridJson);
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.size !== 'number' || !Array.isArray(parsed.height)) return null;
      return parsed as HeightGridJson;
    } catch {
      return null;
    }
  }
  return heightGridJson;
}

function heightGridToNormalMap(heightGrid: HeightGridJson, normalStrength: number) {
  const { size, height } = heightGrid;
  const n = size;
  // WebGL2 internal format note:
  // three.js doesn't correctly map RGBFormat (UNSIGNED_BYTE) to a sized internal format,
  // which causes `glTexStorage2D: Invalid internal format 0x1907`.
  // Using RGBAFormat (RGBA8) avoids the WebGL2 error.
  const out = new Uint8Array(n * n * 4);

  // Sobel-ish gradients (simple central differences)
  const idx = (x: number, y: number) => y * n + x;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const xL = Math.max(0, x - 1);
      const xR = Math.min(n - 1, x + 1);
      const yU = Math.max(0, y - 1);
      const yD = Math.min(n - 1, y + 1);

      const hL = height[idx(xL, y)];
      const hR = height[idx(xR, y)];
      const hU = height[idx(x, yU)];
      const hD = height[idx(x, yD)];

      const dx = (hR - hL) * normalStrength;
      const dy = (hD - hU) * normalStrength;

      // Tangent space normal approximation
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const nnx = nx / len;
      const nny = ny / len;
      const nnz = nz / len;

      const o = (y * n + x) * 4;
      out[o + 0] = Math.max(0, Math.min(255, Math.round((nnx * 0.5 + 0.5) * 255)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round((nny * 0.5 + 0.5) * 255)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round((nnz * 0.5 + 0.5) * 255)));
      out[o + 3] = 255; // opaque alpha (ignored by normal map sampling)
    }
  }

  const texture = new THREE.DataTexture(out, n, n, THREE.RGBAFormat);
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

type HoloPatternType = 'cosmos' | 'galaxy' | 'cracked_ice' | 'swirl' | 'reverse' | 'full_art' | 'standard' | 'none';

const VALID_HOLO_PATTERNS: ReadonlyArray<HoloPatternType> = [
  'cosmos',
  'galaxy',
  'cracked_ice',
  'swirl',
  'reverse',
  'full_art',
  'standard',
  'none',
];

function normalizeHoloPattern(value: any): HoloPatternType {
  const normalized = String(value ?? 'none').toLowerCase().replace(/[\s-]+/g, '_');
  return (VALID_HOLO_PATTERNS as readonly string[]).includes(normalized) ? (normalized as HoloPatternType) : 'none';
}

function generateHoloThicknessMap(pattern: HoloPatternType, res = 256): THREE.CanvasTexture | null {
  if (pattern === 'none') return null;

  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;

  // Thickness map: brighter = thicker film = different rainbow color shift.
  // Darker areas get less iridescence, brighter areas get more.
  // We paint grayscale patterns; Three.js samples the green channel for thickness.

  const cx = res / 2;
  const cy = res / 2;

  switch (pattern) {
    case 'cosmos': {
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, res, res);
      const seed = 42;
      const rng = (i: number) => {
        let x = Math.sin(seed + i * 9301 + 49297) * 233280;
        return x - Math.floor(x);
      };
      for (let i = 0; i < 180; i++) {
        const x = rng(i * 3) * res;
        const y = rng(i * 3 + 1) * res;
        const r = 4 + rng(i * 3 + 2) * 18;
        const brightness = 120 + Math.floor(rng(i * 7) * 135);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgb(${brightness},${brightness},${brightness})`);
        grad.addColorStop(0.6, `rgb(${Math.floor(brightness * 0.5)},${Math.floor(brightness * 0.5)},${Math.floor(brightness * 0.5)})`);
        grad.addColorStop(1, 'rgba(50,50,50,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'galaxy': {
      // Galaxy: keep a dark base (so stars read as they "pop")
      // and use a low-frequency arm field + sharp diamond/star sparkles.
      ctx.fillStyle = '#0c0c0c';
      ctx.fillRect(0, 0, res, res);

      const cx0 = res / 2;
      const cy0 = res / 2;
      const img = ctx.getImageData(0, 0, res, res);

      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          const dx = (px - cx0) / res;
          const dy = (py - cy0) / res;
          const dist = Math.hypot(dx, dy);
          const ang = Math.atan2(dy, dx);

          // Low-frequency arm field for gentle flowing motion.
          const arm = Math.sin(ang * 3.2 + dist * 14.5) * 0.5 + 0.5;
          const wave = Math.sin(dx * 20 + dy * 14) * 0.65 + Math.sin(dx * 42 - dy * 30) * 0.25;

          const fade = Math.max(0, 1 - dist * 1.7);

          // Dark base so sparkles remain readable; thickness map is what the shader turns into color shifts.
          const base = 18 + fade * 58 + arm * 28 + wave * 14;
          const v = Math.floor(Math.max(0, Math.min(255, base)));

          const idx = (py * res + px) * 4;
          img.data[idx] = v;
          img.data[idx + 1] = v;
          img.data[idx + 2] = v;
          img.data[idx + 3] = 255;
        }
      }

      ctx.putImageData(img, 0, 0);

      const rng2 = (i: number) => {
        let x = Math.sin(71 + i * 7919 + 104729) * 233280;
        return x - Math.floor(x);
      };

      // Sparkles: diamonds + a few star-corners. Use "screen" blending so they pop.
      ctx.save();
      ctx.globalCompositeOperation = 'screen';

      for (let i = 0; i < 160; i++) {
        const x = rng2(i * 4) * res;
        const y = rng2(i * 4 + 1) * res;
        const size = 0.7 + rng2(i * 4 + 2) * 2.3;
        const brightness = 185 + Math.floor(rng2(i * 4 + 3) * 70);

        const shapeKind = rng2(i * 7 + 1);

        // Core sparkle (sharp)
        ctx.fillStyle = `rgba(${brightness},${brightness},${brightness},0.95)`;
        ctx.beginPath();
        if (shapeKind < 0.35) {
          // Diamond
          ctx.moveTo(x, y - size * 2);
          ctx.lineTo(x + size * 2, y);
          ctx.lineTo(x, y + size * 2);
          ctx.lineTo(x - size * 2, y);
          ctx.closePath();
          ctx.fill();
        } else {
          // 4-point star-ish (two diagonals)
          const s = size * 2.1;
          ctx.moveTo(x, y - s);
          ctx.lineTo(x + size, y - size);
          ctx.lineTo(x + s, y);
          ctx.lineTo(x + size, y + size);
          ctx.lineTo(x, y + s);
          ctx.lineTo(x - size, y + size);
          ctx.lineTo(x - s, y);
          ctx.lineTo(x - size, y - size);
          ctx.closePath();
          ctx.fill();
        }

        // Soft halo (keeps it believable, avoids harsh pixel glitter)
        const haloR = size * 4.8;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, haloR);
        grad.addColorStop(0, `rgba(${brightness},${brightness},${brightness},0.55)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, haloR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      break;
    }
    case 'cracked_ice': {
      ctx.fillStyle = '#444';
      ctx.fillRect(0, 0, res, res);
      const rng3 = (i: number) => {
        let x = Math.sin(137 + i * 6221) * 233280;
        return x - Math.floor(x);
      };
      // Voronoi-ish cells via random seed points
      const pts: [number, number][] = [];
      for (let i = 0; i < 40; i++) {
        pts.push([rng3(i * 2) * res, rng3(i * 2 + 1) * res]);
      }
      const imgData = ctx.getImageData(0, 0, res, res);
      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          let min1 = 1e9, min2 = 1e9;
          for (const [sx, sy] of pts) {
            const d = Math.hypot(px - sx, py - sy);
            if (d < min1) { min2 = min1; min1 = d; }
            else if (d < min2) { min2 = d; }
          }
          const edge = Math.max(0, Math.min(1, (min2 - min1) / 8));
          const v = Math.floor(edge * 200 + 55);
          const idx = (py * res + px) * 4;
          imgData.data[idx] = v;
          imgData.data[idx + 1] = v;
          imgData.data[idx + 2] = v;
          imgData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      break;
    }
    case 'swirl': {
      // Swirl: ribbon bands + occasional diamond sparkles tied to ribbon strength.
      ctx.fillStyle = '#0f0f0f';
      ctx.fillRect(0, 0, res, res);
      const imgData2 = ctx.getImageData(0, 0, res, res);

      const hash = (x: number, y: number) => {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return s - Math.floor(s);
      };

      const cell = Math.max(10, Math.floor(res / 16));

      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          const dx = px - cx;
          const dy = py - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);

          const distN = dist / (res * 0.66);
          const fade = Math.max(0, 1 - distN);

          // Ribbon field: create sharper bands so stars/diamonds read at angle changes.
          const ribbonField = Math.sin(angle * 1.55 + dist * 0.065);
          const ribbon = ribbonField * 0.5 + 0.5; // 0..1
          const bands = Math.pow(ribbon * fade, 2.1); // sharpen

          // Add slight secondary banding so it "wanders" under iridescence.
          const twist = Math.sin(angle * 3.6 + dist * 0.11) * 0.5 + 0.5;
          let v = 22 + bands * 210 + twist * 18;
          v = Math.max(0, Math.min(255, v));

          // Diamond sparkles, but only where ribbon is strong (keeps believable flow).
          const gx = Math.floor(px / cell);
          const gy = Math.floor(py / cell);
          const r0 = hash(gx, gy);
          if (r0 > 0.965 && bands > 0.35) {
            const localX = (px - gx * cell) / cell;
            const localY = (py - gy * cell) / cell;
            const cx1 = 0.5;
            const cy1 = 0.5;
            const dd = Math.abs(localX - cx1) + Math.abs(localY - cy1); // diamond distance
            const sparkle = Math.max(0, 1 - dd / 0.28);
            v = Math.min(255, v + sparkle * 155 * fade);
          }

          const idx = (py * res + px) * 4;
          const vv = Math.floor(v);
          imgData2.data[idx] = vv;
          imgData2.data[idx + 1] = vv;
          imgData2.data[idx + 2] = vv;
          imgData2.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData2, 0, 0);
      break;
    }
    case 'reverse': {
      // Reverse holo pattern-only (area selection is handled by a fixed holo-area mask).
      const imgDataR = ctx.getImageData(0, 0, res, res);
      const rngR = (i: number) => {
        let x = Math.sin(777 + i * 3979) * 233280;
        return x - Math.floor(x);
      };

      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          const noise = rngR(py * res + px) * 40;
          // Slightly shifted lane field vs standard.
          const lane = Math.sin(px * 0.12 - py * 0.09 + 1.7) * 34;
          const micro = Math.sin(px * 0.23 + py * 0.17 + 0.8) * 10;
          const base = 188 + lane + micro + noise - 20;
          // Invert brightness so the reverse looks physically distinct even within the mask.
          const inv = 255 - base;
          const v = Math.floor(Math.max(70, Math.min(255, 110 + inv * 0.82)));
          const idx = (py * res + px) * 4;
          imgDataR.data[idx] = v;
          imgDataR.data[idx + 1] = v;
          imgDataR.data[idx + 2] = v;
          imgDataR.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgDataR, 0, 0);
      break;
    }
    case 'full_art': {
      // Entire card is holographic with a subtle organic texture.
      const imgData3 = ctx.getImageData(0, 0, res, res);
      const rng4 = (i: number) => {
        let x = Math.sin(211 + i * 3571) * 233280;
        return x - Math.floor(x);
      };
      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          const noise = rng4(py * res + px) * 60;
          const wave = Math.sin(px * 0.05 + py * 0.035) * 38 + Math.sin(px * 0.11 - py * 0.07) * 22;
          const streak = Math.sin((px * 0.13 - py * 0.095) + Math.sin(py * 0.02) * 0.8) * 28;
          const v = Math.floor(Math.max(70, Math.min(255, 152 + wave + streak + noise - 26)));
          const idx = (py * res + px) * 4;
          imgData3.data[idx] = v;
          imgData3.data[idx + 1] = v;
          imgData3.data[idx + 2] = v;
          imgData3.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData3, 0, 0);
      break;
    }
    case 'standard': {
      // Classic holofoil pattern-only (area selection is handled by a fixed holo-area mask).
      const imgData4 = ctx.getImageData(0, 0, res, res);
      const rng5 = (i: number) => {
        let x = Math.sin(313 + i * 4793) * 233280;
        return x - Math.floor(x);
      };

      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          const noise = rng5(py * res + px) * 40;
          // Diagonal lanes produce the "moving rainbow streak" look seen on holo cards.
          const lane = Math.sin(px * 0.12 - py * 0.09) * 34;
          const micro = Math.sin(px * 0.23 + py * 0.17) * 10;
          const v = Math.floor(Math.max(110, Math.min(255, 188 + lane + micro + noise - 20)));
          const idx = (py * res + px) * 4;
          imgData4.data[idx] = v;
          imgData4.data[idx + 1] = v;
          imgData4.data[idx + 2] = v;
          imgData4.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData4, 0, 0);
      break;
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  // These are data textures (thickness/iridescence), not color images.
  // Use clamp + repeat=1 to keep holo boundaries stable and prevent
  // mask alignment from becoming "shotty" as you rotate.
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1.0, 1.0);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function heightGridToHoloThicknessCanvas(
  heightGrid: HeightGridJson,
  res = 256,
  heightStrength = 1
): HTMLCanvasElement {
  const { size: n, height } = heightGrid;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;

  const img = ctx.getImageData(0, 0, res, res);

  const nMax = Math.max(1, n - 1);
  const strengthScale = clamp01(heightStrength);

  for (let py = 0; py < res; py++) {
    const gy = (py / (res - 1)) * nMax;
    const y0 = Math.floor(gy);
    const y1 = Math.min(nMax, y0 + 1);
    const ty = gy - y0;

    for (let px = 0; px < res; px++) {
      const gx = (px / (res - 1)) * nMax;
      const x0 = Math.floor(gx);
      const x1 = Math.min(nMax, x0 + 1);
      const tx = gx - x0;

      const h00 = height[y0 * n + x0];
      const h10 = height[y0 * n + x1];
      const h01 = height[y1 * n + x0];
      const h11 = height[y1 * n + x1];

      const h0 = h00 * (1 - tx) + h10 * tx;
      const h1 = h01 * (1 - tx) + h11 * tx;
      const h = h0 * (1 - ty) + h1 * ty;

      // Keep the height contribution subtle; it is blended at ~20% later.
      const v = clamp01(Math.pow(h, 0.7) * strengthScale);
      const g = Math.floor(v * 255);

      const idx = (py * res + px) * 4;
      img.data[idx] = g;
      img.data[idx + 1] = g;
      img.data[idx + 2] = g;
      img.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

function generateHoloAreaMaskTexture(pattern: HoloPatternType, res = 256): THREE.CanvasTexture {
  // Mask is in thickness-space (UV), and is sampled separately from the drifting thickness texture,
  // so the holo region stays anchored to the card art window.
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;

  const img = ctx.getImageData(0, 0, res, res);

  // Empirical “art window” in front texture UV space.
  // Use the same geometry as the original `standard`/`reverse` generation
  // so the mask aligns with where the card art actually is.
  const artX = 0.1;
  const artY = 0.08;
  const artW = 0.8;
  const artH = 0.52;
  const edge = 0.025; // soft boundary width (normalized UV)

  const smoothstep = (a: number, b: number, t: number) => {
    if (a === b) return t < a ? 0 : 1;
    const x = clamp01((t - a) / (b - a));
    return x * x * (3 - 2 * x);
  };

  const insideRect = (u: number, v: number) => {
    const sx = smoothstep(artX, artX + edge, u) * (1 - smoothstep(artX + artW - edge, artX + artW, u));
    const sy = smoothstep(artY, artY + edge, v) * (1 - smoothstep(artY + artH - edge, artY + artH, v));
    return sx * sy;
  };

  const maskPattern = pattern === 'none' ? 'standard' : pattern;

  for (let py = 0; py < res; py++) {
    const v = py / (res - 1);
    for (let px = 0; px < res; px++) {
      const u = px / (res - 1);
      const inside = insideRect(u, v);

      let w: number;
      switch (maskPattern) {
        case 'full_art':
          w = 1;
          break;
        case 'reverse':
          w = 1 - inside;
          break;
        case 'cracked_ice':
          // Slight spill outside the art window.
          w = 0.15 + inside * 0.85; // lower spill so cardboard stays subtle
          break;
        case 'standard':
        case 'cosmos':
        case 'galaxy':
        case 'swirl':
        default:
          w = inside;
          break;
      }

      const g = Math.floor(clamp01(w) * 255);
      const idx = (py * res + px) * 4;
      img.data[idx] = g;
      img.data[idx + 1] = g;
      img.data[idx + 2] = g;
      img.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function computeAlphaBboxFromImage(image: HTMLImageElement, alphaThreshold = 10, downsampleRes = 64) {
  // Returns bbox in normalized UV coordinates where:
  // - x,y are in [0,1]
  // - y is in "canvas-down" space (0 = top, 1 = bottom), matching how we build masks today.
  const canvas = document.createElement('canvas');
  canvas.width = downsampleRes;
  canvas.height = downsampleRes;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, downsampleRes, downsampleRes);
  const imgData = ctx.getImageData(0, 0, downsampleRes, downsampleRes).data;

  let minX = downsampleRes, minY = downsampleRes;
  let maxX = -1, maxY = -1;

  for (let y = 0; y < downsampleRes; y++) {
    for (let x = 0; x < downsampleRes; x++) {
      const a = imgData[(y * downsampleRes + x) * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x0: 0, y0: 0, x1: 1, y1: 1, valid: false };
  }

  // Convert to half-open ranges so empty rows at the boundary don't collapse repeat.
  const x0 = minX / downsampleRes;
  const x1 = (maxX + 1) / downsampleRes;
  const y0 = minY / downsampleRes;
  const y1 = (maxY + 1) / downsampleRes;
  return { x0, y0, x1, y1, valid: true };
}

function applyAlphaBboxToTexture(
  tex: THREE.Texture,
  bboxCanvasDown: { x0: number; y0: number; x1: number; y1: number; valid: boolean }
) {
  if (!bboxCanvasDown.valid) return;
  // three.js UV y=0 is bottom, but our bbox uses y=0 at top.
  const repeatX = bboxCanvasDown.x1 - bboxCanvasDown.x0;
  const repeatY = bboxCanvasDown.y1 - bboxCanvasDown.y0;
  const offsetX = bboxCanvasDown.x0;
  const offsetY = 1 - bboxCanvasDown.y1;

  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.offset.set(offsetX, offsetY);
}

    // NOTE: We previously baked holo masks into the thickness map, but that
    // added a full extra pixel-pass (and could introduce quantization artifacts).
    // Masking is now handled by suppressing `material.iridescence` outside the
    // intended holo area using `uHoloAreaMask`.

function blendHoloThicknessCanvases(
  proceduralTexture: THREE.CanvasTexture,
  heightCanvas: HTMLCanvasElement,
  heightMix: number
): THREE.CanvasTexture {
  const proceduralCanvas = proceduralTexture.image as HTMLCanvasElement;
  const res = proceduralCanvas.width;

  const procCtx = proceduralCanvas.getContext('2d')!;
  const procData = procCtx.getImageData(0, 0, res, res).data;

  const hCtx = heightCanvas.getContext('2d')!;
  const hData = hCtx.getImageData(0, 0, res, res).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = res;
  outCanvas.height = res;
  const outCtx = outCanvas.getContext('2d')!;
  const outImg = outCtx.createImageData(res, res);

  const mix = clamp01(heightMix);
  for (let i = 0; i < outImg.data.length; i += 4) {
    const p = procData[i] / 255;
    const h = hData[i] / 255;
    const v = clamp01(p * (1 - mix) + h * mix);
    const g = Math.floor(v * 255);
    outImg.data[i] = g;
    outImg.data[i + 1] = g;
    outImg.data[i + 2] = g;
    outImg.data[i + 3] = 255;
  }

  outCtx.putImageData(outImg, 0, 0);

  const tex = new THREE.CanvasTexture(outCanvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.08, 1.08);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const Card3DViewer: React.FC<Card3DViewerProps> = ({
  frontTexture,
  backTexture,
  heightGridJson,
  normalStrength = 1.1,
  // Smaller physical depth => fewer "extra box" sides visible.
  // Reduce further to keep the card closer to “paper/cardboard” (less glassy sides).
  thickness = 0.00675,
  width = 1,
  heightWorld = 1.397, // approx for 63/88 ratio
  className,
  isHolographic = false,
  holoPattern: holoPatternProp = 'none',
  year = null,
  cardSet = null,
  foilPreset: foilPresetProp,
  showLightingControls = false,
  showAdminCameraControls = false,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const resizeFnRef = useRef<null | (() => void)>(null);

  type AdminCamPose = {
    fov: number;
    posX: number;
    posY: number;
    posZ: number;
    targetX: number;
    targetY: number;
    targetZ: number;
  };

  const initialAdminCamPose: AdminCamPose = {
    fov: 35,
    posX: 0,
    posY: 0.25,
    posZ: 2.2,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  };

  const [adminCamOpen, setAdminCamOpen] = useState(false);
  const adminCamOpenRef = useRef(false);
  const [adminCamSnapshot, setAdminCamSnapshot] = useState<AdminCamPose>(initialAdminCamPose);
  const [adminCamDraft, setAdminCamDraft] = useState<AdminCamPose>(initialAdminCamPose);
  const adminCamDraftDirtyRef = useRef(false);
  const adminCamPoseRef = useRef<AdminCamPose>(initialAdminCamPose);
  const adminCamForceFitRef = useRef(false);
  const applyAdminCamPoseRef = useRef<null | ((pose: AdminCamPose) => void)>(null);

  useEffect(() => {
    adminCamOpenRef.current = adminCamOpen;
    if (!adminCamDraftDirtyRef.current && adminCamOpen) {
      setAdminCamDraft(adminCamSnapshot);
    }
    if (!adminCamDraftDirtyRef.current) {
      adminCamPoseRef.current = adminCamSnapshot;
    }
  }, [adminCamOpen, adminCamSnapshot]);

  // Lighting controls (shared + vault views). We keep these as local UI state
  // and drive the scene lights via a ref so the three.js scene doesn't need to re-mount.
  const [panelOpen, setPanelOpen] = useState(false);
  const [lightAngleDeg, setLightAngleDeg] = useState(35);
  // Default lighting was a bit too bright for previews.
  const [lightBrightness, setLightBrightness] = useState(0.60);
  const lightingRef = useRef({ lightAngleDeg: 35, lightBrightness: 0.60 });

  useEffect(() => {
    lightingRef.current.lightAngleDeg = lightAngleDeg;
    lightingRef.current.lightBrightness = lightBrightness;
  }, [lightAngleDeg, lightBrightness]);

  const parsedHeightGrid = useMemo(() => parseHeightGrid(heightGridJson), [heightGridJson]);
  const normalMap = useMemo(() => {
    if (!parsedHeightGrid) return null;
    return heightGridToNormalMap(parsedHeightGrid, normalStrength);
  }, [parsedHeightGrid, normalStrength]);

  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;
    container.innerHTML = '';

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    renderer.physicallyCorrectLights = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Start with slightly lower exposure so previews don't blow out highlights.
    renderer.toneMappingExposure = 1.0;

    const scene = new THREE.Scene();
    const envScene = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = envMap;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0, 0.25, 2.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    const initialEnableRotate = controls.enableRotate;
    // Freeze initial framing so the camera doesn't drift/crop on mobile
    // before the user interacts.
    controls.enabled = false;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.6;
    controls.minDistance = 1.4;
    controls.maxDistance = 3.6;

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x050509, 0.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    scene.add(keyLight);
    scene.add(fillLight);
    scene.add(rimLight);

    const updateLights = () => {
      const { lightAngleDeg, lightBrightness } = lightingRef.current;
      const rad = (lightAngleDeg * Math.PI) / 180;

      // Neutral, bright lighting (reduces "purple hotspot" artifacts).
      keyLight.intensity = 1.0 * lightBrightness;
      fillLight.intensity = 0.55 * lightBrightness;
      rimLight.intensity = 0.28 * lightBrightness;
      hemiLight.intensity = 0.65 * lightBrightness;

      keyLight.position.set(Math.cos(rad) * 2.1, 1.25, Math.sin(rad) * 2.1);
      fillLight.position.set(-Math.cos(rad) * 1.6, 0.85, -Math.sin(rad) * 1.6);
      rimLight.position.set(Math.cos(rad) * 2.1, -0.75, Math.sin(rad) * 2.1);
    };

    updateLights();

    // Textures
    const loader = new THREE.TextureLoader();
    // Tight UV crop using PNG alpha so the visible card area fills the 3D surface.
    // Also keep holo-area masking aligned to the same crop.
    const tightAlphaThreshold = 20;
    const tightDownsampleRes = 80;
    let frontAlphaBbox: ReturnType<typeof computeAlphaBboxFromImage> | null = null;
    let backAlphaBbox: ReturnType<typeof computeAlphaBboxFromImage> | null = null;
    let holoAreaMaskTexForCrop: THREE.CanvasTexture | null = null;

    const sharedPadPx = 2; // small outward padding to hide a hard bbox line
    const sharedPadUV = sharedPadPx / tightDownsampleRes;

    const applySharedCropIfReady = () => {
      if (!frontAlphaBbox?.valid || !backAlphaBbox?.valid) return;
      if (!frontTex || !backTex) return;

      // Union bbox in the same "downsample/canvas-top=0" coordinate system.
      const x0 = Math.max(0, Math.min(frontAlphaBbox.x0, backAlphaBbox.x0) - sharedPadUV);
      const y0 = Math.max(0, Math.min(frontAlphaBbox.y0, backAlphaBbox.y0) - sharedPadUV);
      const x1 = Math.min(1, Math.max(frontAlphaBbox.x1, backAlphaBbox.x1) + sharedPadUV);
      const y1 = Math.min(1, Math.max(frontAlphaBbox.y1, backAlphaBbox.y1) + sharedPadUV);

      if (x1 <= x0 || y1 <= y0) return;

      const shared = { x0, y0, x1, y1, valid: true as const };

      applyAlphaBboxToTexture(frontTex, shared);
      applyAlphaBboxToTexture(backTex, shared);
      if (holoAreaMaskTexForCrop) applyAlphaBboxToTexture(holoAreaMaskTexForCrop, shared);
    };

    let frontTex = loader.load(frontTexture, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      const bbox = computeAlphaBboxFromImage(t.image as HTMLImageElement, tightAlphaThreshold, tightDownsampleRes);
      frontAlphaBbox = bbox;
      applySharedCropIfReady();
    });

    let backTex = loader.load(backTexture, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      const bbox = computeAlphaBboxFromImage(t.image as HTMLImageElement, tightAlphaThreshold, tightDownsampleRes);
      backAlphaBbox = bbox;
      applySharedCropIfReady();
    });
    // IMPORTANT: do NOT set `needsUpdate=true` until the image is actually loaded.
    // Setting it early triggers: "Texture marked for update but no image data found".

    // Materials: front/back share the same normal map so the “bump” feels continuous
    const baseParams = {
      roughness: 0.85,
      metalness: 0.0,
      normalMap: normalMap ?? undefined,
    } as const;

    const presetIdx = foilPresetProp ?? resolveFoilPreset(year, cardSet);
    const fp = FOIL_PRESETS[presetIdx % FOIL_PRESETS.length];

    const resolvedHoloPattern = normalizeHoloPattern(holoPatternProp);
    const effectivePattern: HoloPatternType = resolvedHoloPattern === 'none' ? 'standard' : resolvedHoloPattern;

    const HOLO_RES = 256;
    const HEIGHT_MIX = 0.2; // conservative 80/20 procedural/height

    // Fixed holo-area mask in UV space (used to bake into the thickness map).
    const holoAreaMaskTex = isHolographic ? generateHoloAreaMaskTexture(effectivePattern, HOLO_RES) : null;
    holoAreaMaskTexForCrop = holoAreaMaskTex;

    // Procedural + height-blended thickness map (drifts with light for gentle shimmer motion).
    let holoThicknessMap: THREE.CanvasTexture | null = null;
    let proceduralThicknessTex: THREE.CanvasTexture | null = null;

    if (isHolographic) {
      proceduralThicknessTex = generateHoloThicknessMap(effectivePattern, HOLO_RES);
      if (proceduralThicknessTex) {
        if (parsedHeightGrid) {
          const heightCanvas = heightGridToHoloThicknessCanvas(parsedHeightGrid, HOLO_RES, normalStrength);
          holoThicknessMap = blendHoloThicknessCanvases(proceduralThicknessTex, heightCanvas, HEIGHT_MIX);
          // proceduralThicknessTex is no longer used after blending
          proceduralThicknessTex.dispose();
          proceduralThicknessTex = null;
        } else {
          holoThicknessMap = proceduralThicknessTex;
          proceduralThicknessTex = null;
        }
      }
    }

    // Conservative physical iridescence tweaks per chosen foil type (keeps year/card_set as base).
    let ior = fp.ior;
    let rough = fp.rough;
    let metal = fp.metal;
    let thickMin = fp.thick[0];
    let thickMax = fp.thick[1];

    switch (effectivePattern) {
      case 'cosmos':
        ior += 0.03;
        rough -= 0.04;
        metal += 0.03;
        thickMin *= 1.04;
        thickMax *= 1.03;
        break;
      case 'galaxy':
        ior += 0.02;
        rough -= 0.07;
        metal += 0.06;
        thickMin *= 1.07;
        thickMax *= 1.05;
        break;
      case 'swirl':
        ior += 0.015;
        rough -= 0.06;
        metal += 0.055;
        thickMin *= 1.05;
        thickMax *= 1.08;
        break;
      case 'cracked_ice':
        ior -= 0.01;
        rough += 0.05;
        metal -= 0.01;
        thickMin *= 0.98;
        thickMax *= 0.97;
        break;
      case 'reverse':
        rough += 0.02;
        metal += 0.01;
        thickMin *= 0.99;
        thickMax *= 1.01;
        break;
      case 'full_art':
        rough -= 0.02;
        metal += 0.015;
        ior += 0.015;
        thickMin *= 1.03;
        thickMax *= 1.02;
        break;
      case 'standard':
      default:
        break;
    }

    // Clamp to avoid "weird looking" outliers.
    ior = Math.max(1.18, Math.min(1.6, ior));
    rough = Math.max(0.12, Math.min(0.55, rough));
    metal = Math.max(0.0, Math.min(0.25, metal));
    thickMin = Math.max(60, Math.min(260, thickMin));
    thickMax = Math.max(thickMin + 1, Math.min(950, thickMax));

    const iridescenceAmount = Math.max(0.65, Math.min(1, 0.7 + metal * 1.8));

    const frontMat = isHolographic
      ? new THREE.MeshPhysicalMaterial({
          map: frontTex,
          normalMap: normalMap ?? undefined,
          roughness: rough,
          metalness: metal,
          transparent: true,
          alphaTest: 0.06,
          iridescence: iridescenceAmount,
          iridescenceIOR: ior,
          iridescenceThicknessRange: [thickMin, thickMax],
          ...(holoThicknessMap ? { iridescenceThicknessMap: holoThicknessMap } : {}),
          // Tame top-layer glare to avoid "card sleeve" look.
          clearcoat: 0.55,
          clearcoatRoughness: Math.max(0.12, rough * 0.75),
        })
      : new THREE.MeshStandardMaterial({ map: frontTex, ...baseParams, transparent: true, alphaTest: 0.06 });

    // Suppress iridescence outside the holo area.
    // We bake the mask into the thickness texture (stable boundaries), but `iridescenceThicknessMinimum`
    // still contributes some iridescence even when the thickness map is low—so we multiply `material.iridescence`
    // by the same mask to keep non-holo card stock looking like subtle printed cardboard.
    if (isHolographic && holoAreaMaskTex && holoThicknessMap) {
      (frontMat as THREE.MeshPhysicalMaterial).onBeforeCompile = (shader: any) => {
        shader.uniforms.uHoloAreaMask = { value: holoAreaMaskTex };

        const maskDecl = 'uniform sampler2D uHoloAreaMask;';
        const hasThicknessUv = shader.fragmentShader.includes('vIridescenceThicknessMapUv');
        const uvVar = hasThicknessUv ? 'vIridescenceThicknessMapUv' : 'vUv';

        if (!shader.fragmentShader.includes(maskDecl)) {
          if (shader.fragmentShader.includes('uniform sampler2D iridescenceThicknessMap;')) {
            shader.fragmentShader = shader.fragmentShader.replace(
              'uniform sampler2D iridescenceThicknessMap;',
              `uniform sampler2D iridescenceThicknessMap;\n${maskDecl}`
            );
          } else {
            shader.fragmentShader = shader.fragmentShader.replace(
              'uniform sampler2D iridescenceMap;',
              `uniform sampler2D iridescenceMap;\n${maskDecl}`
            );
          }
        }

        const irLine = 'material.iridescence = iridescence;';
        const irReplacement = `material.iridescence = iridescence * texture2D( uHoloAreaMask, ${uvVar} ).g;`;
        if (shader.fragmentShader.includes(irLine)) {
          shader.fragmentShader = shader.fragmentShader.replace(irLine, irReplacement);
        }
      };
    }
    const backMat = new THREE.MeshStandardMaterial({
      map: backTex,
      ...baseParams,
      transparent: true,
      alphaTest: 0.06,
    });
    const sideMat = new THREE.MeshStandardMaterial({
      // Card edges should read as paper/cardboard (white-ish).
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
    });

    // BoxGeometry faces: [px, nx, py, ny, pz, nz] => z+
    // Front is z+, back is z-
    const geometry = new THREE.BoxGeometry(width, heightWorld, thickness);
    const materials: THREE.Material[] = [
      sideMat,
      sideMat,
      sideMat,
      sideMat,
      frontMat, // z+
      backMat, // z-
    ];

    const cardMesh = new THREE.Mesh(geometry, materials);
    scene.add(cardMesh);

    const syncAdminCamPose = () => {
      const snapshot: AdminCamPose = {
        fov: camera.fov,
        posX: camera.position.x,
        posY: camera.position.y,
        posZ: camera.position.z,
        targetX: controls.target.x,
        targetY: controls.target.y,
        targetZ: controls.target.z,
      };

      setAdminCamSnapshot(snapshot);
      adminCamPoseRef.current = snapshot;

      // Only overwrite the editable draft if the user isn't currently editing.
      if (adminCamOpenRef.current && !adminCamDraftDirtyRef.current) {
        setAdminCamDraft(snapshot);
      }
    };

    const applyAdminCamPose = (pose: AdminCamPose) => {
      camera.fov = pose.fov;
      camera.position.set(pose.posX, pose.posY, pose.posZ);
      controls.target.set(pose.targetX, pose.targetY, pose.targetZ);

      camera.lookAt(controls.target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();

      // Sync OrbitControls internal state after manual pose changes.
      const prevEnabled = controls.enabled;
      controls.enabled = true;
      controls.update();
      controls.enabled = prevEnabled;

      syncAdminCamPose();
    };

    if (showAdminCameraControls) {
      applyAdminCamPoseRef.current = applyAdminCamPose;
      controls.addEventListener('change', syncAdminCamPose);
    } else {
      applyAdminCamPoseRef.current = null;
    }

    // Enable controls only after first user interaction.
    const enableControlsOnce = () => {
      controls.enabled = true;
    };
    renderer.domElement.addEventListener('pointerdown', enableControlsOnce, { once: true });

    // Basic resizing
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(200, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));
      renderer.setSize(w, h);

      camera.fov = 33.5;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      // If the admin camera panel is open, do not overwrite the admin pose
      // with deterministic "fit" math during resize events.
      if (showAdminCameraControls && adminCamOpenRef.current && !adminCamForceFitRef.current) {
        const pose = adminCamPoseRef.current;

        camera.fov = pose.fov;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();

        controls.target.set(pose.targetX, pose.targetY, pose.targetZ);
        camera.position.set(pose.posX, pose.posY, pose.posZ);
        camera.lookAt(controls.target);
        camera.updateMatrixWorld();

        const dist = Math.hypot(
          pose.posX - pose.targetX,
          pose.posY - pose.targetY,
          pose.posZ - pose.targetZ
        );
        controls.minDistance = dist * 0.25;
        controls.maxDistance = dist * 3.5;

        syncAdminCamPose();
        return;
      }

      // AABB fit: compute camera distance so the card fits in both vertical & horizontal FOV.
      const vHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const tanV = Math.tan(vHalfFov) || 0.0001;
      const aspect = camera.aspect || 1;
      const tanH = tanV * aspect; // tan(horizontalFov/2)

      const halfH = heightWorld / 2;
      const halfW = width / 2;

      const distV = halfH / tanV;
      const distH = halfW / (tanH || 0.0001);
      let dist = Math.max(distV, distH);

      dist *= 1.06;

      controls.target.set(0, 0, 0);
      controls.minDistance = dist * 0.84;
      controls.maxDistance = dist * 2.7;

      camera.position.set(0, 0, dist);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      if (showAdminCameraControls) syncAdminCamPose();
    };

    const ro = new ResizeObserver(() => resize());
    ro.observe(container);
    resize();
    resizeFnRef.current = resize;
    container.appendChild(renderer.domElement);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const adminMode = showAdminCameraControls && adminCamOpenRef.current;
      // Admin-only: allow two-finger drag panning to move the card side-to-side.
      // Normal viewers keep pan disabled.
      controls.enablePan = adminMode;
      // Prevent one-finger rotation while admin is in "position tuning" mode.
      controls.enableRotate = adminMode ? false : initialEnableRotate;
      if (controls.enabled) controls.update();
      updateLights();
      const { lightBrightness } = lightingRef.current;
      const lightRad = (lightingRef.current.lightAngleDeg * Math.PI) / 180;
      if (holoThicknessMap && isHolographic) {
        // Drift foil map with light direction so rainbow streaks gently travel.
        const driftFactor =
          resolvedHoloPattern === 'standard' || resolvedHoloPattern === 'cosmos' || resolvedHoloPattern === 'galaxy' || resolvedHoloPattern === 'swirl'
            ? 0.0
            : resolvedHoloPattern === 'cracked_ice'
              ? 0.22
              : 0.10;

        // We bake the holo-area mask into the thickness texture, so keep drift extremely gentle
        // (otherwise the boundary visually slides).
        const speed = 0.00023 * lightBrightness * driftFactor;

        const mod1 = (v: number) => ((v % 1) + 1) % 1;
        holoThicknessMap.offset.x = mod1(holoThicknessMap.offset.x + Math.cos(lightRad) * speed);
        holoThicknessMap.offset.y = mod1(holoThicknessMap.offset.y + Math.sin(lightRad) * speed * 0.55);
        holoThicknessMap.needsUpdate = true;
      }
      // Keep reflections aligned with user lighting brightness.
      (frontMat as any).envMapIntensity = (isHolographic ? 0.72 : 1.0) * lightBrightness;
      (backMat as any).envMapIntensity = 1.0 * lightBrightness;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (showAdminCameraControls) {
        controls.removeEventListener('change', syncAdminCamPose);
        applyAdminCamPoseRef.current = null;
      }
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', enableControlsOnce);
      renderer.dispose();
      geometry.dispose();
      frontMat.dispose();
      backMat.dispose();
      sideMat.dispose();
      if (normalMap) normalMap.dispose();
      if (holoThicknessMap) holoThicknessMap.dispose();
      if (holoAreaMaskTex) holoAreaMaskTex.dispose();
      frontTex.dispose();
      backTex.dispose();
      if (envMap) envMap.dispose();
      envScene.dispose();
      pmrem.dispose();
      container.innerHTML = '';
    };
  }, [frontTexture, backTexture, normalMap, width, heightWorld, thickness, isHolographic, holoPatternProp, year, cardSet, foilPresetProp, showAdminCameraControls]);

  const adminCamDistance = Math.hypot(
    adminCamDraft.posX - adminCamDraft.targetX,
    adminCamDraft.posY - adminCamDraft.targetY,
    adminCamDraft.posZ - adminCamDraft.targetZ
  );

  const copyAdminCamJson = async () => {
    const payload = {
      fov: adminCamDraft.fov,
      position: { x: adminCamDraft.posX, y: adminCamDraft.posY, z: adminCamDraft.posZ },
      target: { x: adminCamDraft.targetX, y: adminCamDraft.targetY, z: adminCamDraft.targetZ },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // ignore clipboard failures
    }
  };

  return (
    <div
      className={`relative ${className ?? ''}`.trim()}
      style={{
        width: '100%',
        aspectRatio: `${width} / ${heightWorld}`,
        borderRadius: '12px',
        background: 'rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}
    >
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {showLightingControls && (
        <div className="absolute top-2 left-2 right-2 pointer-events-none z-[5]">
          <div className="pointer-events-auto bg-black/35 border border-white/10 rounded-lg p-2 z-[6]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/70">Lighting</div>
              <button
                type="button"
                onClick={() => setPanelOpen(v => !v)}
                className="text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white"
              >
                {panelOpen ? 'Hide' : 'Show'}
              </button>
            </div>

            {panelOpen && (
              <div className="mt-2 space-y-2">
                <div>
                  <div className="flex justify-between items-center">
                    <div className="text-[10px] text-white/60 font-bold uppercase tracking-widest">Brightness</div>
                    <div className="text-[10px] text-[#D4AF37] font-bold">{lightBrightness.toFixed(2)}x</div>
                  </div>
                  <input
                    type="range"
                    min={0.6}
                    max={2.0}
                    step={0.05}
                    value={lightBrightness}
                    onChange={(e) => setLightBrightness(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center">
                    <div className="text-[10px] text-white/60 font-bold uppercase tracking-widest">Angle</div>
                    <div className="text-[10px] text-[#D4AF37] font-bold">{lightAngleDeg}°</div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={lightAngleDeg}
                    onChange={(e) => setLightAngleDeg(parseInt(e.target.value, 10))}
                    className="w-full"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showAdminCameraControls && (
        <div className="absolute top-2 right-2 pointer-events-none z-[7]">
          <div className="pointer-events-auto bg-black/35 border border-white/10 rounded-lg p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/70">Camera (Admin)</div>
              <button
                type="button"
                onClick={() => setAdminCamOpen(v => !v)}
                className="text-[10px] font-black uppercase tracking-widest text-white/70 hover:text-white"
                aria-label="Toggle admin camera panel"
              >
                <i className={`fas ${adminCamOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
              </button>
            </div>

            {adminCamOpen && (
              <div className="mt-2 space-y-2">
                <div className="text-[10px] text-white/60">
                  Distance: <span className="text-white font-bold">{adminCamDistance.toFixed(3)}</span>
                  {' '}
                  FOV: <span className="text-white font-bold">{adminCamSnapshot.fov.toFixed(1)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-white/60 font-bold uppercase tracking-widest">
                    FOV
                    <input
                      type="number"
                      step={0.1}
                      value={adminCamDraft.fov}
                      onChange={(e) => {
                        adminCamDraftDirtyRef.current = true;
                        const v = parseFloat(e.target.value);
                        setAdminCamDraft(d => ({ ...d, fov: Number.isFinite(v) ? v : d.fov }));
                      }}
                      className="mt-1 w-full bg-white/5 border border-white/10 text-white px-2 py-1 rounded"
                    />
                  </label>

                  <div className="text-[10px] text-white/60 font-bold uppercase tracking-widest leading-tight">
                    Pos / Target
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <div className="text-[10px] text-white/60 w-[22px]">P</div>
                    <input
                      type="number"
                      step={0.01}
                      value={adminCamDraft.posX}
                      onChange={(e) => {
                        adminCamDraftDirtyRef.current = true;
                        const v = parseFloat(e.target.value);
                        setAdminCamDraft(d => ({ ...d, posX: Number.isFinite(v) ? v : d.posX }));
                      }}
                      className="w-20 bg-white/5 border border-white/10 text-white px-2 py-1 rounded"
                    />
                    <input
                      type="number"
                      step={0.01}
                      value={adminCamDraft.posY}
                      onChange={(e) => {
                        adminCamDraftDirtyRef.current = true;
                        const v = parseFloat(e.target.value);
                        setAdminCamDraft(d => ({ ...d, posY: Number.isFinite(v) ? v : d.posY }));
                      }}
                      className="w-20 bg-white/5 border border-white/10 text-white px-2 py-1 rounded"
                    />
                    <input
                      type="number"
                      step={0.01}
                      value={adminCamDraft.posZ}
                      onChange={(e) => {
                        adminCamDraftDirtyRef.current = true;
                        const v = parseFloat(e.target.value);
                        setAdminCamDraft(d => ({ ...d, posZ: Number.isFinite(v) ? v : d.posZ }));
                      }}
                      className="w-20 bg-white/5 border border-white/10 text-white px-2 py-1 rounded"
                    />
                  </div>

                  <div className="flex items-center gap-1">
                    <div className="text-[10px] text-white/60 w-[22px]">T</div>
                    <input
                      type="number"
                      step={0.01}
                      value={adminCamDraft.targetX}
                      onChange={(e) => {
                        adminCamDraftDirtyRef.current = true;
                        const v = parseFloat(e.target.value);
                        setAdminCamDraft(d => ({ ...d, targetX: Number.isFinite(v) ? v : d.targetX }));
                      }}
                      className="w-20 bg-white/5 border border-white/10 text-white px-2 py-1 rounded"
                    />
                    <input
                      type="number"
                      step={0.01}
                      value={adminCamDraft.targetY}
                      onChange={(e) => {
                        adminCamDraftDirtyRef.current = true;
                        const v = parseFloat(e.target.value);
                        setAdminCamDraft(d => ({ ...d, targetY: Number.isFinite(v) ? v : d.targetY }));
                      }}
                      className="w-20 bg-white/5 border border-white/10 text-white px-2 py-1 rounded"
                    />
                    <input
                      type="number"
                      step={0.01}
                      value={adminCamDraft.targetZ}
                      onChange={(e) => {
                        adminCamDraftDirtyRef.current = true;
                        const v = parseFloat(e.target.value);
                        setAdminCamDraft(d => ({ ...d, targetZ: Number.isFinite(v) ? v : d.targetZ }));
                      }}
                      className="w-20 bg-white/5 border border-white/10 text-white px-2 py-1 rounded"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdminCamDraft(adminCamSnapshot);
                      adminCamDraftDirtyRef.current = false;
                    }}
                    className="flex-1 text-[10px] font-black uppercase tracking-widest bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded px-2 py-2"
                  >
                    Sync
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      adminCamForceFitRef.current = true;
                      resizeFnRef.current?.();
                      adminCamForceFitRef.current = false;
                      adminCamDraftDirtyRef.current = false;
                    }}
                    className="flex-1 text-[10px] font-black uppercase tracking-widest bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded px-2 py-2"
                  >
                    Fit
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      applyAdminCamPoseRef.current?.(adminCamDraft);
                      adminCamDraftDirtyRef.current = false;
                    }}
                    className="flex-1 text-[10px] font-black uppercase tracking-widest bg-[#D4AF37]/15 hover:bg-[#D4AF37]/25 border border-[#D4AF37]/25 text-[#D4AF37] rounded px-2 py-2"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => { void copyAdminCamJson(); }}
                    className="flex-1 text-[10px] font-black uppercase tracking-widest bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded px-2 py-2"
                  >
                    Copy JSON
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Card3DViewer;

