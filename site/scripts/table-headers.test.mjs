import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('proposal comparison tables have accessible column names', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      for (const path of ['/vips/0040-module-declarations', '/vips/0053-rename-smithersscript-open']) {
        await page.goto('https://vibelang.sh' + path, { waitUntil: 'networkidle' })
        const audit = await new AxeBuilder({ page }).setLegacyMode().withRules(['empty-table-header']).analyze()
        assert.deepEqual(audit.violations.map(rule => rule.id), [], path + ' ' + colorScheme)
        assert.equal(await page.getByRole('columnheader', { name: 'Aspect', exact: true }).count(), 1)
      }
      await context.close()
    }
  } finally { await browser.close() }
})
