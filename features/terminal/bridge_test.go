package terminal

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// startBridge serves argv over a real WebSocket and returns a connected client.
func startBridge(t *testing.T, argv []string) *websocket.Conn {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		Serve(r.Context(), conn, argv, os.Environ())
	}))
	t.Cleanup(srv.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	return conn
}

// readUntil collects terminal output until it contains want or the deadline passes.
func readUntil(t *testing.T, conn *websocket.Conn, want string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var got strings.Builder
	for !strings.Contains(got.String(), want) {
		_, msg, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("waiting for %q, got %q: %v", want, got.String(), err)
		}
		got.Write(msg)
	}
	return got.String()
}

func TestKeystrokesReachThePTYAndOutputComesBack(t *testing.T) {
	conn := startBridge(t, []string{"bash", "--norc", "--noprofile"})
	ctx := context.Background()
	if err := conn.Write(ctx, websocket.MessageBinary, []byte("echo resultado-$((6*7))\r")); err != nil {
		t.Fatal(err)
	}
	// The echoed command line holds "resultado-$((6*7))", so only the evaluated text proves it ran.
	readUntil(t, conn, "resultado-42")
}

func TestResizeChangesThePTYSize(t *testing.T) {
	conn := startBridge(t, []string{"bash", "--norc", "--noprofile"})
	ctx := context.Background()
	conn.Write(ctx, websocket.MessageText, []byte(`{"type":"resize","cols":123,"rows":45}`))
	conn.Write(ctx, websocket.MessageBinary, []byte("stty size\r"))
	readUntil(t, conn, "45 123")
}

func TestInvalidResizeIsIgnored(t *testing.T) {
	conn := startBridge(t, []string{"bash", "--norc", "--noprofile"})
	ctx := context.Background()
	for _, bad := range []string{`{"type":"resize","cols":0,"rows":0}`, `{"type":"resize","cols":5000,"rows":10}`, `not json`} {
		conn.Write(ctx, websocket.MessageText, []byte(bad))
	}
	conn.Write(ctx, websocket.MessageBinary, []byte("stty size\r"))
	readUntil(t, conn, "24 80")
}

func TestProcessExitClosesTheSocket(t *testing.T) {
	conn := startBridge(t, []string{"bash", "-c", "echo bye"})
	readUntil(t, conn, "bye")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		if _, _, err := conn.Read(ctx); err != nil {
			if ctx.Err() != nil {
				t.Fatal("socket still open after the process exited")
			}
			return
		}
	}
}
