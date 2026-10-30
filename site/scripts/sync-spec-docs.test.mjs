import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadSpec, substituteFacts } from './spec-docs.mjs'
import { loadVips } from './vip-docs.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'vibelang-spec-')); roots.push(root)
  const put = (file, body) => { const dest = path.join(root, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, body) }
  put('docs/user/inventory.md', '### Specification\n\n- [Introduction](../design/src/000-intro.md)\n- **Part I. Examples**\n  - [1. Calls](../design/src/101-calls.md)\n- **Part II. Rules**\n  - [2. Rules](../design/src/202-rules.md)\n## Other\n')
  put('docs/design/src/000-intro.md', '# Intro\n\n{{testCount}} tests\n')
  put('docs/design/src/101-calls.md', '# Calls\n\n## Shared\n')
  put('docs/design/src/202-rules.md', '# Rules\n\n## Shared\n')
  put('docs/user/src/welcome.md', '# Welcome\n')
  put('README.md', 'Repository')
  put('docs/design/vips/README.md', '# VIPs\n\n| VIP | Title | Status |\n| --- | --- | --- |\n| [1](0001-one.md) | `one` | accepted |\n\n## Denied\n\n| VIP | Title | Status |\n| --- | --- | --- |\n| [2](0002-two.md) | Two `\\|>` | denied |\n')
  put('docs/design/vips/0001-one.md', '# VIP-1: `one`\n\nSee [two](0002-two.md#why), [index](README.md), [repo](../../../README.md) and {braces}.\n\n```ts\nconst x = { a: 1 }\n```\n')
  put('docs/design/vips/0002-two.md', '# VIP-2: Two\n')
  return { root, put, load: () => loadSpec(path.join(root, 'docs')) }
}
const facts = { testCount: '12', testFiles: 2, kernelLines: 100 }
test('facts are explicit; unknown, missing and invalid placeholders fail', () => {
  assert.equal(substituteFacts('{{testCount}} {{testFiles}} {{kernelLines}}', facts), '12 2 100')
  for (const [text, input] of [['{{unknown}}', facts], ['{{testCount}}', {}], ['{{testCount}}', { testCount: 'guess' }]]) {
    assert.throws(() => substituteFacts(text, input), /Unknown or missing placeholder/)
  }
})
test('chapter, user, cross-chapter and local fragments resolve; repository files retain text', () => {
  const { put, load } = fixture()
  put('docs/design/src/000-intro.md', '# Intro\n\n[chapter](101-calls.md#calls) [user](../../user/src/welcome.md) [fragment](#rules) [local](#intro) [vip](../vips/0001-one.md#why) [vips](../vips/README.md) [repo](../../../README.md)\n')
  const spec = load(), body = spec.convert('000-intro.md', facts)
  for (const link of ['/spec/101-calls#calls', '/welcome', '/spec/202-rules#rules', '/spec/000-intro#intro', '/vips/0001-one#why', '/vips/']) assert.ok(body.includes(`](${link})`))
  assert.ok(body.includes(' repo\n')); assert.equal(spec.counts().links, 6)
})
test('inline HTML anchors resolve as fragments, locally and across chapters', () => {
  const { put, load } = fixture()
  put('docs/design/src/101-calls.md', '# Calls\n\n<a id="direct-eval"></a>**Legacy.** text [here](#direct-eval)\n')
  put('docs/design/src/000-intro.md', '# Intro\n\n[legacy](101-calls.md#direct-eval) [owned](#direct-eval)\n')
  const body = load().convert('000-intro.md', facts)
  assert.equal(body.match(/\]\(\/spec\/101-calls#direct-eval\)/g).length, 2)
})
test('page titles are the inventory labels, not the first heading', () => {
  const { put, load } = fixture()
  put('docs/design/src/101-calls.md', '## Part I. Examples\n\n### 1. Calls\n')
  const spec = load()
  assert.ok(spec.convert('101-calls.md', facts).startsWith('---\ntitle: "1. Calls"\n---'))
  assert.ok(spec.convert('000-intro.md', facts).startsWith('---\ntitle: "Introduction"\n---'))
})
test('missing chapters, user pages, headings and ambiguous fragments fail', () => {
  const { put, load } = fixture()
  for (const href of ['missing.md', '../../user/src/missing.md', '#missing', '#shared', '101-calls.md#missing', '../../../missing.txt']) {
    put('docs/design/src/000-intro.md', `# Intro\n\n[broken](${href})\n`)
    assert.throws(() => load().convert('000-intro.md', facts), /Unresolvable/)
  }
})
test('callouts preserve status text and continuation, while code remains literal', () => {
  const { put, load } = fixture()
  put('docs/design/src/000-intro.md', '# Intro\n\n> **Proposed.** Future {syntax}.\n> More.\n\n> **Not designed yet.** Unknown.\n\n```text\n> **Proposed.** {literal}\n```\n')
  const spec = load(), body = spec.convert('000-intro.md', facts)
  assert.ok(body.includes(':::info\n**Proposed.** Future \\{syntax\\}.\nMore.\n:::'))
  assert.ok(body.includes(':::warning\n**Not designed yet.** Unknown.\n:::'))
  assert.ok(body.includes('> **Proposed.** {literal}'))
  assert.deepEqual(spec.counts(), { links: 0, proposed: 1, notDesigned: 1 })
})
test('sidebar follows inventory order and groups, and chapter inventory must match', () => {
  const { put, load } = fixture()
  assert.deepEqual(load().sidebar.items, [
    { text: 'Introduction', link: '/spec/' },
    { text: 'Part I. Examples', collapsed: true, items: [{ text: '1. Calls', link: '/spec/101-calls' }] },
    { text: 'Part II. Rules', collapsed: true, items: [{ text: '2. Rules', link: '/spec/202-rules' }] },
  ])
  put('docs/design/src/extra.md', '# Extra')
  assert.throws(load, /missing from inventory/)
})
test('inventory entries with no chapter fail', () => {
  const { root, load } = fixture()
  fs.unlinkSync(path.join(root, 'docs/design/src/101-calls.md'))
  assert.throws(load, /does not exist/)
})
test('VIPs render from docs/design/vips: README order, links, escaping and missing records', () => {
  const { root, put } = fixture()
  const vips = loadVips(path.join(root, 'docs'))
  assert.deepEqual(vips.sidebar.items, [
    { text: 'Index', link: '/vips/' },
    { text: 'Accepted', collapsed: true, items: [{ text: '1. one', link: '/vips/0001-one' }] },
    { text: 'Denied', collapsed: true, items: [{ text: '2. Two |>', link: '/vips/0002-two' }] },
  ])
  assert.deepEqual([...vips.pages.keys()], ['index.mdx', '0001-one.mdx', '0002-two.mdx'])
  const one = vips.pages.get('0001-one.mdx')
  assert.ok(one.startsWith('---\ntitle: "VIP-1: one"\n---\n\n# VIP-1: `one`'))
  for (const text of ['[two](/vips/0002-two#why)', '[index](/vips/)', '[repo](https://github.com/smithersai/vibelang/blob/main/README.md)', '\\{braces\\}', 'const x = { a: 1 }']) assert.ok(one.includes(text), text)
  put('docs/design/vips/0003-three.md', '# VIP-3: Three\n')
  assert.throws(() => loadVips(path.join(root, 'docs')), /missing from README/)
  fs.unlinkSync(path.join(root, 'docs/design/vips/0003-three.md'))
  put('docs/design/vips/0002-two.md', '# VIP-2: Two\n\n[gone](0009-gone.md)\n')
  assert.throws(() => loadVips(path.join(root, 'docs')), /Unresolvable link/)
})
test('CLI validates before writing, writes duplicate introduction, and user sync keeps spec pages', () => {
  const { root, put } = fixture()
  const site = path.join(root, 'site')
  fs.mkdirSync(path.join(site, 'scripts'), { recursive: true })
  for (const file of ['sync-spec-docs.mjs', 'sync-user-docs.mjs', 'spec-docs.mjs', 'vip-docs.mjs', 'docs-markdown.mjs', 'user-docs.mjs']) fs.copyFileSync(fileURLToPath(new URL(file, import.meta.url)), path.join(site, 'scripts', file))
  put('facts.json', JSON.stringify(facts))
  const run = (name, args) => execFileSync(process.execPath, [path.join(site, 'scripts', name), ...args], { stdio: 'pipe' })
  run('sync-spec-docs.mjs', [path.join(root, 'docs'), '--facts', path.join(root, 'facts.json')])
  const intro = fs.readFileSync(path.join(site, 'src/pages/spec/index.mdx'), 'utf8')
  assert.equal(intro, fs.readFileSync(path.join(site, 'src/pages/spec/000-intro.mdx'), 'utf8'))
  put('docs/user/inventory.md', fs.readFileSync(path.join(root, 'docs/user/inventory.md'), 'utf8').replace('### Specification', '## V4 sidebar in order\n### Guides\n- [Welcome](src/welcome.md)\n### Specification'))
  put('docs/user/src/welcome.md', '# Welcome\n\n[spec](../../design/src/000-intro.md#calls)\n')
  // Explicit chapter links must own their fragment.
  assert.throws(() => run('sync-user-docs.mjs', [path.join(root, 'docs/user')]))
  put('docs/user/src/welcome.md', '# Welcome\n\n[spec](../../design/src/101-calls.md#calls)\n')
  run('sync-user-docs.mjs', [path.join(root, 'docs/user')])
  assert.equal(fs.readFileSync(path.join(site, 'src/pages/spec/index.mdx'), 'utf8'), intro)
  assert.ok(fs.existsSync(path.join(site, 'src/pages/vips/0001-one.mdx')))
  assert.ok(fs.readFileSync(path.join(site, 'vips-sidebar.ts'), 'utf8').includes('/vips/0002-two'))
  assert.ok(fs.readFileSync(path.join(site, 'src/pages/welcome.mdx'), 'utf8').includes('/spec/101-calls#calls'))
  put('facts.json', '{}')
  assert.throws(() => run('sync-spec-docs.mjs', [path.join(root, 'docs'), '--facts', path.join(root, 'facts.json')]))
  assert.equal(fs.readFileSync(path.join(site, 'src/pages/spec/index.mdx'), 'utf8'), intro)
})
