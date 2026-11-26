package main

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
)

func (d *Data) activeOrders() []*Order {
	orders := []*Order{}
	for i := range d.Orders {
		if d.Orders[i].active() {
			orders = append(orders, &d.Orders[i])
		}
	}
	sort.SliceStable(orders, func(i, j int) bool {
		a, _ := time.Parse(time.RFC3339Nano, orders[i].ConfirmedAt)
		b, _ := time.Parse(time.RFC3339Nano, orders[j].ConfirmedAt)
		return a.Before(b)
	})
	return orders
}
func (d *Data) requirements(o *Order, counts []int) map[string]number {
	result := map[string]number{}
	for i, l := range o.Lines {
		count := l.remaining()
		if counts != nil {
			count = counts[i]
		}
		for _, r := range d.lineQuote(l).Recipe {
			result[r.MaterialID] = result[r.MaterialID].Add(n(r.Quantity).Mul(whole(count)))
		}
	}
	return result
}

// Allocation protects existing confirmed work; it does not calculate dates or pending estimates.
func (d *Data) allocations() map[string]map[string]number {
	stock := map[string]number{}
	for _, m := range d.Materials {
		stock[m.ID] = n(m.Stock)
	}
	result := map[string]map[string]number{}
	for _, o := range d.activeOrders() {
		allocated := map[string]number{}
		for id, required := range d.requirements(o, nil) {
			take := minimum(stock[id], required)
			allocated[id] = take
			stock[id] = stock[id].Sub(take)
		}
		result[o.ID] = allocated
	}
	return result
}
func (d *Data) reservedMaterials() map[string]number {
	total := map[string]number{}
	for _, allocation := range d.allocations() {
		for id, q := range allocation {
			total[id] = total[id].Add(q)
		}
	}
	return total
}
func (d *Data) confirm(id string) error {
	o := d.order(id)
	if o == nil || o.Status != "PENDING" {
		return errors.New("This order is already confirmed or closed.")
	}
	free := d.freeProducts()
	for i := range o.Lines {
		l := &o.Lines[i]
		l.Quote = d.quote(d.product(l.ProductID))
		l.FromStock = min(l.Quantity, free[l.ProductID])
	}
	o.Status = "CONFIRMED"
	o.ConfirmedAt = time.Now().Format(time.RFC3339Nano)
	o.Currency = d.Settings.Currency
	return nil
}
func (d *Data) cancel(id string) error {
	o := d.order(id)
	if o == nil || !o.open() {
		return errors.New("This order is already closed.")
	}
	o.Status = "CANCELLED"
	return nil
}
func (d *Data) movement(item string, q number, unit, note string) {
	d.Movements = append(d.Movements, Movement{newID(), time.Now().Format(time.RFC3339Nano), item, q.String(), unit, note})
}
func (d *Data) produce(id string, count int, orderID string) error {
	p := d.product(id)
	if p == nil {
		return errors.New("This product no longer exists.")
	}
	if count < 1 || count > 1000000 || p.Stock+count > 1000000000 {
		return errors.New("Enter a valid positive number of products.")
	}
	q := d.quote(p)
	available := map[string]number{}
	var line *Line
	var order *Order
	if orderID != "" {
		order = d.order(orderID)
		if order == nil || !order.active() {
			return errors.New("Confirm the order before recording production.")
		}
		for i := range order.Lines {
			if order.Lines[i].ProductID == id {
				line = &order.Lines[i]
			}
		}
		if line == nil || count > line.remaining() {
			return errors.New("This is more than the order still needs.")
		}
		q = d.lineQuote(*line)
		available = d.allocations()[orderID]
	} else {
		reserved := d.reservedMaterials()
		for _, m := range d.Materials {
			available[m.ID] = n(m.Stock).Sub(reserved[m.ID])
		}
	}
	for _, r := range q.Recipe {
		if n(r.Quantity).Mul(whole(count)).GreaterThan(available[r.MaterialID]) {
			return fmt.Errorf("Not enough available %s. Receive missing materials first.", d.material(r.MaterialID).Name)
		}
	}
	note := "Made " + q.Name + " for stock"
	if order != nil {
		note = "Made " + q.Name + " for " + order.Customer
	}
	for _, r := range q.Recipe {
		m := d.material(r.MaterialID)
		used := n(r.Quantity).Mul(whole(count))
		m.Stock = n(m.Stock).Sub(used).String()
		d.movement(m.Name, used.Neg(), m.Unit, note)
	}
	p.Stock += count
	d.movement(q.Name, whole(count), "products", note)
	if line != nil {
		line.Produced += count
		order.Status = "IN_PROGRESS"
	}
	return nil
}
func (d *Data) complete(id string) error {
	o := d.order(id)
	if o == nil || !o.active() {
		return errors.New("This order is closed or has not been confirmed.")
	}
	free := d.freeProducts()
	// Later finished stock is used only for the order the owner is handing over.
	for _, l := range o.Lines {
		if l.remaining() > free[l.ProductID] {
			return errors.New("Record production for the remaining products first.")
		}
	}
	for i := range o.Lines {
		l := &o.Lines[i]
		l.FromStock += l.remaining()
		d.product(l.ProductID).Stock -= l.Quantity
		d.movement(d.lineQuote(*l).Name, whole(-l.Quantity), "products", "Completed order for "+o.Customer)
	}
	o.Status = "COMPLETED"
	return nil
}
func (d *Data) changeStock(kind, id, value string, receipt bool, reason string) error {
	if !validText(strings.TrimSpace(reason), true) {
		return errors.New("Enter a reason for the stock change.")
	}
	s, err := parseAmount(value, "Quantity", receipt)
	if err != nil {
		return err
	}
	quantity := n(s)
	if kind == "material" {
		m := d.material(id)
		if m == nil {
			return errors.New("This material no longer exists.")
		}
		target := quantity
		if receipt {
			target = target.Add(n(m.Stock))
		}
		if target.LessThan(d.reservedMaterials()[id]) {
			return errors.New("This would remove materials reserved for orders. Cancel the affected order first.")
		}
		if _, err := parseAmount(target.String(), "Stock", false); err != nil {
			return err
		}
		d.movement(m.Name, target.Sub(n(m.Stock)), m.Unit, reason)
		m.Stock = target.String()
		return nil
	}
	if kind != "product" {
		return errors.New("Choose a valid stock action.")
	}
	p := d.product(id)
	if p == nil {
		return errors.New("This product no longer exists.")
	}
	if !quantity.Equal(quantity.Truncate(0)) {
		return errors.New("Enter a whole number of finished products.")
	}
	target := quantity
	if receipt {
		target = target.Add(whole(p.Stock))
	}
	if target.GreaterThan(n("1000000000")) || target.LessThan(whole(d.productReservations()[id])) {
		return errors.New("This stock count is too large or would remove reserved products.")
	}
	d.movement(p.Name, target.Sub(whole(p.Stock)), "products", reason)
	p.Stock = int(target.IntPart())
	return nil
}
func (d *Data) delete(section, id string) error {
	switch section {
	case "suppliers":
		if d.supplier(id) == nil {
			return errors.New("This supplier no longer exists.")
		}
		for _, m := range d.Materials {
			if m.SupplierID == id {
				return errors.New("This supplier is used by a material.")
			}
		}
		d.Suppliers = slices.DeleteFunc(d.Suppliers, func(s Supplier) bool { return s.ID == id })
	case "materials":
		m := d.material(id)
		if m == nil {
			return errors.New("This material no longer exists.")
		}
		if !n(m.Stock).IsZero() {
			return errors.New("Set stock to zero before deleting this material.")
		}
		for _, p := range d.Products {
			for _, r := range p.Recipe {
				if r.MaterialID == id {
					return errors.New("This material is used by a product.")
				}
			}
		}
		for _, o := range d.Orders {
			for _, l := range o.Lines {
				if l.Quote != nil {
					for _, r := range l.Quote.Recipe {
						if r.MaterialID == id {
							return errors.New("This material is used by a saved order.")
						}
					}
				}
			}
		}
		d.Materials = slices.DeleteFunc(d.Materials, func(m Material) bool { return m.ID == id })
	case "products":
		p := d.product(id)
		if p == nil {
			return errors.New("This product no longer exists.")
		}
		if p.Stock != 0 {
			return errors.New("Set stock to zero before deleting this product.")
		}
		for _, o := range d.Orders {
			for _, l := range o.Lines {
				if l.ProductID == id {
					return errors.New("This product is used by an order.")
				}
			}
		}
		d.Products = slices.DeleteFunc(d.Products, func(p Product) bool { return p.ID == id })
	case "orders":
		if d.order(id) == nil {
			return errors.New("This order no longer exists.")
		}
		d.Orders = slices.DeleteFunc(d.Orders, func(o Order) bool { return o.ID == id })
	default:
		return errors.New("Choose an existing record.")
	}
	return nil
}

