import { test } from 'node:test';
import assert from 'node:assert/strict';
import { D, active, amount, availableProducts, businessDays, emptyData, find, labourCost, lineQuote, materialCost, minimumPrice, normalize, parseBackup, productReservations, quote } from '../src/model.ts';
import { materialRequirements, materialReservations, plans } from '../src/planning.ts';
import { cancelOrder, changeStock, completeOrder, confirmOrder, deleteRecord, produce } from '../src/operations.ts';
import { duration } from '../src/views.ts';
import { addOrder, fixture, monday } from './fixture.ts';

const eq = (actual: { toString(): string }, expected: string) => assert(D(actual.toString()).eq(expected), `${actual} should equal ${expected}`);
const confirm = (data: ReturnType<typeof fixture>, id = 'order', timestamp = '2026-11-16T09:00:00Z') => confirmOrder(data, id, monday, timestamp);

test('calculates recipe costs, labour, and minimum selling price', () => {
  const data = fixture(), q = quote(data, data.products[0]);
  eq(materialCost(q), '0.8'); eq(labourCost(q), '1.5'); eq(minimumPrice(q), '2.30');
});
test('rounds the recommended price up to cover materials and pay', () => { const data = fixture(); data.settings.hourlyRate = '18.01'; eq(minimumPrice(quote(data, data.products[0])), '2.31'); });
test('accepts decimal commas and rejects invalid quantities', () => { assert.equal(amount('0,3'), '0.3'); for (const value of ['NaN', 'Infinity', '-1', '1.1234567', '1000000001']) assert.throws(() => amount(value)); });
test('preview uses products from stock without reserving anything', () => {
  const data = addOrder(fixture(20)), plan = plans(data, monday)[0];
  assert.equal(plan.lines[0].fromStock, 20); eq(plan.minutes, '400'); assert.equal(materialReservations(data).size, 0); assert.equal(availableProducts(data, data.products[0]), 20);
});
test('calculates shortages, whole purchase packs, delivery, and completion', () => {
  const plan = plans(addOrder(fixture(20)), monday)[0], fasteners = plan.needs.find(n => n.material.id === 'fasteners')!;
  eq(fasteners.required, '320'); eq(fasteners.allocated, '100'); eq(fasteners.shortage, '220'); eq(fasteners.purchaseQuantity, '300'); eq(fasteners.purchaseCost, '30');
  assert.equal(fasteners.arrival, '2026-11-23'); assert.equal(plan.completion, '2026-11-24'); eq(plan.needs.find(n => n.material.id === 'sheet')!.required, '24');
});
test('100 units at five minutes take eight hours twenty minutes', () => assert.equal(duration(plans(addOrder(fixture()), monday)[0].minutes), '8h 20m'));
test('shows actual stock availability rather than capping it at the requirement', () => { const fasteners = plans(addOrder(fixture(), 'order', 2), monday)[0].needs[0]; eq(fasteners.stockAvailable, '100'); eq(fasteners.allocated, '8'); });
test('two confirmed orders cannot double-reserve stock', () => {
  const data = confirm(addOrder(fixture(20))); addOrder(data, 'second'); confirm(data, 'second', '2026-11-16T10:00:00Z');
  const estimates = plans(data, monday); assert.equal(productReservations(data).get('tray'), 20); eq(estimates[0].needs[0].allocated, '100'); eq(estimates[1].needs[0].allocated, '0'); assert.equal(estimates[1].lines[0].fromStock, 0); normalize(data);
});
test('stock priority follows confirmation time, including fractional timestamps', () => {
  const data = addOrder(addOrder(fixture(), 'createdFirst', 25), 'confirmedFirst', 25);
  confirm(data, 'confirmedFirst'); confirm(data, 'createdFirst', '2026-11-16T09:00:00.100Z');
  const estimates = plans(data, monday); assert.equal(estimates[0].order.id, 'confirmedFirst'); eq(estimates[0].needs[0].allocated, '100'); eq(estimates[1].needs[0].allocated, '0');
});
test('confirmation freezes recipe, production time, prices, pay, and currency', () => {
  const data = confirm(addOrder(fixture())); data.settings = { ...data.settings, hourlyRate: '99', currency: 'USD' }; data.materials.forEach(m => m.packPrice = '999'); data.products[0].name = 'Renamed'; data.products[0].minutes = '90'; data.products[0].recipe = [{ materialId: 'fasteners', quantity: '1' }];
  const q = lineQuote(data, data.orders[0].lines[0]); eq(minimumPrice(q), '2.30'); eq(plans(data, monday)[0].minutes, '500'); assert.equal(q.name, 'Small storage tray'); assert.equal(data.orders[0].currency, 'EUR'); assert.equal(data.orders[0].lines[0].price, '5');
});
test('partial production consumes materials and reserves its finished products', () => {
  const data = produce(confirm(addOrder(fixture(20))), 'tray', 10, 'order');
  eq(data.materials[0].stock, '60'); eq(data.materials[1].stock, '47'); assert.equal(data.products[0].stock, 30); assert.equal(productReservations(data).get('tray'), 30); assert.equal(data.orders[0].lines[0].produced, 10); assert.equal(data.orders[0].status, 'IN_PROGRESS'); normalize(data);
});
test('other orders and independent production cannot steal reserved materials', () => {
  const data = confirm(addOrder(fixture())); assert.throws(() => produce(structuredClone(data), 'tray', 1)); addOrder(data, 'second', 1); confirm(data, 'second', '2026-11-16T11:00:00Z');
  assert.throws(() => produce(structuredClone(data), 'tray', 1, 'second')); assert.throws(() => produce(structuredClone(data), 'tray', 26, 'order'));
});
test('cancellation releases reservations while retaining finished products and consumed materials', () => {
  const data = cancelOrder(produce(confirm(addOrder(fixture(20))), 'tray', 10, 'order'), 'order');
  eq(data.materials[0].stock, '60'); assert.equal(data.products[0].stock, 30); assert.equal(productReservations(data).size, 0); assert.equal(materialReservations(data).size, 0); normalize(data);
});
test('receipts, production, and handover consume quantities exactly once', () => {
  const data = confirm(addOrder(fixture(20))); changeStock(data, 'material', 'fasteners', '300', true, 'Delivery'); produce(data, 'tray', 80, 'order'); assert.equal(data.products[0].stock, 100); completeOrder(data, 'order');
  assert.equal(data.products[0].stock, 0); eq(data.materials[0].stock, '80'); assert.throws(() => completeOrder(data, 'order')); assert.throws(() => cancelOrder(data, 'order')); normalize(data);
});
test('unfinished orders cannot be completed or over-produced', () => { const data = confirm(addOrder(fixture(), 'order', 2)); assert.throws(() => completeOrder(data, 'order')); assert.throws(() => produce(data, 'tray', 3, 'order')); });
test('independent production consumes the current recipe and adds stock', () => { const data = produce(fixture(), 'tray', 2); assert.equal(data.products[0].stock, 2); eq(data.materials[0].stock, '92'); assert.equal(data.movements.length, 3); });
test('count corrections protect reservations and reject fractional product counts', () => {
  const data = confirm(addOrder(fixture(20))); assert.throws(() => changeStock(data, 'material', 'fasteners', '50', false, 'Count')); assert.throws(() => changeStock(data, 'product', 'tray', '10', false, 'Count')); assert.throws(() => changeStock(fixture(), 'product', 'tray', '1.5', true, 'Received')); assert.throws(() => changeStock(fixture(), 'material', 'fasteners', '-1', true, 'Received'));
  eq(changeStock(fixture(), 'material', 'fasteners', '0', false, 'Count').materials[0].stock, '0');
});
test('ready-made orders can be completed without working hours', () => { const data = addOrder(fixture(100)); data.schedule.hours.fill('0.0'); assert.equal(plans(data, monday)[0].completion, monday); });
test('working days, days off, and existing workload share a daily calendar', () => {
  const data = fixture(); data.materials.forEach(m => m.stock = '10000'); data.schedule = { hours: ['1', '1', '1', '1', '1', '0', '0'], daysOff: [monday] }; addOrder(data, 'first', 12); addOrder(data, 'second', 12); confirm(data, 'first'); confirm(data, 'second', '2026-11-16T10:00:00Z');
  const estimates = plans(data, monday); assert.equal(estimates[0].completion, '2026-11-17'); assert.equal(estimates[1].completion, '2026-11-18'); assert.equal(businessDays('2026-11-20', 1), '2026-11-23');
});
test('no working hours produces an explanation instead of a misleading date', () => { const data = addOrder(fixture()); data.schedule.hours.fill('0'); const plan = plans(data, monday)[0]; assert.equal(plan.completion, null); assert.match(plan.reason!, /working hours/); });
test('backup round trip retains records, frozen costs, history, and days off', () => { const data = produce(confirm(addOrder(fixture(20))), 'tray', 10, 'order'); data.schedule.daysOff.push('2026-12-25'); assert.deepEqual(parseBackup(JSON.stringify(data)), data); });
test('imports the Android format and preserves decimal source precision', () => {
  const data = fixture(); const legacy = JSON.parse(JSON.stringify(data)); legacy.format = 'smerp-backup'; legacy.materials[0].stock = 999999999;
  legacy.settings = { hourlyRate: '18', currency: 'EUR' };
  const source = JSON.stringify(legacy).replace('"stock":999999999', '"stock":999999999.123456');
  const imported = parseBackup(source); assert.equal(imported.format, 'smerp-backup'); assert.equal(imported.materials[0].stock, '999999999.123456');
  assert.deepEqual(imported.settings, data.settings);
});
test('invalid backups are rejected in full', () => {
  const data = addOrder(fixture());
  for (const damaged of [{ ...data, version: 2 }, { ...data, settings: { ...data.settings, currency: 123 } }, { ...data, materials: data.materials.map(m => ({ ...m, supplierId: 'missing' })) }, { ...data, schedule: { ...data.schedule, hours: ['4'] } }]) assert.throws(() => parseBackup(JSON.stringify(damaged)));
  assert.throws(() => parseBackup('{}')); assert.throws(() => parseBackup('not json')); assert.throws(() => parseBackup(JSON.stringify(data) + 'garbage'));
});
test('missing fields, duplicate IDs, and impossible reservations are rejected', () => {
  const data = confirm(addOrder(fixture(20))); assert.throws(() => normalize({ ...data, products: data.products.map(p => ({ ...p, stock: 0 })) })); assert.throws(() => normalize({ ...data, materials: [...data.materials, data.materials[0]] }));
  const damaged = JSON.parse(JSON.stringify(data)); delete damaged.materials[1].threshold; assert.throws(() => normalize(damaged));
});
test('used records cannot be deleted', () => { const data = confirm(addOrder(fixture())); for (const [kind, id] of [['suppliers', 'supplier'], ['materials', 'fasteners'], ['products', 'tray']] as const) assert.throws(() => deleteRecord(data, kind, id)); });
test('deleting a partially produced order releases reservations without undoing stock or history', () => {
  const data = confirm(addOrder(fixture(2), 'order', 8));
  produce(data, 'tray', 3, 'order'); addOrder(data, 'other', 1);
  assert.equal(availableProducts(data, data.products[0]), 0);
  eq(materialReservations(data).get('fasteners')!, '12');
  const before = structuredClone(data);
  deleteRecord(data, 'orders', 'order');
  assert.deepEqual(data.orders.map(order => order.id), ['other']);
  assert.deepEqual(data.materials, before.materials); assert.deepEqual(data.products, before.products); assert.deepEqual(data.movements, before.movements);
  assert.equal(availableProducts(data, data.products[0]), 5);
  assert.equal(materialReservations(data).size, 0);
  assert.deepEqual(normalize(data), data);
});
test('pending, confirmed, cancelled and completed orders can be deleted without changing inventory', () => {
  for (const status of ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED']) {
    const data = addOrder(fixture(2), 'order', 4);
    if (status === 'CONFIRMED' || status === 'COMPLETED') confirm(data);
    if (status === 'CANCELLED') cancelOrder(data, 'order');
    if (status === 'COMPLETED') { produce(data, 'tray', 2, 'order'); completeOrder(data, 'order'); }
    const before = structuredClone(data);
    deleteRecord(data, 'orders', 'order');
    assert.equal(data.orders.length, 0);
    assert.deepEqual(data.materials, before.materials); assert.deepEqual(data.products, before.products); assert.deepEqual(data.movements, before.movements);
    assert.deepEqual(normalize(data), data);
    assert.throws(() => deleteRecord(data, 'orders', 'order'), /no longer exists/);
  }
});
test('different products share materials and finished stock correctly', () => {
  const data = fixture(2); data.products.push({ ...structuredClone(data.products[0]), id: 'large', name: 'Large storage tray', stock: 1, recipe: [{ materialId: 'fasteners', quantity: '2' }, { materialId: 'sheet', quantity: '0.5' }] }); addOrder(data, 'mixed', 5); data.orders[0].lines.push({ productId: 'large', quantity: 3, price: '6', quote: null, fromStock: 0, produced: 0 }); confirm(data, 'mixed');
  const plan = plans(data, monday)[0]; eq(plan.needs[0].required, '16'); eq(plan.needs[1].required, '1.9'); produce(data, 'tray', 3, 'mixed'); produce(data, 'large', 2, 'mixed'); completeOrder(data, 'mixed'); assert(data.products.every(p => p.stock === 0)); eq(data.materials[0].stock, '84'); assert.deepEqual(parseBackup(JSON.stringify(data)), data);
});
test('receiving shortages brings the completion estimate forward', () => { const data = confirm(addOrder(fixture(), 'order', 30)); assert.equal(plans(data, monday)[0].completion, '2026-11-23'); changeStock(data, 'material', 'fasteners', '100', true, 'Delivery'); assert.equal(plans(data, monday)[0].completion, monday); });
test('cancelled and completed orders round trip', () => { const data = cancelOrder(addOrder(fixture()), 'order'); assert.deepEqual(parseBackup(JSON.stringify(data)), data); const complete = completeOrder(confirm(addOrder(fixture(100))), 'order'); assert.deepEqual(parseBackup(JSON.stringify(complete)), complete); });
test('backup size limits are enforced', () => assert.throws(() => parseBackup(' '.repeat(10 * 1024 * 1024 + 1))));
test('normalizing an empty app retains sensible defaults', () => assert.deepEqual(normalize(emptyData()), emptyData()));
test('material totals retain cut sizes and combine stock requirements across products and orders', () => {
  const data = fixture(); data.materials[1].stock = '135';
  data.products[0].recipe = [{ materialId: 'sheet', quantity: '0.50' }];
  data.products.push({ ...structuredClone(data.products[0]), id: 'large', name: 'Large storage tray', recipe: [{ materialId: 'sheet', quantity: '0.4' }] });
  addOrder(data, 'small', 30); addOrder(data, 'large-order', 50); data.orders[1].lines[0].productId = 'large';
  const before = structuredClone(data), result = materialRequirements(data), sheet = result.total[0];
  assert.deepEqual(sheet.items, [{ quantity: '0.5', count: 30 }, { quantity: '0.4', count: 50 }]);
  eq(sheet.required, '35'); eq(sheet.balance, '100');
  eq(result.perOrder[0].needs[0].balance, '120'); eq(result.perOrder[1].needs[0].balance, '100');
  assert.deepEqual(data, before);
});
test('combined material previews share ready-made stock once between pending orders', () => {
  const data = addOrder(addOrder(fixture(10), 'first', 8), 'second', 8);
  const result = materialRequirements(data);
  assert.equal(result.perOrder[0].needs.length, 0);
  eq(result.total.find(need => need.material.id === 'fasteners')!.required, '24');
  eq(result.total.find(need => need.material.id === 'sheet')!.required, '1.8');
  assert.deepEqual(result.perOrder[1].needs.find(need => need.material.id === 'fasteners')!.items, [{ quantity: '4', count: 6 }]);
  data.orders[1].requestedDate = '2026-11-29';
  const reordered = materialRequirements(data);
  assert.equal(reordered.perOrder[0].order.id, 'second'); assert.equal(reordered.perOrder[0].needs.length, 0);
  eq(reordered.perOrder[1].needs.find(need => need.material.id === 'fasteners')!.required, '24');
});
test('material previews exclude completed work and use frozen recipes alongside pending recipes', () => {
  const data = confirm(addOrder(fixture(2), 'order', 8)); produce(data, 'tray', 2, 'order');
  changeStock(data, 'product', 'tray', '3', true, 'Ready stock');
  data.products[0].recipe = [{ materialId: 'fasteners', quantity: '2' }, { materialId: 'sheet', quantity: '0.5' }];
  addOrder(data, 'pending', 5);
  const result = materialRequirements(data);
  const fasteners = result.total.find(need => need.material.id === 'fasteners')!;
  eq(fasteners.required, '20'); eq(fasteners.balance, '72');
  assert.deepEqual(fasteners.items, [{ quantity: '4', count: 4 }, { quantity: '2', count: 2 }]);
  eq(result.total.find(need => need.material.id === 'sheet')!.required, '2.2');
});
test('per-order shortages use confirmed priority and cannot reuse exhausted material stock', () => {
  const data = fixture(); data.materials[0].stock = '5';
  addOrder(data, 'confirmed', 3); addOrder(data, 'pending', 2);
  data.orders[1].requestedDate = '2026-11-17'; confirm(data, 'confirmed');
  const result = materialRequirements(data);
  assert.deepEqual(result.perOrder.map(item => item.order.id), ['confirmed', 'pending']);
  eq(result.perOrder[0].needs.find(need => need.material.id === 'fasteners')!.balance, '-7');
  eq(result.perOrder[1].needs.find(need => need.material.id === 'fasteners')!.balance, '-8');
  eq(result.total.find(need => need.material.id === 'fasteners')!.balance, '-15');
});
test('material previews ignore cancelled and completed orders and accept exactly sufficient stock', () => {
  const data = fixture(20); addOrder(data, 'completed', 3); confirm(data, 'completed'); completeOrder(data, 'completed');
  addOrder(data, 'cancelled', 100); cancelOrder(data, 'cancelled'); addOrder(data, 'pending', 20);
  data.materials[0].stock = '12';
  const result = materialRequirements(data);
  assert.deepEqual(result.perOrder.map(item => item.order.id), ['pending']);
  eq(result.total.find(need => need.material.id === 'fasteners')!.required, '12');
  eq(result.total.find(need => need.material.id === 'fasteners')!.balance, '0');
  assert.deepEqual(materialRequirements(emptyData()), { total: [], perOrder: [] });
});
