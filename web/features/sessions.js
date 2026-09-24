// Tab list: one entry per tmux window, polled so bells and idle agents show up
// without the tab being open. The field on top filters the list and creates
// agents, so the whole flow works from the keyboard:
//   Ctrl+Shift+K, type, Enter  -> open the highlighted agent, or create one
import { api } from './api.js';

const POLL_MS = 2000;

export function createSessions({ onSelect, onError, focusTerminal }) {
  const list = document.getElementById('tab-list');
  const find = document.getElementById('find');
  let windows = [];
  let current = null;
  let highlighted = 0; // index into the visible rows while the field has focus
  let timer = null;

  async function refresh() {
    try {
      windows = await api('GET', '/api/windows');
    } catch (e) {
      onError(e);
      return;
    }
    render();
    // The open window was closed elsewhere (ssh, an agent exiting): follow tmux
    // to a window that still exists instead of retrying a dead one forever.
    if (current && !windows.some((w) => w.id === current)) {
      const next = windows.find((w) => w.active) || windows[0];
      select(next ? next.id : null);
    }
  }

  const query = () => find.value.trim();

  // A number matches the window index exactly; anything else matches the name.
  function visible() {
    const q = query().toLowerCase();
    if (!q) return windows;
    if (/^\d+$/.test(q)) return windows.filter((w) => String(w.index) === q);
    return windows.filter((w) => w.name.toLowerCase().includes(q));
  }

  // Rows the keyboard can land on: the matches, then "create" when there is a name.
  function rows() {
    const matches = visible();
    const name = query();
    const exact = matches.some((w) => w.name === name);
    return name && !exact && !/^\d+$/.test(name) ? [...matches, { create: name }] : matches;
  }

  function render() {
    const all = rows();
    highlighted = Math.min(highlighted, Math.max(all.length - 1, 0));
    const searching = document.activeElement === find && query() !== '';
    list.replaceChildren(...all.map((row, i) => {
      const li = row.create ? createRow(row.create) : item(row);
      li.classList.toggle('highlighted', searching && i === highlighted);
      return li;
    }));
    list.querySelector('.highlighted')?.scrollIntoView({ block: 'nearest' });
  }

  function createRow(name) {
    const li = document.createElement('li');
    li.className = 'create';
    li.textContent = `+ New agent "${name}"`;
    li.addEventListener('click', () => create(name));
    return li;
  }

  function item(w) {
    const li = document.createElement('li');
    li.dataset.id = w.id;
    li.dataset.state = w.bell ? 'bell' : w.silence ? 'waiting' : w.activity ? 'activity' : 'idle';
    li.setAttribute('aria-current', String(w.id === current));
    li.title = 'Double-tap to rename';

    const index = document.createElement('span');
    index.className = 'index';
    index.textContent = w.index;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = w.name; // textContent: window names are set by programs inside the terminal
    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', `Close ${w.name}`);

    li.append(index, dot, name, close);
    li.addEventListener('click', (e) => (e.target === close ? remove(w) : open(w.id)));
    li.addEventListener('dblclick', () => rename(w));
    return li;
  }

  function select(id) {
    current = id;
    render();
    onSelect(id);
  }

  // open: leave the list and hand the keyboard to that agent's terminal.
  function open(id) {
    find.value = '';
    highlighted = 0;
    select(id);
    focusTerminal();
    revealCurrent();
  }

  // On a phone the tabs are a strip wider than the screen: bring the chosen one
  // in. Only once the finder has closed, because the strip is hidden while it is open.
  function revealCurrent() {
    list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  async function create(name) {
    try {
      const { id } = await api('POST', '/api/windows', { name });
      await refresh();
      open(id);
    } catch (e) {
      onError(e);
    }
  }

  async function rename(w) {
    const name = prompt('Rename window:', w.name);
    if (!name || name === w.name) return;
    await api('PATCH', `/api/windows/${encodeURIComponent(w.id)}`, { name }).catch(onError);
    refresh();
  }

  async function remove(w) {
    if (!confirm(`Close "${w.name}"? Whatever runs in it will be killed.`)) return;
    await api('DELETE', `/api/windows/${encodeURIComponent(w.id)}`).catch(onError);
    if (w.id === current) {
      current = null;
      onSelect(null);
    }
    refresh();
  }

  function onFindKey(e) {
    const all = rows();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      highlighted = (highlighted + step + all.length) % Math.max(all.length, 1);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = all[highlighted];
      if (row?.create) create(row.create);
      else if (row) open(row.id);
      else if (!query()) create(''); // empty field + Enter: a fresh agent
    } else if (e.key === 'Escape') {
      e.preventDefault();
      find.value = '';
      render();
      focusTerminal();
    }
  }

  find.addEventListener('input', () => {
    highlighted = 0;
    render();
  });
  find.addEventListener('keydown', onFindKey);
  // A tap on a result would first blur the finder, which hides the results on a
  // phone before the click lands. Keeping focus on pointerdown lets the tap through.
  list.addEventListener('pointerdown', (e) => {
    if (document.activeElement === find) e.preventDefault();
  });
  find.addEventListener('blur', () => setTimeout(render)); // drop the highlight
  // Tapping "+" must not blur the finder on the way (the tap lands on the button,
  // which would steal focus), so focus it after the button has taken the click.
  document.getElementById('new-tab').addEventListener('click', () => {
    find.focus();
    render();
  });
  document.getElementById('new-tab').addEventListener('pointerdown', (e) => e.preventDefault());

  return {
    async start() {
      await refresh();
      timer = setInterval(refresh, POLL_MS);
      const first = windows.find((w) => w.active) || windows[0];
      if (first) select(first.id);
    },
    stop: () => clearInterval(timer),
    focusFind() {
      find.focus();
      find.select();
      render();
    },
  };
}
