package terminal

import (
	"context"
	"sort"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// TestKeystrokeEchoLatency measures one key's round trip through the bridge:
// browser -> WebSocket -> PTY -> shell echo -> PTY -> WebSocket -> browser.
// This is the host's share of typing latency; the network adds the rest.
func TestKeystrokeEchoLatency(t *testing.T) {
	conn := startBridge(t, []string{"cat"}) // cat in a PTY echoes each byte back
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const n = 200
	samples := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		if err := conn.Write(ctx, websocket.MessageBinary, []byte{'a'}); err != nil {
			t.Fatal(err)
		}
		if _, _, err := conn.Read(ctx); err != nil {
			t.Fatal(err)
		}
		samples = append(samples, time.Since(start))
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	p50, p99 := samples[n/2], samples[n*99/100]
	t.Logf("echo round trip over %d keys: p50=%v p99=%v", n, p50, p99)
	// Generous ceiling: this guards against a regression like buffering output
	// on a timer, not against a slow CI machine.
	if p99 > 20*time.Millisecond {
		t.Fatalf("p99 %v: the host adds noticeable typing lag", p99)
	}
}
