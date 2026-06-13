import { useEffect, useRef, useState } from 'react';
import {
  analyzeCardFrame,
  downscaleVideoFrame,
  type AnalyzeCardFrameOpts,
  type CardFrameQuality,
} from './cardFrameAnalyzer';

const EMPTY_QUALITY: CardFrameQuality = {
  detected: false,
  quad: null,
  focus: 0,
  perspective: 0,
  overall: 0,
  status: 'red',
  hint: 'Waiting for camera…',
  lighting: {
    score: 0,
    status: 'ok',
    issues: [],
    message: 'Lighting OK',
  },
  cardRoi: null,
};

const ANALYZE_INTERVAL_MS = 125;

export function useCardFrameQuality(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  opts: AnalyzeCardFrameOpts
): CardFrameQuality {
  const [quality, setQuality] = useState<CardFrameQuality>(EMPTY_QUALITY);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const lastRun = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setQuality(EMPTY_QUALITY);
      return;
    }

    let raf = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (ts - lastRun.current < ANALYZE_INTERVAL_MS) return;
      lastRun.current = ts;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      const imageData = downscaleVideoFrame(video);
      if (!imageData) return;
      setQuality(analyzeCardFrame(imageData, optsRef.current));
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, videoRef]);

  return quality;
}
