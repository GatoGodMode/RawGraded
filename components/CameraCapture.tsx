import React, { useRef, useState, useEffect, useCallback } from 'react';
import { CaptureMetadata } from '../types';
import {
  CAMERA_SHELL,
  CAMERA_VIEWPORT,
  CAMERA_VIDEO,
  CAMERA_BOTTOM_BAR,
  useDoubleTapCapture,
  MobileCaptureShutter,
  FlipCameraButton,
} from './camera/mobileCameraShared';

interface CameraCaptureProps {
  onCapture: (imageData: string, metadata: CaptureMetadata) => void;
  onClose: () => void;
  side: 'front' | 'back';
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onClose, side }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [camBusy, setCamBusy] = useState(false);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number } | null>(null);
  const [flash, setFlash] = useState(false);

  const [tilt, setTilt] = useState({ beta: 0, gamma: 0 });
  const [isLevel, setIsLevel] = useState(false);

  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tiltRef = useRef({ beta: 0, gamma: 0 });
  const vidAreaRef = useRef<HTMLDivElement>(null);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const beta = event.beta || 0;
    const gamma = event.gamma || 0;
    tiltRef.current = { beta, gamma };
    setTilt({ beta, gamma });
    const threshold = 3;
    setIsLevel(Math.abs(beta) < threshold && Math.abs(gamma) < threshold);
  }, []);

  const requestOrientation = useCallback(() => {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission ===
        'function'
    ) {
      (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> })
        .requestPermission()
        .then((state: string) => {
          if (state === 'granted') window.addEventListener('deviceorientation', handleOrientation);
        })
        .catch(() => {});
    } else {
      try {
        window.addEventListener('deviceorientation', handleOrientation);
      } catch {
        /* ignore */
      }
    }
  }, [handleOrientation]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async (mode: 'user' | 'environment') => {
    setCamBusy(true);
    stopCamera();
    setError('');
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: unknown) {
      const name = err instanceof Error ? (err as DOMException).name : '';
      if (name === 'NotAllowedError') {
        setError('Camera permission denied.');
      } else if (name === 'NotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError('Could not access camera: ' + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setCamBusy(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    void startCamera(facingMode);
    requestOrientation();
    return () => {
      stopCamera();
      try {
        window.removeEventListener('deviceorientation', handleOrientation);
      } catch {
        /* ignore */
      }
    };
  }, [facingMode, startCamera, requestOrientation, stopCamera, handleOrientation]);

  const takePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 1.0);
    onCapture(dataUrl, { tiltBeta: tiltRef.current.beta, tiltGamma: tiltRef.current.gamma });
    stopCamera();
  }, [onCapture, stopCamera]);

  const handleCapture = useCallback(() => {
    if (camBusy || error) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    setTimeout(() => takePhoto(), 160);
  }, [takePhoto, camBusy, error]);

  const triggerFocus = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track?.applyConstraints) {
      try {
        (track.applyConstraints as (c: MediaTrackConstraints) => Promise<void>)({
          advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
        });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const { onPointerDown: onVidPointerDown } = useDoubleTapCapture({
    disabled: !!error || camBusy,
    onDoubleTap: handleCapture,
    onSingleTap: (clientX, clientY) => {
      const rect = vidAreaRef.current?.getBoundingClientRect();
      if (rect) {
        setFocusRing({ x: clientX - rect.left, y: clientY - rect.top });
        setTimeout(() => setFocusRing(null), 500);
      }
      triggerFocus();
    },
  });

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'VolumeUp' || e.code === 'VolumeUp' || e.keyCode === 175) {
        e.preventDefault();
        handleCapture();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleCapture]);

  const shutterRing = isLevel ? 'border-green-400 shadow-[0_0_16px_rgba(74,222,128,0.5)]' : 'border-white';

  const videoArea = (
    <div ref={vidAreaRef} className={CAMERA_VIEWPORT} onPointerDown={onVidPointerDown}>
      <video ref={videoRef} autoPlay playsInline muted className={CAMERA_VIDEO} />

      {camBusy && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="w-10 h-10 border-2 border-poke-gold border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      <div
        className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-100 z-30 ${flash ? 'opacity-60' : 'opacity-0'}`}
      />

      {focusRing && (
        <div
          className="absolute w-16 h-16 border-2 border-poke-gold rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30 animate-[focusRing_0.5s_ease-out_forwards]"
          style={{ left: focusRing.x, top: focusRing.y }}
        />
      )}

      <div className="absolute inset-0 pointer-events-none z-20">
        <div className="w-full h-full relative">
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-20">
            <div
              className={`w-32 h-8 rounded-full border-2 bg-black/40 backdrop-blur flex items-center relative overflow-hidden transition-colors ${isLevel ? 'border-green-400' : 'border-white/50'}`}
            >
              <div className="absolute left-1/2 top-0 bottom-0 w-8 -translate-x-1/2 bg-white/10 border-l border-r border-white/30" />
              <div
                className={`absolute top-1 bottom-1 w-6 rounded-full transition-all duration-200 ${isLevel ? 'bg-green-400' : 'bg-poke-accent'}`}
                style={{
                  left: '50%',
                  transform: `translateX(calc(-50% + ${Math.max(-40, Math.min(40, tilt.gamma * 2))}px))`,
                }}
              />
            </div>
            <span className={`text-xs font-mono font-bold ${isLevel ? 'text-green-400' : 'text-white'}`}>
              {isLevel ? 'LEVEL' : 'TILTED'}
            </span>
          </div>

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[75%] max-w-[400px] aspect-[63/88]">
            <div
              className={`w-full h-full border-[3px] rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] relative overflow-hidden transition-colors duration-300 ${isLevel ? 'border-green-400' : 'border-poke-accent'}`}
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-poke-gold to-transparent opacity-70 animate-[scan_2s_ease-in-out_infinite]" />
            </div>
            <div className="absolute -bottom-10 left-0 right-0 text-center">
              <p className="text-white font-bold tracking-widest text-xs uppercase drop-shadow-md">Double-tap or shutter</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={CAMERA_SHELL}>
      <div className="shrink-0 z-50 px-4 pb-3 pt-3 rg-safe-pt bg-gradient-to-b from-black/90 to-transparent">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-white font-bold text-lg tracking-wider uppercase truncate">Scan {side}</h2>
            <p className="text-[10px] text-gray-400">Align card · double-tap to capture</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <FlipCameraButton
              facingMode={facingMode}
              disabled={camBusy}
              onFlip={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
            />
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white"
              aria-label="Close"
            >
              <i className="fas fa-times" />
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-white text-center max-w-md">
            <i className="fas fa-exclamation-triangle text-red-500 text-3xl mb-4" />
            <h3 className="text-xl font-bold mb-2">Camera Error</h3>
            <p className="text-gray-400 mb-6 text-sm">{error}</p>
            <button type="button" onClick={onClose} className="px-6 py-2 bg-gray-800 rounded-lg">
              Close
            </button>
          </div>
        </div>
      ) : (
        videoArea
      )}

      {!error && (
        <div className={CAMERA_BOTTOM_BAR}>
          <MobileCaptureShutter
            onCapture={handleCapture}
            disabled={camBusy}
            ringClassName={shutterRing}
          />
        </div>
      )}

      <style>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes focusRing {
          0% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
        }
      `}</style>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default CameraCapture;
