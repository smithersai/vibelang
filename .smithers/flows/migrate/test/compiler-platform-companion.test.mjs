import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { codemod, makeConfig, paths, revert } from "../lib/steps.mjs"
import { batchScope, foreignChanges } from "../lib/touched.mjs"
import { must, writeJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"

// alchemy-platform-exported-value: the compiler's platform repair moves a
// host read into a new companion beside its module, x.vibe's x.platform.ts
// (spec 005 EK4402, "move the code into a sibling `.ts` module that does not
// exist yet"; chapter 7, "Platform repairs from one source share one fresh
// `<source>.platform.ts` companion"). The flow owned only the siblings its
// own split wrote, so a batch whose module took the compiler's repair failed
// verify on a foreign file, and a revert left the companion behind.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
// The first line of every companion the native repair writes
// (typescript/tsc/internal/vibelang/fix_platform_companion.go).
const compilerCompanionMarker = "// Generated platform helpers for this VibeLang module.\n"
const ts = require.resolve("typescript/package.json").replace(/\/package.json$/, "")

// The fake compiler's repair: a listed module with the wrapper takes a fresh
// companion, as the native platform repair does, unless a file claims the name.
const fakeCompiler = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
if (process.argv.includes("--showConfig")) {
  const config = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf("-p") + 1], "utf8"))
  const files = config.files ?? fs.readdirSync("src").filter(f => /[.](ts|tsx|vibe|vibex)$/.test(f) && !f.includes(".d.")).map(f => "./src/" + f)
  console.log(JSON.stringify({ files, compilerOptions: config.compilerOptions ?? {} }))
  process.exit(0)
}
if (process.argv.includes("--fix")) {
  const at = process.argv.indexOf("--only")
  const listed = at < 0 ? [] : fs.readFileSync(process.argv[at + 1].replace(/^@/, ""), "utf8").split("\\n").filter(Boolean)
  let fixes = 0
  for (const file of listed) {
    const text = fs.readFileSync(file, "utf8")
    if (!text.includes("Effect.sync(() => document.title)")) continue
    const companion = file.replace(/\\.vibe$/, ".platform.ts")
    if ([".ts", ".tsx", ".js", ".d.ts"].some(e => fs.existsSync(companion.replace(/\\.ts$/, e)))) continue
    fs.writeFileSync(companion, ${JSON.stringify(compilerCompanionMarker)} + 'import { Effect } from "effect";\\nexport function $platform() { return Effect.sync(() => document.title); }\\n')
    fs.writeFileSync(file, 'import { $platform } from "./' + path.basename(companion).replace(/\\.ts$/, ".js") + '";\\n' + text.replace("Effect.sync(() => document.title)", "$platform()"))
    fixes++
    console.log("vibelang --fix: " + path.relative(process.cwd(), file) + ": 1 fix (EK4402 ×1)")
  }
  console.log("vibelang --fix: " + fixes + " fixes in " + fixes + " files.")
}
`

const wrapped = 'import * as Effect from "effect/Effect"\nexport const Value = Effect.sync(() => document.title)\n'

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-compiler-companion-"))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  writeFileSync(join(root, "tsconfig.json"), '{"include":["src/**/*"]}')
  const compiler = join(root, "node_modules/.bin/vibelang")
  writeProbeAwareCompiler(compiler, fakeCompiler, { mode: 0o755 })
  return { root, compiler }
}

test("the flow knows a companion by the compiler's own marker", async () => {
  const go = readFileSync(new URL("../../../../typescript/tsc/internal/vibelang/fix_platform_companion.go", import.meta.url), "utf8")
  assert.ok(go.includes("const platformCompanionMarker = " + JSON.stringify(compilerCompanionMarker)))
  const { compilerCompanionMarker: flow } = await import("../lib/codemod.mjs")
  assert.equal(flow, compilerCompanionMarker)
})

test("the fix loop reports the fresh companions the compiler wrote for listed modules, and only those", async () => {
  const p = project({
    "src/value.vibe": wrapped,
    "src/claimed.vibe": wrapped,
    "src/claimed.platform.js": "export const taken = 1\n",
    "src/unlisted.vibe": wrapped,
    "src/plain.vibe": "export const k = 1\n",
  })
  try {
    const only = ["src/value.vibe", "src/claimed.vibe", "src/plain.vibe"]
    const result = await fixToFixedPoint({ compiler: p.compiler, tsconfig: "tsconfig.json", cwd: p.root, root: p.root, only })
    assert.deepEqual(result.companions, ["src/value.platform.ts"])
    assert.ok(readFileSync(join(p.root, "src/value.platform.ts"), "utf8").startsWith(compilerCompanionMarker))
    assert.equal(existsSync(join(p.root, "src/unlisted.platform.ts")), false)
    assert.equal(readFileSync(join(p.root, "src/claimed.platform.js"), "utf8"), "export const taken = 1\n")
  } finally { rmSync(p.root, { recursive: true, force: true }) }
})

test("a companion without the compiler's marker is not the run's", async () => {
  const p = project({ "src/value.vibe": wrapped })
  try {
    const authored = `#!/usr/bin/env node
