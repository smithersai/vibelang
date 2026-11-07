import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('the proposal overview states its retirement rule without internal review metadata', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme: theme })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      await page.goto('https://vibelang.sh/vips', { waitUntil: 'networkidle' })
      const text = await page.getByRole('main').innerText()
      assert.doesNotMatch(text, /\([^()\n]*\b(?:effectscript|smithers|claude)-\d+[a-z]?\b[^()\n]*\)/iu)
      assert.match(text, /codemod first, then the error/)
      assert.match(text, /vibelang --fix/)
      await context.close()
    }
  } finally { await browser.close() }
})
