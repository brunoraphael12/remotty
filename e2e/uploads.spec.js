import { test, expect, pair } from './fixtures.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// A tiny valid PNG, so the test exercises a real image and not just text.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('attaching a photo saves it on the host and types its path into the terminal', async ({ page, host }) => {
  await pair(page, host);
  await page.locator('#attach-input').setInputFiles({ name: 'print do erro.png', mimeType: 'image/png', buffer: PNG });

  // The path lands at the prompt, ready for "look at <path>".
  const window = host.windows()[0].id;
  await expect.poll(() => host.capture(window)).toMatch(/\/uploads\/\S+print_do_erro\.png/);
  const path = host.capture(window).match(/(\S+\/uploads\/\S+print_do_erro\.png)/)[1];
  expect(readFileSync(path)).toEqual(PNG); // byte for byte
  expect(path.startsWith(join(host.dir, 'state', 'uploads'))).toBe(true);
});

test('an unpaired browser cannot upload', async ({ page, host }) => {
  await page.goto(host.origin);
  const status = await page.evaluate(async () => (await fetch('/api/uploads?name=x.png', { method: 'POST', body: 'x' })).status);
  expect(status).toBe(401);
  let files = [];
  try { files = readdirSync(join(host.dir, 'state', 'uploads')); } catch {}
  expect(files).toEqual([]);
  // Anchor: after pairing, the same request is accepted.
  await pair(page, host);
  const paired = await page.evaluate(async () => (await fetch('/api/uploads?name=x.png', { method: 'POST', body: 'x' })).status);
  expect(paired).toBe(201);
});
