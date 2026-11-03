import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const siteRoot = fileURLToPath(new URL('../', import.meta.url))
const patchFile = fileURLToPath(new URL('../patches/vocs-2.8.5-llms-build-cache.patch', import.meta.url))
const hashes = {
  source: '3359f0721e5de40d6643e5fad233a54b7a2aa7d0abec116a8de2cdbb244aeda4',
  patched: '128e2fdf1e24d055fe7676c6254515e9f6e64c43b81fc76d41c682ba8e5d47e6',
  javascript: 'dcd0c3e7622c85109c8fff3da9ff388afe6f784a019fcd51b223a4e199f517fb',
  map: '0094ec6b6c0e3f1e627034e9b26987c8ad5ee2d0d80154944baac99ece94481d',
}
const sha = value => createHash('sha256').update(value).digest('hex')

/** Patch only an owned npm dependency; never follow a workspace's borrowed module links. */
export function patchVocsLlms(root = siteRoot) {
  const expected = join(realpathSync(root), 'node_modules/vocs')
  if (realpathSync(expected) !== expected)
    throw new Error('Refusing to patch borrowed Vocs dependencies. Use an owned node_modules/vocs directory.')
  const version = JSON.parse(readFileSync(join(expected, 'package.json'), 'utf8')).version
  if (version !== '2.8.5')
    throw new Error(`Unsupported Vocs ${version}; review or remove the LLM build cache patch before upgrading.`)
  const sourceFile = join(expected, 'src/internal/vite-plugins.ts')
  const javascriptFile = join(expected, 'dist/internal/vite-plugins.js')
  const mapFile = `${javascriptFile}.map`
  for (const file of [sourceFile, javascriptFile, mapFile]) {
    if (realpathSync(file) !== file) throw new Error(`Refusing to patch borrowed Vocs file: ${file}`)
  }
  let source = readFileSync(sourceFile, 'utf8')
  const sourceHash = sha(source)
  if (sourceHash !== hashes.source && sourceHash !== hashes.patched)
    throw new Error('Vocs vite-plugins.ts source hash changed; review the patch instead of applying it with fuzz.')
  if (sourceHash === hashes.source) {
    const temporary = mkdtempSync(join(tmpdir(), 'vibelang-vocs-llms-'))
    try {
      const staged = join(temporary, 'src/internal/vite-plugins.ts')
      mkdirSync(dirname(staged), { recursive: true })
      writeFileSync(staged, source)
      const result = spawnSync('patch', ['--batch', '--forward', '--fuzz=0', '-p1', '-d', temporary, '-i', patchFile], { encoding: 'utf8' })
      if (result.error || result.status !== 0)
        throw new Error(`Could not apply the Vocs source patch: ${result.error?.message ?? result.stderr ?? result.status}`)
      source = readFileSync(staged, 'utf8')
      if (sha(source) !== hashes.patched) throw new Error('Patched Vocs source hash did not match the reviewed patch.')
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  }
  // Vocs ships source and compiled modules; its CLI loads dist. Recompile this
  // one module only, retaining the upstream package, license and build pipeline.
  const output = ts.transpileModule(source, {
    fileName: 'vite-plugins.ts', reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      sourceMap: true, inlineSources: true,
      sourceRoot: '../../src/internal', newLine: ts.NewLineKind.LineFeed,
    },
  })
  if (output.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error))
    throw new Error('Patched Vocs vite-plugins.ts did not compile.')
  const changes = [
    [javascriptFile, output.outputText, hashes.javascript],
    [mapFile, output.sourceMapText, hashes.map],
    [sourceFile, source, hashes.source],
  ]
  for (const [file, value, originalHash] of changes) {
    if (typeof value !== 'string') throw new Error('Patched Vocs module output is incomplete.')
    const current = sha(readFileSync(file))
    if (current !== originalHash && current !== sha(value))
      throw new Error(`Vocs ${file.split('/').at(-1)} has unexpected changes; refusing to overwrite them.`)
  }
  let changed = false
  for (const [file, value] of changes) {
    if (sha(readFileSync(file)) === sha(value)) continue
    const staged = `${file}.vibelang-${process.pid}`
    try { writeFileSync(staged, value); renameSync(staged, file) }
    finally { rmSync(staged, { force: true }) }
    changed = true
  }
  return { changed, version }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = patchVocsLlms()
    console.log(`Vocs ${result.version} LLM build cache patch ${result.changed ? 'applied' : 'already applied'}.`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
