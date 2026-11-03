import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { addSourceChildLoaders, wireSourceChildren } from "../lib/source-children.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const policyRequire = createRequire(join(repo, ".smithers/package.json"))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-source-child-oxlint-policy.json", import.meta.url)))
const template = readFileSync(new URL("../templates/source-child.ts", import.meta.url), "utf8")
const legacy = readFileSync(new URL("../templates/source-child-legacy.ts", import.meta.url), "utf8")
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const schemaURL = pathToFileURL(require.resolve("effect/Schema")).href
const load = async text => (await import("data:text/javascript;base64," + Buffer.from(compile(text + "\nexport { __vibelangSourceChild }\n").replaceAll('"effect/Schema"', JSON.stringify(schemaURL))).toString("base64"))).__vibelangSourceChild

function policy(text) {
  const root = mkdtempSync(join(tmpdir(), "opencode-native-policy-"))
  try {
    cpSync(fileURLToPath(new URL("./fixtures/opencode-native-policy", import.meta.url)), root, { recursive: true })
    symlinkSync(join(repo, ".smithers/node_modules"), join(root, "node_modules"), "dir")
    const file = join(root, "launch.ts")
    writeFileSync(file, text)
    const cli = join(dirname(policyRequire.resolve("oxlint")), "../bin/oxlint")
    const run = spawnSync(process.execPath, [cli, "--config", join(root, "config.json"), "--format", "json", file], {
      cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 8 << 20
    })
    assert.equal(run.status, 0, run.stdout + run.stderr)
    return JSON.parse(run.stdout).diagnostics
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode: a required source launcher keeps the original runtime-typeof and spacing policy clean", () => {
  const native = corpus.source
  assert.deepEqual(policy(native), [])
  const fixed = addSourceChildLoaders(native, ts)
  assert.equal(fixed.usesChild, true)
  assert.deepEqual(fixed.refusals, [])
  assert.deepEqual(policy(fixed.text), [])
  assert.equal(addSourceChildLoaders(fixed.text, ts).text, fixed.text)
})

test("the unchanged native rules reject the old generated helper and an omitted boundary repair", () => {
  const old = legacy + "\nexport const launch = __vibelangSourceChild\n"
  const findings = policy(old)
  assert.ok(findings.some(d => d.code.includes("no-runtime-typeof")))
  assert.ok(findings.some(d => d.code.includes("require-readable-spacing")))
  const broken = template.replace("!__vibelangSchema.is(__vibelangSchema.String)(command)", 'typeof command !== "string"')
  assert.ok(policy(broken + "\nexport const launch = __vibelangSourceChild\n").some(d => d.code.includes("no-runtime-typeof")))
})

test("property: schema boundary preserves native loader results, argument identity and thrown failures", async () => {
  const before = await load(legacy), after = await load(template)
  fc.assert(fc.property(
    fc.constantFrom("node", "/bin/bun", "node.exe", "shell", 1, null, new String("node")),
    fc.array(fc.oneof(fc.constantFrom("entry.ts", "entry.vibe", "entry.js", "--", "--import", "vibelang/register", "--eval", "42"), fc.integer(), fc.constant(null)), { maxLength: 8 }),
    (command, args) => {
      const resolver = name => "file:///parent/" + name.replace("/", "-") + ".mjs"
      const a = before(command, args, resolver), b = after(command, args, resolver)
      assert.deepEqual(b, a)
      assert.equal(b[0], command)
      if (a[1] === args) assert.equal(b[1], args)
    }
  ), { seed: 880051, numRuns: 400 })
  for (const args of [null, 1, {}, { every() { throw new Error("original failure") } }]) {
    const failure = helper => { try { helper("node", args, () => "unused"); assert.fail("must throw") } catch (error) { return [error.name, error.message] } }
    assert.deepEqual(failure(after), failure(before))
  }
})

test("property: legacy policy refresh is idempotent with fresh namespace names and unrelated authored aliases", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 8 }), fc.constantFrom("probe.ts", "probe.mjs"), (count, file) => {
    const prefix = Array.from({ length: count }, (_, i) => "const __vibelangSchema" + (i ? i + 1 : "") + " = " + i + ";").join("\n")
    let source = corpus.legacy + "\n" + prefix
    if (file.endsWith(".mjs")) source = compile(source)
    const fixed = addSourceChildLoaders(source, ts, { file })
    assert.deepEqual(fixed.refusals, [])
    assert.equal(fixed.usesChild, true)
    assert.equal(addSourceChildLoaders(fixed.text, ts, { file }).text, fixed.text)
    assert.ok(!ts.createSourceFile(file, fixed.text, ts.ScriptTarget.Latest, true).parseDiagnostics.length)
    assert.ok(!fixed.text.includes('typeof command'))
  }), { seed: 880052, numRuns: 80 })
})

