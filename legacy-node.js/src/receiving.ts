import { barcode, barcodeKey, type Barcode } from './barcodes.ts';
import { amount, demand, find, text, type Data } from './model.ts';
import { saveEntity } from './forms.ts';
import { changeStock } from './operations.ts';

export interface ReceiptRow {
  materialId: string; quantity: string; code: Barcode | null;
  newMaterial?: { name: string; unit: string; supplierId: string; packQuantity: string; packPrice: string };
}
/** Called inside a single Store.update: assignments, new materials and stock commit together. */
export function receiveMaterials(data: Data, rows: ReceiptRow[], day: string, receiptId: string): Data {
  demand(/^[0-9a-f-]{36}$/.test(receiptId), 'Invalid delivery ID. Reload this page.');
  if (data.movements.some(m => m.id === `${receiptId}_0`)) return data;
  demand(Array.isArray(rows) && rows.length > 0 && rows.length <= 500, 'Add between 1 and 500 received items.');
  const newIds = new Map<string, string>();
  for (const [index, row] of rows.entries()) {
    demand(row && typeof row === 'object', 'Invalid received item.');
    const quantity = amount(row.quantity, 'Received quantity', true);
    const code = row.code === null ? null : barcode(row.code);
    let id = text(row.materialId, 'material');
    if (row.newMaterial && !newIds.has(id)) {
      demand(!data.materials.some(m => m.id === id), 'Choose an existing material instead of creating it again.');
      const m = row.newMaterial;
      const values = { name: [m.name], unit: [m.unit], supplierId: [m.supplierId], packQuantity: [m.packQuantity], packPrice: [m.packPrice] };
      const result = saveEntity(data, 'materials', values, day);
      newIds.set(id, result.id); id = result.id;
    } else id = newIds.get(id) ?? id;
    const material = find(data.materials, id);
    if (code) {
      const key = barcodeKey(code), owner = data.materials.find(m => m.barcodes.some(c => barcodeKey(c) === key));
      demand(!owner || owner.id === id, `Barcode ${code.value} already belongs to ${owner?.name}.`);
      if (!owner) material.barcodes.push(code);
    }
    changeStock(data, 'material', id, quantity, true, 'Received materials');
    data.movements.at(-1)!.id = `${receiptId}_${index}`;
  }
  return data;
}
