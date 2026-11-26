package workshop

import (
	"bytes"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Page struct {
	Prerequisite                                string
	Data                                        *Data
	Screen, Title, Path, Day, ID, Error, Notice string
	Revision                                    string
	Form                                        url.Values
	Bootstrap                                   map[string]any
	Body                                        template.HTML
	Suppliers                                   []Supplier
	Materials                                   []Material
	Products                                    []Product
	Orders                                      []*Order
	OpenOrders                                  []*Order
	Plans                                       map[string]Plan
	Total                                       []Need
	Individual                                  map[string][]Need
	Free                                        map[string]int
	Reserved                                    map[string]number
	Order                                       *Order
	Plan                                        *Plan
	Kind, Mode, OrderID, ItemName, Unit, Back   string
	Recipe                                      *Quote
	Movements                                   []Movement
	LowMaterials                                []Material
	LowProducts                                 []Product
	Pending, Blocked, LateCount, ReadyCount     int
	Committed                                   number
	SettingsDraft                               bool
}

func money(v number, currency string) string { return currency + " " + v.StringFixed(2) }
func prettyDate(day string) string {
	if day == "" {
		return "Not set"
	}
	if len(day) > 10 {
		day = day[:10]
	}
	t, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return day
	}
	return t.Format("2 Jan 2006")
}
func duration(v number) string {
	minutes := v.Ceil().IntPart()
	if minutes >= 60 {
		return fmt.Sprintf("%dh %dm", minutes/60, minutes%60)
	}
	return fmt.Sprintf("%dm", minutes)
}
func (p Plan) purchaseTotal() number {
	total := whole(0)
	for _, n := range p.Needs {
		total = total.Add(n.PurchaseCost)
	}
	return total
}
func (p Plan) missing() int {
	count := 0
	for _, n := range p.Needs {
		if n.Shortage.IsPositive() {
			count++
		}
	}
	return count
}
func (p Plan) late() bool {
	return p.Order.RequestedDate != "" && p.Completion != "" && p.Completion > p.Order.RequestedDate
}
func (p Plan) ReadyToHandOver() bool { return p.Order.active() && p.ToMake == 0 }
func (p Plan) HasMissing() bool      { return p.missing() > 0 }
func (p Plan) PurchaseTotal() number { return p.purchaseTotal() }
func (p Plan) Late() bool            { return p.late() }
func (p Plan) Next() string {
	if p.Order.Status == "PENDING" {
		return "Review & confirm"
	}
	if p.HasMissing() {
		return "Order materials"
	}
	if p.ToMake == 0 {
		return "Hand over"
	}
	return "Record production"
}
func (p *Page) Value(key, fallback string) string {
	if p.Form != nil && p.Form.Has(key) {
		return p.Form.Get(key)
	}
	return fallback
}
func (p *Page) MaterialFree(m Material) number { return n(m.Stock).Sub(p.Reserved[m.ID]) }
func (p *Page) LowMaterial(m Material) bool {
	return m.Threshold != nil && p.MaterialFree(m).LessThan(n(*m.Threshold))
}
func (p *Page) LowProduct(v Product) bool    { return v.Threshold != nil && p.Free[v.ID] < *v.Threshold }
func (p *Page) Supplier(id string) *Supplier { return p.Data.supplier(id) }
func (p *Page) Material(id string) *Material { return p.Data.material(id) }
func (p *Page) Product(id string) *Product   { return p.Data.product(id) }
func (p *Page) Quote(v Product) *Quote       { return p.Data.quote(&v) }
func (p *Page) LineQuote(l Line) *Quote      { return p.Data.lineQuote(l) }
func (p *Page) Selling(o *Order) number {
	total := whole(0)
	for _, l := range o.Lines {
		total = total.Add(n(l.Price).Mul(whole(l.Quantity)))
	}
	return total
}
func (p *Page) Minimum(o *Order) number {
	total := whole(0)
	for _, l := range o.Lines {
		total = total.Add(p.Data.lineQuote(l).minimumPrice().Mul(whole(l.Quantity)))
	}
	return total
}
func (p *Page) OrderMaterials(o *Order) number {
	total := whole(0)
	for _, l := range o.Lines {
		total = total.Add(p.Data.lineQuote(l).materialCost().Mul(whole(l.Quantity)))
	}
	return total
}
func (p *Page) OrderLabour(o *Order) number {
	total := whole(0)
	for _, l := range o.Lines {
		total = total.Add(p.Data.lineQuote(l).labourCost().Mul(whole(l.Quantity)))
	}
	return total
}
func (p *Page) OrderCurrency(o *Order) string {
	if o.Currency != "" {
		return o.Currency
	}
	return p.Data.Settings.Currency
}
func (p *Page) OrderURL(o *Order) string {
	plan, ok := p.Plans[o.ID]
	base := "/orders/" + o.ID
	if !ok || !o.active() || plan.ToMake == 0 {
		return base
	}
	if plan.HasMissing() {
		return base + "#materials"
	}
	var left []Line
	for _, l := range plan.Lines {
		if l.remaining() > 0 {
			left = append(left, l)
		}
	}
	if len(left) == 1 {
		return stockURL("product", left[0].ProductID, "produce", o.ID)
	}
	return base + "#products"
}
func (p *Page) Remaining(l Line) int {
	if p.Plan != nil {
		for _, planned := range p.Plan.Lines {
			if planned.ProductID == l.ProductID {
				return planned.remaining()
			}
		}
	}
	return l.remaining()
}
func (p *Page) FromStock(l Line) int {
	if p.Plan != nil {
		for _, planned := range p.Plan.Lines {
			if planned.ProductID == l.ProductID {
				return planned.FromStock
			}
		}
	}
	return l.FromStock
}
func (p *Page) Quantity() string {
	fallback := ""
	if p.Mode == "produce" {
		fallback = "1"
		if p.Order != nil {
			for _, l := range p.Order.Lines {
				if l.ProductID == p.ID {
					fallback = strconv.Itoa(p.Remaining(l))
				}
			}
		}
	}
	return p.Value("quantity", fallback)
}
func (q *Quote) MaterialCost() number { return q.materialCost() }
func (q *Quote) LabourCost() number   { return q.labourCost() }
func (q *Quote) MinimumPrice() number { return q.minimumPrice() }
func (o Order) Open() bool            { return o.open() }
func (o Order) Active() bool          { return o.active() }
func stockURL(kind, id, mode, order string) string {
	q := url.Values{"kind": {kind}, "id": {id}, "mode": {mode}}
	if order != "" {
		q.Set("orderId", order)
	}
	return "/inventory/edit?" + q.Encode()
}
func isLength(s string) bool {
	return slices.Contains([]string{"m", "cm", "mm"}, strings.ToLower(strings.TrimSpace(s)))
}

