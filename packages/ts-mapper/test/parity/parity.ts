import { runtimeExclusions, exclusionNote, typeExclusions, typeExclusionNote } from "./runtime-exclusions.ts"
// The parity harness for gate 1 of decision (B): does stock TypeScript 7,
// through VibeLang's content mapper, declare the same A, E, and R as the fork?
//
//   packages/ts-mapper/test/parity/run.sh [--gate] [--self-test] [--jobs N] [case...]
//
// run.sh builds the binaries and the runtime, then runs this file with bun.
// Each case runs twice, in copies under out/work: the fork compiles it with
// declaration emit, and stock tsc compiles it through the mapper (the stock
// project adapter below). Every run writes the fork's declarations to
// out/reference and the manifest (the denominator: cases, declarations,
// classes, groups) to out/manifest.json, from the fork built at the same
// revision, then compares the mapper's declarations with them. The only
// committed expectations are expectations.json's migration sites. The run
// measures; it does not fail on mismatches. --gate also writes
// out/gate-<date>.json, which a gate verdict cites. --self-test checks the
// harness itself and exits 1 when it is wrong.
import crypto from "node:crypto"
import { runDocs } from "./docs.ts"
import { linkModules } from "../../../../docs/tools/check-snippets.ts"
import { mapperEntry } from "./mapper-options"
import fs from "node:fs"
import { createRequire, isBuiltin } from "node:module"
import os from "node:os"
import path from "node:path"
import { lanesOf, recursiveNames, scanDeclarations, statementLines, trustedNames, tsAuthoredKeys, type SourceDeclaration } from "./classify.ts"
import {
  countWeak,
  firstDifference,
  normalizeTokens,
  parseDeclarationFile,
  shapeToken,
  sortUnions,
  type DeclarationFile,
  type NormalizeContext,
  type Unit,
} from "./dts.ts"
import { expectedResult, runtimeParity, type RuntimeResult } from "./runtime.ts"

const started = performance.now()
const here = import.meta.dir
const outDir = path.join(here, "out")
const manifestPath = path.join(outDir, "manifest.json")
const referenceDir = path.join(outDir, "reference")
const expectationsPath = path.join(here, "expectations.json")

function need(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`parity: ${name} is not set; run packages/ts-mapper/test/parity/run.sh`)
    process.exit(2)
  }
  return value
}
const root = need("PARITY_ROOT")
const forkTsc = need("PARITY_FORK_TSC")
const stockTsc = need("PARITY_STOCK_TSC")
const mapperBin = need("PARITY_MAPPER")
const effectDir = need("PARITY_EFFECT_DIR")
const runtimeDir = need("PARITY_RUNTIME_DIR")
const mapperPackage = need("PARITY_MAPPER_PACKAGE")
const buildSeconds = Number(process.env.PARITY_BUILD_SECONDS ?? "0")

const args = process.argv.slice(2)
const gate = args.includes("--gate")
const selfTest = args.includes("--self-test")
const jobsAt = args.indexOf("--jobs")
const jobs = jobsAt >= 0 ? Number(args[jobsAt + 1]) : Math.max(2, Math.min(12, os.availableParallelism() >> 1))
const selectors = args.filter((a, i) => !a.startsWith("--") && !(jobsAt >= 0 && i === jobsAt + 1))

// ---------------------------------------------------------------- utilities

function sha256(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex")
}

function hashTree(dir: string, filter: (rel: string) => boolean): string {
  const hash = crypto.createHash("sha256")
  for (const rel of walk(dir, () => true).filter(filter).sort()) {
    hash.update(rel + "\0")
    hash.update(fs.readFileSync(path.join(dir, rel)))
    hash.update("\0")
  }
  return hash.digest("hex")
}

const skipDirs = new Set(["node_modules", "out", "dist", ".cache", "expected"])

// walk lists the files under dir, relative to it, skipping outputs.
function walk(dir: string, keep: (name: string) => boolean): string[] {
  const files: string[] = []
  const visit = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name) && keep(entry.name)) visit(child)
      } else if (entry.isFile()) files.push(child)
    }
  }
  visit("")
  return files
}

function parseJsonc(text: string): any {
  let out = ""
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end < 0 ? text.length : end + 2
    } else {
      out += c
      i++
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

type Exec = { code: number | string; output: string; ms: number }

async function exec(argv: string[], cwd: string, timeoutMs = 180_000): Promise<Exec> {
  const t0 = performance.now()
  const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  clearTimeout(timer)
  return { code: proc.signalCode ? `killed by ${proc.signalCode}` : code, output: stdout + stderr, ms: Math.round(performance.now() - t0) }
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    })
  )
}

type Diagnostic = { file: string; line: number; column: number; category: string; code: string; text: string }

// Diagnostics as `tsc --pretty false` prints them, as vibelang/harness.mjs reads them.
const diagnosticLine = /^(?:(.+)\((\d+),(\d+)\): )?(error|warning|message|suggestion) ([A-Za-z]+\d+): (.*)$/

function parseDiagnostics(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const line of text.split("\n")) {
    const m = diagnosticLine.exec(line)
    if (m) diagnostics.push({ file: m[1] ?? "", line: Number(m[2] ?? 0), column: Number(m[3] ?? 0), category: m[4], code: m[5], text: m[6] })
    else if (diagnostics.length > 0 && line.startsWith(" ")) diagnostics.at(-1)!.text += `\n${line.trim()}`
  }
  return diagnostics
}

function md(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function clip(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`
}

// ---------------------------------------------------------- normalization

const preludeModule = "vibelang-ts-mapper/prelude"

function normalizeContext(): NormalizeContext {
  const effectModules = new Map<string, string>()
  const index = fs.readFileSync(path.join(effectDir, "dist", "index.d.ts"), "utf8")
  for (const m of index.matchAll(/export \* as (\w+) from "\.\/([\w/]+)\.(?:ts|js)"/g)) effectModules.set(m[1], `effect/${m[2]}`)
  const reexports = new Map<string, Map<string, { module: string; member: string }>>()
  // reexportsOf reads `export { A, B as C } from "m"` for a bare m, following
  // `export * from "./x.js"` through the package's own files.
  const reexportsOf = (file: string, into: Map<string, { module: string; member: string }>, aliases?: Map<string, string>, seen = new Set<string>()) => {
    if (seen.has(file) || !fs.existsSync(file)) return
    seen.add(file)
    const text = fs.readFileSync(file, "utf8")
    if (aliases) {
      const namespaces = new Map<string, string>()
      for (const m of text.matchAll(/^import\s+(?:type\s+)?\*\s+as\s+(\w+)\s+from\s+"([^"]+)"/gm)) namespaces.set(m[1], m[2])
      for (const m of text.matchAll(/^export\s+type\s+(\w+)(?:<[^\n]*?>)?\s*=\s*(\w+)\.(\w+)\s*(?:<|;)/gm)) {
        const module = namespaces.get(m[2])
        if (module) aliases.set(m[1], `${module}#${m[3]}`)
      }
    }
    for (const m of text.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^".][^"]*)"/gm)) {
      for (const part of m[1].split(",")) {
        const [member, local] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)
        if (member) into.set((local ?? member).trim(), { module: m[2], member: member.trim() })
      }
    }
    for (const m of text.matchAll(/^export\s*\*\s*from\s*"(\.[^"]+)"/gm)) reexportsOf(path.resolve(path.dirname(file), m[1].replace(/\.js$/, ".d.ts")), into, aliases, seen)
  }
  const aliases = new Map<string, Map<string, string>>()
  const prelude = new Map<string, { module: string; member: string }>()
  const preludeAliases = new Map<string, string>()
  reexportsOf(path.join(mapperPackage, "prelude.d.ts"), prelude, preludeAliases)
  reexports.set(preludeModule, prelude)
  aliases.set(preludeModule, preludeAliases)
  const runtime = new Map<string, { module: string; member: string }>()
  const runtimeAliases = new Map<string, string>()
  reexportsOf(path.join(runtimeDir, "dist", "index.d.ts"), runtime, runtimeAliases)
  reexports.set("vibelang-runtime", runtime)
  aliases.set("vibelang-runtime", runtimeAliases)
  return { effectModules, reexports, aliases }
}
const ctx = normalizeContext()
const describeReexports = (module: string) =>
  [...(ctx.reexports.get(module) ?? [])].map(([k, v]) => (v.member === k ? `${k}` : `${k} (${v.member})`) + ` from ${v.module}`).join(", ") || "none"

const normalizationRules = [
  "Comments and layout are dropped; tokens are compared one by one.",
  "D268 phantom namespaces carrying only the mapper $plain signature are stripped; public Effect signatures stay unchanged.",
  "A relative specifier names a module without its extension: ./users.js, ./users.vibe, and ./users are one module.",
  "A qualified name resolves to the module that declares it: import(\"effect/Effect\").Effect, an imported Effect.Effect, and import(\"effect\").Effect.Effect are all effect/Effect#Effect; the resolution-mode attribute is dropped.",
  `A name that ${preludeModule} or vibelang-runtime re-exports unchanged resolves to its origin: ${preludeModule} re-exports ${describeReexports(preludeModule)}; vibelang-runtime re-exports ${describeReexports("vibelang-runtime")}.`,
  `A bare name (no member access) that a package exports as a type alias of another module's type resolves to that type: ${[...ctx.aliases].flatMap(([m, a]) => [...a].map(([k, v]) => `${k} from ${m} is ${v}`)).join(", ") || "none"}. The mapper's prelude exports Effect only as a namespace, so its bare Effect<...> does not match.`,
  "The members of a simple union are sorted (TypeScript prints unions in type-creation order); a match that needs this is reported as union-order.",
  "A relative Effect import and a public package import are one module only when Node resolves both to the exact same installed file; different copies and private paths stay distinct.",
  "Names the file declares are never rewritten, so service identity stays; any and unknown are never rewritten, and a mapper declaration with more of them than the fork's is reported as degraded.",
]

// parseSideDeclaration recognizes a relative Effect import only when Node's
// public export resolves to the exact same installed file. Resolving examples
// exposes these filesystem spellings in the fork's declaration emit.
function parseSideDeclaration(text: string, emittedFile: string): DeclarationFile {
  // D268 strips only the exact generated phantom namespace, never user members.
  text = text.replace(/(?:export\s+)?declare\s+namespace\s+([\w$]+)\s*\{\s*const\s+\$plain:\s*import\("vibelang-ts-mapper\/prelude"\)\.\$Plain<typeof\s+\1>;?\s*\}/g, "")
  const file = parseDeclarationFile(text)
  const require = createRequire(emittedFile)
  const canonical = (specifier: string) => {
    if (!specifier.startsWith(".")) return specifier
    const target = path.resolve(path.dirname(emittedFile), specifier)
    if (!fs.existsSync(target)) return specifier
    const actual = fs.realpathSync(target)
    const relative = path.relative(fs.realpathSync(effectDir), actual)
    if (!relative.startsWith("dist/") || !relative.endsWith(".js")) return specifier
    const publicName = `effect/${relative.slice(5, -3)}`
    try {
      return fs.realpathSync(require.resolve(publicName)) === actual ? publicName : specifier
    } catch {
      return specifier
    }
  }
  for (const binding of file.imports) binding.module = canonical(binding.module)
  for (const unit of file.units) for (const statement of unit.statements) {
    for (let i = 0; i < statement.length - 2; i++) {
      if (statement[i].text !== "import" || statement[i + 1].text !== "(" || statement[i + 2].kind !== "str") continue
      const token = statement[i + 2]
      token.text = JSON.stringify(canonical(token.text.slice(1, -1)))
    }
  }
  return file
}

type Canon = { exact: string[]; sorted: string }

function canon(unit: Unit, file: DeclarationFile): Canon {
  const exact = unit.statements.flatMap((s) => normalizeTokens(s, file.imports, ctx))
  return { exact, sorted: sortUnions(exact).join(" ") }
}

