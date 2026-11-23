/**
 * The capability vocabulary and its pure functions: text form, glob
 * matching, rule evaluation and effect tiers. Ported from Smithers'
 * `@smthrs/capability`. Nothing here holds state or needs a service.
 *
 * @internal
 */

export const actions = [
  "fs:read",
  "fs:write",
  "net:get",
  "net:post",
  "net:private",
  "model:call",
  "memory:read",
  "memory:write",
  "proc:spawn",
  "jj:status",
  "jj:diff",
  "jj:snapshot",
  "jj:restore",
  "jj:workspace-add",
  "jj:workspace-forget",
  "jj:root",
  "jj:revert",
  "jj:op-restore"
] as const

export type Action = (typeof actions)[number]

export const patternActions = [...actions, "fs:*", "net:*", "model:*", "memory:*", "proc:*", "jj:*", "*"] as const

export type PatternAction = (typeof patternActions)[number]

export interface Capability {
  readonly action: Action
  readonly resource: string
}

export interface Pattern {
  readonly action: PatternAction
  readonly resource: string
}

export type Decision = "allow" | "deny" | "ask"

export interface Rule {
  readonly effect: Decision
  readonly pattern: Pattern
}

export type Tier = "sealed" | "compensable" | "irreversible"

export const maxResourceLength = 4096

// One match costs at most pattern length times resource length. Both are
// bounded by maxResourceLength when they come from text; the budget also
// covers a structural value nobody checked.
const maxMatchWork = maxResourceLength * maxResourceLength

const actionSet: ReadonlySet<string> = new Set(actions)
const patternActionSet: ReadonlySet<string> = new Set(patternActions)

export const isAction = (value: unknown): value is Action => typeof value === "string" && actionSet.has(value)

export const isPatternAction = (value: unknown): value is PatternAction =>
  typeof value === "string" && patternActionSet.has(value)

const isResource = (value: unknown): value is string => typeof value === "string" && value.length <= maxResourceLength

export const isCapability = (value: unknown): value is Capability =>
  typeof value === "object" && value !== null &&
  isAction((value as Capability).action) && isResource((value as Capability).resource)

export const isPattern = (value: unknown): value is Pattern =>
  typeof value === "object" && value !== null &&
  isPatternAction((value as Pattern).action) && isResource((value as Pattern).resource)

// The action is the first two colon-separated components. All remaining
// text is the resource, colons and the empty string included.
export const parse = (input: string): Capability | undefined => {
  const components = input.split(":")
  if (components.length < 3) return undefined
  const action = `${components[0]}:${components[1]}`
  const resource = components.slice(2).join(":")
  return isAction(action) && isResource(resource) ? Object.freeze({ action, resource }) : undefined
}

// The whole-authority action `*` takes one component. A bare `*` is every
// action on every resource.
export const parsePattern = (input: string): Pattern | undefined => {
  const components = input.split(":")
  if (components[0] === "*") {
    if (components.length < 2) return Object.freeze({ action: "*", resource: "**" })
    const resource = components.slice(1).join(":")
    return isResource(resource) ? Object.freeze({ action: "*", resource }) : undefined
  }
  if (components.length < 3) return undefined
  const action = `${components[0]}:${components[1]}`
  const resource = components.slice(2).join(":")
  return isPatternAction(action) && isResource(resource) ? Object.freeze({ action, resource }) : undefined
}

export const format = (value: Capability | Pattern): string => `${value.action}:${value.resource}`

export const matchesAction = (pattern: PatternAction, action: Action): boolean =>
  pattern === "*" || pattern === action || (pattern.endsWith(":*") && action.startsWith(pattern.slice(0, -1)))

// Whether a surrogate pair starts here: one character written as two code
// units.
const pairAt = (text: string, index: number): boolean => {
  const high = text.charCodeAt(index)
  if (high < 0xd800 || high > 0xdbff) return false
  const low = text.charCodeAt(index + 1)
  return low >= 0xdc00 && low <= 0xdfff
}

