import { barcode, barcodeKey, type Barcode } from './barcodes.ts';
import { Decimal } from 'decimal.js';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });
export const D = (value: Decimal.Value) => new Decimal(value);
export const sum = (values: Decimal.Value[]) => values.reduce<Decimal>((total, value) => total.plus(value), D(0));
export const money = (value: Decimal.Value, currency: string) => `${currency} ${D(value).toFixed(2)}`;
export function demand(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export function amount(value: unknown, label = 'Quantity', positive = false): string {
  demand(typeof value === 'string' || typeof value === 'number', `${label} is missing.`);
  let number: Decimal;
  try { number = D(String(value).trim().replace(',', '.')); } catch { throw new Error(`Enter a valid ${label.toLowerCase()}.`); }
  demand(number.isFinite() && number.abs().lte('1000000000') && number.decimalPlaces() <= 6, `${label} must have up to 6 decimal places and be at most 1,000,000,000.`);
  demand(positive ? number.gt(0) : number.gte(0), `${label} must be ${positive ? 'greater than zero' : 'zero or greater'}.`);
  return number.toFixed();
}
export function integer(value: unknown, label = 'Quantity', minimum = 0, maximum = 1000000): number {
  demand(typeof value === 'number' || typeof value === 'string', `${label} is missing.`);
  demand(/^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= maximum, `${label} must be a whole number from ${minimum} to ${maximum}.`);
  return Number(value);
}
export function text(value: unknown, label: string, required = true): string {
  demand(typeof value === 'string' && value.length <= 4000 && (!required || value.trim().length > 0), `Enter ${label.toLowerCase()}.`);
  return value.trim();
}
export function date(value: unknown): string {
  demand(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value, 'Choose a valid date.');
  return value;
}
export function today(timeZone = 'Europe/Athens'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export const nextDate = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
export const weekday = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
export function businessDays(start: string, days: number): string {
  let day = start;
  while (days > 0) { day = nextDate(day); if (weekday(day) < 5) days--; }
  return day;
}
export const active = (order: Order) => order.status === 'CONFIRMED' || order.status === 'IN_PROGRESS';
export const remaining = (line: OrderLine) => line.quantity - line.fromStock - line.produced;
export const statuses = { PENDING: 'Pending', CONFIRMED: 'Confirmed', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' } as const;
export type Status = keyof typeof statuses;
export interface Supplier { id: string; name: string; contact: string; leadDays: number }
export interface Material { barcodes: Barcode[]; id: string; name: string; unit: string; packQuantity: string; packPrice: string; supplierId: string; stock: string; threshold: string | null }
export interface Ingredient { materialId: string; quantity: string }
export interface Product { id: string; name: string; minutes: string; recipe: Ingredient[]; stock: number; threshold: number | null }
export interface FrozenIngredient extends Ingredient { packQuantity: string; packPrice: string }
export interface Quote { name: string; minutes: string; hourlyRate: string; recipe: FrozenIngredient[] }
export interface OrderLine { productId: string; quantity: number; price: string; quote: Quote | null; fromStock: number; produced: number }
export interface Order { id: string; customer: string; contact: string; requestedDate: string | null; createdDate: string; status: Status; confirmedAt: string | null; lines: OrderLine[]; currency: string | null }
export interface Movement { id: string; date: string; item: string; quantity: string; unit: string; note: string }
export const backupFormat = 'smerp-backup';
const earlierBackupFormat = /^ky(?:nerp|no)-backup$/;
export interface Data {
  format: typeof backupFormat; version: 1;
  settings: { title: string; subtitle: string; hourlyRate: string; currency: string };
  schedule: { hours: string[]; daysOff: string[] };
  suppliers: Supplier[]; materials: Material[]; products: Product[]; orders: Order[]; movements: Movement[];
}
const defaultSettings = { title: 'Workspace', subtitle: 'Production planning', hourlyRate: '15', currency: 'EUR' };
export const emptyData = (): Data => ({ format: backupFormat, version: 1, settings: { ...defaultSettings }, schedule: { hours: ['4', '4', '4', '4', '4', '0', '0'], daysOff: [] }, suppliers: [], materials: [], products: [], orders: [], movements: [] });
export function find<T extends { id: string }>(items: T[], id: string): T { const item = items.find(item => item.id === id); demand(item, 'This record no longer exists. Refresh the page.'); return item; }
export function quote(data: Data, product: Product): Quote {
  return { name: product.name, minutes: product.minutes, hourlyRate: data.settings.hourlyRate, recipe: product.recipe.map(ingredient => {
    const material = find(data.materials, ingredient.materialId);
    return { ...ingredient, packQuantity: material.packQuantity, packPrice: material.packPrice };
  }) };
}
export const lineQuote = (data: Data, line: OrderLine) => line.quote ?? quote(data, find(data.products, line.productId));
export const materialCost = (quote: Quote) => sum(quote.recipe.map(ingredient => D(ingredient.quantity).times(ingredient.packPrice).div(ingredient.packQuantity)));
export const labourCost = (quote: Quote) => D(quote.minutes).times(quote.hourlyRate).div(60);
export const minimumPrice = (quote: Quote) => materialCost(quote).plus(labourCost(quote)).toDecimalPlaces(2, Decimal.ROUND_CEIL);
export function productReservations(data: Data): Map<string, number> {
  const result = new Map<string, number>();
  for (const order of data.orders.filter(active)) for (const line of order.lines) result.set(line.productId, (result.get(line.productId) ?? 0) + line.fromStock + line.produced);
  return result;
}
export const availableProducts = (data: Data, product: Product) => product.stock - (productReservations(data).get(product.id) ?? 0);

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue { demand(value !== null && typeof value === 'object' && !Array.isArray(value), 'A backup record is missing or invalid.'); return value as ObjectValue; }
function array(value: unknown): unknown[] { demand(Array.isArray(value), 'A backup list is missing or invalid.'); return value; }
function nullable<T>(value: unknown, convert: (v: unknown) => T): T | null { demand(value !== undefined, 'A backup field is missing.'); return value === null ? null : convert(value); }
function unique(items: { id: string; name?: string }[]) {
  demand(items.every(item => /^[A-Za-z0-9_-]{1,120}$/.test(item.id)), 'A record ID is invalid.');
  demand(new Set(items.map(item => item.id)).size === items.length, 'Duplicate record IDs in backup.');
  const names = items.filter(item => item.name !== undefined).map(item => item.name!.toLowerCase());
  demand(new Set(names).size === names.length, 'Each item must have a different name.');
}
function readQuote(value: unknown): Quote {
  const q = object(value);
  const recipe = array(q.recipe).map(value => { const r = object(value); return { materialId: text(r.materialId, 'material'), quantity: amount(r.quantity, 'Material quantity', true), packQuantity: amount(r.packQuantity, 'Purchase quantity', true), packPrice: amount(r.packPrice, 'Purchase price') }; });
  demand(recipe.length > 0 && new Set(recipe.map(r => r.materialId)).size === recipe.length, 'Add each recipe material once.');
  return { name: text(q.name, 'product name'), minutes: amount(q.minutes, 'Production time'), hourlyRate: amount(q.hourlyRate, 'Hourly rate'), recipe };
}
/** Rebuild every record explicitly, rejecting incomplete backups instead of inventing defaults. */
export function normalize(value: unknown): Data {
  const root = object(value), settings = object(root.settings), schedule = object(root.schedule);
  const supportedFormat = typeof root.format === 'string' && (root.format === backupFormat || earlierBackupFormat.test(root.format));
  demand(supportedFormat && integer(root.version, 'Backup version', 1, 1) === 1, 'This backup is not supported by Smerp.');
  const currency = text(settings.currency, 'currency code').toUpperCase();
  demand(/^[A-Z]{3}$/.test(currency) && Intl.supportedValuesOf('currency').includes(currency), 'Enter a valid currency code, such as EUR.');
  const data: Data = {
    format: backupFormat, version: 1,
    settings: {
      title: settings.title === undefined ? defaultSettings.title : text(settings.title, 'a title'),
      subtitle: settings.subtitle === undefined ? defaultSettings.subtitle : text(settings.subtitle, 'a subtitle', false),
      hourlyRate: amount(settings.hourlyRate, 'Hourly rate'),
      currency,
    },
    schedule: { hours: array(schedule.hours).map(value => amount(value, 'Working hours')), daysOff: array(schedule.daysOff).map(date) },
    suppliers: array(root.suppliers).map(value => { const s = object(value); return { id: text(s.id, 'supplier ID'), name: text(s.name, 'supplier name'), contact: text(s.contact, 'contact details', false), leadDays: integer(s.leadDays, 'Delivery time', 0, 365) }; }),
    materials: array(root.materials).map(value => { const m = object(value); return { barcodes: m.barcodes === undefined ? [] : array(m.barcodes).map(barcode), id: text(m.id, 'material ID'), name: text(m.name, 'material name'), unit: text(m.unit, 'measurement unit'), packQuantity: amount(m.packQuantity, 'Purchase quantity', true), packPrice: amount(m.packPrice, 'Purchase price'), supplierId: text(m.supplierId, 'supplier'), stock: amount(m.stock, 'Stock'), threshold: nullable(m.threshold, value => amount(value, 'Warning threshold')) }; }),
    products: array(root.products).map(value => { const p = object(value); return { id: text(p.id, 'product ID'), name: text(p.name, 'product name'), minutes: amount(p.minutes, 'Production time'), recipe: array(p.recipe).map(value => { const r = object(value); return { materialId: text(r.materialId, 'material'), quantity: amount(r.quantity, 'Material quantity', true) }; }), stock: integer(p.stock, 'Stock', 0, 1000000000), threshold: nullable(p.threshold, value => integer(value, 'Warning threshold')) }; }),
    orders: array(root.orders).map(value => { const o = object(value); demand(typeof o.status === 'string' && Object.hasOwn(statuses, o.status), 'Choose a valid order status.'); return {
      id: text(o.id, 'order ID'), customer: text(o.customer, 'customer name'), contact: text(o.contact, 'customer contact', false), requestedDate: nullable(o.requestedDate, date), createdDate: date(o.createdDate), status: o.status as Status,
      confirmedAt: nullable(o.confirmedAt, value => { const timestamp = text(value, 'confirmation date'); demand(Number.isFinite(Date.parse(timestamp)) && /^\d{4}-\d\d-\d\dT/.test(timestamp), 'Invalid confirmation date.'); return timestamp; }),
      currency: nullable(o.currency, value => { const code = text(value, 'saved currency'); demand(Intl.supportedValuesOf('currency').includes(code), 'Invalid saved currency.'); return code; }),
      lines: array(o.lines).map(value => { const l = object(value); return { productId: text(l.productId, 'product'), quantity: integer(l.quantity, 'Order quantity', 1), price: amount(l.price, 'Selling price'), quote: nullable(l.quote, readQuote), fromStock: integer(l.fromStock, 'Reserved stock'), produced: integer(l.produced, 'Produced quantity') }; })
    }; }),
    movements: array(root.movements).map(value => { const m = object(value); demand(typeof m.quantity === 'string' || typeof m.quantity === 'number', 'Invalid stock change.'); const quantity = D(m.quantity); demand(quantity.isFinite() && quantity.abs().lte('1000000000') && quantity.decimalPlaces() <= 6, 'Invalid stock change.'); const timestamp = text(m.date, 'stock change date'); demand(Number.isFinite(Date.parse(timestamp)), 'Invalid stock change date.'); return { id: text(m.id, 'stock change ID'), date: timestamp, item: text(m.item, 'item name'), quantity: quantity.toFixed(), unit: text(m.unit, 'unit'), note: text(m.note, 'stock change reason') }; })
  };
  demand(data.schedule.hours.length === 7 && data.schedule.hours.every(hours => D(hours).lte(24)), 'Set 0–24 working hours for each day.');
  for (const items of [data.suppliers, data.materials, data.products, data.orders, data.movements]) unique(items);
  const assignedCodes = new Set<string>();
  for (const material of data.materials) {
    find(data.suppliers, material.supplierId);
    for (const code of material.barcodes) { const key = barcodeKey(code); demand(!assignedCodes.has(key), 'Each barcode can only be assigned once. Check the materials’ barcodes.'); assignedCodes.add(key); }
  }
  for (const product of data.products) {
    demand(product.recipe.length > 0 && new Set(product.recipe.map(r => r.materialId)).size === product.recipe.length, 'Add each required material once.');
    product.recipe.forEach(r => find(data.materials, r.materialId));
  }
  for (const order of data.orders) {
    demand(order.lines.length > 0 && new Set(order.lines.map(l => l.productId)).size === order.lines.length, 'Add each ordered product once.');
    if (active(order) || order.status === 'COMPLETED') demand(order.confirmedAt && order.currency, 'Missing saved confirmation details.');
    for (const line of order.lines) {
      find(data.products, line.productId);
      demand(remaining(line) >= 0, 'Reserved and produced quantities exceed the order.');
      if (order.status === 'PENDING') demand(!line.quote && line.fromStock === 0 && line.produced === 0 && !order.confirmedAt, 'Pending orders cannot reserve stock.');
      if (order.confirmedAt || active(order) || order.status === 'COMPLETED') demand(line.quote, 'Missing confirmed order costs.');
      if (line.quote) line.quote.recipe.forEach(r => find(data.materials, r.materialId));
      if (order.status === 'COMPLETED') demand(remaining(line) === 0, 'A completed order still has unfinished products.');
    }
  }
  const reservations = productReservations(data);
  for (const product of data.products) demand(product.stock >= (reservations.get(product.id) ?? 0), 'Stock is below the quantity reserved for orders.');
  return data;
}
export const MAX_BYTES = 10 * 1024 * 1024;
export function parseBackup(source: string): Data {
  demand(new TextEncoder().encode(source).length <= MAX_BYTES, 'Backup exceeds 10 MB.');
  try {
    // Source text preserves Android's decimal literals before JavaScript can round them.
    const parsed = JSON.parse(source, (_key: string, value: unknown, context?: { source: string }) => typeof value === 'number' && context ? context.source : value);
    return normalize(parsed);
  } catch (error) { throw new Error(`Cannot restore this backup. ${error instanceof Error ? error.message : 'Invalid JSON.'}`); }
}
