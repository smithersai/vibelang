/**
 * The redaction rules `Experimental.Otlp` applies to every export (VIP-72
 * rule 2): a textual net over credential shapes, and structural redaction of
 * an OTLP attribute whose key names a credential. Ported from the reference
 * engine's journal `Redaction` module (`defaultRules`, `isSensitiveKey`),
 * reduced to the rules a log line, a span and a metric need.
 *
 * Every rule reaches a fixed point: redacting redacted text changes nothing.
 * The net is finite. A value that must never leave the process belongs in a
 * `Redacted` field, never in a log line.
 *
 * @internal
 */

export const placeholder = "[REDACTED]"

interface Rule {
  readonly id: string
  readonly pattern: RegExp
  readonly replace: string | ((match: string, ...groups: Array<string>) => string)
}

const credentialName =
  "(?:pass(?:word|wd|phrase)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|secret[_-]?key|client[_-]?secret|auth(?:orization)?|credentials?|session(?:[_-]?id)?|cookie)"

const rules: ReadonlyArray<Rule> = [
  {
    id: "private-key-block",
    pattern:
      /-----BEGIN[^-]*PRIVATE KEY(?: BLOCK)?-----(?:(?!-----BEGIN)[\s\S])*?(?:-----END[^-]*-----|(?=-----BEGIN)|$)/g,
    replace: placeholder
  },
  {
    id: "url-credentials",
    pattern: /\b([a-z][a-z0-9+.-]{0,30}:\/\/[^\s:@/]*):(?!\[REDACTED\]@)[^\s/?#"'`\\]*@/gi,
    replace: "$1:[REDACTED]@"
  },
  {
    id: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{4,}=*/gi,
    replace: "Bearer [REDACTED_TOKEN]"
  },
  {
    id: "basic-authorization",
    pattern: /\b(basic)\s+([A-Za-z0-9+/]{4,}={0,2})(?![A-Za-z0-9+/=])/gi,
    replace: (match, scheme, token) => {
      if (scheme === "Basic" || scheme === "BASIC") return "Basic [REDACTED_TOKEN]"
      try {
        return atob(token!).includes(":") ? "Basic [REDACTED_TOKEN]" : match
      } catch {
        return match
      }
    }
  },
  {
    id: "jwt",
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replace: "[REDACTED_TOKEN]"
  },
  {
    id: "api-key",
    pattern: /(?<![A-Za-z0-9])(?:sk|pk)[-_][A-Za-z0-9][A-Za-z0-9_-]{7,}/g,
    replace: "[REDACTED_API_KEY]"
  },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/g, replace: placeholder },
  { id: "github-fine-grained-token", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])/g, replace: placeholder },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: placeholder },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9-])/g, replace: placeholder },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35,}(?![0-9A-Za-z_-])/g, replace: placeholder },
  { id: "gitlab-token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g, replace: placeholder },
  { id: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g, replace: placeholder },
  {
    id: "slack-webhook",
    pattern: /(\bhooks\.slack\.com\/services\/)T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
    replace: "$1[REDACTED]"
  },
  {
    id: "assignment",
    // A credential name, an optional closing quote, `:`, `=` or `=>`, and one
    // value: a quoted string or a bare word. `tokens=12` is a count and is
    // left alone, since the name must end in the credential word.
    pattern: new RegExp(
      `(?<![A-Za-z0-9])([A-Za-z0-9_.-]*${credentialName})(["']?\\s*(?:=>|[:=])\\s*)(?!\\[REDACTED)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s,;&"'}\\]]+)`,
      "gi"
    ),
    replace: "$1$2[REDACTED]"
  }
]

/** `text` with every credential shape the rules know replaced. */
export const redactText = (text: string): string => {
  let out = text
  for (const rule of rules) {
    rule.pattern.lastIndex = 0
    out = out.replace(rule.pattern, rule.replace as never)
  }
  return out
}

const sensitiveKeySuffixes = [
  "auth",
  "authorization",
  "cookie",
  "apikey",
  "token",
  "password",
  "passphrase",
  "secret",
  "secretaccesskey",
  "credential",
  "dsn",
  "connectionstring",
  "connectionuri",
  "connectionurl",
  "secretkey",
  "privatekey",
  "sshkey",
  "signingkey",
  "signature",
  "encryptionkey",
  "session",
  "sessionkey"
]

const trailingKeyWord = /(?:^|[^A-Za-z0-9])key$/i

const canonicalKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "")

/**
 * Whether an attribute key names a credential: case and separators ignored,
 * one trailing `s` stripped, by suffix, so `tokenizer` and `idempotencyKey`
 * are ordinary names.
 */
export const isSensitiveKey = (key: string): boolean => {
  if (trailingKeyWord.test(key)) return true
  const canonical = canonicalKey(key)
  return sensitiveKeySuffixes.some((suffix) => canonical.endsWith(suffix))
}

/** A numeric attribute named for a count of tokens holds a count, never a credential. */
const isCount = (key: string, value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false
  const numeric = "intValue" in value || "doubleValue" in value
  return numeric && /tokens$/i.test(key)
}

/**
 * Attribute keys that carry content: prompts, completions, messages, tool
 * arguments and results, file contents and shell output. VIP-72 rule 8
 * keeps them off the wire unless the layer is told `content: true`.
 */
export const isContentKey = (key: string): boolean =>
  /^gen_ai\.(?:prompt|completion|input\.messages|output\.messages|system_instructions|tool\.call\.(?:arguments|result)|request\.messages|response\.text)(?:$|\.)/
    .test(key) ||
  /^vibe\.content(?:$|\.)/.test(key)

export interface WalkOptions {
  /** Keep content attributes (VIP-72 rule 8). */
  readonly content: boolean
}

const isKeyValue = (value: unknown): value is { key: string; value: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  typeof (value as { key?: unknown }).key === "string" && "value" in value

/**
 * An OTLP JSON payload with every string redacted, every attribute whose key
 * names a credential replaced, and every content attribute removed.
 */
export const redactPayload = (value: unknown, options: WalkOptions, depth = 0): unknown => {
  if (depth > 64) return placeholder
  if (typeof value === "string") return redactText(value)
  if (Array.isArray(value)) {
    const out: Array<unknown> = []
    for (const item of value) {
      if (!options.content && isKeyValue(item) && isContentKey(item.key)) continue
      out.push(redactPayload(item, options, depth + 1))
    }
    return out
  }
  if (typeof value !== "object" || value === null) return value
  if (isKeyValue(value) && isSensitiveKey(value.key) && !isCount(value.key, value.value)) {
    return { ...value, key: redactText(value.key), value: { stringValue: placeholder } }
  }
  const out: Record<string, unknown> = {}
  for (const [name, member] of Object.entries(value)) {
    out[name] = redactPayload(member, options, depth + 1)
  }
  return out
}
