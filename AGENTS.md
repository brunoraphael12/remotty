# Working on remotty

## The one command

```sh
./scripts/check.sh            # everything
./scripts/check.sh -g "30 agent"   # extra args go to Playwright
```

Green means: vet, unit tests, build, and every browser test passed against the real
binary. A change is not done until this is green. It needs `go`, `node` and `tmux`,
and no sudo: Playwright downloads its own Chromium.

## Layout is by feature

`features/<name>/` holds the Go side of a feature, `web/features/<name>.js` its UI,
`e2e/<name>.spec.js` its browser tests. A new feature gets the same three places.
`cmd/remotty` only wires them together.

## Rules

- **No request may leave the page's origin.** No CDN, font service, analytics or
  update check. The e2e `page` fixture fails any test that tries.
- **Never write untrusted text as HTML.** Window names and terminal titles are set
  by programs inside the terminal. Use `textContent`.
- **Every route but pairing goes through `RequireDevice`.** Every state change and
  every WebSocket goes through the Origin check in `Guard.Wrap`.
- **No new dependency** for what a few lines of stdlib do.

## Proving a test works

A security test counts only after you have seen it fail. Break the code it guards
(remove the check, loosen the cookie, inject a third-party script), run the test,
see it red, restore. A negative assertion ("was refused", "does not contain") also
needs a positive anchor next to it, so a dead server cannot pass it.

## Tests never touch the real world

The e2e fixture gives each test its own tmux socket, state dir, `HOME` and port.
Go tests use `t.TempDir()`. Keep it that way: a test that reads your real tmux
or `~/.local/state/remotty` is a bug.
