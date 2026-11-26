import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barcode, barcodeKey, expandUPCE } from '../src/barcodes.ts';
import { normalize, parseBackup } from '../src/model.ts';
import { fixture } from './fixture.ts';

test('EAN/UPC check digits, leading zeros, and equivalent representations', () => {
  for (const [format, value] of [['EAN_13', '4006381333931'], ['EAN_8', '96385074'], ['UPC_A', '012345000065'], ['UPC_E', '01234565']] as const) {
    assert.equal(barcode({ format, value }).value, value);
    assert.throws(() => barcode({ format, value: value.slice(0, -1) + ((Number(value.at(-1)) + 1) % 10) }), /check digit/);
  }
  assert.equal(expandUPCE('01234565'), '012345000065');
  assert.equal(barcodeKey(barcode({ format: 'UPC_E', value: '01234565' })), barcodeKey(barcode({ format: 'EAN_13', value: '0012345000065' })));
  for (const [compressed, expanded] of [['01234500', '012000003450'], ['01234513', '012100003453'], ['01234526', '012200003456'], ['01234531', '012300000451'], ['01234543', '012340000053'], ['11234562', '112345000062']]) assert.equal(expandUPCE(compressed), expanded);
  assert.throws(() => barcode({ format: 'EAN_13', value: '123' }), /13 digits/);
  assert.throws(() => barcode({ format: 'UPC_E', value: '21234565' }), /8 digits/);
  assert.throws(() => barcode({ format: 'CODE_128', value: 'ABC' }), /supported/);
});
test('QR payloads remain literal and are separate from numeric GTINs', () => {
  const qr = barcode({ format: 'QR_CODE', value: ' 4006381333931\n' });
  assert.equal(qr.value, ' 4006381333931\n');
  assert.notEqual(barcodeKey(qr), barcodeKey(barcode({ format: 'EAN_13', value: '4006381333931' })));
  assert.equal(barcode({ format: 'QR_CODE', value: 'https://supplier.test/part?id=23' }).value, 'https://supplier.test/part?id=23');
});
test('old backups gain empty barcode lists and multiple codes survive export/import', () => {
  const old = JSON.parse(JSON.stringify(fixture())); old.materials.forEach((m: Record<string, unknown>) => delete m.barcodes);
  assert.deepEqual(normalize(old).materials[0].barcodes, []);
  const data = fixture(); data.materials[0].barcodes = [{ format: 'EAN_13', value: '4006381333931' }, { format: 'QR_CODE', value: 'fasteners-box' }];
  assert.deepEqual(parseBackup(JSON.stringify(data)), data);
  data.materials[1].barcodes = [data.materials[0].barcodes[0]];
  assert.throws(() => normalize(data), /assigned once/);
  data.materials[0].barcodes = [{ format: 'UPC_A', value: '012345000065' }];
  data.materials[1].barcodes = [{ format: 'UPC_E', value: '01234565' }];
  assert.throws(() => normalize(data), /assigned once/);
});
