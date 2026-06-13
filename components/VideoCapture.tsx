import React, { useRef, useState, useEffect, useCallback } from 'react';
import VideoGuideOverlay from './VideoGuideOverlay';
import CardLiveGuideOverlay from './CardLiveGuideOverlay';
import {
  isDesktopApp,
  listVideoInputDevices,
  pickDefaultDeviceId,
  buildDesktopVideoConstraints,
  buildMobileVideoConstraints,
  savePreferredWebcamDeviceId,
  applyPreferredResolution,
  formatStreamResolution,
  isStreamResolutionLow,
  sortVideoDevicesForUi,
  VIDEO_FRAME_JPEG_QUALITY,
} from '../services/camera/desktopCamera';
import {
  enableContinuousAutofocus,
  prepareCaptureFocus,
  detectAutofocusStatus,
  captureStillFromStream,
  type AutofocusStatus,
} from '../services/camera/cameraFocus';
import {
  pickVideoRecorderMimeType,
  buildMediaRecorderOptions,
} from '../services/camera/mediaRecorderConfig';
import { useCardFrameQuality } from '../services/camera/useCardFrameQuality';
import type { CardFrameQuality } from '../services/camera/cardFrameAnalyzer';
import { isMobileApp } from '../services/platform/platformBridge';
import {
  CAMERA_SHELL,
  CAMERA_VIEWPORT,
  CAMERA_VIDEO,
  CAMERA_BOTTOM_BAR,
  useDoubleTapCapture,
  MobileCaptureShutter,
  FlipCameraButton,
} from './camera/mobileCameraShared';

interface VideoCaptureProps {
  onCapture: (videoDataUrl: string, frames: string[]) => void;
  onSkip: () => void;
  type?: 'card' | 'slab';
}

const CARD_STAGES = [
  { id: 0, duration: 6, title: "FRONT", desc: "Hold Motionless (Front)", captureAt: [5, 3], nextHint: "Next: Rotate Left & Right" },
  { id: 1, duration: 5, title: "TILT L/R", desc: "Rotate Left & Right", captureAt: [4, 2], nextHint: "Next: Rotate Up & Down" },
  { id: 2, duration: 5, title: "TILT U/D", desc: "Rotate Up & Down", captureAt: [4, 2], nextHint: "Next: Move Closer (Macro Scan)" },
  { id: 3, duration: 6, title: "CLOSE SCAN", desc: "Move Closer to Surface", captureAt: [4, 2], nextHint: "Next: Flip Card for Back Scan" },
  { id: 4, duration: 8, title: "BACK SCAN", desc: "Flip Card & Scan Back", captureAt: [4, 2], nextHint: "" }
];

const SLAB_STAGES = [
  { id: 0, duration: 6, title: "LABEL FOCUS", desc: "Hold steady on Slab Label (Fonts/Barcode)", captureAt: [5, 3], nextHint: "Next: Tilt to catch Holograms" },
  { id: 1, duration: 5, title: "HOLO TILT", desc: "Tilt L/R for Label Reflection/Holograms", captureAt: [4, 2], nextHint: "Next: Inspect Plastic Case Edges" },
  { id: 2, duration: 5, title: "EDGE SEAMS", desc: "Show plastic edges & frosted seams", captureAt: [4, 2], nextHint: "Next: Focus on Grade & Text" },
  { id: 3, duration: 6, title: "GRADE/TEXT", desc: "Focus closely on grade and label text", captureAt: [4, 2], nextHint: "Next: Flip & tilt back for Holo" },
  { id: 4, duration: 8, title: "BACK + TILT", desc: "Flip & tilt for back QR/Holograms", captureAt: [4, 2], nextHint: "" }
];

