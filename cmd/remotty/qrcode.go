package main

import (
	"strings"

	"rsc.io/qr"
)

// quietZone is the blank border QR readers need around the code (4 modules
// by the spec; 2 is enough for phone cameras and keeps the code small).
const quietZone = 2

// terminalQR draws text as a QR code with Unicode half blocks: each character
// holds two modules stacked vertically, so the code looks square in a
// terminal. Dark modules print as spaces on a light background drawn with the
// block characters, which reads correctly on dark and light terminal themes.
func terminalQR(text string) (string, error) {
	code, err := qr.Encode(text, qr.M)
	if err != nil {
		return "", err
	}
	dark := func(x, y int) bool {
		x, y = x-quietZone, y-quietZone
		return x >= 0 && y >= 0 && x < code.Size && y < code.Size && code.Black(x, y)
	}
	side := code.Size + 2*quietZone
	var b strings.Builder
	for y := 0; y < side; y += 2 {
		for x := 0; x < side; x++ {
			b.WriteString(halfBlock(!dark(x, y), !dark(x, y+1)))
		}
		b.WriteByte('\n')
	}
	return b.String(), nil
}

// halfBlock paints the light parts: top, bottom, both or neither.
func halfBlock(topLight, bottomLight bool) string {
	switch {
	case topLight && bottomLight:
		return "█"
	case topLight:
		return "▀"
	case bottomLight:
		return "▄"
	default:
		return " "
	}
}
