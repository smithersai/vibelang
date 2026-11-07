import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('wide page outlines expose valid lists and keep heading navigation', { timeout: 60_000 }, async () => {
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
        const outline = page.locator('[data-v-outline-nav]')
        await outline.locator('a').first().waitFor({ state: 'visible' })
        const audit = await new AxeBuilder({ page }).setLegacyMode().withRules(['list']).analyze()
        assert.deepEqual(audit.violations.map(rule => ({ id: rule.id, targets: rule.nodes.map(node => node.target) })), [], theme + ' ' + path)
        const indicator = outline.locator('[data-v-outline-indicator]')
        assert.equal(await indicator.evaluate(element => element.tagName), 'LI')
        assert.equal(await indicator.getAttribute('role'), 'presentation')
        assert.equal(await indicator.getAttribute('aria-hidden'), 'true')
        const link = outline.locator('a').last()
        const href = await link.getAttribute('href')
        await link.click()
        await page.waitForURL(url => url.hash === href)
      }
      await context.close()
    }
  } finally { await browser.close() }
})