// returnType reads the return type of a function unit (or a const of
// function type) from canonical tokens.
function returnType(tokens: string[], kind: string): string | undefined {
  if (kind.includes("function")) {
    const open = tokens.indexOf("(")
    if (open < 0) return undefined
    let depth = 0
    for (let i = open; i < tokens.length; i++) {
      if (tokens[i] === "(") depth++
      else if (tokens[i] === ")" && --depth === 0) return tokens.slice(i + 2, tokens.indexOf(";", i)).join(" ")
    }
    return undefined
  }
  if (kind.includes("const") || kind.includes("let")) {
    const colon = tokens.indexOf(":")
    if (colon < 0) return undefined
    let depth = 0
    for (let i = colon + 1; i < tokens.length; i++) {
      const t = tokens[i]
      if (t === "(" || t === "<" || t === "[" || t === "{") depth++
      else if (t === ")" || t === ">" || t === "]" || t === "}") depth--
      else if (t === "=>" && depth === 0) return tokens.slice(i + 1, tokens.lastIndexOf(";")).join(" ")
    }
  }
  return undefined
}

const effectTypes = /^(effect\/Effect#Effect|effect\/Stream#Stream) </

// effectTypesIn returns each `effect/Effect#Effect < ... >` in a normalized
// declaration, with its type arguments.
function effectTypesIn(text: string): string[] {
  const key = "effect/Effect#Effect <"
  const out: string[] = []
  for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i)) {
    let k = i + key.length
    for (let depth = 1; k < text.length && depth > 0; k++) depth += text[k] === "<" ? 1 : text[k] === ">" ? -1 : 0
    out.push(text.slice(i, k))
    i = k
  }
  return out
}

// splitMismatches sorts the concrete, unchanged declarations that are not
// identical into (a) work the projector has not done yet (missing, degraded
// to any/unknown, in a file with EK9001 or stock errors, or structural) and
// (b) clean-file declarations where both sides emit Effect types whose A, E,
// or R differ. Gate 1 stops decision (B) on any (b).
function splitMismatches(results: any[]) {
  const s = { notImplemented: 0, missing: 0, degraded: 0, unclean: 0, structural: 0, aer: [] as { case: string; file: string; name: string; fork: string; mapper: string }[] }
  for (const r of results) {
    const unclean = (r.ek9001?.count ?? 0) > 0 || (r.stockErrors?.count ?? 0) > 0
    for (const u of r.units ?? []) {
      if (u.class !== "concrete" || u.group !== "unchanged" || u.status === "identical") continue
      const fork = effectTypesIn(u.fork ?? "")
      const mapper = effectTypesIn(u.mapper ?? "")
      if (u.status === "missing" || !u.mapper) s.missing++
      else if (u.degraded) s.degraded++
      else if (unclean) s.unclean++
      else if (fork.length > 0 && mapper.length > 0 && fork.join() !== mapper.join()) {
        s.aer.push({ case: r.id, file: u.file, name: u.name, fork: u.difference?.fork ?? fork.join(" "), mapper: u.difference?.mapper ?? mapper.join(" ") })
        continue
      } else s.structural++
      s.notImplemented++
    }
  }
  return s
}

// keepsEffectInUnion reports whether a normalized fork declaration has an
// Effect whose success channel is a union with an Effect or an Exit member.
function keepsEffectInUnion(text: string): boolean {
  for (const effect of effectTypesIn(text)) {
    const inner = effect.slice("effect/Effect#Effect <".length, -1)
    let depth = 0
    let end = inner.length
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i]
      if (c === "<" || c === "(" || c === "[" || c === "{") depth++
      else if (c === ">" || c === ")" || c === "]" || c === "}") depth--
      else if (c === "," && depth === 0) { end = i; break }
    }
    const success = inner.slice(0, end)
    if (/\|/.test(success) && /effect\/(Effect#Effect|Exit#Exit) </.test(success)) return true
  }
  return false
}

// passesPlainValue reports whether decl's code passes one of names, another
// declaration's function, as an argument value: `f(name)` or `f(a, name)`,
// not a call of it.
function passesPlainValue(decl: SourceDeclaration, names: Set<string>): boolean {
  for (const name of names) {
    if (name === decl.name) continue
    const escaped = name.replace(/[$]/g, "\\$")
    if (new RegExp(`[(,]\\s*${escaped}\\s*(?=[,)])`).test(decl.body)) return true
  }
  return false
}

// ----------------------------------------------------------------- corpus

type CaseRef = { id: string; rel: string; dir: string; origin: "case" | "example" | "probe" | "self-test" }

function discover(): CaseRef[] {
  const refs: CaseRef[] = []
  const casesDir = path.join(root, "typescript", "vibelang", "cases")
  for (const name of fs.readdirSync(casesDir).sort()) {
    if (fs.existsSync(path.join(casesDir, name, "tsconfig.json"))) refs.push({ id: name, rel: `typescript/vibelang/cases/${name}`, dir: path.join(casesDir, name), origin: "case" })
  }
  const examplesDir = path.join(root, "examples")
  for (const name of fs.readdirSync(examplesDir).sort()) {
    const dir = path.join(examplesDir, name)
    if (!fs.existsSync(path.join(dir, "tsconfig.json"))) continue
    if (!walk(dir, () => true).some((f) => f.endsWith(".vibe"))) continue
    refs.push({ id: `examples/${name}`, rel: `examples/${name}`, dir, origin: "example" })
  }
  return refs
}

function probeRefs(): CaseRef[] {
  const dir = path.join(here, "probes")
  return fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(path.join(dir, name, "tsconfig.json")))
    .sort()
    .map((name) => ({ id: `probe/${name}`, rel: `packages/ts-mapper/test/parity/probes/${name}`, dir: path.join(dir, name), origin: "probe" as const }))
}

const sourcePattern = /\.(vibe|ts|mts|cts|tsx)$/
const inputPattern = /\.(vibe|ts|mts|cts|tsx|json)$/

// --------------------------------------------------------- node_modules

// Cases link these node_modules directories. The mapper's real path is
// out/work/prelude.d.ts, with its own dependencies in out/work/node_modules.
// Imports in the prelude resolve from there, not from the case: otherwise
// skipLibCheck hides their failure and every helper becomes any.
const nmFork = path.join(outDir, "nm", "fork", "node_modules")
const nmMapper = path.join(outDir, "nm", "mapper", "node_modules")

function link(target: string, at: string) {
  fs.rmSync(at, { recursive: true, force: true })
  fs.symlinkSync(target, at)
}

// setupNodeModules reuses the snippet checker's installed dependency links in
// the enclosing mapper package scope. Keep the harness-built runtime
// and pinned effect so checking does not depend on a workspace runtime build.
function setupNodeModules() {
  const dependencies = path.join(outDir, "snippet-dependencies")
  fs.rmSync(dependencies, { recursive: true, force: true })
  const previousRuntime = process.env.VIBELANG_RUNTIME_DIR
  process.env.VIBELANG_RUNTIME_DIR = runtimeDir
  try {
    linkModules(dependencies)
  } finally {
    if (previousRuntime === undefined) delete process.env.VIBELANG_RUNTIME_DIR
    else process.env.VIBELANG_RUNTIME_DIR = previousRuntime
  }
  for (const nm of [nmFork, nmMapper]) {
    fs.rmSync(nm, { recursive: true, force: true })
    fs.mkdirSync(nm, { recursive: true })
    link(effectDir, path.join(nm, "effect"))
    link(runtimeDir, path.join(nm, "vibelang-runtime"))
  }
  for (const nm of [path.join(mapperPackage, "node_modules")]) {
    for (const name of fs.readdirSync(path.join(dependencies, "node_modules"))) {
      if (name === "effect" || name === "vibelang-runtime") continue
      link(fs.realpathSync(path.join(dependencies, "node_modules", name)), path.join(nm, name))
    }
  }
  link(mapperPackage, path.join(nmMapper, "vibelang-ts-mapper"))
}

// ------------------------------------------------------ stock adapter

// Options the fork reads and stock TypeScript rejects.
const forkOnlyOptions = ["vibelang"]

type Migration = { file: string; from: string; to: string; why: string }
type Adapter = { stripped: string[]; forced: Record<string, unknown>; migrations: Migration[] }

