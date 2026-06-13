import html2canvas from 'html2canvas';

export interface CaptureElementOptions {
  width?: number;
  height?: number;
  scale?: number;
  backgroundColor?: string;
}

export async function captureElementToPng(
  element: HTMLElement,
  options: CaptureElementOptions = {}
): Promise<string> {
  const { width, height, scale = 1, backgroundColor = '#000000' } = options;

  const canvas = await html2canvas(element, {
    logging: false,
    scale,
    useCORS: true,
    allowTaint: true,
    backgroundColor,
    imageTimeout: 0,
    removeContainer: true,
    windowWidth: width ?? element.scrollWidth,
    windowHeight: height ?? element.scrollHeight,
  });

  return canvas.toDataURL('image/png');
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.download = filename;
  a.href = dataUrl;
  a.click();
}
