// vibelang/oxlint: stock Oxlint's native rules on .vibe and .vibex files.
//
// Oxlint reads only files it can parse, and takes no parser or stdin. So this
// pass writes each module's virtual TypeScript (`vibelang --ts-projection`, the
// view tsc tooling sees) to a temporary tree with the source's relative paths,
// puts the written configuration at that tree's root, and runs Oxlint there.
// x.vibe is x.ts and x.vibex is x.tsx, so overrides, ignorePatterns and
// .gitignore files select the same modules as for their TypeScript twins.
//
// Each report maps back through the projection's span map. A report that starts
// on text the projection synthesized has no source to point at and is dropped.
// JS plugin rules, and the rules the caller says run elsewhere, stay out.
// Migration setup's .vibelang/oxlint.mjs is the command that calls this.
import { spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { availableParallelism, tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { parseJsonc } from "./cache.mjs"
import { compilerCommand, findCompiler } from "./project.mjs"

const KindVerbatim = 0

/** The source extension's stand-in in the temporary tree. */
const virtualPath = (path) => path.replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts")
/** A glob naming .vibe or .vibex, as it must read in the temporary tree. */
const virtualGlob = (glob) => glob
  .replace(/\.\{([^}]*)\}/g, (_, list) => `.{${list.split(",").map((extension) => ({ vibe: "ts", vibex: "tsx" })[extension.trim()] ?? extension).join(",")}}`)
  .replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts")

/**
 * Maps the virtual span [start, start + length) to the source, or returns
 * undefined when it starts on synthesized text. Inside a verbatim segment
 * positions map one to one; an atom maps as a whole; a span crossing out of its
 * first segment ends where the last segment it touches ends.
 *
 * @param {ReadonlyArray<readonly number[]>} segments The projection's tuples:
 *   virtual start, virtual length, original start, original length, kind.
 */
export function sourceSpan(segments, start, length) {
  let low = 0, high = segments.length - 1, found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (segments[middle][0] <= start) { found = middle; low = middle + 1 } else high = middle - 1
  }
  if (found < 0) return undefined
  const [virtualStart, virtualLength, originalStart, originalLength, kind] = segments[found]
  if (start >= virtualStart + virtualLength) return undefined
  const verbatim = kind === KindVerbatim
  const from = verbatim ? originalStart + start - virtualStart : originalStart
  const end = start + Math.max(length, 0)
  if (end <= virtualStart + virtualLength) return { start: from, length: verbatim ? length : originalLength }
  let to = originalStart + originalLength
  for (let i = found + 1; i < segments.length && segments[i][0] < end; i++) {
    const [nextStart, nextLength, nextOriginal, nextOriginalLength, nextKind] = segments[i]
    to = nextKind === KindVerbatim ? nextOriginal + Math.min(end - nextStart, nextLength) : nextOriginal + nextOriginalLength
  }
  return { start: from, length: Math.max(to - from, 0) }
}

/** The 1-based line and column of a byte offset. Oxlint counts columns in bytes. */
export function lineAndColumn(source, offset) {
  const before = source.subarray(0, offset)
  let line = 1
  for (const byte of before) if (byte === 10) line++
  return { line, column: offset - before.lastIndexOf(10) }
}

// Whether the import naming the span comes from effect or effect/*. D501 keeps
// such an import for the declaration file though no code names it.
function namesEffectImport(text, start, end) {
  const before = text.slice(0, start)
  const keyword = before.lastIndexOf("import")
  if (keyword < 0 || /[;]|\bfrom\b/.test(before.slice(keyword + "import".length))) return false
  const module = /^[^;]*?\bfrom\s*["']([^"']+)["']/.exec(text.slice(end))
  return module !== null && /^effect(?:\/|$)/.test(module[1])
}

/**
 * Whether a report on source text comes from how the projection lowers it, not
 * from what the source says. Both forms are ones a TypeScript twin never has.
 *
 * - no-unused-vars on an effect import, which D501 keeps, as in vibelang/eslint.
 * - no-unsafe-declaration-merging where the source does not write both halves:
 *   a service lowers to an interface and a class of one name.
 * - no-unexpected-multiline on the ( of a try (x) that starts a line.
 * - no-unused-expressions on the value of a match arm.
 */
