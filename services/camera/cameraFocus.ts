export type AutofocusStatus = 'unsupported' | 'continuous' | 'refocusing' | 'ready';

type FocusCapableTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { focusMode?: string[] };
};

const FOCUS_SETTLE_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function getVideoTrack(stream: MediaStream | null): MediaStreamTrack | null {
  if (!stream) return null;
  return stream.getVideoTracks()[0] || null;
}

export function supportsFocusMode(track: MediaStreamTrack | null, mode: string): boolean {
  if (!track) return false;
  const caps = (track as FocusCapableTrack).getCapabilities?.();
  const modes = caps?.focusMode;
  return Array.isArray(modes) && modes.includes(mode);
}

export async function enableContinuousAutofocus(track: MediaStreamTrack | null): Promise<boolean> {
  if (!track || !supportsFocusMode(track, 'continuous')) return false;
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export async function triggerSingleShotAutofocus(track: MediaStreamTrack | null): Promise<boolean> {
  if (!track || !supportsFocusMode(track, 'single-shot')) return false;
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' } as MediaTrackConstraintSet] });
    await sleep(FOCUS_SETTLE_MS);
    if (supportsFocusMode(track, 'continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

export async function prepareCaptureFocus(stream: MediaStream | null): Promise<boolean> {
  const track = getVideoTrack(stream);
  if (!track) return false;
  return triggerSingleShotAutofocus(track);
}

export function detectAutofocusStatus(stream: MediaStream | null): AutofocusStatus {
  const track = getVideoTrack(stream);
  if (!track) return 'unsupported';
  if (supportsFocusMode(track, 'continuous')) return 'continuous';
  if (supportsFocusMode(track, 'single-shot')) return 'ready';
  return 'unsupported';
}

export async function captureStillFromStream(
  stream: MediaStream,
  video: HTMLVideoElement,
  jpegQuality = 0.92
): Promise<string | null> {
  const ImageCaptureCtor = (window as Window & { ImageCapture?: typeof ImageCapture }).ImageCapture;
  const track = getVideoTrack(stream);
  if (ImageCaptureCtor && track) {
    try {
      const capture = new ImageCaptureCtor(track);
      const blob = await capture.takePhoto();
      return await blobToDataUrl(blob);
    } catch {
      // fall through to canvas grab
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || !video.videoWidth || !video.videoHeight) return null;
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', jpegQuality);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function withFocusConstraints(
  video: MediaTrackConstraints | boolean | undefined
): MediaTrackConstraints | boolean | undefined {
  if (video === true || video === false || video == null) return video;
  return {
    ...video,
    advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
  };
}
