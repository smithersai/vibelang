import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const docsRoot = fileURLToPath(new URL('../', import.meta.url))
const basePatchFile = fileURLToPath(new URL('../patches/vocs-2.8.5-search-accessibility.patch', import.meta.url))
const deltaPatchFile = fileURLToPath(new URL('../patches/vocs-2.8.5-search-announcements-and-actions.patch', import.meta.url))
const hashes = {
  source: '1a5739418f3f89eaf75438056c2c60c59720d2447f1de9539aff1006ae549de2',
  patched: '3408d9a23708430ff81e8bae2dc5207e4123c1c3ef69051af77176bb782cc021',
  javascript: 'ecc2fd8eb51103894b63140abcd4739252cba10d5adb1978b5ccd15e95d79a69',
  map: 'd21605f96027ad99d3c3975752bc63411da68444e1e6ba4dc9aad844c9ff323f',
}
const previous = {
  source: '20e53e899bc97983fb12a7927e1dd09d4c589060ca24b66d700e0ab5a51e8986',
  javascript: '80b31bb0fc92ec8bfdd66a5238b98dce5ce8de4aceee83cca9cb0bbcb9a9274a',
  map: '22160a8a2b7920312c4cc67fab522605eef756232d83ba8ca8b68c7346059ff4',
}
const sha = value => createHash('sha256').update(value).digest('hex')

function applyPatch(source, patchFile, expectedHash) {
  const temporary = mkdtempSync(join(tmpdir(), 'vibelang-vocs-search-'))
  try {
    const staged = join(temporary, 'src/react/internal/Search.tsx')
    mkdirSync(dirname(staged), { recursive: true })
    writeFileSync(staged, source)
    const result = spawnSync('patch', ['--batch', '--forward', '--fuzz=0', '-p1', '-d', temporary, '-i', patchFile], { encoding: 'utf8' })
    if (result.error || result.status !== 0)
      throw new Error(`Could not apply the Vocs source patch: ${result.error?.message ?? result.stderr ?? result.status}`)
    const next = readFileSync(staged, 'utf8')
    if (sha(next) !== expectedHash) throw new Error('Patched Vocs source hash did not match the reviewed patch.')
    return next
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

/** Patch only an owned npm dependency; never follow a workspace's borrowed module links. */
export function patchVocsSearch(root = docsRoot) {
  const expected = join(realpathSync(root), 'node_modules/vocs')
  if (realpathSync(expected) !== expected)
    throw new Error('Refusing to patch borrowed Vocs dependencies. Use an owned node_modules/vocs directory.')
  const version = JSON.parse(readFileSync(join(expected, 'package.json'), 'utf8')).version
  if (version !== '2.8.5')
    throw new Error(`Unsupported Vocs ${version}; review or remove the search accessibility patch before upgrading.`)
  const sourceFile = join(expected, 'src/react/internal/Search.tsx')
  const javascriptFile = join(expected, 'dist/react/internal/Search.js')
  const mapFile = `${javascriptFile}.map`
  for (const file of [sourceFile, javascriptFile, mapFile]) {
    if (realpathSync(file) !== file) throw new Error(`Refusing to patch borrowed Vocs file: ${file}`)
  }
  let source = readFileSync(sourceFile, 'utf8')
  const sourceHash = sha(source)
  const fromPrevious = sourceHash === previous.source
  if (sourceHash !== hashes.source && sourceHash !== hashes.patched && !fromPrevious)
    throw new Error('Vocs Search.tsx source hash changed; review the patch instead of applying it with fuzz.')
  if (sourceHash === hashes.source) {
    source = applyPatch(source, basePatchFile, previous.source)
    source = applyPatch(source, deltaPatchFile, hashes.patched)
  } else if (fromPrevious) {
    source = applyPatch(source, deltaPatchFile, hashes.patched)
  }
  // Vocs ships source and compiled modules; its CLI loads dist. Recompile this
  // one module only, retaining the upstream package, license and build pipeline.
  const output = ts.transpileModule(source, {
    fileName: 'Search.tsx', reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX, sourceMap: true, inlineSources: true,
      sourceRoot: '../../../src/react/internal', newLine: ts.NewLineKind.LineFeed,
    },
  })
  if (output.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error))
    throw new Error('Patched Vocs Search.tsx did not compile.')
  const expectedOriginal = fromPrevious ? previous : hashes
  const changes = [
    [javascriptFile, output.outputText, expectedOriginal.javascript],
    [mapFile, output.sourceMapText, expectedOriginal.map],
    [sourceFile, source, expectedOriginal.source],
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
    const result = patchVocsSearch()
    console.log(`Vocs ${result.version} search accessibility patch ${result.changed ? 'applied' : 'already applied'}.`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
