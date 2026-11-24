import { prepareZXingModule, readBarcodes, type ReadResult } from 'zxing-wasm/reader';
import { barcode, type Barcode } from './barcodes.ts';

const formats = { EAN13: 'EAN_13', EAN8: 'EAN_8', UPCA: 'UPC_A', UPCE: 'UPC_E', QRCode: 'QR_CODE' } as const;
const wasmOverrides = { locateFile: () => '/assets/zxing_reader.wasm' };
export function decodedBarcode(result: ReadResult): Barcode | null {
  const format = formats[result.format as keyof typeof formats];
  if (!format || !result.isValid) return null;
  // ZXing-C++ normalizes UPCs to EAN-13; retain the code printed on the supply.
  if (format === 'UPC_E') return barcode({ format, value: JSON.parse(result.extra).UPCE });
  if (format === 'EAN_13' && result.text.startsWith('0')) return barcode({ format: 'UPC_A', value: result.text.slice(1) });
  return barcode({ format, value: result.text });
}
export async function startScanner(video: HTMLVideoElement, receive: (code: Barcode) => void, signal: AbortSignal, failed: () => void = () => {}): Promise<void> {
  await prepareZXingModule({ overrides: wasmOverrides, fireImmediately: true });
  if (signal.aborted) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => { clearTimeout(timer); stream.getTracks().forEach(track => track.stop()); video.srcObject = null; };
  if (signal.aborted) { release(); return; }
  signal.addEventListener('abort', release, { once: true });
  try {
    video.srcObject = stream;
    await video.play();
    if (signal.aborted) { release(); return; }
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true })!;
    const scan = async () => {
      if (signal.aborted) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          const scale = Math.min(1, 1280 / video.videoWidth);
          const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          context.drawImage(video, 0, 0, width, height);
          const results = await readBarcodes(context.getImageData(0, 0, width, height), { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'QRCode'], maxNumberOfSymbols: 1, tryHarder: true });
          const code = results[0] && decodedBarcode(results[0]);
          if (code && !signal.aborted) receive(code);
        }
        if (!signal.aborted) timer = setTimeout(scan, 200);
      } catch { release(); if (!signal.aborted) failed(); }
    };
    timer = setTimeout(scan, 0);
  } catch (error) { release(); throw error; }
}