export function isProjectionArtifact(code, source, span) {
  const text = source.toString("latin1")
  const end = span.start + span.length
  if (code === "eslint(no-unused-vars)") return namesEffectImport(text, span.start, end)
  // try (x) on a line of its own: with try lowered, ( reads as a call of the line before.
  if (code === "eslint(no-unexpected-multiline)") return /\btry\s*$/.test(text.slice(0, span.start))
  // when x: y; is an arm's value, which the lowering writes as a statement.
  if (code === "eslint(no-unused-expressions)") return /(?:^|\n)\s*(?:when\b[^\n]*|default\s*):\s*$/.test(text.slice(0, span.start))
  if (code === "typescript(no-unsafe-declaration-merging)") {
    const name = text.slice(span.start, end).replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")
    return !(new RegExp(`\\binterface\\s+${name}\\b`).test(text) && new RegExp(`\\bclass\\s+${name}\\b`).test(text))
  }
  return false
}

/**
 * The diagnostic at its source position, or undefined when its primary label
 * starts on synthesized text. A diagnostic with no rule is a parse failure of
 * the projection: it is never dropped, because the module got no rules.
 */
export function mapDiagnostic(diagnostic, segments, source, filename) {
  // An empty file has no segments, and a report on it stands at its start.
  const spanOf = (label) => source.length === 0 ? { start: 0, length: 0 } : sourceSpan(segments, label.span.offset, label.span.length)
  const labels = []
  for (const label of diagnostic.labels ?? []) {
    const span = spanOf(label)
    if (span === undefined) continue
    labels.push({ ...label, span: { offset: span.start, length: span.length, ...lineAndColumn(source, span.start) } })
  }
  if (diagnostic.code) {
    const primary = diagnostic.labels?.[0]
    const span = primary && spanOf(primary)
    if (span === undefined || isProjectionArtifact(diagnostic.code, source, span)) return undefined
  }
  return { ...diagnostic, filename, labels }
}

function tool(require, name) {
  const pkg = require.resolve(`${name}/package.json`)
  const { bin } = JSON.parse(readFileSync(pkg, "utf8"))
  return resolve(dirname(pkg), typeof bin === "string" ? bin : bin[name])
}

// Oxlint from the project, else the one Vite+ carries for `vp lint`.
export function oxlintBinary(root) {
  const require = createRequire(join(root, "package.json"))
  try { return tool(require, "oxlint") } catch {}
  try { return tool(createRequire(require.resolve("vite-plus/package.json")), "oxlint") } catch {}
  throw new Error("vibelang-oxlint: oxlint is not installed: install it beside vibelang, or vite-plus for vp lint.")
}

// The temporary tree loads no JS plugin, and a preload named by package does not
// resolve from it.
function oxlintEnvironment() {
  const preloads = (process.env.NODE_OPTIONS ?? "").replace(/--import(?:=|\s+)vibelang\/register/g, "").trim()
  return { ...process.env, NODE_OPTIONS: preloads }
}

/** The configuration as the temporary tree needs it, without JS plugins. */
export function virtualConfig(config, elsewhere = new Set()) {
  const { jsPlugins: _jsPlugins, options, $schema: _schema, extends: _extends, ...rest } = config
  const kept = (name) => (!name.includes("/") || nativePlugins.has(name.split("/")[0])) && !elsewhere.has(canonicalRule(name))
  const rules = (written) => Object.fromEntries(Object.entries(written ?? {}).filter(([name]) => kept(name)))
  const virtual = { ...rest }
  // Off at the top, over any category that turns it on.
  virtual.rules = { ...rules(config.rules), ...Object.fromEntries([...elsewhere].filter((name) => nativePlugins.has(name.split("/")[0])).map((name) => [name, "off"])) }
  // Type-aware rules need the option; an unused directive stays quiet, as a
  // directive for a rule of the other pass would look unused here.
  if (options?.typeAware) virtual.options = { typeAware: true }
  if (config.ignorePatterns) virtual.ignorePatterns = config.ignorePatterns.map(virtualGlob)
  if (config.overrides) {
    virtual.overrides = config.overrides.map(({ jsPlugins: _js, ...override }) => ({
      ...override,
      files: override.files.map(virtualGlob),
      ...(override.rules ? { rules: rules(override.rules) } : {}),
    }))
  }
  return virtual
}

