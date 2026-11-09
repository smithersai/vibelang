// All formatter entry points use the shipped dprint process plugin.
import { findBinary } from "./binary.mjs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileHasVibeDirective, hasVibeDirective } from "./source.mjs"
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, globSync as expandGlob, readFileSync, symlinkSync, statSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { cacheDirectory, parseJsonc, prepare } from "./cache.mjs"

export const typescriptPlugin = "https://plugins.dprint.dev/typescript-0.97.1.wasm@3be85494ff8141c412535e659cbe3d764ed3a740375c929be48393ed20a9d429"
// The newer parser rejects generic callbacks inside JSX expressions and adds
// JSX children for text spaces. Keep the established TSX projection compatible.
const tsxTypescriptPlugin = "https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a"

// The quote style and print width of a file with no formatter configuration.
export const defaultStyle = { quoteStyle: "alwaysDouble", lineWidth: 120 }

// Prettier and Oxfmt both say singleQuote and printWidth; a quote is the
// preferred one unless the other needs fewer escapes, as dprint's prefer*.
const prettierStyle = (config, width) => ({
  quoteStyle: config.singleQuote === true ? "preferSingle" : "preferDouble",
  lineWidth: typeof config.printWidth === "number" ? config.printWidth : width,
})
// A dprint configuration formats .vibe files with the options it gives .ts
// files: its global indentWidth, useTabs and newLineKind and every option of
// its typescript section, as dprint itself would with the VibeLang plugin.
const dprintGlobals = ["indentWidth", "useTabs", "newLineKind"]
const dprintStyle = (config) => {
  const typescript = config.typescript && typeof config.typescript === "object" && !Array.isArray(config.typescript) ? config.typescript : {}
  const style = {
    quoteStyle: typescript.quoteStyle ?? defaultStyle.quoteStyle,
    lineWidth: typescript.lineWidth ?? config.lineWidth ?? defaultStyle.lineWidth,
  }
  const globals = Object.fromEntries(dprintGlobals.filter(name => config[name] !== undefined).map(name => [name, config[name]]))
  const options = Object.fromEntries(Object.entries(typescript).filter(([name]) => name !== "quoteStyle" && name !== "lineWidth"))
  if (Object.keys(globals).length) style.globals = globals
  if (Object.keys(options).length) style.typescript = options
  return style
}
// The configurations each formatter reads, in the order a directory's are
// tried. Each returns the style, or undefined when the file has none, as a
// package.json without a prettier key.
const styleFiles = [
  [".oxfmtrc.json", (config) => prettierStyle(config, 100)],
  [".oxfmtrc.jsonc", (config) => prettierStyle(config, 100)],
  [".prettierrc", (config) => prettierStyle(config, 80)],
  [".prettierrc.json", (config) => prettierStyle(config, 80)],
  ["package.json", (pkg, path) => {
    if (typeof pkg.prettier === "string") throw unreadable(path, "its prettier key names a shared configuration")
    return pkg.prettier && typeof pkg.prettier === "object" ? prettierStyle(pkg.prettier, 80) : undefined
  }],
  ["dprint.json", dprintStyle],
  [".dprint.json", dprintStyle],
  ["dprint.jsonc", dprintStyle],
  [".dprint.jsonc", dprintStyle],
]
// Prettier's other configuration forms run code or need a YAML or TOML
// parser; Prettier itself reads them for the vibelang/prettier plugin.
const unreadPrettierFiles = [".prettierrc.json5", ".prettierrc.yaml", ".prettierrc.yml", ".prettierrc.toml", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs", ".prettierrc.ts", ".prettierrc.cts", ".prettierrc.mts",
  "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs", "prettier.config.ts", "prettier.config.cts", "prettier.config.mts"]

const styles = new Map()
// repositoryStyle returns the quote style and print width of the formatter
// configuration nearest to filePath: the first directory from the file's up
// to the repository's root (the one holding .git or .jj) that holds one
// supplies them. A setting it leaves out takes its formatter's default
// (Oxfmt's width is 100, Prettier's 80, dprint's 120).
export function repositoryStyle(filePath) {
  const dir = dirname(resolve(filePath))
  if (styles.has(dir)) return styles.get(dir)
  let style = defaultStyle
  for (const [name, read] of styleFiles) {
    const path = join(dir, name)
    if (!existsSync(path)) continue
    let config
    try { config = parseJsonc(readFileSync(path, "utf8")) }
    catch (error) { throw unreadable(path, error.message) }
    const found = read(config ?? {}, path)
    if (found) { style = found; break }
  }
  if (style === defaultStyle) {
    const unread = unreadPrettierFiles.find(name => existsSync(join(dir, name)))
    if (unread) throw unreadable(join(dir, unread), "not JSON")
    const root = existsSync(join(dir, ".git")) || existsSync(join(dir, ".jj"))
    if (!root && dirname(dir) !== dir) style = repositoryStyle(dir)
  }
  styles.set(dir, style)
  return style
}
const unreadable = (path, why) =>
  new Error(`${path}: vibelang-format reads the quote style and print width from JSON configurations only (${why}); format .vibe files with Prettier's vibelang/prettier plugin, which reads every Prettier configuration`)