const specifierPattern = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s+\*\s+from\s*)(["'])(\.{1,2}\/[^"'\n]*)\2/g

// adaptStockProject turns a case copy into a project stock tsc can compile
// through the mapper: it strips fork-only options, turns on declaration
// emit, adds the content mapper, and migrates sources where stock module
// resolution differs from the fork's. Each change is recorded; none of them
// is a declaration normalization.
function adaptStockProject(dir: string, tsconfig: any): Adapter {
  const adapter: Adapter = { stripped: [], forced: {}, migrations: [] }
  const entry = mapperEntry(tsconfig)
  const options = (tsconfig.compilerOptions ??= {})
  for (const name of forkOnlyOptions) {
    if (name in options) {
      delete options[name]
      adapter.stripped.push(`compilerOptions.${name}`)
    }
    if (name in tsconfig) {
      delete tsconfig[name]
      adapter.stripped.push(name)
    }
  }
  const force = (name: string, value: unknown) => {
    if (options[name] !== value) adapter.forced[name] = value
    if (value === undefined) delete options[name]
    else options[name] = value
  }
  if (!options.rootDir) force("rootDir", ".")
  force("declaration", true)
  force("emitDeclarationOnly", true)
  force("noEmit", undefined)
  force("noEmitOnError", false)
  if (!options.outDir) force("outDir", defaultOutDir)
  tsconfig.contentMappers = [entry]
  fs.writeFileSync(path.join(dir, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`)

  for (const rel of walk(dir, () => true).filter((f) => sourcePattern.test(f) && !f.endsWith(".d.ts"))) {
    const file = path.join(dir, rel)
    const text = fs.readFileSync(file, "utf8")
    const exists = (spec: string) => fs.existsSync(path.resolve(path.dirname(file), spec))
    const migrated = text.replace(specifierPattern, (whole, lead: string, quote: string, spec: string) => {
      let to: string | undefined
      const base = spec.replace(/\.(m?js)$/, "")
      const hasTs = [".ts", ".tsx", ".mts", ".d.ts"].some((ext) => exists(base + ext))
      if (/\.m?js$/.test(spec) && exists(`${base}.vibe`) && !hasTs) to = `${base}.vibe`
      else if (!/\.[a-z]+$/.test(spec) && exists(`${spec}.vibe`) && !hasTs && !exists(spec)) to = `${spec}.vibe`
      if (!to) return whole
      adapter.migrations.push({ file: rel, from: spec, to, why: "stock TypeScript resolves no .js or extensionless specifier to a .vibe source (microsoft/TypeScript#64546)" })
      return `${lead}${quote}${to}${quote}`
    })
    if (migrated !== text) fs.writeFileSync(file, migrated)
  }
  return adapter
}

// --------------------------------------------------------- running sides

type Side = {
  exec: Exec
  diagnostics: Diagnostic[]
  frameworkDiagnostics?: Diagnostic[]
  // declarations: d.ts stem (out-relative path without the .d.ts suffix) -> text
  declarations: Map<string, { file: string; text: string }>
}

type Run = {
  ref: CaseRef
  tsconfig: any
  sources: Map<string, string> // case-relative path -> text (original, before migration)
  fork?: Side
  mapper?: Side
  adapter?: Adapter
  probeExports?: ProbeExports
}

const declarationSuffix = /\.d(\.vibe)?\.(ts|mts|cts)$/
// The outDir a project without one gets on both sides.
const defaultOutDir = "out"

function collectDeclarations(dir: string, tsconfig: any, sourceFiles: Set<string>): Map<string, { file: string; text: string }> {
  const declared = tsconfig.compilerOptions?.outDir
  const base = declared ? path.resolve(dir, declared) : dir
  const found = new Map<string, { file: string; text: string }>()
  if (!fs.existsSync(base)) return found
  const files: string[] = []
  const visit = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory() && entry.name !== "node_modules") visit(child)
      else if (entry.isFile() && declarationSuffix.test(entry.name)) files.push(child)
    }
  }
  visit("")
  for (const rel of files.sort()) {
    if (!declared && sourceFiles.has(rel)) continue // a stub, not an output
    found.set(rel.replace(declarationSuffix, ""), { file: rel, text: fs.readFileSync(path.join(base, rel), "utf8") })
  }
  return found
}

// workDir keeps the case's own directory name: the fork brands a service
// with its package's name, or else its directory's ("ch02-functions/main#Users"),
// so a copy under any other name would change service identity.
function workDir(ref: CaseRef, side: "fork" | "mapper"): string {
  return path.join(outDir, "work", side, ref.id)
}

// Probe exports make the declaration file show unexported top-level
// bindings too: a wrong lambda form inside an unexported DatabaseLive changes
// no exported signature, only DatabaseLive's own type. Both sides get the
// same lines, appended to each .vibe source of the copy:
//
//   export type __probe_DatabaseLive = typeof DatabaseLive   (a value)
//   export type __probe_type_User = User                     (a non-generic type)
//
// Declaration emit then prints DatabaseLive and User, which the comparison
// reads as unexported declarations; the __probe_ aliases themselves are not
// compared. Diagnostics on the appended lines are counted apart.
const valueKinds = new Set(["function", "const", "let", "var", "class", "error", "service", "control", "layer", "schema", "enum"])
const typeKinds = new Set(["interface", "type", "schema"])
const probePrefix = "__probe_"

type ProbeExports = { file: string; names: string[] }[]

function addProbeExports(dir: string, sources: Map<string, string>): ProbeExports {
  const added: ProbeExports = []
  for (const [rel, text] of sources) {
    if (!rel.endsWith(".vibe")) continue
    const lines: string[] = []
    const names: string[] = []
    const seen = new Set<string>()
    for (const d of scanDeclarations(text)) {
      if (d.exported || seen.has(`${d.kind}:${d.name}`)) continue
      seen.add(`${d.kind}:${d.name}`)
      if (valueKinds.has(d.kind) && !seen.has(`value:${d.name}`)) {
        seen.add(`value:${d.name}`)
        lines.push(`export type ${probePrefix}${d.name} = typeof ${d.name}`)
        names.push(d.name)
      }
      if (typeKinds.has(d.kind) && !d.generic && !seen.has(`type:${d.name}`)) {
        seen.add(`type:${d.name}`)
        lines.push(`export type ${probePrefix}type_${d.name} = ${d.name}`)
        if (!names.includes(d.name)) names.push(d.name)
      }
    }
    if (lines.length === 0) continue
    fs.writeFileSync(path.join(dir, rel), `${text}${text.endsWith("\n") ? "" : "\n"}// Added by the parity harness: probe exports (see parity.ts).\n${lines.join("\n")}\n`)
    added.push({ file: rel, names })
  }
  return added
}

function copyCase(ref: CaseRef, to: string, tsconfig: any) {
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(to), { recursive: true })
  const outName = tsconfig.compilerOptions?.outDir?.replace(/^\.\//, "").replace(/\/$/, "")
  fs.cpSync(ref.dir, to, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(ref.dir, src)
      const top = rel.split(path.sep)[0]
      return !(top === "node_modules" || top === "out" || top === "dist" || top === ".cache" || (outName && rel === outName))
    },
  })
}

function loadRun(ref: CaseRef): Run {
  const tsconfig = parseJsonc(fs.readFileSync(path.join(ref.dir, "tsconfig.json"), "utf8"))
  const sources = new Map<string, string>()
  for (const rel of walk(ref.dir, () => true)) if (sourcePattern.test(rel)) sources.set(rel, fs.readFileSync(path.join(ref.dir, rel), "utf8"))
  return { ref, tsconfig, sources }
}

async function runFork(run: Run): Promise<void> {
  const dir = workDir(run.ref, "fork")
  copyCase(run.ref, dir, run.tsconfig)
  run.probeExports = addProbeExports(dir, run.sources)
  link(nmFork, path.join(dir, "node_modules"))
  // Declarations whatever the project says: a project with noEmit (the
  // framework examples) or without outDir still writes them, under out/.
  const outArgs = [
    ...run.tsconfig.compilerOptions?.outDir ? [] : ["--outDir", defaultOutDir],
    ...run.tsconfig.compilerOptions?.rootDir ? [] : ["--rootDir", "."],
  ]
  const result = await exec([forkTsc, "-p", ".", "--pretty", "false", "--declaration", "--noEmit", "false", "--noEmitOnError", "false", ...outArgs], dir)
  const effective = { ...run.tsconfig, compilerOptions: { ...run.tsconfig.compilerOptions, outDir: run.tsconfig.compilerOptions?.outDir ?? defaultOutDir } }
  run.fork = { exec: result, diagnostics: parseDiagnostics(result.output), declarations: collectDeclarations(dir, effective, new Set(run.sources.keys())) }
}

async function runMapper(run: Run): Promise<void> {
  run.mapper = await runMapperIn(run, workDir(run.ref, "mapper"))
}

// runMapperIn compiles a copy of run's case at dir through the mapper.
// mutate, for the self-test, changes the adapted copy before tsc runs.
async function runMapperIn(run: Run, dir: string, mutate?: (dir: string) => void): Promise<Side> {
  copyCase(run.ref, dir, run.tsconfig)
  run.probeExports = addProbeExports(dir, run.sources)
  link(nmMapper, path.join(dir, "node_modules"))
  const tsconfig = structuredClone(run.tsconfig)
  run.adapter = adaptStockProject(dir, tsconfig)
  mutate?.(dir)
  const result = await exec([stockTsc, "-p", ".", "--pretty", "false", "--runExternalCode"], dir)
  let diagnostics = parseDiagnostics(result.output)
  let frameworkDiagnostics: Diagnostic[] = []
  if (/^examples\/(react|vue|svelte)-vite$/.test(run.ref.id)) {
    // Let TypeScript resolve the entire import closure from the projected roots.
    // Filtering extensions would hide missing framework packages imported by VibeLang.
    const scoped = { ...tsconfig, files: [...run.sources.keys()].filter((f) => f.endsWith(".vibe")), include: [] }
    fs.writeFileSync(path.join(dir, "tsconfig.gate1.json"), JSON.stringify(scoped, null, 2) + "\n")
    const checked = await exec([stockTsc, "-p", "tsconfig.gate1.json", "--pretty", "false", "--runExternalCode"], dir)
    const gateDiagnostics = parseDiagnostics(checked.output)
    if (checked.code !== 0 && !gateDiagnostics.some((d) => d.category === "error")) {
      throw new Error(`${run.ref.id}: scoped stock check failed without diagnostics: ${checked.output}`)
    }
    const gateKeys = new Set(gateDiagnostics.map((d) => JSON.stringify(d)))
    frameworkDiagnostics = diagnostics.filter((d) => !gateKeys.has(JSON.stringify(d)))
    diagnostics = gateDiagnostics
  }
  return { exec: result, diagnostics, frameworkDiagnostics, declarations: collectDeclarations(dir, tsconfig, new Set(run.sources.keys())) }
}

// --------------------------------------------------------------- manifest

type DeclarationEntry = {
  file: string // d.ts stem
  source: string | null
  name: string
  kind: string
  exported: boolean
  // probed: unexported, and printed only because a probe export names it.
  probed: boolean
  overloads: number
  sourceKind: "vibelang" | "ts" | "unknown"
  class: string
  group: "unchanged" | "migration" | "negative"
  lanes: string[]
  // expected: for a migration site, the declaration the mapper must produce,
  // written as .d.ts text; null until someone writes it.
  expected?: string | null
}

type CaseEntry = {
  id: string
  dir: string
  origin: string
  class: string
  failing: boolean
  expectCodes: string[]
  // runnable: the case's `// expect-result:` JSON. runtime stays null: runtime
  // parity is a result, not part of the denominator (CaseResult.runtime).
  runnable: { expectResult: string; runtime: null | { ok: boolean; detail: string } } | null
  files: Record<string, string>
  fork: { exit: number | string; errors: number; errorCodes: string[] }
  unresolvedPackages: string[]
  reference: Record<string, string> // d.ts stem -> sha256 of the fork's text, written to out/reference/<id>/<stem>.d.ts
  declarations: DeclarationEntry[]
}

// The manifest is the denominator of a run: what the fork binary, the
// declaration inputs, and the corpus give, with the rules that classify and
// normalize them. Its content hash leaves out nothing but generatedAt, so two
// runs with the same hash count over the same declarations.
type Manifest = {
  version: 2
  generatedAt: string
  fork: { binarySha256: string }
  stock: { typescript: string }
  inputs: Record<string, unknown>
  expectations: { sha256: string }
  classification: string[]
  normalization: string[]
  cases: CaseEntry[]
}

function manifestHash(manifest: Manifest): string {
  const { generatedAt: _, ...content } = manifest
  return sha256(JSON.stringify(content))
}

// Expectations are the evergreen part, hand-maintained: for each migration
// site, the declaration the mapper must produce, as .d.ts text, keyed by case
// and then by declaration name (or by "stem#name" where a case has the name
// in more than one file). Keys that start with $ are comments.
type Expectations = Record<string, Record<string, string>>

function loadExpectations(): { expectations: Expectations; sha256: string } {
  const text = fs.readFileSync(expectationsPath, "utf8")
  const expectations: Expectations = {}
  for (const [key, value] of Object.entries(JSON.parse(text))) if (!key.startsWith("$")) expectations[key] = value as Record<string, string>
  return { expectations, sha256: sha256(text) }
}

function sourceFor(stem: string, sources: Map<string, string>): string | null {
  const candidates = [...sources.keys()].filter((rel) => !rel.endsWith(".d.ts"))
  const match = (rel: string) => {
    const noExt = rel.replace(sourcePattern, "")
    return noExt === stem || noExt.endsWith(`/${stem}`) || stem.endsWith(`/${noExt}`)
  }
  return candidates.find((rel) => rel.endsWith(".vibe") && match(rel)) ?? candidates.find(match) ?? null
}

function bareImports(text: string): string[] {
  const names: string[] = []
  for (const m of blankKeepSpecifiers(text).matchAll(/\bfrom\s*["']([^"'.][^"']*)["']|\bimport\s*["']([^"'.][^"']*)["']/g)) {
    const spec = m[1] ?? m[2]
    names.push(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0])
  }
  return names
}

function blankKeepSpecifiers(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function unresolvedPackages(run: Run): string[] {
  const paths = Object.keys(run.tsconfig.compilerOptions?.paths ?? {})
  const missing = new Set<string>()
  for (const text of run.sources.values()) {
    for (const pkg of bareImports(text)) {
      if (pkg.startsWith("node:") || isBuiltin(pkg) || paths.includes(pkg) || paths.some((p) => p.startsWith(`${pkg}/`))) continue
      if (pkg === "effect" || pkg === "vibelang-runtime") continue
      if (![nmFork, path.join(mapperPackage, "node_modules")].some((nm) => fs.existsSync(path.join(nm, pkg, "package.json")))) missing.add(pkg)
    }
  }
  return [...missing].sort()
}

const classificationRules = [
  "failing: the case name ends in .fail or a source's first line is `// expect:`. Its declarations form the negative group: the mapper side must report an error.",
  "L4: the declaration's source has a typed catch clause, `catch (e: T)` (retired, D131/D216).",
  "L5: the declaration's source names a function, const, or class whose JSDoc holds `@vibelang trusted` or `@throws`, in any source of the case.",
  "recursive: the function calls itself, or sits on a call cycle with other top-level functions of its file (D52). L6 applies to a recursive function whose return annotation is missing or has an `infer` channel: it must write E and R.",
  "L7: the declaration's source calls `wire(...)` with more than one argument.",
  "L8: the declaration's source calls `K.pipe|of|use|key|name|length|call|apply|bind` where K is a class in the case's .ts files that extends a Context key.",
  "L3: the fork declaration keeps an Effect or an Exit as data in a union inside an Effect's success channel (Effect<Effect<A> | U, E, R>); under L3 a call that returns an Effect at run time runs. This rule reads the fork reference, never the projector.",
  "L2: a top-level function (or const arrow function) with no return annotation whose fork declaration does not return Effect or Stream: under L2 it becomes an Effect function. This rule reads the fork reference, never the projector.",
  "generic: a top-level function with a type parameter list.",
  "Class precedence: failing, l4-l8, recursive, generic, concrete. A declaration with any lane is in the migration group; others are unchanged, whatever their class.",
  "Unexported top-level bindings of a .vibe source are compared too: the harness appends `export type __probe_X = typeof X` (or `= X` for a non-generic type) to each copy, on both sides.",
  "A declaration from a .ts source is a ts-helper: compared, reported, and not gated.",
]

function classifyCase(run: Run, expected: Record<string, string> | undefined): CaseEntry {
  const failing = run.ref.id.endsWith(".fail") || [...run.sources.values()].some((t) => /^\/\/ expect:/.test(t))
  const expectCodes = [...run.sources.values()].flatMap((t) => /^\/\/ expect:\s*(.*)$/m.exec(t.split("\n")[0])?.[1].split(/\s+/).filter(Boolean) ?? [])
  const trusted = new Set<string>()
  const keys = new Set<string>()
  for (const [rel, text] of run.sources) {
    for (const name of trustedNames(text)) trusted.add(name)
    if (!rel.endsWith(".vibe")) for (const key of tsAuthoredKeys(text)) keys.add(key)
  }
  const scanned = new Map<string, { declarations: SourceDeclaration[]; recursive: Set<string> }>()
  for (const [rel, text] of run.sources) {
    if (!rel.endsWith(".vibe")) continue
    const declarations = scanDeclarations(text)
    scanned.set(rel, { declarations, recursive: recursiveNames(declarations) })
  }
  // The case's unannotated, non-generator .vibe functions: the fork
  // compiles them plain (D10) when their bodies run nothing.
  const plainValues = new Set(
    [...scanned.values()].flatMap(({ declarations }) =>
      declarations.filter((d) => d.isFunction && !d.generator && d.annotatedReturn === false).map((d) => d.name)
    )
  )
  // L2 reaches past the declaration that passes a plain function as a value: a same-file
  // declaration that uses one of those (directly or through another) changes type with it.
  const l2Reach = new Map<string, Set<string>>()
  for (const [rel, { declarations }] of scanned) {
    const reach = new Set(declarations.filter((d) => passesPlainValue(d, plainValues)).map((d) => d.name))
    for (let grew = true; grew; ) {
      grew = false
      for (const d of declarations) {
        if (reach.has(d.name)) continue
        if ([...reach].some((name) => new RegExp(`(?<![\\w$.])${name.replace(/[$]/g, "\\$")}(?![\\w$])`).test(d.body))) {
          reach.add(d.name)
          grew = true
        }
      }
    }
    l2Reach.set(rel, reach)
  }
  const declarations: DeclarationEntry[] = []
  const reference: Record<string, string> = {}
  const probed = new Set((run.probeExports ?? []).flatMap((p) => p.names))
  for (const [stem, { text }] of run.fork!.declarations) {
    reference[stem] = sha256(text)
    const file = parseDeclarationFile(text)
    const source = sourceFor(stem, run.sources)
    const sourceKind = source === null ? "unknown" : source.endsWith(".vibe") ? "vibelang" : "ts"
    const info = source ? scanned.get(source) : undefined
    for (const unit of file.units) {
      if (unit.name.startsWith(probePrefix)) continue
      const decl = info?.declarations.find((d) => d.name === unit.name)
      const lanes = decl && info ? lanesOf(decl, { recursive: info.recursive, trusted, keys }) : []
      if (decl && decl.isFunction && !decl.generator && decl.annotatedReturn === false) {
        const ret = returnType(canon(unit, file).exact, unit.kind)
        if (ret !== undefined && !effectTypes.test(ret)) lanes.push("L2")
      }
      // L3: the fork keeps an Effect or an Exit as data inside a union in a
      // success channel, as in Effect<Effect<A> | undefined, E, R>. Under
      // L3 a call whose value is an Effect at run time runs, so its type is
      // A | undefined. This reads the fork reference, never the projector.
      if (decl && keepsEffectInUnion(canon(unit, file).exact.join(" "))) lanes.push("L3")
      // L2 at a use site: the declaration passes an unannotated .vibe
      // function as a value, as in `xs.map(double)`. The fork hands such a
      // callee its plain $direct variant; under L2 it is an Effect function
      // until its return type is annotated plain.
      if (decl && !lanes.includes("L2") && (passesPlainValue(decl, plainValues) || (source !== null && l2Reach.get(source)?.has(decl.name)))) lanes.push("L2")
      lanes.sort()
      let klass: string
      if (sourceKind === "ts") klass = failing ? "failing" : "ts-helper"
      else if (failing) klass = "failing"
      else if (lanes.some((l) => ["L4", "L5", "L7", "L8"].includes(l))) klass = "l4-l8"
      else if (decl && info?.recursive.has(decl.name)) klass = "recursive"
      else if (decl?.generic && decl.isFunction) klass = "generic"
      else klass = "concrete"
      const group = failing ? "negative" : sourceKind !== "ts" && lanes.length > 0 ? "migration" : "unchanged"
      const entry: DeclarationEntry = {
        file: stem,
        source,
        name: unit.name,
        kind: unit.kind,
        exported: unit.exported,
        probed: !unit.exported && probed.has(unit.name),
        overloads: unit.overloads,
        sourceKind,
        class: klass,
        group,
        lanes: sourceKind === "ts" ? [] : lanes,
      }
      if (group === "migration") entry.expected = expected?.[`${stem}#${unit.name}`] ?? expected?.[unit.name] ?? null
      declarations.push(entry)
    }
  }
  const classes = new Set(declarations.map((d) => d.class))
  const caseClass = failing ? "failing" : ["l4-l8", "recursive", "generic"].find((c) => classes.has(c)) ?? "concrete"
  const files: Record<string, string> = {}
  for (const rel of walk(run.ref.dir, () => true).filter((f) => inputPattern.test(f)).sort()) files[rel] = sha256(fs.readFileSync(path.join(run.ref.dir, rel)))
  const forkErrors = run.fork!.diagnostics.filter((d) => d.category === "error")
  const expectResult = [...run.sources.values()].map((t) => /^\/\/ expect-result:\s*(.*)$/m.exec(t)?.[1]).find((r) => r !== undefined)
  return {
    id: run.ref.id,
    dir: run.ref.rel,
    origin: run.ref.origin,
    class: caseClass,
    failing,
    expectCodes,
    runnable: expectResult === undefined ? null : { expectResult: expectResult.trim(), runtime: null },
    files,
    fork: { exit: run.fork!.exec.code, errors: forkErrors.length, errorCodes: [...new Set(forkErrors.map((d) => d.code))].sort() },
    unresolvedPackages: unresolvedPackages(run),
    reference,
    declarations,
  }
}

function inputsNow(): Record<string, unknown> {
  const effectPkg = JSON.parse(fs.readFileSync(path.join(effectDir, "package.json"), "utf8"))
  const runtimePkg = JSON.parse(fs.readFileSync(path.join(runtimeDir, "package.json"), "utf8"))
  const scoped: Record<string, string> = {}
  const scopeDir = path.join(path.dirname(fs.realpathSync(effectDir)), "@effect")
  if (fs.existsSync(scopeDir)) {
    for (const name of fs.readdirSync(scopeDir).sort()) {
      const pkg = path.join(scopeDir, name, "package.json")
      if (fs.existsSync(pkg)) scoped[`@effect/${name}`] = JSON.parse(fs.readFileSync(pkg, "utf8")).version
    }
  }
  return {
    effect: { version: effectPkg.version, dtsSha256: hashTree(path.join(effectDir, "dist"), (f) => f.endsWith(".d.ts")) },
    "@effect/*": scoped,
    "vibelang-runtime": { version: runtimePkg.version, dtsSha256: hashTree(path.join(runtimeDir, "dist"), (f) => f.endsWith(".d.ts")) },
    "vibelang-ts-mapper/prelude.d.ts": { sha256: sha256(fs.readFileSync(path.join(mapperPackage, "prelude.d.ts"))) },
  }
}

function revisionsNow(stockVersion: string): Record<string, unknown> {
  return {
    fork: { source: process.env.PARITY_REVISION ?? "unknown", binarySha256: sha256(fs.readFileSync(forkTsc)) },
    mapper: { source: process.env.PARITY_REVISION ?? "unknown", binarySha256: sha256(fs.readFileSync(mapperBin)) },
    stock: { typescript: stockVersion },
    go: process.env.PARITY_GO_VERSION ?? "unknown",
    build: "CGO_ENABLED=0 go build -trimpath -buildvcs=false",
  }
}

function buildManifest(runs: Run[], stockVersion: string): Manifest {
  const { expectations, sha256: expectationsSha } = loadExpectations()
  const cases = runs.map((run) => classifyCase(run, expectations[run.ref.id]))
  fs.rmSync(referenceDir, { recursive: true, force: true })
  for (const run of runs) {
    for (const [stem, { text }] of run.fork!.declarations) {
      const file = path.join(referenceDir, run.ref.id, `${stem}.d.ts`)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, text)
    }
  }
  const manifest: Manifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    fork: { binarySha256: sha256(fs.readFileSync(forkTsc)) },
    stock: { typescript: stockVersion },
    inputs: inputsNow(),
    expectations: { sha256: expectationsSha },
    classification: classificationRules,
    normalization: normalizationRules,
    cases,
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`)
  return manifest
}

// ------------------------------------------------------------- comparing

type UnitResult = {
  file: string
  name: string
  kind: string
  exported: boolean
  probed: boolean
  class: string
  group: string
  sourceKind: string
  lanes: string[]
  status: "identical" | "union-order" | "mismatch" | "missing" | "expectation-missing" | "extra"
  degraded: boolean
  fork?: string
  mapper?: string
  difference?: { at: number; fork: string; mapper: string; shape: string }
  mapperEqualsFork?: boolean
}

function window(tokens: string[], at: number): string {
  return tokens.slice(Math.max(0, at - 4), at + 6).join(" ")
}

function shapeOf(kind: string, fork: string[], mapper: string[], at: number): string {
  const ctxTokens = fork.slice(Math.max(0, at - 2), at).map(shapeToken).join(" ")
  const f = fork.slice(at, at + 3).map(shapeToken).join(" ")
  const m = mapper.slice(at, at + 3).map(shapeToken).join(" ")
  return `${kind}: ${ctxTokens} ⟨${f || "∅"}⟩ vs ⟨${m || "∅"}⟩`
}

function compareUnit(expected: { unit: Unit; file: DeclarationFile } | undefined, actual: { unit: Unit; file: DeclarationFile } | undefined) {
  if (!expected) return { status: "extra" as const, degraded: false }
  const e = canon(expected.unit, expected.file)
  if (!actual) return { status: "missing" as const, degraded: false, fork: e.exact.join(" ") }
  const a = canon(actual.unit, actual.file)
  const forkText = e.exact.join(" ")
  const mapperText = a.exact.join(" ")
  const degraded = countWeak(mapperText) > countWeak(forkText)
  if (forkText === mapperText) return { status: "identical" as const, degraded, fork: forkText, mapper: mapperText }
  if (e.sorted === a.sorted) return { status: "union-order" as const, degraded, fork: forkText, mapper: mapperText }
  const at = firstDifference(e.exact, a.exact)
  return {
    status: "mismatch" as const,
    degraded,
    fork: forkText,
    mapper: mapperText,
    difference: { at, fork: window(e.exact, at), mapper: window(a.exact, at), shape: shapeOf(expected.unit.kind, e.exact, a.exact, at) },
  }
}

type CaseResult = {
  id: string
  class: string
  failing: boolean
  origin: string
  fork: { exit: number | string; errors: number; ms: number }
  mapper: { exit: number | string; errors: number; ms: number }
  ek9001: { count: number; forms: { form: string; context: string; at: string }[] }
  frameworkDiagnostics: Diagnostic[]
  stockErrors: { count: number; codes: Record<string, number>; first: string[] }
  // probeLineErrors: errors on the lines the probe exports appended, counted
  // apart from the case's own.
  probeLineErrors: { fork: number; mapper: number }
  probeExports: number
  runnable: boolean
  // typeChecks: the mapper side reports no error at all (EK9001 included).
  typeChecks: boolean
  // runtime: the mapper's JavaScript run against the expected result
  // (runtime.ts); null for a case that is not runnable.
  runtime: RuntimeResult | null
  missingFiles: string[]
  // declarations: top-level declarations each side printed, probe aliases excluded.
  declarations: { fork: number; mapper: number }
  units: UnitResult[]
  adapter: Adapter
  negativeDetected?: boolean
  unresolvedPackages: string[]
}

// ek9001Form names the VibeLang form at an EK9001 position from the source
// text there: the reported token and up to four tokens before it on its line,
// with local names generalized (x, X) and keywords, effect modules, and their
// members kept, as in `Effect.withSpan("…") ⟨{⟩` for a block param. The
// projector's message is generic; when it names the form in backticks, that
// name wins.
const formWords = new Set([
  "service", "control", "layer", "error", "schema", "provide", "wire", "match", "when", "using", "fork", "try", "catch",
  "handle", "resume", "await", "do", "throw", "finally", "exit", "function", "return", "yield", "const", "let", "for",
  "of", "if", "else", "new", "class", "abstract", "readonly", "mutable", "interface", "type", "export", "async",
  "default", "in", "is", "infer", "extends", "implements", "all", "race", "any", "allSettled",
])

function ek9001Form(d: Diagnostic, sources: Map<string, string>): { form: string; context: string } {
  const named = /`([^`]+)`/.exec(d.text)
  if (named) return { form: named[1], context: named[1] }
  const rel = [...sources.keys()].find((k) => k === d.file || d.file.endsWith(`/${k}`))
  const line = rel ? (sources.get(rel)!.split("\n")[d.line - 1] ?? "") : ""
  const tokens: { text: string; at: number }[] = []
  for (const m of line.matchAll(/[A-Za-z_$][\w$]*|"[^"]*"|'[^']*'|`[^`]*`|\d+|\S/g)) tokens.push({ text: m[0], at: m.index! })
  const here = tokens.findIndex((t) => t.at >= d.column - 1)
  if (here < 0) return { form: "(end of line)", context: line.trim() }
  const shaped = tokens.map((t, i) => {
    const x = t.text
    if (/^["'`]/.test(x)) return '"…"'
    if (/^\d/.test(x)) return "0"
    if (!/^[A-Za-z_$]/.test(x)) return x
    if (formWords.has(x) || ctx.effectModules.has(x)) return x
    if (i >= 2 && tokens[i - 1].text === "." && ctx.effectModules.has(tokens[i - 2].text)) return x
    return /^[A-Z]/.test(x) ? "X" : "x"
  })
  const tidy = (t: string) => t.replace(/ ?([.(),]) ?/g, "$1").replace(/\s+/g, " ").trim()
  // The form is the reported token with one token on each side; the context
  // keeps four before and two after, for the example column.
  const form = tidy(`${shaped[here - 1] ?? ""} ⟨${shaped[here]}⟩ ${shaped[here + 1] ?? ""}`)
  const context = tidy(`${shaped.slice(Math.max(0, here - 4), here).join(" ")} ⟨${shaped[here]}⟩ ${shaped.slice(here + 1, here + 3).join(" ")}`)
  return { form, context }
}

function compareCase(run: Run, entry: CaseEntry | undefined): CaseResult {
  const mapper = run.mapper!
  const fork = run.fork!
  const result: CaseResult = {
    id: run.ref.id,
    class: entry?.class ?? "unclassified",
    failing: entry?.failing ?? false,
    origin: run.ref.origin,
    fork: { exit: fork.exec.code, errors: fork.diagnostics.filter((d) => d.category === "error").length, ms: fork.exec.ms },
    mapper: { exit: mapper.exec.code, errors: mapper.diagnostics.filter((d) => d.category === "error").length, ms: mapper.exec.ms },
    ek9001: { count: 0, forms: [] },
    frameworkDiagnostics: mapper.frameworkDiagnostics ?? [],
    stockErrors: { count: 0, codes: {}, first: [] },
    probeLineErrors: { fork: 0, mapper: 0 },
    probeExports: (run.probeExports ?? []).reduce((n, p) => n + p.names.length, 0),
    runnable: Boolean(entry?.runnable),
    typeChecks: false,
    runtime: null,
    missingFiles: [],
    declarations: { fork: 0, mapper: 0 },
    units: [],
    adapter: run.adapter!,
    unresolvedPackages: entry?.unresolvedPackages ?? [],
  }
  const onProbeLine = (d: Diagnostic) => {
    const rel = [...run.sources.keys()].find((k) => k === d.file || d.file.endsWith(`/${k}`))
    return rel !== undefined && rel.endsWith(".vibe") && d.line > run.sources.get(rel)!.split("\n").length
  }
  result.probeLineErrors.fork = fork.diagnostics.filter((d) => d.category === "error" && onProbeLine(d)).length
  for (const d of mapper.diagnostics) {
    if (d.category === "error" && onProbeLine(d)) {
      result.probeLineErrors.mapper++
      continue
    }
    if (d.code === "EK9001") {
      result.ek9001.count++
      result.ek9001.forms.push({ ...ek9001Form(d, run.sources), at: `${run.ref.id}/${d.file}:${d.line}` })
    } else if (d.category === "error" && !d.code.startsWith("EK")) {
      result.stockErrors.count++
      result.stockErrors.codes[d.code] = (result.stockErrors.codes[d.code] ?? 0) + 1
      if (result.stockErrors.first.length < 3) result.stockErrors.first.push(clip(`${d.file}(${d.line},${d.column}): ${d.code} ${d.text.split("\n")[0]}`, 200))
    }
  }
  if (result.failing) result.negativeDetected = mapper.diagnostics.some((d) => d.category === "error" && d.code !== "EK9001" && !onProbeLine(d))
  result.typeChecks = result.ek9001.count === 0 && result.stockErrors.count === 0
  if (!entry) return result

  const parsedMapper = new Map([...mapper.declarations].map(([stem, { text, file }]) => [stem, parseSideDeclaration(text, path.resolve(workDir(run.ref, "mapper"), run.tsconfig.compilerOptions?.outDir ?? defaultOutDir, file))]))
  // The reference is this run's fork output, which the manifest hashes.
  const parsedReference = new Map([...fork.declarations].map(([stem, { text, file }]) => [stem, parseSideDeclaration(text, path.resolve(workDir(run.ref, "fork"), run.tsconfig.compilerOptions?.outDir ?? defaultOutDir, file))]))
  for (const stem of Object.keys(entry.reference)) if (!parsedMapper.has(stem)) result.missingFiles.push(stem)
  const real = (files: Map<string, DeclarationFile>) => [...files.values()].reduce((n, f) => n + f.units.filter((u) => !u.name.startsWith(probePrefix)).length, 0)
  result.declarations = { fork: real(parsedReference), mapper: real(parsedMapper) }

  const seen = new Set<string>()
  for (const d of entry.declarations) {
    seen.add(`${d.file}\0${d.name}`)
    const refFile = parsedReference.get(d.file)
    const refUnit = refFile?.units.find((u) => u.name === d.name)
    const mapFile = parsedMapper.get(d.file)
    const mapUnit = mapFile?.units.find((u) => u.name === d.name)
    const reference = refFile && refUnit ? { unit: refUnit, file: refFile } : undefined
    const actual = mapFile && mapUnit ? { unit: mapUnit, file: mapFile } : undefined
    const base = { file: d.file, name: d.name, kind: d.kind, exported: d.exported, probed: d.probed, class: d.class, group: d.group, sourceKind: d.sourceKind, lanes: d.lanes }
    if (d.group === "migration") {
      const versusFork = compareUnit(reference, actual)
      if (d.expected == null) {
        result.units.push({ ...base, status: "expectation-missing", degraded: versusFork.degraded, fork: versusFork.fork, mapper: "mapper" in versusFork ? versusFork.mapper : undefined, mapperEqualsFork: versusFork.status === "identical" || versusFork.status === "union-order" })
      } else {
        const expectedFile = parseDeclarationFile(d.expected)
        const merged: DeclarationFile = { ...expectedFile, imports: [...(refFile?.imports ?? []), ...expectedFile.imports] }
        const expectedUnit = merged.units.find((u) => u.name === d.name)
        const versusExpected = compareUnit(expectedUnit ? { unit: expectedUnit, file: merged } : undefined, actual)
        result.units.push({ ...base, ...versusExpected, status: versusExpected.status === "extra" ? "missing" : versusExpected.status })
      }
      continue
    }
    const compared = compareUnit(reference, actual)
    result.units.push({ ...base, ...compared, status: compared.status === "extra" ? "missing" : compared.status })
  }
  for (const [stem, file] of parsedMapper) {
    for (const unit of file.units) {
      if (seen.has(`${stem}\0${unit.name}`) || unit.name.startsWith(probePrefix)) continue
      result.units.push({ file: stem, name: unit.name, kind: unit.kind, exported: unit.exported, probed: false, class: "extra", group: "extra", sourceKind: "unknown", lanes: [], status: "extra", degraded: false, mapper: canon(unit, file).exact.join(" ") })
    }
  }
  return result
}

// ----------------------------------------------------------------- probes

type ProbeResult = { id: string; markers: { line: number; want: string; mapper: string | null; fork: string | null }[]; ek9001: number; forkFailed: boolean; ok: boolean }

// Probes are tiny wrong programs. A line that ends in
// `// probe-error: TS2322 Needed` must draw a stock TypeScript error (not EK)
// inside the top-level statement that holds the line, with that code and a
// message that contains the rest (a type name, so that an unrelated error,
// such as a member that does not exist, does not count). Either part may be
// left out. The statement, not
// the line: stock TypeScript checks a body against its contract where the
// projection returns it. The fork must fail too.
function checkProbe(run: Run): ProbeResult {
  const markers: ProbeResult["markers"] = []
  for (const [rel, text] of run.sources) {
    const ranges = statementLines(text)
    text.split("\n").forEach((line, i) => {
      const m = /\/\/ probe-error: (.+)$/.exec(line)
      if (!m) return
      const want = m[1].trim()
      const [first, last] = ranges.find(([a, b]) => a <= i + 1 && i + 1 <= b) ?? [i + 1, i + 1]
      const inside = (d: Diagnostic) => d.file.endsWith(rel) && first <= d.line && d.line <= last && d.category === "error"
      const [, code, text] = /^(TS\d+)?\s*(.*)$/.exec(want)!
      const matches = (d: Diagnostic) => inside(d) && (!code || d.code === code) && d.text.includes(text)
      const mapperHit = run.mapper!.diagnostics.find((d) => matches(d) && !d.code.startsWith("EK"))
      const forkHit = run.fork!.diagnostics.find(inside)
      markers.push({ line: i + 1, want, mapper: mapperHit ? `${mapperHit.code} ${clip(mapperHit.text.split("\n")[0], 120)}` : null, fork: forkHit ? `${forkHit.code} ${clip(forkHit.text.split("\n")[0], 120)}` : null })
    })
  }
  const ek9001 = run.mapper!.diagnostics.filter((d) => d.code === "EK9001").length
  const forkFailed = run.fork!.diagnostics.some((d) => d.category === "error")
  return { id: run.ref.id, markers, ek9001, forkFailed, ok: markers.length > 0 && markers.every((m) => m.mapper !== null) }
}

async function runProbes(): Promise<ProbeResult[]> {
  const runs = probeRefs().map(loadRun)
  await pool(runs.flatMap((r) => [() => runFork(r), () => runMapper(r)]), jobs, (task) => task())
  return runs.map(checkProbe)
}

// -------------------------------------------------------------- self-test

// selfTest compiles the fixture on both sides, takes its one declaration
// that both sides print the same way, and checks that changing its A, its E,
// its R, or its export, in a copy of the mapper's output, is reported.
async function runSelfTest(): Promise<boolean> {
  const ref: CaseRef = { id: "self-test/fixture", rel: "packages/ts-mapper/test/parity/self-test/fixture", dir: path.join(here, "self-test", "fixture"), origin: "self-test" }
  const run = loadRun(ref)
  await Promise.all([runFork(run), runMapper(run)])
  const lines: string[] = []
  let ok = true
  const check = (name: string, pass: boolean, detail: string) => {
    ok &&= pass
    lines.push(`${pass ? "ok  " : "FAIL"} ${name}: ${detail}`)
  }
  const listed = [{ id: "retired", reason: "fixture exclusion" }]
  const failed = runtimeExclusions(["retired"], [{ id: "retired", runtime: { ok: false } }], listed)
  check("runtime exclusion", failed.exclusions.length === 1 && failed.staleExclusions.length === 0, "failing excluded case remains explicit")
  const passing = runtimeExclusions(["retired"], [{ id: "retired", runtime: { ok: true } }], listed)
  check("stale passing exclusion", passing.staleExclusions[0]?.detail === "excluded case now passes", "passing excluded case is stale")
  const missing = runtimeExclusions([], [], listed)
  check("stale missing exclusion", missing.staleExclusions[0]?.detail === "listed id does not exist", "unknown id is stale")
  const unmeasured = runtimeExclusions(["retired"], [], listed)
  check("partial runtime exclusion", unmeasured.exclusions.length === 0 && unmeasured.staleExclusions.length === 0, "unselected case is not stale")
  const typeResults = (statuses: string[]) => [{ id: "retired", units: statuses.map((status) => ({ status, sourceKind: "vibelang", group: "unchanged" })) }]
  const typeFailed = typeExclusions(["retired"], typeResults(["identical", "mismatch"]), listed)
  check("type exclusion", typeFailed.exclusions.length === 1 && typeFailed.staleExclusions.length === 0 && typeExclusionNote(typeFailed.exclusions).includes("fixture exclusion"), "mixed declarations remain explicitly excluded")
  check("stale matching type exclusion", typeExclusions(["retired"], typeResults(["identical", "union-order"]), listed).staleExclusions.length === 1, "all matching declarations make exclusion stale")
  check("stale unknown type exclusion", typeExclusions([], [], listed).staleExclusions.length === 1, "unknown id is stale")
  check("partial type exclusion", typeExclusions(["retired"], [], listed).staleExclusions.length === 0, "unselected id is not stale")
  check("empty type exclusion", typeExclusions(["retired"], typeResults([]), listed).staleExclusions.length === 0, "missing declarations are not a pass")
  const emittedFile = path.join(workDir(ref, "fork"), defaultOutDir, "main.d.ts")
  const physical = path.relative(path.dirname(emittedFile), path.join(effectDir, "dist/Effect.js"))
  const publicText = 'export declare function origin(): import("effect/Effect").Effect<number>;'
  const publicFile = parseSideDeclaration(publicText, emittedFile)
  const physicalFile = parseSideDeclaration(publicText.replace("effect/Effect", physical), emittedFile)
  check("physical Effect import", compareUnit({ unit: publicFile.units[0], file: publicFile }, { unit: physicalFile.units[0], file: physicalFile }).status === "identical", "public and physical imports resolve to the same installed file")
  const other = path.join(outDir, "self-test-other", "effect", "dist", "Effect.js")
  fs.mkdirSync(path.dirname(other), { recursive: true })
  fs.writeFileSync(other, "export {}\n")
  const otherFile = parseSideDeclaration(publicText.replace("effect/Effect", path.relative(path.dirname(emittedFile), other)), emittedFile)
  check("different Effect copy", compareUnit({ unit: publicFile.units[0], file: publicFile }, { unit: otherFile.units[0], file: otherFile }).status === "mismatch", "a different physical file stays distinct even with the same path suffix")
  const target = "total"
  const stem = "main"
  const forkText = run.fork!.declarations.get(stem)?.text
  const mapperText = run.mapper!.declarations.get(stem)?.text
  if (!forkText || !mapperText) {
    check("fixture", false, `no ${stem}.d.ts on the ${forkText ? "mapper" : "fork"} side\n${run.fork!.exec.output}\n${run.mapper!.exec.output}`)
  } else {
    const forkFile = parseDeclarationFile(forkText)
    const unit = forkFile.units.find((u) => u.name === target)!
    const compareWith = (text: string) => {
      const file = parseDeclarationFile(text)
      const u = file.units.find((x) => x.name === target)
      return compareUnit({ unit, file: forkFile }, u ? { unit: u, file } : undefined)
    }
    const baseline = compareWith(mapperText)
    check("baseline", baseline.status === "identical", `${target} is ${baseline.status} (fork: ${baseline.fork ?? "-"}; mapper: ${"mapper" in baseline ? baseline.mapper : "-"})`)
    // Without package.json, NodeNext uses the enclosing package's exports
    // before node_modules. This must reach our isolated prelude, even when
    // the repository mapper package has no dependencies (catch-match).
    const inherited = await runMapperIn(run, path.join(outDir, "work", "mapper-no-package", ref.id), (dir) => {
      fs.rmSync(path.join(dir, "package.json"))
    })
    const inheritedType = compareWith(inherited.declarations.get(stem)?.text ?? "")
    check("inherited mapper package scope", inherited.exec.code === 0 && inheritedType.status === "identical", `${target} is ${inheritedType.status}; exit ${inherited.exec.code}${inherited.exec.code === 0 ? "" : `\n${inherited.exec.output}`}`)
    const statement = mapperText.split("\n").find((l) => l.includes(`function ${target}(`))
    if (!statement) check("mutations", false, `no line declares ${target} in the mapper's ${stem}.d.ts`)
    else {
      const mutations: [string, string][] = [
        ["A", statement.replace(/<number,/, "<string,")],
        ["E", statement.replace("RangeError", "TypeError")],
        ["R", statement.replace(/Tally>/, "never>")],
        ["export dropped", ""],
        ["export keyword removed", statement.replace(/^export /, "")],
      ]
      for (const [name, replacement] of mutations) {
        if (replacement === statement) {
          check(`mutate ${name}`, false, "the mutation did not change the declaration")
          continue
        }
        const mutated = mapperText.replace(statement, replacement)
        const outcome = compareWith(mutated)
        check(`mutate ${name}`, outcome.status === "mismatch" || outcome.status === "missing", `reported as ${outcome.status}`)
      }
    }
  }
  // A probe is valid when the fork rejects every marked statement; that is
  // the harness's business. Whether the mapper side rejects them too is the
  // gate's, so it is reported here and does not fail the self-test.
  // An unexported binding: ticks returns Effect.sync(() => 1). Flipping the
  // lambda to the Effect-function form, as a wrong L1 decision would, changes
  // only ticks's own type; the probe export must make the harness see it.
  if (forkText) {
    const forkFile = parseDeclarationFile(forkText)
    const ticks = forkFile.units.find((u) => u.name === "ticks")
    const plain = "Effect.sync(() => 1)"
    const flipped = "Effect.sync(() => $gen(function* () { return 1 }))"
    if (!ticks) check("unexported baseline", false, "the fork's main.d.ts does not print ticks; the probe export did not reach it")
    else {
      const mapperFile = parseDeclarationFile(mapperText ?? "")
      const mapperTicks = mapperFile.units.find((u) => u.name === "ticks")
      const baseline = compareUnit({ unit: ticks, file: forkFile }, mapperTicks ? { unit: mapperTicks, file: mapperFile } : undefined)
      check("unexported baseline", baseline.status === "identical" && !ticks.exported, `ticks (exported: ${ticks.exported}) is ${baseline.status}`)
      const side = await runMapperIn(run, path.join(outDir, "work", "mapper-flip", ref.id), (dir) => {
        const file = path.join(dir, "main.vibe")
        const text = fs.readFileSync(file, "utf8")
        if (!text.includes(plain)) throw new Error(`self-test: main.vibe no longer holds ${plain}`)
        fs.writeFileSync(file, text.replace(plain, flipped))
      })
      const flippedText = side.declarations.get(stem)?.text ?? ""
      const flippedFile = parseDeclarationFile(flippedText)
      const flippedTicks = flippedFile.units.find((u) => u.name === "ticks")
      const outcome = compareUnit({ unit: ticks, file: forkFile }, flippedTicks ? { unit: flippedTicks, file: flippedFile } : undefined)
      check("flip an unexported lambda's form", outcome.status === "mismatch" || outcome.status === "missing", `ticks is ${outcome.status}${outcome.difference ? `: fork ${outcome.difference.fork} vs mapper ${outcome.difference.mapper}` : ""}`)
    }
  }

  const probes = await runProbes()
  for (const probe of probes) {
    for (const m of probe.markers) {
      check(`probe ${probe.id} line ${m.line} is wrong in the fork`, m.fork !== null, m.fork ?? "the fork accepts it, so the probe proves nothing")
      lines.push(`gate ${probe.id} line ${m.line} (${m.want}): ${m.mapper ? `fails type-checking on the mapper side as required: ${m.mapper}` : "**passes type-checking on the mapper side**"}`)
    }
    if (probe.ek9001) lines.push(`gate ${probe.id}: ${probe.ek9001} EK9001`)
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, "self-test.txt"), `${lines.join("\n")}\n`)
  console.log(lines.join("\n"))
  console.log(ok ? "self-test: ok" : "self-test: FAIL")
  return ok
}

// ----------------------------------------------------------------- summary

type Tally = { cases: number; declarations: number; identical: number; unionOrder: number; mismatch: number; missing: number; expectationMissing: number; degraded: number; ek9001: number; stockErrors: number }
const emptyTally = (): Tally => ({ cases: 0, declarations: 0, identical: 0, unionOrder: 0, mismatch: 0, missing: 0, expectationMissing: 0, degraded: 0, ek9001: 0, stockErrors: 0 })

function addUnit(t: Tally, u: UnitResult) {
  t.declarations++
  if (u.status === "identical") t.identical++
  else if (u.status === "union-order") t.unionOrder++
  else if (u.status === "mismatch") t.mismatch++
  else if (u.status === "missing") t.missing++
  else if (u.status === "expectation-missing") t.expectationMissing++
  if (u.degraded) t.degraded++
}

function top<T>(items: T[], key: (t: T) => string, n: number): { key: string; count: number; example: T }[] {
  const counts = new Map<string, { count: number; example: T }>()
  for (const item of items) {
    const k = key(item)
    const entry = counts.get(k)
    if (entry) entry.count++
    else counts.set(k, { count: 1, example: item })
  }
  return [...counts.entries()]
    .map(([k, v]) => ({ key: k, ...v }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n)
}

function summarize(results: CaseResult[], manifest: Manifest, hash: string, probes: ProbeResult[], timing: Record<string, number>, stockVersion: string, partial: boolean) {
  type Site = UnitResult & { case: string }
  const typeExclusionReport = typeExclusions(discover().map((r) => r.id), results)
  const typeExcludedIds = new Set(typeExclusionReport.exclusions.map((e) => e.id))
  const positive = results.filter((r) => !r.failing && !typeExcludedIds.has(r.id))
  // Gated: declarations of .vibe sources, exported or not.
  const gated = (r: CaseResult) => r.units.filter((u) => u.sourceKind !== "ts" && u.group !== "extra")
  const sites = (rs: CaseResult[], keep: (u: UnitResult) => boolean): Site[] => rs.flatMap((r) => gated(r).filter(keep).map((u) => ({ ...u, case: r.id })))
  const pass = (u: UnitResult) => u.status === "identical" || u.status === "union-order"
  const concreteResults = positive
  const concrete = sites(concreteResults, (u) => u.class === "concrete" && u.group === "unchanged")
  const unchanged = sites(positive, (u) => u.group === "unchanged")
  const migration = sites(positive, (u) => u.group === "migration")
  const extra = positive.flatMap((r) => r.units.filter((u) => u.status === "extra").map((u) => ({ ...u, case: r.id })))
  const helpers = positive.flatMap((r) => r.units.filter((u) => u.sourceKind === "ts" && u.group !== "extra"))
  const count = (xs: UnitResult[], f: (u: UnitResult) => boolean) => xs.filter(f).length

  const perClass = new Map<string, Tally>()
  for (const r of results) {
    const t = perClass.get(r.class) ?? emptyTally()
    t.cases++
    t.ek9001 += r.ek9001.count
    t.stockErrors += r.stockErrors.count
    perClass.set(r.class, t)
  }
  const declClass = new Map<string, Tally>()
  for (const r of results) for (const u of gated(r)) addUnit((declClass.get(u.class) ?? declClass.set(u.class, emptyTally()).get(u.class))!, u)

  const lanes = new Map<string, number>()
  for (const u of migration) for (const l of u.lanes) lanes.set(l, (lanes.get(l) ?? 0) + 1)
  const failingUnchanged = unchanged.filter((u) => !pass(u))
  const shapeKey = (u: Site) => {
    if (u.status === "missing") return `${u.kind}: missing from the mapper's output`
    return u.difference!.shape
  }
  const shapes = top(failingUnchanged, shapeKey, 5)
  const forms = top(positive.flatMap((r) => r.ek9001.forms), (f) => f.form, 5)
  const allForms = top(results.flatMap((r) => r.ek9001.forms), (f) => f.form, 5)
  const stockCodes = new Map<string, number>()
  for (const r of positive) for (const [code, n] of Object.entries(r.stockErrors.codes)) stockCodes.set(code, (stockCodes.get(code) ?? 0) + n)
  const sum = (rs: CaseResult[], f: (r: CaseResult) => number) => rs.reduce((n, r) => n + f(r), 0)
  const ek9001Positive = sum(positive, (r) => r.ek9001.count)
  const ek9001All = sum(results, (r) => r.ek9001.count)
  const stockPositive = sum(positive, (r) => r.stockErrors.count)
  const missingFiles = sum(positive, (r) => r.missingFiles.length)
  const negatives = results.filter((r) => r.failing)
  const negativeDetected = negatives.filter((r) => r.negativeDetected).length
  const exclusionReport = runtimeExclusions(discover().map((r) => r.id), results)
  const excludedIds = new Set(exclusionReport.exclusions.map((e) => e.id))
  const runnable = results.filter((r) => !r.failing && r.runnable && !excludedIds.has(r.id))
  const migrations = results.flatMap((r) => r.adapter.migrations.map((m) => ({ ...m, case: r.id })))
  const stripped = results.filter((r) => r.adapter.stripped.length > 0)
  const forced = new Map<string, number>()
  for (const r of results) for (const k of Object.keys(r.adapter.forced)) forced.set(k, (forced.get(k) ?? 0) + 1)
  const probeExports = sum(results, (r) => r.probeExports)
  const probeLineFork = results.filter((r) => r.probeLineErrors.fork > 0)
  const probeLineMapper = sum(results, (r) => r.probeLineErrors.mapper)
  const forkBroken = positive.filter((r) => r.fork.errors > 0)
  const crashed = results.filter((r) => typeof r.mapper.exit !== "number" || r.mapper.exit > 2 || typeof r.fork.exit !== "number" || r.fork.exit > 2)
  const revisions = revisionsNow(stockVersion) as any
  const inputs = inputsNow() as any
  const missingDeclarations = count(unchanged, (u) => u.status === "missing") + count(migration, (u) => u.mapper === undefined)
  const degraded = count([...unchanged, ...migration], (u) => u.degraded)
  const split = (xs: UnitResult[]) => ({ exported: count(xs, (u) => u.exported), unexported: count(xs, (u) => !u.exported), probed: count(xs, (u) => u.probed) })

  const gate1 = {
    concrete: { ...typeExclusionReport, signatures: concrete.length, identical: count(concrete, pass), mismatched: concrete.length - count(concrete, pass), ...split(concrete), identicalExported: count(concrete, (u) => u.exported && pass(u)), identicalUnexported: count(concrete, (u) => !u.exported && pass(u)) },
    unchanged: { declarations: unchanged.length, identical: count(unchanged, pass), unionOrder: count(unchanged, (u) => u.status === "union-order"), mismatched: count(unchanged, (u) => u.status === "mismatch"), missing: count(unchanged, (u) => u.status === "missing"), ...split(unchanged) },
    migration: { declarations: migration.length, expectationMissing: count(migration, (u) => u.status === "expectation-missing"), lanes: Object.fromEntries([...lanes].sort()) },
    coverage: { missingDeclarations, missingFiles, extraDeclarations: extra.length, degraded, ek9001: ek9001Positive, stockErrors: stockPositive },
    negative: { cases: negatives.length, mapperReportsError: negativeDetected },
    runnable: {
      ...exclusionReport,
      cases: runnable.length,
      mapperTypeChecks: runnable.filter((r) => r.typeChecks).length,
      runtimeParity: runnable.filter((r) => r.runtime?.ok).length,
      runtimeParityTypeChecking: runnable.filter((r) => r.typeChecks && r.runtime?.ok).length,
      runtimeFailures: runnable.filter((r) => !r.runtime?.ok).map((r) => ({ case: r.id, typeChecks: r.typeChecks, expected: r.runtime?.expected ?? "", actual: r.runtime?.actual ?? null, detail: r.runtime?.detail ?? "not run" })),
    },
    probes: { count: probes.length, markers: probes.reduce((n, p) => n + p.markers.length, 0), failTypeCheck: probes.reduce((n, p) => n + p.markers.filter((m) => m.mapper !== null).length, 0) },
    tsHelpers: { declarations: helpers.length, identical: count(helpers, pass) },
    pass: typeExclusionReport.staleExclusions.length === 0 && exclusionReport.staleExclusions.length === 0 && concrete.length > 0 && unchanged.every(pass) && missingFiles === 0 && ek9001Positive === 0 && stockPositive === 0 && degraded === 0 && probes.every((p) => p.ok),
  }
  const json = {
    ranAt: new Date().toISOString(),
    partial,
    wallSeconds: timing.total,
    timing,
    jobs,
    revisions,
    inputs,
    manifest: { sha256: hash, generatedAt: manifest.generatedAt, path: path.relative(root, manifestPath), cases: manifest.cases.length, declarations: manifest.cases.reduce((n, c) => n + c.declarations.length, 0) },
    gate1,
    perClass: Object.fromEntries(perClass),
    perDeclarationClass: Object.fromEntries(declClass),
    nextTargets: {
      mismatchShapes: shapes.map((s) => ({ shape: s.key, count: s.count, example: { case: s.example.case, file: s.example.file, name: s.example.name, fork: s.example.difference?.fork ?? s.example.fork, mapper: s.example.difference?.mapper ?? null } })),
      unloweredForms: forms.map((f) => ({ form: f.key, count: f.count, example: f.example })),
      unloweredFormsAllCases: allForms.map((f) => ({ form: f.key, count: f.count, example: f.example })),
      stockErrors: Object.fromEntries([...stockCodes].sort((a, b) => b[1] - a[1])),
    },
    probes,
    adapter: { stripped: stripped.map((r) => ({ case: r.id, options: r.adapter.stripped })), forced: Object.fromEntries(forced), migrations, probeExports, probeLineErrors: { fork: sum(results, (r) => r.probeLineErrors.fork), mapper: probeLineMapper } },
    normalization: normalizationRules,
    crashed: crashed.map((r) => ({ id: r.id, fork: r.fork.exit, mapper: r.mapper.exit })),
    cases: results,
  }
  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(json, null, 1)}\n`)

  const g = gate1
  const L: string[] = []
  L.push(`# Parity: gate 1 of decision (B), manifest ${hash.slice(0, 12)}`, "")
  L.push(`Ran ${json.ranAt} in ${timing.total.toFixed(0)} s wall (build ${timing.build.toFixed(0)} s, compile ${timing.compile.toFixed(0)} s, compare ${timing.compare.toFixed(1)} s, probes ${timing.probes.toFixed(0)} s, runtime ${timing.runtime.toFixed(0)} s), ${jobs} jobs${partial ? `, **partial run** (${results.length} of ${manifest.cases.length} cases)` : ""}.`)
  L.push(`Fork ${revisions.fork.source}, binary ${revisions.fork.binarySha256.slice(0, 12)}; mapper binary ${revisions.mapper.binarySha256.slice(0, 12)}; stock TypeScript ${stockVersion}; effect ${inputs.effect.version}; vibelang-runtime ${inputs["vibelang-runtime"].version}.`)
  L.push(`Manifest ${hash} (${path.relative(root, manifestPath)}): ${manifest.cases.length} cases, ${json.manifest.declarations} declarations, generated from this run's fork; expectations.json ${manifest.expectations.sha256.slice(0, 12)}.`)
  L.push("", "## Gate 1", "", "```")
  L.push(`concrete: ${g.concrete.signatures} signatures, ${g.concrete.identical} identical, ${g.concrete.mismatched} mismatched${typeExclusionNote(g.concrete.exclusions)}`)
  L.push(`  exported ${g.concrete.exported} (${g.concrete.identicalExported} identical), unexported ${g.concrete.unexported} (${g.concrete.identicalUnexported} identical; ${g.concrete.probed} printed through probe exports)`)
  for (const e of g.concrete.staleExclusions) L.push(`stale type exclusion: ${e.id}, ${e.reason}: ${e.detail}`)
  const sorted = splitMismatches(concreteResults)
  L.push(`  split: (a) not implemented ${sorted.notImplemented} = ${sorted.missing} missing + ${sorted.degraded} degraded + ${sorted.unclean} in files with EK9001 or stock errors + ${sorted.structural} structural; (b) A/E/R differ in clean files ${sorted.aer.length}`)
  for (const b of sorted.aer.slice(0, 5)) L.push(`    (b) ${b.case} ${b.file}.${b.name}: fork ${b.fork} | mapper ${b.mapper}`)
  L.push(`unchanged group, all classes: ${g.unchanged.declarations} declarations, ${g.unchanged.identical} identical (${g.unchanged.unionOrder} up to union order), ${g.unchanged.mismatched} mismatched, ${g.unchanged.missing} missing`)
  L.push(`migration group: ${g.migration.declarations} declarations, ${g.migration.expectationMissing} expectation-missing (${Object.entries(g.migration.lanes).map(([k, v]) => `${k} ${v}`).join(", ") || "no lanes"})`)
  L.push(`coverage failures: ${g.coverage.missingDeclarations} missing declarations, ${g.coverage.missingFiles} missing .d.ts files, ${g.coverage.extraDeclarations} extra, ${g.coverage.degraded} degraded to any/unknown, ${g.coverage.ek9001} EK9001, ${g.coverage.stockErrors} stock errors`)
  L.push(`negative cases: ${g.negative.cases}; the mapper side reports an error in ${g.negative.mapperReportsError}`)
  L.push(`runnable cases: ${g.runnable.cases}; the mapper side type-checks in ${g.runnable.mapperTypeChecks}`)
  for (const e of g.runnable.staleExclusions) L.push(`stale runtime exclusion: ${e.id}, ${e.reason}: ${e.detail}`)
  L.push(`runtime parity: ${g.runnable.runtimeParity}/${g.runnable.cases} print the expected result${exclusionNote(g.runnable.exclusions)} from the mapper's JavaScript (${g.runnable.runtimeParityTypeChecking}/${g.runnable.mapperTypeChecks} of those that type-check)`)
  L.push(`probes: ${g.probes.count} (${g.probes.markers} marked statements); the mapper side rejects ${g.probes.failTypeCheck}`)
  L.push(`.ts helper declarations (not gated): ${g.tsHelpers.declarations}, ${g.tsHelpers.identical} identical`)
  L.push(`gate 1: ${g.pass ? "PASS" : "not yet"}`)
  L.push("```", "")
  L.push("A signature is one top-level declaration of a .vibe source, exported or not, as its .d.ts prints it; a class and its `_base` helper are one. Pass needs every unchanged declaration identical, no missing file, no degraded declaration, 0 EK9001 and 0 stock errors in positive cases, and every probe rejected. Migration declarations need written expectations first.", "")
  L.push("## Totals per class", "")
  L.push("| class | cases | signatures | identical | union order | mismatched | missing | expectation missing | degraded | EK9001 | stock errors |")
  L.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
  for (const klass of ["concrete", "recursive", "generic", "l4-l8", "failing"]) {
    const c = perClass.get(klass)
    const d = declClass.get(klass) ?? emptyTally()
    if (!c && d.declarations === 0) continue
    L.push(`| ${klass} | ${c?.cases ?? 0} | ${d.declarations} | ${d.identical} | ${d.unionOrder} | ${d.mismatch} | ${d.missing} | ${d.expectationMissing} | ${d.degraded} | ${c?.ek9001 ?? 0} | ${c?.stockErrors ?? 0} |`)
  }
  L.push("", "Cases count by the case's class, the strongest among its declarations; signatures count by each declaration's own class, .ts helpers excluded.", "")
  L.push("## Next targets", "")
  L.push("Five most frequent first-mismatch shapes (unchanged group, positive cases):", "")
  L.push("| # | count | shape | example |", "| ---: | ---: | --- | --- |")
  shapes.forEach((s, i) => L.push(`| ${i + 1} | ${s.count} | \`${md(clip(s.key, 120))}\` | ${md(s.example.case)} \`${md(s.example.name)}\`: fork \`${md(clip(s.example.difference?.fork ?? s.example.fork ?? "", 90))}\` vs mapper \`${md(clip(s.example.difference?.mapper ?? "∅", 90))}\` |`))
  L.push("", "Five most frequent unlowered VibeLang forms (EK9001 in positive cases; read from the source at each diagnostic, ⟨⟩ marks the reported token):", "")
  L.push("| # | count | form | example |", "| ---: | ---: | --- | --- |")
  forms.forEach((f, i) => L.push(`| ${i + 1} | ${f.count} | \`${md(f.key)}\` | \`${md(f.example.context)}\` at ${md(f.example.at)} |`))
  L.push("", `All cases, failing ones included: ${allForms.map((f) => `\`${md(f.key)}\` ${f.count}`).join(", ")}; ${ek9001All} EK9001 in all.`, "")
  L.push(`Stock errors by code (positive cases): ${[...stockCodes].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c} ${n}`).join(", ") || "none"}.`, "")
  L.push("## Probes", "")
  L.push("| probe | line | wants | mapper | fork | EK9001 | result |", "| --- | ---: | --- | --- | --- | ---: | --- |")
  for (const p of probes) for (const m of p.markers) L.push(`| ${p.id} | ${m.line} | ${md(m.want)} | ${md(m.mapper ?? "no error")} | ${md(m.fork ?? "no error")} | ${p.ek9001} | ${m.mapper ? "rejected, as required" : "**accepted**"} |`)
  L.push("", "## Framework sources", "")
  const frameworkLine = "framework sources, checked by examples' frameworks-check.sh, not gate 1"
  L.push(frameworkLine, "")
  console.log(frameworkLine)
  for (const r of results.filter((r) => /^examples\/(react|vue|svelte)-vite$/.test(r.id))) {
    const lines = r.frameworkDiagnostics.map((d) => `${r.id}/${d.file}(${d.line},${d.column}): ${d.category} ${d.code} ${d.text}`)
    if (!lines.length) lines.push(`${r.id}: none`)
    for (const line of lines) { L.push(line, ""); console.log(line) }
  }
  L.push("", "## Stock project adapter and source migrations", "")
  L.push(`- Stripped fork-only options in ${stripped.length} cases: ${stripped.map((r) => `${r.id} (${r.adapter.stripped.join(", ")})`).join(", ") || "none"}.`)
  L.push(`- Forced options: ${[...forced].map(([k, n]) => `${k} in ${n} cases`).join(", ")}; contentMappers added in every case.`)
  L.push(`- Source migrations: ${migrations.length} specifiers in ${new Set(migrations.map((m) => m.case)).size} cases${migrations.length ? `: ${migrations.map((m) => `${m.case}/${m.file} \`${m.from}\` → \`${m.to}\``).join(", ")}` : ""}. Reason: ${migrations[0]?.why ?? "-"}.`)
  L.push(`- Probe exports, on both sides: ${probeExports} unexported bindings. Errors on the probe lines: fork ${json.adapter.probeLineErrors.fork}${probeLineFork.length ? ` (${probeLineFork.map((r) => r.id).join(", ")})` : ""}, mapper ${probeLineMapper}; neither counts as a case error.`)
  L.push(`- Positive cases whose fork compile reports errors (a less reliable reference): ${forkBroken.length}${forkBroken.length ? ` (${forkBroken.map((r) => `${r.id} ${r.fork.errors}`).join(", ")})` : ""}.`)
  const unresolved = [...new Set(results.flatMap((r) => r.unresolvedPackages))].sort()
  L.push(`- Packages the corpus imports that resolve on neither side: ${unresolved.join(", ") || "none"}.`)
  if (crashed.length) L.push(`- Crashed or timed out: ${crashed.map((r) => `${r.id} (fork ${r.fork.exit}, mapper ${r.mapper.exit})`).join(", ")}.`)
  L.push("", "Declaration normalization, separate from the adapter:", "")
  for (const rule of normalizationRules) L.push(`- ${rule}`)
  L.push("", "## Cases", "")
  L.push("| case | class | fork | mapper | signatures | identical | migration | EK9001 | stock errors | runtime | first mismatch |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |")
  for (const r of results) {
    const units = gated(r)
    const firstBad = units.find((u) => u.group !== "migration" && !pass(u))
    const note = r.failing
      ? r.negativeDetected ? "negative: the mapper reports an error" : "negative: **the mapper reports no error**"
      : firstBad ? `\`${md(firstBad.name)}\` ${firstBad.status}${firstBad.difference ? `: fork \`${md(clip(firstBad.difference.fork, 70))}\` vs mapper \`${md(clip(firstBad.difference.mapper, 70))}\`` : ""}`
      : r.missingFiles.length ? `missing ${r.missingFiles.join(", ")}` : ""
    const runtime = excludedIds.has(r.id) ? "excluded" : r.runtime ? (r.runtime.ok ? "ok" : "FAIL") : "-"
    L.push(`| ${md(r.id)} | ${r.class} | ${r.declarations.fork} | ${r.declarations.mapper} | ${units.length} | ${units.filter(pass).length} | ${units.filter((u) => u.group === "migration").length} | ${r.ek9001.count} | ${r.stockErrors.count} | ${runtime} | ${note} |`)
  }
  L.push("", "fork and mapper: top-level declarations each side printed, .ts helpers included. signatures: those of .vibe sources, which the gate compares. runtime: the mapper's JavaScript prints the case's expect-result (runtime.ts).", "")
  L.push("## Runtime failures", "")
  L.push("Runnable cases whose JavaScript from the mapper's Emit does not print the expected result. A case whose mapper side does not type-check usually uses a form the projector does not lower yet.", "")
  L.push("| case | type-checks | expected | printed |", "| --- | --- | --- | --- |")
  for (const f of g.runnable.runtimeFailures) L.push(`| ${md(f.case)} | ${f.typeChecks ? "yes" : "no"} | \`${md(clip(f.expected, 70))}\` | ${md(clip(f.actual === null ? f.detail : f.actual, 110))} |`)
  L.push("## Concrete mismatches", "")
  L.push("| case | declaration | status | fork | mapper |", "| --- | --- | --- | --- | --- |")
  for (const u of concrete.filter((u) => !pass(u))) L.push(`| ${md(u.case)} | \`${md(u.file)}#${md(u.name)}\`${u.exported ? "" : " (unexported)"}${u.degraded ? " (degraded)" : ""} | ${u.status} | \`${md(clip(u.difference?.fork ?? u.fork ?? "", 100))}\` | \`${md(clip(u.difference?.mapper ?? u.mapper ?? "∅", 100))}\` |`)
  L.push("")
  fs.writeFileSync(path.join(outDir, "summary.md"), L.join("\n"))
  return json
}

// -------------------------------------------------------------------- main

async function stockVersionOf(): Promise<string> {
  const v = await exec([stockTsc, "--version"], here)
  return v.output.trim().replace(/^Version /, "")
}

async function main() {
  const partial = selectors.length > 0
  let refs: CaseRef[] = []
  if (!selfTest && !args.includes("--docs")) {
    refs = discover()
    if (partial) refs = refs.filter((r) => selectors.some((s) => r.id === s || r.id.includes(s)))
    if (gate && partial) {
      console.error("parity: --gate measures the whole corpus; drop the case selectors")
      process.exit(2)
    }
    if (refs.length === 0) {
      console.error(`parity: no declaration cases matched${partial ? `: ${selectors.map((s) => JSON.stringify(s)).join(", ")}` : " in the corpus"}`)
      process.exit(2)
    }
  }
  fs.mkdirSync(outDir, { recursive: true })
  setupNodeModules()
  const stockVersion = await stockVersionOf()
  const pinned = process.env.TS7_VERSION
  if (pinned && stockVersion !== pinned) {
    console.error(`parity: stock tsc is ${stockVersion}, expected ${pinned}`)
    process.exit(2)
  }
  if (selfTest) {
    const docs = await runDocs(root, outDir, mapperPackage, forkTsc, stockTsc, mapperBin, jobs, true)
    const planted = docs.summary.codes.EK9100 === 1 && docs.summary.newDiagnostics === 1
    console.log(`self-test docs: ${planted ? "ok" : "FAIL"} (${docs.line})`)
    process.exit((await runSelfTest()) && planted ? 0 : 1)
  }
  if (args.includes("--docs")) {
    const docs = await runDocs(root, outDir, mapperPackage, forkTsc, stockTsc, mapperBin, jobs)
    const file = path.join(outDir, "summary.json")
    const json = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
    json.docs = docs.summary
    fs.writeFileSync(file, JSON.stringify(json, null, 1) + "\n")
    const md = path.join(outDir, "summary.md")
    const previous = fs.existsSync(md) ? fs.readFileSync(md,"utf8").replace(/^docs:.*\n?/gm, "") : ""
    fs.writeFileSync(md, previous + "\n" + docs.line + "\n")
    console.log(`${docs.line}\ndocs wall: ${docs.seconds.toFixed(1)} s`)
    return
  }

  const runs = refs.map(loadRun)
  const t0 = performance.now()
  let done = 0
  const tasks = runs.flatMap((r) => [() => runFork(r), () => runMapper(r)])
  await pool(tasks, jobs, async (task) => {
    await task()
    done++
    if (done % 50 === 0 || done === tasks.length) console.error(`parity: ${done}/${tasks.length} compiles`)
  })
  const compileSeconds = (performance.now() - t0) / 1000
  const t3 = performance.now()
  const runnableRuns = runs.filter((r) => r.ref.origin === "case" && expectedResult(r.ref.dir) !== undefined)
  const runtime = await runtimeParity(runnableRuns.map((r) => ({ id: r.ref.id, dir: r.ref.dir })), { outDir, mapper: mapperBin, stockTsc, effectDir, runtimeDir, jobs })
  const runtimeSeconds = (performance.now() - t3) / 1000
  const manifest = buildManifest(runs, stockVersion)
  const hash = manifestHash(manifest)
  const t1 = performance.now()
  const entries = new Map(manifest.cases.map((c) => [c.id, c]))
  const results = runs.map((run) => compareCase(run, entries.get(run.ref.id)))
  for (const r of results) r.runtime = runtime.get(r.id) ?? null
  const compareSeconds = (performance.now() - t1) / 1000
  const t2 = performance.now()
  const probes = await runProbes()
  const probeSeconds = (performance.now() - t2) / 1000
  const timing = { build: buildSeconds, compile: compileSeconds, compare: compareSeconds, probes: probeSeconds, runtime: runtimeSeconds, total: buildSeconds + (performance.now() - started) / 1000 }
  const json = summarize(results, manifest, hash, probes, timing, stockVersion, partial)
  if (!partial) {
    const docs = await runDocs(root, outDir, mapperPackage, forkTsc, stockTsc, mapperBin, jobs)
    ;(json as any).docs = docs.summary
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(json, null, 1) + "\n")
    fs.appendFileSync(path.join(outDir, "summary.md"), "\n" + docs.line + "\n")
    console.log(docs.line)
  }
  const g = json.gate1
  console.log(`manifest ${hash.slice(0, 12)}: ${manifest.cases.length} cases`)
  console.log(`concrete: ${g.concrete.signatures} signatures, ${g.concrete.identical} identical, ${g.concrete.mismatched} mismatched${typeExclusionNote(g.concrete.exclusions)}`)
  console.log(`EK9001 ${g.coverage.ek9001}, stock errors ${g.coverage.stockErrors}, missing declarations ${g.coverage.missingDeclarations}; wall ${timing.total.toFixed(0)} s`)
  console.log(`runtime parity: ${g.runnable.runtimeParity}/${g.runnable.cases} print the expected result${exclusionNote(g.runnable.exclusions)} (${g.runnable.runtimeParityTypeChecking}/${g.runnable.mapperTypeChecks} of the cases that type-check)`)
  for (const e of g.concrete.staleExclusions) console.log(`stale type exclusion: ${e.id}, ${e.reason}: ${e.detail}`)
  for (const e of g.runnable.staleExclusions) console.log(`stale runtime exclusion: ${e.id}, ${e.reason}: ${e.detail}`)
  console.log(`wrote ${path.relative(root, path.join(outDir, "summary.md"))} and summary.json`)
  if (gate) {
    // A gate verdict cites this file: the revision, both binaries, the
    // declaration inputs, and the manifest's hash name the denominator
    // exactly; the manifest and the results are inside.
    const day = new Date().toISOString().slice(0, 10)
    let file = path.join(outDir, `gate-${day}.json`)
    for (let n = 2; fs.existsSync(file); n++) file = path.join(outDir, `gate-${day}-${n}.json`)
    const record = {
      gate: "gate 1 of decision (B)",
      ranAt: json.ranAt,
      revision: process.env.PARITY_REVISION ?? "unknown",
      binaries: { fork: manifest.fork.binarySha256, mapper: (json.revisions as any).mapper.binarySha256, stock: stockVersion, go: process.env.PARITY_GO_VERSION ?? "unknown" },
      inputs: manifest.inputs,
      manifest: { sha256: hash, content: manifest },
      verdict: g.pass ? "pass" : "not yet",
      results: json,
    }
    fs.writeFileSync(file, `${JSON.stringify(record, null, 1)}\n`)
    console.log(`wrote ${path.relative(root, file)}: gate 1 ${record.verdict}, manifest ${hash.slice(0, 12)}`)
  }
}

await main()
