package sessions

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fakeClaude lays out a ~/.claude with one transcript per id, each recording dir as its cwd.
func fakeClaude(t *testing.T, dir string, ids ...string) string {
	t.Helper()
	home := t.TempDir()
	proj := filepath.Join(home, "projects", "-some-project")
	os.MkdirAll(proj, 0o700)
	os.MkdirAll(filepath.Join(home, "sessions"), 0o700)
	for _, id := range ids {
		body := `{"type":"user","cwd":"` + dir + `"}` + "\n" + `{"type":"custom-title","customTitle":"titulo-` + id[:4] + `"}` + "\n"
		os.WriteFile(filepath.Join(proj, id+".jsonl"), []byte(body), 0o600)
	}
	return home
}

const (
	idA = "aaaaaaaa-1111-2222-3333-444444444444"
	idB = "bbbbbbbb-1111-2222-3333-444444444444"
)

func TestRestoreReopensStoppedConversationsInTheirDirectory(t *testing.T) {
	tm := newTestTmux(t)
	work := t.TempDir()
	home := fakeClaude(t, work, idA, idB)
	// idB is held by a live process: this test's own pid, with its real start time.
	reg := `{"pid":` + strconv.Itoa(os.Getpid()) + `,"sessionId":"` + idB + `","procStart":"` + procStart(os.Getpid()) + `"}`
	os.WriteFile(filepath.Join(home, "sessions", "1.json"), []byte(reg), 0o600)
	t.Setenv("SHELL", "/bin/sh")

	r := NewRestorer(tm, home, "echo reaberto")
	opened, err := r.Restore(time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if len(opened) != 1 || opened[0].ID != idA {
		t.Fatalf("want only %s reopened, got %+v", idA, opened)
	}
	w := findWindow(t, tm, "titulo-aaaa")
	var out string
	for i := 0; i < 50 && !strings.Contains(out, "reaberto "+idA); i++ {
		time.Sleep(50 * time.Millisecond)
		out, _ = tm.run("capture-pane", "-p", "-t", w)
	}
	if !strings.Contains(out, "reaberto "+idA) {
		t.Fatalf("the window did not run the command with the id:\n%s", out)
	}
	cwd, _ := tm.run("display-message", "-p", "-t", w, "#{pane_current_path}")
	if strings.TrimSpace(cwd) != work {
		t.Fatalf("window opened in %q, want %q", strings.TrimSpace(cwd), work)
	}

	// A second tap right away must not open the same conversation twice.
	again, err := r.Restore(time.Hour)
	if err != nil || len(again) != 0 {
		t.Fatalf("second restore reopened %+v (%v)", again, err)
	}
}

func TestRestoreSkipsOldTranscriptsAndBadIDs(t *testing.T) {
	tm := newTestTmux(t)
	work := t.TempDir()
	home := fakeClaude(t, work, idA, "not-a-uuid-and-could-be-a-command;x")
	old := time.Now().Add(-3 * time.Hour)
	os.Chtimes(filepath.Join(home, "projects", "-some-project", idA+".jsonl"), old, old)

	list, err := Claude{Home: home}.Stopped(time.Now().Add(-time.Hour))
	if err != nil || len(list) != 0 {
		t.Fatalf("want nothing to restore, got %+v (%v)", list, err)
	}
	// Anchor: the same transcript counts when the window reaches back far enough.
	if list, _ := (Claude{Home: home}).Stopped(old.Add(-time.Minute)); len(list) != 1 || list[0].ID != idA {
		t.Fatalf("an old transcript inside the window was not found: %+v", list)
	}
	_ = tm
}

func findWindow(t *testing.T, tm Tmux, name string) string {
	t.Helper()
	windows, _ := tm.List()
	for _, w := range windows {
		if w.Name == name {
			return w.ID
		}
	}
	t.Fatalf("no window named %q in %+v", name, windows)
	return ""
}
