import React, { useRef, useState, useEffect, useCallback } from 'react';

import { CaptureMetadata } from '../types';

import {

  isDesktopApp,

  listVideoInputDevices,

  pickDefaultDeviceId,

  buildDesktopVideoConstraints,

  savePreferredWebcamDeviceId,

  applyPreferredResolution,

  formatStreamResolution,

  isStreamResolutionLow,

  sortVideoDevicesForUi,
} from '../services/camera/desktopCamera';

import {

  enableContinuousAutofocus,

  prepareCaptureFocus,

  detectAutofocusStatus,

  captureStillFromStream,

  type AutofocusStatus,

} from '../services/camera/cameraFocus';

import { useCardFrameQuality } from '../services/camera/useCardFrameQuality';

import CardLiveGuideOverlay from './CardLiveGuideOverlay';

import type { CardFrameQuality } from '../services/camera/cardFrameAnalyzer';

import { isMobileApp } from '../services/platform/platformBridge';

import { buildMobileVideoConstraints } from '../services/camera/desktopCamera';

import {

  CAMERA_SHELL,

  CAMERA_VIEWPORT,

  CAMERA_VIDEO,

  CAMERA_BOTTOM_BAR,

  useDoubleTapCapture,

  MobileCaptureShutter,

  FlipCameraButton,

} from './camera/mobileCameraShared';



interface WebcamCaptureProps {

  onCapture: (imageData: string, metadata: CaptureMetadata) => void;

  onClose: () => void;

  side: 'front' | 'back';

}



const RING_COLOR: Record<CardFrameQuality['status'], string> = {

  green: 'border-green-400 shadow-[0_0_16px_rgba(74,222,128,0.6)]',

  yellow: 'border-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.5)]',

  red: 'border-red-400 shadow-[0_0_12px_rgba(248,113,113,0.5)]',

};



const AF_LABEL: Record<AutofocusStatus, string> = {

  continuous: 'AF: continuous',

  refocusing: 'AF: refocusingâ€¦',

  ready: 'AF: ready',

  unsupported: 'AF: not supported',

};



