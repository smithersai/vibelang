import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
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

// Long paths, URLs and code spans have no break opportunity, so on a phone they ran past the
// right edge, where the article's overflow-x: hidden cut them off. Content inside a scrolling
// container (code blocks, tables) may be wider: the reader can scroll it.
function cutOff() {
  const width = document.documentElement.clientWidth
  const scrolls = element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) return parent.getBoundingClientRect().right <= width + 1
    }
    return false
  }
  const name = element => element.tagName.toLowerCase() + ' "' + (element.textContent ?? '').trim().slice(0, 50) + '"'
  const result = []
  if (document.scrollingElement.scrollWidth > width) result.push(`page scrolls sideways to ${document.scrollingElement.scrollWidth} px`)
  for (const element of document.querySelectorAll('header *, nav *, main *')) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') continue
    const box = element.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    if (scrolls(element)) continue
    if (box.right > width + 1 && box.left < width) result.push(`${name(element)} ends at ${Math.round(box.right)} px`)
    const ownText = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
    if (ownText && box.width < 2) result.push(`${name(element)} is ${box.width} px wide`)
  }
  return result
}

test('no docs page cuts off or collapses text at 390 px', { timeout: 10 * 60_000 }, async () => {
  const pages = ['/']
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(dir, entry.name)
      if (existsSync(join(path, 'index.html'))) pages.push('/' + relative(site, path))
      walk(path)
    }
  }
  walk(site)
  assert(pages.length > 200, `expected the whole built site, found ${pages.length} pages`)
  const browser = await launch()
  const problems = []
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await routeBuiltSite(context, site)
    // Four tabs share the pages, which keeps the whole site near a minute.
    const queue = pages.sort()
    await Promise.all(Array.from({ length: 4 }, async () => {
      const page = await context.newPage()
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        await page.goto('https://vibelang.sh' + path, { waitUntil: 'networkidle' })
        for (const problem of await page.evaluate(cutOff)) problems.push(`${path}: ${problem}`)
      }
    }))
    await context.close()
  } finally { await browser.close() }
  problems.sort()
  assert.deepEqual(problems, [], `${problems.length} elements cut off or collapsed at 390 px:\n${problems.join('\n')}`)
})
