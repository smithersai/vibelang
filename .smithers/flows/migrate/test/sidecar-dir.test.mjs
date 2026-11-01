// Decided detail 268: setup turns vibe.sidecarDir on where tracked code
// enumerates *.ts files in a folder that holds or will hold .vibe files, as
// Smithers' .smithers/flows/test/coding-stable-plan.test.ts:57 does, and
// records why; the plan keeps the .ts modules such code enumerates as .ts.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { addSidecarDir, describe, relevantEnumerations, sidecarDirectory, tsEnumerations } from "../lib/enumerations.mjs"
import { candidates, validatePlan } from "../lib/plan.mjs"
import { restoreExports, rewriteExports } from "../lib/codemod.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const repo = fileURLToPath(new URL("../../../../", import.meta.url))

// Smithers' selector, verbatim from test/coding-stable-plan.test.ts:52-79.
const smithersTest = `import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

const sources = (directory: string): Array<string> =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path)
    return path.endsWith(".ts") && !path.endsWith(".d.ts") && !path.endsWith(".test.ts") ? [path] : []
  })

test("every coding step flow builds with stable callbacks", async () => {
  const root = new URL("../coding/", import.meta.url).pathname
  for (const file of sources(root)) await import(file)
})
`
const scan = (files) => tsEnumerations(Object.keys(files), (path) => files[path])

test("Smithers' readdir walk with a .ts filter enumerates the folder its URL names", () => {
  const found = scan({ ".smithers/flows/test/coding-stable-plan.test.ts": smithersTest })
  assert.equal(found.length, 1)
  assert.deepEqual({ ...found[0], match: undefined }, { file: ".smithers/flows/test/coding-stable-plan.test.ts", line: 9, kind: "walk", directory: ".smithers/flows/coding", match: undefined })
  assert.equal(describe(found[0]), ".smithers/flows/test/coding-stable-plan.test.ts:9 enumerates *.ts files under .smithers/flows/coding/ (a walk filtered by .endsWith(\".ts\"))")
})

test("globs whose last segment is *.ts enumerate their literal prefix", () => {
  const found = scan({
    "package.json": JSON.stringify({ scripts: { test: "node --test 'src/**/*.ts'" } }),
    "scripts/load.mjs": "import { globSync } from \"node:fs\"\nfor (const f of globSync(\"./lib/*.{ts,tsx}\")) await import(f)\n",
    "vitest.config.ts": "export default { test: { include: [\"test/**/*.ts\"] } }\n"
  })
  assert.deepEqual(found.map((f) => [f.file, f.kind, f.directory]), [
    ["package.json", "glob", "src"],
    ["scripts/load.mjs", "glob", "scripts/lib"],
    ["vitest.config.ts", "glob", "test"]
  ])
})

test("selectors that cannot select x.d.vibe.ts, or already know .vibe, are not enumerations", () => {
  assert.deepEqual(scan({
    "a.test.ts": "const tests = globSync(\"src/**/*.test.ts\")\n",
    "b.ts": "const types = globSync(\"src/**/*.d.ts\")\n",
    "c.ts": "readdirSync(dir).filter((n) => n.endsWith(\".ts\") && !n.endsWith(\".d.vibe.ts\"))\n",
    "d.ts": "readdirSync(dir).filter((n) => n.endsWith(\".ts\") || n.endsWith(\".vibe\"))\n",
    "e.ts": "export const isTs = (n: string) => n.endsWith(\".ts\")\n",
    "f.ts": "readdirSync(dir).filter((n) => n.endsWith(\".json\"))\n",
    "types.d.ts": "declare const g: \"**/*.ts\"\n"
  }), [])
})

