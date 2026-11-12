import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

const site = fileURLToPath(new URL('../dist/public', import.meta.url))
const launch = () => chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  headless: true, args: ['--disable-dev-shm-usage'],
})

// A phone reader needs the install command and the version pins as much as a desktop reader.
// A breakpoint rule once collapsed both to zero width below 560 px.
test('home install commands and Compatibility note keep their width on a phone and a desktop', { timeout: 60_000 }, async () => {
  const browser = await launch()
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      await routeBuiltSite(context, site)
      const page = await context.newPage()
      await page.goto('https://vibelang.sh/', { waitUntil: 'networkidle' })
      const install = page.locator('#vibe-home-install')
      const compatibility = page.locator('.vibe-home__try blockquote').filter({ hasText: 'Compatibility.' })
      const least = Math.min(width - 80, 400)
      for (const [name, locator] of [['install commands', install], ['Compatibility note', compatibility]]) {
        assert.equal(await locator.count(), 1, `width=${width}: one ${name}`)
        const box = await locator.boundingBox()
        assert(box && box.width >= least && box.x >= 0 && box.x + box.width <= width,
          `width=${width}: the ${name} must be at least ${least} px wide and fit the viewport: ${JSON.stringify(box)}`)
      }
      assert((await install.innerText()).includes('npm create vibelang@latest my-app'))
      await context.close()
    }
  } finally { await browser.close() }
})