type Input struct {
	Label, Name, Value, Type, Step, Hint string
	Required                             bool
}

func textInput(label, name, value string, required bool, hint string) Input {
	return Input{label, name, value, "text", "", hint, required}
}
func numericInput(label, name, value string, required, integer bool, hint string) Input {
	step := "0.000001"
	if integer {
		step = "1"
	}
	return Input{label, name, value, "number", step, hint, required}
}
func dateInput(label, name, value, hint string) Input {
	return Input{label, name, value, "date", "", hint, false}
}

var safeReturn = regexp.MustCompile(`^/(?:orders|suppliers|materials|products|inventory|schedule)?(?:/[\w-]+)?$`)
var views = template.Must(template.New("ui").Funcs(template.FuncMap{
	"compactDate": func(day, current string) string {
		date := prettyDate(day)
		if len(day) >= 4 && day[:4] == current[:4] {
			return strings.TrimSuffix(date, " "+day[:4])
		}
		return date
	},
	"cutLabel": func(c Cut, unit string) string {
		q := c.Quantity
		if strings.EqualFold(strings.TrimSpace(unit), "m") && n(q).LessThan(whole(1)) {
			q = n(q).Mul(whole(100)).String()
			unit = "cm"
		}
		return fmt.Sprintf("%d × %s %s", c.Count, q, unit)
	},
	"stockLabel": func(s string) string {
		if s == "receive" {
			return "Quantity received"
		}
		return "Actual quantity on the shelf"
	},
	"reasonLabel": func(s string) string {
		if s == "receive" {
			return "Received stock"
		}
		return "Stock count correction"
	},
	"supplierCount": func(d *Data, id string) int {
		count := 0
		for _, m := range d.Materials {
			if m.SupplierID == id {
				count++
			}
		}
		return count
	},
	"lowCount":     func(p *Page) int { return len(p.LowMaterials) + len(p.LowProducts) },
	"subtract":     func(a, b int) int { return a - b },
	"textInput":    textInput,
	"numericInput": numericInput,
	"dateInput":    dateInput,
	"money":        money,
	"date":         prettyDate,
	"duration":     duration,
	"number":       n,
	"intNumber":    whole,
	"stockURL":     stockURL,
	"icon":         icon,
	"status":       func(s string) string { return statuses[s] },
	"lower":        strings.ToLower,
	"isLength":     isLength,
	"formats":      func() []string { return barcodeFormats },
	"formatLabel":  func(s string) string { return strings.ReplaceAll(s, "_", "-") },
	"ptrString":    ptrString,
	"ptrInt":       ptrInt,
	"multiply":     func(a string, b int) number { return n(a).Mul(whole(b)) },
	"unitCost":     func(m Material) string { return divide(n(m.PackPrice), n(m.PackQuantity)).Round(4).String() },
	"positiveBalance": func(v number) string {
		if !v.IsNegative() {
			return "+" + v.String()
		}
		return v.String()
	},
	"nav": func() [][3]string {
		return [][3]string{{"/", "Overview", "overview"}, {"/orders", "Orders", "orders"}, {"/materials", "Materials", "materials"}, {"/suppliers", "Suppliers", "suppliers"}, {"/products", "Products", "products"}, {"/inventory", "Inventory", "inventory"}, {"/schedule", "Work schedule", "schedule"}}
	},
	"weekdays": func() []string {
		return []string{"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}
	},
}).ParseFS(content, "templates/*.html"))

func (a *App) page(w http.ResponseWriter, r *http.Request, screen, id string, form url.Values, problem error) {
	d, rev, dataErr := a.store.snapshot()
	p := &Page{Data: d, Screen: screen, ID: id, Day: today(), Revision: rev, Form: form, Path: r.URL.Path, Bootstrap: map[string]any{"revision": rev, "openSettings": false}, Free: d.freeProducts(), Reserved: d.reservedMaterials()}
	statusCode := 200
	if problem != nil {
		p.Error = problem.Error()
		statusCode = errorStatus(problem)
	}
	if dataErr != nil {
		p.Screen = "recovery"
		p.Error = dataErr.Error()
		statusCode = 422
	}
	if screen == "overview" {
		p.Path = "/"
		if r.URL.Query().Get("restored") == "1" {
			p.Notice = "Backup restored. All records and settings are ready."
		}
		if form != nil && r.URL.Path == "/settings" {
			p.SettingsDraft = true
			p.Bootstrap["openSettings"] = true
		}
	}
	p.Suppliers = append([]Supplier{}, d.Suppliers...)
	sort.Slice(p.Suppliers, func(i, j int) bool {
		return strings.ToLower(p.Suppliers[i].Name) < strings.ToLower(p.Suppliers[j].Name)
	})
	p.Materials = append([]Material{}, d.Materials...)
	sort.SliceStable(p.Materials, func(i, j int) bool {
		a, b := p.Materials[i], p.Materials[j]
		if p.LowMaterial(a) != p.LowMaterial(b) {
			return p.LowMaterial(a)
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	p.Products = append([]Product{}, d.Products...)
	sort.Slice(p.Products, func(i, j int) bool { return strings.ToLower(p.Products[i].Name) < strings.ToLower(p.Products[j].Name) })
	if p.Screen == "overview" || p.Screen == "orders" || p.Screen == "order" || p.Screen == "stock" {
		p.Plans = d.plans(p.Day)
	}
	for i := range d.Orders {
		o := &d.Orders[i]
		p.Orders = append(p.Orders, o)
		if o.open() {
			p.OpenOrders = append(p.OpenOrders, o)
		}
		if o.Status == "PENDING" {
			p.Pending++
		}
		plan, ok := p.Plans[o.ID]
		if ok && plan.late() {
			p.LateCount++
		}
		if o.active() {
			p.Committed = p.Committed.Add(plan.Minutes)
			if plan.missing() > 0 {
				p.Blocked++
			}
			if ok && plan.ToMake == 0 {
				p.ReadyCount++
			}
		}
	}
	sort.SliceStable(p.Orders, func(i, j int) bool {
		a, b := p.Orders[i], p.Orders[j]
		if a.open() != b.open() {
			return a.open()
		}
		ad, bd := a.RequestedDate, b.RequestedDate
		if ad == "" {
			ad = "9999"
		}
		if bd == "" {
			bd = "9999"
		}
		if ad != bd {
			return ad < bd
		}
		return a.CreatedDate > b.CreatedDate
	})
	sort.SliceStable(p.OpenOrders, func(i, j int) bool {
		a, b := p.OpenOrders[i].RequestedDate, p.OpenOrders[j].RequestedDate
		if a == "" {
			a = "9999"
		}
		if b == "" {
			b = "9999"
		}
		return a < b
	})
	for _, m := range p.Materials {
		if p.LowMaterial(m) {
			p.LowMaterials = append(p.LowMaterials, m)
		}
	}
	for _, v := range p.Products {
		if p.LowProduct(v) {
			p.LowProducts = append(p.LowProducts, v)
		}
	}
	switch p.Screen {
	case "overview":
		p.Title = "Your workshop"
		p.Total, p.Individual = d.summaries()
	case "suppliers", "materials", "products", "orders", "inventory":
		p.Title = strings.ToUpper(screen[:1]) + screen[1:]
		p.Path = "/" + screen
		if screen == "inventory" {
			if r.URL.Query().Get("received") == "1" {
				p.Notice = "Materials received. Inventory and barcodes updated."
			}
			for i := len(d.Movements) - 1; i >= max(0, len(d.Movements)-30); i-- {
				p.Movements = append(p.Movements, d.Movements[i])
			}
		}
	case "order":
		p.Order = d.order(id)
		p.Path = "/orders/" + id
		if p.Order == nil {
			p.Screen = "error"
			p.Error = "This order no longer exists. Refresh the page."
			statusCode = 422
		} else {
			p.Title = p.Order.Customer
			if plan, ok := p.Plans[id]; ok {
				p.Plan = &plan
			}
		}
	case "suppliers-edit", "materials-edit", "products-edit", "orders-edit":
		section := strings.TrimSuffix(screen, "-edit")
		p.Path = "/" + section
		p.Title = "Add record"
		if id != "" {
			p.Title = "Edit record"
		}
		if section == "materials" && len(d.Suppliers) == 0 {
			p.Prerequisite = "suppliers"
		}
		if section == "products" && len(d.Materials) == 0 {
			p.Prerequisite = "materials"
		}
		if section == "orders" && len(d.Products) == 0 {
			p.Prerequisite = "products"
		}
		if p.Prerequisite != "" {
			p.Screen = "setup"
			p.Title = "Set up your workshop"
			statusCode = 422
		} else if err := p.prepareEditor(section); err != nil {
			p.Screen = "error"
			p.Error = err.Error()
			statusCode = 422
		}
	case "receiving":
		p.Title = "Received materials"
		p.Path = "/inventory"
		p.Bootstrap["receivingMaterials"] = d.Materials
		p.Bootstrap["suppliers"] = d.Suppliers
	case "schedule":
		p.Title = "Work schedule"
		p.Path = "/schedule"
		days := d.Schedule.DaysOff
		if form != nil {
			days = append([]string{}, form["daysOff"]...)
		}
		p.Bootstrap["daysOff"] = days
		if r.URL.Query().Get("saved") == "1" {
			p.Notice = "Work schedule saved."
		}
	case "stock":
		p.Path = "/inventory"
		values := r.URL.Query()
		if form != nil {
			values = form
		}
		p.Kind, p.Mode, p.OrderID = values.Get("kind"), values.Get("mode"), values.Get("orderId")
		p.Back = "/inventory"
		p.Title = map[string]string{"receive": "Receive stock", "count": "Correct stock count", "produce": "Record production"}[p.Mode]
		valid := slices.Contains([]string{"material", "product"}, p.Kind) && p.Title != "" && !(p.Kind == "material" && p.Mode == "produce")
		if p.Kind == "material" {
			m := d.material(id)
			if m == nil {
				valid = false
			} else {
				p.ItemName, p.Unit = m.Name, m.Unit
			}
		} else {
			v := d.product(id)
			if v == nil {
				valid = false
			} else {
				p.ItemName, p.Unit = v.Name, "products"
				p.Recipe = d.quote(v)
			}
		}
		if p.OrderID != "" {
			p.Order = d.order(p.OrderID)
			if p.Order == nil {
				valid = false
			} else {
				p.Back = "/orders/" + p.OrderID
				if plan, ok := p.Plans[p.OrderID]; ok {
					p.Plan = &plan
				}
				for _, l := range p.Order.Lines {
					if l.ProductID == id {
						p.Recipe = d.lineQuote(l)
					}
				}
			}
		}
		if !valid {
			p.Screen = "error"
			p.Error = "Choose a valid stock action."
			statusCode = 422
		}
	case "recovery":
		p.Title = "Recover your data"
		p.Path = "/"
	case "not-found":
		p.Title = "Page not found"
		statusCode = 404
	default:
		p.Title = "Review this action"
	}
	var body bytes.Buffer
	if err := views.ExecuteTemplate(&body, p.Screen, p); err != nil {
		http.Error(w, "Could not render this page: "+err.Error(), 500)
		return
	}
	p.Body = template.HTML(body.String())
	var page bytes.Buffer
	if err := views.ExecuteTemplate(&page, "layout", p); err != nil {
		http.Error(w, "Could not render this page: "+err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(statusCode)
	_, _ = w.Write(page.Bytes())
}
func (p *Page) prepareEditor(section string) error {
	d := p.Data
	id := p.ID
	if section == "materials" && len(d.Suppliers) == 0 {
		return fmt.Errorf("Add suppliers first. Then you can continue with this form.")
	}
	if section == "products" && len(d.Materials) == 0 {
		return fmt.Errorf("Add materials first. Then you can continue with this form.")
	}
	if section == "orders" && len(d.Products) == 0 {
		return fmt.Errorf("Add products first. Then you can continue with this form.")
	}
	if p.Form == nil {
		p.Form = url.Values{}
	}
	switch section {
	case "suppliers":
		if id != "" {
			s := d.supplier(id)
			if s == nil {
				return fmt.Errorf("This record no longer exists.")
			}
			setDefaults(p.Form, map[string]string{"name": s.Name, "contact": s.Contact, "leadDays": strconv.Itoa(s.LeadDays)})
		}
		setDefaults(p.Form, map[string]string{"leadDays": "5"})
	case "materials":
		codes := []Barcode{}
		if id != "" {
			m := d.material(id)
			if m == nil {
				return fmt.Errorf("This record no longer exists.")
			}
			setDefaults(p.Form, map[string]string{"name": m.Name, "unit": m.Unit, "supplierId": m.SupplierID, "packQuantity": m.PackQuantity, "packPrice": m.PackPrice, "threshold": ptrString(m.Threshold)})
			codes = m.Barcodes
		}
		setDefaults(p.Form, map[string]string{"unit": "pieces", "supplierId": d.Suppliers[0].ID, "packQuantity": "1"})
		if p.Form.Has("barcodesEdited") {
			codes = []Barcode{}
			for i, v := range p.Form["barcodeValue"] {
				format := "EAN_13"
				if i < len(p.Form["barcodeFormat"]) {
					format = p.Form["barcodeFormat"][i]
				}
				codes = append(codes, Barcode{format, v})
			}
		}
		p.Bootstrap["barcodes"] = codes
	case "products":
		v := d.product(id)
		if id != "" && v == nil {
			return fmt.Errorf("This record no longer exists.")
		}
		if v != nil {
			setDefaults(p.Form, map[string]string{"name": v.Name, "minutes": v.Minutes, "threshold": ptrInt(v.Threshold)})
			if !p.Form.Has("recipeMaterial") {
				for _, r := range v.Recipe {
					p.Form.Add("recipeMaterial", r.MaterialID)
					p.Form.Add("recipeQuantity", r.Quantity)
				}
			}
		}
		setDefaults(p.Form, map[string]string{"minutes": "5"})
		if len(p.Form["recipeMaterial"]) == 0 {
			p.Form.Set("recipeMaterial", d.Materials[0].ID)
			p.Form.Set("recipeQuantity", "1")
		}
		rows := []map[string]string{}
		for i, id := range p.Form["recipeMaterial"] {
			q := ""
			if i < len(p.Form["recipeQuantity"]) {
				q = p.Form["recipeQuantity"][i]
			}
			unit := "units"
			if m := d.material(id); m != nil {
				unit = m.Unit
			}
			rows = append(rows, map[string]string{"key": newID(), "materialId": id, "quantity": q, "unit": unit})
		}
		p.Bootstrap["materials"] = d.Materials
		p.Bootstrap["rows"] = rows
		p.Bootstrap["initialPreview"] = nil
	case "orders":
		o := d.order(id)
		if id != "" && (o == nil || o.Status != "PENDING") {
			return fmt.Errorf("Confirmed orders cannot be edited, or this order no longer exists.")
		}
		if o != nil {
			setDefaults(p.Form, map[string]string{"customer": o.Customer, "contact": o.Contact, "requestedDate": o.RequestedDate})
			if !p.Form.Has("lineProduct") {
				for _, l := range o.Lines {
					p.Form.Add("lineProduct", l.ProductID)
					p.Form.Add("lineQuantity", strconv.Itoa(l.Quantity))
					p.Form.Add("linePrice", l.Price)
				}
			}
		}
		if len(p.Form["lineProduct"]) == 0 {
			v := d.Products[0]
			p.Form.Set("lineProduct", v.ID)
			p.Form.Set("lineQuantity", "1")
			p.Form.Set("linePrice", d.quote(&v).minimumPrice().StringFixed(2))
		}
		rows := []map[string]string{}
		for i, id := range p.Form["lineProduct"] {
			q, price := "", ""
			if i < len(p.Form["lineQuantity"]) {
				q = p.Form["lineQuantity"][i]
			}
			if i < len(p.Form["linePrice"]) {
				price = p.Form["linePrice"][i]
			}
			rows = append(rows, map[string]string{"key": newID(), "productId": id, "quantity": q, "price": price})
		}
		choices := []map[string]any{}
		for _, v := range d.Products {
			choices = append(choices, map[string]any{"id": v.ID, "name": v.Name, "minimum": d.quote(&v).minimumPrice().StringFixed(2), "available": p.Free[v.ID]})
		}
		p.Bootstrap["rows"] = rows
		p.Bootstrap["products"] = choices
	}
	return nil
}
func setDefaults(f url.Values, values map[string]string) {
	for k, v := range values {
		if !f.Has(k) {
			f.Set(k, v)
		}
	}
}
func ptrString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
func ptrInt(s *int) string {
	if s == nil {
		return ""
	}
	return strconv.Itoa(*s)
}

func (p *Page) TableOrders() []*Order {
	if p.Screen == "overview" {
		return p.OpenOrders
	}
	return p.Orders
}
func (p Plan) MissingCount() int { return p.missing() }

func (p *Page) TotalProduction() number {
	total := whole(0)
	if p.Plan != nil {
		for _, l := range p.Plan.Lines {
			total = total.Add(n(p.Data.lineQuote(l).Minutes).Mul(whole(l.Quantity - l.FromStock)))
		}
	}
	return total
}

func (p *Page) Hour(i int) string {
	if p.Form != nil {
		values := p.Form["hours"]
		if i < len(values) {
			return values[i]
		}
		return ""
	}
	return p.Data.Schedule.Hours[i]
}