type ReceiptRow struct {
	MaterialID  string   `json:"materialId"`
	Quantity    string   `json:"quantity"`
	Code        *Barcode `json:"code"`
	NewMaterial *struct {
		Name         string `json:"name"`
		Unit         string `json:"unit"`
		SupplierID   string `json:"supplierId"`
		PackQuantity string `json:"packQuantity"`
		PackPrice    string `json:"packPrice"`
	} `json:"newMaterial"`
}

func (d *Data) received(id string) bool {
	for _, m := range d.Movements {
		if m.ID == id+"_0" {
			return true
		}
	}
	return false
}
func (d *Data) receive(id string, rows []ReceiptRow) error {
	if !regexpReceipt.MatchString(id) {
		return errors.New("Invalid delivery ID. Reload this page.")
	}
	if d.received(id) {
		return nil
	}
	if len(rows) < 1 || len(rows) > 500 {
		return errors.New("Add between 1 and 500 received items.")
	}
	created := map[string]string{}
	for i, row := range rows {
		materialID := row.MaterialID
		if mapped, ok := created[materialID]; ok {
			materialID = mapped
		} else if row.NewMaterial != nil {
			if d.material(materialID) != nil {
				return errors.New("Choose an existing material instead.")
			}
			v := row.NewMaterial
			materialID = newID()
			d.Materials = append(d.Materials, Material{ID: materialID, Name: strings.TrimSpace(v.Name), Unit: strings.TrimSpace(v.Unit), SupplierID: v.SupplierID, PackQuantity: v.PackQuantity, PackPrice: v.PackPrice, Stock: "0", Barcodes: []Barcode{}})
			created[row.MaterialID] = materialID
		}
		m := d.material(materialID)
		if m == nil {
			return errors.New("Choose an existing material.")
		}
		if row.Code != nil {
			if err := validateBarcode(*row.Code); err != nil {
				return err
			}
			key := barcodeKey(*row.Code)
			found := false
			for _, other := range d.Materials {
				for _, b := range other.Barcodes {
					if barcodeKey(b) == key {
						if other.ID != m.ID {
							return fmt.Errorf("Barcode %s already belongs to %s.", row.Code.Value, other.Name)
						}
						found = true
					}
				}
			}
			if !found {
				code := *row.Code
				if code.Format != "QR_CODE" {
					code.Value = strings.TrimSpace(code.Value)
				}
				m.Barcodes = append(m.Barcodes, code)
			}
		}
		if err := d.changeStock("material", materialID, row.Quantity, true, "Received materials"); err != nil {
			return err
		}
		d.Movements[len(d.Movements)-1].ID = fmt.Sprintf("%s_%d", id, i)
	}
	return nil
}
