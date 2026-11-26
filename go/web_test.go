package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

type webTest struct {
	t       *testing.T
	s       *Store
	handler http.Handler
}

func newWebTest(t *testing.T, d *Data) *webTest {
	s := testStore(t, d)
	return &webTest{t, s, (&App{store: s}).handler()}
}
func (x *webTest) request(method, path string, body io.Reader, kind string) *httptest.ResponseRecorder {
	x.t.Helper()
	r := httptest.NewRequest(method, "http://127.0.0.1:3210"+path, body)
	if kind != "" {
		r.Header.Set("Content-Type", kind)
	}
	if method != "GET" {
		r.Header.Set("Origin", "http://127.0.0.1:3210")
	}
	w := httptest.NewRecorder()
	x.handler.ServeHTTP(w, r)
	return w
}
func (x *webTest) post(path string, values url.Values) *httptest.ResponseRecorder {
	x.t.Helper()
	if values == nil {
		values = url.Values{}
	}
	if !values.Has("revision") {
		_, rev, _ := x.s.snapshot()
		values.Set("revision", rev)
	}
	return x.request("POST", path, strings.NewReader(values.Encode()), "application/x-www-form-urlencoded")
}
func status(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status %d, want %d: %s", w.Code, want, w.Body.String())
	}
}
func TestAllManagementScreens(t *testing.T) {
	d := fixture()
	addOrder(d, "a", 2)
	x := newWebTest(t, d)
	for _, path := range []string{"/", "/suppliers", "/materials", "/products", "/orders", "/orders/a", "/inventory", "/inventory/receive", "/schedule", "/suppliers/new", "/materials/new", "/products/new", "/orders/new", "/materials/fasteners/edit", "/products/tray/edit", "/orders/a/edit", "/inventory/edit?kind=product&id=tray&mode=produce", "/inventory/edit?kind=material&id=sheet&mode=count"} {
		t.Run(path, func(t *testing.T) {
			w := x.request("GET", path, nil, "")
			status(t, w, 200)
			if !strings.Contains(w.Body.String(), `id="page-data"`) {
				t.Fatal("missing browser bootstrap")
			}
			if strings.Contains(w.Body.String(), "ZgotmplZ") {
				t.Fatal("unsafe template URL")
			}
		})
	}
	status(t, x.request("GET", "/missing", nil, ""), 404)
}
func TestManagementAndLivePreviews(t *testing.T) {
	x := newWebTest(t, fixture())
	w := x.post("/suppliers/save", url.Values{"name": {" New supplier "}, "contact": {"hello"}, "leadDays": {"3"}})
	status(t, w, 303)
	w = x.post("/materials/save", url.Values{"id": {"fasteners"}, "name": {"Fasteners"}, "unit": {"pieces"}, "supplierId": {"supplier"}, "packQuantity": {"100"}, "packPrice": {"10"}, "barcodesEdited": {"1"}, "barcodeFormat": {"EAN_13"}, "barcodeValue": {"4006381333931"}})
	status(t, w, 303)
	d, _, _ := x.s.snapshot()
	if d.material("fasteners").Stock != "100" {
		t.Fatal("editing reset stock")
	}
	w = x.post("/api/product-preview", url.Values{"minutes": {"5"}, "recipeMaterial": {"fasteners", "sheet"}, "recipeQuantity": {"4", "0.3"}})
	status(t, w, 200)
	if !strings.Contains(w.Body.String(), "EUR 2.30") {
		t.Fatal(w.Body.String())
	}
	// The retained browser sends multipart FormData for live previews.
	var body bytes.Buffer
	f := multipart.NewWriter(&body)
	_, rev, _ := x.s.snapshot()
	for k, v := range map[string]string{"revision": rev, "minutes": "5", "recipeMaterial": "fasteners", "recipeQuantity": "4"} {
		must(t, f.WriteField(k, v))
	}
	must(t, f.Close())
	w = x.request("POST", "/api/product-preview", &body, f.FormDataContentType())
	status(t, w, 200)
	w = x.post("/api/order-preview", url.Values{"customer": {""}, "lineProduct": {"tray"}, "lineQuantity": {"100"}, "linePrice": {"1"}})
	status(t, w, 200)
	if !strings.Contains(w.Body.String(), "8h 20m") || !strings.Contains(w.Body.String(), "below") {
		t.Fatal(w.Body.String())
	}
	d, _, _ = x.s.snapshot()
	if len(d.Orders) != 0 {
		t.Fatal("preview saved an order")
	}
	w = x.post("/suppliers/save", url.Values{"name": {"Keep this draft"}, "leadDays": {"999"}})
	status(t, w, 422)
	if !strings.Contains(w.Body.String(), "Keep this draft") {
		t.Fatal("lost draft")
	}
}
func TestHTTPWorkflowLaterStockAndStaleForm(t *testing.T) {
	x := newWebTest(t, fixture())
	w := x.post("/orders/save", url.Values{"customer": {"Alex"}, "lineProduct": {"tray"}, "lineQuantity": {"4"}, "linePrice": {"5"}})
	status(t, w, 303)
	target := w.Header().Get("Location")
	status(t, x.post(target+"/confirm", nil), 303)
	_, stale, _ := x.s.snapshot()
	status(t, x.post("/inventory/save", url.Values{"kind": {"product"}, "id": {"tray"}, "mode": {"receive"}, "quantity": {"4"}, "reason": {"Ready products"}}), 303)
	w = x.request("GET", target, nil, "")
	status(t, w, 200)
	if !strings.Contains(w.Body.String(), "Complete and hand over") {
		t.Fatal("later stock does not enable handover")
	}
	w = x.post("/suppliers/save", url.Values{"revision": {stale}, "name": {"Keep draft"}, "leadDays": {"1"}})
	status(t, w, 409)
	if !strings.Contains(w.Body.String(), "Keep draft") {
		t.Fatal("lost stale draft")
	}
	status(t, x.post(target+"/complete", nil), 303)
	d, _, _ := x.s.snapshot()
	if d.Products[0].Stock != 0 || d.Materials[0].Stock != "100" {
		t.Fatal("duplicated production")
	}
}
func TestHTTPBackupAndDamagedFileRecovery(t *testing.T) {
	x := newWebTest(t, fixture())
	original := x.s.backup()
	backup := x.request("GET", "/backup", nil, "")
	status(t, backup, 200)
	if !bytes.Equal(original, backup.Body.Bytes()) {
		t.Fatal("backup changed data")
	}
	upload := func(path string, raw []byte, confirmed bool) *httptest.ResponseRecorder {
		var body bytes.Buffer
		f := multipart.NewWriter(&body)
		_, rev, _ := x.s.snapshot()
		must(t, f.WriteField("revision", rev))
		if confirmed {
			must(t, f.WriteField("confirmRestore", "replace"))
		}
		part, err := f.CreateFormFile("backup", "workshop.json")
		must(t, err)
		_, err = part.Write(raw)
		must(t, err)
		must(t, f.Close())
		return x.request("POST", path, &body, f.FormDataContentType())
	}
	status(t, upload("/api/restore-preview", original, false), 200)
	status(t, upload("/restore", original, false), 422)
	status(t, upload("/restore", []byte(`{"format":"smerp-go"}`), true), 422)
	if !bytes.Equal(original, x.s.backup()) {
		t.Fatal("invalid import changed data")
	}
	replacement, _ := json.Marshal(emptyData())
	status(t, upload("/restore", replacement, true), 303)
	must(t, os.WriteFile(x.s.path, []byte("damaged"), 0600))
	broken, err := openStore(x.s.path)
	must(t, err)
	x.s = broken
	x.handler = (&App{store: broken}).handler()
	w := x.request("GET", "/", nil, "")
	status(t, w, 422)
	if !strings.Contains(w.Body.String(), "Your data needs attention") {
		t.Fatal(w.Body.String())
	}
	if x.request("GET", "/backup", nil, "").Body.String() != "damaged" {
		t.Fatal("lost damaged data")
	}
	status(t, upload("/restore", replacement, true), 303)
}
func TestHTTPReceiptRetriesAndRequestGuards(t *testing.T) {
	x := newWebTest(t, fixture())
	_, rev, _ := x.s.snapshot()
	payload := map[string]any{"revision": rev, "receiptId": "01234567-1234-1234-1234-0123456789ab", "rows": []any{map[string]any{"key": "browser-only", "name": "Untrusted", "materialId": "sheet", "quantity": "2.75", "code": nil}}}
	raw, _ := json.Marshal(payload)
	status(t, x.request("POST", "/api/materials/receive", bytes.NewReader(raw), "application/json"), 200)
	saved := x.s.backup()
	status(t, x.request("POST", "/api/materials/receive", bytes.NewReader(raw), "application/json"), 200)
	if !bytes.Equal(saved, x.s.backup()) {
		t.Fatal("duplicate receipt changed data")
	}
	r := httptest.NewRequest("POST", "http://127.0.0.1:3210/settings", strings.NewReader(""))
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	x.handler.ServeHTTP(w, r)
	status(t, w, 403)
	r = httptest.NewRequest("GET", "http://evil.example/", nil)
	w = httptest.NewRecorder()
	x.handler.ServeHTTP(w, r)
	status(t, w, 400)
	d := fixture()
	d.Suppliers[0].Name = "<script>alert(1)</script>"
	x = newWebTest(t, d)
	w = x.request("GET", "/suppliers", nil, "")
	if !strings.Contains(w.Body.String(), "&lt;script&gt;") {
		t.Fatal("unescaped HTML")
	}
	w = x.post("/schedule", url.Values{"hours": {"25"}})
	status(t, w, 422)
}
