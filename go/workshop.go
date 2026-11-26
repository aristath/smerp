package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

const maxBytes = 10 * 1024 * 1024
const dataFormat = "smerp-go"

type number = decimal.Decimal

func n(s string) number {
	v, err := decimal.NewFromString(s)
	if err != nil {
		panic(err)
	}
	return v
}
func whole(v int) number        { return decimal.NewFromInt(int64(v)) }
func divide(a, b number) number { return a.DivRound(b, 34) }
func minimum(a, b number) number {
	if a.LessThan(b) {
		return a
	}
	return b
}
func positive(v number) number { return decimal.Max(decimal.Zero, v) }
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func today() string { return time.Now().Format(time.DateOnly) }
func check(ok bool, message string) error {
	if !ok {
		return errors.New(message)
	}
	return nil
}
func validText(s string, required bool) bool {
	return len(s) <= 4000 && (!required || strings.TrimSpace(s) != "")
}
func parseAmount(s, label string, greater bool) (string, error) {
	s = strings.Replace(strings.TrimSpace(s), ",", ".", 1)
	if len(s) > 4000 {
		return "", fmt.Errorf("Enter a valid %s.", strings.ToLower(label))
	}
	v, err := decimal.NewFromString(s)
	if err != nil || v.IsNegative() || v.GreaterThan(n("1000000000")) || !v.Equal(v.Truncate(6)) || (greater && v.IsZero()) {
		return "", fmt.Errorf("%s must be %s, at most 1,000,000,000, with up to 6 decimal places.", label, map[bool]string{true: "greater than zero", false: "zero or greater"}[greater])
	}
	return v.String(), nil
}
func validDate(s string) bool {
	t, err := time.Parse(time.DateOnly, s)
	return err == nil && t.Format(time.DateOnly) == s
}
func nextDay(day string) string {
	t, _ := time.Parse(time.DateOnly, day)
	return t.AddDate(0, 0, 1).Format(time.DateOnly)
}
func weekDay(day string) int {
	t, _ := time.Parse(time.DateOnly, day)
	return (int(t.Weekday()) + 6) % 7
}
func businessDays(day string, count int) string {
	for count > 0 {
		day = nextDay(day)
		if weekDay(day) < 5 {
			count--
		}
	}
	return day
}

// Decimal inputs remain strings in records and JSON; calculation never passes through float64.
type Settings struct {
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle"`
	HourlyRate string `json:"hourlyRate"`
	Currency   string `json:"currency"`
}
type Schedule struct {
	Hours   []string `json:"hours"`
	DaysOff []string `json:"daysOff"`
}
type Supplier struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Contact  string `json:"contact"`
	LeadDays int    `json:"leadDays"`
}
type Barcode struct {
	Format string `json:"format"`
	Value  string `json:"value"`
}
type Material struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Unit         string    `json:"unit"`
	PackQuantity string    `json:"packQuantity"`
	PackPrice    string    `json:"packPrice"`
	SupplierID   string    `json:"supplierId"`
	Stock        string    `json:"stock"`
	Threshold    *string   `json:"threshold"`
	Barcodes     []Barcode `json:"barcodes"`
}
type Ingredient struct {
	MaterialID   string `json:"materialId"`
	Quantity     string `json:"quantity"`
	PackQuantity string `json:"packQuantity,omitempty"`
	PackPrice    string `json:"packPrice,omitempty"`
}
type Product struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Minutes   string       `json:"minutes"`
	Recipe    []Ingredient `json:"recipe"`
	Stock     int          `json:"stock"`
	Threshold *int         `json:"threshold"`
}
type Quote struct {
	Name       string       `json:"name"`
	Minutes    string       `json:"minutes"`
	HourlyRate string       `json:"hourlyRate"`
	Recipe     []Ingredient `json:"recipe"`
}
type Line struct {
	ProductID string `json:"productId"`
	Quantity  int    `json:"quantity"`
	Price     string `json:"price"`
	Quote     *Quote `json:"quote"`
	FromStock int    `json:"fromStock"`
	Produced  int    `json:"produced"`
}
type Order struct {
	ID            string `json:"id"`
	Customer      string `json:"customer"`
	Contact       string `json:"contact"`
	RequestedDate string `json:"requestedDate"`
	CreatedDate   string `json:"createdDate"`
	Status        string `json:"status"`
	ConfirmedAt   string `json:"confirmedAt"`
	Currency      string `json:"currency"`
	Lines         []Line `json:"lines"`
}
type Movement struct {
	ID       string `json:"id"`
	Date     string `json:"date"`
	Item     string `json:"item"`
	Quantity string `json:"quantity"`
	Unit     string `json:"unit"`
	Note     string `json:"note"`
}
type Data struct {
	Format    string     `json:"format"`
	Version   int        `json:"version"`
	Settings  Settings   `json:"settings"`
	Schedule  Schedule   `json:"schedule"`
	Suppliers []Supplier `json:"suppliers"`
	Materials []Material `json:"materials"`
	Products  []Product  `json:"products"`
	Orders    []Order    `json:"orders"`
	Movements []Movement `json:"movements"`
}

