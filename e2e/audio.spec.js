import { test, expect, pair } from './fixtures.js';
import { readFileSync } from 'node:fs';

// Chromium's fake microphone plays a tone, so recording is real end to end:
// getUserMedia, MediaRecorder, upload, and the path typed at the prompt.
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
});

test('recording a voice note uploads it and types its path', async ({ page, host }) => {
  // Count live microphone tracks, so the test can see the mic being let go.
  await page.addInitScript(() => {
    window.__liveTracks = 0;
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const stream = await get(c);
      for (const t of stream.getTracks()) {
        window.__liveTracks++;
        const stop = t.stop.bind(t);
        t.stop = () => { if (t.readyState === 'live') window.__liveTracks--; stop(); };
      }
      return stream;
    };
  });
  await pair(page, host);
  const mic = page.getByRole('button', { name: 'Record a voice note' });
  await expect(mic).toBeVisible();
  await expect(mic).toHaveAttribute('aria-pressed', 'false');

  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true'); // recording, visibly
  await expect(page.locator('#status')).toContainText(/Recording/);
  expect(await page.evaluate(() => window.__liveTracks)).toBe(1); // anchor: the mic is on
  await page.waitForTimeout(1200);
  await mic.click(); // stop

  const window = host.windows()[0].id;
  await expect.poll(() => host.capture(window)).toMatch(/\/uploads\/\S+voice-\S+\.(webm|ogg|mp4|m4a)/);
  const path = host.capture(window).match(/(\S+\/uploads\/\S+voice-\S+\.(?:webm|ogg|mp4|m4a))/)[1];
  const bytes = readFileSync(path);
  expect(bytes.length).toBeGreaterThan(2000); // a second of real audio, not an empty blob
  // A WebM/Matroska file starts with the EBML magic; MP4 has "ftyp" at byte 4.
  const magic = bytes.subarray(0, 4).toString('hex') === '1a45dfa3' || bytes.subarray(4, 8).toString() === 'ftyp';
  expect(magic).toBe(true);
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  // The phone's recording indicator goes off only when every track is stopped.
  expect(await page.evaluate(() => window.__liveTracks)).toBe(0);
});

test('the page may use the microphone but still no camera or location', async ({ request, host }) => {
  const policy = (await request.get(`${host.origin}/`)).headers()['permissions-policy'];
  expect(policy).toContain('microphone=(self)');
  expect(policy).toContain('camera=()');
  expect(policy).toContain('geolocation=()');
});

test('a denied microphone says so instead of failing silently', async ({ browser, host }) => {
  const context = await browser.newContext({ permissions: [] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await pair(page, host);
  await page.getByRole('button', { name: 'Record a voice note' }).click();
  await expect(page.locator('#status')).toContainText(/microphone/i);
  await expect(page.getByRole('button', { name: 'Record a voice note' })).toHaveAttribute('aria-pressed', 'false');
  await context.close();
});
