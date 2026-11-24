import { barcode, barcodeKey, type Barcode, type BarcodeFormat } from './barcodes.ts';
import type { ReceiptRow } from './receiving.ts';
import Alpine from '@alpinejs/csp';

interface RecipeRow { key: string; materialId: string; quantity: string; unit: string }
interface OrderRow { key: string; productId: string; quantity: string; price: string }
interface MaterialChoice { id: string; name: string; unit: string }
interface ProductChoice { id: string; name: string; minimum: string; available: number }
interface Bootstrap { revision: string; openSettings: boolean; materials?: MaterialChoice[]; products?: ProductChoice[]; rows?: unknown[]; initialPreview?: Record<string, string> | null; daysOff?: string[]; barcodes?: Barcode[]; receivingMaterials?: (MaterialChoice & { barcodes: Barcode[] })[]; suppliers?: { id: string }[] }
const page = JSON.parse(document.getElementById('page-data')!.textContent!) as Bootstrap;

async function previewForm(path: string, form: HTMLFormElement): Promise<Record<string, string>> {
  const response = await fetch(path, { method: 'POST', body: new FormData(form) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not calculate the preview. Try again.');
  return result;
}
Alpine.data('shell', () => ({
  updated: false,
  darkMode: document.documentElement.dataset.theme === 'dark',
  get themeLabel(): string { return this.darkMode ? 'Switch to light mode' : 'Switch to dark mode'; },
  toggleTheme() {
    this.darkMode = !this.darkMode;
    const theme = this.darkMode ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('smerp-theme', theme); } catch { /* The current page still changes without storage. */ }
  },
  init() {
    if (page.openSettings) this.$nextTick(() => this.openSettings());
    window.addEventListener('focus', () => this.checkUpdates());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.checkUpdates(); });
  },
  async checkUpdates() {
    try { const response = await fetch('/api/revision', { cache: 'no-store' }); if (response.ok) this.updated = (await response.json()).revision !== page.revision; } catch { /* The next save still checks for changes. */ }
  },
  refresh() { location.reload(); },
  openSettings() { (document.getElementById('settings-dialog') as HTMLDialogElement | null)?.showModal(); },
  closeSettings() { (document.getElementById('settings-dialog') as HTMLDialogElement | null)?.close(); }
}));
Alpine.data('materialsOverview', () => ({
  tab: 'total',
  get total(): boolean { return this.tab === 'total'; },
  get perOrder(): boolean { return this.tab === 'orders'; },
  get totalTabIndex(): number { return this.total ? 0 : -1; },
  get ordersTabIndex(): number { return this.perOrder ? 0 : -1; },
  showTotal() { this.tab = 'total'; (this.$refs.totalTab as HTMLButtonElement).focus(); },
  showPerOrder() { this.tab = 'orders'; (this.$refs.ordersTab as HTMLButtonElement).focus(); },
  toggle() { if (this.total) this.showPerOrder(); else this.showTotal(); }
}));
Alpine.data('recipeEditor', () => ({
  rows: (page.rows ?? []) as RecipeRow[], materials: page.materials ?? [], result: page.initialPreview ?? null,
  error: '', generation: 0,
  get singleRow(): boolean { return this.rows.length <= 1; },
  get allSelected(): boolean { return this.rows.length >= this.materials.length; },
  get hasPreview(): boolean { return this.result !== null; },
  get noPreview(): boolean { return this.result === null; },
  init() { this.$nextTick(() => this.preview()); },
  quantityLabel(row: RecipeRow) { return `Quantity (${row.unit})`; },
  add() {
    const material = this.materials.find(m => !this.rows.some(row => row.materialId === m.id));
    if (material) this.rows.push({ key: crypto.randomUUID(), materialId: material.id, quantity: '1', unit: material.unit });
    this.$nextTick(() => this.preview());
  },
  remove(key: string) { if (this.rows.length > 1) this.rows = this.rows.filter(row => row.key !== key); this.$nextTick(() => this.preview()); },
  materialChanged(row: RecipeRow) { row.unit = this.materials.find(m => m.id === row.materialId)?.unit ?? 'units'; this.$nextTick(() => this.preview()); },
  async preview() {
    const generation = ++this.generation;
    try { const result = await previewForm('/api/product-preview', this.$refs.form as HTMLFormElement); if (generation === this.generation) { this.result = result; this.error = ''; } }
    catch (error) { if (generation === this.generation) { this.result = null; this.error = error instanceof Error ? error.message : 'Check your recipe.'; } }
  }
}));
Alpine.data('orderEditor', () => ({
  rows: (page.rows ?? []) as OrderRow[], products: page.products ?? [], result: null as Record<string, string> | null,
  error: '', generation: 0,
  get singleRow(): boolean { return this.rows.length <= 1; },
  get allSelected(): boolean { return this.rows.length >= this.products.length; },
  get hasPreview(): boolean { return this.result !== null; },
  get noPreview(): boolean { return this.result === null; },
  get warning(): string { return this.result?.warning ?? ''; },
  init() { this.$nextTick(() => this.preview()); },
  minimumLabel(row: OrderRow) { const product = this.products.find(p => p.id === row.productId); return product ? `Minimum recommended: ${product.minimum} each` : ''; },
  productChanged(row: OrderRow) { row.price = this.products.find(p => p.id === row.productId)?.minimum ?? ''; this.$nextTick(() => this.preview()); },
  add() {
    const product = this.products.find(p => !this.rows.some(row => row.productId === p.id));
    if (product) this.rows.push({ key: crypto.randomUUID(), productId: product.id, quantity: '1', price: product.minimum });
    this.$nextTick(() => this.preview());
  },
  remove(key: string) { if (this.rows.length > 1) this.rows = this.rows.filter(row => row.key !== key); this.$nextTick(() => this.preview()); },
  async preview() {
    const generation = ++this.generation;
    try { const result = await previewForm('/api/order-preview', this.$refs.form as HTMLFormElement); if (generation === this.generation) { this.result = result; this.error = ''; } }
    catch (error) { if (generation === this.generation) { this.result = null; this.error = error instanceof Error ? error.message : 'Check the order quantities.'; } }
  }
}));
Alpine.data('scheduleEditor', () => ({
  daysOff: page.daysOff ?? [], newDay: '',
  get empty(): boolean { return this.daysOff.length === 0; },
  add() { if (this.newDay && !this.daysOff.includes(this.newDay)) this.daysOff = [...this.daysOff, this.newDay].sort(); this.newDay = ''; },
  remove(day: string) { this.daysOff = this.daysOff.filter(current => current !== day); },
  formatDay(day: string) { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`)); }
}));
Alpine.data('restoreEditor', () => ({
  busy: false, error: '', summary: '',
  get previewLabel(): string { return this.busy ? 'Checking backup…' : 'Preview backup'; },
  async preview() {
    this.busy = true; this.error = '';
    try {
      const result = await previewForm('/api/restore-preview', this.$refs.restoreForm as HTMLFormElement);
      this.summary = result.summary;
      (this.$refs.confirmation as HTMLDialogElement).showModal();
    } catch (error) { this.error = error instanceof Error ? error.message : 'Could not read the backup.'; this.$el.scrollIntoView({ block: 'nearest' }); }
    finally { this.busy = false; }
  },
  cancel() { (this.$refs.confirmation as HTMLDialogElement).close(); },
  confirm() {
    const form = this.$refs.restoreForm as HTMLFormElement;
    form.querySelector<HTMLInputElement>('input[name="confirmRestore"]')!.value = 'replace';
    (this.$refs.confirmation as HTMLDialogElement).close();
    form.submit();
  }
}));
Alpine.data('deleteEditor', () => ({ confirm() { if (window.confirm('Delete this record? Records used by products or orders cannot be deleted.')) (this.$el as HTMLFormElement).submit(); } }));
Alpine.data('deleteOrderEditor', () => ({
  open() { (this.$refs.confirmation as HTMLDialogElement).showModal(); },
  cancel() { (this.$refs.confirmation as HTMLDialogElement).close(); },
  confirm() { (this.$refs.actionForm as HTMLFormElement).submit(); }
}));
Alpine.data('cancelEditor', () => ({ confirm() { if (window.confirm('Cancel this order? Unused reservations will be released. Finished products stay in inventory; materials already used remain consumed.')) (this.$el as HTMLFormElement).submit(); } }));
document.addEventListener('submit', event => {
  if (event.defaultPrevented) return;
  const form = event.target as HTMLFormElement;
  requestAnimationFrame(() => { form.setAttribute('aria-busy', 'true'); form.querySelectorAll<HTMLButtonElement>('button[type="submit"]').forEach(button => { button.disabled = true; }); });
});
Alpine.data('barcodeEditor', () => ({
  codes: (page.barcodes ?? []).map(code => ({ ...code, key: crypto.randomUUID() })),
  add() { this.codes.push({ key: crypto.randomUUID(), value: '', format: 'EAN_13' }); },
  remove(key: string) { this.codes = this.codes.filter(code => code.key !== key); }
}));

interface DeliveryRow extends ReceiptRow { key: string; name: string; unit: string }
Alpine.data('receivingEditor', () => {
  // Keep camera controls outside Alpine's reactive proxies.
  let cameraController: AbortController | null = null;
  return {
    rows: [] as DeliveryRow[], revision: page.revision, receiptId: crypto.randomUUID(),
    camera: false, starting: false, busy: false, error: '', itemError: '',
    mode: '', selectedId: '', chosenId: '', pendingCode: null as Barcode | null,
    manualCode: '', manualFormat: 'EAN_13' as BarcodeFormat, quantity: '', lastKey: '',
    newName: '', newUnit: 'pieces', newSupplier: page.suppliers?.[0]?.id ?? '', newPackQuantity: '1', newPackPrice: '',
    get materials(): (MaterialChoice & { newMaterial?: ReceiptRow['newMaterial'] })[] {
      const additions = this.rows.filter((r, index, rows) => r.newMaterial && rows.findIndex(other => other.materialId === r.materialId) === index).map(r => ({ id: r.materialId, name: r.name, unit: r.unit, newMaterial: r.newMaterial }));
      return [...(page.receivingMaterials ?? []), ...additions];
    },
    get empty(): boolean { return !this.rows.length; },
    get hasRows(): boolean { return !this.empty; },
    get cannotSave(): boolean { return this.empty || this.busy; },
    get saveLabel(): string { return this.busy ? 'Saving delivery…' : 'Save received materials'; },
    get unknown(): boolean { return this.mode !== 'known'; },
    get assigning(): boolean { return this.mode === 'assign'; },
    get notAssigning(): boolean { return !this.assigning; },
    get creating(): boolean { return this.mode === 'new'; },
    get notCreating(): boolean { return !this.creating; },
    get canAdd(): boolean { return this.creating || (!!this.selectedId && ['known', 'assign'].includes(this.mode)); },
    get cannotAdd(): boolean { return !this.canAdd; },
    get hasCode(): boolean { return !!this.pendingCode; },
    get pendingCodeLabel(): string { return this.pendingCode ? `${this.pendingCode.format.replaceAll('_', '-')} · ${this.pendingCode.value}` : ''; },
    get itemHeading(): string { return this.mode === 'known' ? this.materials.find(m => m.id === this.selectedId)?.name ?? 'Received material' : 'Unknown barcode'; },
    get receivedLabel(): string { return `Quantity received (${this.creating ? this.newUnit : this.materials.find(m => m.id === this.selectedId)?.unit ?? 'units'})`; },
    quantityLabel(row: DeliveryRow) { return `Quantity received for ${row.name} (${row.unit})`; },
    codeLabel(row: DeliveryRow) { return row.code?.value ?? 'No barcode'; },
    init() {
      this._onHide = () => { if (document.hidden) this.stopCamera(); };
      this._onLeave = (event: BeforeUnloadEvent) => { if (this.rows.length && !this.busy) { event.preventDefault(); event.returnValue = ''; } };
      this._onPageHide = () => this.stopCamera();
      document.addEventListener('visibilitychange', this._onHide);
      window.addEventListener('pagehide', this._onPageHide);
      window.addEventListener('beforeunload', this._onLeave);
    },
    _onHide: null as (() => void) | null, _onPageHide: null as (() => void) | null, _onLeave: null as ((event: BeforeUnloadEvent) => void) | null,
    destroy() {
      this.stopCamera();
      if (this._onHide) document.removeEventListener('visibilitychange', this._onHide);
      if (this._onPageHide) window.removeEventListener('pagehide', this._onPageHide);
      if (this._onLeave) window.removeEventListener('beforeunload', this._onLeave);
    },
    async scan() {
      this.lastKey = ''; this.error = '';
      if (this.camera || this.starting) return;
      if (!navigator.mediaDevices?.getUserMedia) { this.error = 'Camera unavailable. Use HTTPS and allow camera access, or enter the barcode manually.'; return; }
      this.camera = true; this.starting = true;
      const controller = new AbortController(); cameraController = controller;
      try {
        const modulePath = '/assets/scanner.js';
        const scanner = await import(modulePath) as typeof import('./scanner.ts');
        if (controller.signal.aborted) return;
        await scanner.startScanner(this.$refs.video as HTMLVideoElement, code => {
          if ((this.$refs.itemDialog as HTMLDialogElement).open || this.busy) return;
          const key = barcodeKey(code);
          if (key === this.lastKey) return;
          this.lastKey = key; this.openCode(code);
        }, controller.signal, () => { this.stopCamera(); this.error = 'Scanning stopped. Try starting the camera again, or enter the barcode manually.'; });
      } catch (error) {
        if (!controller.signal.aborted) {
          this.stopCamera();
          const name = error instanceof Error ? error.name : '';
          this.error = name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser, or enter the barcode manually.' : 'Could not start the camera. Check that it is connected and not in use, or enter the barcode manually.';
        }
      } finally { if (cameraController === controller) this.starting = false; }
    },
    stopCamera() { cameraController?.abort(); cameraController = null; this.camera = false; this.starting = false; },
    enterCode() { this.openCode({ format: this.manualFormat, value: this.manualCode }); },
    openCode(input: Barcode) {
      try {
        const code = barcode(input), key = barcodeKey(code);
        const known = page.receivingMaterials?.find(m => m.barcodes.some(c => barcodeKey(c) === key));
        const staged = this.rows.find(r => r.code && barcodeKey(r.code) === key);
        this.pendingCode = code; this.selectedId = known?.id ?? staged?.materialId ?? ''; this.mode = this.selectedId ? 'known' : '';
        this.showItem();
      } catch (error) { this.error = error instanceof Error ? error.message : 'Check the barcode.'; }
    },
    chooseMaterial() { this.pendingCode = null; this.selectedId = this.chosenId; this.mode = 'known'; this.showItem(); },
    showItem() {
      this.error = ''; this.itemError = ''; this.quantity = ''; this.newName = ''; this.newUnit = 'pieces'; this.newPackQuantity = '1'; this.newPackPrice = '';
      (this.$refs.itemDialog as HTMLDialogElement).showModal();
      if (this.mode === 'known') this.$nextTick(() => (this.$refs.quantity as HTMLInputElement).focus());
    },
    assignExisting() { this.mode = 'assign'; this.selectedId = ''; },
    createNew() { this.mode = 'new'; this.selectedId = ''; },
    addQuantity() {
      const form = this.$refs.itemForm as HTMLFormElement;
      if (!this.canAdd || !form.reportValidity()) return;
      let material = this.materials.find(m => m.id === this.selectedId);
      if (this.creating) material = { id: `new-${crypto.randomUUID()}`, name: this.newName.trim(), unit: this.newUnit.trim(), newMaterial: { name: this.newName.trim(), unit: this.newUnit.trim(), supplierId: this.newSupplier, packQuantity: this.newPackQuantity, packPrice: this.newPackPrice } };
      if (!material?.name || !material.unit) { this.itemError = 'Enter a material name and measurement unit.'; return; }
      this.rows.push({ key: crypto.randomUUID(), materialId: material.id, name: material.name, unit: material.unit, quantity: this.quantity, code: this.pendingCode ? { ...this.pendingCode } : null, ...(material.newMaterial ? { newMaterial: { ...material.newMaterial } } : {}) });
      this.cancelItem(); this.manualCode = '';
    },
    cancelItem() { (this.$refs.itemDialog as HTMLDialogElement).close(); },
    dialogClosed() { this.itemError = ''; },
    remove(key: string) { this.rows = this.rows.filter(r => r.key !== key); },
    async save() {
      if (this.cannotSave) return;
      for (const input of this.$root.querySelectorAll<HTMLInputElement>('table input')) if (!input.reportValidity()) return;
      this.busy = true; this.error = ''; this.stopCamera();
      try {
        const response = await fetch('/api/materials/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: this.revision, receiptId: this.receiptId, rows: this.rows }) });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 409 && result.revision) {
            this.revision = result.revision; page.receivingMaterials = result.materials;
            for (const row of this.rows) {
              const latest = page.receivingMaterials?.find(m => m.id === row.materialId);
              if (latest) { row.name = latest.name; row.unit = latest.unit; }
            }
          }
          throw new Error(result.error || 'Could not save the delivery. Your list is still here.');
        }
        this.rows = []; location.assign('/inventory?received=1');
      } catch (error) { this.error = error instanceof Error ? error.message : 'Could not save. Check your connection and try again. Your list is still here.'; }
      finally { this.busy = false; }
    }
  };
});
Alpine.start();
