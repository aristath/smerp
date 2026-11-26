package mobile

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStandaloneWorkshop(t *testing.T) {
	directory := t.TempDir()
	launch, err := Start(directory, "Pacific/Kiritimati", 14*3600)
	if err != nil {
		t.Fatal(err)
	}
	defer Stop()
	again, err := Start(directory, "Pacific/Kiritimati", 14*3600)
	if err != nil || again != launch {
		t.Fatal("activity recreation started another server", err)
	}
	if _, offset := time.Now().Zone(); offset != 14*3600 {
		t.Fatal("ignored phone time zone")
	}
	parsed, _ := url.Parse(launch)
	origin := "http://" + parsed.Host
	response, err := http.Get(origin + "/backup")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("another app can read the workshop")
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 5 * time.Second}
	get := func(path string) string {
		t.Helper()
		response, err := client.Get(path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != 200 {
			t.Fatalf("GET %s: status=%d error=%v", path, response.StatusCode, err)
		}
		return string(raw)
	}
	if !strings.Contains(get(launch), "Workspace") {
		t.Fatal("did not load the interface")
	}
	var revision struct{ Revision string }
	if err := json.Unmarshal([]byte(get(origin+"/api/revision")), &revision); err != nil {
		t.Fatal(err)
	}
	fields := url.Values{"revision": {revision.Revision}, "title": {"Android workshop"}, "subtitle": {"Offline"}, "hourlyRate": {"18"}, "currency": {"EUR"}, "returnTo": {"/"}}
	request, _ := http.NewRequest("POST", origin+"/settings", strings.NewReader(fields.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "https://unrelated.example")
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("accepted foreign page mutation")
	}
	response, err = client.PostForm(origin+"/settings", fields)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	backup := get(origin + "/backup")
	if !strings.Contains(backup, "Android workshop") {
		t.Fatal("settings did not save")
	}
	raw, err := os.ReadFile(filepath.Join(directory, "workshop.json"))
	if err != nil || !strings.Contains(string(raw), "Android workshop") {
		t.Fatal("workshop was not saved on the device", err)
	}
	if err := Stop(); err != nil {
		t.Fatal(err)
	}
	next, err := Start(directory, "Pacific/Kiritimati", 14*3600)
	if err != nil {
		t.Fatal(err)
	}
	if next == launch {
		t.Fatal("reused a previous process's launch secret")
	}
	if !strings.Contains(get(next), "Android workshop") {
		t.Fatal("restart lost saved workshop")
	}
}
