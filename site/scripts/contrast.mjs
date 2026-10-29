import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const site = fileURLToPath(new URL('../', import.meta.url))
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' }

// Serve only the built output. No dev-server CSS, production assets or fixed ports.
async function serve(root) {
  await readFile(resolve(root, 'index.html'))
  const server = createServer(async (req, res) => {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return }
    for (const file of [path, resolve(path, 'index.html'), path + '.html']) {
      try {
        const body = await readFile(file)
        res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }).end(body)
        return
      } catch {}
    }
    res.writeHead(404).end('Not found')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, origin: 'http://127.0.0.1:' + server.address().port }
}

export async function checkSiteContrast() {
  const artifacts = process.env.CONTRAST_ARTIFACTS
  if (artifacts) await mkdir(artifacts, { recursive: true })
  const observations = []
  const failures = []
  const { server, origin } = await serve(resolve(site, 'dist/public'))
  let browser
  const check = (condition, message) => { if (!condition) failures.push(message) }
  try {
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      headless: true,
      args: ['--disable-dev-shm-usage'],
    })
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: theme })
      // Vocs' baseUrl also controls dynamic imports. Route that entire origin to
      // this build, including hydration chunks that do not exist in production.
      await context.route('https://vibelang.sh/**', async route => {
        const url = new URL(route.request().url())
        const response = await context.request.get(origin + url.pathname + url.search)
        await route.fulfill({ response })
      })
      for (const path of ['/', '/001-onboarding', '/vibelang-features/115-cheat-sheet']) {
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        const response = await page.goto('https://vibelang.sh' + path, { waitUntil: 'networkidle' })
        assert.equal(response.status(), 200, path + ' must load from the build')
        await page.evaluate(() => document.fonts.ready)
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme)
        if (path === '/' && artifacts) {
          await page.screenshot({ path: resolve(artifacts, 'home-1366-' + theme + '.png') })
        }
        const audit = async state => {
          const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
          const violations = []
          for (const node of result.violations.flatMap(rule => rule.nodes)) {
            const data = node.any.find(check => check.id === 'color-contrast')?.data
            const violation = { target: node.target, html: node.html, summary: node.failureSummary, data }
            violations.push(violation)
            check(false, theme + ' ' + path + ' ' + state + ' axe: ' + JSON.stringify(violation))
          }
          // Measure all code text, including tokens in inactive tabs or clipped
          // lines that axe may leave incomplete. Group colors to keep diagnostics small.
          const colors = state === 'default' ? await page.evaluate(() => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const painter = canvas.getContext('2d', { willReadFrequently: true })
            const rgb = value => {
              painter.clearRect(0, 0, 1, 1)
              painter.fillStyle = value
              painter.fillRect(0, 0, 1, 1)
              const [r, g, b, a] = painter.getImageData(0, 0, 1, 1).data
              return [r, g, b, a / 255]
            }
            const over = (front, back) => {
              const alpha = front[3] + back[3] * (1 - front[3])
              return [...front.slice(0, 3).map((v, i) =>
                alpha ? (v * front[3] + back[i] * back[3] * (1 - front[3])) / alpha : 0), alpha]
            }
            const rendered = (node, foreground = [0, 0, 0, 0]) => {
              for (; node; node = node.parentElement) {
                const css = getComputedStyle(node)
                foreground = over(foreground, rgb(css.backgroundColor))
                foreground[3] *= Number(css.opacity)
              }
              return over(foreground, [255, 255, 255, 1])
            }
            const luminance = color => color.slice(0, 3).map(v => {
              v /= 255
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
            }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
            const groups = new Map()
            const banner = document.querySelector('[data-v-banner-content]')
            if (!banner) throw new Error('Expected alpha banner')
            const tokens = [...document.querySelectorAll('[data-v-code-container] code, [data-v-code-container] code *')]
              .filter(el => [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
            if (!tokens.length) throw new Error('Expected highlighted code text')
            for (const el of [banner, ...tokens]) {
              const kind = el === banner ? 'banner' : 'code'
              const color = getComputedStyle(el).color
              const foreground = rendered(el, rgb(color)), background = rendered(el)
              const x = luminance(foreground), y = luminance(background)
              const contrast = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
              const key = JSON.stringify([kind, foreground, background])
              if (groups.has(key)) groups.get(key).count++
              else groups.set(key, { kind, color, foreground, background, contrast, count: 1, sample: el.textContent.trim().slice(0, 100) })
            }
            return [...groups.values()]
          }) : []
          for (const sample of colors) check(sample.contrast >= 4.5,
            theme + ' ' + path + ' ' + sample.kind + ' contrast ' + sample.contrast.toFixed(2) + ' < 4.5: ' + JSON.stringify(sample))
          observations.push({ theme, path, state, axe: violations, incomplete: result.incomplete, colors })
          console.log(theme, path, state, 'axe violations=' + violations.length,
            ...(colors.length ? ['banner=' + colors.find(c => c.kind === 'banner').contrast.toFixed(2),
              'code-min=' + Math.min(...colors.filter(c => c.kind === 'code').map(c => c.contrast)).toFixed(2),
              'code-colors=' + colors.filter(c => c.kind === 'code').length] : []))
        }
        await audit('default')
        if (path === '/vibelang-features/115-cheat-sheet') {
          const firstCode = page.locator('[data-v-code-container]').first()
          await firstCode.scrollIntoViewIfNeeded()
          await page.getByRole('button', { name: 'Return to top', exact: true }).waitFor({ state: 'visible' })
          if (artifacts) await firstCode.screenshot({
            path: resolve(artifacts, 'cheat-sheet-first-code-1366-' + theme + '.png'),
          })
          await audit('scrolled')
        }
        if (path === '/') {
          const button = page.locator('.vibelang-copy-prompt')
          for (const status of ['idle', 'copied', 'error']) {
            if (status !== 'idle') {
              await page.evaluate(status => {
                Object.defineProperty(navigator, 'clipboard', {
                  configurable: true,
                  value: { writeText: async () => { if (status === 'error') throw new Error('clipboard denied for regression check') } },
                })
              }, status)
              await button.click()
            }
            const label = { idle: 'Copy Prompt', copied: 'Prompt copied', error: 'Copy failed. Try again' }[status]
            for (const state of ['default', 'hover', 'active', 'focus']) {
              if (status !== 'idle') await button.click()
              await page.mouse.move(1360, 895)
              await button.evaluate(el => el.blur())
              if (state === 'hover' || state === 'active') await button.hover()
              if (state === 'active') await page.mouse.down()
              if (state === 'focus') {
                await button.focus()
                await page.keyboard.press('Shift+Tab')
                await page.keyboard.press('Tab')
              }
              await page.waitForTimeout(180)
              assert.equal(await button.innerText(), label, theme + ' ' + status + ' ' + state)
              if (state === 'active' || state === 'focus') {
                assert(await button.evaluate((el, state) => el.matches(state === 'focus' ? ':focus-visible' : ':active'), state))
              }
              const sample = await button.evaluate(el => {
                const canvas = document.createElement('canvas')
                canvas.width = canvas.height = 1
                const painter = canvas.getContext('2d', { willReadFrequently: true })
                // Chromium may return oklch(), color(srgb ...) or rgba().
                // Rasterize into sRGB so the calculation uses rendered colors.
                const rgb = value => {
                  painter.clearRect(0, 0, 1, 1)
                  painter.fillStyle = value
                  painter.fillRect(0, 0, 1, 1)
                  const [r, g, b, a] = painter.getImageData(0, 0, 1, 1).data
                  return [r, g, b, a / 255]
                }
                const over = (front, back) => {
                  const alpha = front[3] + back[3] * (1 - front[3])
                  return [...front.slice(0, 3).map((v, i) =>
                    alpha ? (v * front[3] + back[i] * back[3] * (1 - front[3])) / alpha : 0), alpha]
                }
                const rendered = (node, foreground = [0, 0, 0, 0]) => {
                  for (; node; node = node.parentElement) {
                    const css = getComputedStyle(node)
                    foreground = over(foreground, rgb(css.backgroundColor))
                    foreground[3] *= Number(css.opacity)
                  }
                  return over(foreground, [255, 255, 255, 1])
                }
                const contrast = (a, b) => {
                  const luminance = color => color.slice(0, 3).map(v => {
                    v /= 255
                    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
                  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
                  const x = luminance(a), y = luminance(b)
                  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
                }
                const css = getComputedStyle(el)
                const icon = getComputedStyle(el.querySelector('svg'))
                const opacity = node => {
                  let value = 1
                  for (; node; node = node.parentElement) value *= Number(getComputedStyle(node).opacity)
                  return value
                }
                const text = (node, property = 'color') => {
                  const css = getComputedStyle(node)
                  const foreground = rgb(css[property])
                  if (property === 'stroke') foreground[3] *= Number(css.strokeOpacity)
                  return contrast(rendered(node, foreground), rendered(node))
                }
                const feedback = el.parentElement.querySelector('.vibelang-copy-prompt__feedback--' + (el.parentElement.dataset.status === 'error' ? 'error' : 'success'))
                const hero = [...document.querySelectorAll('.vibe-home__eyebrow, .vibe-home__tagline, .vibe-home__tagline span, .vibe-stat span, .vibe-stat strong')]
                  .map(node => ({ selector: node.className || node.parentElement.className + ' ' + node.tagName, contrast: text(node) }))
                const gradient = document.querySelector('.vibe-gradient')
                const stops = getComputedStyle(gradient).backgroundImage.match(/rgba?\([^)]+\)/g)
                if (!stops?.length) throw new Error('Expected rendered RGB gradient stops')
                return {
                  label: el.innerText, color: css.color, background: css.backgroundColor, opacity: opacity(el),
                  textContrast: text(el.querySelector('span')), iconContrast: text(el.querySelector('svg'), 'stroke'),
                  iconStroke: icon.stroke, fontSize: css.fontSize,
                  focusVisible: el.matches(':focus-visible'), outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth,
                  focusContrast: contrast(over(rgb(css.outlineColor), rendered(el.parentElement)), rendered(el.parentElement)),
                  feedbackContrast: text(feedback),
                  previewContrast: text(el.parentElement.querySelector('.vibelang-copy-prompt__prompt')),
                  hero, gradientContrast: Math.min(...stops.map(color => contrast(rgb(color), rendered(gradient.parentElement)))),
                }
              })
              observations.push({ theme, path, status, state, ...sample })
              const prefix = theme + ' ' + status + ' ' + state
              check(sample.textContrast >= 4.5, prefix + ' text contrast ' + sample.textContrast.toFixed(2) + ' < 4.5')
              check(sample.iconContrast >= 3, prefix + ' icon contrast ' + sample.iconContrast.toFixed(2) + ' < 3')
              check(sample.opacity === 1, prefix + ' button must remain opaque')
              if (state === 'focus') {
                check(sample.outlineStyle !== 'none' && parseFloat(sample.outlineWidth) >= 2 && sample.focusContrast >= 3,
                  prefix + ' focus outline contrast ' + sample.focusContrast.toFixed(2) + ' < 3 or outline missing')
              }
              if (status === 'idle' && state === 'hover') check(sample.previewContrast >= 4.5, prefix + ' prompt preview contrast ' + sample.previewContrast.toFixed(2) + ' < 4.5')
              if (status === 'idle' && state === 'default') {
                for (const item of sample.hero) check(item.contrast >= 4.5, theme + ' hero ' + item.selector + ' contrast ' + item.contrast.toFixed(2) + ' < 4.5')
                check(sample.gradientContrast >= 3, theme + ' large hero heading gradient contrast ' + sample.gradientContrast.toFixed(2) + ' < 3')
              }
              if (status !== 'idle') check(sample.feedbackContrast >= 4.5, prefix + ' feedback contrast ' + sample.feedbackContrast.toFixed(2) + ' < 4.5')
              if (state === 'active') {
                await page.mouse.move(1360, 895)
                await page.mouse.up()
              }
            }
            if (status !== 'idle') {
              // The button resets its feedback after 2 s (CopyPromptButton), and
              // axe can take longer on a loaded host. Hold that one timer until
              // the audit ends; axe's own timers run.
              await page.evaluate(() => {
                const setTimeout = window.setTimeout
                const held = []
                window.setTimeout = (callback, delay, ...args) =>
                  delay === 2_000 ? held.push(() => callback(...args)) : setTimeout(callback, delay, ...args)
                window.releaseFeedbackReset = () => { window.setTimeout = setTimeout; held.forEach(run => run()) }
              })
              await button.click()
              await page.mouse.move(1360, 895)
              await page.waitForTimeout(180)
              await audit(status)
              assert.equal(await button.innerText(), label, 'feedback must stay visible during axe')
              await page.evaluate(() => window.releaseFeedbackReset())
            }
          }
        }
        check(errors.length === 0, theme + ' ' + path + ' hydration errors: ' + JSON.stringify(errors))
        await page.close()
      }
      await context.close()
    }
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
    if (artifacts) await writeFile(resolve(artifacts, 'contrast.json'), JSON.stringify({ observations, failures }, null, 2) + '\n')
  }
  for (const observation of observations) {
    if ('textContrast' in observation) console.log(observation.theme, observation.status, observation.state,
      'text=' + observation.textContrast.toFixed(2), 'icon=' + observation.iconContrast.toFixed(2),
      'focus=' + observation.focusContrast.toFixed(2), 'feedback=' + observation.feedbackContrast.toFixed(2))
    else console.log(observation.theme, observation.path, observation.state, 'axe violations=' + observation.axe.length)
  }
  assert.equal(failures.length, 0, 'Built-site contrast regressions (WCAG 2.2 AA):\n' + failures.join('\n'))
}
