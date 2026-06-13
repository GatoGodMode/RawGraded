/**
 * Desktop camera constraints + device persistence for VideoCapture / WebcamCapture.
 */
import { withFocusConstraints } from './cameraFocus';

export const DESKTOP_VIDEO_IDEAL_WIDTH = 1920;
export const DESKTOP_VIDEO_IDEAL_HEIGHT = 1080;
export const DESKTOP_VIDEO_MIN_WIDTH = 1280;
export const DESKTOP_VIDEO_MIN_HEIGHT = 720;
export const VIDEO_FRAME_JPEG_QUALITY = 0.92;

const HD_VIDEO: Pick<MediaTrackConstraints, 'width' | 'height' | 'frameRate'> = {
  width: { ideal: DESKTOP_VIDEO_IDEAL_WIDTH, min: DESKTOP_VIDEO_MIN_WIDTH },
  height: { ideal: DESKTOP_VIDEO_IDEAL_HEIGHT, min: DESKTOP_VIDEO_MIN_HEIGHT },
  frameRate: { ideal: 30 },
};

const RELAXED_VIDEO: Pick<MediaTrackConstraints, 'width' | 'height' | 'frameRate'> = {
  width: { ideal: DESKTOP_VIDEO_IDEAL_WIDTH },
  height: { ideal: DESKTOP_VIDEO_IDEAL_HEIGHT },
  frameRate: { ideal: 30 },
};

function readCapMax(
  cap: number | { min?: number; max?: number } | undefined,
  fallback: number
): number {
  if (cap == null) return fallback;
  if (typeof cap === 'number') return cap;
  return cap.max ?? fallback;
}

export function isDroidCamLabel(label: string): boolean {
  return /droidcam/i.test(label);
}

/** OBS-style DroidCam outputs — often black unless explicitly routed; not the main webcam feed. */
export function isDroidCamSourceLabel(label: string): boolean {
  return /droidcam\s+source\s*\d/i.test(label);
}

export function preferDroidCamDevice(devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
  const droid = devices.filter((d) => isDroidCamLabel(d.label));
  if (!droid.length) return undefined;
  return (
    droid.find((d) => /droidcam\s+source\s*3/i.test(d.label)) ||
    droid.find((d) => isDroidCamSourceLabel(d.label)) ||
    droid.find((d) => /droidcam\s+(video|webcam)/i.test(d.label)) ||
    droid[0]
  );
}

export function formatStreamResolution(settings: MediaTrackSettings): string {
  const w = settings.width ?? 0;
  const h = settings.height ?? 0;
  return w && h ? `${w}×${h}` : '—';
}

export function isStreamResolutionLow(settings: MediaTrackSettings): boolean {
  const w = settings.width ?? 0;
  const h = settings.height ?? 0;
  return !w || !h || w < DESKTOP_VIDEO_MIN_WIDTH || h < DESKTOP_VIDEO_MIN_HEIGHT;
}

export async function applyPreferredResolution(
  track: MediaStreamTrack,
  deviceLabel = ''
): Promise<MediaTrackSettings> {
  if (isDroidCamLabel(deviceLabel)) {
    /* DroidCam virtual devices negotiate best on driver defaults — do not re-constrain. */
    return track.getSettings();
  }

  const caps = track.getCapabilities?.();
  if (!caps) return track.getSettings();

  const maxW = readCapMax(caps.width, DESKTOP_VIDEO_IDEAL_WIDTH);
  const maxH = readCapMax(caps.height, DESKTOP_VIDEO_IDEAL_HEIGHT);
  const targetW = Math.min(maxW, DESKTOP_VIDEO_IDEAL_WIDTH);
  const targetH = Math.min(maxH, DESKTOP_VIDEO_IDEAL_HEIGHT);
  const minW = Math.min(targetW, DESKTOP_VIDEO_MIN_WIDTH);
  const minH = Math.min(targetH, DESKTOP_VIDEO_MIN_HEIGHT);

  try {
    await track.applyConstraints({
      width: { ideal: targetW, min: minW },
      height: { ideal: targetH, min: minH },
      frameRate: { ideal: 30 },
    });
  } catch {
    /* keep negotiated profile */
  }

  return track.getSettings();
}

export async function listVideoInputDevices(): Promise<MediaDeviceInfo[]> {
  let probeStream: MediaStream | null = null;
  try {
    probeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  } finally {
    probeStream?.getTracks().forEach((t) => t.stop());
  }
}

export async function loadPreferredWebcamDeviceId(): Promise<string> {
  const stored = (await window.desktop?.getSettingsFull?.())?.webcamDeviceId;
  return stored || '';
}

export async function savePreferredWebcamDeviceId(deviceId: string): Promise<void> {
  if (window.desktop?.setSettings && deviceId) {
    await window.desktop.setSettings({ webcamDeviceId: deviceId });
  }
}

export function buildDesktopVideoConstraints(
  deviceId: string,
  deviceLabel = ''
): MediaStreamConstraints {
  if (deviceId && isDroidCamSourceLabel(deviceLabel)) {
    return {
      video: { deviceId: { exact: deviceId } },
      audio: false,
    };
  }

  const relaxed = isDroidCamLabel(deviceLabel);
  const profile = relaxed ? RELAXED_VIDEO : HD_VIDEO;
  const base: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId }, ...profile }
    : { ...profile };

  if (relaxed) {
    return { video: base, audio: false };
  }

  return {
    video: withFocusConstraints(base) as MediaTrackConstraints,
    audio: false,
  };
}

export function buildMobileVideoConstraints(
  facing: 'user' | 'environment' = 'environment'
): MediaStreamConstraints {
  return {
    video: withFocusConstraints({
      facingMode: { ideal: facing },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    }) as MediaTrackConstraints,
    audio: false,
  };
}

export function isDesktopApp(): boolean {
  return Boolean(window.desktop?.isDesktop);
}

export async function pickDefaultDeviceId(devices: MediaDeviceInfo[]): Promise<string> {
  const stored = await loadPreferredWebcamDeviceId();
  const fromStored = devices.find((d) => d.deviceId === stored);
  if (fromStored) return fromStored.deviceId;

  const droid = preferDroidCamDevice(devices);
  if (droid) return droid.deviceId;

  const obs = devices.find((d) => /obs virtual/i.test(d.label));
  return obs?.deviceId || devices[0]?.deviceId || '';
}

export function sortVideoDevicesForUi(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return [...devices].sort((a, b) => a.label.localeCompare(b.label));
}
