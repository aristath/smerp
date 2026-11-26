import { D, active, amount, demand, find, lineQuote, productReservations, quote, remaining, today, type Data, type Quote } from './model.ts';
import { materialReservations, plans } from './planning.ts';
import type { Decimal } from 'decimal.js';

export function confirmOrder(data: Data, id: string, day = today(), timestamp = new Date().toISOString()): Data {
  const order = find(data.orders, id);
  demand(order.status === 'PENDING', 'This order is already confirmed or closed.');
  order.lines = plans(data, day).find(plan => plan.order.id === id)!.lines;
  order.status = 'CONFIRMED'; order.confirmedAt = timestamp; order.currency = data.settings.currency;
  return data;
}
export function cancelOrder(data: Data, id: string): Data {
  const order = find(data.orders, id);
  demand(order.status !== 'CANCELLED' && order.status !== 'COMPLETED', 'This order is already closed.');
  order.status = 'CANCELLED'; return data;
}
function movement(data: Data, item: string, quantity: Decimal.Value, unit: string, note: string) {
  data.movements.push({ id: crypto.randomUUID(), date: new Date().toISOString(), item, quantity: D(quantity).toFixed(), unit, note });
}
function consume(data: Data, q: Quote, count: number, available: Map<string, Decimal>, note: string) {
  demand(Number.isSafeInteger(count) && count > 0 && count <= 1000000, 'Enter a positive whole number of products.');
  for (const ingredient of q.recipe) demand(D(ingredient.quantity).times(count).lte(available.get(ingredient.materialId) ?? 0), `Not enough available ${find(data.materials, ingredient.materialId).name}. Receive missing materials first.`);
  for (const ingredient of q.recipe) {
    const material = find(data.materials, ingredient.materialId), used = D(ingredient.quantity).times(count);
    material.stock = D(material.stock).minus(used).toFixed();
    movement(data, material.name, used.negated(), material.unit, note);
  }
}
export function produce(data: Data, productId: string, count: number, orderId?: string): Data {
  const product = find(data.products, productId), order = orderId ? find(data.orders, orderId) : null;
  demand(!order || active(order), 'Confirm the order before recording production.');
  const line = order?.lines.find(line => line.productId === productId);
  demand(!order || line, 'This product is not in the order.');
  if (line) demand(count <= remaining(line), 'This is more than the order still needs.');
  demand(product.stock + count <= 1000000000, 'Product stock is too large.');
  const reserved = materialReservations(data);
  const available = order ? new Map(plans(data).find(plan => plan.order.id === order.id)!.needs.map(need => [need.material.id, need.allocated])) : new Map(data.materials.map(material => [material.id, D(material.stock).minus(reserved.get(material.id) ?? 0)]));
  const q = line ? lineQuote(data, line) : quote(data, product), note = order ? `Made ${q.name} for ${order.customer}` : `Made ${q.name} for stock`;
  consume(data, q, count, available, note);
  product.stock += count;
  movement(data, q.name, count, 'products', note);
  if (order && line) { line.produced += count; order.status = 'IN_PROGRESS'; }
  return data;
}
export function completeOrder(data: Data, id: string): Data {
  const order = find(data.orders, id);
  demand(active(order), 'This order is already closed or has not been confirmed.');
  demand(order.lines.every(line => remaining(line) === 0), 'Record production for the remaining products first.');
  for (const line of order.lines) demand(find(data.products, line.productId).stock >= line.quantity, 'There are not enough finished products.');
  for (const line of order.lines) { find(data.products, line.productId).stock -= line.quantity; movement(data, lineQuote(data, line).name, -line.quantity, 'products', `Completed order for ${order.customer}`); }
  order.status = 'COMPLETED'; return data;
}
export function changeStock(data: Data, kind: 'material' | 'product', id: string, value: string, receipt: boolean, reason: string): Data {
  const quantity = D(amount(value, 'Quantity', receipt));
  demand(reason.trim(), 'Enter a reason for the stock change.');
  if (kind === 'material') {
    const material = find(data.materials, id), target = receipt ? D(material.stock).plus(quantity) : quantity;
    demand(target.gte(materialReservations(data).get(id) ?? 0), 'This would remove materials reserved for orders. Cancel the affected order first.');
    movement(data, material.name, target.minus(material.stock), material.unit, reason);
    material.stock = amount(target.toFixed(), 'Stock');
  } else {
    demand(quantity.isInteger(), 'Enter a whole number of finished products.');
    const product = find(data.products, id), target = receipt ? D(product.stock).plus(quantity) : quantity;
    demand(target.lte(1000000000), 'Product stock is too large.');
    demand(target.gte(productReservations(data).get(id) ?? 0), 'This would remove products reserved for orders. Cancel the affected order first.');
    movement(data, product.name, target.minus(product.stock), 'products', reason);
    product.stock = target.toNumber();
  }
  return data;
}
export function deleteRecord(data: Data, kind: 'suppliers' | 'materials' | 'products' | 'orders', id: string): Data {
  find<{ id: string }>(data[kind], id);
  if (kind === 'suppliers') demand(!data.materials.some(material => material.supplierId === id), 'This supplier is used by a material.');
  if (kind === 'materials') {
    demand(D(find(data.materials, id).stock).isZero(), 'Set stock to zero before deleting this material.');
    demand(!data.products.some(p => p.recipe.some(r => r.materialId === id)) && !data.orders.some(o => o.lines.some(l => l.quote?.recipe.some(r => r.materialId === id))), 'This material is used by a product or saved order.');
  }
  if (kind === 'products') {
    demand(find(data.products, id).stock === 0, 'Set stock to zero before deleting this product.');
    demand(!data.orders.some(order => order.lines.some(line => line.productId === id)), 'This product is used by an order.');
  }
  if (kind === 'suppliers') data.suppliers = data.suppliers.filter(item => item.id !== id);
  if (kind === 'materials') data.materials = data.materials.filter(item => item.id !== id);
  if (kind === 'products') data.products = data.products.filter(item => item.id !== id);
  if (kind === 'orders') data.orders = data.orders.filter(item => item.id !== id);
  return data;
}