// A two-pointer wildcard match. `?` is one character, so a character
// outside the Basic Multilingual Plane counts once. It remembers only the
// most recent `*`, so the cost is bounded by pattern length times resource
// length. A pattern is input on the authorization path, and a backtracking
// regular expression would let `a*a*a*a*b` take exponential time.
const matchGlob = (pattern: string, resource: string): boolean => {
  let patternIndex = 0
  let resourceIndex = 0
  let starIndex = -1
  let starResourceIndex = 0
  while (resourceIndex < resource.length) {
    const unit = pattern[patternIndex]
    if (unit === "*") {
      starIndex = patternIndex
      starResourceIndex = resourceIndex
      patternIndex += 1
    } else if (unit === "?") {
      patternIndex += 1
      resourceIndex += pairAt(resource, resourceIndex) ? 2 : 1
    } else if (unit !== undefined && unit === resource[resourceIndex]) {
      patternIndex += 1
      resourceIndex += 1
    } else if (starIndex >= 0) {
      patternIndex = starIndex + 1
      starResourceIndex += pairAt(resource, starResourceIndex) ? 2 : 1
      resourceIndex = starResourceIndex
    } else {
      return false
    }
  }
  while (pattern[patternIndex] === "*") patternIndex += 1
  return patternIndex === pattern.length
}

const matchesResource = (pattern: string, resource: string): boolean => {
  // Over budget, a match is false: a grant never widens. `evaluateRules`
  // separately turns an undecidable rule into a denial.
  if (pattern.length * resource.length > maxMatchWork) return false
  // A pattern ending in ` *`, such as the command grant `npm *`, also
  // matches the bare resource with no argument text.
  if (pattern.endsWith(" *") && matchGlob(pattern.slice(0, -2), resource)) return true
  return matchGlob(pattern, resource)
}

const selectsFilesystem = (action: string): boolean => action === "*" || action.startsWith("fs:")

const normalizeRelative = (resource: string): string | undefined => {
  const out: Array<string> = []
  for (const segment of resource.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (out.length === 0) return undefined
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.length === 0 ? "." : out.join("/")
}

// The texts a filesystem resource stands for when a path can be spelled
// more than one way. Matching is textual, so a `.` or `..` segment is
// ambiguous. An absolute resource with one has no form: the guard resolves
// a path before it asks, so nothing legitimate arrives with one. A relative
// one stands for its text and its normal form, unless it climbs above its
// start. An empty segment, as in `/ws//.env` or `/ws/secrets/`, names what
// the path without it names, so such a resource stands for both texts.
const pathForms = (action: string, resource: string): ReadonlyArray<string> | undefined => {
  if (!selectsFilesystem(action)) return [resource]
  const segments = resource.split("/")
  if (!segments.some((segment) => segment === "." || segment === "..")) {
    const named = segments.filter((segment) => segment !== "")
    const collapsed = resource.startsWith("/") ? `/${named.join("/")}` : named.join("/")
    return resource === "" || collapsed === resource ? [resource] : [resource, collapsed]
  }
  if (resource.startsWith("/") || resource.includes("\\") || /^[A-Za-z]:/.test(resource) || resource.startsWith("~")) {
    return undefined
  }
  const lastParent = segments.lastIndexOf("..")
  if (lastParent >= 0 && segments.slice(0, lastParent).some((segment) => /[*?]/.test(segment))) return undefined
  const normal = normalizeRelative(resource)
  return normal === undefined ? undefined : [resource, normal]
}

const unreserved = /^[A-Za-z0-9\-._~]$/

/**
 * One spelling for the escapes in a URL: an escape of a character that
 * never needs one is decoded, so `%7Eadmin` is `~admin`, and every other
 * escape is written in upper case. A server reads both spellings as one, so
 * a network pattern and a network resource are both read this way.
 */
export const normalizeEscapes = (text: string): string =>
  text.replace(/%([0-9A-Fa-f]{2})/g, (escape, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16))
    return unreserved.test(character) ? character : escape.toUpperCase()
  })

const isNetwork = (action: Action): boolean => action.startsWith("net:")

// Where a URL's scheme ends, or -1. `://` is a scheme's only when nothing
// before it is a `/`: in `*.example.com/cb?next=https://x` it is part of
// the query.
const schemeEnd = (text: string): number => {
  const scheme = text.indexOf("://")
  return scheme >= 0 && text.indexOf("/") === scheme + 1 ? scheme + 3 : -1
}

// A URL splits after its host: `https://api.example.com` and `/v1/users`.
const splitUrl = (text: string): readonly [origin: string, rest: string] | undefined => {
  const scheme = schemeEnd(text)
  if (scheme < 0) return undefined
  const slash = text.indexOf("/", scheme)
  return slash < 0 ? undefined : [text.slice(0, slash), text.slice(slash)]
}

