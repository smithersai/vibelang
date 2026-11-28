import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchVocsSearch } from './patch-vocs-search.mjs'

const installed = fileURLToPath(new URL('../node_modules/vocs/', import.meta.url))
const basePatchFile = fileURLToPath(new URL('../patches/vocs-2.8.5-search-accessibility.patch', import.meta.url))
const deltaPatchFile = fileURLToPath(new URL('../patches/vocs-2.8.5-search-announcements-and-actions.patch', import.meta.url))
const upstreamSourceHash = '1a5739418f3f89eaf75438056c2c60c59720d2447f1de9539aff1006ae549de2'
const previousSourceHash = '20e53e899bc97983fb12a7927e1dd09d4c589060ca24b66d700e0ab5a51e8986'
const files = ['src/react/internal/Search.tsx', 'dist/react/internal/Search.js', 'dist/react/internal/Search.js.map']
const sha = value => createHash('sha256').update(value).digest('hex')
const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vibelang-vocs-patch-test-'))
  roots.push(root)
  const vendor = join(root, 'node_modules/vocs')
  for (const name of files) {
    const target = join(vendor, name)
    mkdirSync(join(target, '..'), { recursive: true })
    copyFileSync(join(installed, name), target)
  }
  copyFileSync(join(installed, 'package.json'), join(vendor, 'package.json'))
  return { root, vendor, snapshot: () => files.map(name => readFileSync(join(vendor, name), 'utf8')) }
}

test('an applied patch is idempotent and leaves the same vendor files', () => {
  const { root, snapshot } = fixture()
  patchVocsSearch(root)
  const before = snapshot()
  assert.equal(patchVocsSearch(root).changed, false)
  assert.deepEqual(snapshot(), before)
})

test('applying the patches to upstream Vocs 2.8.5 source is deterministic for source, JS, and source map', () => {
  const { root, vendor, snapshot } = fixture()
  patchVocsSearch(root)
  const expected = snapshot()
  const revDelta = spawnSync('patch', ['-R', '--batch', '--fuzz=0', '-p1', '-d', vendor, '-i', deltaPatchFile], { encoding: 'utf8' })
  assert.equal(revDelta.status, 0, revDelta.stderr || revDelta.stdout)
  assert.equal(sha(readFileSync(join(vendor, files[0]), 'utf8')), previousSourceHash)
  const revBase = spawnSync('patch', ['-R', '--batch', '--fuzz=0', '-p1', '-d', vendor, '-i', basePatchFile], { encoding: 'utf8' })
  assert.equal(revBase.status, 0, revBase.stderr || revBase.stdout)
  assert.equal(sha(readFileSync(join(vendor, files[0]), 'utf8')), upstreamSourceHash)
  const result = patchVocsSearch(root)
  assert.equal(result.changed, true)
  assert.equal(result.version, '2.8.5')
  assert.deepEqual(snapshot(), expected)
  const [source, compiled, mapText] = expected
  assert.match(source, /aria-live="polite"/)
  assert.match(source, /role="status"/)
  assert.match(source, /canNavigate &&/)
  assert.match(source, /canSelect &&/)
  assert.match(compiled, /"aria-live": "polite"/)
  assert.match(compiled, /role: "status"/)
  assert.match(compiled, /canNavigate &&/)
  assert.match(compiled, /canSelect &&/)
  const map = JSON.parse(mapText)
  assert.equal(map.file, 'Search.js')
  assert.deepEqual(map.sources, ['Search.tsx'])
  assert.equal(map.sourcesContent[0], source)
})

for (const change of ['version', 'source', 'compiled module']) test(`unsupported ${change} changes fail before overwriting vendor files`, () => {
  const { root, vendor, snapshot } = fixture()
  if (change === 'version') {
    const path = join(vendor, 'package.json')
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...pkg, version: '2.10.3' }))
  } else writeFileSync(join(vendor, files[change === 'source' ? 0 : 1]), 'unreviewed vendor change')
  const before = snapshot()
  assert.throws(() => patchVocsSearch(root), /Unsupported Vocs|source hash changed|unexpected changes/)
  assert.deepEqual(snapshot(), before)
})

test('a borrowed Vocs package is refused and the borrowed files remain unchanged', () => {
  const { vendor, snapshot } = fixture()
  const before = snapshot()
  const root = mkdtempSync(join(tmpdir(), 'vibelang-borrowed-vocs-test-'))
  roots.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(vendor, join(root, 'node_modules/vocs'), 'dir')
  assert.throws(() => patchVocsSearch(root), /Refusing to patch borrowed/)
  assert.deepEqual(snapshot(), before)
})
