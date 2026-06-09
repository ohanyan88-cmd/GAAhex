/**
 * L-15 — customer-auth e2e smoke tests
 *
 * Structural checks: the login page must render the expected form elements.
 * These tests do NOT submit credentials or require a live backend — they
 * verify the DOM structure that LoginView produces.
 *
 * Prerequisites:
 *   Portal dev/preview server running at PORTAL_BASE_URL (default :5175).
 *   Set PORTAL_BASE_URL env var to override.
 */
import { test, expect } from '@playwright/test'

test.describe('Customer login page', () => {
  test.beforeEach(async ({ page }) => {
    // The portal SPA shows the login view when no token is present.
    // Clearing storage ensures we land on the login screen.
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.removeItem('gaahex-portal-token')
    })
    await page.reload()
  })

  test('login page renders the GAAhex logo text', async ({ page }) => {
    await expect(page.getByText('GAAhex')).toBeVisible()
  })

  test('login page renders the Customer Portal subtitle', async ({ page }) => {
    await expect(page.getByText('Customer Portal')).toBeVisible()
  })

  test('email input field is present', async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })

  test('password input field is present', async ({ page }) => {
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  test('submit button is present and enabled', async ({ page }) => {
    const btn = page.locator('button[type="submit"]')
    await expect(btn).toBeVisible()
    await expect(btn).toBeEnabled()
  })

  test('form fields accept user input', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')

    await emailInput.fill('customer@example.com')
    await passwordInput.fill('password123')

    await expect(emailInput).toHaveValue('customer@example.com')
    await expect(passwordInput).toHaveValue('password123')
  })

  test('failed login shows an error banner', async ({ page }) => {
    // Fill in bad credentials — the dev server will return 401/error
    // We just verify the UI shows an error message after submit attempt.
    // If no backend is running, the fetch itself will fail, triggering the
    // error state in LoginView (catches any Error).
    await page.locator('input[type="email"]').fill('bad@user.com')
    await page.locator('input[type="password"]').fill('wrong')
    await page.locator('button[type="submit"]').click()

    // Wait for either an error banner OR a loading state that resolves to one.
    // The error-banner-msg span is rendered by LoginView on any catch.
    await expect(page.locator('.error-banner-msg, .error-banner')).toBeVisible({ timeout: 10_000 })
  })
})
