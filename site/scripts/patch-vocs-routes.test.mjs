import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchVocsRoutes } from './patch-vocs-routes.mjs'

const installed = fileURLToPath(new URL('../node_modules/vocs/', import.meta.url))
const modules = [['waku/internal/patches', 'router'], ['waku/internal', 'vite-plugins']]
const files = modules.flatMap(([directory, name]) => [
  'src/' + directory + '/' + name + '.ts',
  'dist/' + directory + '/' + name + '.js',
  'dist/' + directory + '/' + name + '.js.map',
])
const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vocs-routes-test-'))
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
test('the reviewed route filter is idempotent across both modules', () => {
  const { root, snapshot } = fixture()
  patchVocsRoutes(root)
  const before = snapshot()
  assert.equal(patchVocsRoutes(root).changed, false)
  assert.deepEqual(snapshot(), before)
})
for (const change of ['version', 'source', 'compiled module', 'map', 'sibling source']) test('unsupported ' + change + ' fails before writing either route module', () => {
  const { root, vendor, snapshot } = fixture()
  if (change === 'version') {
    const path = join(vendor, 'package.json')
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), version: '2.10.3' }))
  } else writeFileSync(join(vendor, files[{'source': 0, 'compiled module': 1, 'map': 2, 'sibling source': 3}[change]]), 'unreviewed change')
  const before = snapshot()
  assert.throws(() => patchVocsRoutes(root), /Unsupported Vocs|source hash changed|unexpected changes/)
  assert.deepEqual(snapshot(), before)
})
test('a borrowed route package stays unchanged', () => {
  const { vendor, snapshot } = fixture()
  const root = mkdtempSync(join(tmpdir(), 'vocs-routes-borrowed-'))
  roots.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(vendor, join(root, 'node_modules/vocs'), 'dir')
  const before = snapshot()
  assert.throws(() => patchVocsRoutes(root), /Refusing to patch borrowed/)
  assert.deepEqual(snapshot(), before)
})
test('install, development and build apply the route filter', () => {
  const site = fileURLToPath(new URL('../', import.meta.url))
  const pkg = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8'))
  const script = 'scripts/patch-vocs-routes.mjs'
  for (const hook of ['postinstall', 'predev']) assert.ok(pkg.scripts[hook].includes(script), hook)
  const build = readFileSync(join(site, 'scripts/build-docs.ts'), 'utf8')
  assert.ok(build.includes(JSON.stringify(script)))
  for (const match of build.matchAll(/\["(scripts\/patch-vocs-[^"]+\.mjs)"\]/g)) assert.ok(existsSync(join(site, match[1])), match[1])
})
