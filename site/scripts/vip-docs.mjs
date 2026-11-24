import fs from 'node:fs'
import path from 'node:path'
import { readFences, convertText, fence, headingIds } from './docs-markdown.mjs'

const REPO = 'https://github.com/smithersai/vibelang/blob/main/'

// A VIP's first paragraph is its status line, so each page gets a summary of what it
// is for search results and link previews instead of the site default.
export function describeVip(file, title) {
  if (file === 'README.md') return 'VibeLang improvement proposals (VIPs): each language decision, with its status, its reasons and its history.'
  return `${title}${/[.?!]$/.test(title) ? '' : '.'} A VibeLang improvement proposal: the decision, its reasons and its history.`
}

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
  const specDir = path.join(root, 'design/src') + path.sep
  const userDir = path.join(root, 'user/src') + path.sep
  const anchors = new Map()
  function link(href, from) {
    if (/^(https?:|mailto:|#)/.test(href)) return href
    const [target, fragment] = href.split('#')
    const resolved = path.resolve(dir, path.dirname(from), target)
    const hash = fragment ? `#${fragment}` : ''
    if (path.dirname(resolved) === dir && raw.has(path.basename(resolved))) {
      const file = path.basename(resolved)
      return (file === 'README.md' ? '/vips/' : `/vips/${file.slice(0, -3)}`) + hash
    }
    const docsDir = [specDir, userDir].find(dir => resolved.startsWith(dir))
    if (docsDir && resolved.endsWith('.md') && fs.existsSync(resolved)) {
      if (fragment) {
        if (!anchors.has(resolved)) anchors.set(resolved, headingIds(fs.readFileSync(resolved, 'utf8')))
        if (!anchors.get(resolved).has(decodeURIComponent(fragment))) {
          throw new Error(`Unresolvable fragment: ${href} in ${from}`)
        }
      }
      const name = path.relative(docsDir, resolved).slice(0, -3)
      return (docsDir === specDir ? `/spec/${name === '000-intro' ? '' : name}` : `/${name}`) + hash
    }
    const pages = path.join(repo, 'site/src/pages') + path.sep
    if (resolved.startsWith(pages) && fs.existsSync(resolved)) return '/' + path.relative(pages, resolved).replace(/(index)?\.mdx?$/, '') + hash
    if (resolved.startsWith(repo + path.sep) && fs.existsSync(resolved)) return REPO + path.relative(repo, resolved) + hash
    throw new Error(`Unresolvable link: ${href} in ${from}`)
  }
  function convert(file, markdown = false) {
    const out = []
    for (const part of readFences(raw.get(file).split('\n'))) {
      if (part.type === 'code') out.push(fence(part))
      else if (markdown) out.push(proposalMarkdownLinks(part.line, href => link(href, file)))
      else out.push(convertText(part.line, file, href => link(href, file)))
    }
    const body = out.join('\n').replace(/\n+$/, '') + '\n'
    if (markdown) return body
    return `---\ntitle: ${JSON.stringify(titles.get(file))}\ndescription: ${JSON.stringify(describeVip(file, titles.get(file)))}\n---\n\n${body}`
  }
  const files = [['README.md', 'index'], ...records.map(file => [file, file.slice(0, -3)])]
  const pages = new Map(files.map(([file, name]) => [name + '.mdx', convert(file)]))
  return { pages, sidebar, markdown: () => files.map(([file, name]) => ({
    path: `vips/${name}.md`, title: titles.get(file), body: convert(file, true)
  })) }
}

export function proposalMarkdownLinks(line, resolve = href => href) {
  return line.replace(/(`+).*?\1|\[((?:`[^`]*`|[^\]`])+)\]\(([^\s)]+)\)/g, (match, ticks, label, href) => {
    if (ticks) return match
    const target = resolve(href)
    if (!target.startsWith('/') || target.startsWith('//')) return `[${label}](${target})`
    const [, route, suffix] = /^([^?#]*)(.*)$/.exec(target)
    const file = route.endsWith('/') ? route + 'index' : route
    return `[${label}](https://vibelang.sh${file}.md${suffix})`
  })
}
