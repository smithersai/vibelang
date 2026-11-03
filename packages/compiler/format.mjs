// All formatter entry points use the shipped dprint process plugin.
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, globSync, readFileSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { cacheDirectory, parseJsonc, prepare } from "./cache.mjs"

export const typescriptPlugin = "https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a"

// The quote style and print width of a file with no formatter configuration.
export const defaultStyle = { quoteStyle: "alwaysDouble", lineWidth: 120 }

// Prettier and Oxfmt both say singleQuote and printWidth; a quote is the
// preferred one unless the other needs fewer escapes, as dprint's prefer*.
const prettierStyle = (config, width) => ({
  quoteStyle: config.singleQuote === true ? "preferSingle" : "preferDouble",
  lineWidth: typeof config.printWidth === "number" ? config.printWidth : width,
})
const dprintStyle = (config) => ({
  quoteStyle: config.typescript?.quoteStyle ?? defaultStyle.quoteStyle,
  lineWidth: config.typescript?.lineWidth ?? config.lineWidth ?? defaultStyle.lineWidth,
})
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

function withConfig(style, action) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-format-"))
  try {
    const config = join(dir, "dprint.json")
    writeFileSync(config, JSON.stringify({
      lineWidth: style.lineWidth,
      plugins: [typescriptPlugin, fileURLToPath(new URL("./dprint-plugin.json", import.meta.url)) + "@" + createHash("sha256").update(readFileSync(new URL("./dprint-plugin.json", import.meta.url))).digest("hex")],
      typescript: { semiColons: "asi", quoteStyle: style.quoteStyle }
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
  return withConfig(style, config => dprint(["fmt", ...flags, "--config", config, "--stdin", resolve(filePath)], text))
}
// discoverable lists the absolute paths dprint would format, which is what
// `--stdin` formats too: it returns a gitignored file's text unchanged.
function discoverable(config) {
  const result = spawnDprint(["output-file-paths", "--config", config, "**/*.vibe"])
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
    const plugin = readFileSync(new URL("./dprint-plugin.json", import.meta.url))
    const file = join(location.path, `format-clean-${createHash("sha256").update(plugin).update(typescriptPlugin).update(process.cwd()).digest("hex").slice(0, 32)}.txt`)
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
const textKey = (style, text) => createHash("sha256").update(JSON.stringify(style)).update("\0").update(text).digest("base64url")
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
    const key = textKey(style, input)
    if (clean.has(key)) { results.set(file, { input, output: input, key }); continue }
    const group = JSON.stringify(style)
    if (!groups.has(group)) groups.set(group, { style, entries: [] })
    groups.get(group).entries.push({ file, input, key })
  }
  for (const { style, entries } of groups.values()) withConfig(style, config => {
    const known = discoverable(config)
    const listed = entries.filter(entry => known.has(resolve(entry.file)))
    if (listed.length === 0) return
    const dir = dirname(config)
    const shards = Math.max(1, Math.min(availableParallelism(), Math.floor(listed.length / shardSize)))
    const places = listed.map((entry, index) => join(dir, `shard${index % shards}`, String(index).padStart(7, "0") + ".vibe"))
    for (let shard = 0; shard < shards; shard++) {
      mkdirSync(join(dir, `shard${shard}`))
      // dprint takes a run's base from its config's directory when given no paths.
      writeFileSync(join(dir, `shard${shard}`, "dprint.json"), readFileSync(config))
    }
    listed.forEach((entry, index) => writeFileSync(places[index], entry.input))
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", parallelDprint, createRequire(import.meta.url).resolve("dprint/bin.cjs"), dir, String(shards)], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    const refused = new Set([...`${run.stderr}${run.stdout}`.matchAll(/Error formatting .*?(\d+\.vibe)\. Message:/g)].map(match => match[1]))
    if (run.error || (run.status !== 0 && refused.size === 0)) return
    listed.forEach((entry, index) => {
      if (!refused.has(basename(places[index]))) results.set(entry.file, { input: entry.input, output: readFileSync(places[index], "utf8"), key: entry.key })
    })
  })
  return results
}
export function formatFiles(args) {
  const check = args.includes("--check")
  const paths = args.filter(arg => arg !== "--check" && arg !== "--write")
  const inputs = paths.length ? paths : ["**/*.{vibe,vibex}"]
  const files = [...new Set(inputs.flatMap(pattern => globSync(pattern, {
    exclude: path => /(^|[/\\])(?:node_modules|dist|build|coverage|\.git|\.jj)([/\\]|$)/.test(path)
  })))].filter(file => /\.vibex?$/.test(file))
  const clean = cleanTexts()
  const batched = formatBatch(files, clean)
  const keys = new Set()
  let failed = false
  try {
    for (const file of files) {
      const before = readFileSync(file, "utf8")
      const result = batched.get(file)
      const after = result?.input === before ? result.output : formatText(before, file, repositoryStyle(file))
      if (before === after) {
        // A gitignored file comes back unchanged without being formatted, so it never counts as clean.
        if (result?.input === before) keys.add(result.key)
        continue
      }
      if (check) { console.error(file + ": needs formatting"); failed = true }
      else writeFileSync(file, after)
    }
  } finally { clean.save(keys) }
  return failed ? 1 : 0
}
