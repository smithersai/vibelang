// A sample of the compiler cases, each compiled as written and again with its
// .vibe files renamed .ts behind the directive. Both must report the same
// codes and write the same statements. Imports and comments may move: the
// $entry runner of a .vibe file brings its own imports, and the directive
// is a comment. Cases with module declarations differ on purpose (VIP-42).
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const cases = join(repo, "typescript/vibelang/cases")
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const runtime = join(repo, "packages/runtime")
const effect = join(runtime, "node_modules/effect")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

// One case of each language area, and failing ones, so codes count too.
const sample = [
  "catch-narrowing", "catch-narrowing.fail", "ch02-functions", "ch03-errors", "union-effect-calls", "union-effect-channels.fail",
  "optional-effect-calls", "tagged-template-runs", "plain-factory-programs.fail", "effect-type-spellings",
  "concurrent-unbounded-limit", "concurrent-limit-comma-order", "async-match-native", "blocks-do-tail-match", "acquire-function-resource",
  "data-import", "contract-exclude-scoped", "decl-layer", "vibex-preconditions-plain", "blocks-block-params.fail"
]

const walk = (directory, found = []) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "out", "expected"].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else found.push(path)
  }
  return found
}

const copy = (name, root) => {
  const directory = join(root, name)
  cpSync(join(cases, name), directory, { recursive: true, filter: (path) => !/\/(?:out|node_modules)$/.test(path) })
  mkdirSync(join(directory, "node_modules"))
  symlinkSync(realpathSync(effect), join(directory, "node_modules/effect"))
  symlinkSync(runtime, join(directory, "node_modules/vibelang-runtime"))
  return directory
}

const toTwin = (directory) => {
  const respell = (text) => text.replace(/\.vibe(["'])/g, ".ts$1").replace(/\.vibex(["'])/g, ".tsx$1")
  for (const file of walk(directory)) {
    if (/\.vibex?$/.test(file)) {
      writeFileSync(file.replace(/\.vibe$/, ".ts").replace(/\.vibex$/, ".tsx"), "// @vibe\n" + respell(readFileSync(file, "utf8")))
      rmSync(file)
    } else if (/\.(?:tsx?|json)$/.test(file)) {
      writeFileSync(file, respell(readFileSync(file, "utf8")))
    }
  }
  const config = JSON.parse(readFileSync(join(directory, "tsconfig.json"), "utf8"))
  config.compilerOptions = { ...config.compilerOptions, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true }
  config.include &&= config.include.map(respell).map((spec) => spec.replace(/\.vibe$/, ".ts").replace(/\.vibex$/, ".tsx"))
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify(config))
}

const compile = (directory) => {
  const { stdout } = spawnSync(native, ["-p", "tsconfig.json"], { cwd: directory, encoding: "utf8" })
  const codes = [...stdout.matchAll(/^(\S.*?)\(\d+,\d+\): (?:error|warning) ((?:TS|EK)\d+)/gm)]
    .map(([, file, code]) => basename(file).replace(/\.(?:vibex?|tsx?)$/, "") + " " + code).sort()
  const output = join(directory, "out")
  const statement = (line) => !/^\s*(?:import\b|\/\/|$)/.test(line) && !line.includes("$entry(")
  const scripts = existsSync(output) ? walk(output).filter((file) => /\.jsx?$/.test(file)).map((file) => [relative(output, file),
    readFileSync(file, "utf8").split("\n").filter(statement).map((line) => line.trim().replace(/\.(?:vibex?|tsx?)(["'])/g, ".js$1")).join("\n")]) : []
  return { codes, scripts: Object.fromEntries(scripts.sort()) }
}

for (const name of sample) {
  test(`${name} compiles alike as .vibe and as .ts with the directive`, { skip }, (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-twin-")))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const original = copy(name, join(root, "a"))
    const twin = copy(name, join(root, "b"))
    toTwin(twin)
    assert.deepEqual(compile(twin), compile(original))
  })
}
