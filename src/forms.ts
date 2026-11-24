import { barcode } from './barcodes.ts';
import { amount, demand, find, integer, minimumPrice, quote, text, date, type Data, type Ingredient, type Order, type Product } from './model.ts';
export type Fields = Record<string, string[]>;
export type Section = 'suppliers' | 'materials' | 'products' | 'orders';
export function fields(form: FormData): Fields {
  const result: Fields = {};
  for (const [key, value] of form) { demand(typeof value === 'string', 'Unexpected file in this form.'); (result[key] ??= []).push(value); }
  return result;
}
export const get = (values: Fields, key: string, fallback = '') => values[key]?.[0] ?? fallback;
export const all = (values: Fields, key: string) => values[key] ?? [];
export const optionalAmount = (value: string) => value.trim() ? amount(value, 'Warning threshold') : null;
function put<T extends { id: string }>(items: T[], item: T) { const index = items.findIndex(current => current.id === item.id); if (index < 0) items.push(item); else items[index] = item; }
export function recipe(values: Fields): Ingredient[] {
  const materials = all(values, 'recipeMaterial'), quantities = all(values, 'recipeQuantity');
  demand(materials.length > 0 && materials.length === quantities.length && new Set(materials).size === materials.length, 'Add each required material once.');
  return materials.map((materialId, index) => ({ materialId: text(materialId, 'material'), quantity: amount(quantities[index], 'Material quantity', true) }));
}
export function draftProduct(values: Fields, id: string, current?: Product): Product {
  return { id, name: get(values, 'name').trim(), minutes: amount(get(values, 'minutes'), 'Production time'), recipe: recipe(values), stock: current?.stock ?? 0, threshold: get(values, 'threshold').trim() ? integer(get(values, 'threshold'), 'Warning threshold') : null };
}
export function draftOrder(data: Data, values: Fields, id: string, day: string, preview = false): Order {
  const products = all(values, 'lineProduct'), quantities = all(values, 'lineQuantity'), prices = all(values, 'linePrice');
  demand(products.length > 0 && products.length === quantities.length && products.length === prices.length && new Set(products).size === products.length, 'Add each ordered product once.');
  const current = data.orders.find(order => order.id === id);
  demand(!current || current.status === 'PENDING', 'Confirmed orders cannot be edited.');
  return { id, customer: preview ? get(values, 'customer').trim() || 'Order preview' : text(get(values, 'customer'), 'customer name'), contact: get(values, 'contact').trim(),
    requestedDate: get(values, 'requestedDate') ? date(get(values, 'requestedDate')) : null, createdDate: current?.createdDate ?? day, status: 'PENDING', confirmedAt: null, currency: null,
    lines: products.map((productId, index) => ({ productId, quantity: integer(quantities[index], 'Order quantity', 1), price: preview && !prices[index] ? minimumPrice(quote(data, find(data.products, productId))).toFixed(2) : amount(prices[index], 'Selling price'), quote: null, fromStock: 0, produced: 0 })) };
}
export function saveEntity(data: Data, section: Section, values: Fields, day: string): { data: Data; id: string } {
  const suppliedId = get(values, 'id');
  if (suppliedId) find<{ id: string }>(data[section], suppliedId);
  const id = suppliedId || crypto.randomUUID();
  if (section === 'suppliers') put(data.suppliers, { id, name: text(get(values, 'name'), 'supplier name'), contact: get(values, 'contact').trim(), leadDays: integer(get(values, 'leadDays'), 'Delivery time', 0, 365) });
  if (section === 'materials') put(data.materials, { barcodes: values.barcodeValue ? all(values, 'barcodeValue').map((value, index) => barcode({ value, format: all(values, 'barcodeFormat')[index] })) : values.barcodesEdited ? [] : data.materials.find(item => item.id === id)?.barcodes ?? [], id, name: text(get(values, 'name'), 'material name'), unit: text(get(values, 'unit'), 'measurement unit'), supplierId: text(get(values, 'supplierId'), 'supplier'), packQuantity: amount(get(values, 'packQuantity'), 'Purchase quantity', true), packPrice: amount(get(values, 'packPrice'), 'Purchase price'), stock: data.materials.find(item => item.id === id)?.stock ?? '0', threshold: optionalAmount(get(values, 'threshold')) });
  if (section === 'products') { const product = draftProduct(values, id, data.products.find(product => product.id === id)); product.name = text(product.name, 'product name'); put(data.products, product); }
  if (section === 'orders') put(data.orders, draftOrder(data, values, id, day));
  return { data, id };
}
