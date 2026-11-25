/**
 * The pure core of `Experimental.Secrets` (VIP-68): bindings, placeholders,
 * the egress decision and the scrubber. Ported from the reference engine's
 * secrets package (`Binding`, `Placeholder`, `Egress.decide`, `Scrub`).
 *
 * Nothing here reveals a value, sends a request or reads a service. Every
 * function is deterministic except {@link minter}, which uses WebCrypto.
 *
 * @internal
 */
import * as Stream from "effect/Stream"

const encoder = new TextEncoder()

export const utf8 = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text)

export const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

export const base64 = (bytes: Uint8Array, alphabet: "standard" | "url", padded: boolean): string => {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const standard = btoa(binary)
  const bare = padded ? standard : standard.replace(/=+$/, "")
  return alphabet === "standard" ? bare : bare.replace(/\+/g, "-").replace(/\//g, "_")
}

export const fromBase64 = (encoded: string): string | undefined => {
  let binary: string
  try {
    binary = atob(encoded)
  } catch {
    return undefined
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

export const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  let length = 0
  for (const part of parts) length += part.length
  const joined = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

// ---------------------------------------------------------------------------
// Bindings

export const namePattern = /^[A-Z_][A-Z0-9_]{0,63}$/

export const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const

export type Method = typeof methods[number]

export const maximumHosts = 16

const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * A lowercase DNS name of at least two labels, at most 253 characters, whose
 * last label is not all digits: no wildcard, IP address, port or single label.
 */
export const isHost = (candidate: string): boolean => {
  if (candidate.length > 253) return false
  const labels = candidate.split(".")
  return labels.length >= 2 && labels.every((part) => label.test(part)) && !/^[0-9]+$/.test(labels.at(-1)!)
}

export interface Binding {
  readonly name: string
  readonly hosts: ReadonlyArray<string>
  readonly methods?: ReadonlyArray<Method> | undefined
}

/** What is wrong with `binding`, or `undefined`. The answer never holds a value. */
export const bindingProblem = (binding: Binding): string | undefined => {
  if (typeof binding?.name !== "string" || !namePattern.test(binding.name)) {
    return "a secret's name matches ^[A-Z_][A-Z0-9_]{0,63}$"
  }
  if (!Array.isArray(binding.hosts) || binding.hosts.length < 1 || binding.hosts.length > maximumHosts) {
    return `secret ${binding.name} is bound to 1 to ${maximumHosts} hosts`
  }
  for (const host of binding.hosts) {
    if (typeof host !== "string" || !isHost(host)) {
      return `secret ${binding.name} names a host that is not a lowercase DNS name of two or more labels`
    }
  }
  if (binding.methods !== undefined) {
    if (!Array.isArray(binding.methods) || binding.methods.length < 1) {
      return `secret ${binding.name} lists at least one method when it lists methods`
    }
    for (const method of binding.methods) {
      if (!(methods as ReadonlyArray<string>).includes(method)) {
        return `secret ${binding.name} names a method outside ${methods.join(", ")}`
      }
    }
  }
  return undefined
}

export const minimumValueBytes = 8

export const maximumValueBytes = 16 * 1024

export type ValueProblem = "too_short" | "too_long" | "control_character" | "malformed_text"

export const valueProblem = (value: string): ValueProblem | undefined => {
  if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value)) return "malformed_text"
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return "control_character"
  const bytes = utf8(value).length
  if (bytes < minimumValueBytes) return "too_short"
  if (bytes > maximumValueBytes) return "too_long"
  return undefined
}

// ---------------------------------------------------------------------------
// Placeholders

export const prefix = "vibe-secret-"

export const minimumKeyLength = 32

const placeholderOnly = /^vibe-secret-[0-9a-f]{64}$/
const placeholderAnywhere = /vibe-secret-[0-9a-f]{64}/g

export const isPlaceholder = (candidate: string): boolean => placeholderOnly.test(candidate)

export const findPlaceholders = (candidate: string): ReadonlyArray<string> => candidate.match(placeholderAnywhere) ?? []

export interface Minter {
  readonly derive: (scope: string, name: string) => Promise<string>
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

/** A minter under `key`, imported once as a non-extractable HMAC-SHA-256 key. The caller checks the key's length. */
export const minter = async (key: string): Promise<Minter> => {
  const hmac = await crypto.subtle.importKey("raw", utf8(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return {
    derive: async (scope, name) => {
      const mac = await crypto.subtle.sign("HMAC", hmac, utf8(JSON.stringify(["placeholder", scope, name])))
      return `${prefix}${hex(new Uint8Array(mac))}`
    }
  }
}

/** 32 random bytes as hexadecimal: a key for one process, or a fresh scope. */
export const randomHex = (bytes = 32): string => hex(crypto.getRandomValues(new Uint8Array(bytes)))

// ---------------------------------------------------------------------------
// The egress decision

export interface Secret extends Binding {
  readonly placeholder: string
}

export interface Policy {
  readonly secrets: ReadonlyArray<Secret>
  readonly allow: ReadonlyArray<string>
}

export const maximumPlaceholders = 16

export const maximumHeaderBytes = 64 * 1024

export const refusals = {
  invalid_url: 400,
  port_not_allowed: 403,
  host_not_allowed: 403,
  unknown_placeholder: 403,
  secret_not_allowed: 403,
  insecure_scheme: 403,
  too_many_placeholders: 403,
  headers_too_large: 431
} as const

export type Refusal = keyof typeof refusals

/** Never forwarded: hop-by-hop headers (RFC 9110 §7.6.1), the host, and the length, which the client sets. */
const dropped: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
])

/** Never answered: hop-by-hop headers, and the encoding and length that decoding and scrubbing change. */
export const droppedAnswer: ReadonlySet<string> = new Set([...dropped, "content-encoding"])

export const forwardable = (headers: Readonly<Record<string, string>>): Record<string, string> => {
  const named = new Set((headers["connection"] ?? "").toLowerCase().split(",").map((name) => name.trim()))
  const kept: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!dropped.has(name) && !named.has(name)) kept[name] = value
  }
  return kept
}

