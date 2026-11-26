export const barcodeFormats = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'QR_CODE'] as const;
export type BarcodeFormat = typeof barcodeFormats[number];
export interface Barcode { format: BarcodeFormat; value: string }

/** UPC-E's six compressed digits expand to the UPC-A manufacturer/item number. */
export function expandUPCE(value: string): string {
  const [system, a, b, c, d, e, last, check] = value;
  if ('012'.includes(last)) return `${system}${a}${b}${last}0000${c}${d}${e}${check}`;
  if (last === '3') return `${system}${a}${b}${c}00000${d}${e}${check}`;
  if (last === '4') return `${system}${a}${b}${c}${d}00000${e}${check}`;
  return `${system}${a}${b}${c}${d}${e}0000${last}${check}`;
}
export function barcode(value: unknown): Barcode {
  if (!value || typeof value !== 'object') throw new Error('Enter a barcode and its format.');
  const code = value as Barcode;
  if (!barcodeFormats.includes(code.format) || typeof code.value !== 'string' || !code.value.length || code.value.length > 4000) throw new Error('Enter a supported barcode (up to 4,000 characters).');
  if (code.format === 'QR_CODE') return { format: code.format, value: code.value };
  const digits = code.value.trim(), length = { EAN_13: 13, EAN_8: 8, UPC_A: 12, UPC_E: 8 }[code.format];
  if (!new RegExp(`^\\d{${length}}$`).test(digits) || (code.format === 'UPC_E' && !/^[01]/.test(digits))) throw new Error(`Enter all ${length} digits for ${code.format.replace('_', '-')}, including the check digit.`);
  const expanded = code.format === 'UPC_E' ? expandUPCE(digits) : digits;
  let sum = 0;
  for (let i = expanded.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(expanded[i]) * weight;
  if ((10 - sum % 10) % 10 !== Number(expanded.at(-1))) throw new Error('Invalid barcode check digit. Check the printed number.');
  return { format: code.format, value: digits };
}
/** Match equivalent UPC/EAN representations while keeping QR payloads separate. */
export function barcodeKey(code: Barcode): string {
  return code.format === 'QR_CODE' ? `qr:${code.value}` : `gtin:${(code.format === 'UPC_E' ? expandUPCE(code.value) : code.value).padStart(14, '0')}`;
}
