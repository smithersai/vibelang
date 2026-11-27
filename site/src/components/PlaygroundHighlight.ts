// Lightweight synchronous syntax highlighter and formatter for VibeLang & Effect TS.

const VIBE_KEYWORDS = new Set([
  'effect', 'try', 'catch', 'error', 'service', 'schema', 'data',
  'provide', 'match', 'when', 'default', 'fork', 'join', 'concurrent',
  'uninterruptible', 'restore', 'interruptible',
  'export', 'import', 'from', 'as', 'const', 'let', 'function', 'return',
  'if', 'else', 'for', 'of', 'in', 'while', 'switch', 'case', 'break',
  'continue', 'new', 'throw', 'type', 'interface', 'readonly', 'class',
  'extends', 'implements', 'static', 'async', 'await', 'yield', 'typeof',
  'keyof', 'void', 'never', 'unknown', 'any', 'boolean', 'number', 'string',
  'true', 'false', 'null', 'undefined', 'do', 'is',
])

const EFFECT_GLOBALS = new Set([
  'Effect', 'Layer', 'Schema', 'Data', 'Context', 'Console', 'Fiber', 'Exit',
  'Cause', 'Duration', 'Schedule', 'Stream', 'Scope', 'Equal', 'Ref', 'Option',
  'Match', 'TaggedError', 'Command', 'sleep', 'all', 'forEach', 'race',
  'retry', 'timeout', 'scoped', 'acquireRelease', 'ensuring', 'onExit',
  'exit', 'sync', 'promise', 'tryPromise', 'withSpan', 'runPromise',
  'provideService', 'pipe',
])

export function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const TOKEN_RE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\|>|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g

export function highlightCode(source: string): string {
  let out = ''
  let last = 0
  for (const m of source.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0
    if (idx > last) {
      out += escapeHtml(source.slice(last, idx))
    }
    const token = m[0]
    if (token.startsWith('//') || token.startsWith('/*')) {
      out += `<span class="vp-tok-comment">${escapeHtml(token)}</span>`
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      out += `<span class="vp-tok-string">${escapeHtml(token)}</span>`
    } else if (token === '|>') {
      out += `<span class="vp-tok-operator">|&gt;</span>`
    } else if (/^\d/.test(token)) {
      out += `<span class="vp-tok-number">${escapeHtml(token)}</span>`
    } else if (VIBE_KEYWORDS.has(token)) {
      out += `<span class="vp-tok-keyword">${escapeHtml(token)}</span>`
    } else if (EFFECT_GLOBALS.has(token)) {
      out += `<span class="vp-tok-builtin">${escapeHtml(token)}</span>`
    } else if (/^[A-Z]/.test(token)) {
      out += `<span class="vp-tok-type">${escapeHtml(token)}</span>`
    } else {
      out += escapeHtml(token)
    }
    last = idx + token.length
  }
  if (last < source.length) {
    out += escapeHtml(source.slice(last))
  }
  if (source.endsWith('\n')) {
    out += ' '
  }
  return out
}

export function estimateTokens(code: string): number {
  const parts = code.match(/[A-Za-z_$][\w$]*|\d+|[^\s\w]/g)
  return parts ? parts.length : 0
}

export function countLines(code: string): number {
  if (!code) return 0
  return code.split('\n').length
}

export function formatVibeSource(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const formatted: string[] = []
  let indent = 0
  let prevBlank = false
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (trimmed === '') {
      if (!prevBlank && formatted.length > 0) {
        formatted.push('')
        prevBlank = true
      }
      continue
    }
    prevBlank = false
    const startsWithClose = /^[}\])]/.test(trimmed)
    const effectiveIndent = Math.max(0, startsWithClose ? indent - 1 : indent)
    formatted.push('  '.repeat(effectiveIndent) + trimmed)
    const opens = (trimmed.match(/[{([]/g) ?? []).length
    const closes = (trimmed.match(/[})\]]/g) ?? []).length
    indent = Math.max(0, indent + opens - closes)
  }
  return formatted.join('\n').replace(/\n+$/, '') + '\n'
}
