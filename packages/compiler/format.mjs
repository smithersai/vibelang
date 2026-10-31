// All formatter entry points use the shipped dprint process plugin.
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync, globSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { parseJsonc } from "./cache.mjs"

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
function dprint(args, input) {
  const require = createRequire(import.meta.url)
  const cli = require.resolve("dprint/bin.cjs")
  const result = spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr + result.stdout)
  return result.stdout
}
// formatSource formats text, the source of the .vibe file at filePath, with
// style's quote style and print width: the repository's (repositoryStyle)
// unless the caller, such as Prettier, gives its own.
export function formatSource(text, filePath = "file.vibe", style = repositoryStyle(filePath)) {
  return withConfig(style, config => dprint(["fmt", "--config", config, "--stdin", resolve(filePath)], text))
}
export function formatFiles(args) {
  const check = args.includes("--check")
  const paths = args.filter(arg => arg !== "--check" && arg !== "--write")
  const inputs = paths.length ? paths : ["**/*.vibe"]
  const files = [...new Set(inputs.flatMap(pattern => globSync(pattern, {
    exclude: path => /(^|[/\\])(?:node_modules|dist|build|coverage|\.git|\.jj)([/\\]|$)/.test(path)
  })))].filter(file => file.endsWith(".vibe"))
  let failed = false
  for (const file of files) {
    const before = readFileSync(file, "utf8")
    const after = formatSource(before, file)
    if (before === after) continue
    if (check) { console.error(file + ": needs formatting"); failed = true }
    else writeFileSync(file, after)
  }
  return failed ? 1 : 0
}
