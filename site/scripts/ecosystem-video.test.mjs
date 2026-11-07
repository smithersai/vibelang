import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { routeBuiltSite } from './built-site.mjs'
import { fileURLToPath } from 'node:url'

const hash = value => createHash('sha256').update(value).digest('hex')
for (const [name, exitCode, expected] of [
  ['eco-lint-eslint', 1, /no-unused-vars/],
  ['eco-vitest', 0, /Tests\s+2 passed/],
]) {
  test(name + ' binds reviewed project-relative output to the shipped media', () => {
    const proof = JSON.parse(readFileSync(new URL('../videos/ecosystem/' + name + '.json', import.meta.url), 'utf8'))
    assert.equal(proof.exitCode, exitCode)
    assert.match(proof.output, expected)
    assert.match(proof.output, /my-app/)
    assert.doesNotMatch(proof.output, /(?:^|[\s(])(?:[A-Za-z]:\\|\/(?:[^/\s]+\/){2})/m)
    assert.equal(proof.sourceSha256, hash(proof.source))
    for (const [extension, key] of [['mp4', 'videoSha256'], ['jpg', 'posterSha256']])
      assert.equal(hash(readFileSync(new URL('../public/videos/' + name + '.' + extension, import.meta.url))), proof[key])
  })
  test(name + ' plays from the production site', { timeout: 60_000 }, async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--disable-dev-shm-usage'] })
    try {
      const context = await browser.newContext()
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      await page.goto('https://vibelang.sh' + (name === 'eco-vitest' ? '/setup/vite' : '/setup/developer-tools'), { waitUntil: 'networkidle' })
      const player = page.locator('video').filter({ has: page.locator('source[src="/videos/' + name + '.mp4"]') })
      await player.scrollIntoViewIfNeeded()
      await player.evaluate(video => video.play())
      await page.waitForFunction(name => {
        const video = [...document.querySelectorAll('video')].find(video => video.querySelector('source')?.getAttribute('src') === '/videos/' + name + '.mp4')
        return video && video.currentTime > 0.1 && !video.error
      }, name)
      assert.equal(await player.evaluate(video => video.error), null)
    } finally { await browser.close() }
  })
}

for (const [name, route] of [['ecosystem', '/setup'], ['vite-dev', '/setup/vite'], ['runthrough', '/']]) {
  test(name + ' binds its source workflow to the shipped media', () => {
    const proof = JSON.parse(readFileSync(new URL('../videos/ecosystem/' + name + '.json', import.meta.url), 'utf8'))
    for (const [extension, key] of [['mp4', 'videoSha256'], ['jpg', 'posterSha256']])
      assert.equal(hash(readFileSync(new URL('../public/videos/' + name + '.' + extension, import.meta.url))), proof[key])
    if (name !== 'vite-dev') {
      assert.deepEqual(proof.segments.map(segment => segment.file), (name === 'ecosystem' ? ['eco-tsc', 'eco-format', 'eco-lint-effect', 'eco-lint-eslint', 'eco-lint-oxlint', 'eco-vitest', 'webpack', 'nvim-lsp'] : ['contract', 'infer', 'type-flip', 'retry', 'race', 'concurrent', 'vite-dev', 'ecosystem']).map(file => file + '.mp4'))
      for (const segment of proof.segments)
        assert.equal(hash(readFileSync(new URL('../public/videos/' + segment.file, import.meta.url))), segment.sha256)
    } else {
      for (const [file, expected] of Object.entries(proof.inputs))
        assert.equal(hash(readFileSync(new URL('../videos/ecosystem/vite/' + file, import.meta.url))), expected)
      assert.deepEqual(proof.stages.map(stage => stage.stage), ['initial', 'type-error', 'recovered'])
      assert.equal(proof.stages[0].output, 'Hello, Ada!')
      assert.equal(proof.stages[2].output, 'Hi, Ada!')
      assert.match(proof.stages[1].diagnostic, /TS2322/)
      assert.match(proof.stages[1].diagnostic, /my-app/)
      assert.doesNotMatch(proof.stages[1].diagnostic, /(?:^|[\s(])(?:[A-Za-z]:\\|\/(?:[^/\s]+\/){2})/m)
    }
  })
  test(name + ' plays from the production site', { timeout: 60_000 }, async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--disable-dev-shm-usage'] })
    try {
      const context = await browser.newContext()
      await routeBuiltSite(context, fileURLToPath(new URL('../dist/public', import.meta.url)))
      const page = await context.newPage()
      await page.goto('https://vibelang.sh' + route, { waitUntil: 'networkidle' })
      const player = page.locator('video').filter({ has: page.locator('source[src="/videos/' + name + '.mp4"]') })
      await player.scrollIntoViewIfNeeded()
      await player.evaluate(video => video.play())
      await page.waitForFunction(name => {
        const video = [...document.querySelectorAll('video')].find(video => video.querySelector('source')?.getAttribute('src') === '/videos/' + name + '.mp4')
        return video && video.currentTime > 0.1 && !video.error
      }, name)
    } finally { await browser.close() }
  })
}