const WebcamCapture: React.FC<WebcamCaptureProps> = ({ onCapture, onClose, side }) => {

  const videoRef = useRef<HTMLVideoElement>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [error, setError] = useState('');

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const [deviceId, setDeviceId] = useState('');

  const [showDroidHelp, setShowDroidHelp] = useState(false);

  const [autoCapture, setAutoCapture] = useState(false);

  const [toast, setToast] = useState('');

  const [afStatus, setAfStatus] = useState<AutofocusStatus>('unsupported');

  const [capturing, setCapturing] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);

  const greenSinceRef = useRef<number | null>(null);

  const capturedRef = useRef(false);

  const desktop = isDesktopApp();

  const mobile = isMobileApp() || !desktop;

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  const [camBusy, setCamBusy] = useState(false);

  const [streamResolution, setStreamResolution] = useState<MediaTrackSettings | null>(null);



  const quality = useCardFrameQuality(videoRef, true, {

    mode: 'static_hold',

    side,

    type: 'card',

  });

  const qualityRef = useRef(quality);

  qualityRef.current = quality;



  const loadDevices = useCallback(async () => {
    try {
      const cams = sortVideoDevicesForUi(await listVideoInputDevices());
      setDevices(cams);
      const id = await pickDefaultDeviceId(cams);
      if (id) setDeviceId(id);
      const settings = await window.desktop?.getSettingsFull?.();
      if (settings?.autoCaptureWhenGreen) setAutoCapture(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not list cameras');
    }
  }, []);



  const stopStream = () => {

    streamRef.current?.getTracks().forEach((t) => t.stop());

    streamRef.current = null;

    setStreamResolution(null);

  };



  const startCamera = useCallback(async (id: string, facing: 'user' | 'environment' = 'environment') => {
    stopStream();
    setError('');
    setCamBusy(true);

    const deviceLabel = devices.find((d) => d.deviceId === id)?.label || '';

    try {
      const constraints = mobile
        ? buildMobileVideoConstraints(facing)
        : id
          ? buildDesktopVideoConstraints(id, deviceLabel)
          : buildDesktopVideoConstraints('');

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const track = stream.getVideoTracks()[0];
      if (track) {
        await enableContinuousAutofocus(track);
        if (!mobile) {
          const settings = await applyPreferredResolution(track, deviceLabel);
          setStreamResolution(settings);
        }
      }

      setAfStatus(detectAutofocusStatus(stream));

    } catch (err: unknown) {

      const name = err instanceof Error ? (err as DOMException).name : '';

      if (name === 'NotAllowedError') {

        setError('Camera permission denied. Allow camera access in Windows Settings â†’ Privacy.');

      } else if (name === 'NotFoundError') {

        setError('No camera found. Install DroidCam client and select DroidCam Webcam.');

      } else {

        setError(err instanceof Error ? err.message : 'Camera error');

      }

    } finally {

      setCamBusy(false);

    }

  }, [mobile, devices]);



  useEffect(() => {

    if (mobile) return;

    void loadDevices();

    return () => stopStream();

  }, [loadDevices, mobile]);



  useEffect(() => {

    if (mobile) {

      void startCamera('', facingMode);

      return () => stopStream();

    }

    if (deviceId) void startCamera(deviceId);

  }, [deviceId, startCamera, mobile, facingMode]);



  const buildMetadata = (q: CardFrameQuality): CaptureMetadata => ({

    tiltBeta: 0,

    tiltGamma: 0,

    suboptimalLighting: q.lighting.status !== 'ok' ? true : undefined,

    lightingIssues: q.lighting.issues.length ? q.lighting.issues : undefined,

    captureFocusScore: q.focus,

    captureWasSoft: q.status !== 'green' || q.focus < 0.45,

  });



  const capture = useCallback(

    async (fromAuto = false) => {

      if (capturedRef.current || capturing) return;

      const video = videoRef.current;

      const stream = streamRef.current;

      if (!video || !stream) return;



      setCapturing(true);

      setAfStatus('refocusing');

      await prepareCaptureFocus(stream);

      setAfStatus(detectAutofocusStatus(stream));



      const q = qualityRef.current;

      const dataUrl = (await captureStillFromStream(stream, video, 0.92)) || '';

      if (!dataUrl) {

        setCapturing(false);

        return;

      }



      capturedRef.current = true;



      if (q.status !== 'green') {

        setToast('Captured â€” quality was low; consider retaking.');

      } else if (q.lighting.status !== 'ok') {

        setToast(q.lighting.accuracyWarning || q.lighting.message);

      } else if (!fromAuto) {

        setToast('Sharp capture saved.');

      }



      onCapture(dataUrl, buildMetadata(q));

      stopStream();

      setCapturing(false);

    },

    [capturing, onCapture]

  );



  useEffect(() => {

    if (!autoCapture || capturedRef.current || capturing) return;

    const q = quality;

    if (q.status === 'green') {

      if (greenSinceRef.current == null) greenSinceRef.current = Date.now();

      else if (Date.now() - greenSinceRef.current >= 900) void capture(true);

    } else {

      greenSinceRef.current = null;

    }

  }, [quality, autoCapture, desktop, capture, capturing]);



  useEffect(() => {

    if (!toast) return;

    const t = window.setTimeout(() => setToast(''), 4000);

    return () => window.clearTimeout(t);

  }, [toast]);



  const handleDeviceChange = async (id: string) => {

    setDeviceId(id);

    await window.desktop?.setSettings({ webcamDeviceId: id });

  };



  const toggleAutoCapture = async () => {

    const next = !autoCapture;

    setAutoCapture(next);

    greenSinceRef.current = null;

    await window.desktop?.setSettings({ autoCaptureWhenGreen: next });

  };



  const { onPointerDown: onMobileVidPointer } = useDoubleTapCapture({

    disabled: !!error || capturing || camBusy,

    onDoubleTap: () => void capture(false),

  });



  if (mobile) {

    return (

      <div className={CAMERA_SHELL}>

        <div className="shrink-0 z-50 px-4 pb-3 pt-3 rg-safe-pt bg-gradient-to-b from-black/90 to-transparent">

          <div className="flex items-center justify-between gap-2">

            <h3 className="text-sm font-bold uppercase tracking-widest text-poke-gold truncate">

              Capture {side}

            </h3>

            <div className="flex items-center gap-2 shrink-0">

              <FlipCameraButton

                facingMode={facingMode}

                disabled={camBusy || capturing}

                onFlip={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}

              />

              <button type="button" onClick={onClose} className="text-xs text-gray-400 uppercase tracking-widest px-2">

                Cancel

              </button>

            </div>

          </div>

          {toast && <p className="text-xs text-amber-200 mt-2 text-center">{toast}</p>}

          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

        </div>



        {!error && (

          <div className={CAMERA_VIEWPORT} onPointerDown={onMobileVidPointer}>

            <video ref={videoRef} autoPlay playsInline muted className={CAMERA_VIDEO} />

            {camBusy && (

              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 pointer-events-none">

                <div className="w-10 h-10 border-2 border-poke-gold border-t-transparent rounded-full animate-spin" />

              </div>

            )}

            <CardLiveGuideOverlay quality={quality} />

          </div>

        )}



        {!error && (

          <div className={CAMERA_BOTTOM_BAR}>

            <MobileCaptureShutter

              onCapture={() => void capture(false)}

              disabled={capturing || camBusy}

              ringClassName={

                quality.status === 'green'

                  ? 'border-green-400'

                  : quality.status === 'yellow'

                    ? 'border-yellow-400'

                    : 'border-red-400'

              }

            />

          </div>

        )}



        <canvas ref={canvasRef} className="hidden" />

      </div>

    );

  }



  return (

    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden">

      <div className="px-4 pb-4 rg-safe-pt flex flex-wrap items-center gap-3 border-b border-white/10">

        <h3 className="text-sm font-bold uppercase tracking-widest text-poke-gold">

          Capture {side}

        </h3>

        <select

          value={deviceId}

          onChange={(e) => void handleDeviceChange(e.target.value)}

          className="flex-1 min-w-[200px] bg-[#111] border border-white/20 rounded px-3 py-2 text-sm text-white"

        >

          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
            </option>
          ))}

        </select>

        
          <span className="text-[9px] uppercase tracking-widest text-gray-500 px-2 py-1 rounded border border-white/10">

            {AF_LABEL[afStatus]}

          </span>

          {streamResolution && (
            <span
              className={`text-[9px] uppercase tracking-widest px-2 py-1 rounded border ${
                isStreamResolutionLow(streamResolution)
                  ? 'text-amber-300 bg-amber-950/40 border-amber-500/40'
                  : 'text-gray-500 border-white/10'
              }`}
            >
              {formatStreamResolution(streamResolution)}
              {isStreamResolutionLow(streamResolution) ? ' — check DroidCam' : ''}
            </span>
          )}

        

        
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-400 cursor-pointer">

            <input type="checkbox" checked={autoCapture} onChange={() => void toggleAutoCapture()} />

            Auto-capture when ready

          </label>



        <button

          type="button"

          onClick={() => setShowDroidHelp((v) => !v)}

          className="text-xs text-poke-blue uppercase tracking-widest font-bold"

        >

          DroidCam help

        </button>

        <button type="button" onClick={onClose} className="text-xs text-gray-400 uppercase tracking-widest">

          Cancel

        </button>

      </div>



      {showDroidHelp && (

        <div className="p-4 bg-[#0a0a0a] border-b border-white/10 text-sm text-gray-300 space-y-2">

          <p>

            Use your phone as a HD webcam: install the DroidCam app on your phone and the{' '}

            <a href="https://droidcam.app/" target="_blank" rel="noopener noreferrer" className="text-poke-gold underline">

              DroidCam Windows client

            </a>

            . Then pick the DroidCam entry that shows a live preview in this app (often <strong>DroidCam Source 3</strong> on Windows).

          </p>

          <p>

            For HD capture: set the DroidCam Windows client to <strong>1080p</strong>, prefer <strong>USB</strong> over Wi-Fi,

            and confirm <strong>DroidCam Webcam</strong> is selected (not a low-res built-in camera).

          </p>

        </div>

      )}



      {error && <p className="p-4 text-red-400 text-sm">{error}</p>}

      {toast && (

        <p className="px-4 py-2 text-xs text-amber-200 bg-amber-950/50 border-b border-amber-500/30 text-center">

          {toast}

        </p>

      )}



      <div className={`${CAMERA_VIEWPORT} p-0`}>

        <video ref={videoRef} autoPlay playsInline muted className={CAMERA_VIDEO} />

        <CardLiveGuideOverlay quality={quality} />

        <canvas ref={canvasRef} className="hidden" />

      </div>



      <div className={`${CAMERA_BOTTOM_BAR} gap-4`}>

        <button

          type="button"

          disabled={capturing}

          onClick={() => void capture(false)}

          className={`w-16 h-16 rounded-full bg-white border-4 ${RING_COLOR[quality.status]} ${capturing ? 'opacity-50' : ''}`}

          aria-label="Capture"

        />

      </div>

    </div>

  );

};



export default WebcamCapture;

