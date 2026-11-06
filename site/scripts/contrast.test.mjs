import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { routeBuiltSite } from './built-site.mjs'
import { auditPageContrast } from './contrast-audit.mjs'
import { checkSiteContrast } from './contrast.mjs'

// The normal adapter opens another renderer to combine partial results. Under
// host OOM that killed the source renderer during a repeated color audit.
// Keep the single-document audit complete while forbidding that allocation.
test('single document contrast audits need no helper page', async t => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true,
    args: ['--disable-dev-shm-usage'],
  })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    context.newPage = async () => { throw new Error('contrast audit must not allocate a helper page') }
    for (const [theme, background, foreground, poor] of [
      ['light', '#fff', '#000', '#aaa'],
      ['dark', '#111', '#fff', '#222'],
    ]) {
      for (const shadow of [false, true]) {
        await t.test(theme + (shadow ? ' shadow root' : ' document'), async () => {
          await page.setContent('<html lang="en"><head><title>Contrast fixture</title></head><body style="background:' + background + '"></body></html>')
          await page.evaluate(({ foreground, poor, shadow }) => {
            const root = shadow ? document.body.appendChild(document.createElement('section')).attachShadow({ mode: 'open' }) : document.body
            root.innerHTML = '<p class="good" style="color:' + foreground + ';font:16px Arial">Readable fixture text</p>' +
              '<p class="bad" style="color:' + poor + ';font:16px Arial">Unreadable fixture text</p>'
          }, { foreground, poor, shadow })
          const result = await auditPageContrast(page)
          assert.deepEqual(result.violations.map(rule => rule.id), ['color-contrast'])
          const targets = result.violations.flatMap(rule => rule.nodes.map(node => JSON.stringify(node.target)))
          assert(targets.some(target => target.includes('.bad')), JSON.stringify(targets))
          assert(targets.every(target => !target.includes('.good')), JSON.stringify(targets))
          assert.equal(context.pages().length, 1)
        })
      }
    }
    await t.test('frames require an explicit audit strategy', async () => {
      await page.setContent('<iframe srcdoc="<p>Child frame</p>"></iframe>')
      await assert.rejects(() => auditPageContrast(page), /single document.*frames/i)
    })
  } finally {
    await browser.close()
  }
})

// Run "bun run build" and "bunx playwright install chromium" in site/ first.
test('built home, onboarding and cheat sheet have zero contrast violations in both themes', { timeout: 600_000 }, checkSiteContrast)

test('built media routes finish metadata navigation with the real video', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'built-media-'))
  let browser
  try {
    await mkdir(join(root, 'videos'))
    await copyFile(new URL('../public/videos/runthrough.mp4', import.meta.url), join(root, 'videos/clip.mp4'))
    await writeFile(join(root, 'index.html'), '<!doctype html><html lang="en"><title>Media metadata</title><video controls preload="metadata"><source src="/videos/clip.mp4" type="video/mp4"></video></html>')
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      headless: true, args: ['--disable-dev-shm-usage'],
    })
    const context = await browser.newContext()
    await routeBuiltSite(context, root)
    const page = await context.newPage()
    const statuses = []
    page.on('response', response => { if (response.request().resourceType() === 'media') statuses.push(response.status()) })
    await page.goto('https://vibelang.sh/', { waitUntil: 'networkidle', timeout: 10_000 })
    assert(statuses.length > 0)
    assert(statuses.every(status => status === 206), JSON.stringify(statuses))
    const state = await page.locator('video').evaluate(video => ({ ready: video.readyState, duration: video.duration, error: video.error?.code ?? null }))
    assert(state.ready >= 1)
    assert(Number.isFinite(state.duration) && state.duration > 0)
    assert.equal(state.error, null)
  } finally {
    await browser?.close()
    await rm(root, { recursive: true, force: true })
  }
})
