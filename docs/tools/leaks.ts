// Published docs reject local paths, LAN addresses, key paths, and credential
// values. Site preparation and the hover cache use the same checker as the
// tracked-source gate. Private hosts and workstation paths belong in the local
// environment: VIBELANG_LEAK_PATTERNS is a JSON array of regex source strings.
// Example: '["private-build\\.example", "/private/workstation"]'.
const agentTemporaryPath: [string, RegExp] = ["an agent temporary path", /\/private\/tmp\/(?:claude|codex)-\d+/]

const forbidden: [string, RegExp][] = [
  ["a local path", /\/Users\/[A-Za-z]|\/home\/[a-z]/],
  agentTemporaryPath,
  ["a LAN address", /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/],
  ["a private key path", /\.ssh\//],
]

// Source can contain neutral example homes, public URLs with a /home/ segment,
// LAN examples, and portable ~/.ssh commands. It still rejects personal home
// directories, agent scratch roots, configured private patterns and credentials.
const repositoryPath = /(?:\/Users\/|(?<![\w/])(?:file:\/\/)?\/home\/)(?!(?:user|username|you|someone|other|projects|src|x)(?:\/|\b))[A-Za-z][\w.-]*/

const credentials = Object.entries(process.env)
  .filter(([name, value]) => /TOKEN|KEY|SECRET|PASSWORD/.test(name) && value && value.length >= 16)
  .map(([name, value]) => [name, value!] as const)

function privatePatterns(): RegExp[] {
  const input = process.env.VIBELANG_LEAK_PATTERNS
  if (!input) return []
  try {
    const patterns: unknown = JSON.parse(input)
    if (!Array.isArray(patterns) || patterns.some(p => typeof p !== "string" || !p.trim())) throw new Error()
    return patterns.map(p => new RegExp(p))
  } catch {
    // JSON and RegExp errors can echo the private input; report only the name.
    throw new Error("VIBELANG_LEAK_PATTERNS must be a JSON array of nonempty, valid regex strings")
  }
}

// Configured patterns and credentials are never echoed in diagnostics.
export function leaks(text: string, options: { repository?: boolean } = {}): string[] {
  const configured = privatePatterns()
  const rules: [string, RegExp][] = options.repository
    ? [["a local path", repositoryPath], agentTemporaryPath]
    : forbidden
  const problems: string[] = []
  for (const [what, pattern] of rules) {
    const match = pattern.exec(text)
    if (match) problems.push(what + ": " + JSON.stringify(match[0]))
  }
  if (configured.some(pattern => pattern.test(text))) problems.push("a configured private pattern")
  for (const [name, value] of credentials) if (text.includes(value)) problems.push("the value of " + name)
  return problems
}
