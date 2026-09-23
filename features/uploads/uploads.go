// Package uploads receives files from the browser (a photo, a screenshot, a
// PDF) and saves them on the host, so their path can be handed to an agent in
// the terminal. The file never goes anywhere else.
package uploads

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// MaxBytes caps one upload. Phone photos are a few MB; this leaves room for a
// PDF without letting a client fill the disk in one request.
const MaxBytes = 50 << 20

// Dir is where uploads land. Files are private to the user (0600 in a 0700 dir).
type Dir string

var unsafeChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// Routes registers POST /api/uploads behind wrap (authentication).
func (d Dir) Routes(mux *http.ServeMux, wrap func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("POST /api/uploads", wrap(d.handleUpload))
}

func (d Dir) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxBytes)
	path, err := d.Save(r.URL.Query().Get("name"), r.Body)
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		http.Error(w, fmt.Sprintf("file larger than %d MB", MaxBytes>>20), http.StatusRequestEntityTooLarge)
	case err != nil:
		http.Error(w, "could not save the file", http.StatusInternalServerError)
	default:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"path": path})
	}
}

// Save writes body under d with a name derived from the original one. The
// original name is only a hint: it is reduced to safe characters and prefixed
// with a timestamp and random bits, so it can neither escape the directory nor
// overwrite an earlier upload.
func (d Dir) Save(original string, body io.Reader) (string, error) {
	if err := os.MkdirAll(string(d), 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(string(d), fileName(original, time.Now()))
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(f, body); err != nil {
		f.Close()
		os.Remove(path) // never leave half a file behind
		return "", err
	}
	return path, f.Close()
}

func fileName(original string, now time.Time) string {
	base := filepath.Base(strings.ReplaceAll(original, `\`, "/"))
	base = strings.Trim(unsafeChars.ReplaceAllString(base, "_"), "._")
	if len(base) > 60 {
		ext := filepath.Ext(base)
		base = base[:60-len(ext)] + ext
	}
	if base == "" {
		base = "file"
	}
	return fmt.Sprintf("%s-%s-%s", now.Format("20060102-150405"), rand.Text()[:4], base)
}