// Metamorphic over spellings: a filter on ".ts" inside a walk is an
// enumeration exactly when the code does not also name .vibe files.
test("property: a .ts filter in a walk is found unless the code names .vibe", () => {
  const filters = [`n.endsWith(".ts")`, `n.endsWith('.ts')`, `/\\.ts$/.test(n)`, `extname(n) === ".ts"`, `/\\.(?:ts|tsx)$/.test(n)`]
  const walks = ["readdirSync(dir)", "await readdir(dir)", "globSync(dir + \"/*\")", "walk(dir)"]
  const aware = ["", `n.endsWith(".vibe")`, `!n.endsWith(".d.vibe.ts")`]
  fc.assert(fc.property(fc.constantFrom(...filters), fc.constantFrom(...walks), fc.constantFrom(...aware), fc.constantFrom("", "\n// unrelated\n"), (filter, walk, vibe, padding) => {
    const text = `${padding}const names = ${walk}\nexport const sources = names.filter((n) => ${filter}${vibe ? " || " + vibe : ""})\n`
    const found = scan({ "pkg/load.ts": text })
    assert.equal(found.length, vibe ? 0 : 1, text)
    if (!vibe) assert.equal(found[0].line, padding ? 4 : 2)
  }), { numRuns: 200 })
})

test("only a folder that holds an Effect module or a .vibe file needs the setting", () => {
  const files = {
    "test/load.test.ts": smithersTest,
    "coding/plain.ts": "export const plain = 1\n",
    "other/uses.ts": "import { Effect } from \"effect\"\nexport const e = Effect.void\n"
  }
  const read = (path) => files[path]
  const found = scan(files)
  assert.deepEqual(relevantEnumerations(found, Object.keys(files), read), [])
  files["coding/step.ts"] = "import { Effect } from \"effect\"\nexport const step = Effect.void\n"
  assert.equal(relevantEnumerations(found, Object.keys(files), read).length, 1)
  delete files["coding/step.ts"]
  files["coding/step.vibe"] = "export const step = 1\n"
  assert.equal(relevantEnumerations(found, Object.keys(files), read).length, 1)
})

test("addSidecarDir turns the setting on and adds rootDirs, keeping comments, idempotently", () => {
  for (const [before, rootDirs] of [
    ["{}\n", [".", sidecarDirectory]],
    ["{\n  // keep\n  \"compilerOptions\": {\n    \"strict\": true\n  },\n  \"include\": [\"src\"]\n}\n", [".", sidecarDirectory]],
    ["{ \"compilerOptions\": { \"rootDirs\": [\"src\", \"generated\"] } }", ["src", "generated", ".", sidecarDirectory]],
    ["{ \"compilerOptions\": { \"rootDirs\": [] }, \"vibe\": { \"effectGlobals\": false } }", [".", sidecarDirectory]]
  ]) {
    const after = addSidecarDir(before, ts)
    const { config, error } = ts.parseConfigFileTextToJson("tsconfig.json", after)
    assert.equal(error, undefined, after)
    assert.deepEqual(config.compilerOptions.rootDirs, rootDirs, after)
    assert.equal(config.vibe.sidecarDir, sidecarDirectory)
    if (before.includes("effectGlobals")) assert.equal(config.vibe.effectGlobals, false)
    if (before.includes("// keep")) assert.match(after, /\/\/ keep/)
    assert.equal(addSidecarDir(after, ts), after)
  }
})

test("the plan keeps a module an enumeration lists as .ts, with the reason", () => {
  const file = (path, extra = {}) => ({ path, package: ".", test: false, lines: 10, tokens: 50, effect: "values", effectImports: ["effect"], imports: [], dependents: [], testedBy: [], coverage: null, ...extra })
  const reason = "test/load.test.ts:9 enumerates *.ts files under coding/ (a walk filtered by .endsWith(\".ts\"))"
  const inventory = { packages: ["."], summary: {}, files: [file("coding/step.ts", { enumeratedBy: [reason] }), file("src/free.ts")] }
  assert.deepEqual(candidates(inventory).map((f) => f.path), ["src/free.ts"])
  const { errors } = validatePlan({ batches: [{ files: ["coding/step.ts"], reason: "x" }] }, inventory)
  assert.deepEqual(errors, [`batch 1: coding/step.ts stays .ts: ${reason}, and would no longer select it as coding/step.vibe`])
})

