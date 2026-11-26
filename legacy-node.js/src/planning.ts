import { D, active, availableProducts, businessDays, find, lineQuote, nextDate, remaining, sum, today, weekday, type Data, type Material, type Order, type OrderLine } from './model.ts';
import { Decimal } from 'decimal.js';

export interface Need { material: Material; required: Decimal; stockAvailable: Decimal; allocated: Decimal; shortage: Decimal; purchaseQuantity: Decimal; purchaseCost: Decimal; arrival: string }
export interface Plan { order: Order; lines: OrderLine[]; needs: Need[]; minutes: Decimal; ready: string; completion: string | null; reason: string | null }

/** Active orders share one calendar. Each pending order gets its own preview after committed work. */
export function plans(data: Data, day = today()): Plan[] {
  const stock = new Map(data.materials.map(material => [material.id, D(material.stock)]));
  const calendar = new Map<string, Decimal>();
  const confirmed = data.orders.filter(active).sort((a, b) => Date.parse(a.confirmedAt!) - Date.parse(b.confirmedAt!));
  function build(order: Order, preview: boolean): Plan {
    const available = preview ? new Map(stock) : stock;
    const occupied = preview ? new Map(calendar) : calendar;
    const lines = preview ? order.lines.map(line => ({ ...line, quote: lineQuote(data, line), fromStock: Math.min(line.quantity, availableProducts(data, find(data.products, line.productId))) })) : order.lines;
    const required = new Map<string, Decimal>();
    for (const line of lines) for (const ingredient of lineQuote(data, line).recipe) required.set(ingredient.materialId, (required.get(ingredient.materialId) ?? D(0)).plus(D(ingredient.quantity).times(remaining(line))));
    const needs = [...required].filter(([, quantity]) => quantity.gt(0)).map(([key, quantity]) => {
      const material = find(data.materials, key), stockAvailable = available.get(key)!, allocated = Decimal.min(stockAvailable, quantity), shortage = quantity.minus(allocated);
      available.set(key, stockAvailable.minus(allocated));
      const packs = shortage.div(material.packQuantity).ceil();
      return { material, required: quantity, stockAvailable, allocated, shortage, purchaseQuantity: packs.times(material.packQuantity), purchaseCost: packs.times(material.packPrice), arrival: shortage.gt(0) ? businessDays(day, find(data.suppliers, material.supplierId).leadDays) : day };
    });
    const ready = needs.reduce((last, need) => need.arrival > last ? need.arrival : last, day);
    const minutes = sum(lines.map(line => D(lineQuote(data, line).minutes).times(remaining(line))));
    let left = minutes, workingDay = ready, completion: string | null = left.isZero() ? day : null;
    if (data.schedule.hours.some(value => D(value).gt(0))) {
      for (let count = 0; count < 3660 && left.gt(0); count++, workingDay = nextDate(workingDay)) {
        const capacity = data.schedule.daysOff.includes(workingDay) ? D(0) : D(data.schedule.hours[weekday(workingDay)]).times(60);
        const free = Decimal.max(0, capacity.minus(occupied.get(workingDay) ?? 0)), take = Decimal.min(free, left);
        occupied.set(workingDay, (occupied.get(workingDay) ?? D(0)).plus(take));
        left = left.minus(take);
        if (left.isZero()) completion = workingDay;
      }
    }
    return { order, lines, needs, minutes, ready, completion, reason: completion ? null : data.schedule.hours.every(value => D(value).isZero()) ? 'Set working hours to estimate completion.' : 'Work exceeds the 10-year planning window. Review the order or working hours.' };
  }
  const committed = confirmed.map(order => build(order, false));
  return [...committed, ...data.orders.filter(order => order.status === 'PENDING').map(order => build(order, true))];
}
export function materialReservations(data: Data): Map<string, Decimal> {
  const reserved = new Map<string, Decimal>();
  for (const plan of plans(data).filter(plan => active(plan.order))) for (const need of plan.needs) reserved.set(need.material.id, (reserved.get(need.material.id) ?? D(0)).plus(need.allocated));
  return reserved;
}

export interface MaterialRequirement {
  material: Material;
  items: { quantity: string; count: number }[];
  required: Decimal;
  balance: Decimal;
}

/** A combined preview of all open orders, sharing ready products and materials once. */
export function materialRequirements(data: Data) {
  type Demand = { material: Material; items: Map<string, number> };
  const totals = new Map<string, Demand>();
  const ready = new Map(data.products.map(product => [product.id, availableProducts(data, product)]));
  const stock = new Map(data.materials.map(material => [material.id, D(material.stock)]));
  const orders = [
    ...data.orders.filter(active).sort((a, b) => Date.parse(a.confirmedAt!) - Date.parse(b.confirmedAt!)),
    ...data.orders.filter(order => order.status === 'PENDING').sort((a, b) => (a.requestedDate ?? '9999').localeCompare(b.requestedDate ?? '9999') || a.createdDate.localeCompare(b.createdDate))
  ];
  function add(needs: Map<string, Demand>, materialId: string, quantity: string, count: number) {
    if (!needs.has(materialId)) needs.set(materialId, { material: find(data.materials, materialId), items: new Map() });
    const demand = needs.get(materialId)!, size = D(quantity).toFixed();
    demand.items.set(size, (demand.items.get(size) ?? 0) + count);
  }
  function summarize(needs: Map<string, Demand>) {
    return [...needs.values()].sort((a, b) => a.material.name.localeCompare(b.material.name)).map(({ material, items }) => {
      const sizes = [...items].sort(([a], [b]) => D(b).cmp(a)).map(([quantity, count]) => ({ quantity, count }));
      return { material, items: sizes, required: sum(sizes.map(item => D(item.quantity).times(item.count))) };
    });
  }
  const perOrder = orders.map(order => {
    const needs = new Map<string, Demand>();
    for (const line of order.lines) {
      let count = remaining(line);
      if (order.status === 'PENDING') {
        const fromStock = Math.min(line.quantity, ready.get(line.productId)!);
        ready.set(line.productId, ready.get(line.productId)! - fromStock);
        count = line.quantity - fromStock;
      }
      if (count === 0) continue;
      for (const ingredient of lineQuote(data, line).recipe) {
        add(needs, ingredient.materialId, ingredient.quantity, count);
        add(totals, ingredient.materialId, ingredient.quantity, count);
      }
    }
    return { order, needs: summarize(needs).map(need => {
      const balance = stock.get(need.material.id)!.minus(need.required);
      stock.set(need.material.id, Decimal.max(0, balance));
      return { ...need, balance };
    }) };
  });
  return { total: summarize(totals).map(need => ({ ...need, balance: D(need.material.stock).minus(need.required) })), perOrder };
}
