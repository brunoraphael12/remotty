// Tab list: one entry per tmux window, polled so bells and idle agents show up
// without the tab being open.
import { api } from './api.js';

const POLL_MS = 2000;

export function createSessions({ onSelect, onError }) {
  const list = document.getElementById('tab-list');
  let windows = [];
  let current = null;
  let timer = null;

  async function refresh() {
    try {
      windows = await api('GET', '/api/windows');
    } catch (e) {
      onError(e);
      return;
    }
    if (current && !windows.some((w) => w.id === current)) current = null;
    render();
  }

  function render() {
    list.replaceChildren(...windows.map(item));
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
    li.addEventListener('click', (e) => (e.target === close ? remove(w) : select(w.id)));
    li.addEventListener('dblclick', () => rename(w));
    return li;
  }

  function select(id) {
    current = id;
    render();
    onSelect(id);
  }

  async function create() {
    const name = prompt('Agent name (optional):');
    if (name === null) return;
    try {
      const { id } = await api('POST', '/api/windows', { name });
      await refresh();
      select(id);
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

  document.getElementById('new-tab').addEventListener('click', create);

  return {
    async start() {
      await refresh();
      timer = setInterval(refresh, POLL_MS);
      const first = windows.find((w) => w.active) || windows[0];
      if (first) select(first.id);
    },
    stop: () => clearInterval(timer),
  };
}
