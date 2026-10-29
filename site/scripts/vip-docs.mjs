import fs from 'node:fs'
import path from 'node:path'
import { readFences, convertText, fence } from './docs-markdown.mjs'

const REPO = 'https://github.com/smithersai/vibelang/blob/main/'

// Renders docs/design/vips: README.md becomes /vips/, each NNNN-*.md becomes /vips/NNNN-*.
// The records stay the only source; the pages and sidebar are generated from them.
export function loadVips(root) {
  root = path.resolve(root)
  const dir = path.join(root, 'design/vips')
  const repo = path.resolve(root, '..')
  const records = fs.readdirSync(dir).filter(f => /^\d{4}-.+\.md$/.test(f)).sort()
  const raw = new Map(['README.md', ...records].map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]))
  const plain = s => s.replace(/`/g, '').replace(/\\\|/g, '|').trim()
  const titles = new Map()
  for (const [file, text] of raw) {
    const heading = text.match(/^# (.+)$/m)
    if (!heading) throw new Error(`VIP has no title: ${file}`)
    titles.set(file, plain(heading[1]))
  }
  // The sidebar follows the README's tables: accepted first, then each "## " section.
  const sidebar = { text: 'Improvement proposals', collapsed: false, items: [{ text: 'Index', link: '/vips/' }] }
  let group = { text: 'Accepted', collapsed: true, items: [] }
  const listed = new Set()
  for (const line of raw.get('README.md').split('\n')) {
    const section = line.match(/^## (.+)$/)
    if (section) { if (group.items.length) sidebar.items.push(group); group = { text: plain(section[1]), collapsed: true, items: [] }; continue }
    const row = line.match(/^\| \[(\d+)\]\((\d{4}-[^()]+\.md)\) \| (.+?) \| (.+?) \|$/)
    if (!row) continue
    const [, n, file, title] = row
    if (!raw.has(file)) throw new Error(`README lists a missing VIP: ${file}`)
    if (listed.has(file)) throw new Error(`README lists a VIP twice: ${file}`)
    listed.add(file)
    group.items.push({ text: `${n}. ${plain(title)}`, link: `/vips/${file.slice(0, -3)}` })
  }
  if (group.items.length) sidebar.items.push(group)
  for (const file of records) if (!listed.has(file)) throw new Error(`VIP missing from README: ${file}`)
  function link(href, from) {
    if (/^(https?:|mailto:|#)/.test(href)) return href
    const [target, fragment] = href.split('#')
    const resolved = path.resolve(dir, path.dirname(from), target)
    const hash = fragment ? `#${fragment}` : ''
    if (path.dirname(resolved) === dir && raw.has(path.basename(resolved))) {
      const file = path.basename(resolved)
      return (file === 'README.md' ? '/vips/' : `/vips/${file.slice(0, -3)}`) + hash
    }
    const pages = path.join(repo, 'site/src/pages') + path.sep
    if (resolved.startsWith(pages) && fs.existsSync(resolved)) return '/' + path.relative(pages, resolved).replace(/(index)?\.mdx?$/, '') + hash
    if (resolved.startsWith(repo + path.sep) && fs.existsSync(resolved)) return REPO + path.relative(repo, resolved) + hash
    throw new Error(`Unresolvable link: ${href} in ${from}`)
  }
  function convert(file) {
    const out = []
    for (const part of readFences(raw.get(file).split('\n'))) {
      if (part.type === 'code') out.push(fence(part))
      else out.push(convertText(part.line, file, href => link(href, file)))
    }
    return `---\ntitle: ${JSON.stringify(titles.get(file))}\n---\n\n${out.join('\n').replace(/\n+$/, '')}\n`
  }
  const pages = new Map([['index.mdx', convert('README.md')], ...records.map(f => [f.replace(/\.md$/, '.mdx'), convert(f)])])
  return { pages, sidebar }
}
