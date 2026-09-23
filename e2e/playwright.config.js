import { defineConfig, devices } from '@playwright/test';

// Each test starts its own host, tmux server and state dir (see fixtures.js),
// so tests run in parallel without sharing anything.
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    // Closest Playwright profile to the Galaxy Tab S10 FE this was built for.
    ...devices['Galaxy Tab S9 landscape'],
    trace: 'retain-on-failure',
  },
});
