import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('the specification walkthrough plays from the built specification page', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--disable-dev-shm-usage'] })
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      await page.goto('https://vibelang.sh/spec/000-intro', { waitUntil: 'networkidle' })
      const video = page.locator('video').filter({ has: page.locator('source[src="/videos/spec-walkthrough.mp4"]') })
      assert.equal(await video.count(), 1)
      assert.equal(await video.getAttribute('controls') !== null, true)
      assert.equal(await video.getAttribute('poster'), '/videos/spec-walkthrough.jpg')
      await video.evaluate(async e => { e.muted = true; await e.play() })
      await page.waitForTimeout(600)
      const state = await video.evaluate(e => ({ time: e.currentTime, width: e.videoWidth, height: e.videoHeight, error: e.error?.message }))
      assert.equal(state.error, undefined)
      assert(state.time > 0)
      assert.equal(state.width, 1280)
      assert.equal(state.height, 900)
      await context.close()
    }
  } finally { await browser.close() }
})
