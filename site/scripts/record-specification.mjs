import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = fileURLToPath(new URL('../', import.meta.url))
const assets = join(site, 'public/videos')
export const examples = [
  { name: 'effects', title: 'Effects and typed recovery', output: 'Hello, Ada!\nHello, guest!' },
  { name: 'services', title: 'Services and explicit providers', output: 'Hello, Ada!' },
  { name: 'data', title: 'Tagged data and exhaustive matching', output: 'waiting\nsent:parcel-7' },
]
export const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')
export function cleanOutput(text, project) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replaceAll(project, 'demo').trim()
}

export async function recordSpecification() {
  const temp = mkdtempSync(join(tmpdir(), 'vibelang-specification-'))
  let browser
  const run = (args, expected = 0) => {
    const env = { ...process.env, CI: '1', NO_COLOR: '1' }
    for (const key of ['VIBELANG_BINARY', 'VIBELANG_RUNTIME', 'VIBELANG_RUNTIME_DIR']) delete env[key]
    const child = spawnSync(args[0], args.slice(1), { cwd: temp, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
    console.log('specification stage:', JSON.stringify({ command: args.slice(0, 2), exitCode: child.status }))
    if (child.error || child.status !== expected) throw new Error(args.join(' ') + ': ' + (child.error?.message ?? child.stdout + child.stderr))
    return cleanOutput(child.stdout + child.stderr, temp)
  }
  try {
    writeFileSync(join(temp, 'package.json'), JSON.stringify({ name: 'specification-demo', private: true, type: 'module', dependencies: { vibelang: 'latest', 'vibelang-runtime': 'latest', effect: '4.1.1' } }))
    run(['npm', 'install', '--no-audit', '--no-fund'])
    mkdirSync(join(temp, 'src'))
    writeFileSync(join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: true, types: [], rootDir: 'src', outDir: 'dist' }, files: ['src/main.vibe'] }))
    const compiler = join(temp, 'node_modules/.bin/vibelang')
    const version = JSON.parse(readFileSync(join(temp, 'node_modules/vibelang/package.json'), 'utf8')).version
    const scenes = []
    for (const example of examples) {
      const sourceFile = join(site, 'videos/specification', example.name + '.vibe')
      const source = readFileSync(sourceFile, 'utf8')
      writeFileSync(join(temp, 'src/main.vibe'), source)
      const compile = run([compiler, '-p', 'tsconfig.json'])
      const output = run(['node', 'dist/main.js'])
      if (output !== example.output) throw new Error(example.name + ': unexpected output ' + JSON.stringify(output))
      scenes.push({ ...example, source, sourceSha256: sha256(sourceFile), commands: [{ command: 'npx vibelang -p tsconfig.json', exitCode: 0, output: compile }, { command: 'node dist/main.js', exitCode: 0, output }] })
    }
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--disable-dev-shm-usage'] })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: temp, size: { width: 1280, height: 900 } } })
    const page = await context.newPage()
    await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><title>VibeLang specification examples</title><style>*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#e2e8f0;font:22px/1.45 monospace}header{padding:18px 28px;background:#172036;color:#cbd5e1}main{padding:22px 28px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}#command{color:#93c5fd;margin-top:18px}</style><header></header><main><pre id="source"></pre><pre id="command"></pre><pre id="output"></pre></main></html>')
    let poster
    for (const scene of scenes) {
      await page.locator('header').evaluate((e, text) => { e.textContent = text }, 'VibeLang ' + version + ' · ' + scene.title)
      await page.locator('#source').evaluate((e, text) => { e.textContent = text }, 'demo $ cat src/main.vibe\n' + scene.source)
      await page.locator('#command').evaluate(e => { e.textContent = '' })
      await page.locator('#output').evaluate(e => { e.textContent = '' })
      await page.waitForTimeout(4000)
      await page.locator('#command').evaluate(e => { e.textContent = 'demo $ npx vibelang -p tsconfig.json && node dist/main.js' })
      await page.locator('#output').evaluate((e, text) => { e.textContent = text }, scene.output)
      const fits = await page.locator('main').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight)
      if (!fits) throw new Error('The recorded example must fit the viewport.')
      await page.waitForTimeout(4000)
      if (!poster) { poster = join(temp, 'spec-walkthrough.jpg'); await page.screenshot({ path: poster, type: 'jpeg', quality: 88 }) }
    }
    const video = page.video()
    await context.close()
    const mp4 = join(temp, 'spec-walkthrough.mp4')
    run(['ffmpeg', '-v', 'error', '-i', await video.path(), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', mp4])
    const proof = { schema: 1, compilerVersion: version, effectVersion: '4.1.1', videoSha256: sha256(mp4), posterSha256: sha256(poster), scenes }
    copyFileSync(mp4, join(assets, 'spec-walkthrough.mp4'))
    copyFileSync(poster, join(assets, 'spec-walkthrough.jpg'))
    writeFileSync(join(site, 'videos/specification/recording.json'), JSON.stringify(proof, null, 2) + '\n')
  } finally {
    await browser?.close()
    rmSync(temp, { recursive: true, force: true })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await recordSpecification()
