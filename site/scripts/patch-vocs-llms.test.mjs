import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { patchVocsLlms } from './patch-vocs-llms.mjs'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const modules = join(site, 'node_modules')
const hash = value => createHash('sha256').update(value).digest('hex')
const files = ['src/internal/vite-plugins.ts', 'dist/internal/vite-plugins.js', 'dist/internal/vite-plugins.js.map']
const digests = root => files.map(file => hash(readFileSync(join(root, 'node_modules/vocs', file))))

function owned(t, apply = process.env.VOCS_LLMS_UNPATCHED !== '1') {
  const root = mkdtempSync(join(tmpdir(), 'vocs llms cache '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'node_modules'))
  for (const name of readdirSync(modules)) {
    if (name === 'vocs') cpSync(join(modules, name), join(root, 'node_modules', name), { recursive: true })
    else symlinkSync(join(modules, name), join(root, 'node_modules', name))
  }
  if (apply) patchVocsLlms(root)
  return root
}

async function model(root, name, pages = 2) {
  const { llms } = await import(pathToFileURL(join(root, 'node_modules/vocs/dist/internal/vite-plugins.js')))
  const Config = await import(pathToFileURL(join(root, 'node_modules/vocs/dist/internal/config.js')))
  const { resolveConfig } = await import(pathToFileURL(join(modules, 'vite/dist/node/index.js')))
  const project = join(root, name)
  mkdirSync(join(project, 'src/pages'), { recursive: true })
  const put = (index, body) => writeFileSync(join(project, 'src/pages', 'page-' + index + '.mdx'),
    '---\ntitle: "Fixture ' + index + ' 雪"\n---\n\n' + body + '\n')
  for (let i = 0; i < pages; i++) put(i, 'Original paragraph ' + i + '.')
  let calls = 0
  const config = {
    ...await Config.resolve({ rootDir: project }),
    markdown: { outputRemarkPlugins: [() => () => { calls++ }] },
  }
  const plugin = llms(config)
  const configure = async () => plugin.configResolved(await resolveConfig({ root: project, configFile: false }, 'build'))
  await configure()
  return {
    project, put, configure, calls: () => calls,
    build: (watch = false) => plugin.buildEnd.call({ meta: { watchMode: watch } }),
    output: () => readFileSync(join(project, 'dist/public/llms-full.txt'), 'utf8'),
  }
}

function snapshot(dir) {
  const out = []
  const walk = (current, prefix = '') => {
    for (const name of readdirSync(current).sort()) {
      const file = join(current, name), key = prefix + name
      if (lstatSync(file).isDirectory()) walk(file, key + '/')
      else out.push([key, readFileSync(file, 'utf8')])
    }
  }
  walk(dir)
  return out
}

test('repeated build environments generate once but restore every output file', async t => {
  const root = owned(t)
  for (let shape = 0; shape < 8; shape++) {
    const pages = 1 + shape % 4, environments = 2 + shape % 7
    const m = await model(root, 'shape-' + shape, pages)
    let first
    for (let i = 0; i < environments; i++) {
      // Later environments may empty the output directory. Reuse computation,
      // then publish the exact files again instead of skipping the whole hook.
      rmSync(join(m.project, 'dist/public'), { recursive: true, force: true })
      await m.build()
      const current = snapshot(join(m.project, 'dist/public'))
      if (first) assert.deepEqual(current, first)
      else first = current
      assert.equal(m.calls(), pages, 'one real Markdown transform per page in shape ' + shape)
    }
    assert.equal(first.length, pages + 2)
    assert.match(m.output(), /Original paragraph/)
  }
})

test('concurrent environment hooks share the real generation promise', async t => {
  const m = await model(owned(t), 'concurrent')
  await Promise.all(Array.from({ length: 8 }, () => m.build()))
  assert.equal(m.calls(), 2)
  assert.match(m.output(), /Original paragraph/)
})