const basic = /^basic\s+/i

/** The text a header value holds placeholders in: a Basic credential decoded, any other value as is. */
const readable = (name: string, value: string): string => {
  if (name !== "authorization" || !basic.test(value)) return value
  return fromBase64(value.replace(basic, "").trim()) ?? value
}

/** `value` with each placeholder in `values` replaced, a Basic credential decoded and encoded again. */
export const substituted = (name: string, value: string, values: ReadonlyMap<string, string>): string => {
  const swap = (input: string) => {
    let swapped = input
    for (const [placeholder, secret] of values) swapped = swapped.split(placeholder).join(secret)
    return swapped
  }
  if (name === "authorization" && basic.test(value)) {
    const decoded = fromBase64(value.replace(basic, "").trim())
    if (decoded !== undefined) return `Basic ${base64(utf8(swap(decoded)), "standard", true)}`
  }
  return swap(value)
}

export interface Allowed {
  readonly _tag: "Allowed"
  readonly host: string
  readonly used: ReadonlyArray<Secret>
}

export interface Denied {
  readonly _tag: "Denied"
  readonly host: string
  readonly code: Refusal
  readonly secrets: ReadonlyArray<string>
}

/**
 * Whether `policy` lets a request with this method, URL and headers go out,
 * before any value is revealed. Header names are lowercase.
 */
export const decide = (
  request: { readonly method: string; readonly url: string; readonly headers: Readonly<Record<string, string>> },
  policy: Policy
): Allowed | Denied => {
  // Placeholders first, so every refusal names the secrets the request carried.
  const found = new Set<string>()
  for (const [name, value] of Object.entries(forwardable(request.headers))) {
    for (const placeholder of findPlaceholders(readable(name, value))) found.add(placeholder)
  }
  const known = new Map(policy.secrets.map((secret) => [secret.placeholder, secret]))
  const carried = [...found].flatMap((placeholder) => known.get(placeholder)?.name ?? [])
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return { _tag: "Denied", host: "", code: "invalid_url", secrets: carried }
  }
  const host = url.protocol === "https:" || url.protocol === "http:" ? url.hostname : ""
  const denied = (code: Refusal): Denied => ({ _tag: "Denied", host, code, secrets: carried })
  if (host === "" || url.username !== "" || url.password !== "") return denied("invalid_url")
  if (url.port !== "") return denied("port_not_allowed")
  const bound = policy.secrets.some((secret) => secret.hosts.includes(host))
  if (!bound && !policy.allow.includes(host)) return denied("host_not_allowed")
  if (found.size > maximumPlaceholders) return denied("too_many_placeholders")
  const used: Array<Secret> = []
  for (const placeholder of found) {
    const secret = known.get(placeholder)
    if (secret === undefined) return denied("unknown_placeholder")
    const allowed = secret.methods
    if (!secret.hosts.includes(host) || (allowed !== undefined && !(allowed as ReadonlyArray<string>).includes(request.method))) {
      return denied("secret_not_allowed")
    }
    used.push(secret)
  }
  if (used.length > 0 && url.protocol !== "https:") return denied("insecure_scheme")
  return { _tag: "Allowed", host, used }
}

