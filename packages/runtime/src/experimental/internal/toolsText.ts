/**
 * Bounded text for `Experimental.Tools` (VIP-64): capped capture, a small
 * child environment, and HTML reduced to readable text. Pure.
 *
 * @internal
 */

/** Text cut to at most `max` UTF-16 code units, and whether it was cut. */
export const cap = (text: string, max: number): { readonly text: string; readonly truncated: boolean } =>
  text.length <= max ? { text, truncated: false } : { text: text.slice(0, max), truncated: true }

/** A byte sink that keeps the first `max` bytes and counts the rest. */
export interface Capture {
  readonly push: (chunk: Uint8Array) => void
  readonly text: () => string
  readonly truncated: () => boolean
  readonly total: () => number
}

export const capture = (max: number): Capture => {
  const kept: Array<Uint8Array> = []
  let size = 0
  let total = 0
  return {
    push: (chunk) => {
      total += chunk.length
      if (size >= max) return
      const room = max - size
      const piece = chunk.length <= room ? chunk : chunk.subarray(0, room)
      kept.push(piece)
      size += piece.length
    },
    text: () => {
      const all = new Uint8Array(size)
      let at = 0
      for (const piece of kept) {
        all.set(piece, at)
        at += piece.length
      }
      // A multi-byte character cut at the bound decodes as U+FFFD, not as an error.
      return new TextDecoder("utf-8", { fatal: false }).decode(all)
    },
    truncated: () => total > size,
    total: () => total
  }
}

/** The variables a child process inherits from the host without being named. */
export const inheritedNames: ReadonlyArray<string> = ["PATH", "HOME", "USER", "LANG", "TERM", "TMPDIR", "SHELL"]

/**
 * The environment a child gets: the small inherited set and `LC_*`, the
 * host variables the caller names in `inherit`, then what it declares in
 * `env`. Nothing else crosses, so a provider key in the host's environment
 * does not reach the child unless it is named.
 */
export const childEnvironment = (
  host: Readonly<Record<string, string | undefined>>,
  options: {
    readonly inherit?: ReadonlyArray<string> | undefined
    readonly env?: Readonly<Record<string, string>> | undefined
  } = {}
): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(host)) {
    if (value === undefined) continue
    if (inheritedNames.includes(name) || name.startsWith("LC_")) out[name] = value
  }
  for (const name of options.inherit ?? []) {
    const value = host[name]
    if (value !== undefined) out[name] = value
  }
  for (const [name, value] of Object.entries(options.env ?? {})) out[name] = value
  return out
}

/** The host's environment, or none on a platform without one. */
export const hostEnvironment = (): Readonly<Record<string, string | undefined>> =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}

const entities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " "
}

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return entities[body.toLowerCase()] ?? whole
  })

/** The `<title>` of an HTML page and its readable text. */
export const htmlToText = (html: string): { readonly title: string | undefined; readonly text: string } => {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch === null ? undefined : decodeEntities(titleMatch[1]!.replace(/\s+/g, " ").trim())
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote|header|footer|ul|ol|table)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "")
  const text = decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\r]+/g, " ").trim())
    .filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""))
    .join("\n")
    .trim()
  return { title: title === "" ? undefined : title, text }
}
