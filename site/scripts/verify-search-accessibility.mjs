import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

// Reuse an existing Playwright installation; this check never installs a browser.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.BASE_URL || 'https://vibelang.sh'
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600 })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const checks = [], errors = []
    page.on('pageerror', error => errors.push(error.message))
    if (base !== 'https://vibelang.sh') {
      // Vocs imports canonical-domain assets. Keep both the page and those
      // assets on the selected build instead of silently testing production JS.
      await context.route('https://vibelang.sh/**', async route => {
        const url = new URL(route.request().url())
        await route.fulfill({ response: await route.fetch({ url: base + url.pathname + url.search }) })
      })
    }
    const activeResult = async () => {
      const state = await page.getByRole('combobox').evaluate(input => {
        const id = input.getAttribute('aria-activedescendant')
        const listId = input.getAttribute('aria-controls')
        const target = id ? document.getElementById(id) : null
        const list = listId ? document.getElementById(listId) : null
        const options = [...(list?.querySelectorAll('[role="option"]') ?? [])]
        return {
          id, listId, role: target?.getAttribute('role'), selected: target?.getAttribute('aria-selected'),
          contained: !!target && !!list?.contains(target), focused: document.activeElement === input,
          expanded: input.getAttribute('aria-expanded'), name: input.getAttribute('aria-label'),
          ids: options.map(option => option.id), href: target?.querySelector('a')?.getAttribute('href'),
        }
      })
      assert.ok(state.id, 'the focused search must identify its selected result')
      assert.equal(state.role, 'option')
      assert.equal(state.selected, 'true')
      assert.equal(state.contained, true)
      assert.equal(state.focused, true)
      assert.equal(state.expanded, 'true')
      assert.equal(state.name, 'Search documentation')
      assert.ok(state.ids.every(Boolean))
      assert.equal(new Set(state.ids).size, state.ids.length)
      return state
    }
    try {
      await page.goto('https://vibelang.sh/001-onboarding', { waitUntil: 'networkidle' })
      const trigger = width < 600 ? page.locator('button:visible[aria-label="Search"]') : page.locator('button:visible').filter({ hasText: /^Search/ })
      await trigger.focus()
      await page.keyboard.press('Enter')
      const input = page.getByRole('combobox')
      const dialog = page.getByRole('dialog')
      const status = dialog.locator('[role="status"][aria-live="polite"]')
      const keyboardHints = async () => dialog.evaluate(root =>
        [...root.querySelectorAll('span')].filter(span => span.querySelector('kbd')).map(span => ({
          text: span.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          visible: span.getClientRects().length > 0,
        }))
      )
      await input.fill('scope')
      await page.getByRole('option').first().waitFor()
      await status.filter({ hasText: /results? for "scope"/ }).waitFor({ state: 'attached' })
      const first = await activeResult()
      assert.equal(await status.textContent(), `${first.ids.length} ${first.ids.length === 1 ? 'result' : 'results'} for "scope"`)
      if (width >= 640) {
        const hints = (await keyboardHints()).filter(hint => hint.visible).map(hint => hint.text)
        assert.equal(hints.some(text => text.includes('navigate')), first.ids.length > 1)
        assert.equal(hints.some(text => text.includes('select')), true)
        assert.equal(hints.some(text => text.includes('close')), true)
      }
      await page.keyboard.press('ArrowDown')
      const second = await activeResult()
      assert.notEqual(second.id, first.id)
      await page.keyboard.press('ArrowUp')
      assert.equal((await activeResult()).id, first.id)
      checks.push('jump and regular results track keyboard selection with unique IDs')
      await input.fill('retry')
      await page.getByRole('option').filter({ hasText: /retry/i }).first().waitFor()
      await status.filter({ hasText: /results? for "retry"/ }).waitFor({ state: 'attached' })
      const retryState = await activeResult()
      assert.equal(await status.textContent(), `${retryState.ids.length} ${retryState.ids.length === 1 ? 'result' : 'results'} for "retry"`)
      checks.push('changed results retain a valid selected descendant and announce updated count')
      await input.fill('vibelangnonexistentx20261018')
      await page.getByText('No results found', { exact: true }).waitFor()
      await status.filter({ hasText: /^No results found for "vibelangnonexistentx20261018"$/ }).waitFor({ state: 'attached' })
      assert.equal(await status.textContent(), 'No results found for "vibelangnonexistentx20261018"')
      assert.equal(await input.getAttribute('aria-activedescendant'), null)
      assert.equal(await input.getAttribute('aria-controls'), null)
      assert.equal(await input.getAttribute('aria-expanded'), 'false')
      if (width >= 640) {
        const hints = (await keyboardHints()).filter(hint => hint.visible).map(hint => hint.text)
        assert.equal(hints.some(text => text.includes('navigate')), false)
        assert.equal(hints.some(text => text.includes('select')), false)
        assert.equal(hints.some(text => text.includes('close')), true)
      }
      checks.push('empty results clear active descendant, announce empty state, and hide unusable keyboard actions')
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.waitForTimeout(400)
      assert.equal(await trigger.evaluate(element => document.activeElement === element), true)
      checks.push('Escape closes search and restores trigger focus')
      await page.keyboard.press('Meta+k')
      await input.fill('scope')
      await page.getByRole('option').first().waitFor()
      const shortcut = await activeResult()
      if (width < 600) assert.notEqual(shortcut.listId, first.listId)
      checks.push('responsive search instances have distinct listbox IDs')
      await page.keyboard.press('ArrowDown')
      const selected = await activeResult()
      await page.keyboard.press('Enter')
      await page.waitForURL('https://vibelang.sh' + selected.href)
      checks.push('Enter still navigates to the selected documentation result')
      await page.keyboard.press('Meta+k')
      await page.getByRole('option').first().waitFor()
      await activeResult()
      checks.push('recent results expose the selected descendant')
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      assert.deepEqual(errors, [])
      results.push({ width, passed: true, checks, pageErrors: errors })
    } catch (error) {
      results.push({ width, passed: false, checks, error: error.message, pageErrors: errors })
    } finally { await context.close() }
  }
} finally { await browser.close() }
const report = { base, passed: results.filter(result => result.passed).length, results }
console.log(JSON.stringify(report, null, 2))
if (process.env.OUTPUT_FILE) await writeFile(process.env.OUTPUT_FILE, JSON.stringify(report, null, 2))
if (results.some(result => !result.passed)) process.exitCode = 1
