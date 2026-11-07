import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('wide documentation tables accept keyboard focus and horizontal scrolling', { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    for (const theme of ['light', 'dark']) for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ colorScheme: theme, viewport: { width, height: 1000 } })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      await page.goto('https://vibelang.sh/code-style/064-guidelines', { waitUntil: 'networkidle' })
      const audit = await new AxeBuilder({ page }).setLegacyMode().withRules(['scrollable-region-focusable']).analyze()
      assert.deepEqual(audit.violations.map(rule => ({ id: rule.id, targets: rule.nodes.map(node => node.target) })), [], theme + ' width=' + width)
      const wrapper = page.locator('[data-v-table-wrapper]').first()
      assert.equal(await wrapper.getAttribute('tabindex'), '0')
      await wrapper.focus()
      await page.keyboard.press('Shift+Tab')
      assert.equal(await wrapper.evaluate(element => element === document.activeElement), false)
      await page.keyboard.press('Tab')
      assert.equal(await wrapper.evaluate(element => element === document.activeElement), true)
      const focus = await wrapper.evaluate(element => {
        const style = getComputedStyle(element)
        return { visible: element.matches(':focus-visible'), style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
      })
      assert.equal(focus.visible, true)
      assert.notEqual(focus.style, 'none')
      assert.ok(focus.width >= 2)
      if (width < 500) {
        assert.equal(await wrapper.evaluate(element => element.scrollWidth > element.clientWidth), true)
        await page.keyboard.press('ArrowRight')
        await page.waitForFunction(() => document.querySelector('[data-v-table-wrapper]').scrollLeft > 0)
        const position = await wrapper.evaluate(element => element.scrollLeft)
        await page.keyboard.press('ArrowLeft')
        await page.waitForFunction(position => document.querySelector('[data-v-table-wrapper]').scrollLeft < position, position)
      }
      await context.close()
    }
  } finally { await browser.close() }
})
