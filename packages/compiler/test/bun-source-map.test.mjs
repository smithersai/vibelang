// vibelang/bun hands Bun a module's map when Bun can read it: Bun reads a map
// only from a module marked `// @bun`, which it runs as it is and reads as
// ASCII. A module that cannot carry the mark loses its map, never its behavior.
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = spawnSync("bun", ["--version"]).status !== 0 ? "bun is not on PATH" : missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

function run(t, files, args = ["--preload", "vibelang/bun", "src/entry.mjs"], compilerOptions = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-map-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
  const config = JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], lib: ["ESNext", "DOM"], ...compilerOptions },
    include: ["src"]
  })
  for (const [path, text] of Object.entries({ "package.json": '{"type":"module"}', "tsconfig.json": config, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return spawnSync("bun", args, {
    cwd: root, encoding: "utf8",
    env: { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), NO_COLOR: "1" }
  })
}

// Types vanish and the lowering adds lines, so emitted lines differ from these.
// The function is too long to inline, which Bun's transpiler would do.
const traced = `interface Unused {
  readonly a: string
}
type Alias = Unused

export error Refused { reason: string }

export function trace(label: string): Error {
  const made = new Error("traced" + label)
  return made.message.length > 0 ? made : new Error("empty")
}
`
const line = traced.split("\n").findIndex((text) => text.includes('new Error("traced"')) + 1
const entry = 'import { trace } from "./main.vibe"\nconsole.log(trace("x").stack)\n'

test("a stack frame names the .vibe line of an ASCII module", { skip }, (t) => {
  const result = run(t, { "src/main.vibe": traced, "src/entry.mjs": entry })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`main\\.vibe:${line}\\b`), result.stdout)
})

test("a stack under bun test names the .vibe line of an ASCII module", { skip }, (t) => {
  const result = run(t, {
    "src/main.vibe": traced,
    "src/app.test.ts": 'import { test } from "bun:test"\nimport { trace } from "./main.vibe"\ntest("logs", () => { console.log(trace("x").stack) })\n'
  }, ["test", "--preload", "vibelang/bun", "src/app.test.ts"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout + result.stderr, new RegExp(`main\\.vibe:${line}\\b`), result.stdout + result.stderr)
})

for (const [name, text] of Object.entries({ latin: "café", cjk: "日本語", astral: "\u{1F600}" })) {
  test(`a module's ${name} text stays exact`, { skip }, (t) => {
    const result = run(t, {
      "src/main.vibe": `// ${text}\nexport const text = ${JSON.stringify(text)}\n`,
      "src/entry.mjs": 'import { text } from "./main.vibe"\nconsole.log(JSON.stringify(text))\n'
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout), text)
  })
}

// Bun's transpiler supplies each of these. JavaScriptCore has no decorators.
const needing = {
  decorator: ["function mark(target: unknown, context: unknown): void {}\n@mark class Marked {}\nexport const text = typeof Marked\n", "function"],
  require: ["declare const require: (name: string) => unknown\nexport const text = typeof require\n", "function"],
  __dirname: ["declare const __dirname: string\nexport const text = typeof __dirname\n", "string"],
  __filename: ["declare const __filename: string\nexport const text = typeof __filename\n", "string"]
}

for (const [name, [source, value]] of Object.entries(needing)) {
  test(`a module that needs Bun's transpiler still runs: ${name}`, { skip }, (t) => {
    const result = run(t, {
      "src/main.vibe": source,
      "src/entry.mjs": 'import { text } from "./main.vibe"\nconsole.log(JSON.stringify(text))\n'
    }, undefined, { target: "ESNext" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout), value)
  })
}

test("a module with a hashbang keeps it first and runs", { skip }, (t) => {
  const result = run(t, {
    "src/main.vibe": '#!/usr/bin/env bun\nexport const text = "ran"\n',
    "src/entry.mjs": 'import { text } from "./main.vibe"\nconsole.log(JSON.stringify(text))\n'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout), "ran")
})
