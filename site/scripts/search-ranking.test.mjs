import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

// A query that starts a page's title leads with that page. "install" once listed ten
// sections headed "Install" (Alchemy first) and no Installation page at all.
const expected = [
  ['install', '/getting-started/004-installation'],
  ['installation', '/getting-started/004-installation'],
  ['vite', '/setup/vite'],
  ['producer', '/vibelang-features/112-producers'],
  ['cheat', '/vibelang-features/115-cheat-sheet'],
]

test('the built search index ranks the page a query names first', { timeout: 120_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
    const page = await context.newPage()
    await page.goto('https://vibelang.sh/001-onboarding', { waitUntil: 'networkidle' })
    await page.locator('button:visible').filter({ hasText: /^Search/ }).click()
    const input = page.getByRole('combobox')
    const ranked = []
    for (const [query] of expected) {
      // Clear first, so the options read below belong to this query and not the previous one.
      await input.fill('')
      await page.getByRole('option').first().waitFor({ state: 'detached' })
      await input.fill(query)
      await page.getByRole('option').first().waitFor()
      const hrefs = await page.getByRole('option').locator('a').evaluateAll(links => links.slice(0, 3).map(link => link.getAttribute('href')))
      ranked.push([query, hrefs[0]?.split('#')[0], hrefs])
    }
    for (const [query, path] of expected) {
      const [, first, hrefs] = ranked.find(([q]) => q === query)
      assert.equal(first, path, `"${query}" must list ${path} first: ${JSON.stringify(hrefs)}`)
    }
    await context.close()
  } finally { await browser.close() }
})
