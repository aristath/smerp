package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Opt-in: exercises actual WebKit/WebView rendering, the retained script, and UI interactions.
func TestWindowUI(t *testing.T) {
	if os.Getenv("SMERP_WINDOW_TEST") != "1" {
		t.Skip("set SMERP_WINDOW_TEST=1 in a graphical session or xvfb-run")
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	s := testStore(t, fixture())
	server := httptest.NewServer((&App{store: s}).handler())
	defer server.Close()
	w, err := newWindow(server.URL)
	must(t, err)
	defer w.Destroy()
	results := make(chan string, 8)
	must(t, w.Bind("smerpTestReport", func(result string) { results <- result }))
	must(t, w.Init(`window.addEventListener('load',async()=>{
 const errors=[];
 try {
  for(let i=0;i<100&&!document.body._x_dataStack;i++)await new Promise(r=>setTimeout(r,25));
  if(!document.body._x_dataStack)throw Error('Browser script did not initialise');
  if(document.querySelector('#page-data').textContent.includes('ZgotmplZ'))throw Error('Invalid bootstrap');
  if(location.pathname==='/'){
   const before=document.documentElement.dataset.theme;
   const background=getComputedStyle(document.documentElement).backgroundColor;
   document.querySelector('.theme-toggle').click();
   await new Promise(r=>setTimeout(r,100));
   if(document.documentElement.dataset.theme===before||getComputedStyle(document.documentElement).backgroundColor===background)throw Error('Theme did not change');
   document.querySelector('.settings-button').click();
   if(!document.querySelector('#settings-dialog').open)throw Error('Settings dialog did not open');
   document.querySelector('#settings-dialog button').click();
  }
  if(location.pathname==='/products/new'){
   const form=document.querySelector('main form');
   const input=form.querySelector('[name=recipeQuantity]');
   if(!input)throw Error('Recipe rows did not render');
   input.value='4';input.dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(r=>setTimeout(r,800));
   if(!form.querySelector('aside').innerText.includes('EUR 1.90'))throw Error('Live cost preview failed: '+form.querySelector('aside').innerText);
  }
  if(location.pathname==='/inventory/receive'){
   const root=document.querySelector('[x-data=receivingEditor]');
   const editor=root._x_dataStack[0];
   editor.manualFormat='QR_CODE';editor.manualCode='test-code';editor.enterCode();
   await new Promise(r=>setTimeout(r,50));
   if(!root.querySelector('dialog').open)throw Error('Barcode dialog did not open');
   editor.assignExisting();editor.selectedId='sheet';editor.quantity='0.5';
   await new Promise(r=>setTimeout(r,50));editor.addQuantity();
   await new Promise(r=>setTimeout(r,50));
   if(editor.rows.length!==1||!root.querySelector('table').innerText.includes('Sheet'))throw Error('Delivery was not staged');
  }
 } catch(e){errors.push(e.message)}
 await window.smerpTestReport(JSON.stringify({path:location.pathname,errors}));
});`))
	done := make(chan struct{})
	defer close(done)
	go func() {
		pages := []string{"/", "/products/new", "/inventory/receive"}
		for i, path := range pages {
			select {
			case result := <-results:
				var report struct {
					Path   string
					Errors []string
				}
				if err := json.Unmarshal([]byte(result), &report); err != nil {
					t.Error(err)
				} else if report.Path != path || len(report.Errors) > 0 {
					t.Errorf("WebView %s: %s", path, result)
				}
				if i+1 < len(pages) {
					next := pages[i+1]
					_ = w.Dispatch(func() { _ = w.Navigate(server.URL + next) })
				}
			case <-time.After(20 * time.Second):
				t.Errorf("WebView timed out at %s", path)
				_ = w.Terminate()
				return
			case <-done:
				return
			}
		}
		_ = w.Terminate()
	}()
	must(t, w.Run())
	if t.Failed() {
		return
	}
	if raw := string(s.backup()); strings.Contains(raw, "test-code") {
		t.Fatal("staging delivery wrote inventory")
	}
}
