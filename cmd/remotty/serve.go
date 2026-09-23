package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/pablowinck/remotty/features/access"
	"github.com/pablowinck/remotty/features/sessions"
	"github.com/pablowinck/remotty/features/terminal"
	"github.com/pablowinck/remotty/web"
)

func serve(args []string, store access.Store) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	addr := fs.String("addr", "127.0.0.1:7681", "listen address; keep it on loopback and publish with `tailscale serve`")
	origins := fs.String("origin", "", "comma-separated origins the UI is served from, e.g. https://box.tailnet.ts.net (default: https://localhost:PORT)")
	socket := fs.String("tmux-socket", "", "tmux socket path (default: tmux's own default socket)")
	session := fs.String("session", "main", "tmux session whose windows become tabs")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if host, _, err := net.SplitHostPort(*addr); err == nil && !isLoopback(host) {
		log.Printf("warning: listening on %s, not loopback. Anyone who can reach it only needs a pairing code.", host)
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	allowed := originList(*origins, ln.Addr().(*net.TCPAddr).Port)
	tm := sessions.Tmux{Socket: tmuxSocket(*socket), Session: *session}
	if err := tm.Ensure(); err != nil {
		return fmt.Errorf("tmux: %w", err)
	}

	guard := access.Guard{Store: store, Origins: allowed}
	srv := &http.Server{Handler: guard.Wrap(routes(guard, tm)), ReadHeaderTimeout: 10 * time.Second}
	// Scripts and tests read this line to learn the port when -addr ends in :0.
	fmt.Printf("remotty listening on http://%s (origins: %s)\n", ln.Addr(), strings.Join(allowed, ", "))
	return runUntilSignal(srv, ln)
}

func routes(guard access.Guard, tm sessions.Tmux) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /", web.Handler())
	mux.HandleFunc("POST /api/pair", guard.HandlePair)
	mux.HandleFunc("GET /api/me", guard.RequireDevice(access.HandleMe))
	mux.HandleFunc("GET /api/windows", guard.RequireDevice(listWindows(tm)))
	mux.HandleFunc("POST /api/windows", guard.RequireDevice(createWindow(tm)))
	mux.HandleFunc("PATCH /api/windows/{id}", guard.RequireDevice(renameWindow(tm)))
	mux.HandleFunc("DELETE /api/windows/{id}", guard.RequireDevice(closeWindow(tm)))
	mux.HandleFunc("GET /api/windows/{id}/tty", guard.RequireDevice(attach(tm)))
	return mux
}

func listWindows(tm sessions.Tmux) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := tm.List()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, list)
	}
}

type windowName struct {
	Name string `json:"name"`
}

func createWindow(tm sessions.Tmux) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req windowName
		if !decode(w, r, &req) {
			return
		}
		id, err := tm.Create(req.Name)
		if !respond(w, err) {
			return
		}
		w.WriteHeader(http.StatusCreated)
		writeJSON(w, map[string]string{"id": id})
	}
}

func renameWindow(tm sessions.Tmux) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req windowName
		if !decode(w, r, &req) {
			return
		}
		if respond(w, tm.Rename(r.PathValue("id"), req.Name)) {
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

func closeWindow(tm sessions.Tmux) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if respond(w, tm.Close(r.PathValue("id"))) {
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

func attach(tm sessions.Tmux) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		argv, err := tm.AttachCommand(r.PathValue("id"))
		if !respond(w, err) {
			return
		}
		// Origin was already checked by the guard against the exact allowlist;
		// the library's own same-host check would wrongly reject the tailnet name.
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		terminal.Serve(r.Context(), conn, argv, terminalEnv())
	}
}

// terminalEnv gives tmux a sane terminal type; everything else is inherited.
func terminalEnv() []string {
	env := []string{"TERM=xterm-256color", "COLORTERM=truecolor"}
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "TERM=") && !strings.HasPrefix(kv, "COLORTERM=") && !strings.HasPrefix(kv, "TMUX=") {
			env = append(env, kv)
		}
	}
	return env
}

// respond maps domain errors to HTTP. It returns false when it wrote an error.
func respond(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, sessions.ErrBadWindowID), errors.Is(err, sessions.ErrBadName):
		http.Error(w, err.Error(), http.StatusBadRequest)
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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// originList parses -origin. A ":0" port means "the port we actually bound",
// which lets scripts ask for a random port and still name the origin up front.
func originList(flagValue string, port int) []string {
	if flagValue == "" {
		flagValue = "https://localhost:0"
	}
	var list []string
	for _, o := range strings.Split(flagValue, ",") {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if strings.HasSuffix(o, ":0") {
			o = fmt.Sprintf("%s:%d", strings.TrimSuffix(o, ":0"), port)
		}
		if o != "" {
			list = append(list, o)
		}
	}
	return list
}

// tmuxSocket resolves tmux's default socket so the browser sees the same
// windows as a plain `tmux attach` over ssh or mosh.
func tmuxSocket(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	dir := os.Getenv("TMUX_TMPDIR")
	if dir == "" {
		dir = "/tmp"
	}
	return fmt.Sprintf("%s/tmux-%d/default", dir, os.Getuid())
}

func isLoopback(host string) bool {
	ip := net.ParseIP(host)
	return host == "localhost" || (ip != nil && ip.IsLoopback())
}

func runUntilSignal(srv *http.Server, ln net.Listener) error {
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errc:
		return err
	case <-sig:
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(ctx)
	}
}
