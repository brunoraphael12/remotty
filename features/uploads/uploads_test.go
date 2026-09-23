package uploads

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSaveKeepsContentInAPrivateFile(t *testing.T) {
	d := Dir(filepath.Join(t.TempDir(), "uploads"))
	path, err := d.Save("foto do erro.png", strings.NewReader("PNGDATA"))
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(path); string(got) != "PNGDATA" {
		t.Fatalf("content = %q", got)
	}
	if !strings.HasSuffix(path, "foto_do_erro.png") {
		t.Errorf("name %q lost the original hint", filepath.Base(path))
	}
	info, _ := os.Stat(path)
	dir, _ := os.Stat(string(d))
	if info.Mode().Perm() != 0o600 || dir.Mode().Perm() != 0o700 {
		t.Errorf("file %v, dir %v: want 0600 and 0700", info.Mode().Perm(), dir.Mode().Perm())
	}
}

// The name comes from the browser: it must never pick where the file lands.
func TestHostileNamesStayInsideTheDirectory(t *testing.T) {
	d := Dir(filepath.Join(t.TempDir(), "uploads"))
	for _, name := range []string{"../../.bashrc", `..\..\x`, "/etc/passwd", "a/../../b", "..", "", "\x00evil", "$(rm -rf ~).png", "`id`.txt", "a b'c\"d;e.png"} {
		path, err := d.Save(name, strings.NewReader("x"))
		if err != nil {
			t.Fatalf("Save(%q): %v", name, err)
		}
		if filepath.Dir(path) != string(d) {
			t.Errorf("Save(%q) wrote to %q, outside %q", name, path, d)
		}
		if base := filepath.Base(path); strings.ContainsAny(base, "$`'\"; /\\\x00") {
			t.Errorf("Save(%q) kept a shell-significant character: %q", name, base)
		}
	}
}

func TestSameNameTwiceKeepsBothFiles(t *testing.T) {
	d := Dir(filepath.Join(t.TempDir(), "uploads"))
	a, _ := d.Save("x.png", strings.NewReader("first"))
	b, _ := d.Save("x.png", strings.NewReader("second"))
	if a == b {
		t.Fatal("second upload reused the first path")
	}
	if got, _ := os.ReadFile(a); string(got) != "first" {
		t.Fatal("second upload overwrote the first")
	}
}

func TestFileNameIsBounded(t *testing.T) {
	name := fileName(strings.Repeat("a", 300)+".jpeg", time.Now())
	if len(name) > 90 || !strings.HasSuffix(name, ".jpeg") {
		t.Fatalf("fileName = %q (%d chars)", name, len(name))
	}
}

func upload(h http.Handler, name string, body []byte) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/api/uploads?name="+name, bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestHTTPUploadReturnsThePath(t *testing.T) {
	d := Dir(filepath.Join(t.TempDir(), "uploads"))
	mux := http.NewServeMux()
	d.Routes(mux, func(h http.HandlerFunc) http.HandlerFunc { return h })
	w := upload(mux, "print.png", []byte("img"))
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var resp struct{ Path string }
	json.NewDecoder(w.Body).Decode(&resp)
	if got, _ := os.ReadFile(resp.Path); string(got) != "img" {
		t.Fatalf("returned path %q does not hold the upload", resp.Path)
	}
}

func TestOversizedUploadIsRefusedAndLeavesNothing(t *testing.T) {
	d := Dir(filepath.Join(t.TempDir(), "uploads"))
	mux := http.NewServeMux()
	d.Routes(mux, func(h http.HandlerFunc) http.HandlerFunc { return h })
	w := upload(mux, "big.bin", make([]byte, MaxBytes+1))
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized upload got %d, want 413", w.Code)
	}
	entries, _ := os.ReadDir(string(d))
	if len(entries) != 0 {
		t.Fatalf("a refused upload left %d file(s) behind", len(entries))
	}
	if w := upload(mux, "ok.bin", make([]byte, 1024)); w.Code != http.StatusCreated {
		t.Fatalf("anchor: a normal upload after the refusal got %d", w.Code)
	}
}
