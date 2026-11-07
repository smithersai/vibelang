import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('specification sections expose their parent heading level', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      for (const [path, name] of [['/spec/002-running', 'Inferred Effect arguments'], ['/spec/008-runtime', 'Region finalizer observations']]) {
        await page.goto('https://vibelang.sh' + path, { waitUntil: 'networkidle' })
        const audit = await new AxeBuilder({ page }).setLegacyMode().withRules(['heading-order']).analyze()
        assert.deepEqual(audit.violations.map(rule => rule.id), [], path + ' ' + colorScheme)
        assert.equal(await page.getByRole('heading', { name: new RegExp('^' + name), level: 2 }).count(), 1)
      }
      await context.close()
    }
  } finally { await browser.close() }
})
