import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const site = fileURLToPath(new URL('../', import.meta.url))
const fc = createRequire(new URL('../../docs/tools/package.json', import.meta.url))('fast-check')

test('the production tree does not publish declaration files as pages', () => {
  for (const name of ['_root.d', '404.d']) assert.equal(existsSync(join(site, 'dist/public', name, 'index.html')), false, name + ' must not become a route')
  assert.ok(existsSync(join(site, 'dist/public/404.html')))
  assert.ok(existsSync(join(site, 'dist/public/index.html')))
})
test('generated declaration neighbours never shadow or add executable page routes', { timeout: 180_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'vocs-declaration-routes-'))
  const names = fc.sample(fc.uniqueArray(fc.array(fc.integer({ min: 97, max: 122 }), { minLength: 3, maxLength: 12 }).map(xs => 'page-' + String.fromCharCode(...xs)), { minLength: 12, maxLength: 12 }), { seed: 284191, numRuns: 1 })[0]
  try {
    mkdirSync(join(root, 'src/pages'), { recursive: true })
    symlinkSync(join(site, 'node_modules'), join(root, 'node_modules'), 'dir')
    writeFileSync(join(root, 'package.json'), '{"private":true,"type":"module"}')
    writeFileSync(join(root, 'vocs.config.ts'), 'import { defineConfig } from "vocs/config"; export default defineConfig({ title: "Route fixture", baseUrl: "https://fixture.example", renderStrategy: "full-static" })')
    writeFileSync(join(root, 'src/pages/index.mdx'), '# Route fixture\n')
    for (const name of names) {
      writeFileSync(join(root, 'src/pages', name + '.mdx'), '# ' + name + '\n\nExecutable page content.\n')
      writeFileSync(join(root, 'src/pages', name + '.d.ts'), 'export declare const metadata: unique symbol\n')
    }
    // An unrelated declaration must not add an empty page either.
    writeFileSync(join(root, 'src/pages/metadata-only.d.ts'), 'export declare function metadataOnly(): never\n')
    const result = spawnSync(process.execPath, [join(site, 'node_modules/vocs/dist/cli.js'), 'build'], { cwd: root, encoding: 'utf8', timeout: 150_000, maxBuffer: 16 * 1024 * 1024 })
    console.log('declaration route fixture build:', JSON.stringify({ pages: names.length + 1, declarations: names.length + 1, exitCode: result.status }))
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-12000))
    for (const name of names) {
      const page = join(root, 'dist/public', name, 'index.html')
      assert.ok(existsSync(page), name)
      assert.match(readFileSync(page, 'utf8'), /Executable page content/)
      assert.equal(existsSync(join(root, 'dist/public', name + '.d', 'index.html')), false, name + '.d must not become a route')
    }
    for (const name of ['metadata-only.d', '_root.d', '404.d']) assert.equal(existsSync(join(root, 'dist/public', name, 'index.html')), false, name)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
