package main

import (
	"strings"
	"testing"
)

func TestRenderUnitQuotesArgumentsForSystemd(t *testing.T) {
	unit := renderUnit("/home/u/go/bin/remotty", []string{"-origin", "https://a.ts.net,http://localhost:0", `we"ird %i`})
	want := `ExecStart=/home/u/go/bin/remotty serve "-origin" "https://a.ts.net,http://localhost:0" "we\"ird %%i"`
	if !strings.Contains(unit, want+"\n") {
		t.Fatalf("unit ExecStart wrong:\n%s\nwant line:\n%s", unit, want)
	}
	for _, line := range []string{"Restart=on-failure", "WantedBy=default.target"} {
		if !strings.Contains(unit, line) {
			t.Errorf("unit misses %q", line)
		}
	}
}

func TestRenderUnitWithoutFlags(t *testing.T) {
	if unit := renderUnit("/bin/remotty", nil); !strings.Contains(unit, "ExecStart=/bin/remotty serve \n") {
		t.Fatalf("unit without flags:\n%s", unit)
	}
}
