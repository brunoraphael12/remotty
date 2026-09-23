package main

import (
	"strings"
	"testing"

	"rsc.io/qr"
)

// The drawing must be the code: decode it back from the characters and compare
// module by module with what the encoder produced.
func TestTerminalQRDrawsEveryModule(t *testing.T) {
	const link = "https://box.tailnet.ts.net/#ABCDE12345"
	art, err := terminalQR(link)
	if err != nil {
		t.Fatal(err)
	}
	code, _ := qr.Encode(link, qr.M)
	rows := strings.Split(strings.TrimRight(art, "\n"), "\n")
	side := code.Size + 2*quietZone
	if len(rows) != (side+1)/2 {
		t.Fatalf("%d rows, want %d", len(rows), (side+1)/2)
	}
	for y := 0; y < side; y++ {
		line := []rune(rows[y/2])
		if len(line) != side {
			t.Fatalf("row %d has %d columns, want %d", y/2, len(line), side)
		}
		for x := 0; x < side; x++ {
			got := isDarkAt(line[x], y%2 == 0)
			qx, qy := x-quietZone, y-quietZone
			want := qx >= 0 && qy >= 0 && qx < code.Size && qy < code.Size && code.Black(qx, qy)
			if got != want {
				t.Fatalf("module (%d,%d): drawn dark=%v, code dark=%v", x, y, got, want)
			}
		}
	}
}

// isDarkAt reads one module back from a half-block character.
func isDarkAt(r rune, top bool) bool {
	switch r {
	case '█':
		return false
	case '▀':
		return !top
	case '▄':
		return top
	default:
		return true
	}
}

func TestTerminalQRHasALightBorder(t *testing.T) {
	art, _ := terminalQR("https://x.test/#A")
	rows := strings.Split(strings.TrimRight(art, "\n"), "\n")
	if strings.Trim(rows[0], "█") != "" {
		t.Fatalf("first row is not all light: %q", rows[0])
	}
	for _, row := range rows {
		r := []rune(row)
		if (r[0] != '█' && r[0] != '▀' && r[0] != '▄') || r[0] == ' ' {
			t.Fatalf("left edge is dark: %q", row)
		}
	}
}
