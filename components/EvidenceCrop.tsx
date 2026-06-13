import React, { useEffect, useRef } from 'react';

const DATA_URL_MAX = 1500000; // Browsers often fail on very long data URLs; use blob URL

function toBlobUrlIfLong(dataUrl: string): string | null {
  if (!dataUrl || dataUrl.length <= DATA_URL_MAX) return null;
  try {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    const bin = atob(m[2]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: m[1] }));
  } catch {
    return null;
  }
}

interface EvidenceCropProps {
  imageSrc: string;
  box: number[]; // [ymin, xmin, ymax, xmax] normalized 0-1
  label: string;
  /** When true, do not render the label (e.g. when label is rendered outside a scaled wrapper to avoid clipping). */
  hideLabel?: boolean;
}

const EvidenceCrop: React.FC<EvidenceCropProps> = ({ imageSrc, box, label, hideLabel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSrc || !box || box.length !== 4) return;

    const blobUrl = toBlobUrlIfLong(imageSrc);
    const src = blobUrl || imageSrc;
    if (blobUrl) blobUrlRef.current = blobUrl;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      // Decode box (ymin, xmin, ymax, xmax)
      let [ymin, xmin, ymax, xmax] = box;

      // Safety check: Detect if coordinates are in [0, 1] range instead of [0, 1000]
      // If the maximum value is <= 1.0, it's likely they are normalized 0-1
      const maxVal = Math.max(ymin, xmin, ymax, xmax);
      if (maxVal > 0 && maxVal <= 1.0) {
        ymin *= 1000;
        xmin *= 1000;
        ymax *= 1000;
        xmax *= 1000;
      }

      // Calculate pixel coordinates (Convert from [0, 1000] range to [0, 1])
      const sx = (xmin / 1000) * img.width;
      const sy = (ymin / 1000) * img.height;
      const sWidth = Math.max(10, ((xmax - xmin) / 1000) * img.width);
      const sHeight = Math.max(10, ((ymax - ymin) / 1000) * img.height);

      // Add some padding to the crop (10%)
      const paddingX = sWidth * 0.1;
      const paddingY = sHeight * 0.1;

      const finalSx = Math.max(0, sx - paddingX);
      const finalSy = Math.max(0, sy - paddingY);
      const finalSWidth = Math.min(img.width - finalSx, sWidth + paddingX * 2);
      const finalSHeight = Math.min(img.height - finalSy, sHeight + paddingY * 2);

      // Set canvas size (square aspect ratio for UI consistency)
      canvas.width = 300;
      canvas.height = 300;

      // Clear (Set to dark gray to distinguish from actual black image data)
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (finalSWidth <= 0 || finalSHeight <= 0 || img.width === 0 || img.height === 0) {
        console.warn("EvidenceCrop: Invalid dimensions", { finalSWidth, finalSHeight, imgW: img.width, imgH: img.height });
        return;
      }

      // Draw Crop
      // We want to fit the crop into the 300x300 canvas while maintaining aspect ratio
      const scale = Math.min(canvas.width / finalSWidth, canvas.height / finalSHeight);
      const drawWidth = finalSWidth * scale;
      const drawHeight = finalSHeight * scale;
      const dx = (canvas.width - drawWidth) / 2;
      const dy = (canvas.height - drawHeight) / 2;

      ctx.drawImage(img, finalSx, finalSy, finalSWidth, finalSHeight, dx, dy, drawWidth, drawHeight);

      // Draw bounding box on the crop to highlight the specific area
      ctx.strokeStyle = '#ef4444'; // Red-500
      ctx.lineWidth = 4;
      // Re-map the box relative to our crop
      // The box within the crop is at (paddingX, paddingY) relative to finalSx, finalSy
      // scaled by `scale` and offset by dx, dy
      const boxX = dx + (sx - finalSx) * scale;
      const boxY = dy + (sy - finalSy) * scale;
      const boxW = sWidth * scale;
      const boxH = sHeight * scale;

      ctx.strokeRect(boxX, boxY, boxW, boxH);
    };

    img.onerror = (err) => {
      console.error("EvidenceCrop: Image failed to load:", err);
    };

    img.src = src;

    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [imageSrc, box]);


  return (
    <div className="flex flex-col items-center">
      <div className="rounded-lg overflow-hidden border-2 border-red-500/50 shadow-lg bg-black relative group">
        <canvas ref={canvasRef} className="w-32 h-32 md:w-40 md:h-40 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-2">
          <span className="text-white text-xs font-bold uppercase tracking-wider">Close Up</span>
        </div>
      </div>
      {!hideLabel && (
        <span className="text-xs font-bold text-red-400 mt-2 uppercase tracking-wide text-center max-w-[150px] truncate">{label}</span>
      )}
    </div>
  );
};

export default EvidenceCrop;