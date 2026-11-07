import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('documentation navigation landmarks have distinct accessible names', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme: theme, viewport: { width: 1440, height: 1000 } })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      for (const path of ['/001-onboarding', '/vibelang-features/115-cheat-sheet']) {
        await page.goto('https://vibelang.sh' + path, { waitUntil: 'networkidle' })
        const audit = await new AxeBuilder({ page }).setLegacyMode().withRules(['landmark-unique']).analyze()
        assert.deepEqual(audit.violations.map(rule => ({ id: rule.id, targets: rule.nodes.map(node => node.target) })), [], theme + ' ' + path)
        for (const name of ['Primary navigation', 'Documentation', 'On this page']) {
          assert.equal(await page.getByRole('navigation', { name, exact: true }).count(), 1, name)
        }
      }
      await context.close()
    }
  } finally { await browser.close() }
})

