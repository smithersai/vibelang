import fs from 'node:fs'
import path from 'node:path'
import { readFences, convertText, fence, LABELS } from './docs-markdown.mjs'

export function substituteFacts(raw, facts) {
  return raw.replace(/\{\{([^{}]+)\}\}/g, (_, key) => {
    if (!['testCount', 'testFiles', 'kernelLines'].includes(key) || !Object.hasOwn(facts, key) || !/^\d+$/.test(String(facts[key]))) {
      throw new Error(`Unknown or missing placeholder: ${key}`)
    }
    return String(facts[key])
  })
}

// Stable specification heading IDs, including duplicate heading suffixes.
const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-')
export function loadSpec(root) {
  root = path.resolve(root)
  const dir = path.join(root, 'design/src')
  const chapters = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()
  const raw = new Map(chapters.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]))
  const sidebar = { text: 'Specification', collapsed: false, items: [] }
  const listed = new Set()
  // Page titles are the inventory's labels, as on vibelang.sh: "18. Why a continuation runtime".
  const labels = new Map()
  let active = false, group
  for (const line of fs.readFileSync(path.join(root, 'user/inventory.md'), 'utf8').split('\n')) {
    if (line.startsWith('### Specification')) { active = true; continue }
    if (active && /^#{1,3} /.test(line)) break
    if (!active) continue
    const heading = line.match(/^- \*\*(.+)\*\*$/)
    if (heading) { group = { text: heading[1], collapsed: true, items: [] }; sidebar.items.push(group); continue }
    const item = line.match(/^\s*- \[(.+?)\]\(\.\.\/design\/src\/([^()]+\.md)\)/)
    if (!item) continue
    const [, text, file] = item
    if (!raw.has(file)) throw new Error(`Inventory chapter does not exist: ${file}`)
    if (listed.has(file)) throw new Error(`Duplicate inventory chapter: ${file}`)
    listed.add(file)
    labels.set(file, text)
    ;(group?.items ?? sidebar.items).push({ text, link: file === '000-intro.md' ? '/spec/' : `/spec/${file.slice(0, -3)}` })
  }
  for (const file of chapters) if (!listed.has(file)) throw new Error(`Chapter missing from inventory: ${file}`)
  const ids = new Map(), owners = new Map()
  for (const [file, text] of raw) {
    const found = new Set(), counts = new Map()
    for (const part of readFences(text.split('\n'))) {
      if (part.type !== 'text') continue
      // An inline HTML anchor, as in `<a id="direct-eval"></a>**Legacy JavaScript.**`, names a fragment too.
      for (const [, id] of part.line.matchAll(/<a id="([^"]+)"><\/a>/g)) {
        found.add(id)
        owners.set(id, [...owners.get(id) ?? [], file])
      }
      const heading = part.line.match(/^#{1,6}\s+(.+?)\s*#*$/)
      if (!heading) continue
      const base = slug(heading[1].replace(/`/g, ''))
      const n = counts.get(base) ?? 0; counts.set(base, n + 1)
      const id = base + (n ? `-${n}` : '')
      found.add(id)
      owners.set(id, [...owners.get(id) ?? [], file])
    }
    ids.set(file, found)
  }
  let links = 0, proposed = 0, notDesigned = 0
  function link(href, from) {
    if (/^(https?:|mailto:)/.test(href)) return href
    const [target, fragment] = href.split('#')
    const anchor = fragment ? decodeURIComponent(fragment) : ''
    const resolved = target ? path.resolve(path.dirname(from), target) : from
    let file = path.basename(resolved)
    if (resolved.startsWith(dir + path.sep)) {
      if (!raw.has(file)) throw new Error(`Unresolvable chapter link: ${href} in ${from}`)
      if (anchor && !ids.get(file).has(anchor)) {
        const candidates = !target ? owners.get(anchor) : undefined
        if (candidates?.length !== 1) throw new Error(`Unresolvable fragment: ${href} in ${from}`)
        file = candidates[0]
      }
      links++
      return `/spec/${file.slice(0, -3)}${fragment ? `#${fragment}` : ''}`
    }
    const vips = path.join(root, 'design/vips') + path.sep
    if (resolved.startsWith(vips) && /^(README|\d{4}-[^/]+)\.md$/.test(path.relative(vips, resolved)) && fs.existsSync(resolved)) {
      links++
      const name = path.basename(resolved, '.md')
      return `/vips/${name === 'README' ? '' : name}${fragment ? `#${fragment}` : ''}`
    }
    const user = path.join(root, 'user/src') + path.sep
    if (resolved.startsWith(user) && resolved.endsWith('.md') && fs.existsSync(resolved)) {
      links++
      return '/' + path.relative(user, resolved).replace(/\.md$/, '') + (fragment ? `#${fragment}` : '')
    }
    if (resolved.startsWith(path.resolve(root, '..') + path.sep) && fs.existsSync(resolved)) return undefined
    throw new Error(`Unresolvable link: ${href} in ${from}`)
  }
  function convert(file, facts) {
    const text = substituteFacts(raw.get(file), facts)
    const out = []
    let callout = false
    for (const part of readFences(text.split('\n'))) {
      if (part.type === 'code') { out.push(fence(part, LABELS[part.role])); continue }
      let line = part.line
      if (callout && !line.startsWith('>')) { out.push(':::'); callout = false }
      const kind = line.match(/^>\s*\*\*(Proposed\.|Not designed yet\.)\*\*/)?.[1]
      if (kind && !callout) {
        callout = true
        if (kind === 'Proposed.') proposed++; else notDesigned++
        out.push(kind === 'Proposed.' ? ':::info' : ':::warning')
      }
      if (callout) line = line.replace(/^> ?/, '')
      // Repository references keep their label. Inline code stays untouched.
      line = line.replace(/(`+).*?\1|\[([^\]]+)\]\(([^\s)]+)\)/g, (match, ticks, label, href) => {
        if (ticks) return match
        const result = link(href, path.join(dir, file))
        return result === undefined ? label : `[${label}](${result})`
      })
      out.push(convertText(line, file, href => href))
    }
    if (callout) out.push(':::')
    const title = labels.get(file)
    return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${out.join('\n').replace(/\n+$/, '')}\n`
  }
  return { chapters, sidebar, link, convert, counts: () => ({ links, proposed, notDesigned }) }
}
