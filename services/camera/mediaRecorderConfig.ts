/** MediaRecorder codec + bitrate for guided video capture. */

export const VIDEO_RECORDER_BITRATE = 2_500_000;

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
] as const;

export function pickVideoRecorderMimeType(): string {
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'video/webm';
}

export function buildMediaRecorderOptions(mimeType: string): MediaRecorderOptions {
  return {
    mimeType,
    videoBitsPerSecond: VIDEO_RECORDER_BITRATE,
  };
}
