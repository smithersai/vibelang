#!/usr/bin/env node
// Copies the VibeLang user docs into this Vocs site.
//
//   node scripts/sync-user-docs.mjs ../docs/user
//
// The source is ../docs/user, the user docs in this repository.
// docs/user/inventory.md defines the sections and their order; each
// page in docs/user/src becomes one .mdx page here at the same path, so
// vibelang.sh/error-management/014-expected-errors is
// docs/user/src/error-management/014-expected-errors.md. The script rewrites
// src/pages (keeping the hand-written pages and the synced spec and vips in KEEP) and sidebar.ts, and
// converts the Markdown that MDX rejects. The hand-written Proposals page,
// src/pages/proposals.mdx, is not in the language repo; the script keeps it and
// lists it as the last sidebar entry (SITE_SIDEBAR). Links into the
// specification point at /spec/ when the specification has been synced,
// otherwise at https://vibelang.sh/spec/. Each page that mirrors an
// Effect page (the inventory's `v4/...mdx` column) ends with a link to that page
// on effect.website; the source's own "Upstream page" lines are dropped so the
// link appears once. The script fails on a page
// missing from the inventory, an inventory entry with no page, or a link it
// cannot resolve.
import { stripRunDirectives, stripDecisionReferences } from './user-docs.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { convertText, readFences, fence, LABELS } from './docs-markdown.mjs'
import { loadSpec } from './spec-docs.mjs'

let SPEC_URL = 'https://vibelang.sh/spec/'
const EFFECT_DOCS_URL = 'https://effect.website/docs/'
const KEEP = new Set(['index.mdx', '_root.css', 'proposals.mdx', 'spec', 'vips'])
// Sidebar entries for site-only pages, appended after the inventory's sections.
const SITE_SIDEBAR = [{ text: 'Proposals', link: '/proposals' }]

const source = process.argv[2]
if (!source || !fs.existsSync(path.join(source, 'inventory.md'))) {
  console.error('usage: node scripts/sync-user-docs.mjs ../docs/user')
  process.exit(2)
}
const docsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const pagesDir = path.join(docsDir, 'src/pages')
const srcDir = path.join(source, 'src')
const localSpec = fs.existsSync(path.join(pagesDir, 'spec/index.mdx'))
const spec = localSpec ? loadSpec(path.resolve(source, '..')) : undefined
if (localSpec) SPEC_URL = '/spec/'
const errors = []

// Pages: every .md file under docs/user/src, keyed by its path from src/.
const pages = fs
  .globSync('**/*.md', { cwd: srcDir })
  .map((file) => file.split(path.sep).join('/'))
  .sort()
const route = (rel) => `/${rel.replace(/\.md$/, '')}`

