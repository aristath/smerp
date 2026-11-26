import { html, raw } from 'hono/html';
import { D, active, availableProducts, find, labourCost, lineQuote, materialCost, minimumPrice, money, productReservations, quote, remaining, statuses, sum, type Data, type Order } from './model.ts';
import { materialRequirements, plans, type MaterialRequirement, type Plan } from './planning.ts';
import type { Fields } from './forms.ts';

export type Markup = ReturnType<typeof html>;
export interface View { data: Data; revision: string; day: string; path: string; error?: string; notice?: string; settingsDraft?: Fields; recovery?: boolean }
export const icons = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  orders: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4"/>',
  materials: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7 6l9 5"/>',
  suppliers: '<path d="M3 20h18M5 20V8l7-5 7 5v12M9 20v-5h6v5M9 9h1M14 9h1"/>',
  products: '<path d="M3 9h18v7H3zM15 6h5v13h-5zM6 12.5h1M10 12.5h1"/>',
  inventory: '<path d="M3 5h18M3 12h18M3 20h18M5 5v15M19 5v15M8 8h4v4H8zM13 15h3v5h-3z"/>',
  schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18M7 15h2M13 15h3"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  moon: '<path d="M20.5 13.3A8.5 8.5 0 0 1 10.7 3.5a8.5 8.5 0 1 0 9.8 9.8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