// Writes the configuration at path in the tree, each file it extends beside
// it: an extended file may name JS plugins too.
function writeConfig(tree, path, config, base, elsewhere, counter = { next: 0 }) {
  const virtual = virtualConfig(config, elsewhere)
  if (config.extends?.length) {
    virtual.extends = config.extends.map((entry) => {
      const file = resolve(base, entry)
      const name = `.vibelang-extends-${counter.next++}.json`
      writeConfig(tree, join(dirname(path), name), parseJsonc(readFileSync(file, "utf8")), dirname(file), new Set(), counter)
      return `./${name}`
    })
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(virtual))
}

/** A rule's name as Oxlint's own plugin spells it. */
export function canonicalRule(name) {
  if (!name.includes("/")) return `eslint/${name}`
  return name.replace(/^@typescript-eslint\//, "typescript/").replace(/^react-hooks\//, "react/").replace(/^vibelang\/no-unused-vars$/, "eslint/no-unused-vars")
}

const nativePlugins = new Set(["eslint", "typescript", "@typescript-eslint", "unicorn", "react", "react_perf", "react-perf", "react-hooks", "jsx-a11y", "jsx_a11y", "nextjs", "next", "oxc", "deepscan", "import", "import-x", "jsdoc", "jest", "vitest", "promise", "node", "n", "regex", "vue"])

// Every directory walked: node_modules and version control are never source.
const skipped = new Set(["node_modules", ".git", ".jj"])

function walk(path, found, ignoreFiles, nested) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      if (!skipped.has(entry.name)) walk(child, found, ignoreFiles, nested)
    } else if (entry.isFile()) {
      if (/\.vibex?$/.test(entry.name)) found.add(child)
      else if (entry.name === ".gitignore" || entry.name === ".eslintignore") ignoreFiles.add(child)
      else if (entry.name === ".oxlintrc.json" || entry.name === ".oxlintrc.jsonc") nested.add(child)
    }
  }
}

function project(compiler, file) {
  return new Promise((done, fail) => {
    const [command, args] = compilerCommand(compiler, ["--ts-projection", file])
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })
    const out = [], err = []
    child.stdout.on("data", (chunk) => out.push(chunk))
    child.stderr.on("data", (chunk) => err.push(chunk))
    child.on("error", fail)
    child.on("close", (status) => {
      if (status !== 0) fail(new Error(`vibelang/oxlint: the compiler failed on ${file}: ${Buffer.concat(err).toString("utf8").trim()}`))
      else done(JSON.parse(Buffer.concat(out).toString("utf8")))
    })
    child.stdin.end(readFileSync(file))
  })
}