// Sidebar: the inventory's "V4 sidebar in order" section, up to the
// specification, which is published separately at vibelang.sh/spec/.
const inventory = fs.readFileSync(path.join(source, 'inventory.md'), 'utf8').split('\n')
const sidebar = []
const listed = new Set()
// Page path -> its Effect page on effect.website.
const effectPage = new Map()
let inSidebar = false
let section
let group
for (const line of inventory) {
  if (line.startsWith('## ')) inSidebar = line.startsWith('## V4 sidebar in order')
  if (!inSidebar) continue
  const heading = line.match(/^### (.+)$/)
  if (heading) {
    if (heading[1] === 'Specification') break
    section = { text: heading[1], items: [] }
    sidebar.push(section)
    group = undefined
    continue
  }
  const bold = line.match(/^- \*\*(.+)\*\*\s*$/)
  if (bold) {
    group = { text: bold[1], collapsed: section.text === 'Guides', items: [] }
    section.items.push(group)
    continue
  }
  const item = line.match(/^(\s*)- \[(.+?)\]\(src\/([^)]+\.md)\)/)
  if (!item) continue
  const [, indent, text, rel] = item
  if (!pages.includes(rel)) errors.push(`inventory lists src/${rel}, which does not exist`)
  listed.add(rel)
  const upstream = line.match(/: `(v4\/[^`]+)\.mdx`/)?.[1]
  if (upstream) effectPage.set(rel, `${EFFECT_DOCS_URL}${upstream.replace(/\/index$/, '')}/`)
  const entry = { text, link: route(rel) }
  if (indent.length > 0 && group) group.items.push(entry)
  else {
    group = undefined
    section.items.push(entry)
  }
}
for (const rel of pages) if (!listed.has(rel)) errors.push(`src/${rel} is missing from inventory.md`)

// MDX conversion. Code fences pass through; ```ts effect followed by
// ```vibe becomes a code group. Outside code, MDX's syntax characters are
// escaped and relative .md links become routes.
function convertLink(href, fromRel) {
  if (/^(https?:|mailto:|#)/.test(href)) return href
  const [target, anchor = ''] = href.split('#')
  if (!target.endsWith('.md')) {
    errors.push(`${fromRel}: unresolved link ${href}`)
    return href
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(`src/${fromRel}`), target))
  if (resolved.startsWith('src/')) {
    const rel = resolved.slice(4)
    if (!pages.includes(rel)) errors.push(`${fromRel}: link to missing page ${href}`)
    return route(rel) + (anchor ? `#${anchor}` : '')
  }
  if (resolved.startsWith('../design/src/')) {
    if (!localSpec) return SPEC_URL
    return spec.link(href, path.resolve(srcDir, fromRel))
  }
  errors.push(`${fromRel}: link outside the docs ${href}`)
  return href
}

function convertPage(rel) {
  const raw = stripDecisionReferences(stripRunDirectives(fs.readFileSync(path.join(srcDir, rel), 'utf8')))
  const parts = readFences(raw.split('\n'))
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.type === 'text') {
      if (/^\[Upstream[^\]]*\]\(https:\/\/effect\.website\/docs\/[^)]*\)\s*$/.test(part.line.trim())) continue
      out.push(convertText(part.line, rel, convertLink))
      continue
    }
    // An Effect (or long-form) block followed only by blank lines and a
    // ```vibe block shows as one code group, VibeLang first.
    if (part.role === 'effect' || part.role === 'long') {
      let j = i + 1
      while (j < parts.length && parts[j].type === 'text' && parts[j].line.trim() === '') j++
      const pair = parts[j]
      const isVibe = pair?.type === 'code' && pair.lang === 'vibe' && (pair.role === 'es' || pair.role === '')
      if (isVibe && part.indent === '' && pair.indent === '') {
        out.push(':::code-group', '', fence(pair, LABELS.es), '', fence(part, LABELS[part.role]), '', ':::')
        i = j
        continue
      }
    }
    out.push(fence(part, LABELS[part.role]))
  }
  let body = out.join('\n')
  const effect = effectPage.get(rel)
  if (effect) {
    const label = effect.replace(/^https:\/\//, '').replace(/\/$/, '')
    body = `${body.replace(/\n+$/, '')}\n\n---\n\nThe matching Effect page: [${label}](${effect})\n`
  }

  // Front matter: the page title, and the first paragraph as the description.
  const title = (raw.match(/^# (.+)$/m)?.[1] ?? rel).replace(/`/g, '')
  const afterTitle = raw.split('\n').slice(raw.split('\n').findIndex((l) => l.startsWith('# ')) + 1)
  const paragraph = []
  for (const part of readFences(afterTitle)) {
    if (part.type === 'code') {
      if (paragraph.length > 0) break
      continue
    }
    const line = part.line
    if (line.trim() === '' && paragraph.length > 0) break
    if (line.trim() === '') continue
    if (/^(```|~~~|#|>|\||- |\* |\d+\. )/.test(line.trim())) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(line.trim())
  }
  let description = paragraph
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Inline code keeps its text (so function* stays function*); emphasis markers go.
    .replace(/(`[^`]*`)|[*_]/g, (match, code) => (code ? code.slice(1, -1) : ''))
  if (description.length > 200) description = `${description.slice(0, 197).replace(/\s+\S*$/, '')}...`
  const front = ['---', `title: ${JSON.stringify(title)}`]
  if (description) front.push(`description: ${JSON.stringify(description)}`)
  front.push('---', '')
  body = `${front.join('\n')}\n${body.replace(/\n+$/, '')}\n`
  return body
}

if (errors.length > 0) {
  for (const error of errors) console.error(`sync-user-docs: ${error}`)
  process.exit(1)
}

const converted = new Map(pages.map((rel) => [rel, convertPage(rel)]))
if (errors.length > 0) {
  for (const error of errors) console.error(`sync-user-docs: ${error}`)
  process.exit(1)
}

// Replace every page except the home page and the site stylesheet.
for (const entry of fs.readdirSync(pagesDir)) {
  if (!KEEP.has(entry)) fs.rmSync(path.join(pagesDir, entry), { recursive: true, force: true })
}
for (const [rel, body] of converted) {
  const file = path.join(pagesDir, rel.replace(/\.md$/, '.mdx'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
}
fs.writeFileSync(
  path.join(docsDir, 'sidebar.ts'),
  `// Generated by scripts/sync-user-docs.mjs from docs/user/inventory.md and its SITE_SIDEBAR. Do not edit.\nimport type { Config } from 'vocs/config'\n\nexport const sidebar = ${JSON.stringify(
    [...sidebar.map((s) => ({ ...s, collapsed: false })), ...SITE_SIDEBAR],
    null,
    2,
  )} satisfies Config['sidebar']\n`,
)
console.log(`sync-user-docs: ${converted.size} pages, ${sidebar.length} sections (${sidebar.map((s) => s.text).join(', ')})`)
