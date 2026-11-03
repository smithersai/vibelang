// Rerunning setup on a repository an earlier release set up (Smithers, 76
// tsconfigs): the earlier setup wrote `"moduleSuffixes": ["", ".d.vibe"]`. A
// TypeScript twin has no such option, and Bun warns on it ("moduleSuffixes is
// not supported yet"), so `bun build` writes to stderr where the twin writes
// nothing. Setup no longer writes it (ddcc2242b68e), and removes what it wrote.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { must } from "../lib/util.mjs"
import { removeWrittenModuleSuffixes } from "../lib/wire.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const require = createRequire(join(runtime, "package.json"))
const ts = require("typescript")
const fc = require("fast-check")

const parse = (text) => {
  const { config, error } = ts.parseConfigFileTextToJson("tsconfig.json", text)
  assert.equal(error, undefined, text)
  return config
}

// The spellings an earlier setup left: the writer's, and a formatter's.
const written = fc.constantFrom('"moduleSuffixes": ["",".d.vibe"]', '"moduleSuffixes": ["", ".d.vibe"]', '"moduleSuffixes": [\n      "",\n      ".d.vibe"\n    ]')
const option = fc.constantFrom('"strict": true', '"module": "NodeNext"', '"allowArbitraryExtensions": true', '"paths": { "~/*": ["./src/*"] }')
const shape = fc.record({
  indent: fc.constantFrom("  ", "    ", "\t"),
  options: fc.uniqueArray(option, { maxLength: 3 }),
  slot: fc.nat(),
  comment: fc.constantFrom("", " // keep", " /* block */"),
  include: fc.boolean(),
  newline: fc.boolean()
})
const render = (input, extra) => {
  const options = [...input.options]
  if (extra) options.splice(input.slot % (options.length + 1), 0, extra)
  const i = input.indent
  const body = options.length ? `\n${options.map((o) => i + i + o).join(",\n")}${input.comment}\n${i}` : ""
  const top = [`"compilerOptions": {${body}}`, ...(input.include ? ['"include": ["src"]'] : [])]
  return `{\n${top.map((t) => i + t).join(",\n")}\n}${input.newline ? "\n" : ""}`
}

test("Smithers: setup removes the pair an earlier setup wrote, byte for byte", () => {
  const smithers = readFileSync(new URL("./fixtures/smithers-retired-module-suffixes/tsconfig.jsonc", import.meta.url), "utf8")
  assert.equal(removeWrittenModuleSuffixes(smithers, ts), '{\n  "compilerOptions": {\n    "allowArbitraryExtensions": true,\n    "target": "ES2022"\n  },\n  "include": ["src/**/*"]\n}\n')
  assert.equal(removeWrittenModuleSuffixes('{ "compilerOptions": { "moduleSuffixes": ["", ".d.vibe"] } }', ts), '{ "compilerOptions": {} }')
})

test("retired-suffixes-roundtrip: the pair goes from any option position, nothing else changes", () => {
  fc.assert(fc.property(shape, written, (input, pair) => {
    const text = render(input, pair)
    parse(text)
    const removed = removeWrittenModuleSuffixes(text, ts)
    assert.deepEqual(parse(removed), parse(render(input)), removed)
    assert.ok(!removed.includes("moduleSuffixes"))
    assert.equal(removeWrittenModuleSuffixes(removed, ts), removed)
    if (input.comment && input.options.length) assert.ok(removed.includes(input.comment.trim()), removed)
  }), { seed: 23901, numRuns: 300 })
})

// A repository's own suffixes are its configuration: setup did not write them.
test("retired-suffixes-own: any other moduleSuffixes stays, byte for byte", () => {
  const own = fc.array(fc.constantFrom("", ".ios", ".native", ".d.vibe", ".web"), { maxLength: 4 })
    .filter((list) => JSON.stringify(list) !== '["",".d.vibe"]')
  fc.assert(fc.property(shape, own, (input, list) => {
    const text = render(input, `"moduleSuffixes": ${JSON.stringify(list)}`)
    assert.equal(removeWrittenModuleSuffixes(text, ts), text)
  }), { seed: 23902, numRuns: 300 })
  for (const text of ['{}', '{ "moduleSuffixes": ["", ".d.vibe"] }', '{ "compilerOptions": { "moduleSuffixes": "x" } }', '{ "compilerOptions": [] }']) {
    assert.equal(removeWrittenModuleSuffixes(text, ts), text)
  }
})

test("Smithers: wireTarget clears every owned tsconfig, and Bun then writes what the TypeScript twin writes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "retired-suffixes-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  const pair = '{\n  "compilerOptions": {\n    "moduleSuffixes": ["",".d.vibe"],\n    "strict": true\n  }\n}\n'
  const own = '{\n  "compilerOptions": {\n    "moduleSuffixes": ["", ".ios"]\n  }\n}\n'
  put("package.json", '{"name":"fixture","private":true,"type":"module","workspaces":["packages/*"]}\n')
  put("tsconfig.base.json", pair)
  put("packages/a/package.json", '{"name":"a","private":true,"type":"module"}\n')
  put("packages/a/tsconfig.json", '{\n  "extends": "../../tsconfig.base.json",\n  "compilerOptions": {\n    "moduleSuffixes": ["", ".d.vibe"],\n    "noEmit": true\n  },\n  "include": ["src"]\n}\n')
  put("packages/a/src/index.ts", "export const a = 1\n")
  // A package outside the run: the warning comes from whichever tsconfig Bun reads.
  put("packages/b/package.json", '{"name":"b","private":true}\n')
  put("packages/b/tsconfig.json", pair)
  put("packages/b/src/index.ts", "export const b = 2\n")
  put("packages/c/package.json", '{"name":"c","private":true}\n')
  put("packages/c/tsconfig.json", own)
  // A package of the run under a directory the walk skips, as Smithers' .smithers/flows is.
  put(".flows/package.json", '{"name":"flows","private":true,"type":"module"}\n')
  put(".flows/tsconfig.json", pair)
  mkdirSync(join(root, "node_modules"))
  symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
  await must("jj git init", { cwd: root })
  await must("jj config set --repo user.name test", { cwd: root })
  await must("jj config set --repo user.email test@localhost", { cwd: root })
  const config = makeConfig({ target: root, packages: ["packages/a", ".flows"], test: "true", vibelangVersion: "0.0.11", install: "true" })
  const result = await wireTarget(config, join(root, ".logs"))
  for (const file of ["tsconfig.base.json", "packages/a/tsconfig.json", "packages/b/tsconfig.json", ".flows/tsconfig.json"]) {
    assert.ok(!readFileSync(join(root, file), "utf8").includes("moduleSuffixes"), file)
    assert.ok(result.changed.includes(file), file)
  }
  assert.deepEqual(parse(readFileSync(join(root, "packages/c/tsconfig.json"), "utf8")).compilerOptions.moduleSuffixes, ["", ".ios"])
  const bun = spawnSync("bun", ["build", "--target=browser", "src/index.ts"], { cwd: join(root, "packages/b"), encoding: "utf8" })
  if (bun.error?.code !== "ENOENT") assert.equal(bun.stderr, "")
  const replay = await wireTarget(config, join(root, ".logs"))
  assert.ok(!replay.changed.includes("packages/b/tsconfig.json"), "setup removed the same option twice")
})
