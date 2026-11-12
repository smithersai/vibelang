// Publication-only cleanup. Source comments remain available to the snippet harness.
function mapLines(markdown, transform) {
  let fence
  return markdown.split('\n').flatMap((line) => {
    const bare = line.trimStart()
    const marker = /^(`{3,}|~{3,})/.exec(bare)?.[1]
    if (fence === undefined && marker) {
      fence = marker
      return [line]
    }
    if (fence !== undefined && marker?.[0] === fence[0] && marker.length >= fence.length && bare.trimEnd() === marker) {
      fence = undefined
      return [line]
    }
    const result = transform(line, fence !== undefined)
    return result === undefined ? [] : [result]
  }).join('\n')
}

// A launch video sits on its own line as `![caption](/videos/name.mp4)`. The site renders
// a player; the Markdown copies for agents drop the line.
export const VIDEO_LINE = /^!\[([^\]]*)\]\(\/videos\/([a-z0-9-]+)\.mp4\)\s*$/

export function stripVideos(markdown) {
  return mapLines(markdown, (line, code) => !code && VIDEO_LINE.test(line) ? undefined : line)
}

// Every output a published sample shows comes from code the reader can see.
// The snippet checker runs a block's `// run:` header, in a generated effect
// function (a plain function for `ts`), to produce its `// Output:` lines.
// Publication shows those statements as a `// Run in an effect function:`
// comment just above the first output line, or at the end of the block when an
// output fence follows it. An empty `// Output:` marker only asserts silence
// (a Vitest example's assertions pass), so the published copy drops it. A
// pending line names the VIPs a block waits for; only the snippet checker reads it.
const RUN = /^(\s*)\/\/\s*run:\s*(.*)$/
const CHECKER_ONLY = /^\s*\/\/\s*(?:pending|pending-decision):/
const OUTPUT = /^\s*\/\/ Output:/
const EMPTY_OUTPUT = /^\s*\/\/ Output:\s*$/

// Scan code outside strings and template literals, tracking bracket depth.
function scan(code, visit) {
  let depth = 0, quote
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if ('([{'.includes(c)) visit(c, i, depth++)
    else if (')]}'.includes(c)) depth--
    else visit(c, i, depth)
  }
}

// Split a one-line statement list at its top-level semicolons.
export function runStatements(code) {
  const statements = []
  let start = 0
  scan(code, (c, i, depth) => {
    if (c === ';' && depth === 0) {
      statements.push(code.slice(start, i).trim())
      start = i + 1
    }
  })
  statements.push(code.slice(start).trim())
  return statements.filter(Boolean)
}

// A statement that ends in a block of several statements, such as
// `provide X { a; b }`, shows that block on its own lines.
function runLines(statement, indent) {
  let open = -1
  scan(statement, (c, i, depth) => { if (depth === 0 && '([{'.includes(c)) open = c === '{' ? i : -1 })
  const inner = statement.endsWith('}') && open >= 0 ? runStatements(statement.slice(open + 1, -1)) : []
  if (inner.length < 2) return [indent + statement]
  const head = statement.slice(0, open).trimEnd()
  return [`${indent}${head ? head + ' ' : ''}{`, ...inner.flatMap((line) => runLines(line, indent + '  ')), `${indent}}`]
}

export function renderRun(code, indent = '', language = 'vibe') {
  const label = language === 'ts' ? 'Run:' : 'Run in an effect function:'
  const lines = runStatements(code).flatMap((statement) => runLines(statement, ''))
  if (lines.length === 1) return [`${indent}// ${label} ${lines[0]}`]
  return [`${indent}// ${label}`, ...lines.map((line) => `${indent}//   ${line}`)]
}

function publishBlock(body, language) {
  let header = 0
  while (header < body.length && /^\s*\/\//.test(body[header])) header++
  const runAt = body.slice(0, header).findIndex((line) => RUN.test(line))
  const run = runAt >= 0 ? RUN.exec(body[runAt]) : undefined
  const kept = body.filter((line, i) => i !== runAt && !(i < header && CHECKER_ONLY.test(line)) && !EMPTY_OUTPUT.test(line))
  if (!run) return kept
  const rendered = renderRun(run[2], run[1], language === 'ts' || language === 'typescript' ? 'ts' : 'vibe')
  const at = kept.findIndex((line) => OUTPUT.test(line))
  return at >= 0 ? [...kept.slice(0, at), ...rendered, ...kept.slice(at)] : [...kept, ...rendered]
}

export function publishRunDirectives(markdown) {
  const out = []
  let fence, language, body
  for (const line of markdown.split('\n')) {
    const bare = line.trimStart()
    const marker = /^(`{3,}|~{3,})/.exec(bare)?.[1]
    if (fence === undefined) {
      out.push(line)
      if (marker) {
        fence = marker
        language = bare.slice(marker.length).trim().split(/\s+/)[0]
        body = []
      }
      continue
    }
    if (marker?.[0] === fence[0] && marker.length >= fence.length && bare.trimEnd() === marker) {
      out.push(...publishBlock(body, language), line)
      fence = undefined
      continue
    }
    body.push(line)
  }
  if (fence !== undefined) out.push(...body)
  return out.join('\n')
}

// Decision IDs belong to the spec. Remove only comma-separated annotations;
// prose that depends on a decision is rewritten in the source instead.
const decision = String.raw`D\d+(?:\s*(?:[-–]|to)\s*D?\d+)?`
const list = `${decision}(?:,\\s*${decision})*`
const only = new RegExp(` ?\\(${list}\\)`, 'g')
const first = new RegExp(`\\(${list},\\s*`, 'g')
const last = new RegExp(`,\\s*${list}\\)`, 'g')
const strip = (text) => text.replace(only, '').replace(first, '(').replace(last, ')')

export function stripDecisionReferences(markdown) {
  return mapLines(markdown, (line, code) => {
    if (code) return line
    let result = '', offset = 0
    for (const match of line.matchAll(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g)) {
      result += strip(line.slice(offset, match.index)) + match[0]
      offset = match.index + match[0].length
    }
    return result + strip(line.slice(offset))
  })
}
