package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestOriginListResolvesPortZeroAndTrims(t *testing.T) {
	got := originList(" https://box.ts.net/ , http://localhost:0 ,", 7681)
	want := []string{"https://box.ts.net", "http://localhost:7681"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("originList = %v, want %v", got, want)
	}
}

func TestOriginListDefaultsToLocalhost(t *testing.T) {
	if got := originList("", 9000); !reflect.DeepEqual(got, []string{"http://localhost:9000"}) {
		t.Fatalf("default origins = %v", got)
	}
}

// Without tailscale on PATH, detection must fall back to localhost only, not fail.
func TestDetectOriginsWithoutTailscale(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if got := detectOrigins(); got != "http://localhost:0" {
		t.Fatalf("detectOrigins without tailscale = %q", got)
	}
}

func TestPairingLinkPutsTheCodeInTheFragment(t *testing.T) {
	dir := t.TempDir()
	if got := pairingLink(dir, "ABC"); got != "" {
		t.Fatalf("link before the server ran = %q, want none", got)
	}
	saveURL(dir, "https://box.ts.net")
	got := pairingLink(dir, "ABCDE12345")
	if got != "https://box.ts.net/#ABCDE12345" || strings.Contains(got, "?") {
		t.Fatalf("pairing link = %q", got)
	}
}
