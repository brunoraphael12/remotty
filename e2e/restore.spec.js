import { test, expect, pair } from './fixtures.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// After a crash, the Restore button reopens each Claude Code conversation that
// stopped, in its own window and directory. The host's HOME is the test dir, so
// a fake ~/.claude there is all Claude Code state the host can see.
test('Restore reopens stopped Claude conversations as windows', async ({ page, host }) => {
  const id = '0e12d597-54fb-4759-85d3-66f8ea6d224f';
  const work = join(host.dir, 'projeto');
  mkdirSync(work);
  mkdirSync(join(host.dir, '.claude', 'projects', '-projeto'), { recursive: true });
  writeFileSync(join(host.dir, '.claude', 'projects', '-projeto', `${id}.jsonl`),
    `{"type":"user","cwd":"${work}"}\n{"type":"custom-title","customTitle":"deploy-da-semana"}\n`);
  await pair(page, host);

  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('#status')).toContainText('Reopened 1: deploy-da-semana');
  await expect(page.locator('#tab-list .name', { hasText: 'deploy-da-semana' })).toBeVisible();
  const w = host.windows().find((x) => x.name === 'deploy-da-semana');
  expect(host.tmux('display-message', '-p', '-t', w.id, '#{pane_current_path}').trim()).toBe(work);

  // A second tap does not open it twice.
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('#status')).toContainText('Nothing to reopen');
  expect(host.windows().filter((x) => x.name === 'deploy-da-semana')).toHaveLength(1);
});
