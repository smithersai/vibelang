import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = fileURLToPath(new URL('../', import.meta.url))
const input = join(site, 'videos/compiler-feedback/before.vibe')
const corrected = join(site, 'videos/compiler-feedback/after.vibe')
const assets = join(site, 'public/videos')
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')

export function recordingOutput(text, project) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replaceAll(project, 'my-app')
    .split('\n').filter(line => !/^\s*Start at\s+\d{2}:\d{2}:\d{2}\s*$/.test(line)).join('\n').trim()
}

export async function recordCompilerFeedback() {
  const temp = mkdtempSync(join(tmpdir(), 'vibelang-compiler-video-'))
  let browser
  const run = (args, cwd, expected = 0) => {
    const env = { ...process.env, CI: '1', npm_config_yes: 'true' }
    delete env.VIBELANG_BINARY
    delete env.VIBELANG_RUNTIME
    delete env.VIBELANG_RUNTIME_DIR
    const started = Date.now()
    const child = spawnSync(args[0], args.slice(1), {
      cwd, env,
      encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
    })
    console.log('recording stage:', JSON.stringify({ command: args.slice(0, 2).join(' '), exitCode: child.status, elapsedMs: Date.now() - started }))
    if (child.error || child.status !== expected) throw new Error(args.join(' ') + ' failed: ' + (child.error?.message ?? child.stdout + child.stderr))
    return child.stdout + child.stderr
  }
  try {
    run(['bun', 'create', 'vibelang@latest', 'my-app'], temp)
    const app = join(temp, 'my-app')
    const source = readFileSync(input, 'utf8')
    const after = readFileSync(corrected, 'utf8')
    writeFileSync(join(app, 'src/main.vibe'), source)
    const diagnostic = recordingOutput(run(['bun', 'run', 'build'], app, 1), app)
    if (!/error EK3801: floatingEffect:/.test(diagnostic)) throw new Error("Expected the starter's floatingEffect diagnostic.")
    writeFileSync(join(app, 'src/main.vibe'), after)
    const output = recordingOutput(run(['bun', 'run', 'start'], app), app)
    if (!output.includes('Hello, Ada!')) throw new Error('The corrected program must run its greeting.')
    const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
    const { chromium } = await import('playwright')
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--disable-dev-shm-usage'],
    })
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: temp, size: { width: 1280, height: 720 } } })
    const page = await context.newPage()
    await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><title>VibeLang compiler feedback</title><style>*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#e2e8f0;font:20px/1.38 monospace}header{padding:18px 28px;background:#172036;color:#cbd5e1}main{height:650px;overflow:hidden;padding:20px 28px}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}#command{color:#93c5fd;margin-top:18px}</style><header>VibeLang · compiler feedback</header><main><pre id="source"></pre><pre id="command"></pre><pre id="output"></pre></main></html>')
    await page.locator('header').evaluate((e, text) => { e.textContent = text }, 'VibeLang ' + manifest.devDependencies.vibelang + ' · compiler feedback')
    await page.locator('#source').evaluate((e, text) => { e.textContent = text }, 'my-app $ cat src/main.vibe\n' + source)
    await page.waitForTimeout(1800)
    await page.locator('#command').evaluate(e => { e.textContent = 'my-app $ bun run build' })
    await page.locator('#output').evaluate((e, text) => { e.textContent = text }, diagnostic)
    await page.waitForTimeout(4000)
    const poster = join(temp, 'agent-loop.jpg')
    await page.screenshot({ path: poster, type: 'jpeg', quality: 88 })
    await page.locator('#source').evaluate((e, text) => { e.textContent = text }, 'my-app $ cat src/main.vibe\n' + after)
    await page.locator('#command').evaluate(e => { e.textContent = 'my-app $ bun run start' })
    await page.locator('#output').evaluate((e, text) => { e.textContent = text }, output)
    await page.waitForTimeout(3500)
    const video = page.video()
    await context.close()
    const webm = await video.path()
    const mp4 = join(temp, 'agent-loop.mp4')
    run(['ffmpeg', '-v', 'error', '-i', webm, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', mp4], temp)
    const proof = {
      schema: 1,
      compilerVersion: manifest.devDependencies.vibelang,
      effectVersion: manifest.dependencies.effect,
      sourceSha256: hash(input), correctedSourceSha256: hash(corrected), videoSha256: hash(mp4), posterSha256: hash(poster),
      commands: [{ command: 'bun run build', exitCode: 1, output: diagnostic }, { command: 'bun run start', exitCode: 0, output }],
    }
    copyFileSync(mp4, join(assets, 'agent-loop.mp4'))
    copyFileSync(poster, join(assets, 'agent-loop.jpg'))
    writeFileSync(join(site, 'videos/compiler-feedback/recording.json'), JSON.stringify(proof, null, 2) + '\n')
    console.log('Recorded a real compiler diagnostic and the corrected program.')
  } finally {
    await browser?.close()
    rmSync(temp, { recursive: true, force: true })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await recordCompilerFeedback()
