import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('the missing page exposes its content in one main landmark', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
      const context = await browser.newContext({ colorScheme: theme, viewport: { width, height: 1000 } })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      await page.goto('https://vibelang.sh/404', { waitUntil: 'networkidle' })
      const audit = await new AxeBuilder({ page }).setLegacyMode().withRules(['landmark-one-main', 'region']).analyze()
      assert.deepEqual(audit.violations.map(rule => ({ id: rule.id, targets: rule.nodes.map(node => node.target) })), [], theme + ' width=' + width)
      const main = page.getByRole('main')
      assert.equal(await main.count(), 1)
      assert.equal(await main.getByRole('heading', { name: 'Page not found', exact: true }).count(), 1)
      await main.getByRole('link', { name: 'Back to home', exact: true }).click()
      await page.waitForURL('https://vibelang.sh/')
      assert((await page.locator('h1').innerText()).includes('Vibe'))
      await context.close()
    }
  } finally { await browser.close() }
})

