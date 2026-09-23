// Package terminal bridges one browser WebSocket to one PTY running a command.
//
// Wire format: binary frames are raw terminal bytes in both directions. Text
// frames from the browser are control messages; today the only one is
// {"type":"resize","cols":N,"rows":N}.
package terminal

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"time"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

// maxFrame caps a single browser message. Keystrokes and pastes are small; this
// only stops a client from making the host buffer unbounded memory.
const maxFrame = 1 << 20

// keepalive is how often the host pings the browser. A client that misses one
// is dropped, so a tablet that lost signal without closing does not keep a PTY
// and a tmux client alive. The TCP peer is tailscaled on loopback, so TCP
// keepalives never notice.
var keepalive = 30 * time.Second

type control struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// Serve runs argv in a PTY and pumps bytes between it and conn until either
// side ends. It owns conn and closes it before returning.
func Serve(ctx context.Context, conn *websocket.Conn, argv []string, env []string) error {
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = env
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 80, Rows: 24})
	if err != nil {
		conn.Close(websocket.StatusInternalError, "could not start terminal")
		return err
	}
	defer func() {
		ptmx.Close()
		// Killing the client is safe: tmux keeps the window alive without it.
		cmd.Process.Kill()
		cmd.Wait()
	}()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	conn.SetReadLimit(maxFrame)

	go func() {
		defer cancel()
		pumpOutput(ctx, conn, ptmx)
	}()
	go func() {
		defer cancel()
		ping(ctx, conn)
	}()
	err = pumpInput(ctx, conn, ptmx)
	conn.Close(websocket.StatusNormalClosure, "")
	return err
}

// ping returns when the client stops answering, which cancels the session.
// The pong is read by pumpInput's conn.Read, as coder/websocket requires.
func ping(ctx context.Context, conn *websocket.Conn) {
	t := time.NewTicker(keepalive)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			pctx, cancel := context.WithTimeout(ctx, keepalive)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

// pumpOutput sends everything the PTY prints to the browser.
func pumpOutput(ctx context.Context, conn *websocket.Conn, ptmx *os.File) {
	buf := make([]byte, 32*1024)
	for {
		n, err := ptmx.Read(buf)
		if n > 0 {
			if werr := conn.Write(ctx, websocket.MessageBinary, buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

// pumpInput applies browser messages to the PTY: keystrokes or resizes.
func pumpInput(ctx context.Context, conn *websocket.Conn, ptmx *os.File) error {
	for {
		typ, msg, err := conn.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure || errors.Is(err, context.Canceled) {
				return nil
			}
			return err
		}
		if typ == websocket.MessageBinary {
			if _, err := ptmx.Write(msg); err != nil {
				return err
			}
			continue
		}
		applyControl(ptmx, msg)
	}
}

func applyControl(ptmx *os.File, msg []byte) {
	var c control
	if json.Unmarshal(msg, &c) != nil || c.Type != "resize" {
		return
	}
	// A zero or absurd size would make tmux reflow into garbage; ignore it.
	if c.Cols == 0 || c.Rows == 0 || c.Cols > 1000 || c.Rows > 1000 {
		return
	}
	pty.Setsize(ptmx, &pty.Winsize{Cols: c.Cols, Rows: c.Rows})
}
