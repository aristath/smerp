import { receiveMaterials, type ReceiptRow } from './receiving.ts';
import { receivingPage } from './receiving-view.ts';
import { Hono, type Context } from 'hono';
import { html } from 'hono/html';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { MAX_BYTES, D, amount, backupFormat, date, demand, emptyData, find, integer, labourCost, lineQuote, materialCost, minimumPrice, money, normalize, parseBackup, quote, sum, today } from './model.ts';
import { plans } from './planning.ts';
import { cancelOrder, changeStock, completeOrder, confirmOrder, deleteRecord, produce } from './operations.ts';
import { all, draftOrder, draftProduct, fields, get, saveEntity, type Fields, type Section } from './forms.ts';
import { Conflict, fingerprint, type Store } from './store.ts';
import { duration, empty, heading, layout, listPage, orderPage, prettyDate, type View } from './views.ts';
import { entityEditor, recoveryPage, scheduleEditor, stockEditor } from './editors.ts';

export interface AppOptions { origin: string; timeZone: string }
export function createApp(store: Store, options: AppOptions) {
  const app = new Hono();
  const day = () => today(options.timeZone);
  app.use('*', secureHeaders({ referrerPolicy: 'same-origin', contentSecurityPolicy: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'wasm-unsafe-eval'"], styleSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"] } }));
  app.use('*', bodyLimit({ maxSize: MAX_BYTES + 65536, onError: c => c.text('The upload is too large. Backups must be 10 MB or smaller.', 413) }));
  app.use('*', async (c, next) => {
    if (new URL(c.req.url).host !== new URL(options.origin).host) return c.text('Use the configured Smerp address.', 400);
    const origin = c.req.header('origin');
    if (!['GET', 'HEAD'].includes(c.req.method) && ((origin && origin !== options.origin) || c.req.header('sec-fetch-site') === 'cross-site')) return c.text('This request did not come from Smerp. Reload the app and try again.', 403);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  async function view(c: Context, error?: string): Promise<View> { const snapshot = await store.read(); return { ...snapshot, day: day(), path: c.req.path, error }; }
  function errorStatus(error: unknown): 409 | 422 { return error instanceof Conflict ? 409 : 422; }
  const message = (error: unknown) => error instanceof Error ? error.message : 'Could not complete this action.';
  function assertRevision(submitted: string, actual: string) { if (submitted !== actual) throw new Conflict(); }
  async function upload(form: FormData) {
    const file = form.get('backup');
    demand(file instanceof File && file.size > 0 && file.size <= MAX_BYTES, 'Choose a JSON backup no larger than 10 MB.');
    return parseBackup(await file.text());
  }
  app.get('/health', async c => { await store.read(); return c.json({ ok: true }); });
  app.get('/api/revision', async c => c.json({ revision: fingerprint(await store.raw()) }));
  app.get('/', async c => { const v = await view(c); if (c.req.query('restored') === '1') v.notice = 'Backup restored. All records and settings are ready.'; return c.html(layout(v, 'Your workshop', listPage(v, 'overview'))); });
  const sections: Section[] = ['suppliers', 'materials', 'products', 'orders'];
  for (const section of sections) {
    app.get(`/${section}`, async c => { const v = await view(c); return c.html(layout(v, section[0].toUpperCase() + section.slice(1), listPage(v, section))); });
    async function editor(c: Context, id: string, values?: Fields, error?: unknown) {
      const v = await view(c, error ? message(error) : undefined); v.path = `/${section}`;
      if ((section === 'materials' && !v.data.suppliers.length) || (section === 'products' && !v.data.materials.length) || (section === 'orders' && !v.data.products.length)) {
        const prerequisite = section === 'materials' ? 'suppliers' : section === 'products' ? 'materials' : 'products';
        return c.html(layout(v, 'Set up your workshop', empty(`Add ${prerequisite} first`, 'Then you can continue with this form.', `/${prerequisite}`, `Go to ${prerequisite}`)), 422);
      }
      const page = entityEditor(v, section, id, values);
      return c.html(layout(v, id ? 'Edit record' : 'Add record', page.content, page.pageData), error ? errorStatus(error) : 200);
    }
    app.get(`/${section}/new`, c => editor(c, ''));
    app.get(`/${section}/:id/edit`, async c => { const current = await store.read(); const item = find<{ id: string }>(current.data[section], c.req.param('id')); if (section === 'orders') demand(find(current.data.orders, item.id).status === 'PENDING', 'Confirmed orders cannot be edited.'); return editor(c, item.id); });
    app.post(`/${section}/save`, async c => {
      const values = fields(await c.req.formData()); let id = get(values, 'id');
      try {
        await store.update(get(values, 'revision'), data => { const result = saveEntity(data, section, values, day()); id = result.id; return result.data; });
        return c.redirect(section === 'orders' ? `/orders/${encodeURIComponent(id)}` : `/${section}`, 303);
      } catch (error) { return editor(c, get(values, 'id'), values, error); }
    });
  }
  for (const section of ['suppliers', 'materials', 'products', 'orders'] as const) app.post(`/${section}/:id/delete`, async c => {
    const values = fields(await c.req.formData());
    try { await store.update(get(values, 'revision'), data => deleteRecord(data, section, c.req.param('id'))); return c.redirect(`/${section}`, 303); }
    catch (error) { const v = await view(c, message(error)); v.path = `/${section}`; return c.html(layout(v, 'Could not delete', listPage(v, section)), errorStatus(error)); }
  });
  app.get('/orders/:id', async c => { const v = await view(c); return c.html(layout(v, find(v.data.orders, c.req.param('id')).customer, orderPage(v, c.req.param('id')))); });
  for (const action of ['confirm', 'cancel', 'complete'] as const) app.post(`/orders/:id/${action}`, async c => {
    const values = fields(await c.req.formData()), id = c.req.param('id');
    try {
      await store.update(get(values, 'revision'), data => action === 'confirm' ? confirmOrder(data, id, day()) : action === 'cancel' ? cancelOrder(data, id) : completeOrder(data, id));
      return c.redirect(`/orders/${encodeURIComponent(id)}`, 303);
    } catch (error) { const v = await view(c, message(error)); v.path = `/orders/${id}`; return c.html(layout(v, 'Review order', orderPage(v, id)), errorStatus(error)); }
  });
  app.get('/inventory', async c => { const v = await view(c); if (c.req.query('received') === '1') v.notice = 'Materials received. Inventory and barcodes updated.'; return c.html(layout(v, 'Inventory', listPage(v, 'inventory'))); });
  app.get('/inventory/receive', async c => {
    const v = await view(c); v.path = '/inventory';
    const page = receivingPage(v);
    return c.html(layout(v, 'Received materials', page.content, page.pageData));
  });
  app.post('/api/materials/receive', async c => {
    const payload = await c.req.json<{ revision: string; receiptId: string; rows: ReceiptRow[] }>();
    const current = await store.read();
    // A lost response can be retried safely, even after its original revision changed.
    if (current.data.movements.some(m => m.id === `${payload.receiptId}_0`)) return c.json({ ok: true });
    await store.update(payload.revision, data => receiveMaterials(data, payload.rows, day(), payload.receiptId));
    return c.json({ ok: true });
  });
  app.get('/inventory/edit', async c => {
    const v = await view(c), kind = c.req.query('kind') ?? '', mode = c.req.query('mode') ?? '';
    demand(['material', 'product'].includes(kind) && ['receive', 'count', 'produce'].includes(mode) && !(kind === 'material' && mode === 'produce'), 'Choose a valid stock action.');
    v.path = '/inventory'; return c.html(layout(v, 'Update inventory', stockEditor(v, kind, c.req.query('id') ?? '', mode, c.req.query('orderId') ?? '')));
  });
  app.post('/inventory/save', async c => {
    const values = fields(await c.req.formData()), kind = get(values, 'kind'), id = get(values, 'id'), mode = get(values, 'mode'), orderId = get(values, 'orderId');
    demand(['material', 'product'].includes(kind) && ['receive', 'count', 'produce'].includes(mode) && !(kind === 'material' && mode === 'produce'), 'Choose a valid stock action.');
    try {
      await store.update(get(values, 'revision'), data => mode === 'produce' ? produce(data, id, integer(get(values, 'quantity'), 'Number made', 1), orderId || undefined) : changeStock(data, kind as 'material' | 'product', id, get(values, 'quantity'), mode === 'receive', textReason(values)));
      return c.redirect(orderId ? `/orders/${encodeURIComponent(orderId)}` : '/inventory', 303);
    } catch (error) { const v = await view(c, message(error)); v.path = '/inventory'; return c.html(layout(v, 'Review stock change', stockEditor(v, kind, id, mode, orderId, values)), errorStatus(error)); }
  });
  app.get('/schedule', async c => { const v = await view(c); if (c.req.query('saved') === '1') v.notice = 'Work schedule saved.'; return c.html(layout(v, 'Work schedule', scheduleEditor(v), { daysOff: v.data.schedule.daysOff })); });
  app.post('/schedule', async c => {
    const values = fields(await c.req.formData());
    try {
      await store.update(get(values, 'revision'), data => { data.schedule = { hours: all(values, 'hours').map(value => amount(value, 'Working hours')), daysOff: [...new Set([...all(values, 'daysOff'), ...get(values, 'newDayOff') ? [get(values, 'newDayOff')] : []])].map(date).sort() }; return data; });
      return c.redirect('/schedule?saved=1', 303);
    } catch (error) { const v = await view(c, message(error)); return c.html(layout(v, 'Review work schedule', scheduleEditor(v, values), { daysOff: all(values, 'daysOff') }), errorStatus(error)); }
  });
  app.post('/settings', async c => {
    const values = fields(await c.req.formData());
    try {
      await store.update(get(values, 'revision'), data => {
        data.settings = {
          title: get(values, 'title', data.settings.title),
          subtitle: get(values, 'subtitle', data.settings.subtitle),
          hourlyRate: amount(get(values, 'hourlyRate'), 'Hourly rate'),
          currency: get(values, 'currency').trim().toUpperCase(),
        };
        return data;
      });
      const target = get(values, 'returnTo');
      return c.redirect(/^\/(?:orders|suppliers|materials|products|inventory|schedule)?(?:\/[\w-]+)?$/.test(target) ? target : '/', 303);
    } catch (error) { const v = await view(c, message(error)); v.path = '/'; v.settingsDraft = values; return c.html(layout(v, 'Review settings', listPage(v, 'overview')), errorStatus(error)); }
  });
  app.get('/backup', async c => {
    const raw = await store.raw();
    let contents = raw;
    try {
      contents = JSON.stringify(raw ? parseBackup(raw) : emptyData(), null, 2);
    } catch { /* Offer the original file for recovery if validation fails. */ }
    c.header('Content-Disposition', `attachment; filename="${backupFormat}-${day()}.json"`);
    return c.body(contents, 200, { 'Content-Type': 'application/json; charset=utf-8' });
  });
  app.post('/api/restore-preview', async c => {
    const form = await c.req.formData(); assertRevision(String(form.get('revision')), fingerprint(await store.raw()));
    const data = await upload(form);
    return c.json({ summary: `Suppliers: ${data.suppliers.length}. Materials: ${data.materials.length}. Products: ${data.products.length}. Orders: ${data.orders.length}. Inventory, working hours, and settings are included.` });
  });
  app.post('/restore', async c => {
    const form = await c.req.formData();
    try {
      demand(form.get('confirmRestore') === 'replace', 'Preview the backup and confirm replacement first.');
      const data = await upload(form);
      await store.replace(String(form.get('revision')), data);
      return c.redirect('/?restored=1', 303);
    } catch (error) {
      const raw = await store.raw(); let data;
      try { data = (await store.read()).data; } catch { data = emptyData(); }
      const v: View = { data, revision: fingerprint(raw), day: day(), path: '/', recovery: true, error: message(error) };
      return c.html(layout(v, 'Restore backup', recoveryPage(v)), errorStatus(error));
    }
  });
  app.post('/api/product-preview', async c => {
    const values = fields(await c.req.formData()), current = await store.read(); assertRevision(get(values, 'revision'), current.revision);
    const q = quote(current.data, draftProduct(values, 'preview'));
    return c.json({ materials: money(materialCost(q), current.data.settings.currency), labour: money(labourCost(q), current.data.settings.currency), minimum: money(minimumPrice(q), current.data.settings.currency) });
  });
  app.post('/api/order-preview', async c => {
    const values = fields(await c.req.formData()), current = await store.read(); assertRevision(get(values, 'revision'), current.revision);
    const id = get(values, 'id') || crypto.randomUUID(), order = draftOrder(current.data, values, id, day(), true);
    current.data.orders = [...current.data.orders.filter(existing => existing.id !== id), order];
    const data = normalize(current.data), plan = plans(data, day()).find(plan => plan.order.id === id)!, currency = data.settings.currency;
    return c.json({ minimum: money(sum(order.lines.map(line => minimumPrice(lineQuote(data, line)).times(line.quantity))), currency), work: duration(plan.minutes), purchases: money(sum(plan.needs.map(need => need.purchaseCost)), currency), completion: plan.completion ? prettyDate(plan.completion) : 'Set working hours', warning: order.lines.some(line => D(line.price).lt(minimumPrice(lineQuote(data, line)))) ? 'One or more selling prices are below materials and labour cost.' : '' });
  });
  app.onError(async (error, c) => {
    if (c.req.path.startsWith('/api/')) {
      const snapshot = error instanceof Conflict ? await store.read() : null;
      return c.json({ error: message(error), ...(snapshot ? { revision: snapshot.revision, ...(c.req.path === '/api/materials/receive' ? { materials: snapshot.data.materials.map(m => ({ id: m.id, name: m.name, unit: m.unit, barcodes: m.barcodes })) } : {}) } : {}) }, errorStatus(error));
    }
    const raw = await store.raw(); let data;
    try { data = (await store.read()).data; } catch {
      const v: View = { data: emptyData(), revision: fingerprint(raw), day: day(), path: '/', recovery: true, error: message(error) };
      return c.html(layout(v, 'Recover your data', recoveryPage(v)), 422);
    }
    const v: View = { data, revision: fingerprint(raw), day: day(), path: '/', error: message(error) };
    return c.html(layout(v, 'Review this action', html`${heading('This action needs attention', 'Your saved data has been kept.')}<a class="button secondary" href="/">Back to overview</a>`), errorStatus(error));
  });
  app.notFound(async c => { const v = await view(c); return c.html(layout(v, 'Page not found', empty('This page isn’t here', 'Return to your workshop to continue.', '/', 'Go to overview')), 404); });
  return app;
}
function textReason(values: Fields): string { const reason = get(values, 'reason').trim(); demand(reason, 'Enter a reason for the stock change.'); return reason; }