var statuses = map[string]string{"PENDING": "Pending", "CONFIRMED": "Confirmed", "IN_PROGRESS": "In progress", "COMPLETED": "Completed", "CANCELLED": "Cancelled"}
var barcodeFormats = []string{"EAN_13", "EAN_8", "UPC_A", "UPC_E", "QR_CODE"}
var regexpReceipt = regexp.MustCompile(`^[0-9a-f-]{36}$`)
var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,120}$`)

func emptyData() *Data {
	return &Data{Format: dataFormat, Version: 1, Settings: Settings{"Workspace", "Production planning", "15", "EUR"}, Schedule: Schedule{[]string{"4", "4", "4", "4", "4", "0", "0"}, []string{}}, Suppliers: []Supplier{}, Materials: []Material{}, Products: []Product{}, Orders: []Order{}, Movements: []Movement{}}
}
func (d *Data) material(id string) *Material {
	for i := range d.Materials {
		if d.Materials[i].ID == id {
			return &d.Materials[i]
		}
	}
	return nil
}
func (d *Data) product(id string) *Product {
	for i := range d.Products {
		if d.Products[i].ID == id {
			return &d.Products[i]
		}
	}
	return nil
}
func (d *Data) supplier(id string) *Supplier {
	for i := range d.Suppliers {
		if d.Suppliers[i].ID == id {
			return &d.Suppliers[i]
		}
	}
	return nil
}
func (d *Data) order(id string) *Order {
	for i := range d.Orders {
		if d.Orders[i].ID == id {
			return &d.Orders[i]
		}
	}
	return nil
}
func (o Order) active() bool  { return o.Status == "CONFIRMED" || o.Status == "IN_PROGRESS" }
func (o Order) open() bool    { return o.active() || o.Status == "PENDING" }
func (l Line) remaining() int { return l.Quantity - l.FromStock - l.Produced }
func (d *Data) quote(p *Product) *Quote {
	q := &Quote{Name: p.Name, Minutes: p.Minutes, HourlyRate: d.Settings.HourlyRate, Recipe: append([]Ingredient(nil), p.Recipe...)}
	for i := range q.Recipe {
		m := d.material(q.Recipe[i].MaterialID)
		q.Recipe[i].PackQuantity = m.PackQuantity
		q.Recipe[i].PackPrice = m.PackPrice
	}
	return q
}
func (d *Data) lineQuote(l Line) *Quote {
	if l.Quote != nil {
		return l.Quote
	}
	return d.quote(d.product(l.ProductID))
}
func (q *Quote) materialCost() number {
	total := decimal.Zero
	for _, r := range q.Recipe {
		total = total.Add(divide(n(r.Quantity).Mul(n(r.PackPrice)), n(r.PackQuantity)))
	}
	return total
}
func (q *Quote) labourCost() number   { return divide(n(q.Minutes).Mul(n(q.HourlyRate)), whole(60)) }
func (q *Quote) minimumPrice() number { return q.materialCost().Add(q.labourCost()).RoundCeil(2) }
func (d *Data) productReservations() map[string]int {
	result := map[string]int{}
	for _, o := range d.Orders {
		if o.active() {
			for _, l := range o.Lines {
				result[l.ProductID] += l.FromStock + l.Produced
			}
		}
	}
	return result
}
func (d *Data) freeProducts() map[string]int {
	reserved := d.productReservations()
	result := map[string]int{}
	for _, p := range d.Products {
		result[p.ID] = p.Stock - reserved[p.ID]
	}
	return result
}

func validateBarcode(b Barcode) error {
	if !slices.Contains(barcodeFormats, b.Format) || len(b.Value) == 0 || len(b.Value) > 4000 {
		return errors.New("Enter a supported barcode (up to 4,000 characters).")
	}
	if b.Format == "QR_CODE" {
		return nil
	}
	digits := strings.TrimSpace(b.Value)
	size := map[string]int{"EAN_13": 13, "EAN_8": 8, "UPC_A": 12, "UPC_E": 8}[b.Format]
	if len(digits) != size || strings.IndexFunc(digits, func(c rune) bool { return c < '0' || c > '9' }) >= 0 || (b.Format == "UPC_E" && digits[0] != '0' && digits[0] != '1') {
		return fmt.Errorf("Enter all %d digits for %s, including the check digit.", size, strings.ReplaceAll(b.Format, "_", "-"))
	}
	if b.Format == "UPC_E" {
		digits = expandUPC(digits)
	}
	total, weight := 0, 3
	for i := len(digits) - 2; i >= 0; i-- {
		total += int(digits[i]-'0') * weight
		weight = 4 - weight
	}
	return check((10-total%10)%10 == int(digits[len(digits)-1]-'0'), "Invalid barcode check digit. Check the printed number.")
}
func expandUPC(s string) string {
	switch s[6] {
	case '0', '1', '2':
		return s[:3] + s[6:7] + "0000" + s[3:6] + s[7:]
	case '3':
		return s[:4] + "00000" + s[4:6] + s[7:]
	case '4':
		return s[:5] + "00000" + s[5:6] + s[7:]
	default:
		return s[:6] + "0000" + s[6:]
	}
}
func barcodeKey(b Barcode) string {
	if b.Format == "QR_CODE" {
		return "qr:" + b.Value
	}
	s := strings.TrimSpace(b.Value)
	if b.Format == "UPC_E" {
		s = expandUPC(s)
	}
	return "gtin:" + strings.Repeat("0", 14-len(s)) + s
}

func (d *Data) validate() error {
	if d.Format != dataFormat || d.Version != 1 {
		return errors.New("This is not a supported Smerp Go backup.")
	}
	if d.Suppliers == nil || d.Materials == nil || d.Products == nil || d.Orders == nil || d.Movements == nil || d.Schedule.DaysOff == nil {
		return errors.New("A backup list is missing or invalid.")
	}
	if !validText(d.Settings.Title, true) || !validText(d.Settings.Subtitle, false) {
		return errors.New("Enter a workshop title and a valid subtitle.")
	}
	if !validCurrency(d.Settings.Currency) {
		return errors.New("Enter a valid currency code, such as EUR.")
	}
	if _, err := parseAmount(d.Settings.HourlyRate, "Hourly rate", false); err != nil {
		return err
	}
	if len(d.Schedule.Hours) != 7 {
		return errors.New("Set working hours for all seven days.")
	}
	for _, s := range d.Schedule.Hours {
		v, err := parseAmount(s, "Working hours", false)
		if err != nil || n(v).GreaterThan(whole(24)) {
			return errors.New("Set 0–24 working hours for each day.")
		}
	}
	for _, s := range d.Schedule.DaysOff {
		if !validDate(s) {
			return errors.New("Choose a valid date.")
		}
	}
	ids, names := map[string]bool{}, map[string]bool{}
	identity := func(kind, id, name string) error {
		key := kind + ":" + id
		if !idPattern.MatchString(id) || ids[key] {
			return errors.New("A record ID is invalid or duplicated.")
		}
		ids[key] = true
		if name != "" {
			key = kind + ":" + strings.ToLower(name)
			if !validText(name, true) || names[key] {
				return errors.New("Each item must have a different, nonempty name.")
			}
			names[key] = true
		}
		return nil
	}
	for _, s := range d.Suppliers {
		if err := identity("supplier", s.ID, s.Name); err != nil {
			return err
		}
		if !validText(s.Name, true) || !validText(s.Contact, false) || s.LeadDays < 0 || s.LeadDays > 365 {
			return errors.New("Enter supplier details and a delivery time from 0 to 365 business days.")
		}
	}
	assigned := map[string]bool{}
	for _, m := range d.Materials {
		if err := identity("material", m.ID, m.Name); err != nil {
			return err
		}
		if !validText(m.Name, true) || !validText(m.Unit, true) || d.supplier(m.SupplierID) == nil || m.Barcodes == nil {
			return errors.New("Enter a material name, unit, supplier, and barcode list.")
		}
		for _, a := range []struct {
			s, label string
			required bool
		}{{m.PackQuantity, "Purchase quantity", true}, {m.PackPrice, "Purchase price", false}, {m.Stock, "Stock", false}} {
			if _, err := parseAmount(a.s, a.label, a.required); err != nil {
				return err
			}
		}
		if m.Threshold != nil {
			if _, err := parseAmount(*m.Threshold, "Warning threshold", false); err != nil {
				return err
			}
		}
		for _, b := range m.Barcodes {
			if err := validateBarcode(b); err != nil {
				return err
			}
			key := barcodeKey(b)
			if assigned[key] {
				return errors.New("Each barcode can only be assigned once.")
			}
			assigned[key] = true
		}
	}
	recipe := func(rs []Ingredient, frozen bool) error {
		if len(rs) == 0 {
			return errors.New("Add at least one recipe material.")
		}
		seen := map[string]bool{}
		for _, r := range rs {
			if d.material(r.MaterialID) == nil || seen[r.MaterialID] {
				return errors.New("Add each existing recipe material once.")
			}
			seen[r.MaterialID] = true
			if _, err := parseAmount(r.Quantity, "Material quantity", true); err != nil {
				return err
			}
			if frozen {
				if _, err := parseAmount(r.PackQuantity, "Purchase quantity", true); err != nil {
					return err
				}
				if _, err := parseAmount(r.PackPrice, "Purchase price", false); err != nil {
					return err
				}
			}
		}
		return nil
	}
	for _, p := range d.Products {
		if err := identity("product", p.ID, p.Name); err != nil {
			return err
		}
		if !validText(p.Name, true) || p.Stock < 0 || p.Stock > 1000000000 || (p.Threshold != nil && (*p.Threshold < 0 || *p.Threshold > 1000000)) {
			return errors.New("Invalid product name, stock or threshold.")
		}
		if _, err := parseAmount(p.Minutes, "Production time", false); err != nil {
			return err
		}
		if err := recipe(p.Recipe, false); err != nil {
			return err
		}
	}
	for _, o := range d.Orders {
		if err := identity("order", o.ID, ""); err != nil {
			return err
		}
		if !validText(o.Customer, true) || !validText(o.Contact, false) || !validDate(o.CreatedDate) || (o.RequestedDate != "" && !validDate(o.RequestedDate)) || statuses[o.Status] == "" || len(o.Lines) == 0 {
			return errors.New("Invalid order details, dates or status.")
		}
		if o.active() || o.Status == "COMPLETED" || o.ConfirmedAt != "" {
			if _, err := time.Parse(time.RFC3339Nano, o.ConfirmedAt); err != nil || !validCurrency(o.Currency) {
				return errors.New("Missing saved confirmation details.")
			}
		}
		seen := map[string]bool{}
		for _, l := range o.Lines {
			if d.product(l.ProductID) == nil || seen[l.ProductID] || l.Quantity < 1 || l.Quantity > 1000000 || l.FromStock < 0 || l.Produced < 0 || l.remaining() < 0 {
				return errors.New("Invalid or duplicate ordered product or quantities.")
			}
			seen[l.ProductID] = true
			if _, err := parseAmount(l.Price, "Selling price", false); err != nil {
				return err
			}
			if o.Status == "PENDING" && (l.Quote != nil || l.FromStock != 0 || l.Produced != 0 || o.ConfirmedAt != "" || o.Currency != "") {
				return errors.New("Pending orders cannot reserve stock.")
			}
			if o.ConfirmedAt != "" {
				if l.Quote == nil {
					return errors.New("Missing confirmed order costs.")
				}
			}
			if l.Quote != nil {
				q := l.Quote
				if !validText(q.Name, true) {
					return errors.New("Missing saved product name.")
				}
				for _, s := range []string{q.Minutes, q.HourlyRate} {
					if _, err := parseAmount(s, "Saved cost", false); err != nil {
						return err
					}
				}
				if err := recipe(q.Recipe, true); err != nil {
					return err
				}
			}
			if o.Status == "COMPLETED" && l.remaining() != 0 {
				return errors.New("A completed order still has unfinished products.")
			}
		}
	}
	for id, reserved := range d.productReservations() {
		if d.product(id).Stock < reserved {
			return errors.New("Stock is below the quantity reserved for orders.")
		}
	}
	for _, m := range d.Movements {
		if err := identity("movement", m.ID, ""); err != nil {
			return err
		}
		if _, err := time.Parse(time.RFC3339Nano, m.Date); err != nil {
			return errors.New("Invalid stock change date.")
		}
		v, err := decimal.NewFromString(m.Quantity)
		if err != nil || v.Abs().GreaterThan(n("1000000000")) || !v.Equal(v.Truncate(6)) || !validText(m.Item, true) || !validText(m.Unit, true) || !validText(m.Note, true) {
			return errors.New("Invalid stock change.")
		}
	}
	return nil
}
func cloneData(d *Data) *Data {
	b, err := json.Marshal(d)
	if err != nil {
		panic(err)
	}
	var copy Data
	if err := json.Unmarshal(b, &copy); err != nil {
		panic(err)
	}
	return &copy
}

func validCurrency(code string) bool {
	return len(code) == 3 && strings.Contains(currencyCodes, " "+code+" ")
}