// Where a network pattern's host ends: the first `/` after its scheme, or
// with no scheme the first `/` at all. A pattern with neither is all host.
const hostEnd = (pattern: string): number => pattern.indexOf("/", Math.max(schemeEnd(pattern), 0))

// A character that a request's URL percent-encodes in its path or its
// query, or that only some platforms leave as itself, as its escape. None of
// them separates the parts of a URL, so the escape and the character name
// the same resource. A URL parser writes `{` as `%7B` in a path and leaves
// it in a query, and `'` the other way round: reading both sides with the
// escape means a rule written either way meets a request written either way.
const encodeUnsafe = (text: string): string =>
  text.replace(/[\x00-\x20"'<>^`{|}\x7f]|[^\x00-\x7f]+/g, (run) =>
    Array.from(run, (character) => {
      const point = character.codePointAt(0)!
      if (point >= 0xd800 && point <= 0xdfff) return "%EF%BF%BD"
      return point < 0x80 ? `%${point.toString(16).toUpperCase().padStart(2, "0")}` : encodeURIComponent(character)
    }).join(""))

const defaultPort = /^(?:(https:\/\/.*):443|(http:\/\/.*):80)$/s

// A host with a letter outside ASCII, in the ASCII form a request's URL
// has for it. A host the platform cannot read stays as written.
const asciiHost = (origin: string): string => {
  if (!/[^\x00-\x7f]/.test(origin)) return origin
  const start = Math.max(schemeEnd(origin), 0)
  const port = /:[0-9*]*$/.exec(origin.slice(start))?.[0] ?? ""
  const host = origin.slice(start, origin.length - port.length)
  if (/[?#@\\[\]]/.test(host)) return origin
  try {
    return `${origin.slice(0, start)}${new URL(`http://${host}`).hostname}${port}`
  } catch {
    return origin
  }
}

// The spelling a request's URL is asked about in: the scheme and host in
// lower case, no default port, and a space, a letter outside ASCII and the
// other characters `encodeUnsafe` names as their percent-encoding. A pattern and a resource are both read this way, so a
// rule written `https://API.example.com:443/my files/**` selects the
// request for `https://api.example.com/my%20files/a`.
const spellNetwork = (text: string): string => {
  const end = hostEnd(text)
  const origin = asciiHost((end < 0 ? text : text.slice(0, end)).toLowerCase()).replace(defaultPort, "$1$2")
  return normalizeEscapes(encodeUnsafe(`${origin}${end < 0 ? "" : text.slice(end)}`))
}

// The text an allow or a ceiling matches a pattern or a resource as.
const spelled = (action: Action, text: string): string => isNetwork(action) ? spellNetwork(text) : text

// The narrow reading of a network pattern: a wildcard in the host stays in
// the host. `*` matches `/`, so as one text `https://*.example.com/*` would
// also select `https://evil.test/.example.com/`. The pattern must select the
// whole text, as every pattern must, and its host part must also select the
// resource's host on its own, and its path part the path. A pattern with no
// path part must select the host by itself. So this reading only narrows.
const matchesNarrow = (action: Action, pattern: string, resource: string): boolean => {
  if (!matchesResource(pattern, resource)) return false
  if (!isNetwork(action)) return true
  const parts = splitUrl(resource)
  if (parts === undefined) return true
  if (pattern.length * resource.length > maxMatchWork) return false
  const end = hostEnd(pattern)
  return end < 0
    ? matchGlob(pattern, parts[0])
    : matchGlob(pattern.slice(0, end), parts[0]) && matchGlob(pattern.slice(end), parts[1])
}

/**
 * Whether a pattern selects a capability, on the narrow reading an allow
 * and a ceiling use: every form of the resource, a host wildcard that stays
 * in the host, and exact case.
 */
export const matches = (pattern: Pattern, capability: Capability): boolean => {
  if (!matchesAction(pattern.action, capability.action)) return false
  const forms = pathForms(capability.action, capability.resource)
  const text = spelled(capability.action, pattern.resource)
  return forms !== undefined && forms.every((resource) => matchesNarrow(capability.action, text, spelled(capability.action, resource)))
}

// The wide reading a deny or an ask uses: any form of the resource, as one
// text. For a file it is also read without regard to case, because some
// volumes fold case and a deny must not depend on how a name was typed. For
// a URL it is read both as written and in a request's spelling, so a deny
// holds whichever way its author wrote the host, the port and the path.
const restricts = (pattern: Pattern, capability: Capability, forms: ReadonlyArray<string>): boolean => {
  if (!matchesAction(pattern.action, capability.action)) return false
  if (isNetwork(capability.action)) {
    return forms.some((form) =>
      matchesResource(normalizeEscapes(pattern.resource), normalizeEscapes(form)) ||
      matchesResource(spellNetwork(pattern.resource), spellNetwork(form))
    )
  }
  return forms.some((form) =>
    matchesResource(pattern.resource, form) ||
    (capability.action.startsWith("fs:") && matchesResource(pattern.resource.toLowerCase(), form.toLowerCase()))
  )
}

// A request's spelling can be longer than the text as written, so the
// budget is taken on the longer of the two.
const matchLength = (action: Action, text: string): number =>
  isNetwork(action) ? Math.max(text.length, spellNetwork(text).length) : text.length

const withinMatchBudget = (pattern: Pattern, capability: Capability): boolean =>
  !matchesAction(pattern.action, capability.action) ||
  matchLength(capability.action, pattern.resource) * matchLength(capability.action, capability.resource) <= maxMatchWork

/**
 * Reduces ordered rulesets to one decision. The last rule that matches wins
 * across all of them, and a request no rule matches is `ask`. `rulesets[0]`
 * is the configured policy: when its own last match is `deny`, the decision
 * is `deny` whatever a later ruleset says.
 *
 * It fails closed on what it cannot decide: a rule over the match budget and
 * a filesystem resource with no form are both `deny`. An allow takes the
 * narrow reading of a pattern and a deny or an ask the wide one.
 * An allow reaches `net:private` only when it names that exact action.
 */
export const evaluateRules = (
  rulesets: ReadonlyArray<ReadonlyArray<Rule>>,
  capability: Capability
): Decision => {
  const forms = pathForms(capability.action, capability.resource)
  if (forms === undefined) return "deny"
  let configured: Decision = "ask"
  let decision: Decision = "ask"
  for (let index = 0; index < rulesets.length; index += 1) {
    for (const rule of rulesets[index]!) {
      if (!withinMatchBudget(rule.pattern, capability)) return "deny"
      if (capability.action === "net:private" && rule.effect === "allow" && rule.pattern.action !== "net:private") {
        continue
      }
      if (rule.effect === "allow" ? matches(rule.pattern, capability) : restricts(rule.pattern, capability, forms)) {
        decision = rule.effect
        if (index === 0) configured = rule.effect
      }
    }
  }
  return configured === "deny" ? "deny" : decision
}

/**
 * A ceiling: groups of patterns. A capability is inside it when every group
 * holds a pattern that selects the capability. No group is no ceiling, and
 * one empty group is a ceiling nothing is inside.
 */
export type Ceiling = ReadonlyArray<ReadonlyArray<Pattern>>

export const noCeiling: Ceiling = Object.freeze([])

const comparePattern = (left: Pattern, right: Pattern): number =>
  left.action < right.action ? -1 :
  left.action > right.action ? 1 :
  left.resource < right.resource ? -1 :
  left.resource > right.resource ? 1 :
  0

const compareGroup = (left: ReadonlyArray<Pattern>, right: ReadonlyArray<Pattern>): number => {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const order = comparePattern(left[index]!, right[index]!)
    if (order !== 0) return order
  }
  return left.length - right.length
}

const normalizeGroup = (patterns: ReadonlyArray<Pattern>): ReadonlyArray<Pattern> => {
  const sorted = patterns.map(({ action, resource }) => Object.freeze({ action, resource })).sort(comparePattern)
  return Object.freeze(sorted.filter((pattern, index) => index === 0 || comparePattern(sorted[index - 1]!, pattern) !== 0))
}

/**
 * Intersects a ceiling with one more group. Groups are sorted and repeated
 * ones dropped, so narrowing by the same patterns again changes nothing and
 * a loop that narrows on every turn does not grow the ceiling.
 */
export const narrow = (ceiling: Ceiling, group: ReadonlyArray<Pattern>): Ceiling => {
  const groups = [...ceiling, normalizeGroup(group)].sort(compareGroup)
  if (groups.some((candidate) => candidate.length === 0)) return Object.freeze([Object.freeze([])])
  return Object.freeze(groups.filter((candidate, index) => index === 0 || compareGroup(groups[index - 1]!, candidate) !== 0))
}

export const ceilingAllows = (ceiling: Ceiling, capability: Capability): boolean =>
  ceiling.every((group) => group.some((pattern) => matches(pattern, capability)))

const literalPrefix = (resource: string): string => {
  const star = resource.indexOf("*")
  const mark = resource.indexOf("?")
  const end = Math.min(star < 0 ? resource.length : star, mark < 0 ? resource.length : mark)
  return resource.slice(0, end)
}

/**
 * Whether a deny among `rules` could select something inside the tree under
 * `capability`'s resource. An operation on a whole tree is asked about its
 * top path only, so this is how a deny on a file inside still vetoes it.
 *
 * It cannot list the tree, so it compares text: a deny whose literal start
 * is inside the tree, or contains the tree, could select a file in it. That
 * errs towards refusing: a deny such as `fs:write:*.key` could be inside
 * any tree.
 */
export const deniesInside = (rules: ReadonlyArray<Rule>, capability: Capability): boolean => {
  const tree = capability.resource.endsWith("/") ? capability.resource : `${capability.resource}/`
  const folded = tree.toLowerCase()
  return rules.some((rule) => {
    if (rule.effect !== "deny" || !matchesAction(rule.pattern.action, capability.action)) return false
    // Whether the pattern is all literal is decided before folding case:
    // folding can change a text's length.
    const literal = literalPrefix(rule.pattern.resource)
    const prefix = literal.toLowerCase()
    return literal.length === rule.pattern.resource.length
      ? prefix.startsWith(folded)
      : prefix.startsWith(folded) || folded.startsWith(prefix)
  })
}

const lexicalPath = (path: string): string => {
  const absolute = path.startsWith("/")
  const prefix = absolute ? "/" : ""
  const segments: Array<string> = []
  for (const segment of path.slice(prefix.length).split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop()
      else if (!absolute) segments.push(segment)
    } else {
      segments.push(segment)
    }
  }
  return `${prefix}${segments.join("/")}` || "."
}

const isForeignRooted = (resource: string): boolean =>
  /^[A-Za-z]:/.test(resource) || resource.startsWith("~") || resource.includes("\\")

const isInsideWorkspace = (resource: string, workspace: string): boolean => {
  const root = lexicalPath(workspace)
  if (root === "." || isForeignRooted(resource)) return false
  const resolved = lexicalPath(resource.startsWith("/") ? resource : `${root}/${resource}`)
  if (resolved === root) return true
  const prefix = root.endsWith("/") ? root : `${root}/`
  if (!resolved.startsWith(prefix)) return false
  // A relative root keeps its leading `..` segments, so a text prefix is not
  // containment: `../../x` starts with `../` and still leaves the root `..`.
  const remainder = resolved.slice(prefix.length)
  return remainder !== ".." && !remainder.startsWith("../")
}

export const tierOf = (capability: Capability, workspace: string): Tier => {
  switch (capability.action) {
    case "memory:read":
    case "fs:read":
    case "net:get":
    case "model:call":
    case "jj:status":
    case "jj:diff":
    case "jj:root":
      return "sealed"
    case "fs:write":
      return isInsideWorkspace(capability.resource, workspace) ? "compensable" : "irreversible"
    case "jj:snapshot":
    case "jj:restore":
    case "jj:workspace-add":
    case "jj:workspace-forget":
    case "jj:revert":
    case "jj:op-restore":
      return "compensable"
    case "memory:write":
    case "net:post":
    case "net:private":
    case "proc:spawn":
      return "irreversible"
  }
}

const maxDisplayFieldLength = 256
const truncationMarker = "…[truncated]"

const displayChunk = (unit: string): string => {
  if (unit === "\\") return "\\\\"
  if (unit === "\n") return "\\n"
  if (unit === "\r") return "\\r"
  if (unit === "\t") return "\\t"
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(unit)
    ? unit.split("").map((part) => `\\u${part.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`).join("")
    : unit
}

// A resource is text from outside: a path, a URL, a command line. In an
// error message it stays on one line, shows its control characters as
// escapes, and is cut at a fixed length.
export const displayField = (value: string): string => {
  const chunks: Array<string> = []
  let length = 0
  let truncated = false
  for (const unit of value) {
    const chunk = displayChunk(unit)
    if (length + chunk.length > maxDisplayFieldLength) {
      truncated = true
      break
    }
    chunks.push(chunk)
    length += chunk.length
  }
  if (!truncated) return chunks.join("")
  const contentLength = maxDisplayFieldLength - truncationMarker.length
  while (length > contentLength) length -= chunks.pop()!.length
  return `${chunks.join("")}${truncationMarker}`
}
