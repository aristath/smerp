package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixture() *Data {
	d := emptyData()
	d.Settings.HourlyRate = "18"
	d.Suppliers = append(d.Suppliers, Supplier{"supplier", "Metal shop", "supplier@example.test", 5})
	d.Materials = append(d.Materials, Material{ID: "fasteners", Name: "Fasteners", Unit: "pieces", PackQuantity: "100", PackPrice: "10", SupplierID: "supplier", Stock: "100", Barcodes: []Barcode{}}, Material{ID: "sheet", Name: "Sheet", Unit: "m", PackQuantity: "30", PackPrice: "40", SupplierID: "supplier", Stock: "50", Barcodes: []Barcode{}})
	d.Products = append(d.Products, Product{ID: "tray", Name: "Tray", Minutes: "5", Recipe: []Ingredient{{MaterialID: "fasteners", Quantity: "4"}, {MaterialID: "sheet", Quantity: "0.3"}}})
	return d
}
func addOrder(d *Data, id string, count int) *Order {
	d.Orders = append(d.Orders, Order{ID: id, Customer: "Customer " + id, Status: "PENDING", CreatedDate: "2026-11-16", Lines: []Line{{ProductID: "tray", Quantity: count, Price: "5"}}})
	return d.order(id)
}
func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func equalNumber(t *testing.T, got number, want string) {
	t.Helper()
	if !got.Equal(n(want)) {
		t.Fatalf("got %s, want %s", got, want)
	}
}
func testStore(t *testing.T, d *Data) *Store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "workshop.json"))
	must(t, err)
	_, rev, _ := s.snapshot()
	must(t, s.update(rev, d, nil))
	return s
}
func TestCostsAndDecimalInput(t *testing.T) {
	d := fixture()
	q := d.quote(&d.Products[0])
	equalNumber(t, q.materialCost(), "0.8")
	equalNumber(t, q.labourCost(), "1.5")
	equalNumber(t, q.minimumPrice(), "2.30")
	d.Settings.HourlyRate = "18.01"
	equalNumber(t, d.quote(&d.Products[0]).minimumPrice(), "2.31")
	s, err := parseAmount("0,3", "Quantity", false)
	must(t, err)
	if s != "0.3" {
		t.Fatal(s)
	}
	for _, s := range []string{"NaN", "Infinity", "-1", "1.1234567", "1000000001", "1e999999999"} {
		if _, err := parseAmount(s, "Quantity", false); err == nil {
			t.Fatal("accepted", s)
		}
	}
}
func TestIsolatedAndCombinedRequirements(t *testing.T) {
	d := fixture()
	d.Materials[1].Stock = "10"
	d.Products[0].Recipe = []Ingredient{{MaterialID: "sheet", Quantity: "6"}}
	addOrder(d, "a", 1)
	addOrder(d, "b", 1)
	for _, p := range d.plans("2026-11-16") {
		equalNumber(t, p.Needs[0].Shortage, "0")
	}
	total, individual := d.summaries()
	equalNumber(t, total[0].Balance, "-2")
	for _, needs := range individual {
		equalNumber(t, needs[0].Balance, "4")
	}
	must(t, d.confirm("a"))
	must(t, d.confirm("b"))
	// Displayed sufficiency remains isolated; actual production protects the first reservation.
	for _, p := range d.plans("2026-11-16") {
		equalNumber(t, p.Needs[0].Shortage, "0")
	}
	if err := d.produce("tray", 1, "b"); err == nil {
		t.Fatal("consumed another order's reserved fabric")
	}
	must(t, d.produce("tray", 1, "a"))
	equalNumber(t, n(d.Materials[1].Stock), "4")
}
func TestSavedQuotePartialProductionAndHandover(t *testing.T) {
	d := fixture()
	d.Products[0].Stock = 2
	addOrder(d, "a", 4)
	must(t, d.confirm("a"))
	d.Products[0].Recipe[0].Quantity = "99"
	d.Settings.HourlyRate = "99"
	d.Materials[0].PackPrice = "999"
	equalNumber(t, d.lineQuote(d.order("a").Lines[0]).minimumPrice(), "2.30")
	must(t, d.produce("tray", 1, "a"))
	if d.order("a").Status != "IN_PROGRESS" {
		t.Fatal("not in progress")
	}
	if err := d.complete("a"); err == nil {
		t.Fatal("completed unfinished order")
	}
	must(t, d.produce("tray", 1, "a"))
	must(t, d.complete("a"))
	if d.Products[0].Stock != 0 {
		t.Fatal("stock not handed over")
	}
	equalNumber(t, n(d.Materials[0].Stock), "92")
	before := len(d.Movements)
	if err := d.complete("a"); err == nil {
		t.Fatal("completed twice")
	}
	must(t, d.delete("orders", "a"))
	if len(d.Movements) != before {
		t.Fatal("deleted history")
	}
	must(t, d.validate())
}
func TestLaterFinishedStockAndCancellation(t *testing.T) {
	d := fixture()
	addOrder(d, "a", 4)
	addOrder(d, "b", 4)
	must(t, d.confirm("a"))
	must(t, d.confirm("b"))
	must(t, d.changeStock("product", "tray", "4", true, "Ready shirts"))
	if d.order("a").Lines[0].FromStock != 0 || d.order("b").Lines[0].FromStock != 0 {
		t.Fatal("automatically redistributed stock")
	}
	if d.plans("2026-11-16")["b"].ToMake != 0 {
		t.Fatal("later finished stock ignored")
	}
	// The owner chooses which order to hand over; no automatic priority policy.
	must(t, d.complete("b"))
	if d.Products[0].Stock != 0 {
		t.Fatal("did not hand over stock")
	}
	equalNumber(t, n(d.Materials[0].Stock), "100")
	must(t, d.produce("tray", 1, "a"))
	must(t, d.cancel("a"))
	if d.Products[0].Stock != 1 {
		t.Fatal("cancellation removed made goods")
	}
	equalNumber(t, n(d.Materials[0].Stock), "96")
	if len(d.reservedMaterials()) != 0 {
		t.Fatal("reservation not released")
	}
	must(t, d.validate())
}
func TestSchedulingAndPurchases(t *testing.T) {
	d := fixture()
	d.Products[0].Stock = 20
	addOrder(d, "a", 100)
	p := d.plans("2026-11-16")["a"]
	equalNumber(t, p.Minutes, "400")
	equalNumber(t, p.Needs[0].PurchaseCost, "30")
	if p.Completion != "2026-11-24" {
		t.Fatal(p.Completion)
	}
	d.Schedule.Hours = []string{"0", "0", "0", "0", "0", "0", "0"}
	if d.plans("2026-11-16")["a"].Completion != "" {
		t.Fatal("invented capacity")
	}
	d.Products[0].Stock = 100
	if d.plans("2026-11-16")["a"].Completion != "2026-11-16" {
		t.Fatal("ready goods need capacity")
	}
	if businessDays("2026-11-20", 1) != "2026-11-23" {
		t.Fatal("weekend delivery")
	}
}
func TestAtomicSavesStaleFormsAndDiskFailure(t *testing.T) {
	s := testStore(t, fixture())
	old, rev, _ := s.snapshot()
	raw := s.backup()
	err := s.update(rev, nil, func(d *Data) error { d.Materials[0].Stock = "-1"; return nil })
	if err == nil {
		t.Fatal("accepted negative stock")
	}
	if string(raw) != string(s.backup()) || old.Materials[0].Stock != "100" {
		t.Fatal("failed mutation leaked")
	}
	must(t, s.update(rev, nil, func(d *Data) error { d.Settings.HourlyRate = "22"; return nil }))
	if err := s.update(rev, nil, func(d *Data) error { d.Settings.HourlyRate = "33"; return nil }); !errors.Is(err, errConflict) {
		t.Fatal("stale update", err)
	}
	_, current, _ := s.snapshot()
	before := s.backup()
	originalPath := s.path
	s.path = filepath.Join(originalPath, "child")
	if err := s.update(current, nil, func(d *Data) error { d.Settings.HourlyRate = "99"; return nil }); err == nil {
		t.Fatal("ignored disk failure")
	}
	if string(before) != string(s.backup()) {
		t.Fatal("published failed save")
	}
	disk, err := os.ReadFile(originalPath)
	must(t, err)
	if string(disk) != string(before) {
		t.Fatal("disk changed")
	}
}
func TestDeliveryRetryAndWholeBatchFailure(t *testing.T) {
	s := testStore(t, fixture())
	_, rev, _ := s.snapshot()
	id := "01234567-1234-1234-1234-0123456789ab"
	rows := []ReceiptRow{{MaterialID: "fasteners", Quantity: "0.3", Code: &Barcode{"EAN_13", "4006381333931"}}, {MaterialID: "sheet", Quantity: "-1"}}
	before := s.backup()
	if err := s.update(rev, nil, func(d *Data) error { return d.receive(id, rows) }); err == nil {
		t.Fatal("accepted bad batch")
	}
	if string(before) != string(s.backup()) {
		t.Fatal("partial batch saved")
	}
	rows = rows[:1]
	must(t, s.update(rev, nil, func(d *Data) error { return d.receive(id, rows) }))
	d, current, _ := s.snapshot()
	equalNumber(t, n(d.Materials[0].Stock), "100.3")
	if len(d.Materials[0].Barcodes) != 1 {
		t.Fatal("barcode missing")
	}
	must(t, s.update(current, nil, func(d *Data) error { return d.receive(id, rows) }))
	d, _, _ = s.snapshot()
	if len(d.Movements) != 1 {
		t.Fatal("duplicate receipt")
	}
}
func TestBackupCompletenessAndRecovery(t *testing.T) {
	s := testStore(t, fixture())
	d, err := decodeData(s.backup())
	must(t, err)
	must(t, d.validate())
	var raw map[string]any
	must(t, json.Unmarshal(s.backup(), &raw))
	delete(raw, "orders")
	bad, _ := json.Marshal(raw)
	if _, err := decodeData(bad); err == nil {
		t.Fatal("accepted incomplete backup")
	}
	raw["orders"] = []any{}
	raw["format"] = "smerp-backup"
	bad, _ = json.Marshal(raw)
	if _, err := decodeData(bad); err == nil {
		t.Fatal("implemented old format")
	}
	path := filepath.Join(t.TempDir(), "broken.json")
	must(t, os.WriteFile(path, []byte("damaged"), 0600))
	broken, err := openStore(path)
	must(t, err)
	_, rev, err := broken.snapshot()
	if err == nil || string(broken.backup()) != "damaged" {
		t.Fatal("lost damaged data")
	}
	must(t, broken.update(rev, emptyData(), nil))
	_, _, err = broken.snapshot()
	must(t, err)
}
func TestBarcodesAndSystemDate(t *testing.T) {
	for _, b := range []Barcode{{"EAN_13", "4006381333931"}, {"EAN_8", "96385074"}, {"UPC_A", "012345000065"}, {"UPC_E", "01234565"}, {"QR_CODE", " https://example.test/part\n"}} {
		must(t, validateBarcode(b))
	}
	if barcodeKey(Barcode{"UPC_E", "01234565"}) != barcodeKey(Barcode{"UPC_A", "012345000065"}) {
		t.Fatal("UPC identity")
	}
	if err := validateBarcode(Barcode{"EAN_13", "4006381333932"}); err == nil {
		t.Fatal("bad check digit")
	}
	old := time.Local
	defer func() { time.Local = old }()
	time.Local = time.FixedZone("test", -11*3600)
	if today() != time.Now().In(time.Local).Format(time.DateOnly) {
		t.Fatal("ignored system zone")
	}
	if !strings.HasPrefix(barcodeKey(Barcode{"QR_CODE", "123"}), "qr:") {
		t.Fatal("QR treated as numeric barcode")
	}
}

func TestFailedAtomicReplacementRemovesTemporaryFile(t *testing.T) {
	s := testStore(t, fixture())
	_, rev, _ := s.snapshot()
	before := s.backup()
	target := filepath.Join(filepath.Dir(s.path), "not-a-file")
	must(t, os.Mkdir(target, 0700))
	must(t, os.WriteFile(filepath.Join(target, "keep"), []byte("keep"), 0600))
	s.path = target
	if err := s.update(rev, nil, func(d *Data) error { d.Settings.HourlyRate = "77"; return nil }); err == nil {
		t.Fatal("replaced a nonempty directory")
	}
	if !bytes.Equal(before, s.backup()) {
		t.Fatal("published failed replacement")
	}
	entries, err := os.ReadDir(filepath.Dir(target))
	must(t, err)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".smerp-") {
			t.Fatal("temporary file left behind")
		}
	}
}