export const icon = (name: keyof typeof icons) => html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${raw(icons[name])}</svg>`;
const navigation = [['/', 'Overview', 'overview'], ['/orders', 'Orders', 'orders'], ['/materials', 'Materials', 'materials'], ['/suppliers', 'Suppliers', 'suppliers'], ['/products', 'Products', 'products'], ['/inventory', 'Inventory', 'inventory'], ['/schedule', 'Work schedule', 'schedule']] as const;
const nav = (path: string) => html`${navigation.map(([url, label, glyph]) => html`<a href="${url}" ${path === url || (url !== '/' && path.startsWith(url + '/')) ? html`aria-current="page"` : ''}>${icon(glyph)}<span>${label}</span></a>`)}`;
export const revisionInput = (view: View) => html`<input type="hidden" name="revision" value="${view.revision}">`;
export const input = (label: string, name: string, value = '', options: { type?: string; required?: boolean; hint?: string; step?: string; min?: string; max?: string; readonly?: boolean } = {}) => html`<label class="field"><span>${label}</span><input name="${name}" value="${value}" type="${options.type ?? 'text'}" ${options.required ? html`required` : ''} ${options.step ? html`step="${options.step}"` : ''} ${options.min ? html`min="${options.min}"` : ''} ${options.max ? html`max="${options.max}"` : ''} ${options.readonly ? html`readonly` : ''}>${options.hint ? html`<small>${options.hint}</small>` : ''}</label>`;
export const numeric = (label: string, name: string, value = '', hint = '', whole = false, required = true) => input(label, name, value, { type: 'number', step: whole ? '1' : '0.000001', min: '0', max: '1000000000', required, hint });
export const select = (label: string, name: string, selected: string, options: [string, string][], hint = '') => html`<label class="field"><span>${label}</span><select name="${name}" required><option value="">Choose…</option>${options.map(([value, title]) => html`<option value="${value}" ${selected === value ? html`selected` : ''}>${title}</option>`)}</select>${hint ? html`<small>${hint}</small>` : ''}</label>`;
export const detail = (label: string, value: unknown, strong = false) => html`<div class="detail ${strong ? 'strong' : ''}"><dt>${label}</dt><dd>${value}</dd></div>`;
export const badge = (status: Order['status']) => html`<span class="badge ${status.toLowerCase()}">${statuses[status]}</span>`;
export function prettyDate(day: string | null): string { return day ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`)) : 'Not set'; }
export function duration(value: string | number | ReturnType<typeof D>): string { const minutes = D(value).ceil().toNumber(); return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`; }
export const heading = (title: string, subtitle: string, action?: Markup) => html`<header class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action ?? ''}</header>`;
export const empty = (title: string, description: string, href?: string, label?: string) => html`<section class="empty-state"><h2>${title}</h2><p>${description}</p>${href ? html`<a class="button" href="${href}">${label}</a>` : ''}</section>`;
export const cost = (q: ReturnType<typeof quote>, currency: string) => html`<dl>${detail('Materials', money(materialCost(q), currency))}${detail(`Your time (${duration(q.minutes)})`, money(labourCost(q), currency))}${detail('Minimum selling price', money(minimumPrice(q), currency), true)}</dl>`;
export function layout(view: View, title: string, content: Markup, pageData: unknown = {}): Markup {
  const settings = view.data.settings, draft = view.settingsDraft;
  const { title: appTitle, subtitle } = settings;
  const brand = html`<a class="brand" href="/" aria-label="${appTitle} home" title="${appTitle}">${appTitle}</a>
    ${subtitle ? html`<p class="brand-caption" title="${subtitle}">${subtitle}</p>` : ''}`;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${appTitle}</title><script data-cfasync="false" src="/assets/theme.js"></script><link rel="icon" href="/assets/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/style.css"><script data-cfasync="false" defer src="/assets/app.js"></script></head><body x-data="shell">
  <a class="skip-link" href="#main">Skip to content</a><div class="app-shell">
  <aside class="sidebar"><div class="sidebar-brand">${brand}</div><nav aria-label="Main navigation">${nav(view.path)}</nav><div class="sidebar-bottom"><button type="button" class="nav-button" x-on:click="openSettings">${icon('settings')}Settings &amp; backup</button></div></aside>
  <div class="workspace"><header class="topbar"><div class="mobile-brand">${brand}</div><span class="desktop-caption">Workshop planner</span><div class="topbar-actions"><button type="button" class="text-button theme-toggle" x-on:click="toggleTheme" aria-label="Switch to dark mode" x-bind:aria-label="themeLabel" x-bind:title="themeLabel" x-bind:aria-pressed="darkMode"><span class="theme-sun">${icon('sun')}</span><span class="theme-moon">${icon('moon')}</span></button><button type="button" class="text-button settings-button" x-on:click="openSettings" aria-label="Settings">${icon('settings')}<span class="settings-label">Settings</span></button><details class="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile navigation">${nav(view.path)}</nav></details></div></header>
  <main id="main" tabindex="-1"><div class="update-notice" x-show="updated" x-cloak><span>There are changes from another device.</span><button class="text-button" type="button" x-on:click="refresh">Refresh</button></div>${view.notice ? html`<p class="notice" role="status">${view.notice}</p>` : ''}${view.error && !view.settingsDraft ? html`<div class="notice error" role="alert">${view.error}</div>` : ''}${content}</main>
  </div></div><nav class="mobile-tabs" aria-label="Quick navigation">${navigation.filter(([url]) => ['/', '/orders', '/inventory'].includes(url)).map(([url, label, glyph]) => html`<a href="${url}" ${view.path === url || (url !== '/' && view.path.startsWith(url + '/')) ? html`aria-current="page"` : ''}>${icon(glyph)}<span>${label}</span></a>`)}</nav>
  ${!view.recovery ? html`<dialog id="settings-dialog"><div class="dialog-heading"><h2>Settings &amp; backup</h2><button class="text-button" type="button" x-on:click="closeSettings" aria-label="Close settings">Close</button></div>${view.settingsDraft && view.error ? html`<div class="notice error" role="alert">${view.error}</div>` : ''}
  <form method="post" action="/settings">${revisionInput(view)}<input type="hidden" name="returnTo" value="${view.path}">
    <div class="form-grid">
      ${input('Title', 'title', draft?.title?.[0] ?? settings.title, { required: true })}
      ${input('Subtitle', 'subtitle', draft?.subtitle?.[0] ?? settings.subtitle, { hint: 'Leave blank to hide it.' })}
      ${numeric('Your pay per hour', 'hourlyRate', draft?.hourlyRate?.[0] ?? settings.hourlyRate)}
      ${input('Currency code', 'currency', draft?.currency?.[0] ?? settings.currency, { required: true, hint: 'EUR, USD, GBP. Changing this does not convert prices.' })}
    </div><button class="button" type="submit">Save settings</button></form>
  <section class="backup-section"><h3>Backup and restore</h3><p>Back up all records, stock, orders, and settings. Keep a copy outside the device hosting Smerp.</p><a class="button secondary" href="/backup">Download backup</a>${restoreForm(view)}</section></dialog>` : ''}
  <script type="application/json" id="page-data">${raw(JSON.stringify({ revision: view.revision, openSettings: Boolean(view.settingsDraft), ...pageData as object }).replace(/</g, '\\u003c'))}</script></body></html>`;
}
export function restoreForm(view: View): Markup { return html`<form class="restore-form" method="post" action="/restore" enctype="multipart/form-data" x-data="restoreEditor" x-ref="restoreForm" x-on:submit.prevent="preview">${revisionInput(view)}<input type="hidden" name="confirmRestore" value=""><label class="field"><span>Restore a backup</span><input type="file" name="backup" accept=".json,application/json" required><small>Web backups and Android exports with the <code>smerp-backup</code> format are supported. Maximum 10 MB.</small></label><p class="notice error" role="alert" x-show="error" x-cloak x-text="error"></p><button class="button secondary" type="submit" x-bind:disabled="busy" x-text="previewLabel">Preview backup</button><dialog x-ref="confirmation"><div class="dialog-heading"><h2>Replace all existing data?</h2></div><p x-text="summary"></p><p>All current records, inventory, orders, working hours, and settings will be replaced. Download a backup first if you want to keep them.</p><div class="form-actions"><button class="button danger" type="button" x-on:click="confirm">Replace and restore</button><button class="button secondary" type="button" x-on:click="cancel">Keep existing data</button></div></dialog></form>`; }

