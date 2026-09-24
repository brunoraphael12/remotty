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
  // App shortcuts. The terminal is told which keys are ours so it never sends
  // them to the shell (see attachCustomKeyEventHandler in terminal.js).
  const shortcuts = {
    'Ctrl+Shift+K': () => sessions.focusFind(),
    'Alt+ArrowDown': () => sessions.step(1),
    'Alt+ArrowUp': () => sessions.step(-1),
  };
  for (let n = 1; n <= 9; n++) shortcuts[`Alt+${n}`] = () => sessions.openIndex(n);
  const isShortcut = (e) => Boolean(shortcuts[shortcutOf(e)]);
  const terminal = createTerminal({ onStatus: setStatus, isShortcut });
  const sessions = createSessions({
    onSelect: (id) => {
      document.getElementById('empty').hidden = Boolean(id);
      terminal.connect(id);
    },
    onError: (e) => {
      if (e instanceof Unauthorized) location.reload(); // revoked: back to pairing
      else setStatus(e.message);
    },
    onStatus: setStatus,
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
