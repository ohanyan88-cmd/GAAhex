// Headless screenshot for PROMPT 6 drawer applied. The app shows the login
// wall in this environment (no auth token loaded), so the screenshot captures
// the public/login state — same caveat as previous prompts.
import { chromium } from 'playwright'

const url = process.argv[2] || 'http://localhost:5173/'
const out = process.argv[3] || 'C:/Users/Admin/Desktop/Portal/drawer-applied.png'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(500)
await page.screenshot({ path: out, fullPage: false })
await browser.close()
console.log('wrote', out)
