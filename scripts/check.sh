#!/usr/bin/env bash
# The one command that proves remotty works: unit tests, a build, and the
# browser end-to-end suite against the real binary. Exit code 0 means all green.
# Extra arguments go to Playwright, e.g. ./scripts/check.sh -g "30 agent".
set -euo pipefail
cd "$(dirname "$0")/.."

need() {
  command -v "$1" >/dev/null && return
  echo "check: '$1' not found. $2" >&2
  exit 127
}
need go   "Install Go $(sed -n 's/^go //p' go.mod)+ from https://go.dev/dl/ (a tarball in your home dir is enough, no sudo)."
need node "Install Node 20+ (nvm or a tarball, no sudo)."
need tmux "Install tmux 3.2+ with your package manager."

echo "== go vet + unit tests"
go vet ./...
go test ./... -count=1

echo "== build"
go build -o bin/remotty ./cmd/remotty

echo "== e2e"
cd e2e
[ -d node_modules ] || npm ci --silent
npx playwright install chromium >/dev/null
npx playwright test "$@"

echo "== all green"
