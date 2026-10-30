export const LABELS = { effect: 'Effect', long: 'VibeLang long form', es: 'VibeLang', gen: 'Generated TypeScript', dts: 'Generated declaration' }
const LANGS = { out: 'text', output: 'text', vibelang: 'vibe' }

// Escapes text outside inline code. Inline code spans pass through unchanged.
export function convertText(line, fromRel, convertLink) {
  let out = ''
  let i = 0
  while (i < line.length) {
    if (line[i] === '`') {
      const ticks = line.slice(i).match(/^`+/)[0]
      const close = line.indexOf(ticks, i + ticks.length)
      if (close !== -1) {
        out += line.slice(i, close + ticks.length)
        i = close + ticks.length
        continue
      }
    }
    const next = line.indexOf('`', i + 1)
    const end = next === -1 ? line.length : next
    out += escapeText(line.slice(i, end), fromRel, convertLink)
    i = end
  }
  return out
}

// An empty anchor element, <a id="x"></a>, names a link target, so it passes through as an element.
const ANCHOR = /<a id="([\w-]+)"><\/a>/g

function escapeText(text, fromRel, convertLink) {
  const ids = []
  return text
    .replace(ANCHOR, (_, id) => `\u0000${ids.push(id) - 1}\u0000`)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '[$1]($1)')
    .replace(/\]\(([^)\s]+)\)/g, (_, href) => `](${convertLink(href, fromRel)})`)
    .replace(/[{}]/g, (c) => `\\${c}`)
    .replace(/<(?!\/?(?:br|sup|sub|kbd)\b)/g, '\\<')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => `<a id="${ids[n]}"></a>`)
}

export function readFences(lines) {
  // Splits a page into text lines and fenced blocks.
  const parts = []
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,}|~{3,})(.*)$/)
    if (!open) {
      parts.push({ type: 'text', line: lines[i] })
      continue
    }
    const [, indent, marker, info] = open
    const body = []
    let j = i + 1
    while (j < lines.length && !(lines[j].trim().startsWith(marker) && lines[j].trim().replace(/[`~]/g, '') === '')) {
      body.push(lines[j])
      j++
    }
    const [lang = '', role = ''] = info.trim().split(/\s+/)
    parts.push({ type: 'code', indent, marker, lang: LANGS[lang] ?? lang, role, body })
    i = j
  }
  return parts
}

export const fence = (block, title) =>
  [
    `${block.indent}${block.marker}${block.lang}${title ? ` [${title}]` : ''}`,
    ...block.body,
    `${block.indent}${block.marker}`,
  ].join('\n')

