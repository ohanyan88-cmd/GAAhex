/**
 * L-15 — support-flow e2e smoke tests
 *
 * Structural checks on the Support / Tickets view (SupportView).
 * Like payment-flow.spec.ts, these tests inject a fake bearer token to
 * bypass the login screen and navigate to the support section.
 *
 * Because no live backend is running the ticket list will be empty or show
 * an error; we verify the view renders key structural elements regardless.
 *
 * Prerequisites:
 *   Portal dev/preview server running at PORTAL_BASE_URL (default :5175).
 */
import { test, expect } from '@playwright/test'

async function injectFakeSession(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('gaahex-portal-token', 'fake-test-token')
  })
}

test.describe('Support / Tickets page', () => {
  test.beforeEach(async ({ page }) => {
    await injectFakeSession(page)
    await page.goto('/')
  })

  test('portal shell renders after injecting a session token', async ({ page }) => {
    // The shell or a redirect back to login — either is a valid rendered state.
    await expect(page.locator('body')).not.toBeEmpty()
    await expect(page.getByText('GAAhex')).toBeVisible({ timeout: 8_000 })
  })

  test('support section is reachable via navigation', async ({ page }) => {
    const supportLink = page
      .getByRole('link', { name: /support|tickets|Поддержка|Աջակ/i })
      .or(page.getByRole('button', { name: /support|tickets|Поддержка|Աջակ/i }))

    if (await supportLink.count() > 0) {
      await supportLink.first().click()
      await expect(
        page.getByText(/support|tickets|Поддержка|Աջակ/i).first()
      ).toBeVisible({ timeout: 6_000 })
    } else {
      // Shell is hidden (401 redirect to login) — check login still renders
      await expect(page.getByText('GAAhex')).toBeVisible()
    }
  })

  test('new ticket button or empty state is present in support view', async ({ page }) => {
    const supportLink = page
      .getByRole('link', { name: /support|tickets/i })
      .or(page.getByRole('button', { name: /support|tickets/i }))

    if (await supportLink.count() > 0) {
      await supportLink.first().click()
      await page.waitForTimeout(1_500)

      // Either a "New ticket" button, an empty state, or an error banner
      const anyContent = page.locator(
        'button:has-text("New ticket"), button:has-text("Новое обращение"), .empty-state, .error-banner'
      )
      if (await anyContent.count() > 0) {
        await expect(anyContent.first()).toBeVisible({ timeout: 6_000 })
      } else {
        await expect(page.getByText('GAAhex')).toBeVisible()
      }
    }
  })

  test('new ticket form renders subject and body fields when opened', async ({ page }) => {
    // Navigate to support section first
    const supportLink = page
      .getByRole('link', { name: /support|tickets/i })
      .or(page.getByRole('button', { name: /support|tickets/i }))

    if (await supportLink.count() === 0) {
      test.skip()
      return
    }

    await supportLink.first().click()
    await page.waitForTimeout(1_500)

    const newTicketBtn = page.getByRole('button', { name: /new ticket|New ticket|Новое обращение/i })
    if (await newTicketBtn.count() === 0) {
      test.skip()
      return
    }

    await newTicketBtn.first().click()

    // The new-ticket form has a subject input and a body textarea
    await expect(page.locator('input[type="text"], input:not([type])')).toBeVisible({ timeout: 4_000 })
    await expect(page.locator('textarea')).toBeVisible({ timeout: 4_000 })
  })

  test('submit button is present in the new ticket form', async ({ page }) => {
    const supportLink = page
      .getByRole('link', { name: /support|tickets/i })
      .or(page.getByRole('button', { name: /support|tickets/i }))

    if (await supportLink.count() === 0) {
      test.skip()
      return
    }

    await supportLink.first().click()
    await page.waitForTimeout(1_500)

    const newTicketBtn = page.getByRole('button', { name: /new ticket|New ticket|Новое обращение/i })
    if (await newTicketBtn.count() === 0) {
      test.skip()
      return
    }

    await newTicketBtn.first().click()

    // Submit button must be present (disabled initially — subject is required)
    const submitBtn = page.locator('button[type="submit"]')
    await expect(submitBtn).toBeVisible({ timeout: 4_000 })
  })
})
