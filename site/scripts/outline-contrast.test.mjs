import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'
import { auditPageContrast } from './contrast-audit.mjs'

test('built wide page outlines meet text contrast in both themes', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme: theme })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      for (const width of [1376, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const path of ['/001-onboarding', '/vibelang-features/115-cheat-sheet']) {
          await page.goto('https://vibelang.sh' + path, { waitUntil: 'networkidle' })
          const active = page.locator('[data-v-outline-nav] a[data-active="true"]').first()
          await active.waitFor({ state: 'visible' })
          const result = await auditPageContrast(page)
          assert.deepEqual(result.violations.map(rule => ({ id: rule.id, targets: rule.nodes.map(node => node.target) })), [],
            theme + ' width=' + width + ' ' + path)
        }
      }
      await context.close()
    }
  } finally { await browser.close() }
})

