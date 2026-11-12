import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// What a link preview or a search result shows comes from the built pages' head tags.
const site = fileURLToPath(new URL('../dist/public', import.meta.url))
const tagline = 'Write Effect programs in TypeScript syntax, with typed errors and services the compiler checks.'
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, name) =>
  name[0] === '#' ? String.fromCodePoint(Number(name[1].toLowerCase() === 'x' ? '0' + name.slice(1) : name.slice(1))) : entities[name] ?? match)

function pages() {
  const found = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(dir, entry.name)
      if (existsSync(join(path, 'index.html'))) found.push(['/' + relative(site, path), readFileSync(join(path, 'index.html'), 'utf8')])
      walk(path)
    }
  }
  walk(site)
  assert(found.length > 200, `expected the whole built site, found ${found.length} pages`)
  return found
}
const tag = (html, attribute, name) => {
  const match = new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`).exec(html)
  return match ? decode(match[1]) : undefined
}

test('a shared link to any page names the page and the site', () => {
  const wrong = []
  for (const [path, html] of pages()) {
    const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '')
    if (!title.includes('VibeLang')) wrong.push(`${path}: <title> ${JSON.stringify(title)}`)
    for (const [attribute, name] of [['property', 'og:title'], ['name', 'twitter:title']]) {
      if (tag(html, attribute, name) !== title) wrong.push(`${path}: ${name} ${JSON.stringify(tag(html, attribute, name))}, <title> ${JSON.stringify(title)}`)
    }
  }
  assert.deepEqual(wrong, [])
})

test('every page but the home page has its own description', () => {
  const wrong = []
  for (const [path, html] of pages()) {
    for (const [attribute, name] of [['name', 'description'], ['property', 'og:description']]) {
      const description = tag(html, attribute, name)
      if (!description || description === tagline) wrong.push(`${path}: ${name} ${JSON.stringify(description)}`)
    }
  }
  assert.deepEqual(wrong, [])
})
