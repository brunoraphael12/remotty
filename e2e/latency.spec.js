import { test, expect, pair } from './fixtures.js';

// Round trip of a single key as the user feels it: xterm -> WebSocket -> tmux ->
// shell echo -> tmux -> WebSocket -> xterm's DOM. Over localhost, so this is
// the software's share; the network adds its own on top.
test('a keystroke echoes back fast', async ({ page, host }) => {
  await pair(page, host);
  await page.locator('#terminal .xterm-helper-textarea').focus();
  await page.keyboard.type('cat\n');
  await expect(page.locator('#terminal .xterm-rows')).toContainText('cat');

  const samples = await page.evaluate(async () => {
    const rows = document.querySelector('#terminal .xterm-rows');
    const input = document.querySelector('#terminal .xterm-helper-textarea');
    const times = [];
    for (let i = 0; i < 40; i++) {
      // A MutationObserver fires on the DOM change itself. Polling with
      // requestAnimationFrame would measure frame pacing (~16-33 ms), not latency.
      const echoed = new Promise((ok) => {
        const obs = new MutationObserver(() => { obs.disconnect(); ok(performance.now()); });
        obs.observe(rows, { childList: true, subtree: true, characterData: true });
      });
      const start = performance.now();
      input.dispatchEvent(new InputEvent('input', { data: 'x', inputType: 'insertText', bubbles: true }));
      times.push((await echoed) - start);
      await new Promise((ok) => setTimeout(ok, 20));
    }
    return times.sort((a, b) => a - b);
  });
  const p50 = samples[20];
  const p95 = samples[38];
  console.log(`keystroke echo in the browser: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
  // The median is the gate: it sits near 2 ms and moves to 20+ ms under any
  // debounce or batching, while the tail jitters with the machine's load.
  expect(p50).toBeLessThan(10);
});
