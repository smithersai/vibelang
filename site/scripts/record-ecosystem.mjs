import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function publicOutput(text, project) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replaceAll(project, 'my-app')
    .replaceAll(project.replaceAll('\\', '/'), 'my-app')
    .split('\n').filter(line => !/^\s*Start at\s+\d{2}:\d{2}:\d{2}\s*$/.test(line)).join('\n').trim()
}
export function assertPublicOutput(text) {
  if (/(?:^|[\s(])(?:[A-Za-z]:\\|\/(?:[^/\s]+\/){2})/m.test(text))
    throw new Error('Recording output contains an absolute machine path.')
}
const site = fileURLToPath(new URL('../', import.meta.url))
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
export async function recordEcosystem() {
  const temp = mkdtempSync(join(tmpdir(), 'vibelang-ecosystem-video-'))
  let browser
  const run = (args, cwd, expected = 0) => {
    const env = { ...process.env, CI: '1', NO_COLOR: '1', npm_config_yes: 'true' }
    for (const name of ['VIBELANG_BINARY', 'VIBELANG_RUNTIME', 'VIBELANG_RUNTIME_DIR']) delete env[name]
    const started = Date.now()
    const result = spawnSync(args[0], args.slice(1), { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
    console.log('recording stage:', JSON.stringify({ command: args.slice(0, 3), exitCode: result.status, elapsedMs: Date.now() - started }))
    if (result.error || result.status !== expected) throw new Error(args.join(' ') + ': ' + (result.error?.message || result.stdout + result.stderr))
    return result.stdout + result.stderr
  }
  try {
    run(['bun', 'create', 'vibelang@latest', 'my-app'], temp)
    const app = join(temp, 'my-app')
    run(['npm', 'install', '--save-dev', 'eslint', 'typescript-eslint'], app)
    const fixture = join(site, 'videos/ecosystem')
    for (const file of ['eslint.config.mjs', 'lint.vibe']) copyFileSync(join(fixture, file), join(app, file))
    const eslintOutput = publicOutput(run(['npx', '--no-install', 'eslint', 'lint.vibe'], app, 1), app)
    if (!/no-unused-vars/.test(eslintOutput) || !/unused/.test(eslintOutput)) throw new Error('ESLint must report the written unused variable.')
    const vitestOutput = publicOutput(run(['bun', 'run', 'test'], app), app)
    if (!/Tests\s+2 passed/.test(vitestOutput)) throw new Error('Both published starter tests must pass.')
    const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--disable-dev-shm-usage'] })
    const clips = [
      { name: 'eco-lint-eslint', title: 'ESLint on VibeLang', source: readFileSync(join(fixture, 'lint.vibe'), 'utf8'), command: 'npx eslint lint.vibe', exitCode: 1, output: eslintOutput },
      { name: 'eco-vitest', title: 'Vitest on VibeLang', source: readFileSync(join(app, 'src/greeting.test.vibe'), 'utf8'), command: 'bun run test', exitCode: 0, output: vitestOutput },
    ]
    for (const clip of clips) {
      assertPublicOutput(clip.output)
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: temp, size: { width: 1280, height: 800 } } })
      const page = await context.newPage()
      await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><title>VibeLang ecosystem</title><style>*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#e2e8f0;font:18px/1.25 monospace}header{padding:18px 28px;background:#172036;color:#cbd5e1}main{padding:20px 28px}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}#command{color:#93c5fd;margin-top:18px}</style><header></header><main><pre id="source"></pre><pre id="command"></pre><pre id="output"></pre></main></html>')
      await page.locator('header').evaluate((e, text) => { e.textContent = text }, clip.title + ' · VibeLang ' + manifest.devDependencies.vibelang)
      await page.locator('#source').evaluate((e, text) => { e.textContent = text }, clip.source)
      await page.waitForTimeout(1500)
      const command = 'my-app $ ' + clip.command
      for (let i = 1; i <= command.length; i++) {
        await page.locator('#command').evaluate((e, text) => { e.textContent = text }, command.slice(0, i))
        await page.waitForTimeout(50)
      }
      await page.locator('#output').evaluate((e, text) => { e.textContent = text }, clip.output)
      const height = await page.locator('main').evaluate(e => e.getBoundingClientRect().bottom)
      console.log('recording layout:', JSON.stringify({ clip: clip.name, contentBottom: height, frameHeight: 800 }))
      if (height > 800) throw new Error('The recording would crop its output.')
      const poster = join(temp, clip.name + '.jpg')
      await page.screenshot({ path: poster, type: 'jpeg', quality: 88 })
      await page.waitForTimeout(4000)
      const video = page.video()
      await context.close()
      const mp4 = join(temp, clip.name + '.mp4')
      run(['ffmpeg', '-v', 'error', '-i', await video.path(), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', mp4], temp)
      const proof = { schema: 1, compilerVersion: manifest.devDependencies.vibelang, effectVersion: manifest.dependencies.effect, source: clip.source, sourceSha256: createHash('sha256').update(clip.source).digest('hex'), command: clip.command, exitCode: clip.exitCode, output: clip.output, videoSha256: hash(mp4), posterSha256: hash(poster) }
      copyFileSync(mp4, join(site, 'public/videos', clip.name + '.mp4'))
      copyFileSync(poster, join(site, 'public/videos', clip.name + '.jpg'))
      writeFileSync(join(fixture, clip.name + '.json'), JSON.stringify(proof, null, 2) + '\n')
    }
  } finally { await browser?.close(); rmSync(temp, { recursive: true, force: true }) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await recordEcosystem()
