// A reading of VIP-58's matching and ordering rules over regular
// expressions. The capability tests compare the kernel against it, so it
// shares no code with the kernel.
import fc from "fast-check"
import type { Capability } from "vibelang-runtime/experimental"

// A character outside the Basic Multilingual Plane: two code units, one
// character.
export const key = "\u{1F511}"

export const alphabet = ["a", "b", "/", " ", key, "*", "?"] as const

// In a `u` expression `[^]` is one character, whatever its code point.
const compile = (glob: string): RegExp =>
  new RegExp(
    `^${Array.from(glob, (unit) => unit === "*" ? "[^]*" : unit === "?" ? "[^]" : unit.replace(/[.+^${}()|[\]\\/]/g, "\\$&")).join("")}$`,
    "u"
  )

export const modelMatchesResource = (pattern: string, resource: string): boolean =>
  compile(pattern).test(resource) || (pattern.endsWith(" *") && compile(pattern.slice(0, -2)).test(resource))

// A file path with an empty segment also names the path without it.
const pathTexts = (resource: string): ReadonlyArray<string> =>
  [...new Set([resource, resource.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1")])]

// How a request's URL writes a text. Its host ends at the first slash, and
// a host with a character outside ASCII is written in the ASCII form the
// platform's `URL` gives it, when `URL` can read it. A space and the key
// anywhere else are percent-encoded.
const asRequested = (text: string): string => {
  const slash = text.indexOf("/")
  const host = slash < 0 ? text : text.slice(0, slash)
  let written = host
  if (host.includes(key) && !host.includes("?")) {
    try {
      written = new URL(`http://${host}`).hostname
    } catch {
      written = host
    }
  }
  return `${written}${slash < 0 ? "" : text.slice(slash)}`.replaceAll(" ", "%20").replaceAll(key, "%F0%9F%94%91")
}

/**
 * Whether a pattern selects a capability. An allow takes the narrow
 * reading: every text a file path stands for, and a URL in a request's
 * spelling. A deny or an ask takes the wide one: any text of a path, and a
 * URL as written or as requested.
 */
export const modelMatches = (
  pattern: Capability.Pattern,
  capability: Capability.Capability,
  reading: "narrow" | "wide" = "narrow"
): boolean => {
  if (
    pattern.action !== "*" && pattern.action !== capability.action &&
    !(pattern.action.endsWith(":*") && capability.action.split(":")[0] === pattern.action.split(":")[0])
  ) {
    return false
  }
  if (capability.action.startsWith("net:")) {
    return (reading === "wide" && modelMatchesResource(pattern.resource, capability.resource)) ||
      modelMatchesResource(asRequested(pattern.resource), asRequested(capability.resource))
  }
  if (!capability.action.startsWith("fs:")) return modelMatchesResource(pattern.resource, capability.resource)
  const texts = pathTexts(capability.resource)
  return reading === "narrow"
    ? texts.every((text) => modelMatchesResource(pattern.resource, text))
    : texts.some((text) => modelMatchesResource(pattern.resource, text))
}

type Answer = { readonly effect: Capability.Decision; readonly pattern: Capability.Pattern }

export const modelMatchesAnswer = (rule: Answer, capability: Capability.Capability): boolean =>
  modelMatches(rule.pattern, capability, rule.effect === "allow" ? "narrow" : "wide")

export const modelEvaluate = (
  policy: { readonly allow: ReadonlyArray<Capability.Pattern>; readonly deny: ReadonlyArray<Capability.Pattern> },
  capability: Capability.Capability,
  answers: ReadonlyArray<Answer>
): Capability.Decision => {
  if (policy.deny.some((pattern) => modelMatches(pattern, capability, "wide"))) return "deny"
  const last = answers.filter((rule) => modelMatchesAnswer(rule, capability)).at(-1)
  if (last !== undefined) return last.effect
  return policy.allow.some((pattern) => modelMatches(pattern, capability)) ? "allow" : "ask"
}

// Short strings over a small alphabet, so patterns and resources collide.
const text = (units: ReadonlyArray<string>) =>
  fc.array(fc.constantFrom(...units), { maxLength: 6 }).map((parts) => parts.join(""))

export const anyCapability = fc.record({
  action: fc.constantFrom<Capability.Action>("fs:read", "fs:write", "net:get", "net:post", "proc:spawn", "memory:read"),
  resource: text(["a", "b", "/", " ", key])
})

export const anyPattern = fc.record({
  action: fc.constantFrom<Capability.PatternAction>(
    "fs:read", "fs:write", "net:get", "net:post", "proc:spawn", "memory:read", "fs:*", "net:*", "proc:*", "*"
  ),
  resource: text(alphabet)
})

export const anyRule = fc.record({
  effect: fc.constantFrom<Capability.Decision>("allow", "deny", "ask"),
  pattern: anyPattern
})

export const shuffled = <A>(values: ReadonlyArray<A>, seed: number): Array<A> => {
  const out = [...values]
  let state = seed >>> 0
  for (let index = out.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const other = state % (index + 1)
    ;[out[index], out[other]] = [out[other]!, out[index]!]
  }
  return out
}