const VideoCapture: React.FC<VideoCaptureProps> = ({ onCapture, onSkip, type = 'card' }) => {
  const currentStages = type === 'slab' ? SLAB_STAGES : CARD_STAGES;
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const framesRef = useRef<string[]>([]);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);
  const [showGuide, setShowGuide] = useState(true);
  const [currentStage, setCurrentStage] = useState(-1);
  const [timeLeft, setTimeLeft] = useState(0);
  const [error, setError] = useState<string>('');
  const [flashFrame, setFlashFrame] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [showDroidHelp, setShowDroidHelp] = useState(false);
  const [captureNotice, setCaptureNotice] = useState('');
  const [afStatus, setAfStatus] = useState<AutofocusStatus>('unsupported');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [camBusy, setCamBusy] = useState(false);
  const [streamResolution, setStreamResolution] = useState<MediaTrackSettings | null>(null);
  const desktop = isDesktopApp();
  const mobile = isMobileApp() || !desktop;
  const streamRef = useRef<MediaStream | null>(null);

  const quality = useCardFrameQuality(videoRef, desktop && !showInstructions, {
    mode: 'video_stage',
    stage: currentStage >= 0 ? currentStage : 0,
    type,
  });
  const qualityRef = useRef<CardFrameQuality>(quality);
  qualityRef.current = quality;

  const loadDevices = useCallback(async () => {
    if (!desktop) return;
    const cams = sortVideoDevicesForUi(await listVideoInputDevices());
    setDevices(cams);
    const id = await pickDefaultDeviceId(cams);
    if (id) setDeviceId(id);
  }, [desktop]);

  useEffect(() => {
    if (!showInstructions && desktop) {
      void loadDevices();
    }
  }, [showInstructions, desktop, loadDevices]);

  useEffect(() => {
    if (!showInstructions) {
      void startCamera();
    }
    return () => stopCamera();
  }, [showInstructions, deviceId, facingMode, mobile]);

  useEffect(() => {
    if (!isRecording || currentStage === -1) return;

    const stageConfig = currentStages[currentStage];
    if (!stageConfig.captureAt.includes(timeLeft)) {
      if (timeLeft > 0) {
        const timer = setTimeout(() => setTimeLeft((prev) => prev - 1), 1000);
        return () => clearTimeout(timer);
      }
      const nextStage = currentStage + 1;
      if (nextStage < currentStages.length) {
        setCurrentStage(nextStage);
        setTimeLeft(currentStages[nextStage].duration);
      } else {
        finishRecording();
      }
      return;
    }

    const doCapture = async () => {
      const activeStream = streamRef.current;
      if (activeStream) {
        setAfStatus('refocusing');
        await prepareCaptureFocus(activeStream);
        setAfStatus(detectAutofocusStatus(activeStream));
      }
      await captureHighResFrame();
      const q = qualityRef.current;
      if (q.lighting.status !== 'ok') {
        setCaptureNotice(q.lighting.accuracyWarning || q.lighting.message);
        window.setTimeout(() => setCaptureNotice(''), 4000);
      }
    };

    const trySmartCapture = () => {
      if (!desktop) {
        void doCapture();
        return;
      }
      const q = qualityRef.current;
      const macroStage = currentStage === 3;
      if (q.status === 'green') {
        void doCapture();
        return;
      }
      let attempts = 0;
      const retry = window.setInterval(() => {
        attempts += 1;
        if (qualityRef.current.status === 'green') {
          void doCapture();
          window.clearInterval(retry);
        } else if (attempts >= 6) {
          if (macroStage) {
            setCaptureNotice('Macro stage requires sharp focus — skipped this slot.');
          } else {
            setCaptureNotice('Waiting for sharp frame… skipped this slot.');
          }
          window.setTimeout(() => setCaptureNotice(''), 3000);
          window.clearInterval(retry);
        }
      }, 400);
    };

    trySmartCapture();

    if (timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft((prev) => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
    const nextStage = currentStage + 1;
    if (nextStage < currentStages.length) {
      setCurrentStage(nextStage);
      setTimeLeft(currentStages[nextStage].duration);
    } else {
      finishRecording();
    }
  }, [isRecording, currentStage, timeLeft, desktop, currentStages]);

  const startCamera = async () => {
    stopCamera();
    setCamBusy(true);
    const deviceLabel = devices.find((d) => d.deviceId === deviceId)?.label || '';
    try {
      const constraints = desktop
        ? buildDesktopVideoConstraints(deviceId, deviceLabel)
        : buildMobileVideoConstraints(facingMode);

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = mediaStream;
      setStream(mediaStream);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }
      const track = mediaStream.getVideoTracks()[0];
      if (track) {
        await enableContinuousAutofocus(track);
        if (desktop) {
          const settings = await applyPreferredResolution(track, deviceLabel);
          setStreamResolution(settings);
        }
      }
      setAfStatus(detectAutofocusStatus(mediaStream));
      setError('');
    } catch (err: unknown) {
      console.error('Camera Error: ', err);
      const name = err instanceof Error ? (err as DOMException).name : '';
      if (desktop && name === 'NotFoundError') {
        setError('No camera found. Install DroidCam client and select DroidCam Webcam.');
      } else if (name === 'NotAllowedError') {
        setError('Camera permission denied.');
      } else {
        setError('Camera access required for video analysis.');
      }
    } finally {
      setCamBusy(false);
    }
  };

  const handleDeviceChange = async (id: string) => {
    setDeviceId(id);
    await savePreferredWebcamDeviceId(id);
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setStreamResolution(null);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const captureHighResFrame = useCallback(async () => {
    const video = videoRef.current;
    const activeStream = streamRef.current;
    if (!video || !activeStream) return;

    const frameData = await captureStillFromStream(activeStream, video, VIDEO_FRAME_JPEG_QUALITY);
    if (!frameData) return;

    framesRef.current.push(frameData);
    setFlashFrame(true);
    setTimeout(() => setFlashFrame(false), 150);
  }, []);

  const snapFrameNow = useCallback(() => {
    void (async () => {
      const activeStream = streamRef.current;
      if (activeStream) {
        setAfStatus('refocusing');
        await prepareCaptureFocus(activeStream);
        setAfStatus(detectAutofocusStatus(activeStream));
      }
      await captureHighResFrame();
      const q = qualityRef.current;
      if (q.lighting.status !== 'ok') {
        setCaptureNotice(q.lighting.accuracyWarning || q.lighting.message);
        window.setTimeout(() => setCaptureNotice(''), 4000);
      }
    })();
  }, [captureHighResFrame]);

  const { onPointerDown: onVideoPointerDown } = useDoubleTapCapture({
    disabled: showInstructions || !!error || camBusy,
    onDoubleTap: () => {
      if (isRecording) snapFrameNow();
    },
  });

  const startRecordingProcess = useCallback(() => {
    const activeStream = streamRef.current;
    if (!activeStream) return;

    try {
      const mimeType = pickVideoRecorderMimeType();
      const mediaRecorder = new MediaRecorder(activeStream, buildMediaRecorderOptions(mimeType));
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      framesRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          if (reader.result) {
            onCapture(reader.result as string, framesRef.current);
          }
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
      setCurrentStage(0);
      setTimeLeft(currentStages[0].duration);
    } catch (e) {
      console.error("Recorder Error", e);
      setError("Could not start recording.");
    }
  }, [currentStages, onCapture]);

  const finishRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setCurrentStage(-1);
      stopCamera();
    }
  };

  const currentStageInfo = currentStage >= 0 && currentStage < currentStages.length ? currentStages[currentStage] : null;

  useEffect(() => {
    if (!desktop) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;

      if (showInstructions) {
        e.preventDefault();
        setShowInstructions(false);
        return;
      }

      if (!isRecording && streamRef.current && !error && !camBusy) {
        e.preventDefault();
        startRecordingProcess();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [desktop, showInstructions, isRecording, error, camBusy, startRecordingProcess]);

  const shellClass = mobile && !showInstructions ? CAMERA_SHELL : 'fixed inset-0 z-[100] bg-black flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden';

  return (
    <div className={shellClass}>
      {/* Instructions Overlay */}
      {showInstructions && (
        <div className="absolute inset-0 z-[110] bg-surface flex flex-col p-6 overflow-y-auto no-scrollbar animate-fade-in">
          <div className="flex-1 flex flex-col items-center justify-center space-y-8 max-w-md mx-auto py-8">
            <div className="text-center space-y-3">
              <div className="w-20 h-20 bg-poke-accent/20 rounded-full flex items-center justify-center mx-auto border-2 border-poke-accent animate-pulse">
                <i className="fas fa-video text-3xl text-poke-accent"></i>
              </div>
              <h1 className="text-3xl font-black text-gray-900 tracking-tight">GUIDED ANALYSIS</h1>
              <div className="flex gap-4 justify-center">
                <span className="bg-muted/50 text-gray-600 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-silver">
                  <i className="fas fa-clock mr-1"></i> &lt; 30 Seconds
                </span>
                <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-amber-200">
                  <i className="fas fa-sun mr-1"></i> Diffuse light improves accuracy
                </span>
              </div>
            </div>

            <div className="w-full space-y-4">
              <p className="text-gray-600 text-xs font-bold uppercase tracking-widest border-b border-silver pb-2 flex items-center gap-2">
                <i className="fas fa-list-ol text-poke-accent"></i> The 5 Step Process
              </p>

              <div className="-mx-6 px-6 pb-2">
                <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-4 no-scrollbar">
                  {(type === 'slab' ? [
                    { step: 1, title: 'Label Scan', icon: 'fa-id-card', desc: 'Focus clearly on the slab label, ensuring fonts and barcode are sharp.' },
                    { step: 2, title: 'Hologram Catch', icon: 'fa-sun', desc: 'Tilt left/right to catch the light on the label\'s security hologram.' },
                    { step: 3, title: 'Plastic Seams', icon: 'fa-border-all', desc: 'Tilt to reveal the plastic edges and ultrasonic welding seams for tampering checks.' },
                    { step: 4, title: 'Grade & Text Inspection', icon: 'fa-search-plus', desc: 'Bring the camera close to the label to focus on the text, grade, and any micro-printing.' },
                    { step: 5, title: 'Reverse & Tilt', icon: 'fa-redo', desc: 'Flip the slab over and gently tilt it to reveal the official PSA holographic sticker where applicable, and capture the QR code.' }
                  ] : [
                    { step: 1, title: 'Front Scan', icon: 'fa-id-card', desc: 'Hold the card perfectly still for the front face scan.' },
                    { step: 2, title: 'Tilt Left/Right', icon: 'fa-arrows-alt-h', desc: 'Slowly tilt the card left and right to capture holographic flash.' },
                    { step: 3, title: 'Tilt Up/Down', icon: 'fa-arrows-alt-v', desc: 'Slowly tilt the card up and down to check surface textures.' },
                    { step: 4, title: 'Forensic Zoom', icon: 'fa-search-plus', desc: 'Move your camera closer to the card surface for a macro scan.' },
                    { step: 5, title: 'Reverse Scan', icon: 'fa-redo', desc: 'Flip the card over and hold still for the final back scan.' }
                  ]).map((s, index) => (
                    <div key={s.step} className="snap-center shrink-0 w-[85%] sm:w-[280px] bg-white border-2 border-silver rounded-2xl overflow-hidden shadow-sm flex flex-col">
                      <div className="relative w-full h-48 bg-black overflow-hidden flex items-center justify-center">
                        <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent"></div>
                        <div className="transform scale-[0.6] origin-center w-full h-full relative pointer-events-none">
                          <VideoGuideOverlay type={type} stage={index} />
                        </div>
                        <div className="absolute top-3 left-3 w-8 h-8 rounded-full bg-white text-black font-black flex items-center justify-center text-sm shadow-md z-30">
                          {s.step}
                        </div>
                      </div>
                      <div className="p-4 flex-1 flex flex-col justify-center">
                        <h3 className="text-md font-black text-gray-900 flex items-center gap-2 mb-2 uppercase tracking-wide">
                          <i className={`fas ${s.icon} text-poke-accent`}></i> {s.title}
                        </h3>
                        <p className="text-sm text-gray-600 leading-relaxed font-medium">
                          {s.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center mt-1">
                  <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest flex items-center gap-2">
                    <i className="fas fa-arrows-alt-h"></i> Swipe to preview stages
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowInstructions(false)}
              className="w-full bg-poke-accent hover:opacity-90 text-white py-4 rounded-2xl font-black tracking-widest shadow-xl transform active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              GOT IT, START CAMERA <i className="fas fa-arrow-right"></i>
            </button>
            {desktop && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Press SPACE to continue
              </p>
            )}

            <button
              onClick={onSkip}
              className="text-gray-500 hover:text-gray-900 text-[10px] font-black uppercase tracking-[0.2em] transition-colors"
            >
              Skip Technical Analysis
            </button>
          </div>
        </div>
      )}

      <div
        className={`absolute top-0 left-0 right-0 px-4 pb-4 rg-safe-pt flex justify-between items-center z-[100] shrink-0 ${
          mobile && !showInstructions
            ? 'bg-gradient-to-b from-black/90 to-transparent'
            : 'bg-gradient-to-b from-white/95 to-transparent border-b border-silver/50'
        }`}
      >
        <div>
          <h2
            className={`font-bold text-xl tracking-wider uppercase ${mobile && !showInstructions ? 'text-white' : 'text-gray-900'}`}
          >
            Video Analysis
          </h2>
          {mobile && !showInstructions && (
            <p className="text-[10px] text-gray-400 mt-0.5">Double-tap view to snap a frame</p>
          )}
          {desktop && devices.length > 0 && (
            <select
              value={deviceId}
              onChange={(e) => void handleDeviceChange(e.target.value)}
              className="mt-1 text-[10px] bg-white border border-silver rounded px-2 py-1 max-w-[220px]"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          )}
          {desktop && !showInstructions && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-[9px] font-bold uppercase text-gray-500 tracking-widest">
                {afStatus === 'continuous' ? 'AF: continuous' : afStatus === 'refocusing' ? 'AF: refocusing…' : afStatus === 'ready' ? 'AF: ready' : 'AF: n/a'}
              </p>
              {streamResolution && (
                <span
                  className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                    isStreamResolutionLow(streamResolution)
                      ? 'text-amber-700 bg-amber-50 border-amber-300'
                      : 'text-gray-500 border-silver'
                  }`}
                >
                  {formatStreamResolution(streamResolution)}
                  {isStreamResolutionLow(streamResolution) ? ' — check DroidCam' : ''}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-3 items-center shrink-0">
          {mobile && !showInstructions && (
            <FlipCameraButton
              facingMode={facingMode}
              disabled={camBusy || isRecording}
              onFlip={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
            />
          )}
          {desktop && (
            <button
              type="button"
              onClick={() => setShowDroidHelp((v) => !v)}
              className="text-[10px] font-bold uppercase text-gray-500 hover:text-gray-900"
            >
              DroidCam help
            </button>
          )}
          <button
            onClick={() => setShowGuide(!showGuide)}
            className={`text-xs font-bold uppercase flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all ${
              mobile && !showInstructions
                ? showGuide
                  ? 'bg-poke-gold/20 text-poke-gold border-poke-gold/40'
                  : 'bg-white/10 text-gray-400 border-white/20'
                : showGuide
                  ? 'bg-poke-accent/10 text-poke-accent border-poke-accent/30'
                  : 'bg-white/50 text-gray-400 border-gray-300'
            }`}
          >
            <i className={`fas ${showGuide ? 'fa-eye' : 'fa-eye-slash'}`}></i>
            Visual Guide
          </button>
          {!isRecording && (
            <button
              onClick={onSkip}
              className={`font-bold text-sm ${mobile && !showInstructions ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Skip Video
            </button>
          )}
        </div>
      </div>

      {showDroidHelp && desktop && (
        <div className="absolute top-16 left-4 right-4 z-[105] bg-white border border-silver rounded-lg p-3 text-xs text-gray-700 shadow-lg max-w-md space-y-2">
          <p>
            Install DroidCam on phone + PC, connect via USB or Wi-Fi, then pick the DroidCam device that shows a live preview (often Source 3).
          </p>
          <p>
            For HD capture: set the DroidCam Windows client to <strong>1080p</strong>, prefer <strong>USB</strong> over Wi-Fi,
            and confirm <strong>DroidCam Webcam</strong> is selected (not a low-res built-in camera).
          </p>
        </div>
      )}

      <div
        className={mobile && !showInstructions ? CAMERA_VIEWPORT : 'relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden'}
        onPointerDown={mobile && !showInstructions ? onVideoPointerDown : undefined}
      >
        <div className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-150 z-50 ${flashFrame ? 'opacity-50' : 'opacity-0'}`}></div>

        {camBusy && mobile && !showInstructions && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 pointer-events-none">
            <div className="w-10 h-10 border-2 border-poke-gold border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error ? (
          <div className="text-gray-900 text-center p-6 bg-white/90 rounded-xl mx-4 border-2 border-silver">
            <i className="fas fa-exclamation-circle text-red-500 text-3xl mb-4"></i>
            <p>{error}</p>
            <button onClick={onSkip} className="mt-4 px-4 py-2 bg-muted/50 hover:bg-muted border-2 border-silver rounded-lg font-bold text-gray-900">Continue without Video</button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={true}
              className={`${mobile ? CAMERA_VIDEO : 'absolute inset-0 w-full h-full object-cover'} ${mobile ? 'opacity-90' : ''}`}
            />

            {desktop && !showInstructions && (
              <CardLiveGuideOverlay quality={quality} />
            )}

            {captureNotice && (
              <div className="absolute top-20 left-4 right-4 z-40 pointer-events-none">
                <p className="text-center text-xs text-amber-200 bg-amber-950/80 border border-amber-500/40 rounded-lg px-3 py-2">
                  {captureNotice}
                </p>
              </div>
            )}

            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-20">
              {isRecording && currentStageInfo && (
                <div className="flex flex-col items-center animate-bounce-short">
                  <h1 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400 drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] text-center leading-tight uppercase">
                    {currentStageInfo.title}
                  </h1>
                  <div className="mt-4 bg-poke-accent/90 backdrop-blur-md px-8 py-2 rounded-full shadow-xl">
                    <p className="text-2xl font-bold text-white uppercase tracking-widest">
                      {currentStageInfo.desc}
                    </p>
                  </div>
                  <div className="mt-8 relative flex flex-col items-center">
                    <span className="text-[120px] font-black text-white drop-shadow-lg font-mono leading-none">
                      {timeLeft}
                    </span>
                    {timeLeft <= 4 && currentStageInfo.nextHint && (
                      <div className="mt-4 animate-pulse">
                        <p className="text-amber-400 font-black uppercase tracking-widest text-sm bg-black/60 px-4 py-1.5 rounded-lg border border-amber-500/30">
                          {currentStageInfo.nextHint}
                        </p>
                      </div>
                    )}
                  </div>
                  
                  {/* Next Step SVG Preview Indicator in Bottom Right */}
                  {timeLeft <= 4 && currentStage + 1 < currentStages.length && showGuide && (
                    <div className="absolute bottom-20 right-4 bg-black/80 border border-amber-500/40 rounded-full pr-4 pl-2 py-2 shadow-lg animate-fade-in flex items-center gap-3 z-50">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
                        <i className="fas fa-arrow-right text-amber-400 text-sm"></i>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black text-amber-400 uppercase tracking-widest leading-none mb-1">Up Next</span>
                        <span className="text-xs font-bold text-white uppercase tracking-wider leading-none">
                          {currentStages[currentStage + 1].title}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="absolute bottom-6 flex gap-1">
                    {framesRef.current.map((_, i) => (
                      <div key={i} className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_#4ade80]"></div>
                    ))}
                  </div>
                </div>
              )}

              {!isRecording && !showGuide && (
                <div className="w-[70%] max-w-[350px] aspect-[2.5/3.5] border-4 border-dashed border-white/40 rounded-xl flex items-center justify-center">
                  <p className="text-white/50 font-bold uppercase tracking-widest">Card Frame</p>
                </div>
              )}
              {showGuide && (
                <VideoGuideOverlay type={type} stage={isRecording ? currentStage : 0} />
              )}
            </div>
          </>
        )}
      </div>

      <div
        className={
          mobile && !showInstructions
            ? `${CAMERA_BOTTOM_BAR} flex-col gap-3 min-h-[120px]`
            : 'shrink-0 min-h-[128px] bg-white flex flex-col items-center justify-center rg-safe-pb z-10 gap-4 border-t border-silver shadow-[0_-4px_12px_rgba(0,0,0,0.06)]'
        }
      >
        {isRecording ? (
          <div className="w-full px-4 max-w-lg">
            <div
              className={`flex justify-between text-xs mb-2 font-mono uppercase ${mobile ? 'text-gray-400' : 'text-gray-600'}`}
            >
              <span>Recording Evidence</span>
              <span>
                Step {currentStage + 1} of {currentStages.length}
              </span>
            </div>
            <div
              className={`w-full h-3 rounded-full overflow-hidden ${mobile ? 'bg-white/20' : 'bg-gray-200 border-2 border-silver'}`}
            >
              <div
                className="h-full bg-gradient-to-r from-poke-accent to-red-500 transition-all duration-300 ease-out"
                style={{ width: `${(currentStage / currentStages.length) * 100}%` }}
              />
            </div>
            {mobile && (
              <div className="flex justify-center mt-4">
                <MobileCaptureShutter onCapture={snapFrameNow} ringClassName="border-poke-gold" label="Snap frame" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={startRecordingProcess}
              className="group relative w-20 h-20 rounded-full flex items-center justify-center transition-all active:scale-95"
            >
              <div
                className={`absolute inset-0 rounded-full border-4 opacity-80 group-hover:scale-110 transition-transform animate-pulse ${mobile ? 'border-white/50' : 'border-gray-400'}`}
              />
              <div className="w-16 h-16 rounded-full bg-red-600 border-4 border-silver group-hover:bg-red-700 transition-colors shadow-[0_0_20px_rgba(220,38,38,0.6)]" />
              <i className="fas fa-video absolute text-white text-xl" />
            </button>
            <p className={`text-sm font-bold uppercase tracking-wider ${mobile ? 'text-gray-300' : 'text-gray-600'}`}>
              Start Guided Analysis
            </p>
            {desktop && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Press SPACE to start
              </p>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes bounce-short {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .animate-bounce-short {
            animation: bounce-short 2s infinite;
        }
      `}</style>
    </div>
  );
};

export default VideoCapture;