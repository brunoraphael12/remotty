import { test, expect, pair, typeInTerminal, startHost } from './fixtures.js';

// Travel conditions: the connection drops, the host restarts, windows change
// under you. The agents live in tmux, so the page only has to find them again.

test('when the host restarts, the page reconnects to the same shell by itself', async ({ page, host }) => {
  await pair(page, host);
  await typeInTerminal(page, 'export MARCA=antes-$$\n');
  const port = new URL(host.origin).port;

  host.proc.kill();
  await expect(page.locator('#status')).toContainText(/Reconnecting/i);

  // Same port, same state dir, same tmux: what a service manager restart looks like.
  const again = await startHost(host.dir, ['-addr', `127.0.0.1:${port}`, '-origin', host.origin], { reuseTmux: true });
  host.proc = again.proc; // the fixture's teardown kills whatever runs now
  await expect(page.locator('#status')).toBeEmpty({ timeout: 10_000 });
  await typeInTerminal(page, 'echo "valor=$MARCA"\n');
  await expect(page.locator('#terminal .xterm-rows')).toContainText(/valor=antes-\d+/);
});

test('closing the open window from ssh moves the page to another window', async ({ page, host }) => {
  host.tmux('new-window', '-d', '-t', '=main:', '-n', 'sobra');
  await pair(page, host);
  const open = host.windows()[0];
  host.tmux('kill-window', '-t', open.id);
  await expect(page.locator('#tab-list li[aria-current="true"] .name')).toHaveText('sobra', { timeout: 10_000 });
  await typeInTerminal(page, 'echo na-sobra\n');
  const sobra = host.windows().find((w) => w.name === 'sobra');
  await expect.poll(() => host.capture(sobra.id)).toContain('na-sobra');
});

test('a socket to a window that no longer exists never types into another window', async ({ page, host }) => {
  await pair(page, host);
  const live = host.windows()[0];
  const outcome = await page.evaluate(() => new Promise((ok) => {
    const s = new WebSocket(`ws://${location.host}/api/windows/@999/tty`);
    s.binaryType = 'arraybuffer';
    s.onopen = () => { s.send(new TextEncoder().encode('echo MARCA-DA-ABA-MORTA\r')); setTimeout(() => ok('open'), 500); };
    s.onerror = () => ok('refused');
  }));
  expect(outcome).toBe('refused');
  await page.waitForTimeout(300);
  expect(host.capture(live.id)).not.toContain('MARCA-DA-ABA-MORTA');
  // Anchor: the same socket to the live window does reach it.
  await page.evaluate((id) => new Promise((ok) => {
    const s = new WebSocket(`ws://${location.host}/api/windows/${encodeURIComponent(id)}/tty`);
    s.onopen = () => { s.send(new TextEncoder().encode('echo MARCA-VIVA\r')); setTimeout(ok, 500); };
  }), live.id);
  await expect.poll(() => host.capture(live.id)).toContain('MARCA-VIVA');
});

// Over a real network the WebSocket takes a while to open. Whatever the user
// types in that window must still reach the shell, in order.
test('keys typed before the terminal connects are not lost', async ({ page, host }) => {
  await pair(page, host);
  // Hold back every new terminal socket for 800 ms, like a slow tailnet handshake.
  await page.routeWebSocket(/\/tty$/, async (ws) => {
    await new Promise((ok) => setTimeout(ok, 800));
    ws.connectToServer();
  });
  page.once('dialog', (d) => d.accept('lento'));
  await page.getByRole('button', { name: 'New agent' }).click();
  await typeInTerminal(page, 'echo primeira-$((1+1)); echo segunda-$((2+2))\n');
  await expect(page.locator('#terminal .xterm-rows')).toContainText('segunda-4');
  const lento = host.windows().find((w) => w.name === 'lento');
  expect(host.capture(lento.id)).toMatch(/primeira-2[\s\S]*segunda-4/);
});

test('a device revoked while the host is down is refused when it comes back', async ({ page, host }) => {
  await pair(page, host, 'viajante');
  const port = new URL(host.origin).port;
  host.proc.kill();
  const id = host.cli('devices').split('\n').find((l) => l.includes('viajante')).split(/\s+/)[0];
  host.cli('revoke', id);
  const again = await startHost(host.dir, ['-addr', `127.0.0.1:${port}`, '-origin', host.origin], { reuseTmux: true });
  host.proc = again.proc;
  await expect(page.getByRole('button', { name: 'Pair' })).toBeVisible({ timeout: 10_000 });
});

test('the reconnect loop stops hammering while the host is down', async ({ page, host }) => {
  await pair(page, host);
  let attempts = 0;
  page.on('websocket', () => attempts++);
  host.proc.kill();
  await page.waitForTimeout(6000);
  // A fixed 1 s retry would make ~6 attempts; backoff keeps it to a handful.
  expect(attempts).toBeGreaterThan(0); // anchor: it does retry
  expect(attempts).toBeLessThanOrEqual(4);
});
