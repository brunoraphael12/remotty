package sessions

import (
	"encoding/json"
	"errors"
	"net/http"
)

// Routes registers the window API on mux. wrap applies authentication to each
// route; attach serves the terminal WebSocket for one window's argv.
func (t Tmux) Routes(mux *http.ServeMux, wrap func(http.HandlerFunc) http.HandlerFunc, attach func(w http.ResponseWriter, r *http.Request, argv []string)) {
	mux.HandleFunc("GET /api/windows", wrap(t.handleList))
	mux.HandleFunc("POST /api/windows", wrap(t.handleCreate))
	mux.HandleFunc("PATCH /api/windows/{id}", wrap(t.handleRename))
	mux.HandleFunc("DELETE /api/windows/{id}", wrap(t.handleClose))
	mux.HandleFunc("GET /api/windows/{id}/tty", wrap(func(w http.ResponseWriter, r *http.Request) {
		argv, err := t.AttachCommand(r.PathValue("id"))
		if respond(w, err) {
			attach(w, r, argv)
		}
	}))
}

func (t Tmux) handleList(w http.ResponseWriter, r *http.Request) {
	list, err := t.List()
	if respond(w, err) {
		writeJSON(w, http.StatusOK, list)
	}
}

type nameBody struct {
	Name string `json:"name"`
}

func (t Tmux) handleCreate(w http.ResponseWriter, r *http.Request) {
	var req nameBody
	if !decode(w, r, &req) {
		return
	}
	id, err := t.Create(req.Name)
	if respond(w, err) {
		writeJSON(w, http.StatusCreated, map[string]string{"id": id})
	}
}

func (t Tmux) handleRename(w http.ResponseWriter, r *http.Request) {
	var req nameBody
	if decode(w, r, &req) && respond(w, t.Rename(r.PathValue("id"), req.Name)) {
		w.WriteHeader(http.StatusNoContent)
	}
}

func (t Tmux) handleClose(w http.ResponseWriter, r *http.Request) {
	if respond(w, t.Close(r.PathValue("id"))) {
		w.WriteHeader(http.StatusNoContent)
	}
}

// respond maps domain errors to HTTP. It returns false when it wrote an error.
func respond(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, ErrBadWindowID), errors.Is(err, ErrBadName):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, ErrNoWindow):
		http.Error(w, err.Error(), http.StatusNotFound)
	default:
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
	return false
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(v); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
