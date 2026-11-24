import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { contrastDiagnostics } from './contrast-diagnostics.mjs'
import { headingIds, readFences } from './docs-markdown.mjs'
import { fileURLToPath } from 'node:url'

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
const exportsOf = path => [...read(path).matchAll(/^export \* as (\w+) /gm)].map(match => match[1])

test('the experimental reference summarizes every module and platform layer', () => {
  const page = read('docs/user/src/vibelang-features/118-experimental-platform-apis.md')
  const runtime = 'packages/runtime/src/experimental'
  const modules = page.split('## How they work')[0]
  for (const name of exportsOf(runtime + '/index.ts')) {
    assert.ok(modules.includes('`Experimental.' + name + '`'), name)
  }
  for (const host of ['node', 'bun', 'browser', 'worker']) {
    const row = page.split('\n').find(line => line.startsWith('| `vibelang-runtime/experimental/platform-' + host + '`'))
    assert.ok(row, host)
    for (const name of exportsOf(runtime + '/platform-' + host + '/index.ts')) {
      assert.ok(row.includes('`' + name + '.layer`'), name)
    }
  }
})

test('contrast resource events omit the build host name', () => {
  let event
  const diagnostics = contrastDiagnostics({ log: (_label, json) => { event = JSON.parse(json) } })
  diagnostics.event('resource-snapshot')
  assert.equal(event.event, 'resource-snapshot')
  assert.equal(Object.hasOwn(event.resources, 'host'), false)
})


test('relative links between archived Markdown pages and headings resolve', () => {
  const archive = fileURLToPath(new URL('../../docs/design/history', import.meta.url))
  for (const name of readdirSync(archive, { recursive: true }).filter(path => path.endsWith('.md'))) {
    const source = join(archive, name)
    for (const part of readFences(readFileSync(source, 'utf8').split('\n'))) {
      if (part.type !== 'text') continue
      const prose = part.line.replace(/\x60[^\x60]*\x60/g, '')
      for (const [, href] of prose.matchAll(/\]\(([^()\s]+)\)/g)) {
        if (/^(?:[a-z]+:|\/)/i.test(href)) continue
        const [route, fragment] = href.split('#')
        const target = route ? join(dirname(source), route) : source
        if (!target.endsWith('.md')) continue
        assert.ok(existsSync(target), `${name} links to missing page ${href}`)
        if (fragment) {
          assert.ok(headingIds(readFileSync(target, 'utf8')).has(decodeURIComponent(fragment)),
            `${name} links to missing heading ${href}`)
        }
      }
    }
  }
})