// The Smithers-shaped fixture on a built compiler: a folder holds a .ts
// module and .vibe modules, and a test imports every *.ts but *.d.ts in it.
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const missing = [native, effect].find((path) => !existsSync(path))
test("a Smithers-shaped test that imports every *.ts but *.d.ts passes with the setting setup writes", { skip: missing && `build the compiler first; missing ${missing}` }, (t) => {
  const run = (setting) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "migrate-sidecar-dir-")))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const files = {
      "package.json": "{\"type\":\"module\"}\n",
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, noEmit: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true }, include: ["coding"] }, null, 2) + "\n",
      "coding/plain.ts": 'import { Effect } from "effect"\nexport const plain = Effect.runSync(Effect.succeed(1))\n',
      "coding/helper.vibe": "export const helper = 2\n",
      "coding/metered.vibe": "export { helper } from \"./helper.vibe\"\n",
      "test/stable.test.ts": smithersTest.replace("for (const file of sources(root)) await import(file)", "const found = sources(root).map((file) => file.slice(root.length))\n  for (const file of sources(root)) { const loaded = await import(file); if (file.endsWith(\"/plain.ts\") && loaded.plain !== 1) throw new Error(\"implementation changed\") }\n  if (found.join() !== \"plain.ts\") throw new Error(\"selected \" + found.join())")
    }
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), text)
    }
    mkdirSync(join(root, "node_modules"))
    symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
    const found = relevantEnumerations(scan(files), Object.keys(files), (path) => files[path])
    assert.equal(found.length, 1)
    if (setting) writeFileSync(join(root, "tsconfig.json"), addSidecarDir(files["tsconfig.json"], ts))
    // The unchanged selector must execute the same concrete implementation
    // before any sidecars are emitted and after setup relocates them.
    const { NODE_TEST_CONTEXT: baselineContext, ...baselineEnv } = process.env
    const baseline = spawnSync(process.execPath, ["--test", "test/stable.test.ts"], { cwd: root, encoding: "utf8", env: baselineEnv })
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
    const compiled = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
    assert.equal(existsSync(join(root, "coding/metered.d.vibe.ts")), !setting)
    assert.equal(existsSync(join(root, sidecarDirectory, "coding/metered.d.vibe.ts")), setting)
    // A child test run reports to this one through NODE_TEST_CONTEXT; it runs on its own.
    const { NODE_TEST_CONTEXT, ...env } = process.env
    return spawnSync(process.execPath, ["--test", "test/stable.test.ts"], { cwd: root, encoding: "utf8", env })
  }
  const beside = run(false)
  assert.notEqual(beside.status, 0, "beside the sources, the test imports the sidecar:\n" + beside.stdout)
  assert.match(beside.stdout, /\.d\.vibe\.ts|ERR_UNKNOWN_FILE_EXTENSION/)
  const moved = run(true)
  assert.equal(moved.status, 0, moved.stdout + moved.stderr)
})

