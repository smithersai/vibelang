import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('header, logo and release notice belong to page landmarks', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
      const context = await browser.newContext({ colorScheme: theme, viewport: { width, height: 1000 } })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      for (const path of ['/', '/001-onboarding', '/vibelang-features/115-cheat-sheet']) {
        await page.goto('https://vibelang.sh' + path, { waitUntil: 'networkidle' })
        const audit = await new AxeBuilder({ page }).setLegacyMode().withRules(['region']).analyze()
        assert.deepEqual(audit.violations.map(rule => ({ id: rule.id, targets: rule.nodes.map(node => node.target) })), [], theme + ' width=' + width + ' ' + path)
        assert.equal(await page.getByRole('banner', { name: 'Site header', exact: true }).count(), 1)
        const release = page.getByRole('complementary', { name: 'Release status', exact: true })
        assert((await release.innerText()).includes('early alpha'))
      }
      await page.getByRole('button', { name: 'Dismiss banner', exact: true }).click()
      await page.getByRole('complementary', { name: 'Release status', exact: true }).waitFor({ state: 'hidden' })
      await page.reload({ waitUntil: 'networkidle' })
      assert.equal(await page.getByRole('complementary', { name: 'Release status', exact: true }).count(), 0)
      await context.close()
    }
  } finally { await browser.close() }
})

