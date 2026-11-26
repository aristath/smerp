package workshop

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
)

//go:embed assets/* templates/*
var content embed.FS

type App struct {
	store  *Store
	origin string
}

// Open serves a workshop and its embedded interface using a local JSON file.
func Open(path, origin string) (http.Handler, error) {
	store, err := openStore(path)
	if err != nil {
		return nil, err
	}
	return (&App{store: store, origin: origin}).handler(), nil
}

func (a *App) handler() http.Handler {
	mux := http.NewServeMux()
	assets, _ := fs.Sub(content, "assets")
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.FS(assets))))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		_, _, err := a.store.snapshot()
		if err != nil {
			a.fail(w, r, err)
			return
		}
		sendJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("GET /api/revision", func(w http.ResponseWriter, r *http.Request) {
		_, rev, _ := a.store.snapshot()
		sendJSON(w, 200, map[string]string{"revision": rev})
	})
	mux.HandleFunc("GET /backup", a.download)
	mux.HandleFunc("POST /api/restore-preview", a.restorePreview)
	mux.HandleFunc("POST /restore", a.restore)
	mux.HandleFunc("POST /api/product-preview", a.productPreview)
	mux.HandleFunc("POST /api/order-preview", a.orderPreview)
	mux.HandleFunc("POST /api/materials/receive", a.receive)
	mux.HandleFunc("POST /settings", a.settings)
	mux.HandleFunc("POST /schedule", a.schedule)
	mux.HandleFunc("POST /inventory/save", a.stock)
	for _, section := range []string{"suppliers", "materials", "products", "orders"} {
		mux.HandleFunc("GET /"+section, func(w http.ResponseWriter, r *http.Request) { a.page(w, r, section, "", nil, nil) })
		mux.HandleFunc("GET /"+section+"/new", func(w http.ResponseWriter, r *http.Request) { a.page(w, r, section+"-edit", "", nil, nil) })
		mux.HandleFunc("GET /"+section+"/{id}/edit", func(w http.ResponseWriter, r *http.Request) {
			a.page(w, r, section+"-edit", r.PathValue("id"), nil, nil)
		})
		mux.HandleFunc("POST /"+section+"/save", func(w http.ResponseWriter, r *http.Request) {
			if !a.parseForm(w, r) {
				return
			}
			id := field(r.Form, "id")
			err := a.store.update(r.Form.Get("revision"), nil, func(d *Data) error { var err error; id, err = d.saveEntity(section, r.Form); return err })
			if err != nil {
				a.page(w, r, section+"-edit", r.Form.Get("id"), r.Form, err)
				return
			}
			target := "/" + section
			if section == "orders" {
				target += "/" + id
			}
			http.Redirect(w, r, target, 303)
		})
		mux.HandleFunc("POST /"+section+"/{id}/delete", func(w http.ResponseWriter, r *http.Request) {
			if !a.parseForm(w, r) {
				return
			}
			err := a.store.update(r.Form.Get("revision"), nil, func(d *Data) error { return d.delete(section, r.PathValue("id")) })
			if err != nil {
				a.page(w, r, section, "", nil, err)
				return
			}
			http.Redirect(w, r, "/"+section, 303)
		})
	}
	mux.HandleFunc("GET /orders/{id}", func(w http.ResponseWriter, r *http.Request) { a.page(w, r, "order", r.PathValue("id"), nil, nil) })
	for _, action := range []string{"confirm", "cancel", "complete"} {
		mux.HandleFunc("POST /orders/{id}/"+action, func(w http.ResponseWriter, r *http.Request) {
			if !a.parseForm(w, r) {
				return
			}
			id := r.PathValue("id")
			err := a.store.update(r.Form.Get("revision"), nil, func(d *Data) error {
				switch action {
				case "confirm":
					return d.confirm(id)
				case "cancel":
					return d.cancel(id)
				default:
					return d.complete(id)
				}
			})
			if err != nil {
				a.page(w, r, "order", id, nil, err)
				return
			}
			http.Redirect(w, r, "/orders/"+id, 303)
		})
	}
	for _, name := range []string{"inventory", "schedule"} {
		mux.HandleFunc("GET /"+name, func(w http.ResponseWriter, r *http.Request) { a.page(w, r, name, "", nil, nil) })
	}
	mux.HandleFunc("GET /inventory/receive", func(w http.ResponseWriter, r *http.Request) { a.page(w, r, "receiving", "", nil, nil) })
	mux.HandleFunc("GET /inventory/edit", func(w http.ResponseWriter, r *http.Request) { a.page(w, r, "stock", r.URL.Query().Get("id"), nil, nil) })
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { a.page(w, r, "overview", "", nil, nil) })
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { a.page(w, r, "not-found", "", nil, nil) })
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cache-Control", "no-store")
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if !a.allowedHost(r.Host) {
			http.Error(w, "Use the configured Smerp address.", 400)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			origin := r.Header.Get("Origin")
			if (origin != "" && !sameOrigin(origin, r) && origin != a.origin) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				http.Error(w, "This request did not come from Smerp. Reload the app and try again.", 403)
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes+65536)
		defer func() {
			if r.MultipartForm != nil {
				_ = r.MultipartForm.RemoveAll()
			}
		}()
		defer func() {
			if v := recover(); v != nil {
				a.fail(w, r, fmt.Errorf("Could not complete this action: %v", v))
			}
		}()
		mux.ServeHTTP(w, r)
	})
}
func sameOrigin(origin string, r *http.Request) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return u.Host == r.Host && u.Scheme == scheme
}
func (a *App) allowedHost(host string) bool {
	if a.origin != "" {
		u, err := url.Parse(a.origin)
		return err == nil && u.Host == host
	}
	name, _, err := net.SplitHostPort(host)
	if err != nil {
		name = host
	}
	if name == "localhost" {
		return true
	}
	ip := net.ParseIP(strings.Trim(name, "[]"))
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	addresses, _ := net.InterfaceAddrs()
	for _, v := range addresses {
		local, _, err := net.ParseCIDR(v.String())
		if err == nil && local.Equal(ip) {
			return true
		}
	}
	return false
}
func sendJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func errorStatus(err error) int {
	if errors.Is(err, errConflict) {
		return 409
	}
	var size *http.MaxBytesError
	if errors.As(err, &size) {
		return 413
	}
	return 422
}
func (a *App) fail(w http.ResponseWriter, r *http.Request, err error) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		result := map[string]any{"error": err.Error()}
		if errors.Is(err, errConflict) {
			d, rev, _ := a.store.snapshot()
			result["revision"] = rev
			if r.URL.Path == "/api/materials/receive" {
				result["materials"] = d.Materials
			}
		}
		sendJSON(w, errorStatus(err), result)
		return
	}
	a.page(w, r, "error", "", nil, err)
}
func (a *App) parseForm(w http.ResponseWriter, r *http.Request) bool {
	var err error
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		err = r.ParseMultipartForm(maxBytes)
	} else {
		err = r.ParseForm()
	}
	if err != nil {
		a.fail(w, r, err)
		return false
	}
	return true
}
func (a *App) stock(w http.ResponseWriter, r *http.Request) {
	if !a.parseForm(w, r) {
		return
	}
	f := r.Form
	kind, mode, id := field(f, "kind"), field(f, "mode"), field(f, "id")
	err := a.store.update(f.Get("revision"), nil, func(d *Data) error {
		if !slices.Contains([]string{"material", "product"}, kind) || !slices.Contains([]string{"receive", "count", "produce"}, mode) || (kind == "material" && mode == "produce") {
			return errors.New("Choose a valid stock action.")
		}
		if mode == "produce" {
			count, err := formInt(f.Get("quantity"), "Number made", 1, 1000000)
			if err != nil {
				return err
			}
			return d.produce(id, count, field(f, "orderId"))
		}
		return d.changeStock(kind, id, f.Get("quantity"), mode == "receive", field(f, "reason"))
	})
	if err != nil {
		a.page(w, r, "stock", id, f, err)
		return
	}
	target := "/inventory"
	if field(f, "orderId") != "" {
		target = "/orders/" + field(f, "orderId")
	}
	http.Redirect(w, r, target, 303)
}
func (a *App) settings(w http.ResponseWriter, r *http.Request) {
	if !a.parseForm(w, r) {
		return
	}
	f := r.Form
	err := a.store.update(f.Get("revision"), nil, func(d *Data) error {
		rate, err := amountField(f, "hourlyRate", "Hourly rate", false)
		if err != nil {
			return err
		}
		d.Settings = Settings{field(f, "title"), field(f, "subtitle"), rate, strings.ToUpper(field(f, "currency"))}
		return nil
	})
	if err != nil {
		a.page(w, r, "overview", "", f, err)
		return
	}
	target := f.Get("returnTo")
	if !safeReturn.MatchString(target) {
		target = "/"
	}
	http.Redirect(w, r, target, 303)
}
func (a *App) schedule(w http.ResponseWriter, r *http.Request) {
	if !a.parseForm(w, r) {
		return
	}
	f := r.Form
	err := a.store.update(f.Get("revision"), nil, func(d *Data) error {
		hours := []string{}
		for _, v := range f["hours"] {
			q, err := parseAmount(v, "Working hours", false)
			if err != nil {
				return err
			}
			hours = append(hours, q)
		}
		days := append([]string{}, f["daysOff"]...)
		if field(f, "newDayOff") != "" {
			days = append(days, field(f, "newDayOff"))
		}
		sort.Strings(days)
		d.Schedule = Schedule{hours, slices.Compact(days)}
		return nil
	})
	if err != nil {
		a.page(w, r, "schedule", "", f, err)
		return
	}
	http.Redirect(w, r, "/schedule?saved=1", 303)
}
func (a *App) productPreview(w http.ResponseWriter, r *http.Request) {
	if !a.parseForm(w, r) {
		return
	}
	d, rev, err := a.store.snapshot()
	if err == nil && rev != r.Form.Get("revision") {
		err = errConflict
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	p, err := productForm(d, r.Form, "preview")
	if err != nil {
		a.fail(w, r, err)
		return
	}
	q := d.quote(&p)
	sendJSON(w, 200, map[string]string{"materials": money(q.materialCost(), d.Settings.Currency), "labour": money(q.labourCost(), d.Settings.Currency), "minimum": money(q.minimumPrice(), d.Settings.Currency)})
}
func (a *App) orderPreview(w http.ResponseWriter, r *http.Request) {
	if !a.parseForm(w, r) {
		return
	}
	d, rev, err := a.store.snapshot()
	if err == nil && rev != r.Form.Get("revision") {
		err = errConflict
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	draft := cloneData(d)
	id := field(r.Form, "id")
	if id == "" {
		id = newID()
	}
	o, err := orderForm(draft, r.Form, id, true)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if old := draft.order(id); old != nil {
		*old = o
	} else {
		draft.Orders = append(draft.Orders, o)
	}
	p := draft.plans(today())[id]
	minimumPrice := whole(0)
	warning := ""
	for _, l := range o.Lines {
		min := draft.lineQuote(l).minimumPrice()
		minimumPrice = minimumPrice.Add(min.Mul(whole(l.Quantity)))
		if n(l.Price).LessThan(min) {
			warning = "One or more selling prices are below materials and labour cost."
		}
	}
	completion := prettyDate(p.Completion)
	if p.Completion == "" {
		completion = "Set working hours"
	}
	sendJSON(w, 200, map[string]string{"minimum": money(minimumPrice, d.Settings.Currency), "work": duration(p.Minutes), "purchases": money(p.purchaseTotal(), d.Settings.Currency), "completion": completion, "warning": warning})
}
func (a *App) receive(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Revision  string       `json:"revision"`
		ReceiptID string       `json:"receiptId"`
		Rows      []ReceiptRow `json:"rows"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		a.fail(w, r, err)
		return
	}
	d, _, err := a.store.snapshot()
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if regexpReceipt.MatchString(payload.ReceiptID) && d.received(payload.ReceiptID) {
		sendJSON(w, 200, map[string]bool{"ok": true})
		return
	}
	err = a.store.update(payload.Revision, nil, func(d *Data) error { return d.receive(payload.ReceiptID, payload.Rows) })
	if err != nil {
		a.fail(w, r, err)
		return
	}
	sendJSON(w, 200, map[string]bool{"ok": true})
}
func (a *App) download(w http.ResponseWriter, r *http.Request) {
	raw := a.store.backup()
	if len(raw) == 0 {
		raw, _ = json.MarshalIndent(emptyData(), "", "  ")
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="smerp-backup-`+today()+`.json"`)
	_, _ = w.Write(raw)
}
func (a *App) upload(r *http.Request) (*Data, string, error) {
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		return nil, "", err
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("backup")
	if err != nil {
		return nil, "", errors.New("Choose a JSON backup no larger than 10 MB.")
	}
	defer file.Close()
	if header.Size == 0 || header.Size > maxBytes {
		return nil, "", errors.New("Choose a JSON backup no larger than 10 MB.")
	}
	raw, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, "", err
	}
	d, err := decodeData(raw)
	return d, r.FormValue("revision"), err
}
func (a *App) restorePreview(w http.ResponseWriter, r *http.Request) {
	d, revision, err := a.upload(r)
	if err == nil {
		_, current, _ := a.store.snapshot()
		if revision != current {
			err = errConflict
		}
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	sendJSON(w, 200, map[string]string{"summary": fmt.Sprintf("Suppliers: %d. Materials: %d. Products: %d. Orders: %d. Inventory, working hours, and settings are included.", len(d.Suppliers), len(d.Materials), len(d.Products), len(d.Orders))})
}
func (a *App) restore(w http.ResponseWriter, r *http.Request) {
	d, revision, err := a.upload(r)
	if err == nil && r.FormValue("confirmRestore") != "replace" {
		err = errors.New("Preview the backup and confirm replacement first.")
	}
	if err == nil {
		err = a.store.update(revision, d, nil)
	}
	if err != nil {
		a.page(w, r, "recovery", "", nil, err)
		return
	}
	http.Redirect(w, r, "/?restored=1", 303)
}
