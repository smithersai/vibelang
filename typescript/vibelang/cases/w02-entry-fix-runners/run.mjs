// run-seconds: 180
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `node` | `NodeRuntime.runMain` from `@effect/platform-node/NodeRuntime` | `NodeServices.layer` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `bun` | The same Node runner | `BunServices.layer` from `@effect/platform-bun/BunServices` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `browser` | `BrowserRuntime.runMain` from `@effect/platform-browser/BrowserRuntime` | `BrowserServices.layer` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Use a listed service layer only when the pinned legacy compiler selected it; preserve selected experimental layers and nesting order.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | A marker does not by itself add a layer.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Pass `main()` for an Effect function, otherwise `Effect.sync(main)`, retaining the declaration's callable kind and public types.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | CommonJS does not justify retaining the retired dispatcher; ESM cannot introduce `import.meta.main`.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Preserve entry-only execution and import-only behavior.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Refuse an unavailable runner or layer, an entry test not expressible in admitted source, or any other loss of types, behavior or declarations: keep the marker and report its file, line and reason as not fixed, with a nonzero exit.
// Why this oracle refuses: the legacy compiler started main only when the
// host started the module, never when another module imported it. A runner
// call written into the module runs on import too, and no admitted source can
// test which module the host started (import.meta.main is excluded, and the
// legacy dispatcher's test also matched bundles), so every ESM and CommonJS
// startup here refuses. The refusal still names the runner, its argument and
// the legacy-selected layers from the table above; written by the program's
// owner where the program starts, that advice compiles, keeps main's
// declaration and public types, and runs main as the legacy entry did.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { refusal, following, importer } from "../../tests/entry-migration.mjs"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const here = fileURLToPath(new URL(".", import.meta.url))
const input = (name) => readFileSync(join(here, "inputs", `${name}.txt`), "utf8")
const compilerOptions = { target: "es2022", lib: ["esnext", "dom"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out", declaration: true, rewriteRelativeImportExtensions: true }
const tsc = (root, args) => spawnSync(binary, [...args, "-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 120000 })
const message = "legacy platform entry marker: run vibelang --fix and write an explicit runner"
const mainLine = (source) => source.split("\n").find((line) => /function main\(/.test(line))

// project writes the named inputs into a fresh project, compiles it once to
// record main's declarations, and runs vibelang --fix, which refuses every
// eligible startup. It returns each module's refusal advice and a way to
// start or import an emitted module.
function project(prefix, packageType, names) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  symlinkSync(join(here, "node_modules"), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: packageType }) + "\n")
  mkdirSync(join(root, "data"))
  writeFileSync(join(root, "data", "config.json"), "{}\n")
  const files = []
  for (const name of names) {
    const file = name === "say" ? "say.ts" : `${name}.vibe`
    writeFileSync(join(root, file), input(name))
    files.push(file)
  }
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions, files }))
  const marked = names.filter((name) => name !== "say")
  const legacy = tsc(root, [])
  const declarations = {}
  for (const name of marked) {
    assert.ok(legacy.stdout.split("\n").includes(`${name}.vibe(1,8): error EK2601: ${message}`), `${name}: the marker reports EK2601\n${legacy.stdout}`)
    declarations[name] = readFileSync(join(root, "out", `${name}.d.ts`), "utf8")
  }
  const run = (args) => spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 60000 })
  for (const name of marked) {
    // The marked module itself starts nothing, started or imported: the
    // compiler keeps no implicit startup.
    const js = readFileSync(join(root, "out", `${name}.js`), "utf8")
    assert.doesNotMatch(js, /\$entry|\$runMain|import\.meta\.main|vibelang\/platform/, `${name}.js keeps no retired dispatcher:\n${js}`)
    assert.equal(run([join(root, "out", `${name}.js`)]).stdout, "", `${name}: a marked module starts nothing`)
  }
  rmSync(join(root, "out"), { recursive: true, force: true })
  const fixed = tsc(root, ["--fix"])
  const report = fixed.stdout + fixed.stderr
  assert.notEqual(fixed.status, 0, `a refused startup fails --fix\n${report}`)
  const advice = {}
  for (const name of marked) {
    assert.equal(readFileSync(join(root, `${name}.vibe`), "utf8"), input(name), `${name}: a refused startup keeps its source`)
    advice[name] = refusal(report, `${name}.vibe`, 1)
    assert.ok(advice[name]?.runner, `${name}: the refusal names its file, the marker's line, and the runner\n${report}`)
    assert.doesNotMatch(advice[name].line, /import\.meta\.main|\$entry|\$runMain/, advice[name].line)
  }
  // The owner writes each advised runner where the program starts: here, in
  // the module itself, which the test only ever starts.
  for (const name of marked) writeFileSync(join(root, `${name}.vibe`), following(input(name), advice[name]))
  const compiled = tsc(root, [])
  assert.equal(compiled.status, 0, `the advised source compiles cleanly\n${compiled.stdout}${compiled.stderr}`)
  for (const name of marked) {
    const text = readFileSync(join(root, `${name}.vibe`), "utf8")
    assert.equal(mainLine(text), mainLine(input(name)), `${name}: main keeps its callable kind`)
    assert.equal(readFileSync(join(root, "out", `${name}.d.ts`), "utf8"), declarations[name], `${name}: main keeps its public types`)
  }
  const start = (name) => {
    const started = run([join(root, "out", `${name}.js`)])
    assert.equal(started.status, 0, `${name}.js\n${started.stdout}${started.stderr}`)
    return started.stdout
  }
  return { root, advice, start }
}

