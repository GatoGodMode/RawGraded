import React, { useRef, useCallback } from 'react';

/** Full-screen camera shell — fixed height so switching cameras never reflows chrome. */
export const CAMERA_SHELL =
  'fixed inset-0 z-[100] flex flex-col bg-black h-[100dvh] max-h-[100dvh] w-full overflow-hidden touch-manipulation';

export const CAMERA_VIEWPORT = 'relative flex-1 min-h-0 w-full overflow-hidden bg-black';

export const CAMERA_VIDEO = 'absolute inset-0 w-full h-full object-cover';

export const CAMERA_BOTTOM_BAR =
  'shrink-0 z-50 flex items-center justify-center px-6 pt-3 rg-safe-pb bg-gradient-to-t from-black via-black/90 to-transparent';

export function useDoubleTapCapture(options: {
  onDoubleTap: () => void;
  onSingleTap?: (clientX: number, clientY: number) => void;
  disabled?: boolean;
}) {
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (options.disabled) return;
      const now = Date.now();
      const dt = now - lastTapRef.current;
      lastTapRef.current = now;

      if (dt > 0 && dt < 320) {
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        e.preventDefault();
        options.onDoubleTap();
        return;
      }

      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        options.onSingleTap?.(e.clientX, e.clientY);
      }, 320);
    },
    [options.disabled, options.onDoubleTap, options.onSingleTap]
  );

  return { onPointerDown };
}

interface MobileCaptureShutterProps {
  onCapture: () => void;
  disabled?: boolean;
  ringClassName?: string;
  label?: string;
}

export const MobileCaptureShutter: React.FC<MobileCaptureShutterProps> = ({
  onCapture,
  disabled,
  ringClassName = 'border-white',
  label = 'Capture',
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={(e) => {
      e.stopPropagation();
      onCapture();
    }}
    onPointerDown={(e) => e.stopPropagation()}
    aria-label={label}
    className={`relative w-[72px] h-[72px] rounded-full flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40 ${disabled ? '' : ''}`}
  >
    <span className={`absolute inset-0 rounded-full border-4 ${ringClassName}`} />
    <span className="w-[58px] h-[58px] rounded-full bg-white border-2 border-white/30" />
  </button>
);

interface FlipCameraButtonProps {
  facingMode: 'user' | 'environment';
  onFlip: () => void;
  disabled?: boolean;
}

export const FlipCameraButton: React.FC<FlipCameraButtonProps> = ({ facingMode, onFlip, disabled }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={(e) => {
      e.stopPropagation();
      onFlip();
    }}
    onPointerDown={(e) => e.stopPropagation()}
    className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur flex items-center justify-center text-white disabled:opacity-40"
    aria-label="Flip camera"
  >
    <i className={`fas ${facingMode === 'environment' ? 'fa-camera-rotate' : 'fa-camera'} text-sm`} />
  </button>
);
