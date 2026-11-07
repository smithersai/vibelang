import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchVocsTables } from './patch-vocs-tables.mjs'

const installed = fileURLToPath(new URL('../node_modules/vocs/', import.meta.url))
const files = ['src/mdx.tsx', 'dist/mdx.js', 'dist/mdx.js.map']
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
  patchVocsTables(root)
  const before = snapshot()
  assert.equal(patchVocsTables(root).changed, false)
  assert.deepEqual(snapshot(), before)
})

for (const change of ['version', 'source', 'compiled module']) test(`unsupported ${change} changes fail before overwriting vendor files`, () => {
  const { root, vendor, snapshot } = fixture()
  if (change === 'version') {
    const path = join(vendor, 'package.json')
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    writeFileSync(path, JSON.stringify({ ...pkg, version: '2.10.3' }))
  } else writeFileSync(join(vendor, files[change === 'source' ? 0 : 1]), 'unreviewed vendor change')
  const before = snapshot()
  assert.throws(() => patchVocsTables(root), /Unsupported Vocs|source hash changed|unexpected changes/)
  assert.deepEqual(snapshot(), before)
})

test('a borrowed Vocs package is refused and the borrowed files remain unchanged', () => {
  const { vendor, snapshot } = fixture()
  const before = snapshot()
  const root = mkdtempSync(join(tmpdir(), 'vibelang-borrowed-vocs-test-'))
  roots.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(vendor, join(root, 'node_modules/vocs'), 'dir')
  assert.throws(() => patchVocsTables(root), /Refusing to patch borrowed/)
  assert.deepEqual(snapshot(), before)
})
