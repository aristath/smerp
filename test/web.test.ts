import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.ts';
import { Conflict, fingerprint, Store } from '../src/store.ts';
import { emptyData, normalize, parseBackup } from '../src/model.ts';
import { addOrder, fixture } from './fixture.ts';
import { confirmOrder } from '../src/operations.ts';

const origin = 'http://127.0.0.1:3210';

test('receiving page and material editor expose scanning and multiple barcodes', async t => {
  const { request } = await setup(t);
  const page = await request('/inventory/receive'); assert.equal(page.status, 200);
  const markup = await page.text();
  for (const label of ['Scan barcode', 'Barcode not in your supplies list.', 'Assign to existing material', 'Add new material', 'Save received materials']) assert(markup.includes(label));
  assert(!page.headers.get('permissions-policy')?.includes('camera=()'));
  assert.match(await (await request('/materials/fasteners/edit')).text(), /Add barcode/);
});
test('batch receipt creates or assigns barcodes, receives decimal quantities and records each movement once', async t => {
  const { request, store } = await setup(t), revision = (await store.read()).revision;
  const receiptId = crypto.randomUUID();
  const rows = [
    { materialId: 'fasteners', quantity: '300', code: { format: 'EAN_13', value: '4006381333931' } },
    { materialId: 'fasteners', quantity: '20', code: { format: 'QR_CODE', value: 'supplier/fasteners/100-pack' } },
    { materialId: 'sheet', quantity: '2.75', code: null },
    { materialId: 'new-labels', quantity: '60', code: { format: 'EAN_8', value: '96385074' }, newMaterial: { name: 'Labels', unit: 'pieces', supplierId: 'supplier', packQuantity: '100', packPrice: '8' } },
    { materialId: 'new-labels', quantity: '10', code: { format: 'QR_CODE', value: 'labels' } }
  ];
  const submit = () => request('/api/materials/receive', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, receiptId, rows }) });
  assert.equal((await submit()).status, 200);
  const data = (await store.read()).data;
  assert.equal(data.materials[0].stock, '420'); assert.equal(data.materials[0].barcodes.length, 2);
  assert.equal(data.materials[1].stock, '52.75');
  assert.equal(data.materials[2].name, 'Labels'); assert.equal(data.materials[2].stock, '70'); assert.equal(data.materials[2].barcodes.length, 2);
  assert.equal(data.movements.length, 5);
  const saved = await store.raw();
  // Retry after an interrupted connection or repeated tap cannot receive the batch twice.
  assert.equal((await submit()).status, 200); assert.equal(await store.raw(), saved);
  const backup = await (await request('/backup')).text(); assert.deepEqual(parseBackup(backup), data);
});
test('invalid, stale and duplicate barcode receipts cannot partly change inventory or assignments', async t => {
  const seed = fixture(); seed.materials[0].barcodes = [{ format: 'UPC_A', value: '012345000065' }];
  const { request, store } = await setup(t, seed), before = await store.raw(), revision = (await store.read()).revision;
  const receive = (rows: unknown[], rev = revision) => request('/api/materials/receive', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: rev, receiptId: crypto.randomUUID(), rows }) });
  const valid = { materialId: 'fasteners', quantity: '5', code: { format: 'QR_CODE', value: 'new-fastener-code' } };
  for (const bad of [
    { materialId: 'sheet', quantity: '0', code: null },
    { materialId: 'sheet', quantity: '2', code: { format: 'EAN_13', value: '4006381333932' } },
    { materialId: 'sheet', quantity: '2', code: { format: 'UPC_E', value: '01234565' } },
    { materialId: 'new', quantity: '3', code: null, newMaterial: { name: 'Invalid material', unit: 'm', supplierId: 'missing', packQuantity: '1', packPrice: '5' } }
  ]) { assert.equal((await receive([valid, bad])).status, 422); assert.equal(await store.raw(), before); }
  await store.update(revision, data => { data.settings.hourlyRate = '22'; return data; });
  const changed = await store.raw(), stale = await receive([valid]);
  assert.equal(stale.status, 409); const error = await stale.json(); assert.equal(error.revision, (await store.read()).revision);
  assert.equal(await store.raw(), changed);
});
test('material editing adds and removes multiple codes without losing stock or entered values', async t => {
  const { post, store } = await setup(t);
  const values = { id: 'fasteners', name: 'Fasteners', unit: 'pieces', packQuantity: '100', packPrice: '10', supplierId: 'supplier', threshold: '100', barcodesEdited: '1' };
  const saved = await post('/materials/save', { ...values, barcodeFormat: ['EAN_13', 'QR_CODE'], barcodeValue: ['4006381333931', 'fasteners-box'] });
  assert.equal(saved.status, 303); assert.equal((await store.read()).data.materials[0].barcodes.length, 2);
  const invalid = await post('/materials/save', { ...values, barcodeFormat: ['EAN_13'], barcodeValue: ['4006381333932'] });
  assert.equal(invalid.status, 422); assert.match(await invalid.text(), /4006381333932/);
  assert.equal((await store.read()).data.materials[0].barcodes.length, 2);
  assert.equal((await post('/materials/save', values)).status, 303);
  assert.deepEqual((await store.read()).data.materials[0].barcodes, []); assert.equal((await store.read()).data.materials[0].stock, '100');
});
async function setup(t: TestContext, seed = fixture()) {
  const directory = await mkdtemp(join(tmpdir(), 'smerp-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(join(directory, 'smerp.json'));
  await store.replace(fingerprint(''), seed);
  const app = createApp(store, { origin, timeZone: 'Europe/Athens' });
  const request = (path: string, init?: RequestInit) => app.request(origin + path, init);
  const post = async (path: string, values: Record<string, string | string[]>, revision?: string) => {
    const body = new URLSearchParams();
    body.set('revision', revision ?? (await store.read()).revision);
    for (const [key, value] of Object.entries(values)) for (const entry of Array.isArray(value) ? value : [value]) body.append(key, entry);
    return request(path, { method: 'POST', headers: { Origin: origin }, body });
  };
  return { directory, store, app, request, post };
}

test('file saves are atomic and invalid changes leave the existing file untouched', async t => {
  const { directory, store } = await setup(t);
  const before = await store.raw(), revision = (await store.read()).revision;
  await assert.rejects(store.update(revision, data => { data.materials[0].stock = '-1'; return data; }));
  assert.equal(await store.raw(), before);
  await store.update(revision, data => { data.settings.hourlyRate = '21'; return data; });
  assert.equal((await store.read()).data.settings.hourlyRate, '21');
  assert.deepEqual(await readdir(directory), ['smerp.json']);
});
test('concurrent saves cannot overwrite each other and a rejected save does not poison the queue', async t => {
  const { store } = await setup(t), revision = (await store.read()).revision;
  const results = await Promise.allSettled([
    store.update(revision, data => { data.settings.hourlyRate = '20'; return data; }),
    store.update(revision, data => { data.settings.hourlyRate = '30'; return data; })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert(failed.reason instanceof Conflict);
  await store.update((await store.read()).revision, data => { data.settings.hourlyRate = '40'; return data; });
  assert.equal((await store.read()).data.settings.hourlyRate, '40');
});
test('a damaged working file is preserved and can be explicitly replaced with a valid backup', async t => {
  const { store } = await setup(t); await writeFile(store.file, 'damaged file');
  await assert.rejects(store.read()); assert.equal(await store.raw(), 'damaged file');
  await store.replace(fingerprint('damaged file'), emptyData()); assert.deepEqual((await store.read()).data, emptyData());
});
test('all management pages render with local scripts and styles', async t => {
  const { request } = await setup(t);
  for (const path of ['/', '/suppliers', '/materials', '/products', '/orders', '/inventory', '/schedule', '/suppliers/new', '/materials/new', '/products/new', '/orders/new']) {
    const response = await request(path); assert.equal(response.status, 200, path);
    const markup = await response.text(); assert.match(markup, /<title>[^<]+ · Workspace<\/title>/); assert.match(markup, /\/assets\/app.js/); assert(!markup.includes('cdn.jsdelivr'));
  }
});
test('overview materials show cut lists, total stock balances and per-order tables without changing data', async t => {
  const seed = fixture(); seed.materials[1].stock = '135';
  seed.materials.push({ ...seed.materials[0], id: 'labels', name: 'Woven labels', stock: '108' }, { ...seed.materials[0], id: 'sliders', name: 'Metal sliders', stock: '70' });
  const extras = [{ materialId: 'labels', quantity: '1' }, { materialId: 'sliders', quantity: '1' }];
  seed.products[0].recipe = [{ materialId: 'sheet', quantity: '0.5' }, ...extras];
  seed.products.push({ ...structuredClone(seed.products[0]), id: 'large', name: 'Large storage tray', recipe: [{ materialId: 'sheet', quantity: '0.4' }, ...extras] });
  addOrder(seed, 'small', 30); addOrder(seed, 'large', 50); seed.orders[1].lines[0].productId = 'large';
  const { request, store } = await setup(t, seed), before = await store.raw();
  const response = await request('/'); assert.equal(response.status, 200);
  const markup = await response.text(), total = markup.slice(markup.indexOf('id="materials-total"'), markup.indexOf('id="materials-orders"'));
  assert.match(total, /30 × 50 cm/); assert.match(total, /50 × 40 cm/); assert.match(total, /Total 35 m/);
  assert.match(total, /\(\+100 m\)/);
  assert.match(total, /\(\+28 pieces\)/); assert.match(total, /\(-10 pieces\)/);
  assert.match(markup, /role="tab"[^>]*aria-controls="materials-total"/); assert.match(markup, /role="tab"[^>]*aria-controls="materials-orders"/);
  assert.match(markup, /Materials for Customer small/); assert.match(markup, /Materials for Customer large/);
  assert(markup.indexOf('id="materials-heading"') < markup.indexOf('class="summary-strip"'));
  assert.equal(await store.raw(), before);
});
test('request origin and host are checked and HTML escapes user content', async t => {
  const seed = fixture(); seed.suppliers[0].name = '<script>alert(1)</script>';
  const { request } = await setup(t, seed);
  const response = await request('/suppliers'); assert.match(await response.text(), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(response.headers.get('content-security-policy')!, /script-src 'self'/);
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  assert(!response.headers.get('content-security-policy')!.includes("'unsafe-eval'"));
  assert.equal((await request('/settings', { method: 'POST', headers: { Origin: 'https://other.example' }, body: new URLSearchParams() })).status, 403);
  const { app } = await setup(t); assert.equal((await app.request('http://other.example/')).status, 400);
});
test('supplier and material edits retain stock, and validation preserves typed values', async t => {
  const { post, store } = await setup(t);
  const response = await post('/materials/save', { id: 'fasteners', name: 'Renamed fasteners', unit: 'pieces', packQuantity: '100', packPrice: '15', supplierId: 'supplier', threshold: '20' });
  assert.equal(response.status, 303); assert.equal((await store.read()).data.materials[0].stock, '100');
  const invalid = await post('/suppliers/save', { name: 'My entered supplier', contact: 'contact@example.test', leadDays: '999' });
  assert.equal(invalid.status, 422); const markup = await invalid.text(); assert.match(markup, /My entered supplier/); assert.match(markup, /Delivery time/);
  assert.equal((await store.read()).data.suppliers.length, 1);
});
test('stale forms are rejected without dropping entered values or newer settings', async t => {
  const { post, store } = await setup(t), revision = (await store.read()).revision;
  assert.equal((await post('/settings', { hourlyRate: '22', currency: 'EUR', returnTo: '/' }, revision)).status, 303);
  const stale = await post('/suppliers/save', { name: 'Keep this draft', contact: 'draft@example.test', leadDays: '3' }, revision);
  assert.equal(stale.status, 409); const body = await stale.text(); assert.match(body, /Keep this draft/); assert.match(body, /another device/); assert.equal((await store.read()).data.settings.hourlyRate, '22');
});
test('workshop title and subtitle are shared across pages and preserved in backups', async t => {
  const { request, store, post } = await setup(t);
  const settings = { hourlyRate: '22', currency: 'EUR', returnTo: '/orders' };
  const saved = await post('/settings', { ...settings, title: ' North & Loom ', subtitle: ' Cut < sew ' });
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get('location'), '/orders');
  const markup = await (await request('/orders')).text();
  assert.match(markup, /<title>Orders · North &amp; Loom<\/title>/);
  assert.equal(markup.match(/<a class="brand"[^>]*>North &amp; Loom<\/a>/g)?.length, 2);
  assert.equal(markup.match(/<p class="brand-caption"[^>]*>Cut &lt; sew<\/p>/g)?.length, 2);
  assert.equal((await post('/settings', settings)).status, 303);
  const backup = parseBackup(await (await request('/backup')).text());
  assert.deepEqual(backup.settings, { title: 'North & Loom', subtitle: 'Cut < sew', hourlyRate: '22', currency: 'EUR' });
  assert.equal((await post('/settings', { ...settings, title: ' ', subtitle: '' })).status, 422);
  assert.deepEqual((await store.read()).data.settings, backup.settings);
  assert.equal((await post('/settings', { ...settings, subtitle: '' })).status, 303);
  assert.equal((await store.read()).data.settings.subtitle, '');
  assert.doesNotMatch(await (await request('/')).text(), /class="brand-caption"/);
});
test('product and order preview calculations use current server data without reserving stock', async t => {
  const { post, store } = await setup(t);
  const product = await post('/api/product-preview', { name: '', minutes: '5', recipeMaterial: ['fasteners', 'sheet'], recipeQuantity: ['4', '0.3'] });
  assert.equal(product.status, 200); assert.deepEqual(await product.json(), { materials: 'EUR 0.80', labour: 'EUR 1.50', minimum: 'EUR 2.30' });
  const order = await post('/api/order-preview', { customer: '', contact: '', lineProduct: 'tray', lineQuantity: '100', linePrice: '1' });
  assert.equal(order.status, 200); const result = await order.json(); assert.equal(result.work, '8h 20m'); assert.equal(result.minimum, 'EUR 230.00'); assert.match(result.warning, /below/);
  assert.equal((await store.read()).data.orders.length, 0);
});
test('HTTP order workflow confirms, produces, and completes without double consumption', async t => {
  const { post, store, request } = await setup(t, fixture(2));
  const saved = await post('/orders/save', { customer: 'Alex', contact: 'alex@example.test', requestedDate: '2026-12-30', lineProduct: 'tray', lineQuantity: '4', linePrice: '5' });
  assert.equal(saved.status, 303); const order = (await store.read()).data.orders[0];
  assert.equal((await post(`/orders/${order.id}/confirm`, {})).status, 303);
  const frozen = (await store.read()).data.orders[0]; assert.equal(frozen.lines[0].fromStock, 2); assert.equal(frozen.currency, 'EUR');
  assert.equal((await post('/inventory/save', { kind: 'product', id: 'tray', mode: 'produce', orderId: order.id, quantity: '2' })).status, 303);
  assert.equal((await post(`/orders/${order.id}/complete`, {})).status, 303);
  const data = (await store.read()).data; assert.equal(data.products[0].stock, 0); assert.equal(data.materials[0].stock, '92'); assert.equal(data.orders[0].status, 'COMPLETED');
  assert.match(await (await request(`/orders/${order.id}`)).text(), /Costs saved at confirmation/);
  assert.equal((await post(`/orders/${order.id}/complete`, {})).status, 422);
});
test('receipt and correction forms record movement history', async t => {
  const { post, store } = await setup(t);
  assert.equal((await post('/inventory/save', { kind: 'material', id: 'fasteners', mode: 'receive', quantity: '200', reason: 'New delivery' })).status, 303);
  assert.equal((await store.read()).data.materials[0].stock, '300');
  assert.equal((await post('/inventory/save', { kind: 'material', id: 'fasteners', mode: 'count', quantity: '290', reason: 'Physical count' })).status, 303);
  assert.equal((await store.read()).data.materials[0].stock, '290'); assert.equal((await store.read()).data.movements.at(-1)!.quantity, '-10');
});
test('order tables retain frozen costs, current purchase prices and the order-specific production link', async t => {
  const seed = addOrder(fixture(2), 'table-order', 40);
  confirmOrder(seed, 'table-order');
  seed.materials[0].packPrice = '20';
  const { request } = await setup(t, seed);
  const markup = await (await request('/orders/table-order')).text();
  assert.match(markup, /mode=produce&amp;orderId=table-order/);
  assert.match(markup, /Minimum total<\/dt><dd>EUR 92\.00/);
  assert.match(markup, /Purchases: EUR 20\.00/);
  assert.match(markup, /<td class="numeric attention"><strong>52<\/strong>/);
  assert.match(markup, /EUR 15\.20/);
  assert.match(markup, /Costs saved at confirmation/);
  assert.match(await (await request('/orders')).text(), /Order materials/);
});
test('order deletion is separate from cancellation, rejects stale saves and removes only the order', async t => {
  const { post, store, request } = await setup(t, addOrder(fixture(2), 'remove', 4));
  const markup = await (await request('/orders/remove')).text();
  assert.match(markup, /Cancel order/); assert.match(markup, /Delete order/); assert.match(markup, /x-data="deleteOrderEditor"/);
  const revision = (await store.read()).revision;
  await post('/settings', { hourlyRate: '22', currency: 'EUR', returnTo: '/' });
  assert.equal((await post('/orders/remove/delete', {}, revision)).status, 409);
  assert.equal((await store.read()).data.orders.length, 1);
  const before = (await store.read()).data;
  const response = await post('/orders/remove/delete', {});
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/orders');
  const after = (await store.read()).data;
  assert.deepEqual(after, { ...before, orders: [] });
  assert.doesNotMatch(await (await request('/orders')).text(), /Customer remove/);
  assert.equal((await post('/orders/remove/delete', {})).status, 422);
  assert.deepEqual((await store.read()).data, after);
});
test('schedule saving accepts days off and rejects invalid daily hours', async t => {
  const { post, store, request } = await setup(t);
  assert.equal((await post('/schedule', { hours: ['4', '4', '4', '4', '3.5', '0', '0'], daysOff: '2026-12-25', newDayOff: '2026-12-31' })).status, 303);
  assert.deepEqual((await store.read()).data.schedule.daysOff, ['2026-12-25', '2026-12-31']);
  assert.match(await (await request('/schedule?saved=1')).text(), /Work schedule saved\./);
  const failed = await post('/schedule', { hours: ['25', '0', '0', '0', '0', '0', '0'] }); assert.equal(failed.status, 422); assert.match(await failed.text(), /0–24/);
});
test('earlier web data is readable and exported using the new backup format', async t => {
  const { store, request, post } = await setup(t);
  const data = fixture();
  for (const suffix of ['no', 'nerp']) {
    const previous = JSON.stringify({ ...data, format: `ky${suffix}-backup` });
    await writeFile(store.file, previous);
    assert.equal((await request('/health')).status, 200);
    const download = await request('/backup');
    assert.match(download.headers.get('content-disposition')!, /smerp-backup/);
    assert.deepEqual(await download.json(), data);
    assert.equal(await store.raw(), previous);
    assert.equal((await post('/settings', { hourlyRate: '22', currency: 'EUR' })).status, 303);
    assert.equal(JSON.parse(await store.raw()).format, 'smerp-backup');
  }
});
test('backup preview is non-destructive, replacement is explicit, and exports restore unchanged', async t => {
  const { store, request } = await setup(t), original = await store.read(), replacement = emptyData(); replacement.settings.hourlyRate = '27';
  const form = () => { const form = new FormData(); form.set('revision', original.revision); form.set('backup', new File([JSON.stringify(replacement)], 'backup.json', { type: 'application/json' })); return form; };
  assert.equal((await request('/api/restore-preview', { method: 'POST', headers: { Origin: origin }, body: form() })).status, 200);
  assert.equal((await store.read()).revision, original.revision);
  assert.equal((await request('/restore', { method: 'POST', headers: { Origin: origin }, body: form() })).status, 422);
  assert.equal((await store.read()).revision, original.revision);
  const confirmed = form(); confirmed.set('confirmRestore', 'replace');
  assert.equal((await request('/restore', { method: 'POST', headers: { Origin: origin }, body: confirmed })).status, 303);
  const download = await request('/backup'); assert.match(download.headers.get('content-disposition')!, /smerp-backup/); assert.deepEqual(parseBackup(await download.text()), normalize(replacement));
});
test('invalid backup uploads and stale replacements keep current data intact', async t => {
  const { store, request } = await setup(t), original = await store.read();
  const bad = new FormData(); bad.set('revision', original.revision); bad.set('backup', new File(['{"format":"smerp-backup"}'], 'bad.json'));
  assert.equal((await request('/api/restore-preview', { method: 'POST', headers: { Origin: origin }, body: bad })).status, 422); assert.equal((await store.read()).revision, original.revision);
  await store.update(original.revision, data => { data.settings.hourlyRate = '24'; return data; });
  const stale = new FormData(); stale.set('revision', original.revision); stale.set('confirmRestore', 'replace'); stale.set('backup', new File([JSON.stringify(emptyData())], 'backup.json'));
  assert.equal((await request('/restore', { method: 'POST', headers: { Origin: origin }, body: stale })).status, 409); assert.equal((await store.read()).data.settings.hourlyRate, '24');
});
test('damaged-file recovery remains available through the web interface', async t => {
  const { store, request } = await setup(t); await writeFile(store.file, 'damaged');
  const page = await request('/'); assert.equal(page.status, 422); assert.match(await page.text(), /Your data needs attention/); assert.equal(await readFile(store.file, 'utf8'), 'damaged');
  assert.equal(await (await request('/backup')).text(), 'damaged');
  const form = new FormData(); form.set('revision', fingerprint('damaged')); form.set('confirmRestore', 'replace'); form.set('backup', new File([JSON.stringify(emptyData())], 'backup.json'));
  assert.equal((await request('/restore', { method: 'POST', headers: { Origin: origin }, body: form })).status, 303); assert.deepEqual((await store.read()).data, emptyData());
});
