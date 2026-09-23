// Package sessions exposes the windows of one tmux session. tmux is the source of
// truth: agents keep running when the browser closes, and the same windows stay
// reachable over ssh/mosh.
package sessions

import (
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// Window is one tmux window, which the UI shows as one agent tab.
type Window struct {
	ID       string `json:"id"` // tmux window id, e.g. "@3"
	Index    int    `json:"index"`
	Name     string `json:"name"`
	Active   bool   `json:"active"`
	Bell     bool   `json:"bell"`
	Activity bool   `json:"activity"`
	Silence  bool   `json:"silence"` // idle long enough that the agent is probably waiting on you
}

// Tmux drives one session on one server socket. Socket is a tmux -S path, so
// tests run a private server that disappears with their temp dir; Session is
// the group every browser tab attaches to.
type Tmux struct {
	Socket  string
	Session string
}

var (
	windowIDPattern = regexp.MustCompile(`^@[0-9]+$`)
	ErrBadWindowID  = errors.New("invalid window id")
	ErrBadName      = errors.New("invalid window name")
)

const listFormat = "#{window_id}\t#{window_index}\t#{window_active}\t#{window_bell_flag}\t#{window_activity_flag}\t#{window_silence_flag}\t#{window_name}"

func (t Tmux) run(args ...string) (string, error) {
	out, err := exec.Command("tmux", append([]string{"-S", t.Socket}, args...)...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("tmux %s: %w: %s", args[0], err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// Ensure creates the session if it does not exist yet.
func (t Tmux) Ensure() error {
	if _, err := t.run("has-session", "-t", "="+t.Session); err == nil {
		return nil
	}
	_, err := t.run("new-session", "-d", "-s", t.Session)
	return err
}

// List returns the session's windows in index order.
func (t Tmux) List() ([]Window, error) {
	out, err := t.run("list-windows", "-t", "="+t.Session, "-F", listFormat)
	if err != nil {
		return nil, err
	}
	return parseWindows(out), nil
}

func parseWindows(out string) []Window {
	windows := []Window{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.SplitN(line, "\t", 7)
		if len(f) != 7 {
			continue
		}
		var index int
		fmt.Sscan(f[1], &index)
		windows = append(windows, Window{
			ID: f[0], Index: index, Active: f[2] == "1",
			Bell: f[3] == "1", Activity: f[4] == "1", Silence: f[5] == "1", Name: f[6],
		})
	}
	return windows
}

// Create opens a new window running the user's shell and returns its id.
func (t Tmux) Create(name string) (string, error) {
	if err := validName(name); err != nil {
		return "", err
	}
	args := []string{"new-window", "-d", "-P", "-F", "#{window_id}", "-t", "=" + t.Session + ":"}
	if name != "" {
		args = append(args, "-n", name)
	}
	out, err := t.run(args...)
	return strings.TrimSpace(out), err
}

// Rename changes a window's name.
func (t Tmux) Rename(id, name string) error {
	if !windowIDPattern.MatchString(id) {
		return ErrBadWindowID
	}
	if err := validName(name); err != nil || name == "" {
		return ErrBadName
	}
	_, err := t.run("rename-window", "-t", id, name)
	return err
}

// Close kills a window and whatever runs in it.
func (t Tmux) Close(id string) error {
	if !windowIDPattern.MatchString(id) {
		return ErrBadWindowID
	}
	_, err := t.run("kill-window", "-t", id)
	return err
}

// AttachCommand returns the argv that attaches a fresh grouped client to one
// window. Each browser tab gets its own grouped session, so tabs can view
// different windows at once; destroy-unattached removes it when the tab closes.
// The status bar goes off in that session only: the page already lists the
// windows, and the line is worth more to the terminal. The user's own session,
// seen over ssh or mosh, keeps whatever it had.
func (t Tmux) AttachCommand(id string) ([]string, error) {
	if !windowIDPattern.MatchString(id) {
		return nil, ErrBadWindowID
	}
	return []string{
		"tmux", "-S", t.Socket,
		"new-session", "-t", "=" + t.Session,
		";", "set-option", "destroy-unattached", "on",
		";", "set-option", "status", "off",
		";", "select-window", "-t", id,
	}, nil
}

// Names are passed as argv, never through a shell, so the only real risks are
// control characters corrupting the terminal and absurd lengths.
func validName(name string) error {
	if len(name) > 64 {
		return ErrBadName
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return ErrBadName
		}
	}
	return nil
}