// Published descriptors use registry tarballs. A locally installed compiler
// can prepare the same checked process plugin without publishing that version.
// Keep generated archives outside immutable installs and reuse them per process.
const preparedPlugins = new Map()
process.once("exit", () => {
  for (const manifest of preparedPlugins.values()) rmSync(dirname(manifest), { recursive: true, force: true })
})
function processPlugin() {
  const shipped = fileURLToPath(new URL("./dprint-plugin.json", import.meta.url))
  const manifest = JSON.parse(readFileSync(shipped, "utf8"))
  if (!Object.values(manifest).some(entry => entry?.reference?.startsWith("npm:"))) return shipped
  const executable = process.platform === "win32" ? "vibelang.exe" : "vibelang"
  if (!process.env.VIBELANG_BINARY && !existsSync(new URL("./native/" + executable, import.meta.url))) {
    const target = process.platform + "-" + process.arch
    const name = process.platform === "win32" ? "@smthrs/cli-" + target : "vibelang-" + target
    try { createRequire(import.meta.url).resolve(name + "/package.json") }
    catch { return shipped }
  }
  const binary = findBinary()
  let stamp
  try { const stat = statSync(binary); stamp = [stat.size, stat.mtimeMs, stat.ctimeMs] } catch {}
  const key = JSON.stringify([binary, stamp])
  if (preparedPlugins.has(key)) return preparedPlugins.get(key)
  const dir = mkdtempSync(join(tmpdir(), "vibelang-format-plugin-"))
  try {
    const result = spawnSync(binary, ["--write-dprint-plugin", dir], { encoding: "utf8" })
    if (result.error || result.status !== 0) throw new Error("vibelang-format: preparing the installed native plugin: " + (result.error?.message ?? result.stderr + result.stdout))
    const prepared = join(dir, "dprint-plugin.json")
    preparedPlugins.set(key, prepared)
    return prepared
  } catch (error) { rmSync(dir, { recursive: true, force: true }); throw error }
}

