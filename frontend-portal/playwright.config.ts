import { defineConfig, devices } from '@playwright/test'

/**
 * L-15 — Playwright e2e config for the GAAhex customer portal.
 *
 * The e2e suite is structural/smoke: it builds the portal into a preview
 * server and checks that key pages render the expected DOM elements.
 * No live backend is required — tests assert element presence, not data.
 *
 * To run locally:
 *   npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',

  use: {
    // Tests do NOT require a live dev server — they load built static HTML
    // or can be run against a preview server started manually.
    // baseURL is set here so each spec can override via page.goto('/').
    baseURL: process.env.PORTAL_BASE_URL ?? 'http://localhost:5175',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Optional: auto-start the preview server if PORTAL_BASE_URL is not set.
  // Comment this block out when running against a manually-started server.
  // webServer: {
  //   command: 'npm run preview',
  //   port: 5175,
  //   reuseExistingServer: !process.env.CI,
  // },
})