test("policy helpers retain native pruning and manual-observation boundaries", () => {
  const source = corpus.source.replace('["entry.ts"]', '[entry]').replace('(command: string)', '(command: string, entry: string)')
  const wired = addSourceChildLoaders(source, ts).text
  const noSource = wired.replace("(command: string, entry: string)", '(command: string, entry: "entry.js")')
  const pruned = addSourceChildLoaders(noSource, ts)
  assert.equal(pruned.usesChild, false)
  assert.ok(!pruned.text.includes("effect/Schema"))
  assert.ok(!pruned.text.includes("__vibelangSourceChild"))
  for (const observed of [
    wired + "\nexport { __vibelangSourceChild };\n",
    corpus.legacy + "\nexport { __vibelangSourceChild };\n",
    wired.replace("const values = args", "/* authored */ const values = args")
  ]) {
    const result = addSourceChildLoaders(observed, ts)
    assert.equal(result.text, observed)
    assert.ok(result.refusals.length)
  }
})

test("source-child Schema dependencies follow runtime and development ownership and the selected toolchain pin", () => {
  for (const runtime of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "opencode-child-dependency-"))
    try {
      mkdirSync(join(root, runtime ? "src" : "scripts"))
      const file = runtime ? "src/launch.ts" : "scripts/launch.ts"
      writeFileSync(join(root, file), corpus.source)
      writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", name: "fixture", scripts: { build: "node " + file } }))
      const write = (file, text) => writeFileSync(join(root, file), text)
      const options = { root, all: ["package.json", file], manifests: ["package.json"], ts, specsFor: () => ({ vibelang: "0.0.11", effect: "4.1.1" }), write }
      wireSourceChildren(options)
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")), field = runtime ? "dependencies" : "devDependencies"
      assert.equal(pkg[field].effect, "4.1.1")
      assert.equal(pkg[field].vibelang, "0.0.11")
      const once = readFileSync(join(root, file), "utf8")
      wireSourceChildren(options)
      assert.equal(readFileSync(join(root, file), "utf8"), once)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test("an archived migration flow loads without checkout packages or a runtime manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-archived-flow-"))
  try {
    const flow = join(root, ".smithers/flows/migrate")
    mkdirSync(flow, { recursive: true })
    cpSync(join(repo, ".smithers/flows/migrate/lib"), join(flow, "lib"), { recursive: true })
    cpSync(join(repo, ".smithers/flows/migrate/templates"), join(flow, "templates"), { recursive: true })
    const detached = await import(pathToFileURL(join(flow, "lib/source-children.mjs")).href)
    const result = detached.addSourceChildLoaders(corpus.source, ts)
    assert.equal(result.usesChild, true)
    assert.deepEqual(result.refusals, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("an unavailable Effect pin keeps the native launcher with a located setup warning", () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-missing-effect-pin-"))
  try {
    mkdirSync(join(root, "scripts"))
    const file = "scripts/launch.ts"
    writeFileSync(join(root, file), corpus.source)
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", scripts: { build: "node " + file } }))
    const result = wireSourceChildren({
      root, all: ["package.json", file], manifests: ["package.json"], ts,
      specsFor: () => ({ vibelang: "0.0.11" }),
      write: (file, text) => writeFileSync(join(root, file), text)
    })
    assert.equal(readFileSync(join(root, file), "utf8"), corpus.source)
    assert.ok(result.warnings.some(warning => warning.includes(file + ":1:") && warning.includes("Effect pin")))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("property: detached package setup uses selected or declared pins and never guesses a dependency", () => {
  fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.boolean(), fc.constantFrom("4.1.1", "catalog:effect"), (runtime, selected, declared, rootPin) => {
    const root = mkdtempSync(join(tmpdir(), "opencode-child-pin-property-"))
    try {
      const directory = "packages/a", file = directory + (runtime ? "/src/launch.ts" : "/scripts/launch.ts")
      mkdirSync(join(root, dirname(file)), { recursive: true })
      writeFileSync(join(root, file), corpus.source)
      writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, ...(declared ? { dependencies: { effect: rootPin } } : {}) }))
      writeFileSync(join(root, directory, "package.json"), JSON.stringify({
        type: "module", name: "fixture-a", scripts: { build: "node " + file.slice(directory.length + 1) }
      }))
      const result = wireSourceChildren({
        root, all: ["package.json", directory + "/package.json", file], manifests: ["package.json", directory + "/package.json"], ts,
        specsFor: () => ({ vibelang: "0.0.11", ...(selected ? { effect: "4.1.1" } : {}) }),
        write: (file, text) => writeFileSync(join(root, file), text)
      })
      const text = readFileSync(join(root, file), "utf8")
      const pkg = JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8"))
      if (!selected && !declared) {
        assert.equal(text, corpus.source)
        assert.ok(result.warnings.some(w => w.includes("Effect pin")))
        assert.equal(pkg.dependencies, undefined)
        assert.equal(pkg.devDependencies, undefined)
      } else {
        assert.ok(text.includes('"effect/Schema"'))
        assert.deepEqual(result.warnings, [])
        const field = runtime ? "dependencies" : "devDependencies"
        assert.equal(pkg[field].effect, selected ? "4.1.1" : rootPin)
        assert.equal(pkg[field].vibelang, "0.0.11")
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 880053, numRuns: 80 })
})
