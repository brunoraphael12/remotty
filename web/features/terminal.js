// One xterm.js instance wired to one window's WebSocket at a time. Only the
// visible window holds a socket, so 30 agents cost the tablet one terminal.
import { Terminal } from '/lib/xterm/xterm.mjs';
import { FitAddon } from '/lib/xterm/addon-fit.mjs';

// Retry fast after a blip, then back off so a host that is down (or a tablet
// that lost signal) is not hammered. Reset on every successful connection.
const RETRY_MS = [500, 1000, 2000, 4000, 8000];

export function createTerminal({ onStatus }) {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, monospace',
    fontSize: 14,
    scrollback: 5000,
    theme: { background: '#101418' },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('terminal'));

  let socket = null;
  let windowId = null;
  let failures = 0;
  let ctrlArmed = false;
  const encoder = new TextEncoder();

  function send(text) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (ctrlArmed && text.length === 1) {
      text = ctrlOf(text);
      setCtrl(false);
    }
    socket.send(encoder.encode(text));
  }

  function sendResize() {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  function connect(id) {
    socket?.close();
    windowId = id;
    term.reset();
    if (!id) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/windows/${encodeURIComponent(id)}/tty`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      failures = 0;
      onStatus('');
      fit.fit();
      sendResize();
      term.focus();
    };
    ws.onmessage = (e) => term.write(new Uint8Array(e.data));
    ws.onclose = () => {
      if (socket !== ws || windowId !== id) return; // superseded by another window
      onStatus('Reconnecting…');
      const wait = RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)];
      setTimeout(() => windowId === id && connect(id), wait);
    };
    socket = ws;
  }

  function setCtrl(on) {
    ctrlArmed = on;
    document.querySelector('[data-mod="ctrl"]').setAttribute('aria-pressed', String(on));
  }

  term.onData(send);
  term.onBinary((data) => socket?.readyState === WebSocket.OPEN && socket.send(Uint8Array.from(data, (c) => c.charCodeAt(0))));
  term.onResize(sendResize);
  new ResizeObserver(() => fit.fit()).observe(document.getElementById('stage'));

  wireKeyBar({ send, toggleCtrl: () => setCtrl(!ctrlArmed), focus: () => term.focus(), onStatus });

  return { connect, get windowId() { return windowId; } };
}

const KEYS = {
  esc: '\x1b', tab: '\t', enter: '\r', 'ctrl-c': '\x03',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
};

// On-screen keys for what a tablet keyboard lacks. Buttons don't steal focus,
// so the soft keyboard stays up while you tap them.
function wireKeyBar({ send, toggleCtrl, focus, onStatus }) {
  const bar = document.getElementById('keys');
  bar.addEventListener('pointerdown', (e) => e.preventDefault());
  bar.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.key) send(KEYS[b.dataset.key]);
    if (b.dataset.mod === 'ctrl') toggleCtrl();
    if (b.dataset.action === 'paste') {
      try {
        send(await navigator.clipboard.readText());
      } catch {
        onStatus('Clipboard needs HTTPS and permission');
      }
    }
    focus();
  });
}

// Ctrl+letter is the letter's code minus 64: Ctrl+C = 0x03.
export function ctrlOf(ch) {
  const c = ch.toUpperCase().charCodeAt(0);
  return c >= 64 && c <= 95 ? String.fromCharCode(c - 64) : ch;
}
