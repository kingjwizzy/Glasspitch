import { defineConfig, devices } from '@playwright/test';

// E2E runs against a production build (`next build && next start`), not `next
// dev` — the dev server emits Fast-Refresh / devtools console noise that would
// make the "no console errors" assertion both flaky and unrepresentative of
// what ships. baseURL is the local production server on :3000.
const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Fail CI if a `test.only` was committed by accident.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // Mobile-first is a hard design goal (DESIGN.md / ARCHITECTURE.md §… ),
    // so every smoke spec runs at a phone viewport AND desktop.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: baseURL,
    timeout: 120_000,
    // Locally, reuse a server already on :3000; in CI always start fresh.
    reuseExistingServer: !process.env.CI,
  },
});
