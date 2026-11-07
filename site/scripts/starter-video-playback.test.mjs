import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { routeBuiltSite } from './built-site.mjs'

test('the rebuilt starter-test recording loads and plays', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    const context = await browser.newContext()
    await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
    const page = await context.newPage()
    await page.goto('https://vibelang.sh/setup/new-project', { waitUntil: 'networkidle' })
    const state = await page.evaluate(async () => {
      const video = document.createElement('video')
      video.src = '/videos/term-test.mp4'
      video.muted = true
      document.body.append(video)
      await video.play()
      await new Promise(resolve => setTimeout(resolve, 500))
      const result = { time: video.currentTime, width: video.videoWidth, height: video.videoHeight, error: video.error?.message }
      video.pause()
      video.remove()
      return result
    })
    assert.equal(state.error, undefined)
    assert(state.time > 0)
    assert.equal(state.width, 1280)
    assert.equal(state.height, 720)
    await context.close()
  } finally { await browser.close() }
})