const numericHeaders = new Set(['Available', 'Available / minimum', 'Available / allocated', 'Required / cost', 'Missing', 'Minimum price', 'Warn below', 'Unit cost', 'Ready', 'Ordered', 'From stock', 'Made', 'To make', 'Each', 'Line total', 'On shelf', 'Reserved', 'Change', 'Your time', 'Materials supplied']);
const table = (label: string, headers: string[], rows: Markup[], className = '') => html`
  <div class="table-scroll" role="region" aria-label="${label}" tabindex="0">
    <table class="data-table ${className}"><caption class="sr-only">${label}</caption>
      <thead><tr>${headers.map((header, index) => html`<th scope="col" class="${numericHeaders.has(header) ? 'numeric' : ''}">${header}${index === 0 ? html`<span class="table-swipe" aria-hidden="true">Swipe for more columns</span>` : ''}</th>`)}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
const sectionTitle = (title: string, count?: number, action?: Markup) => html`<div class="section-heading"><h2>${title}${count === undefined ? '' : html` <span class="count">${count}</span>`}</h2>${action ?? ''}</div>`;
const stat = (label: string, value: unknown, warning = false) => html`<div class="${warning ? 'attention' : ''}"><dt>${label}</dt><dd>${value}</dd></div>`;
const stockUrl = (kind: string, id: string, mode: string, orderId = '') => '/inventory/edit?' + new URLSearchParams({ kind, id, mode, ...(orderId ? { orderId } : {}) });
const stockLink = (kind: string, id: string, mode: string, label: string, orderId = '') => html`<a class="text-button" href="${stockUrl(kind, id, mode, orderId)}">${label}</a>`;
const late = (order: Order, plan?: Plan) => Boolean(order.requestedDate && plan?.completion && plan.completion > order.requestedDate);
const compactDate = (day: string, currentDay: string) => day.slice(0, 4) === currentDay.slice(0, 4) ? prettyDate(day).slice(0, -5) : prettyDate(day);
function materialsTable(label: string, needs: MaterialRequirement[]): Markup {
  if (!needs.length) return html`<p class="materials-empty">No materials needed. Products are already ready, or there are no open orders.</p>`;
  return table(label, ['Material', 'Items required', 'Sufficient stock'], needs.map(need => {
    const unit = need.material.unit.trim().toLowerCase(), length = ['m', 'cm', 'mm'].includes(unit), enough = need.balance.gte(0);
    return html`<tr class="${enough ? '' : 'shortage-row'}"><th scope="row">${need.material.name}</th>
      <td>${length ? html`<span class="cut-list">${need.items.map((item, index) => html`${index ? ', ' : ''}<span>${item.count} × ${unit === 'm' && D(item.quantity).lt(1) ? `${D(item.quantity).times(100).toFixed()} cm` : `${item.quantity} ${need.material.unit}`}</span>`)}</span><span class="cell-note">Total ${need.required.toFixed()} ${need.material.unit}</span>` : `${need.required.toFixed()} ${need.material.unit}`}</td>
      <td><span class="stock-check ${enough ? 'enough' : 'short'}"><span aria-hidden="true">${enough ? '✓' : '✕'}</span><span class="sr-only">${enough ? 'Sufficient stock' : 'Insufficient stock'}</span><span>(${enough ? '+' : ''}${need.balance.toFixed()} ${need.material.unit})</span></span></td>
    </tr>`;
  }), 'materials-summary-table');
}
function materialsOverview(data: Data): Markup {
  const requirements = materialRequirements(data);
  return html`<section class="materials-overview" aria-labelledby="materials-heading" x-data="materialsOverview">
    <div class="section-heading"><h2 id="materials-heading">Materials</h2>
      <div class="materials-tabs" role="tablist" aria-label="Material requirements" x-on:keydown.arrow-right.prevent="toggle" x-on:keydown.arrow-left.prevent="toggle" x-on:keydown.home.prevent="showTotal" x-on:keydown.end.prevent="showPerOrder">
        <button type="button" id="materials-total-tab" role="tab" aria-controls="materials-total" aria-selected="true" x-ref="totalTab" x-bind:aria-selected="total" x-bind:tabindex="totalTabIndex" x-on:click="showTotal">Total</button>
        <button type="button" id="materials-orders-tab" role="tab" aria-controls="materials-orders" aria-selected="false" tabindex="-1" x-ref="ordersTab" x-bind:aria-selected="perOrder" x-bind:tabindex="ordersTabIndex" x-on:click="showPerOrder">Per order</button>
      </div>
    </div>
    <div id="materials-total" role="tabpanel" aria-labelledby="materials-total-tab" tabindex="0" x-show="total">${materialsTable('Total materials for open orders', requirements.total)}</div>
    <div id="materials-orders" class="materials-by-order" role="tabpanel" aria-labelledby="materials-orders-tab" tabindex="0" x-show="perOrder" x-cloak>
      <p class="table-footnote">Stock is shared in this order: confirmed orders first, then pending orders by requested date.</p>
      ${requirements.perOrder.length ? requirements.perOrder.map(({ order, needs }) => html`<section><div class="section-heading"><h3><a href="/orders/${encodeURIComponent(order.id)}">${order.customer}</a></h3>${badge(order.status)}</div>${materialsTable(`Materials for ${order.customer}`, needs)}</section>`) : html`<p class="materials-empty">No open orders.</p>`}
    </div>
    <p class="table-footnote">Remaining production for all open orders, including pending estimates. Finished stock and units already made for an order are excluded. Stock is counted once.</p>
  </section>`;
}
function nextStep(order: Order, plan?: Plan): string {
  if (order.status === 'PENDING') return 'Review & confirm';
  if (!active(order)) return 'View order';
  if (plan?.needs.some(need => need.shortage.gt(0))) return 'Order materials';
  return order.lines.every(line => remaining(line) === 0) ? 'Hand over' : 'Record production';
}
function ordersTable(data: Data, orders: Order[], estimates: Plan[], day: string): Markup {
  return table('Orders and next steps', ['Order / products', 'Status / value', 'To make', 'Schedule', 'Materials', 'Next step'], orders.map(order => {
    const plan = estimates.find(plan => plan.order.id === order.id), missing = plan?.needs.filter(need => need.shortage.gt(0)) ?? [];
    const url = `/orders/${encodeURIComponent(order.id)}`;
    const unfinished = order.lines.filter(line => remaining(line) > 0);
    const actionUrl = active(order) && missing.length ? url + '#materials' : active(order) && unfinished.length === 1 ? stockUrl('product', unfinished[0].productId, 'produce', order.id) : active(order) && unfinished.length ? url + '#products' : url;
    return html`<tr class="${late(order, plan) ? 'warning-row' : ''}">
      <th scope="row"><a href="${url}">${order.customer}</a><span class="cell-note product-list">${order.lines.map(line => html`<span>${line.quantity} × ${lineQuote(data, line).name}</span>`)}</span></th>
      <td>${badge(order.status)}<span class="cell-note price-value">${money(sum(order.lines.map(line => D(line.price).times(line.quantity))), order.currency ?? data.settings.currency)}</span></td>
      <td class="numeric">${plan ? html`<strong>${plan.lines.reduce((count, line) => count + remaining(line), 0)}</strong><span class="cell-note">${duration(plan.minutes)}</span>` : '—'}</td>
      <td><span class="date-value">${plan ? plan.completion ? html`<span title="${prettyDate(plan.completion)}">${compactDate(plan.completion, day)}</span>` : 'Set work hours' : '—'}${late(order, plan) ? html` <strong class="attention">Late</strong>` : ''}</span><span class="cell-note date-value">${order.requestedDate ? html`<span title="${prettyDate(order.requestedDate)}">Due ${compactDate(order.requestedDate, day)}</span>` : 'No deadline'}</span></td>
      <td>${plan ? missing.length ? html`<a class="attention" href="${url}#materials">${missing.length} missing</a><span class="cell-note">Buy ${money(sum(missing.map(need => need.purchaseCost)), data.settings.currency)}</span>` : html`<span class="stock-ok">Ready</span>` : '—'}</td>
      <td><a class="text-button" href="${actionUrl}">${nextStep(order, plan)}</a></td>
    </tr>`;
  }), 'orders-table');
}
export function listPage(view: View, section: 'overview' | 'orders' | 'suppliers' | 'materials' | 'products' | 'inventory'): Markup {
  const { data } = view, currency = data.settings.currency, estimates = plans(data, view.day), reservedP = productReservations(data), reservedM = new Map<string, ReturnType<typeof D>>();
  for (const estimate of estimates.filter(plan => active(plan.order))) for (const need of estimate.needs) reservedM.set(need.material.id, (reservedM.get(need.material.id) ?? D(0)).plus(need.allocated));
  const availableMaterial = (material: Data['materials'][number]) => D(material.stock).minus(reservedM.get(material.id) ?? 0);
  const lowMaterial = (material: Data['materials'][number]) => material.threshold !== null && availableMaterial(material).lt(material.threshold);
  const lowProduct = (product: Data['products'][number]) => product.threshold !== null && availableProducts(data, product) < product.threshold;
  const actions = (section: 'suppliers' | 'materials' | 'products', id: string) => html`<div class="row-actions"><a class="text-button" href="/${section}/${encodeURIComponent(id)}/edit">Edit</a><form method="post" action="/${section}/${encodeURIComponent(id)}/delete" x-data="deleteEditor" x-on:submit.prevent="confirm">${revisionInput(view)}<button class="text-button quiet-danger" type="submit">Delete</button></form></div>`;
  const newOrder = data.products.length ? html`<a class="button" href="/orders/new">${icon('plus')}New order</a>` : undefined;
  if (section === 'overview') {
    const openOrders = data.orders.filter(order => active(order) || order.status === 'PENDING').sort((a, b) => (a.requestedDate ?? '9999').localeCompare(b.requestedDate ?? '9999'));
    const lowMaterials = data.materials.filter(lowMaterial), lowProducts = data.products.filter(lowProduct);
    const committed = estimates.filter(plan => active(plan.order));
    const setup = !data.suppliers.length ? empty('Let’s set up your workshop', 'Start with suppliers, then add materials and products.', '/suppliers/new', 'Add your first supplier') : !data.materials.length ? empty('Add your materials', 'Record the supplies you buy and their costs.', '/materials/new', 'Add a material') : !data.products.length ? empty('Define your first product', 'Add its recipe and production time to calculate costs.', '/products/new', 'Add a product') : '';
    return html`${heading('Your workshop', prettyDate(view.day), newOrder)}${materialsOverview(data)}${setup}
      <dl class="summary-strip">
        ${stat('Open orders', openOrders.length)}${stat('Pending', openOrders.filter(order => order.status === 'PENDING').length)}
        ${stat('Committed work', duration(sum(committed.map(plan => plan.minutes))))}
        ${stat('Blocked orders', committed.filter(plan => plan.needs.some(need => need.shortage.gt(0))).length, committed.some(plan => plan.needs.some(need => need.shortage.gt(0))))}
        ${stat('Late estimates', openOrders.filter(order => late(order, estimates.find(plan => plan.order.id === order.id))).length, openOrders.some(order => late(order, estimates.find(plan => plan.order.id === order.id))))}
        ${stat('Ready orders', committed.filter(plan => plan.lines.every(line => remaining(line) === 0)).length)}
      </dl>
      <section>${sectionTitle('Orders to finish', openOrders.length, html`<a href="/orders" class="text-button">All orders</a>`)}
        ${openOrders.length ? ordersTable(data, openOrders, estimates, view.day) : empty('No orders waiting', 'Enter an order to see its materials, costs, and completion estimate.')}
      </section>
      <section>${sectionTitle('Stock running low', lowMaterials.length + lowProducts.length, html`<a href="/inventory" class="text-button">Inventory</a>`)}
        ${lowMaterials.length + lowProducts.length ? html`<div class="overview-stock-grid">
          ${lowMaterials.length ? html`<div><h3>Materials to restock</h3>${table('Materials running low', ['Material', 'Available / minimum', 'Action'], lowMaterials.map(material => html`<tr class="warning-row"><th scope="row">${material.name}<span class="cell-note">${material.unit}</span></th><td class="numeric attention"><strong>${availableMaterial(material).toFixed()}</strong><span class="cell-note">Min ${material.threshold}</span></td><td>${stockLink('material', material.id, 'receive', 'Receive')}</td></tr>`))}</div>` : ''}
          ${lowProducts.length ? html`<div><h3>Products to make</h3>${table('Finished products running low', ['Product', 'Available / minimum', 'Action'], lowProducts.map(product => html`<tr class="warning-row"><th scope="row">${product.name}</th><td class="numeric attention"><strong>${availableProducts(data, product)}</strong><span class="cell-note">Min ${product.threshold}</span></td><td>${stockLink('product', product.id, 'produce', 'Make')}</td></tr>`))}</div>` : ''}
        </div>` : empty('Stock is looking good', 'Warnings use available stock after reservations. Set thresholds on materials and products.')}
      </section>`;
  }
  if (section === 'orders') {
    const orders = [...data.orders].sort((a, b) => Number(!active(a) && a.status !== 'PENDING') - Number(!active(b) && b.status !== 'PENDING') || (a.requestedDate ?? '9999').localeCompare(b.requestedDate ?? '9999') || b.createdDate.localeCompare(a.createdDate));
    return html`${heading('Orders', 'Quantities, deadlines, shortages, and the next action.', newOrder)}${!data.products.length ? empty('Add a product first', 'Define what you make before adding an order.', '/products', 'Go to products') : !orders.length ? empty('No orders yet', 'Enter an order to see its materials, costs, and production plan.', '/orders/new', 'New order') : ordersTable(data, orders, estimates, view.day)}`;
  }
  if (section === 'suppliers') return html`${heading('Suppliers', 'Contacts, supplies, and delivery times.', html`<a class="button" href="/suppliers/new">${icon('plus')}Add supplier</a>`)}${!data.suppliers.length ? empty('Who do you buy from?', 'Keep purchasing contacts and delivery times here.') : table('Suppliers', ['Supplier', 'Contact details', 'Delivery', 'Materials supplied', 'Actions'], [...data.suppliers].sort((a, b) => a.name.localeCompare(b.name)).map(supplier => html`<tr><th scope="row">${supplier.name}</th><td class="contact">${supplier.contact || 'No contact details'}</td><td>${supplier.leadDays} business days</td><td class="numeric">${data.materials.filter(material => material.supplierId === supplier.id).length}</td><td>${actions('suppliers', supplier.id)}</td></tr>`))}`;
  if (section === 'materials') return html`${heading('Materials', 'Purchase costs and available stock after reservations.', data.suppliers.length ? html`<div class="row-actions"><a class="button secondary" href="/inventory/receive">Received materials</a><a class="button" href="/materials/new">${icon('plus')}Add material</a></div>` : undefined)}${!data.suppliers.length ? empty('Add a supplier first', 'Every material needs a purchasing contact.', '/suppliers/new', 'Add supplier') : !data.materials.length ? empty('Your materials belong here', 'Add each supply with its purchase quantity and price.', '/materials/new', 'Add material') : table('Materials', ['Material', 'Available', 'Unit cost', 'Purchase pack', 'Supplier / delivery', 'Warn below', 'Actions'], [...data.materials].sort((a, b) => Number(lowMaterial(b)) - Number(lowMaterial(a)) || a.name.localeCompare(b.name)).map(material => { const supplier = find(data.suppliers, material.supplierId); return html`<tr class="${lowMaterial(material) ? 'warning-row' : ''}"><th scope="row">${material.name}<span class="cell-note">${material.unit}${lowMaterial(material) ? html` · <span class="attention">Low stock</span>` : ''}</span></th><td class="numeric ${lowMaterial(material) ? 'attention' : ''}">${availableMaterial(material).toFixed()}</td><td class="numeric">${currency} ${D(material.packPrice).div(material.packQuantity).toDecimalPlaces(4).toFixed()}</td><td>${material.packQuantity} ${material.unit}<span class="cell-note">${money(material.packPrice, currency)}</span></td><td>${supplier.name}<span class="cell-note">${supplier.leadDays} business days</span></td><td class="numeric">${material.threshold ?? 'Off'}</td><td>${actions('materials', material.id)}</td></tr>`; }))}`;
  if (section === 'products') return html`${heading('Products', 'Materials, your time, minimum price, and ready stock.', data.materials.length ? html`<a class="button" href="/products/new">${icon('plus')}Add product</a>` : undefined)}${!data.materials.length ? empty('Add your materials first', 'Product costs come from their recipes.', '/materials', 'Go to materials') : !data.products.length ? empty('What do you make?', 'Define a product and its recipe.', '/products/new', 'Add product') : table('Products and costs', ['Product / recipe', 'Ready', 'Materials', 'Your time', 'Minimum price', 'Warn below', 'Actions'], [...data.products].sort((a, b) => a.name.localeCompare(b.name)).map(product => { const q = quote(data, product); return html`<tr class="${lowProduct(product) ? 'warning-row' : ''}"><th scope="row">${product.name}<details class="recipe-details"><summary>Recipe · ${product.recipe.length} materials</summary><ul>${product.recipe.map(ingredient => html`<li>${ingredient.quantity} ${find(data.materials, ingredient.materialId).unit} ${find(data.materials, ingredient.materialId).name}</li>`)}</ul></details></th><td class="numeric ${lowProduct(product) ? 'attention' : ''}">${availableProducts(data, product)}${lowProduct(product) ? html`<span class="cell-note attention">Low stock</span>` : ''}</td><td class="numeric">${money(materialCost(q), currency)}</td><td class="numeric">${duration(product.minutes)}<span class="cell-note">${money(labourCost(q), currency)}</span></td><td class="numeric"><strong>${money(minimumPrice(q), currency)}</strong></td><td class="numeric">${product.threshold ?? 'Off'}</td><td>${actions('products', product.id)}</td></tr>`; }))}`;
  const inventoryRows = (kind: 'material' | 'product') => {
    const items = kind === 'material' ? data.materials : data.products;
    return items.map(item => {
      const reserved = kind === 'material' ? (reservedM.get(item.id) ?? D(0)).toFixed() : String(reservedP.get(item.id) ?? 0);
      const free = D(item.stock).minus(reserved), low = item.threshold !== null && free.lt(item.threshold);
      return html`<tr class="${low ? 'warning-row' : ''}"><th scope="row">${item.name}<span class="cell-note">${'unit' in item ? item.unit : 'Finished products'}${low ? html` · <span class="attention">Low stock</span>` : ''}</span></th><td class="numeric"><strong>${free.toFixed()}</strong></td><td class="numeric">${item.stock}</td><td class="numeric">${reserved}</td><td class="numeric">${item.threshold ?? 'Off'}</td><td><div class="row-actions">${kind === 'product' ? stockLink(kind, item.id, 'produce', 'Make') : ''}${stockLink(kind, item.id, 'receive', 'Receive')}${stockLink(kind, item.id, 'count', 'Correct count')}</div></td></tr>`;
    });
  };
  return html`${heading('Inventory', 'Physical stock, reservations, and what is free to use.', html`<a class="button" href="/inventory/receive">Received materials</a>`)}
    <section>${sectionTitle('Materials', data.materials.length)}${data.materials.length ? table('Material inventory', ['Material', 'Available', 'On shelf', 'Reserved', 'Warn below', 'Update stock'], inventoryRows('material')) : empty('No materials yet', 'Add supplies before recording stock.', '/materials', 'Go to materials')}</section>
    <section>${sectionTitle('Finished products', data.products.length)}${data.products.length ? table('Finished product inventory', ['Product', 'Available', 'On shelf', 'Reserved', 'Warn below', 'Update stock'], inventoryRows('product')) : empty('No products yet', 'Define your products to record production.', '/products', 'Go to products')}</section>
    ${data.movements.length ? html`<details class="history-section"><summary>Recent stock changes <span class="muted">Latest 30</span></summary>${table('Recent stock changes', ['Date', 'Item', 'Change', 'Reason'], data.movements.slice(-30).reverse().map(movement => html`<tr><td class="date-value">${prettyDate(movement.date.slice(0, 10))}</td><th scope="row">${movement.item}</th><td class="numeric">${movement.quantity} ${movement.unit}</td><td>${movement.note}</td></tr>`))}</details>` : ''}`;
}

export function orderPage(view: View, id: string): Markup {
  const { data } = view, order = find(data.orders, id), estimate = plans(data, view.day).find(plan => plan.order.id === id), currency = order.currency ?? data.settings.currency;
  const actionForm = (action: string, label: string, className = 'button') => {
    const confirmation = action === 'cancel' ? 'cancelEditor' : action === 'delete' ? 'deleteOrderEditor' : null;
    return html`<form method="post" action="/orders/${encodeURIComponent(id)}/${action}" ${confirmation ? html`x-data="${confirmation}" x-ref="actionForm" x-on:submit.prevent="${action === 'delete' ? 'open' : 'confirm'}"` : ''}>${revisionInput(view)}<button type="submit" class="${className}">${label}</button>
      ${action === 'delete' ? html`<dialog x-ref="confirmation" aria-labelledby="delete-order-title"><div class="dialog-heading"><h2 id="delete-order-title">Delete this order?</h2></div><p>This permanently removes the order and releases unused reservations. Physical stock and stock history will be kept unchanged.</p><p>This cannot be undone.</p><div class="form-actions"><button type="button" class="button danger" x-on:click="confirm">Delete permanently</button><button type="button" class="button secondary" x-on:click="cancel" autofocus>Keep order</button></div></dialog>` : ''}</form>`;
  };
  const selling = sum(order.lines.map(line => D(line.price).times(line.quantity)));
  const minimum = sum(order.lines.map(line => minimumPrice(lineQuote(data, line)).times(line.quantity)));
  const materialTotal = sum(order.lines.map(line => materialCost(lineQuote(data, line)).times(line.quantity)));
  const labourTotal = sum(order.lines.map(line => labourCost(lineQuote(data, line)).times(line.quantity)));
  const missing = estimate?.needs.filter(need => need.shortage.gt(0)) ?? [];
  const totalProduction = estimate ? sum(estimate.lines.map(line => D(lineQuote(data, line).minutes).times(line.quantity - line.fromStock))) : null;
  return html`<div class="order-breadcrumb"><a href="/orders" class="text-button back-link">Back to orders</a><div class="row-actions">${order.contact ? html`<details class="customer-contact"><summary>Contact</summary><p class="contact">${order.contact}</p></details>` : ''}${badge(order.status)}</div></div>
    ${heading(order.customer, `Created ${prettyDate(order.createdDate)}${order.requestedDate ? ` · Requested ${prettyDate(order.requestedDate)}` : ''}`)}
    <dl class="summary-strip order-summary">
      ${stat('Selling price', money(selling, currency), selling.lt(minimum))}${stat('Minimum total', money(minimum, currency))}
      ${stat('Purchases needed', money(sum(missing.map(need => need.purchaseCost)), data.settings.currency), missing.length > 0)}${stat('Still to make', estimate ? estimate.lines.reduce((count, line) => count + remaining(line), 0) : '—')}
      ${stat('Work remaining', estimate ? duration(estimate.minutes) : '—')}${stat('Estimated ready', estimate?.completion ? prettyDate(estimate.completion) : estimate ? 'Set work hours' : '—', late(order, estimate))}
    </dl>
    <section class="order-toolbar actions-panel" aria-label="Order actions"><p class="${late(order, estimate) || missing.length ? 'attention' : ''}">${late(order, estimate) ? 'Estimate is late. ' : ''}${missing.length ? `${missing.length} supplies missing. ` : ''}${order.status === 'PENDING' ? 'Confirm to reserve stock.' : active(order) ? missing.length ? 'Receive missing materials.' : order.lines.every(line => remaining(line) === 0) ? 'Ready to hand over.' : 'Record each batch as you make it.' : `This order is ${statuses[order.status].toLowerCase()}.`}</p>
      <div class="row-actions">
        ${order.status === 'PENDING' ? html`${actionForm('confirm', 'Confirm and reserve stock')}<a class="button secondary" href="/orders/${encodeURIComponent(id)}/edit">Edit order</a>` : ''}
        ${active(order) && order.lines.every(line => remaining(line) === 0) ? actionForm('complete', 'Complete and hand over') : ''}
        ${active(order) || order.status === 'PENDING' ? actionForm('cancel', 'Cancel order', 'text-button quiet-danger') : ''}${actionForm('delete', 'Delete order', 'text-button quiet-danger')}
      </div>
    </section>
    ${estimate?.reason ? html`<p class="notice error">${estimate.reason}</p>` : ''}
    <section id="products">${sectionTitle('Ordered products', order.lines.length, html`<span class="hint">${order.confirmedAt ? 'Costs saved at confirmation' : 'Estimated product costs'} · Materials ${money(materialTotal, currency)} · Your time ${money(labourTotal, currency)}</span>`)}
      ${table('Ordered products', ['Product', 'Ordered', 'From stock', 'Made', 'To make', 'Each', 'Line total', 'Next action'], order.lines.map(line => {
        const q = lineQuote(data, line), planned = estimate?.lines.find(item => item.productId === line.productId) ?? line;
        return html`<tr><th scope="row">${q.name}</th><td class="numeric">${line.quantity}</td><td class="numeric">${planned.fromStock}</td><td class="numeric">${line.produced}</td><td class="numeric">${estimate ? remaining(planned) : '—'}</td><td class="numeric">${money(line.price, currency)}</td><td class="numeric">${money(D(line.price).times(line.quantity), currency)}</td><td>${active(order) && remaining(line) > 0 ? stockLink('product', line.productId, 'produce', 'Record production', order.id) : '—'}</td></tr>`;
      }))}
    </section>
    ${estimate ? html`<section id="materials">${sectionTitle('Materials still needed', estimate.needs.length, html`<strong class="purchase-total">Purchases: ${money(sum(estimate.needs.map(need => need.purchaseCost)), data.settings.currency)}</strong>`)}
      ${estimate.needs.length ? table('Required materials and purchases', ['Material', 'Required / cost', 'Available / allocated', 'Missing', 'Buy / cost', 'Supplier / arrival', 'Action'], [...estimate.needs].sort((a, b) => Number(b.shortage.gt(0)) - Number(a.shortage.gt(0)) || a.material.name.localeCompare(b.material.name)).map(need => {
        const supplier = find(data.suppliers, need.material.supplierId);
        const usedCost = sum(estimate.lines.flatMap(line => lineQuote(data, line).recipe.filter(r => r.materialId === need.material.id).map(r => D(r.quantity).times(remaining(line)).times(r.packPrice).div(r.packQuantity))));
        return html`<tr class="${need.shortage.gt(0) ? 'warning-row' : ''}"><th scope="row">${need.material.name} <span class="cell-unit">(${need.material.unit})</span></th>
          <td class="numeric">${need.required.toFixed()}<span class="cell-note">${money(usedCost, currency)}</span></td>
          <td class="numeric">${need.stockAvailable.toFixed()}<span class="cell-note">${need.allocated.toFixed()} allocated</span></td>
          <td class="numeric ${need.shortage.gt(0) ? 'attention' : ''}"><strong>${need.shortage.toFixed()}</strong></td>
          <td class="numeric">${need.shortage.gt(0) ? html`<strong>${need.purchaseQuantity.toFixed()}</strong><span class="cell-note">${money(need.purchaseCost, data.settings.currency)}</span>` : html`<span class="stock-ok">In stock</span>`}</td>
          <td>${need.shortage.gt(0) ? html`<details class="contact-details"><summary>${supplier.name}</summary><p class="contact">${supplier.contact || 'Add contact details in Suppliers.'}</p></details><span class="cell-note">Arrives ${compactDate(need.arrival, view.day)}</span>` : '—'}</td>
          <td>${need.shortage.gt(0) ? stockLink('material', need.material.id, 'receive', 'Receive') : '—'}</td>
        </tr>`;
      }), 'requirements-table') : empty('No materials left to prepare', 'The products are ready, or production is finished.')}
      <p class="table-footnote">${order.status === 'PENDING' ? 'Preview only; stock is not reserved. ' : ''}Available stock excludes earlier orders. ${totalProduction ? html`Total production: ${duration(totalProduction)}. ` : ''}Materials ready: ${prettyDate(estimate.ready)}. Arrival assumes ordering today; completion uses your work schedule and confirmed orders.</p>
    </section>` : ''}`;
}
