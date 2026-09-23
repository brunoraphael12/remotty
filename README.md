# remotty

Your tmux windows in a browser tab. Built to run 20–30 coding agents on a home
machine and drive them from a tablet while travelling.

- **One binary, no runtime.** Go, with the UI embedded. Nothing is fetched at runtime.
- **Nothing phones home.** No analytics, no telemetry, no auto-update, no third-party
  origin in the page. A test fails if the page ever makes such a request.
- **tmux is the source of truth.** Close the browser and the agents keep running. The
  same windows are one `tmux attach` away over ssh or mosh.
- **Reachable only where you put it.** It listens on loopback; you publish it on your
  private tailnet with `tailscale serve`.

## Quick start

Requires Linux or WSL2, tmux 3.2+, and [Go](https://go.dev/dl/) 1.24+ to build.

```sh
go install github.com/pablowinck/remotty/cmd/remotty@latest
remotty serve
```

Publish it on your tailnet (HTTPS, private to your devices), and tell remotty the
origin it is served from:

```sh
tailscale serve --bg 7681
remotty serve -origin https://<machine>.<tailnet>.ts.net
```

The first `tailscale serve` asks you to enable Serve for your tailnet in the admin
console; that is a one-time click.

Pair a device: run `remotty pair` on the host, open the URL on the tablet, type the
code. It is valid for five minutes and works once.

```sh
remotty pair        # one-time code
remotty devices     # what is paired
remotty revoke ID   # unpair; its open terminals close within a second
```

## Using it

- The left column lists every window of the tmux session `main`. A red dot is a
  bell, amber means the window has been silent for a while (an agent waiting on
  you, if you set `monitor-silence` in tmux), blue is fresh output.
- `+` opens a window. Double-tap a tab to rename it; `×` closes it.
- The bottom bar has the keys a tablet keyboard lacks: Esc, Tab, a sticky Ctrl,
  arrows, ^C and paste.
- Install it as an app from the browser menu for full screen.

## Security model

The host usually holds credentials worth more than the terminal itself, so access
is deliberately narrow:

| Threat | Mitigation |
|---|---|
| Anyone on the LAN or the Windows side of WSL | Listens on `127.0.0.1` only, and every route but pairing requires a paired device anyway |
| Guessing the pairing code | 50-bit one-time code, 5-minute lifetime, burnt after five wrong tries |
| Stolen or leaked device | `remotty revoke` drops it and closes its live terminals |
| A malicious site you visit (CSRF, WebSocket hijacking) | Exact `Origin` allowlist on every write and every WebSocket; `SameSite=Strict` cookie |
| DNS rebinding | `Host` allowlist; anything else gets 421 |
| Injected script via terminal output or window names | Names rendered with `textContent`; enforced CSP with `script-src 'self'` |
| Supply chain | Two Go dependencies, xterm.js vendored with its license, no build step |

Only hashes of the pairing code and device tokens are stored, in
`~/.local/state/remotty` with mode 0600. The CSP allows `'unsafe-inline'` for
styles only, because xterm.js injects a `<style>` element.

## Development

```sh
./scripts/check.sh
```

That is the whole gate: `go vet`, unit tests, a build, and a Playwright suite that
drives the real binary in a tablet-sized Chromium against a private tmux server.
It never touches your own tmux or credentials. See [AGENTS.md](AGENTS.md) for the
conventions.

```
cmd/remotty/        the binary: CLI and HTTP wiring
features/access/    pairing, device cookies, the security guard
features/sessions/  tmux windows
features/terminal/  WebSocket <-> PTY bridge
web/                the UI (plain ES modules, embedded into the binary)
web/features/       UI code for the same three features
e2e/                browser tests
```

## License

MIT. xterm.js is MIT, see `web/vendor/xterm/LICENSE`.
