import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const here = path.dirname(fileURLToPath(import.meta.url))

// TypeScript reports TS5097 for a relative import that names a .ts file
// unless allowImportingTsExtensions or rewriteRelativeImportExtensions is
// set, and VibeLang checks a .vibe or .vibex import as its .ts twin (VIP-34).
// A case whose program imports such a path without either option fails with
// TS5097 unless it expects that error. A rule change that updates every
// existing case can still miss a case landing beside it, and the case suite
// is too slow for the merge gate, so this reads files only and runs first.
const SOURCE = /\.(vibe|vibex|ts|tsx|mts|cts)$/
const DECLARATION = /\.d\.[a-z]+$/
const EXTENSION = String.raw`\.(?:ts|tsx|mts|cts|vibe|vibex)`
const STATIC = new RegExp(String.raw`^[ \t]*(?:import|export)\s+(type\s+)?(?:[^"'\n;]*?\s+from\s+)?["'](\.{1,2}/[^"'\n]*?${EXTENSION})["']`, "gm")
const DYNAMIC = new RegExp(String.raw`\bimport\(\s*["'](\.{1,2}/[^"'\n]*?${EXTENSION})["']\s*\)`, "g")

// A tsconfig include entry as TypeScript reads it: * and ? within one path
// segment, **/ across segments, and a bare directory name for everything in it.
function included(glob, file) {
  const clean = glob.replace(/^\.\//, "").replace(/\/$/, "")
  if (!/[*?]/.test(clean) && file.startsWith(clean + "/")) return true
  const source = clean.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\0").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\0/g, "(?:.*/)?")
  return new RegExp("^" + source + "$").test(file)
}

// Files under the case directory, excluding output, expectations, installs
// and nested projects with their own tsconfig.json.
function sources(dir, prefix = "") {
  const found = []
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (["node_modules", "out", "expected"].includes(entry.name)) continue
      if (fs.existsSync(path.join(dir, rel, "tsconfig.json"))) continue
      found.push(...sources(dir, rel))
    } else if (SOURCE.test(entry.name) && !DECLARATION.test(entry.name)) found.push(rel)
  }
  return found
}

// Relative specifiers ending in a source extension, outside line comments and
// type-only imports, which TypeScript allows.
export function extensionImports(text) {
  const code = text.split("\n").map((line) => /^\s*(\/\/|\/?\*)/.test(line) ? "" : line).join("\n")
  const found = []
  for (const m of code.matchAll(STATIC)) if (!m[1] && !DECLARATION.test(m[2])) found.push(m[2])
  for (const m of code.matchAll(DYNAMIC)) if (!DECLARATION.test(m[1])) found.push(m[1])
  return found
}

// One line per case that imports a source extension TypeScript refuses
// without expecting TS5097. A pending case and a failing case that lists no
// diagnostics assert nothing about which error they meet, so they are skipped.
export function violations(casesDir) {
  const out = []
  for (const name of fs.readdirSync(casesDir).sort()) {
    const dir = path.join(casesDir, name)
    const configPath = path.join(dir, "tsconfig.json")
    if (!fs.existsSync(configPath) || fs.existsSync(path.join(dir, "pending"))) continue
    let config
    try { config = JSON.parse(fs.readFileSync(configPath, "utf8")) } catch { continue }
    const options = config.compilerOptions ?? {}
    if (config.extends || options.allowImportingTsExtensions || options.rewriteRelativeImportExtensions) continue
    const expected = ["diagnostics.txt", "messages.txt"].map((file) => path.join(dir, "expected", file)).filter((file) => fs.existsSync(file))
    if (name.endsWith(".fail") && !fs.existsSync(path.join(dir, "expected", "diagnostics.txt"))) continue
    if (expected.some((file) => fs.readFileSync(file, "utf8").includes("TS5097"))) continue
    const all = sources(dir)
    const roots = config.files ? config.files.map((file) => file.replace(/^\.\//, ""))
      : all.filter((file) => (config.include ?? ["**/*"]).some((glob) => included(glob, file)))
    const program = new Set(roots.filter((file) => all.includes(file)))
    const queue = [...program]
    const hits = []
    while (queue.length > 0) {
      const file = queue.shift()
      for (const specifier of extensionImports(fs.readFileSync(path.join(dir, file), "utf8"))) {
        hits.push(`${file} imports "${specifier}"`)
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
        if (all.includes(target) && !program.has(target)) { program.add(target); queue.push(target) }
      }
    }
    if (hits.length > 0) out.push(`${name}: ${hits.join(", ")}`)
  }
  return out
}

test("every case that imports a .ts, .vibe or .vibex path sets an extension option or expects TS5097", () => {
  assert.deepEqual(violations(path.join(here, "cases")), [],
    "set rewriteRelativeImportExtensions (or allowImportingTsExtensions with noEmit), or list TS5097 in expected/diagnostics.txt")
})

test("the check finds an unconfigured import and honours each exemption", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibelang-case-imports-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const make = (name, config, files) => {
    fs.mkdirSync(path.join(root, name, "expected"), { recursive: true })
    fs.writeFileSync(path.join(root, name, "tsconfig.json"), JSON.stringify(config))
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name, file)), { recursive: true })
      fs.writeFileSync(path.join(root, name, file), text)
    }
  }
  const base = { compilerOptions: { module: "NodeNext" }, include: ["*.vibe", "*.ts"] }
  const lib = { "gen.ts": "export const n = 1\n" }
  make("bare", base, { "main.vibe": 'import { n } from "./gen.ts"\n', ...lib })
  make("bare-vibe", base, { "main.vibe": 'import { n } from "./gen.vibe"\n', "gen.vibe": "export const n = 1\n" })
  make("dynamic", base, { "main.ts": 'export const m = import("./gen.ts")\n', ...lib })
  make("reached", { compilerOptions: {}, include: ["main.vibe"] }, { "main.vibe": 'import { n } from "./mid.ts"\n', "mid.ts": 'export { n } from "./gen.ts"\n', ...lib })
  make("rewrite", { ...base, compilerOptions: { rewriteRelativeImportExtensions: true } }, { "main.vibe": 'import { n } from "./gen.ts"\n', ...lib })
  make("allow", { ...base, compilerOptions: { allowImportingTsExtensions: true, noEmit: true } }, { "main.vibe": 'import { n } from "./gen.ts"\n', ...lib })
  make("expects", base, { "main.vibe": 'import { n } from "./gen.ts"\n', "expected/diagnostics.txt": "main.vibe(1,19): error TS5097\n", ...lib })
  make("type-only", base, { "main.ts": 'import type { N } from "./gen.ts"\n', ...lib })
  make("comment", base, { "main.vibe": '// import { n } from "./gen.ts"\n', ...lib })
  make("declaration", base, { "main.ts": 'import { n } from "./gen.d.ts"\n' })
  make("excluded", { compilerOptions: {}, include: ["main.vibe"] }, { "main.vibe": "export const m = 1\n", "other.ts": 'import { n } from "./gen.ts"\n', ...lib })
  make("pending", base, { "main.vibe": 'import { n } from "./gen.ts"\n', pending: "known gap\n", ...lib })
  make("loose.fail", base, { "main.vibe": 'import { n } from "./gen.ts"\n', ...lib })
  assert.deepEqual(violations(root).map((line) => line.split(":")[0]), ["bare", "bare-vibe", "dynamic", "reached"])
})