const esm = project("entry-fix-runners-", "module", ["node-effect", "node-plain", "say", "node-services", "node-experimental", "bun-effect", "bun-services", "browser"])
try {
  const { advice, start } = esm
  let { imports, runner } = advice["node-effect"]
  assert.deepEqual(imports, ['import * as NodeRuntime from "@effect/platform-node/NodeRuntime"'])
  assert.equal(runner, "NodeRuntime.runMain(main())", "a main that needs no service gets no layer")
  assert.equal(start("node-effect"), "node effect main ran\n")

  assert.equal(advice["node-plain"].runner, "NodeRuntime.runMain(Effect.sync(main))")
  assert.equal(start("node-plain"), "node plain main ran\n")

  ;({ imports, runner } = advice["node-services"])
  assert.ok(imports.includes('import * as NodeServices from "@effect/platform-node/NodeServices"'), imports.join("\n"))
  assert.equal(runner, "NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))")
  assert.equal(start("node-services"), "node services true\n")

  ;({ imports, runner } = advice["node-experimental"])
  assert.match(runner, /ExperimentalNodeServices\.layer/, runner)
  assert.doesNotMatch(runner, /(?<!Experimental)NodeServices\.layer/, `the legacy compiler nested no Effect bundle outside the experimental one: ${runner}`)
  assert.equal(start("node-experimental"), "node experimental true true\n")

  ;({ imports, runner } = advice["bun-effect"])
  assert.deepEqual(imports, ['import * as NodeRuntime from "@effect/platform-node/NodeRuntime"'], "bun uses the Node runner")
  assert.equal(runner, "NodeRuntime.runMain(main())", "the bun marker does not by itself add BunServices.layer")
  assert.equal(start("bun-effect"), "bun effect main ran\n")

  ;({ imports, runner } = advice["bun-services"])
  assert.ok(imports.includes('import * as NodeRuntime from "@effect/platform-node/NodeRuntime"'), "bun uses the Node runner")
  assert.ok(imports.includes('import * as BunServices from "@effect/platform-bun/BunServices"'), imports.join("\n"))
  assert.equal(runner, "NodeRuntime.runMain(Effect.provide(main(), BunServices.layer))")
  assert.equal(start("bun-services"), "data/config.json read through BunServices.layer\n")

  ;({ imports, runner } = advice.browser)
  assert.deepEqual(imports, ['import * as BrowserRuntime from "@effect/platform-browser/BrowserRuntime"'])
  assert.equal(runner, "BrowserRuntime.runMain(main())", "the browser runner, and no layer main does not need")
} finally {
  rmSync(esm.root, { recursive: true, force: true })
}

const cjs = project("entry-fix-runners-cjs-", "commonjs", ["commonjs"])
try {
  assert.equal(cjs.advice.commonjs.runner, "NodeRuntime.runMain(main())")
  assert.equal(cjs.start("commonjs"), "commonjs main ran\n")
} finally {
  rmSync(cjs.root, { recursive: true, force: true })
}
console.log("eligible startups refuse and name the explicit runner with the legacy-selected layers")
