import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicOutput, assertPublicOutput } from './record-ecosystem.mjs'

const site = fileURLToPath(new URL('../', import.meta.url))
const fixture = join(site, 'videos/effect-lint')
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const temp = mkdtempSync(join(tmpdir(), 'effect-lint-recording-'))
const app = join(temp, 'my-app')
mkdirSync(join(app, 'src'), { recursive: true })
const env = { ...process.env, CI: '1', NO_COLOR: '1' }
for (const name of ['VIBELANG_BINARY', 'VIBELANG_RUNTIME', 'VIBELANG_RUNTIME_DIR']) delete env[name]
const run = args => {
  const result = spawnSync(args[0], args.slice(1), { cwd: app, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  console.log('recording stage:', JSON.stringify({ command: args.slice(0, 4), exitCode: result.status }))
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stdout + result.stderr)
  const output = publicOutput(result.stdout + result.stderr, app)
  assertPublicOutput(output)
  return output
}
let browser
try {
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'effect-lint-demo', private: true, type: 'module', dependencies: { vibelang: 'latest', 'vibelang-runtime': 'latest', effect: '4.1.1', '@effect/language-service': 'latest' } }))
  // Installation output is checked, but not displayed in the recording.
  const installed = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: app, env, encoding: 'utf8', timeout: 180_000 })
  if (installed.error || installed.status !== 0) throw new Error(installed.error?.message || installed.stdout + installed.stderr)
  const compilerVersion = JSON.parse(readFileSync(join(app, 'node_modules/vibelang/package.json'), 'utf8')).version
  copyFileSync(join(fixture, 'tsconfig.json'), join(app, 'tsconfig.json'))
  copyFileSync(join(fixture, 'pending.ts'), join(app, 'src/pending.ts'))
  const before = readFileSync(join(fixture, 'before.vibe'), 'utf8')
  const after = readFileSync(join(fixture, 'after.vibe'), 'utf8')
  writeFileSync(join(app, 'src/main.vibe'), before)
  const cli = join(app, 'node_modules/.bin/vibelang')
  const warning = run([cli, 'lint', '-p', 'tsconfig.json'])
  if (!/EK3897.*promiseInEffectSuccess/.test(warning)) throw new Error('Expected the real Promise success-channel warning.')
  writeFileSync(join(app, 'src/main.vibe'), after)
  const clean = run([cli, 'lint', '-p', 'tsconfig.json'])
  if (clean.includes('EK3897')) throw new Error('The corrected Effect must not retain the warning.')
  const compiled = run([cli, '-p', 'tsconfig.json'])
  const program = 'import { Effect } from "effect"; import { program } from "./dist/main.js"; console.log(await Effect.runPromise(program))'
  const executed = run(['node', '--input-type=module', '-e', program])
  if (executed !== '1') throw new Error('The corrected Effect must await and return the Promise value.')
  const commands = [
    { command: 'vibelang lint -p tsconfig.json', exitCode: 0, output: warning },
    { command: 'vibelang lint -p tsconfig.json', exitCode: 0, output: clean },
    { command: 'vibelang -p tsconfig.json', exitCode: 0, output: compiled },
    { command: "node --input-type=module -e '" + program + "'", exitCode: 0, output: executed },
  ]
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: temp, size: { width: 1280, height: 800 } } })
  const page = await context.newPage()
  await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><title>Effect lint</title><style>*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#e2e8f0;font:18px/1.35 monospace}header{padding:18px 28px;background:#172036;color:#cbd5e1}main{padding:20px 28px}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}#command{color:#93c5fd;margin-top:22px}</style><header></header><main><pre id="source"></pre><pre id="command"></pre><pre id="output"></pre></main></html>')
  await page.locator('header').evaluate((e, text) => { e.textContent = text }, 'Effect lint · VibeLang ' + compilerVersion)
  const display = async (source, stages) => {
    await page.locator('#source').evaluate((e, text) => { e.textContent = text }, source)
    await page.locator('#command').evaluate(e => { e.textContent = '' })
    await page.locator('#output').evaluate(e => { e.textContent = '' })
    await page.waitForTimeout(1800)
    for (const stage of stages) {
      await page.locator('#command').evaluate((e, text) => { e.textContent += (e.textContent ? '\n' : '') + 'my-app $ ' + text }, stage.command)
      await page.locator('#output').evaluate((e, text) => { e.textContent = text }, stage.output || '(no diagnostics)')
      const bottom = await page.locator('main').evaluate(e => e.getBoundingClientRect().bottom)
      if (bottom > 800) throw new Error('The recording would crop its output.')
      await page.waitForTimeout(3500)
    }
  }
  await display('// tsconfig.json · compilerOptions\n' + JSON.stringify({ plugins: [{ name: '@effect/language-service' }] }, null, 2) + '\n\n// src/pending.ts\n' + readFileSync(join(fixture, 'pending.ts'), 'utf8') + '\n// src/main.vibe\n' + before, commands.slice(0, 1))
  const poster = join(temp, 'eco-lint-effect.jpg')
  await page.screenshot({ path: poster, type: 'jpeg', quality: 88 })
  await display('// src/main.vibe · await the Promise in the Effect\n' + after, commands.slice(1))
  const video = page.video()
  await context.close()
  const mp4 = join(temp, 'eco-lint-effect.mp4')
  const encoded = spawnSync('ffmpeg', ['-v', 'error', '-i', await video.path(), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', mp4], { encoding: 'utf8', timeout: 180_000 })
  if (encoded.error || encoded.status !== 0) throw new Error(encoded.error?.message || encoded.stderr)
  const inputs = Object.fromEntries(['before.vibe', 'after.vibe', 'pending.ts', 'tsconfig.json'].map(file => [file, hash(join(fixture, file))]))
  const proof = { schema: 1, compilerVersion, effectVersion: '4.1.1', source: before, sourceSha256: hash(join(fixture, 'before.vibe')), inputs, command: commands[0].command, exitCode: 0, output: warning, commands, videoSha256: hash(mp4), posterSha256: hash(poster) }
  copyFileSync(mp4, join(site, 'public/videos/eco-lint-effect.mp4'))
  copyFileSync(poster, join(site, 'public/videos/eco-lint-effect.jpg'))
  writeFileSync(join(site, 'videos/ecosystem/eco-lint-effect.json'), JSON.stringify(proof, null, 2) + '\n')
} finally { await browser?.close(); rmSync(temp, { recursive: true, force: true }) }
