package workshop

import (
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var digitsOnly = regexp.MustCompile(`^\d+$`)

func formInt(s, label string, low, high int) (int, error) {
	v, err := strconv.Atoi(s)
	if err != nil || !digitsOnly.MatchString(s) || v < low || v > high {
		return 0, errors.New(label + " must be a whole number from " + strconv.Itoa(low) + " to " + strconv.Itoa(high) + ".")
	}
	return v, nil
}
func field(f url.Values, key string) string { return strings.TrimSpace(f.Get(key)) }
func amountField(f url.Values, key, label string, positive bool) (string, error) {
	return parseAmount(f.Get(key), label, positive)
}
func productForm(d *Data, f url.Values, id string) (Product, error) {
	p := Product{ID: id, Name: field(f, "name"), Recipe: []Ingredient{}}
	if old := d.product(id); old != nil {
		p.Stock = old.Stock
	}
	var err error
	p.Minutes, err = amountField(f, "minutes", "Production time", false)
	if err != nil {
		return p, err
	}
	if field(f, "threshold") != "" {
		v, e := formInt(field(f, "threshold"), "Warning threshold", 0, 1000000)
		if e != nil {
			return p, e
		}
		p.Threshold = &v
	}
	ids, quantities := f["recipeMaterial"], f["recipeQuantity"]
	if len(ids) == 0 || len(ids) != len(quantities) {
		return p, errors.New("Add each required material once.")
	}
	seen := map[string]bool{}
	for i, id := range ids {
		if d.material(id) == nil || seen[id] {
			return p, errors.New("Add each existing recipe material once.")
		}
		seen[id] = true
		q, e := parseAmount(quantities[i], "Material quantity", true)
		if e != nil {
			return p, e
		}
		p.Recipe = append(p.Recipe, Ingredient{MaterialID: id, Quantity: q})
	}
	return p, nil
}
func orderForm(d *Data, f url.Values, id string, preview bool) (Order, error) {
	o := Order{ID: id, Customer: field(f, "customer"), Contact: field(f, "contact"), RequestedDate: field(f, "requestedDate"), CreatedDate: today(), Status: "PENDING", Lines: []Line{}}
	if old := d.order(id); old != nil {
		if old.Status != "PENDING" {
			return o, errors.New("Confirmed orders cannot be edited.")
		}
		o.CreatedDate = old.CreatedDate
	}
	if preview && o.Customer == "" {
		o.Customer = "Order preview"
	}
	if !validText(o.Customer, true) || !validText(o.Contact, false) || (o.RequestedDate != "" && !validDate(o.RequestedDate)) {
		return o, errors.New("Enter valid customer details and requested date.")
	}
	products, quantities, prices := f["lineProduct"], f["lineQuantity"], f["linePrice"]
	if len(products) == 0 || len(products) != len(quantities) || len(products) != len(prices) {
		return o, errors.New("Add each ordered product once.")
	}
	seen := map[string]bool{}
	for i, id := range products {
		p := d.product(id)
		if p == nil || seen[id] {
			return o, errors.New("Add each existing product once.")
		}
		seen[id] = true
		count, err := formInt(quantities[i], "Order quantity", 1, 1000000)
		if err != nil {
			return o, err
		}
		price := prices[i]
		if preview && strings.TrimSpace(price) == "" {
			price = d.quote(p).minimumPrice().String()
		}
		price, err = parseAmount(price, "Selling price", false)
		if err != nil {
			return o, err
		}
		o.Lines = append(o.Lines, Line{ProductID: id, Quantity: count, Price: price})
	}
	return o, nil
}
func (d *Data) saveEntity(section string, f url.Values) (string, error) {
	id := field(f, "id")
	existing := id != ""
	if !existing {
		id = newID()
	}
	missing := errors.New("This record no longer exists. Refresh the page.")
	switch section {
	case "suppliers":
		lead, err := formInt(field(f, "leadDays"), "Delivery time", 0, 365)
		if err != nil {
			return "", err
		}
		s := Supplier{id, field(f, "name"), field(f, "contact"), lead}
		if existing {
			for i := range d.Suppliers {
				if d.Suppliers[i].ID == id {
					d.Suppliers[i] = s
					return id, nil
				}
			}
			return "", missing
		}
		d.Suppliers = append(d.Suppliers, s)
	case "materials":
		m := Material{ID: id, Name: field(f, "name"), Unit: field(f, "unit"), SupplierID: field(f, "supplierId"), Stock: "0", Barcodes: []Barcode{}}
		if existing {
			old := d.material(id)
			if old == nil {
				return "", missing
			}
			m.Stock = old.Stock
			m.Barcodes = append([]Barcode{}, old.Barcodes...)
		}
		var err error
		m.PackQuantity, err = amountField(f, "packQuantity", "Purchase quantity", true)
		if err != nil {
			return "", err
		}
		m.PackPrice, err = amountField(f, "packPrice", "Purchase price", false)
		if err != nil {
			return "", err
		}
		if field(f, "threshold") != "" {
			v, e := amountField(f, "threshold", "Warning threshold", false)
			if e != nil {
				return "", e
			}
			m.Threshold = &v
		}
		if f.Has("barcodesEdited") || f.Has("barcodeValue") {
			m.Barcodes = []Barcode{}
			codes, formats := f["barcodeValue"], f["barcodeFormat"]
			if len(codes) != len(formats) {
				return "", errors.New("Enter a format for every barcode.")
			}
			for i, value := range codes {
				b := Barcode{formats[i], value}
				if err := validateBarcode(b); err != nil {
					return "", err
				}
				if b.Format != "QR_CODE" {
					b.Value = strings.TrimSpace(b.Value)
				}
				m.Barcodes = append(m.Barcodes, b)
			}
		}
		if existing {
			*d.material(id) = m
		} else {
			d.Materials = append(d.Materials, m)
		}
	case "products":
		if existing && d.product(id) == nil {
			return "", missing
		}
		p, err := productForm(d, f, id)
		if err != nil {
			return "", err
		}
		if existing {
			*d.product(id) = p
		} else {
			d.Products = append(d.Products, p)
		}
	case "orders":
		if existing && d.order(id) == nil {
			return "", missing
		}
		o, err := orderForm(d, f, id, false)
		if err != nil {
			return "", err
		}
		if existing {
			*d.order(id) = o
		} else {
			d.Orders = append(d.Orders, o)
		}
	default:
		return "", errors.New("Choose an existing record type.")
	}
	return id, nil
}
