import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicOutput, assertPublicOutput } from './record-ecosystem.mjs'

const site = fileURLToPath(new URL('../', import.meta.url))
const fixture = join(site, 'videos/ecosystem/vite')
const sha = value => createHash('sha256').update(value).digest('hex')
const hash = file => sha(readFileSync(file))
const temp = mkdtempSync(join(tmpdir(), 'vibelang-vite-video-'))
const env = { ...process.env, CI: '1', NO_COLOR: '1', npm_config_yes: 'true' }
for (const name of ['VIBELANG_BINARY', 'VIBELANG_RUNTIME', 'VIBELANG_RUNTIME_DIR']) delete env[name]
let browser, server
const run = (args, cwd) => {
  const result = spawnSync(args[0], args.slice(1), { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  console.log('recording stage:', JSON.stringify({ command: args.slice(0, 3), exitCode: result.status }))
  if (result.error || result.status !== 0) throw new Error(args.join(' ') + ': ' + (result.error?.message || result.stdout + result.stderr))
  return result.stdout + result.stderr
}
try {
  run(['bun', 'create', 'vibelang@latest', 'my-app'], temp)
  const app = join(temp, 'my-app')
  run(['npm', 'install', '--save-dev', 'vite', 'vibelang-vite@latest'], app)
  mkdirSync(join(app, 'src'), { recursive: true })
  for (const file of ['index.html', 'vite.config.ts', 'tsconfig.json']) copyFileSync(join(fixture, file), join(app, file))
  for (const file of ['main.ts', 'greet.vibe']) copyFileSync(join(fixture, file), join(app, 'src', file))
  let serverLog = ''
  server = spawn('npm', ['exec', '--', 'vite', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: app, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverLog += chunk })
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('Vite stopped: ' + publicOutput(serverLog, app))
    try { if ((await fetch('http://127.0.0.1:4173')).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!ready) throw new Error('Vite did not start: ' + publicOutput(serverLog, app))
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: temp, size: { width: 1280, height: 800 } } })
  // Only change the displayed project prefix, including Vite's shadow-root overlay.
  await context.addInitScript(project => {
    const observed = new WeakSet()
    const clean = root => {
      if (!observed.has(root)) { observer.observe(root, { subtree: true, childList: true, characterData: true }); observed.add(root) }
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walk.nextNode())) if (node.textContent.includes(project)) node.textContent = node.textContent.replaceAll(project, 'my-app')
      for (const element of root.querySelectorAll('*')) if (element.shadowRoot) clean(element.shadowRoot)
    }
    const observer = new MutationObserver(() => clean(document))
    clean(document)
  }, app)
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' })
  await page.getByText('Hello, Ada!', { exact: true }).waitFor()
  const original = readFileSync(join(fixture, 'greet.vibe'), 'utf8')
  const stages = [{ stage: 'initial', source: original, output: 'Hello, Ada!' }]
  await page.waitForTimeout(2500)
  const broken = original.replace('greet(name: string)', 'greet(name: string): number')
  writeFileSync(join(app, 'src/greet.vibe'), broken)
  const overlay = page.locator('vite-error-overlay')
  await overlay.waitFor()
  await page.waitForTimeout(500)
  const diagnostic = await overlay.evaluate(element => {
    const root = element.shadowRoot || element
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const text = []
    let node
    while ((node = walk.nextNode())) if (!['STYLE', 'SCRIPT'].includes(node.parentElement?.tagName)) text.push(node.textContent)
    return text.join('\n').trim()
  })
  assertPublicOutput(diagnostic)
  if (!/TS2322/.test(diagnostic)) throw new Error('The real Vite overlay did not report TS2322: ' + diagnostic)
  stages.push({ stage: 'type-error', source: broken, diagnostic })
  await page.waitForTimeout(3500)
  const recovered = original.replace('Hello,', 'Hi,')
  writeFileSync(join(app, 'src/greet.vibe'), recovered)
  await page.getByText('Hi, Ada!', { exact: true }).waitFor()
  await overlay.waitFor({ state: 'detached' })
  stages.push({ stage: 'recovered', source: recovered, output: 'Hi, Ada!' })
  await page.waitForTimeout(1000)
  const poster = join(temp, 'vite-dev.jpg')
  await page.screenshot({ path: poster, type: 'jpeg', quality: 88 })
  await page.waitForTimeout(2500)
  const video = page.video()
  await context.close()
  const mp4 = join(temp, 'vite-dev.mp4')
  run(['ffmpeg', '-v', 'error', '-i', await video.path(), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', mp4], temp)
  copyFileSync(mp4, join(site, 'public/videos/vite-dev.mp4'))
  copyFileSync(poster, join(site, 'public/videos/vite-dev.jpg'))
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
  const inputs = Object.fromEntries(['index.html', 'main.ts', 'greet.vibe', 'vite.config.ts', 'tsconfig.json'].map(file => [file, hash(join(fixture, file))]))
  writeFileSync(join(site, 'videos/ecosystem/vite-dev.json'), JSON.stringify({ schema: 1, compilerVersion: manifest.devDependencies.vibelang, effectVersion: manifest.dependencies.effect, inputs, stages, videoSha256: hash(mp4), posterSha256: hash(poster) }, null, 2) + '\n')
} finally {
  await browser?.close()
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM') } catch {} }
  rmSync(temp, { recursive: true, force: true })
}
