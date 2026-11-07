import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = fileURLToPath(new URL('../', import.meta.url))
const assets = join(site, 'public/videos')
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const temp = mkdtempSync(join(tmpdir(), 'vibelang-overview-video-'))
const run = args => {
  const result = spawnSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stdout + result.stderr)
  return result.stdout
}
try {
  const plans = [
    { name: 'ecosystem', names: ['eco-tsc', 'eco-format', 'eco-lint-effect', 'eco-lint-eslint', 'eco-lint-oxlint', 'eco-vitest', 'webpack', 'nvim-lsp'] },
    { name: 'runthrough', names: ['contract', 'infer', 'type-flip', 'retry', 'race', 'concurrent', 'vite-dev', 'ecosystem'] },
  ]
  for (const { name, names } of plans) {
  const segments = []
  for (const [index, name] of names.entries()) {
    const source = join(assets, name + '.mp4')
    const target = join(temp, index + '.mp4')
    const duration = Number(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', source]).trim())
    run(['ffmpeg', '-v', 'error', '-i', source, '-an', '-vf', 'scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', target])
    segments.push({ file: name + '.mp4', sha256: hash(source), duration })
    console.log('overview segment:', JSON.stringify({ file: name + '.mp4', duration }))
  }
  const list = join(temp, 'segments.txt')
  writeFileSync(list, names.map((_, index) => "file '" + join(temp, index + '.mp4').replaceAll("'", "'\\''") + "'").join('\n') + '\n')
  const output = join(temp, name + '.mp4')
  run(['ffmpeg', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', '-y', output])
  copyFileSync(output, join(assets, name + '.mp4'))
  copyFileSync(join(assets, 'eco-vitest.jpg'), join(assets, name + '.jpg'))
  writeFileSync(join(site, 'videos/ecosystem/' + name + '.json'), JSON.stringify({ schema: 1, kind: 'composition', segments, videoSha256: hash(output), posterSha256: hash(join(assets, name + '.jpg')) }, null, 2) + '\n')
  }
} finally { rmSync(temp, { recursive: true, force: true }) }