function withConfig(style, filePath, action) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-format-"))
  try {
    // Keep npm process references in their package context, including when
    // the caller is outside the project or the package is read-only.
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(fileURLToPath(new URL(".", import.meta.url)), join(dir, "node_modules", "vibelang"), process.platform === "win32" ? "junction" : "dir")
    const config = join(dir, "dprint.json")
    const plugin = processPlugin()
    const reference = plugin === fileURLToPath(new URL("./dprint-plugin.json", import.meta.url)) ? "npm:vibelang/dprint-plugin.json" : plugin
    const tsx = /\.(?:vibex|tsx)$/i.test(filePath)
    // The two pinned plugins spell the semicolon option differently; a
    // configuration may use either. Without one, VibeLang writes "asi".
    const { semicolons, semiColons, ...typescript } = style.typescript ?? {}
    writeFileSync(config, JSON.stringify({
      ...style.globals,
      lineWidth: style.lineWidth,
      plugins: [tsx ? tsxTypescriptPlugin : typescriptPlugin, reference + "@" + createHash("sha256").update(readFileSync(plugin)).digest("hex")],
      typescript: { ...typescript, [tsx ? "semiColons" : "semicolons"]: semicolons ?? semiColons ?? "asi", quoteStyle: style.quoteStyle }
    }))
    return action(config)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
function spawnDprint(args, options) {
  const cli = createRequire(import.meta.url).resolve("dprint/bin.cjs")
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options })
}
function dprint(args, input) {
  const result = spawnDprint(args, { input })
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr + result.stdout)
  return result.stdout
}
// formatSource formats text, the source of the .vibe file at filePath, with
// style's quote style and print width: the repository's (repositoryStyle)
// unless the caller, such as Prettier, gives its own.
export function formatSource(text, filePath = "file.vibe", style = repositoryStyle(filePath)) {
  // The caller supplied a buffer, so dprint must not filter it by its path.
  return formatText(text, filePath, style, ["--no-gitignore", "--allow-node-modules"])
}
function formatText(text, filePath, style, flags = []) {
  const requestedPath = filePath
  // Read the supplied buffer: an editor's unsaved directive can differ from disk.
  if (hasVibeDirective(filePath, text)) {
    filePath = filePath.replace(/\.tsx$/, ".vibex").replace(/\.[cm]?ts$/, ".vibe")
  }
  try {
    return withConfig(style, filePath, config => dprint(["fmt", ...flags, "--config", config, "--stdin", resolve(filePath)], text))
  } catch (error) {
    throw new Error(`${requestedPath}: ${error.message}`, { cause: error })
  }
}
// discoverable lists every supported source path dprint would format, which is what
// `--stdin` formats too: it returns a gitignored file's text unchanged.
function discoverable(config) {
  const result = spawnDprint(["output-file-paths", "--config", config, "**/*.{vibe,vibex,ts,tsx,mts,cts}"])
  return result.status === 0 ? new Set(result.stdout.split("\n").filter(Boolean)) : new Set()
}
// cleanTexts remembers, across runs and per working directory, the texts dprint
// left unchanged, so a check of a clean tree starts no dprint. An entry names the
// plugin, the style and the text, so a rebuilt compiler, a changed setting or an
// edit misses. VIBELANG_DISABLE_CACHE=1 turns it off and VIBELANG_CACHE_DIR
// moves it, as for the compile cache; a cache it cannot use only costs time.
function cleanTexts() {
  const none = { has: () => false, save() {} }
  const location = cacheDirectory()
  if (!location) return none
  try {
    prepare(location)
    const plugin = readFileSync(processPlugin())
    const file = join(location.path, `format-clean-${createHash("sha256").update(plugin).update(typescriptPlugin).update(tsxTypescriptPlugin).update(process.cwd()).digest("hex").slice(0, 32)}.txt`)
    let text = ""
    try { text = readFileSync(file, "utf8") } catch {}
    const known = new Set(text.split("\n").filter(Boolean))
    return {
      has: key => known.has(key),
      save(keys) {
        if (keys.size === known.size && [...keys].every(key => known.has(key))) return
        try {
          const temporary = `${file}.${process.pid}`
          writeFileSync(temporary, [...keys].join("\n"))
          renameSync(temporary, file)
        } catch {}
      }
    }
  } catch { return none }
}
// The same bytes can be clean plain syntax and invalid JSX.
const textKey = (style, text, file) => createHash("sha256")
  .update(JSON.stringify(style)).update("\0")
  .update(/\.(?:vibex|tsx)$/.test(file) ? "tsx" : "ts").update("\0")
  .update(text).digest("base64url")
