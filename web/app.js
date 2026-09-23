// Entry point: pair if needed, then show the tab list and the terminal.
import { api, Unauthorized } from './features/api.js';
import { showPairing } from './features/access.js';
import { createSessions } from './features/sessions.js';
import { createTerminal, shortcutOf } from './features/terminal.js';

const status = document.getElementById('status');
const setStatus = (text) => (status.textContent = text);

async function main() {
  try {
    await api('GET', '/api/me');
  } catch (e) {
    if (e instanceof Unauthorized) return showPairing(main);
    setStatus(`Host unreachable: ${e.message}`);
    return;
  }
  document.getElementById('app').hidden = false;
  // App shortcuts. xterm sends no bytes for Ctrl+Shift+<letter>, so they never
  // reach the shell; the e2e test "the shortcut never reaches the terminal" checks it.
  const shortcuts = { 'Ctrl+Shift+K': () => sessions.focusFind() };
  const terminal = createTerminal({ onStatus: setStatus });
  const sessions = createSessions({
    onSelect: (id) => {
      document.getElementById('empty').hidden = Boolean(id);
      terminal.connect(id);
    },
    onError: (e) => {
      if (e instanceof Unauthorized) location.reload(); // revoked: back to pairing
      else setStatus(e.message);
    },
    focusTerminal: () => terminal.focus(),
  });
  document.addEventListener('keydown', (e) => {
    const action = shortcuts[shortcutOf(e)];
    if (action) {
      e.preventDefault();
      action();
    }
  });
  sessions.start();
}

main();
