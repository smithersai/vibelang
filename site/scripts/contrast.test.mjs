import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
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


// Installation commands must remain available when the hero becomes one column.
test('home install stays visible across responsive breakpoints', { timeout: 60_000 }, async () => {
  const css = await readFile(new URL('../src/pages/_root.css', import.meta.url), 'utf8')
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    const page = await browser.newPage()
    for (const theme of ['light', 'dark']) {
      for (const width of [320, 390, 560, 561, 768, 900, 901, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await page.setContent('<!doctype html><html lang="en" style="color-scheme:' + theme + '"><head><title>Install layout</title></head><body>' +
          '<main class="vibe-home"><section class="vibe-home__hero"><div class="vibe-home__intro"><h1>VibeLang</h1></div>' +
          '<div class="vibe-home__try"><div id="vibe-home-install"><div role="tablist">' +
          '<button role="tab">npm</button><button role="tab">bun</button></div>' +
          '<pre><code>npm create vibelang@latest my-app\ncd my-app\nnpm run start</code></pre></div></div>' +
          '</section></main></body></html>')
        await page.addStyleTag({ content: css })
        for (const selector of ['#vibe-home-install', '#vibe-home-install [role="tablist"]', '#vibe-home-install pre']) {
          assert(await page.locator(selector).isVisible(), theme + ' width=' + width + ': hidden ' + selector)
        }
      }
    }
  } finally { await browser.close() }
})

test('built home install selects npm and Bun commands at mobile and desktop widths', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ['--disable-dev-shm-usage'],
  })
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme: theme })
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      await page.goto('https://vibelang.sh/', { waitUntil: 'networkidle' })
      for (const width of [320, 390, 560, 561, 768, 900, 901, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        const install = page.locator('#vibe-home-install')
        assert(await install.isVisible(), theme + ' width=' + width + ': install must be visible')
        for (const manager of ['bun', 'npm']) {
          const tab = install.getByRole('tab', { name: manager, exact: true })
          await tab.click()
          assert.equal(await tab.getAttribute('aria-selected'), 'true')
          const command = await install.getByRole('tabpanel', { name: manager, exact: true }).innerText()
          assert(command.includes(manager + ' create vibelang@latest my-app'), command)
          assert(command.includes(manager + ' run start'), command)
        }
        const box = await install.boundingBox()
        assert(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width,
          theme + ' width=' + width + ': install must fit the viewport: ' + JSON.stringify(box))
      }
      await context.close()
    }
  } finally { await browser.close() }
})