// Each dprint run spends a core on its one TypeScript host path, so a large
// batch gains from one run per core. A smaller shard costs more to start than it saves.
const shardSize = 256
// Runs dprint in each of argv's shard directories at once. formatFiles is
// synchronous, so a child waits for them. Its status is 1 if any run failed.
const parallelDprint = `
import { spawn } from "node:child_process"
import { join } from "node:path"
const [cli, dir, shards] = process.argv.slice(1)
const runs = Array.from({ length: Number(shards) }, (_, shard) => new Promise(done => {
  const cwd = join(dir, "shard" + shard)
  const child = spawn(process.execPath, [cli, "fmt", "--incremental=false", "--config", join(cwd, "dprint.json")], { cwd, stdio: ["ignore", "inherit", "inherit"] })
  child.on("error", () => done(1))
  child.on("close", status => done(status))
}))
process.exitCode = (await Promise.all(runs)).some(status => status !== 0) ? 1 : 0
`
// formatBatch formats files in one dprint run per style and core, instead of one
// Node and dprint process per file, returning each file's input, output and clean
// key. Files are copied to numbered names, so that their paths reach neither
// dprint's pattern syntax nor the command line's length limit, and a check
// writes nothing beside them. Any file it cannot vouch for is left out for
// formatText to handle in order, which also gives a failing file its error: a
// file dprint does not discover, one it fails on, or all of them if dprint fails.
function formatBatch(files, clean) {
  const groups = new Map(), results = new Map()
  for (const file of files) {
    let style, input
    try { style = repositoryStyle(file); input = readFileSync(file, "utf8") }
    catch { continue }
    const key = textKey(style, input, file)
    if (clean.has(key)) { results.set(file, { input, output: input, key }); continue }
    const group = JSON.stringify([style, /\.(?:vibex|tsx)$/i.test(file)])
    if (!groups.has(group)) groups.set(group, { style, filePath: file, entries: [] })
    groups.get(group).entries.push({ file, input, key })
  }
  for (const { style, filePath, entries } of groups.values()) withConfig(style, filePath, config => {
    const known = discoverable(config)
    const listed = entries.filter(entry => known.has(resolve(entry.file)))
    if (listed.length === 0) return
    const dir = dirname(config)
    const shards = Math.max(1, Math.min(availableParallelism(), Math.floor(listed.length / shardSize)))
    const places = listed.map((entry, index) => join(dir, `shard${index % shards}`, String(index).padStart(7, "0") + (/\.(?:vibex|tsx)$/.test(entry.file) ? ".vibex" : ".vibe")))
    for (let shard = 0; shard < shards; shard++) {
      mkdirSync(join(dir, `shard${shard}`))
      // dprint takes a run's base from its config's directory when given no paths.
      writeFileSync(join(dir, `shard${shard}`, "dprint.json"), readFileSync(config))
    }
    listed.forEach((entry, index) => writeFileSync(places[index], entry.input))
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", parallelDprint, createRequire(import.meta.url).resolve("dprint/bin.cjs"), dir, String(shards)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    const refused = new Set([...`${run.stderr}${run.stdout}`.matchAll(/Error formatting .*?(\d+\.vibex?)\. Message:/g)].map(match => match[1]))
    if (run.error || (run.status !== 0 && refused.size === 0)) return
    listed.forEach((entry, index) => {
      if (!refused.has(basename(places[index]))) results.set(entry.file, { input: entry.input, output: readFileSync(places[index], "utf8"), key: entry.key })
    })
  })
  return results
}
// Existing source paths are literal, including bracketed route names. Other
// inputs, including the default extension pattern, still use glob expansion.
function globSync(pattern, options) {
  if (/\.(?:vibex?|[cm]?ts|tsx)$/.test(pattern) && existsSync(pattern) && statSync(pattern).isFile()) {
    return options?.exclude?.(pattern) ? [] : [pattern]
  }
  return expandGlob(pattern, options)
}
export function formatFiles(args, command = "vibelang-format") {
  const separator = args.indexOf("--")
  const flags = separator < 0 ? args : args.slice(0, separator)
  if (flags.includes("--help") || flags.includes("-h")) {
    console.log(command + " [--check | --write] [--] [files or glob patterns...]")
    console.log("  --check  Report files that need formatting without writing them.")
    console.log("  --write  Format files in place (the default).")
    console.log("  --       Treat following arguments as file paths or glob patterns.")
    return 0
  }
  const unknown = flags.find(arg => arg.startsWith("-") && arg !== "--check" && arg !== "--write")
  if (unknown) throw new Error(command + ": unknown option " + unknown + ". Run " + command + " --help.")
  const check = flags.includes("--check")
  if (check && flags.includes("--write")) throw new Error(command + ": cannot combine --check and --write. Run " + command + " --help.")
  const paths = flags.filter(arg => arg !== "--check" && arg !== "--write")
    .concat(separator < 0 ? [] : args.slice(separator + 1))
  const inputs = paths.length ? paths : ["**/*.{vibe,vibex,ts,tsx,mts,cts}"]
  // Validate every explicit input before formatting any file. An ignored match
  // still exists; an empty default scan is also a valid clean project.
  const files = [...new Set(inputs.flatMap(pattern => {
    const matches = globSync(pattern, {
      exclude: path => /(^|[/\\])(?:node_modules|dist|build|coverage|\.git|\.jj)([/\\]|$)/.test(path)
    })
    if (paths.length && matches.length === 0 && globSync(pattern).length === 0) {
      throw new Error(command + ": no files match " + JSON.stringify(pattern) + ". Check the path or glob pattern.")
    }
    return matches
  }))].filter(file => /\.vibex?$/.test(file) || fileHasVibeDirective(file))
  const clean = cleanTexts()
  const batched = formatBatch(files, clean)
  const keys = new Set()
  let failed = false
  try {
    for (const file of files) {
      try {
        const before = readFileSync(file, "utf8")
        const result = batched.get(file)
        // formatText selects the plugin from the source kind, including marked TSX.
        const after = result?.input === before ? result.output : formatText(before, file, repositoryStyle(file))
        if (before === after) {
          // A gitignored file comes back unchanged without being formatted, so it never counts as clean.
          if (result?.input === before) keys.add(result.key)
          continue
        }
        if (check) { console.error(file + ": needs formatting"); failed = true }
        else writeFileSync(file, after)
      } catch (error) {
        throw new Error(file + ": " + error.message, { cause: error })
      }
    }
  } finally { clean.save(keys) }
  return failed ? 1 : 0
}
