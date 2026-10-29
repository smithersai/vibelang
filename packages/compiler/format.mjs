// All formatter entry points use the shipped dprint process plugin.
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, globSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

export const typescriptPlugin = "https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a"
function withConfig(action) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-format-"))
  try {
    const config = join(dir, "dprint.json")
    writeFileSync(config, JSON.stringify({
      plugins: [typescriptPlugin, fileURLToPath(new URL("./dprint-plugin.json", import.meta.url)) + "@" + createHash("sha256").update(readFileSync(new URL("./dprint-plugin.json", import.meta.url))).digest("hex")],
      typescript: { semiColons: "asi", quoteStyle: "alwaysDouble" }
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
export function formatSource(text, filePath = "file.vibe") {
  return withConfig(config => dprint(["fmt", "--config", config, "--stdin", resolve(filePath)], text))
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
