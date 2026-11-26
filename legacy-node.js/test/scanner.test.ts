import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { prepareZXingModule as prepareWriter, writeBarcode } from 'zxing-wasm/writer';
import { decodedBarcode } from '../src/scanner.ts';

prepareZXingModule({ overrides: { wasmBinary: readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') } });
prepareWriter({ overrides: { wasmBinary: readFileSync('node_modules/zxing-wasm/dist/writer/zxing_writer.wasm') } });
// Fixed, valid fixture codes only. The application never generates identifiers.
for (const [format, value, expectedFormat] of [
  ['EAN13', '4006381333931', 'EAN_13'], ['EAN8', '96385074', 'EAN_8'],
  ['UPCA', '012345000065', 'UPC_A'], ['UPCE', '01234565', 'UPC_E'],
  ['QRCode', 'https://supplier.test/part?bag=100', 'QR_CODE']
] as const) test(`camera decoder reads ${format} images with the printed value intact`, async () => {
  const image = (await writeBarcode(value, { format, scale: 3 })).image!;
  const results = await readBarcodes(await image.arrayBuffer(), { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'QRCode'], maxNumberOfSymbols: 1 });
  assert.equal(results.length, 1);
  assert.deepEqual(decodedBarcode(results[0]), { format: expectedFormat, value });
});