async function pool(items, limit, work) {
  let next = 0
  const runner = async () => { while (next < items.length) { const item = items[next++]; await work(item) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
}

// Files and directories a path names: .vibe paths, globs and directories, as
// the Oxlint invocation they come from names them.
function select(paths, cwd, found, ignoreFiles, nested) {
  for (const path of paths.length ? paths : ["."]) {
    const matches = /[*?{]/.test(path) ? globSync(path, { cwd }).map((match) => resolve(cwd, match)) : [resolve(cwd, path)]
    for (const absolute of matches) {
      const stat = statSync(absolute, { throwIfNoEntry: false })
      if (stat?.isDirectory()) walk(absolute, found, ignoreFiles, nested)
      else if (stat?.isFile() && /\.vibex?$/.test(absolute)) found.add(absolute)
    }
  }
}

// What a type-aware rule's program reads beside the projected modules: the
// project files, and the packages its imports resolve to.
function mirrorProgramFiles(tree, root, dirs) {
  for (const dir of dirs) {
    for (let at = dir; ; at = dirname(at)) {
      const rooted = relative(root, at)
      if (rooted.startsWith("..")) break
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        if (entry.isFile() && /^(?:tsconfig.*\.json|package\.json)$/.test(entry.name)) {
          mkdirSync(join(tree, rooted), { recursive: true })
          if (!existsSync(join(tree, rooted, entry.name))) copyFileSync(join(at, entry.name), join(tree, rooted, entry.name))
        } else if (entry.name === "node_modules" && !existsSync(join(tree, rooted, entry.name))) {
          mkdirSync(join(tree, rooted), { recursive: true })
          symlinkSync(join(at, entry.name), join(tree, rooted, entry.name))
        }
      }
      if (rooted === "") break
    }
  }
}

/**
 * Runs the native rules on the .vibe and .vibex modules under paths.
 *
 * @param {object} options
 * @param {object} options.config The Oxlint configuration as written.
 * @param {string} options.base The directory its relative paths start from.
 * @param {string} [options.cwd] Where the invocation runs; paths start here.
 * @param {string[]} [options.paths] Paths, as for Oxlint. Default: the directory.
 * @param {string[]} [options.forward] Other Oxlint options.
 * @param {Iterable<string>} [options.elsewhere] Rules another pass runs on these modules.
 * @param {string} [options.binary] Oxlint's bin. Default: the project's.
 * @param {string} [options.compiler] The vibelang command.
 * @returns {Promise<{ status: number, output: { diagnostics: object[], number_of_files: number, number_of_rules: number, threads_count: number, dropped: Record<string, number> } }>}
 */
export async function lintProjected({ config, base, cwd = process.cwd(), paths = [], forward = [], elsewhere = [], binary = oxlintBinary(cwd), compiler = findCompiler(base) }) {
  const skipped = new Set([...elsewhere].map(canonicalRule))
  const output = { diagnostics: [], number_of_files: 0, number_of_rules: 0, threads_count: 0, dropped: {} }
  const found = new Set(), ignoreFiles = new Set(), nested = new Set()
  select(paths, cwd, found, ignoreFiles, nested)
  if (found.size === 0) return { status: 0, output }
  const root = realpathSync(base)
  const tree = mkdtempSync(join(realpathSync(tmpdir()), "vibelang-oxlint-"))
  try {
    writeConfig(tree, join(tree, ".oxlintrc.json"), config, base, skipped)
    // Oxlint's walk applies .gitignore files beneath a repository root.
    mkdirSync(join(tree, ".git"))
    for (const file of ignoreFiles) {
      const rooted = relative(root, realpathSync(file))
      if (rooted.startsWith("..")) continue
      mkdirSync(dirname(join(tree, rooted)), { recursive: true })
      symlinkSync(file, join(tree, rooted))
    }
    for (const file of nested) {
      const rooted = relative(root, realpathSync(file))
      if (dirname(rooted) === "." || rooted.startsWith("..")) continue
      // A built template can extend a package it has not installed; Oxlint walks
      // only what ignore rules leave, so an unreadable nested file is not fatal.
      try { writeConfig(tree, join(tree, dirname(rooted), ".oxlintrc.json"), parseJsonc(readFileSync(file, "utf8")), dirname(file), skipped) } catch {}
    }
    const modules = new Map()
    // A module the compiler cannot project got no rules: that is a report, not silence.
    const unprojected = []
    await pool([...found], Math.min(availableParallelism(), 16), async (file) => {
      const real = realpathSync(file)
      const rooted = relative(root, real)
      if (rooted.startsWith("..")) throw new Error(`vibelang/oxlint: ${file} is outside the configuration's directory ${root}`)
      let projection
      try { projection = await project(compiler, real) } catch (error) {
        unprojected.push({ code: "vibelang(unprojected)", message: error.message, severity: "warning", filename: relative(cwd, real), labels: [{ span: { offset: 0, length: 0, line: 1, column: 1 } }] })
        return
      }
      const virtual = join(tree, virtualPath(rooted))
      mkdirSync(dirname(virtual), { recursive: true })
      writeFileSync(virtual, projection.text)
      modules.set(virtual, { file: real, segments: projection.mappings ?? [] })
    })
    output.number_of_files = modules.size
    if (config.options?.typeAware || forward.includes("--type-aware")) mirrorProgramFiles(tree, root, new Set([...modules.values()].map(({ file }) => dirname(file))))
    const run = spawnSync(process.execPath, [binary, "-f", "json", "--no-error-on-unmatched-pattern", ...forward, ...inTreePaths(paths, cwd, root, tree)], { cwd: tree, env: oxlintEnvironment(), encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 })
    if (run.error) throw run.error
    let result
    try { result = JSON.parse(run.stdout) } catch {
      throw new Error(`vibelang/oxlint: Oxlint failed: ${run.stdout}${run.stderr}`)
    }
    Object.assign(output, { number_of_rules: result.number_of_rules, threads_count: result.threads_count })
    for (const diagnostic of result.diagnostics) {
      const module = modules.get(join(tree, diagnostic.filename))
      // A report on a file this pass did not project is not one of its modules'.
      if (module === undefined) continue
      const mapped = mapDiagnostic(diagnostic, module.segments, readFileSync(module.file), relative(cwd, module.file))
      // The module got no rules. Say so on it: this is a gap in the projection, not in the source.
      if (mapped && !diagnostic.code) output.diagnostics.push({ ...mapped, code: "vibelang(unprojected)", severity: "warning", message: `Oxlint's native rules did not run: the projected TypeScript does not parse: ${diagnostic.message}` })
      else if (mapped) output.diagnostics.push(mapped)
      else output.dropped[diagnostic.code] = (output.dropped[diagnostic.code] ?? 0) + 1
    }
    output.diagnostics.push(...unprojected)
    output.diagnostics.sort((a, b) => a.filename.localeCompare(b.filename) || (a.labels[0]?.span.offset ?? 0) - (b.labels[0]?.span.offset ?? 0))
    return { status: output.diagnostics.some((d) => d.severity === "error") ? 1 : 0, output }
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
}

// The paths in the tree Oxlint walks: only directories and modules this pass
// wrote, so the tree's own selection applies to exactly what the invocation named.
function inTreePaths(paths, cwd, root, tree) {
  const named = paths.filter((path) => !/[*?{]/.test(path)).map((path) => virtualPath(relative(root, realpathSync(resolve(cwd, path))) || ".")).filter((path) => existsSync(join(tree, path)))
  return paths.length === 0 || paths.some((path) => /[*?{]/.test(path)) ? ["."] : named
}

/** What Oxlint resolves for a module in the temporary tree, as --print-config prints it. */
export function printProjectedConfig({ config, base, elsewhere = [], binary = oxlintBinary(base) }) {
  const tree = mkdtempSync(join(realpathSync(tmpdir()), "vibelang-oxlint-"))
  try {
    writeConfig(tree, join(tree, ".oxlintrc.json"), config, base, new Set([...elsewhere].map(canonicalRule)))
    const printed = spawnSync(process.execPath, [binary, "--print-config"], { cwd: tree, env: oxlintEnvironment(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    if (printed.status !== 0) throw new Error(`vibelang/oxlint: Oxlint failed: ${printed.stdout}${printed.stderr}`)
    return printed.stdout
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
}

/** Oxlint's unix format of diagnostics, and its problem count. */
export function formatUnix(diagnostics) {
  const lines = diagnostics.map((d) => {
    const span = d.labels[0]?.span
    return `${d.filename}:${span?.line ?? 1}:${span?.column ?? 1}: ${d.message} [${d.severity === "error" ? "Error" : "Warning"}/${d.code ?? "parse"}]`
  })
  return lines.length ? `${lines.join("\n")}\n\n${lines.length} problems\n` : ""
}