test('watch builds stay fresh and cannot leave a stale non-watch cache', async t => {
  const m = await model(owned(t), 'watch')
  await m.build()
  await m.build()
  m.put(0, 'First watched update.')
  await m.build(true)
  m.put(0, 'Second watched update.')
  await m.build(true)
  m.put(0, 'After watch update.')
  await m.build()
  await m.build()
  assert.equal(m.calls(), 8)
  assert.match(m.output(), /After watch update/)
  assert.doesNotMatch(m.output(), /First watched update/)
})

test('a new resolved build reads changed pages', async t => {
  const m = await model(owned(t), 'rebuild')
  await m.build()
  m.put(0, 'A second build.')
  await m.configure()
  await m.build()
  assert.equal(m.calls(), 4)
  assert.match(m.output(), /A second build/)
})

test('a rejected generation can be retried after its input is fixed', async t => {
  const m = await model(owned(t), 'retry')
  m.put(0, '<Invalid')
  await assert.rejects(m.build())
  m.put(0, 'The repaired page.')
  await m.build()
  assert.match(m.output(), /The repaired page/)
})

test('patching is idempotent and generates the runtime map from patched source', t => {
  const root = owned(t, false)
  assert.equal(typeof patchVocsLlms(root).changed, 'boolean')
  const before = digests(root)
  assert.equal(patchVocsLlms(root).changed, false)
  assert.deepEqual(digests(root), before)
  const source = readFileSync(join(root, 'node_modules/vocs', files[0]), 'utf8')
  const map = JSON.parse(readFileSync(join(root, 'node_modules/vocs', files[2]), 'utf8'))
  assert.equal(map.sourcesContent[0], source)
  assert.equal(resolve(dirname(join(root, 'node_modules/vocs', files[2])), map.sourceRoot, map.sources[0]),
    join(root, 'node_modules/vocs', files[0]))
})

test('unexpected runtime edits are preserved without partial source or map writes', t => {
  const root = owned(t, false), file = join(root, 'node_modules/vocs', files[1])
  writeFileSync(file, readFileSync(file, 'utf8') + '\n// another edit\n')
  const before = digests(root)
  assert.throws(() => patchVocsLlms(root), /unexpected changes/)
  assert.deepEqual(digests(root), before)
})

test('borrowed module directories and files are never patched', t => {
  const root = mkdtempSync(join(tmpdir(), 'vocs borrowed '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(modules, 'vocs'), join(root, 'node_modules/vocs'))
  const before = digests(site)
  assert.throws(() => patchVocsLlms(root), /borrowed/)
  const copy = owned(t, false), source = join(copy, 'node_modules/vocs', files[0])
  rmSync(source)
  symlinkSync(join(modules, 'vocs', files[0]), source)
  assert.throws(() => patchVocsLlms(copy), /borrowed/)
  assert.deepEqual(digests(site), before)
})

test('a new Vocs version or unreviewed source is refused', t => {
  const root = owned(t, false), manifest = join(root, 'node_modules/vocs/package.json')
  const original = readFileSync(manifest, 'utf8')
  const changed = JSON.parse(original); changed.version = '2.8.6'
  writeFileSync(manifest, JSON.stringify(changed))
  assert.throws(() => patchVocsLlms(root), /Unsupported Vocs/)
  writeFileSync(manifest, original)
  const source = join(root, 'node_modules/vocs', files[0])
  writeFileSync(source, readFileSync(source, 'utf8') + '\n// unreviewed source\n')
  const before = digests(root)
  assert.throws(() => patchVocsLlms(root), /source hash changed/)
  assert.deepEqual(digests(root), before)
})

test('the installed Vocs runtime matches the postinstall source patch', t => {
  const root = owned(t, false)
  patchVocsLlms(root)
  assert.deepEqual(digests(site), digests(root),
    'npm ci must apply the reviewed patch to the installed source, runtime and map')
})
