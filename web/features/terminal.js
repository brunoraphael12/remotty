// One xterm.js instance wired to one window's WebSocket at a time. Only the
// visible window holds a socket, so 30 agents cost the tablet one terminal.
import { Terminal } from '/lib/xterm/xterm.mjs';
import { FitAddon } from '/lib/xterm/addon-fit.mjs';
import { wireUploads } from './uploads.js';

// Retry fast after a blip, then back off so a host that is down (or a tablet
// that lost signal) is not hammered. Reset on every successful connection.
const RETRY_MS = [500, 1000, 2000, 4000, 8000];

export function createTerminal({ onStatus, isShortcut = () => false }) {
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
  wireClipboard(term);

  let socket = null;
  let windowId = null;
  let failures = 0;
  let ctrlArmed = false;
  // Keys typed while the socket is still connecting (a slow tailnet handshake,
  // a reconnect) wait here and go out in order once it opens.
  let pending = [];
  const encoder = new TextEncoder();

  function send(text) {
    if (ctrlArmed && text.length === 1) {
      text = ctrlOf(text);
      setCtrl(false);
    }
    sendBytes(encoder.encode(text));
  }

  function sendBytes(bytes) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(bytes);
    else if (socket) pending.push(bytes);
  }

  function sendResize() {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  // Last screen of each window, kept in memory. On a switch it is painted at
  // once, so the page shows the agent instead of a blank terminal until tmux
  // redraws; tmux's redraw then replaces it. Text only, capped, never stored.
  const screens = new Map();
  const SCREENS_MAX = 40;

  function remember() {
    if (!windowId) return;
    const lines = [];
    const buf = term.buffer.active;
    for (let y = 0; y < term.rows; y++) lines.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '');
    screens.delete(windowId); // re-insert: the Map keeps the most recent last
    screens.set(windowId, lines.join('\r\n'));
    if (screens.size > SCREENS_MAX) screens.delete(screens.keys().next().value);
  }

  function connect(id) {
    if (id !== windowId) remember();
    socket?.close();
    if (id !== windowId) pending = []; // keys typed for another window stay there
    windowId = id;
    term.reset();
    if (!id) return;
    const last = screens.get(id);
    if (last) term.write(`\x1b[2m${last}\x1b[0m\x1b[H`); // dimmed: it is a picture until the redraw

    // The PTY is born at this size, so tmux never shrinks the window to 80x24
    // and redraws the agent twice on every switch.
    fit.fit();
    const size = `cols=${term.cols}&rows=${term.rows}`;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/windows/${encodeURIComponent(id)}/tty?${size}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      failures = 0;
      onStatus('');
      fit.fit();
      sendResize();
      pending.forEach((bytes) => ws.send(bytes));
      pending = [];
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

  // App shortcuts win over the terminal. xterm sends ESC-prefixed bytes for
  // Alt+2 or Alt+Down, which the shell would act on; returning false keeps them
  // off the wire and lets the event reach the page's own keydown handler.
  // Ctrl+V is let through to the browser, whose native paste event xterm turns
  // into a (bracketed) paste. Sent as the ^V byte instead, Claude Code would try
  // to read an image from the host's clipboard, which is not the viewer's.
  const isPaste = (e) => e.type === 'keydown' && e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'v';
  term.attachCustomKeyEventHandler((e) => !isShortcut(e) && !isPaste(e));
  term.onData(send);
  term.onBinary((data) => sendBytes(Uint8Array.from(data, (c) => c.charCodeAt(0))));
  term.onResize(sendResize);
  new ResizeObserver(() => fit.fit()).observe(document.getElementById('stage'));

  wireKeyBar({ send, toggleCtrl: () => setCtrl(!ctrlArmed), focus: () => term.focus(), onStatus });
  wireTouchScroll(document.getElementById('terminal'), term);
  wireUploads({ send, onStatus });

  return { connect, focus: () => term.focus(), get windowId() { return windowId; } };
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

// The history lives in tmux, not in xterm, so a finger drag has to become the
// mouse wheel that tmux understands. xterm turns wheel events into the mouse
// sequences tmux enters copy mode on, so we synthesise wheel events: one per
// line of travel. Needs `set -g mouse on` in tmux, like wheel scrolling anywhere.
const LINE_PX = 18;

// With tmux mouse on, a drag selects in tmux copy mode, and tmux hands the
// copied text out as OSC 52 ("52;c;<base64>"). Write-only on purpose: a "?"
// query would let any program read the user's clipboard, so it is swallowed.
function wireClipboard(term) {
  term.parser.registerOscHandler(52, (data) => {
    const b64 = data.slice(data.indexOf(';') + 1);
    if (b64 === '?') return true;
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      navigator.clipboard?.writeText(new TextDecoder().decode(bytes)).catch(() => {});
    } catch {} // malformed base64: ignore, never echo anything back
    return true;
  });
}

function wireTouchScroll(el, term) {
  let lastY = null;
  el.addEventListener('touchstart', (e) => {
    lastY = e.touches.length === 1 ? e.touches[0].clientY : null;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (lastY === null || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const lines = Math.trunc((y - lastY) / LINE_PX);
    if (!lines) return;
    lastY += lines * LINE_PX;
    const target = term.element.querySelector('.xterm-screen');
    const at = { clientX: e.touches[0].clientX, clientY: y, bubbles: true, cancelable: true };
    for (let i = 0; i < Math.abs(lines); i++) {
      // Finger down = content down = look back in history = wheel up.
      target.dispatchEvent(new WheelEvent('wheel', { ...at, deltaY: lines > 0 ? -LINE_PX : LINE_PX, deltaMode: 0 }));
    }
    e.preventDefault(); // keep the page from bouncing instead
  }, { passive: false });
  el.addEventListener('touchend', () => { lastY = null; });
}

// shortcutOf names a key event the way the shortcut table does: "Ctrl+Shift+K".
export function shortcutOf(e) {
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', e.key.length === 1 ? e.key.toUpperCase() : e.key]
    .filter(Boolean).join('+');
}

// Ctrl+letter is the letter's code minus 64: Ctrl+C = 0x03.
export function ctrlOf(ch) {
  const c = ch.toUpperCase().charCodeAt(0);
  return c >= 64 && c <= 95 ? String.fromCharCode(c - 64) : ch;
}
