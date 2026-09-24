import { test, expect, pair } from './fixtures.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Switching agents used to flash a tiny 80x24 terminal before the real size:
// every new terminal was born 80x24 and got the browser's size only after it
// connected, so tmux shrank the window and the agent redrew twice. The program
// in the window records every size it is given; 80x24 must never be one.
test('switching agents never shows the window at a default 80x24 first', async ({ page, host }) => {
  const log = join(host.dir, 'sizes.log');
  const watcher = `bash --norc -c 'trap "stty size >> ${log}" WINCH; while :; do sleep 0.05; done'`;
  host.tmux('rename-window', '-t', host.windows()[0].id, 'um');
  host.tmux('new-window', '-d', '-t', '=main:', '-n', 'vigia', watcher);
  await pair(page, host);
  const row = (n) => page.locator('#tab-list li', { has: page.locator('.name', { hasText: new RegExp(`^${n}$`) }) });

  await row('vigia').click();
  await expect.poll(() => existsSync(log) && readFileSync(log, 'utf8')).toBeTruthy(); // anchor: it records
  for (let i = 0; i < 3; i++) {
    await row('um').click();
    await page.waitForTimeout(300);
    await row('vigia').click();
    await page.waitForTimeout(300);
  }
  const sizes = readFileSync(log, 'utf8').trim().split('\n');
  const cols = await page.evaluate(() => document.querySelector('#terminal .xterm-rows').children.length);
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes, `sizes seen: ${[...new Set(sizes)]}`).not.toContain('24 80');
  expect(cols).toBeGreaterThan(24); // the browser's terminal really is bigger than 24 rows
});

// Coming back to an agent shows its last screen right away, not a blank
// terminal. The socket back is held for 800 ms so "right away" is measurable.
test('switching back shows the last screen before the terminal reconnects', async ({ page, host }) => {
  let hold = false;
  await page.routeWebSocket(/\/tty(\?|$)/, async (ws) => {
    if (hold) await new Promise((ok) => setTimeout(ok, 800));
    ws.connectToServer();
  });
  host.tmux('rename-window', '-t', host.windows()[0].id, 'um');
  host.tmux('new-window', '-d', '-t', '=main:', '-n', 'dois');
  await pair(page, host);
  const row = (n) => page.locator('#tab-list li', { has: page.locator('.name', { hasText: new RegExp(`^${n}$`) }) });
  await row('um').click();
  await page.locator('#terminal .xterm-helper-textarea').focus();
  await page.keyboard.type('echo marca-$((6*7))-tela\n');
  await expect(page.locator('#terminal .xterm-rows')).toContainText('marca-42-tela');
  await row('dois').click();
  await expect(page.locator('#terminal .xterm-rows')).not.toContainText('marca-42-tela');

  hold = true;
  await row('um').click();
  // Within the 800 ms the socket is held, the old screen is already there.
  await expect(page.locator('#terminal .xterm-rows')).toContainText('marca-42-tela', { timeout: 400 });
  hold = false;
  // And after tmux redraws, the live screen still shows it (it was not wiped).
  await page.waitForTimeout(1200);
  await expect(page.locator('#terminal .xterm-rows')).toContainText('marca-42-tela');
});