const fs = require("node:fs")
if (process.argv.includes("--fix")) fs.writeFileSync("src/value.platform.ts", "export const authored = 1\\n")
console.log("vibelang --fix: 0 fixes in 0 files.")
`
    writeProbeAwareCompiler(p.compiler, authored, { mode: 0o755 })
    const result = await fixToFixedPoint({ compiler: p.compiler, tsconfig: "tsconfig.json", cwd: p.root, root: p.root, only: ["src/value.vibe"] })
    assert.deepEqual(result.companions, [])
  } finally { rmSync(p.root, { recursive: true, force: true }) }
})

test("a recorded companion is in the batch's scope; an unrecorded one is foreign", () => {
  const files = [{ path: "src/value.ts", planned: "src/value.vibe" }]
  const recorded = { platform: { splits: [], refused: [], companions: [{ file: "src/value.ts", companion: "src/value.platform.ts" }] } }
  assert.ok(batchScope({ files, codemod: recorded }).has("src/value.platform.ts"))
  const added = [{ status: "added", path: "src/value.platform.ts" }]
  assert.deepEqual(foreignChanges(added, { files, codemod: recorded }), [])
  assert.deepEqual(foreignChanges(added, { files, codemod: { platform: { splits: [], refused: [] } } }), added)
})

for (const mode of ["step", "one-pass"]) for (const privateCompanions of [false, true]) test("codemod records and reverts compiler companions, " + mode + ", private exports " + privateCompanions, { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-compiler-companion-run-"))
  const target = join(root, "repo"), run = join(root, "run")
  const put = (file, text) => { mkdirSync(join(target, file, ".."), { recursive: true }); writeFileSync(join(target, file), text) }
  try {
    put("src/value.ts", wrapped)
    put("src/plain.ts", "export const k = 1\n")
    put("package.json", JSON.stringify({ type: "module", ...(privateCompanions ? { exports: { "./*": "./src/*.ts" } } : {}) }))
    put(".gitignore", "node_modules/\n")
    put("tsconfig.json", '{"compilerOptions":{"noEmit":true,"allowImportingTsExtensions":true},"include":["src/**/*"]}')
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "original sources")
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(ts, join(target, "node_modules/typescript"))
    writeProbeAwareCompiler(join(target, "node_modules/.bin/vibelang"), fakeCompiler, { mode: 0o755 })
    writeJson(paths(run).config, { ...makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }), platformModuleBodies: privateCompanions })
    writeJson(paths(run).setup, {})
    writeJson(paths(run).plan, { ...(mode === "one-pass" ? { mode } : {}), batches: [{ files: ["src/value.ts", "src/plain.ts"] }] })
    const result = await codemod({ run })
    const privateExports = { manifest: "package.json", keys: ["./value.platform"] }
    assert.deepEqual(result.platform.companions, [{ file: "src/value.ts", companion: "src/value.platform.ts",
      ...(privateCompanions ? { privateExports } : {}) }])
    if (privateCompanions) {
      assert.equal(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).exports["./value.platform"], null)
      const journal = JSON.parse(readFileSync(mode === "one-pass" ? paths(run).codemod("01") : paths(run).codemodState("01"), "utf8"))
      assert.ok(journal.exportEdits.some(edit => edit.privateCompanion === "src/value.platform.ts"))
    }
    assert.ok(readFileSync(join(target, "src/value.platform.ts"), "utf8").startsWith(compilerCompanionMarker))
    const changed = await Jj.changedPaths(target)
    assert.deepEqual(foreignChanges(changed, { files: result.files.map(path => ({ path, planned: path.replace(/\.ts$/, ".vibe") })), codemod: result }), [])
    // A fix that stopped can leave a companion it never reported.
    put("src/plain.platform.ts", compilerCompanionMarker + "export function $platform() { return 1; }\n")
    await Jj.commit(target, "batch with companions")
    await revert({ run, batch: "01", file: "src/value.vibe", reason: "recorded companion" })
    assert.equal(readFileSync(join(target, "src/value.ts"), "utf8"), wrapped)
    assert.equal(existsSync(join(target, "src/value.platform.ts")), false)
    if (privateCompanions) assert.equal(Object.hasOwn(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).exports, "./value.platform"), false)
    await revert({ run, batch: "01", file: "src/plain.vibe", reason: "stray companion" })
    assert.equal(readFileSync(join(target, "src/plain.ts"), "utf8"), "export const k = 1\n")
    assert.equal(existsSync(join(target, "src/plain.platform.ts")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
