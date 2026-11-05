import { createHash } from "node:crypto"
import { readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"

// TS2883 quotes its source owner and symbol separately from this module operand.
const operand = / from (["'])([^"'\r\n]+)\1(?=\. This is likely not portable\.(?: A type annotation is necessary\.)?$)/
const identity = d => JSON.stringify([d.file, d.code, d.message, d.notes ?? []])
const portable = path => path.split("\\").join("/")

/** Capture resolution in each emit's own context, before the target can change. */
export function recordQuotedModuleReferences(diagnostics, { root, typescript: ts, tsconfig } = {}) {
  return diagnostics.map(d => {
    const match = d.code === "TS2883" && operand.exec(d.message)
    if (!root || !ts || !d.file || !match || !(match[2].startsWith(".") || isAbsolute(match[2]))) return null
    try {
      const source = resolve(root, d.file)
      if (relative(root, source).startsWith("..")) return null
      const configFile = tsconfig ?? ts.findConfigFile(dirname(source), ts.sys.fileExists)
      if (!configFile) return null
      const config = ts.readConfigFile(configFile, ts.sys.readFile)
      if (config.error) return null
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configFile), {}, configFile)
      if (parsed.errors.some(e => ![18002, 18003].includes(e.code))) return null
      const resolved = ts.resolveModuleName(match[2], source, parsed.options, ts.sys).resolvedModule
      if (!resolved || !/\.d\.[cm]?ts$/.test(resolved.resolvedFileName)) return null
      const physical = realpathSync(resolved.resolvedFileName)
      if (!statSync(physical).isFile()) return null
      return {
        diagnostic: identity(d), path: match[2], project: portable(relative(root, configFile)),
        declaration: portable(relative(root, resolved.resolvedFileName)),
        physicalDeclaration: portable(relative(root, physical)),
        sha256: createHash("sha256").update(readFileSync(physical)).digest("hex")
      }
    } catch { return null }
  })
}

// Every occurrence of the same diagnostic must carry the same complete proof.
function referenceFor(diagnostic, diagnostics, references) {
  const key = identity(diagnostic)
  const copies = diagnostics.flatMap((d, index) => identity(d) === key ? [references?.[index] ?? null] : [])
  if (!copies.length || copies.some(p => !p || p.diagnostic !== key || !/^[a-f0-9]{64}$/.test(p.sha256))) return null
  const first = copies[0]
  return copies.every(p => p.path === first.path && p.physicalDeclaration === first.physicalDeclaration && p.sha256 === first.sha256) ? first : null
}

/** A suffix spelling requires immutable original and current declaration receipts. */
export function quotedModuleEmitSubstitution(before, after, { baseline, diagnostics, moduleReferences } = {}) {
  if (before.code !== "TS2883" || after.code !== before.code) return null
  const a = operand.exec(before.message), b = operand.exec(after.message)
  if (!a || !b || a[2] === b[2]) return null
  const stem = value => value.replace(/\.(?:ts|js)$/, "")
  if (stem(a[2]) !== stem(b[2])) return null
  const outside = (text, match) => text.slice(0, match.index) + " from " + match[1] + "<module>" + match[1] + text.slice(match.index + match[0].length)
  if (outside(before.message, a) !== outside(after.message, b)) return null
  const left = referenceFor(before, baseline.diagnostics, baseline.moduleReferences)
  const right = referenceFor(after, diagnostics, moduleReferences)
  if (!left || !right || left.path !== a[2] || right.path !== b[2] || left.physicalDeclaration !== right.physicalDeclaration || left.sha256 !== right.sha256) return null
  return {
    file: after.file, code: after.code, before: left, after: right,
    declaration: right.declaration, sha256: right.sha256
  }
}