export const headerBytes = (headers: Readonly<Record<string, string>>): number => {
  let total = 0
  for (const [name, value] of Object.entries(headers)) total += utf8(name).length + utf8(value).length + 4
  return total
}

// ---------------------------------------------------------------------------
// Scrubbing

export interface Target {
  readonly value: string
  readonly replacement: string
}

export interface Scrubber {
  readonly active: boolean
  readonly text: (value: string) => string
  readonly bytes: (value: Uint8Array) => Uint8Array
  readonly stream: <E, R>(body: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<Uint8Array, E, R>
}

/**
 * The forms of `value` an echo may take, without repeats: the value, its
 * percent encodings, its JSON string form, and its base64 and base64url
 * forms at each of the three byte alignments.
 */
export const forms = (value: string): ReadonlyArray<string> => {
  const percent = encodeURIComponent(value)
  const found = new Set([
    value,
    percent,
    percent.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
    percent.replace(/%20/g, "+"),
    JSON.stringify(value).slice(1, -1)
  ])
  const bytes = utf8(value)
  for (let alignment = 0; alignment < 3; alignment++) {
    const shifted = concat([new Uint8Array(alignment), bytes])
    const from = Math.ceil((8 * alignment) / 6)
    const to = Math.floor((8 * shifted.length) / 6)
    for (const alphabet of ["standard", "url"] as const) {
      found.add(base64(shifted, alphabet, false).slice(from, to))
    }
  }
  found.delete("")
  return [...found]
}

interface Pattern {
  readonly bytes: Uint8Array
  readonly replacement: Uint8Array
}

const matchesAt = (input: Uint8Array, at: number, pattern: Uint8Array): boolean => {
  for (let index = 0; index < pattern.length; index++) {
    if (input[at + index] !== pattern[index]) return false
  }
  return true
}

/** A scrubber for `targets`. Where two forms match at one position, the longer one is replaced. */
export const scrubber = (targets: ReadonlyArray<Target>): Scrubber => {
  const patterns: Array<Pattern> = []
  for (const target of targets) {
    const replacement = utf8(target.replacement)
    for (const form of forms(target.value)) patterns.push({ bytes: utf8(form), replacement })
  }
  patterns.sort((left, right) => right.bytes.length - left.bytes.length)
  const longest = patterns[0]?.bytes.length ?? 0
  const firsts = new Set(patterns.map((pattern) => pattern.bytes[0]))

  // Scrubs `input` up to where a form could still continue in the next
  // chunk, or to its end when `final`.
  const scan = (input: Uint8Array, final: boolean) => {
    const limit = final ? input.length : input.length - longest + 1
    const parts: Array<Uint8Array> = []
    let start = 0
    let at = 0
    while (at < limit) {
      if (firsts.has(input[at]!)) {
        const hit = patterns.find((pattern) =>
          pattern.bytes.length <= input.length - at && matchesAt(input, at, pattern.bytes)
        )
        if (hit !== undefined) {
          parts.push(input.subarray(start, at), hit.replacement)
          at += hit.bytes.length
          start = at
          continue
        }
      }
      at++
    }
    parts.push(input.subarray(start, at))
    return { done: concat(parts), held: input.slice(at) }
  }

  const emit = (bytes: Uint8Array): ReadonlyArray<Uint8Array> => (bytes.length > 0 ? [bytes] : [])

  return {
    active: patterns.length > 0,
    text: (value) => (patterns.length > 0 ? text(scan(utf8(value), true).done) : value),
    bytes: (value) => (patterns.length > 0 ? scan(value, true).done : value),
    stream: (body) =>
      patterns.length === 0 ? body : body.pipe(
        Stream.mapAccum(
          () => new Uint8Array(0),
          (held: Uint8Array, chunk: Uint8Array) => {
            const { done, held: next } = scan(concat([held, chunk]), false)
            return [next, emit(done)] as const
          },
          { onHalt: (held) => emit(scan(held, true).done) }
        )
      )
  }
}
