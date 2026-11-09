// Adapt native lint directives in parsed comments, leaving source text, strings,
// node identity and locations intact. Oxlint accepts ESLint directives too.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const policies = new Map()

// Oxlint releases differ on whether a reason-only directive suppresses rules.
// Ask the installed engine once, using isolated source and configuration.
export function blanketReasonPolicy(tool, command = []) {
  if (!existsSync(tool)) return false
  const key = JSON.stringify([tool, ...command])
  if (policies.has(key)) return policies.get(key)
  const root = mkdtempSync(join(tmpdir(), "vibelang-oxlint-directives-"))
  try {
    const config = join(root, ".oxlintrc.json"), source = join(root, "input.ts")
    writeFileSync(config, JSON.stringify({ categories: { correctness: "off" }, rules: { "no-debugger": "warn" } }))
    writeFileSync(source, "// oxlint-disable-next-line -- reason\ndebugger;\n")
    // This isolated probe has no source plugins. Resolve no package preload
    // from its temporary directory; preserve the caller's other Node options.
    const preloads = (process.env.NODE_OPTIONS ?? "").replace(/--import(?:=|\s+)vibelang\/register/g, "").trim()
    const run = spawnSync(tool, [...command, "--threads", "1", "--format", "json", "--config", config, source],
      { cwd: process.cwd(), encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, NODE_OPTIONS: preloads } })
    if (run.error || run.status !== 0) throw new Error("Oxlint directive compatibility probe failed (status " + run.status + ", signal " + run.signal + "): " + (run.stderr ?? "").slice(-2000), { cause: run.error })
    const result = JSON.parse(run.stdout)
    if (!Array.isArray(result.diagnostics)) throw new Error("Oxlint directive compatibility probe returned no diagnostics array")
    const blanket = result.diagnostics.length === 0
    policies.set(key, blanket)
    return blanket
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function withOxlintComments(parser, aliases, blanketReasons = false) {
  return {
    ...parser,
    parseForESLint(...args) {
      const result = typeof parser.parseForESLint === "function"
        ? parser.parseForESLint(...args)
        : { ast: parser.parse(...args) }
      // Oxlint plugins read start/end on nodes, tokens and comments. ESLint's
      // parsers supply range instead; preserve each source object and expose
      // the same UTF-16 offsets before any plugin visits the tree.
      const seen = new WeakSet()
      const offsets = value => {
        if (!value || typeof value !== "object" || seen.has(value)) return
        seen.add(value)
        if (typeof value.type === "string" && Array.isArray(value.range)) {
          value.start = value.range[0]
          value.end = value.range[1]
        }
        for (const [key, child] of Object.entries(value)) if (key !== "parent") offsets(child)
      }
      offsets(result.ast)
      const reverse = new Map([...aliases].map(([actual, native]) => [native, actual]))
      const rule = name => reverse.get(name) ?? reverse.get("eslint/" + name)
        ?? (name.startsWith("eslint/") ? name.slice(7)
          : name.startsWith("typescript-eslint/") ? "@" + name
          : name.startsWith("typescript/") ? "@typescript-eslint/" + name.slice(11) : name)
      for (const comment of result.ast.comments ?? []) {
        const match = /^(\s*)(?:oxlint|eslint)-(disable(?:-next-line|-line)?|enable)\b([\s\S]*)$/.exec(comment.value)
        if (!match) continue
        const tail = match[3]
        const reasonAt = /\s+--(?:\s|$)/.exec(tail)?.index ?? tail.length
        const names = tail.slice(0, reasonAt).trim()
        // Preserve the installed engine's treatment of reason-only bodies.
        if (!blanketReasons && !names && reasonAt < tail.length) {
          comment.value = match[1] + "oxlint-" + match[2] + tail
          continue
        }
        const mapped = names ? " " + names.split(",").map(name => rule(name.trim())).join(", ") : ""
        comment.value = match[1] + "eslint-" + match[2] + mapped + tail.slice(reasonAt)
      }
      return result
    }
  }
}
