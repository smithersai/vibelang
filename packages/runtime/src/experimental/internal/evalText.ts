/**
 * Text helpers shared by `Experimental.Eval` and `Experimental.Scorer`,
 * compatible with `@smthrs/evals` and `@smthrs/scorers`: control
 * characters that would corrupt a CI log line, the canonical-JSON loss check
 * a scorer identity needs, and the matchers behind `Scorer.checks`.
 *
 * @internal
 */

// ---------------------------------------------------------------------------
// Control characters
// ---------------------------------------------------------------------------

/** C0, DEL, C1 and the bidirectional controls that can reorder a log line. */
export const isControlCodePoint = (code: number): boolean =>
  code < 0x20 ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0x061c ||
  code === 0x200e ||
  code === 0x200f ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069)

/** The first control character in `value`, as `U+XXXX`, or `undefined`. */
export const controlCharacter = (value: string): string | undefined => {
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (isControlCodePoint(code)) return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`
  }
  return undefined
}

/** `value` with every control character replaced by a space. */
export const flattenControlCharacters = (value: string): string => {
  if (controlCharacter(value) === undefined) return value
  let flattened = ""
  for (const character of value) {
    flattened += isControlCodePoint(character.codePointAt(0)!) ? " " : character
  }
  return flattened
}

/** An injective key for a tuple of strings. */
export const tupleKey = (...parts: ReadonlyArray<string>): string => JSON.stringify(parts)

/** UTF-16 code-unit order, as RFC 8785 sorts keys. */
export const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

// ---------------------------------------------------------------------------
// Values canonical JSON would lose
// ---------------------------------------------------------------------------

const maxWalkDepth = 1_000

const lossOf = (value: unknown): string | undefined => {
  const type = typeof value
  if (type === "function" || type === "symbol" || type === "bigint") return type
  if (type === "undefined") return "undefined"
  if (type === "number" && !Number.isFinite(value)) return "a non-finite number"
  return undefined
}

const read = (node: object, key: string): { readonly value: unknown } | undefined => {
  try {
    return { value: (node as Record<string, unknown>)[key] }
  } catch {
    return undefined
  }
}

/**
 * Names the first member of `value` that canonical JSON would drop, change or
 * refuse, as a path and a reason; `undefined` when the value is plain JSON.
 * The message never contains the value itself.
 */
export const lossyPath = (value: unknown, root: string): string | undefined => {
  const open = new Set<object>()
  const walk = (node: unknown, path: string, depth: number): string | undefined => {
    if (depth > maxWalkDepth) return `${path} is nested deeper than ${maxWalkDepth} levels`
    const loss = lossOf(node)
    if (loss !== undefined) return `${path} is ${loss}`
    if (node === null || typeof node !== "object") return undefined
    if (open.has(node)) return `${path} is circular`
    open.add(node)
    try {
      const toJson = read(node, "toJSON")
      if (toJson !== undefined && typeof toJson.value === "function") return `${path} defines toJSON`
      let names: ReadonlyArray<string>
      let enumerable: ReadonlyArray<string>
      let symbols: number
      try {
        names = Object.getOwnPropertyNames(node)
        enumerable = Object.keys(node)
        symbols = Object.getOwnPropertySymbols(node).length
      } catch {
        return `${path} throws when keys are enumerated`
      }
      if (Array.isArray(node)) {
        for (let index = 0; index < node.length; index++) {
          const slot = read(node, String(index))
          if (slot === undefined) return `${path}[${index}] throws when read`
          const found = walk(slot.value, `${path}[${index}]`, depth + 1)
          if (found !== undefined) return found
        }
        if (symbols > 0) return `${path} has a symbol-keyed array property`
        const extra = names.find((key) => key !== "length" && (String(Number(key) >>> 0) !== key || key === "4294967295"))
        if (extra !== undefined) return `${path}.${extra} is a non-index array property`
        return undefined
      }
      const prototype = Object.getPrototypeOf(node)
      if (prototype !== Object.prototype && prototype !== null) return `${path} is not a plain object`
      if (symbols > 0) return `${path} has a symbol-keyed property`
      if (names.length !== enumerable.length) {
        const declared = new Set(enumerable)
        return `${path}.${names.find((key) => !declared.has(key))} is a non-enumerable property`
      }
      for (const key of enumerable) {
        const slot = read(node, key)
        if (slot === undefined) return `${path}.${key} throws when read`
        const found = walk(slot.value, `${path}.${key}`, depth + 1)
        if (found !== undefined) return found
      }
      return undefined
    } finally {
      open.delete(node)
    }
  }
  return walk(value, root, 0)
}

// ---------------------------------------------------------------------------
// Text checks
// ---------------------------------------------------------------------------

/** One named check: whether it passed and why. */
export interface Check {
  readonly id: string
  readonly pass: boolean
  readonly detail: string
}

const maxDetail = 200

const clip = (detail: string): string => detail.length > maxDetail ? `${detail.slice(0, maxDetail - 1)}…` : detail

const check = (id: string, pass: boolean, detail: string): Check => ({ id, pass, detail: clip(detail) })

const quote = (text: string): string => JSON.stringify(text)

// Typographic quotes and apostrophes match their ASCII forms. Models write both.
const fold = (text: string): string => text.replace(/[‘’ʼ]/gu, "'").replace(/[“”]/gu, "\"")

const wordChar = /[\p{L}\p{N}_]/u

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const literal = /^\/(.+)\/([a-z]*)$/su

// `/source/flags` is a regular expression, `stem*` a case-insensitive word or
// phrase whose last word may continue, anything else a whole word or phrase.
const phrase = (entry: string): RegExp => {
  const regex = literal.exec(entry)
  if (regex !== null) {
    const flags = regex[2]!
    return new RegExp(regex[1]!, flags.includes("g") ? flags : `${flags}g`)
  }
  const stem = entry.endsWith("*")
  const word = stem ? entry.slice(0, -1) : entry
  if (word.length === 0) return /(?!)/gu
  const before = wordChar.test(word.charAt(0)) ? "(?<![\\p{L}\\p{N}_])" : ""
  const after = stem ? "[\\p{L}\\p{N}_]*" : wordChar.test(word.charAt(word.length - 1)) ? "(?![\\p{L}\\p{N}_])" : ""
  return new RegExp(`${before}${escape(word).replace(/\s+/g, "\\s+")}${after}`, "giu")
}

const hits = (text: string, entry: string): ReadonlyArray<string> =>
  entry.length === 0
    ? []
    : [...new Set([...fold(text).matchAll(phrase(literal.test(entry) ? entry : fold(entry)))].map(([match]) => match))]

/** Whether `entry` is a `/source/flags` entry whose pattern does not compile. */
export const invalidPattern = (entry: string): string | undefined => {
  const regex = literal.exec(entry)
  if (regex === null) return undefined
  try {
    new RegExp(regex[1]!, regex[2]!)
    return undefined
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

// Slack `<url|label>` and `<url>`, markdown `[label](url)`, then a bare URL.
const linkSyntax = /<([a-z][a-z0-9+.-]*:[^|<>\s]+)(?:\|([^<>]*))?>|\[([^[\]]*)\]\(([^)[\s]+)\)|https?:\/\/[^\s<>]+/giu

const trimBare = (url: string): string => {
  let open = 0
  for (const char of url) open += char === "(" ? 1 : char === ")" ? -1 : 0
  let end = url.length
  for (;;) {
    const last = url.charAt(end - 1)
    const unbalanced = last === ")" && open < 0
    if (!".,;:!?'\"]".includes(last) && !unbalanced) return url.slice(0, end)
    if (last === ")") open++
    end--
  }
}

// A labelled link counts as its label's words, a bare URL as one word.
const linksAsWords = (text: string): string => {
  let out = ""
  let at = 0
  for (const match of text.matchAll(linkSyntax)) {
    const [raw, slackUrl, slackLabel, markdownLabel, markdownUrl] = match
    const labelled = slackUrl !== undefined || markdownUrl !== undefined
    const consumed = labelled ? raw : trimBare(raw)
    out += text.slice(at, match.index) + (labelled ? ` ${(slackLabel ?? markdownLabel ?? "").trim()} ` : " link ")
    at = match.index + consumed.length
  }
  return out + text.slice(at)
}

/** Whitespace-separated tokens holding a letter or a digit. */
export const words = (text: string): number =>
  linksAsWords(text).split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length

export const lengthCheck = (text: string, bounds: { readonly min?: number | undefined; readonly max?: number | undefined }): Check => {
  const count = words(text)
  if (bounds.min !== undefined && count < bounds.min) return check("words", false, `${count} words < ${bounds.min}`)
  if (bounds.max !== undefined && count > bounds.max) return check("words", false, `${count} words > ${bounds.max}`)
  return check("words", true, `${count} words`)
}

export const includesCheck = (text: string, required: ReadonlyArray<string | ReadonlyArray<string>>): Check => {
  const missing = required
    .map((entry) => typeof entry === "string" ? [entry] : entry)
    .filter((group) => !group.some((member) => hits(text, member).length > 0))
    .map((group) => group.map(quote).join(" | "))
  return missing.length === 0 ? check("includes", true, "all present") : check("includes", false, `missing: ${missing.join(", ")}`)
}

export const excludesCheck = (text: string, forbidden: ReadonlyArray<string>): Check => {
  const found = [...new Set(forbidden.flatMap((entry) => hits(text, entry)))]
  return found.length === 0 ? check("excludes", true, "none found") : check("excludes", false, `found: ${found.map(quote).join(", ")}`)
}

const leading = /^(?:[\s\p{P}\p{S}\p{Extended_Pictographic}]|‍|️)+/u

export const openerCheck = (text: string, phrases: ReadonlyArray<string>): Check => {
  const start = fold(text).replace(leading, "")
  for (const entry of phrases) {
    if (entry.trim().length === 0) continue
    const match = new RegExp(`^${escape(fold(entry).trim()).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}_])`, "iu").exec(start)
    if (match !== null) return check("opener", false, `opens with ${quote(match[0])}`)
  }
  return check("opener", true, "no listed opener")
}

const fenceLine = /^ {0,3}```/u

export const completeCheck = (text: string): Check => {
  const prose: Array<string> = []
  let open = false
  for (const line of text.split("\n")) {
    if (fenceLine.test(line)) open = !open
    else if (!open) prose.push(line)
  }
  const plain = prose.join("\n").replace(/`[^`\n]*`/gu, " ")
  const problems = [...plain.matchAll(/[\p{L}\p{N}_-]{0,20}[\p{L}\p{N}](?:…|\.{3})/gu)].map(([match]) => quote(match))
  const tail = /(?:…|\.{3})\s*$/u.exec(plain)
  if (tail !== null && problems.length === 0) problems.push("trailing ellipsis")
  if (open) problems.push("unclosed code fence")
  return problems.length === 0 ? check("complete", true, "complete") : check("complete", false, `found: ${problems.join(", ")}`)
}
