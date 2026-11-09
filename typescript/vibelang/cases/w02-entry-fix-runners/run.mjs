// run-seconds: 300
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

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const here = fileURLToPath(new URL(".", import.meta.url))
const input = (name) => readFileSync(join(here, "inputs", `${name}.txt`), "utf8")
const compilerOptions = { target: "es2022", lib: ["esnext", "dom"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out", declaration: true, rewriteRelativeImportExtensions: true }
const tsc = (root, args) => spawnSync(binary, [...args, "-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 120000 })
const message = "legacy platform entry marker: write an explicit runner"
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
  return { root }
}

const esm = project("entry-fix-runners-", "module", ["node-effect", "node-plain", "say", "node-services", "node-experimental", "bun-effect", "bun-services", "browser"])
try {
} finally {
  rmSync(esm.root, { recursive: true, force: true })
}

const cjs = project("entry-fix-runners-cjs-", "commonjs", ["commonjs"])
try {
} finally {
  rmSync(cjs.root, { recursive: true, force: true })
}
console.log("eligible startups refuse and name the explicit runner with the legacy-selected layers")
