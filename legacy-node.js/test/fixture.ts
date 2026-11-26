import { emptyData, type Data, type Order } from '../src/model.ts';
export const monday = '2026-11-16';
export function fixture(finished = 0): Data {
  const data = emptyData();
  return { ...data, settings: { ...data.settings, hourlyRate: '18' },
    suppliers: [{ id: 'supplier', name: 'Metal shop', contact: 'supplier@example.test', leadDays: 5 }],
    materials: [
      { barcodes: [], id: 'fasteners', name: 'Fasteners', unit: 'pieces', packQuantity: '100', packPrice: '10', supplierId: 'supplier', stock: '100', threshold: '100' },
      { barcodes: [], id: 'sheet', name: 'Sheet material', unit: 'm', packQuantity: '30', packPrice: '40', supplierId: 'supplier', stock: '50', threshold: null }
    ],
    products: [{ id: 'tray', name: 'Small storage tray', minutes: '5', recipe: [{ materialId: 'fasteners', quantity: '4' }, { materialId: 'sheet', quantity: '0.3' }], stock: finished, threshold: 20 }]
  };
}
export function addOrder(data: Data, id = 'order', quantity = 100): Data {
  const order: Order = { id, customer: `Customer ${id}`, contact: '', requestedDate: '2026-11-30', createdDate: monday, status: 'PENDING', confirmedAt: null, currency: null,
    lines: [{ productId: 'tray', quantity, price: '5', quote: null, fromStock: 0, produced: 0 }] };
  data.orders.push(order); return data;
}