// A package whose tsconfig sets vibe.sidecarDir has no x.d.vibe.ts beside x.vibe:
// its types field and condition name the mirrored sidecar, and revert takes it back.
test("the codemod points a package's types at the sidecar under its vibe.sidecarDir", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-sidecar-exports-"))
  try {
    const before = { name: "p", types: "./src/x.ts", exports: { ".": { types: "./src/x.ts", import: "./src/x.ts" }, "./y": "./src/x.ts" } }
    writeFileSync(join(root, "package.json"), JSON.stringify(before, null, 2) + "\n")
    writeFileSync(join(root, "tsconfig.json"), addSidecarDir("{ \"include\": [\"src\"] }\n", ts))
    const edits = rewriteExports(root, [{ from: "src/x.ts", to: "src/x.vibe" }])
    const after = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    assert.equal(after.types, "./.vibe/declarations/src/x.d.vibe.ts")
    assert.deepEqual(after.exports["."], { types: "./.vibe/declarations/src/x.d.vibe.ts", import: { "vibelang-source": "./src/x.vibe", default: "./.vibelang/js/src/x.js" } })
    assert.deepEqual(after.exports["./y"], { types: "./.vibe/declarations/src/x.d.vibe.ts", "vibelang-source": "./src/x.vibe", default: "./.vibelang/js/src/x.js" })
    restoreExports(root, edits, "src/x.ts")
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("setup and exports honor the existing effective sidecar path, including inheritance and configDir", t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sidecar-config-inheritance-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  for (const value of ["../types", "${configDir}/types"]) {
    put("lib/config/base.json", JSON.stringify({ vibe: { sidecarDir: value } }))
    const file = join(root, "lib/tsconfig.json")
    const before = JSON.stringify({ extends: "./config/base.json", compilerOptions: { rootDirs: ["src"] }, include: ["src"] })
    put("lib/tsconfig.json", before)
    const after = addSidecarDir(before, ts, sidecarDirectory, file)
    const json = ts.parseConfigFileTextToJson(file, after).config
    assert.deepEqual(json.compilerOptions.rootDirs, ["src", ".", "types"], after)
    assert.equal(json.vibe?.sidecarDir, undefined, "setup must not replace an inherited sidecar path")
    put("lib/tsconfig.json", after)
    put("lib/package.json", '{"name":"p","types":"./src/x.ts"}')
    rewriteExports(root, [{ from: "lib/src/x.ts", to: "lib/src/x.vibe" }])
    assert.equal(JSON.parse(readFileSync(join(root, "lib/package.json"), "utf8")).types, "./types/src/x.d.vibe.ts")
  }
})

test("ast-grep TypeScript rule selectors enable directory mode before per-tool ignores are added", () => {
  for (const selector of ['files:\n  - "src/**/*.ts"\n', "files:\n  - src/**/*.ts\n", ""]) {
    const files = {
      "package.json": "{}",
      "sgconfig.yml": "ruleDirs:\n  - rules\n",
      "rules/aliases.yml": "id: inspect-alias\nlanguage: TypeScript\n" + selector + "rule:\n  kind: type_alias_declaration\n",
      "src/item.vibe": "export type Item = string\n"
    }
    const found = relevantEnumerations(scan(files), Object.keys(files), path => files[path])
    assert.ok(found.some(finding => finding.file === "rules/aliases.yml"), selector)
  }
})

test("a plain unquoted package-script ts glob enables directory mode", () => {
  const found = scan({ "package.json": JSON.stringify({ scripts: { test: "node --test src/**/*.ts" } }) })
  assert.ok(found.some(finding => finding.directory === "src"))
})

test("property: tool selectors retain their directory across glob and quoting spellings", () => {
  fc.assert(fc.property(fc.constantFrom("src", "deep/lib", "packages/core/src"), fc.constantFrom("", "'", '"'), fc.constantFrom("ts", "typescript", "tsx"), fc.boolean(), (directory, quote, language, flow) => {
    const glob = directory + "/**/*.ts"
    const yaml = "id: inspect\nlanguage: " + language + "\nfiles:" + (flow ? " [" + quote + glob + quote + "]\n" : "\n  - " + quote + glob + quote + "\n") + "rule:\n  kind: type_alias_declaration\n"
    const found = scan({
      "package.json": JSON.stringify({ scripts: { test: "node --test " + quote + glob + quote } }),
      "sgconfig.yml": "ruleDirs:\n  - rules\n",
      "rules/rule.yml": yaml
    })
    assert.deepEqual(found.map(finding => [finding.file, finding.directory]).sort(), [["package.json", directory], ["rules/rule.yml", directory]])
    assert.deepEqual(scan({ "rules/data.yml": yaml.replace("language: " + language, "language: json") }), [])
  }), { seed: 268034, numRuns: 120 })
})
