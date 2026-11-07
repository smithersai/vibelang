// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | `vibelang --fix` removes the marker and expands eligible startup as follows:
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `node` | `NodeRuntime.runMain` from `@effect/platform-node/NodeRuntime` | `NodeServices.layer` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `bun` | The same Node runner | `BunServices.layer` from `@effect/platform-bun/BunServices` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `browser` | `BrowserRuntime.runMain` from `@effect/platform-browser/BrowserRuntime` | `BrowserServices.layer` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Use a listed service layer only when the pinned legacy compiler selected it; preserve selected experimental layers and nesting order.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | A marker does not by itself add a layer.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Pass `main()` for an Effect function, otherwise `Effect.sync(main)`, retaining the declaration's callable kind and public types.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | CommonJS does not justify retaining the retired dispatcher; ESM cannot introduce `import.meta.main`.
// vibelang --fix on marked modules with eligible startups: each marker is
// removed, the selected runner is imported and called with main() or
// Effect.sync(main), the legacy-selected layer (and only it) is provided,
// main's declaration text and emitted declaration are unchanged, the result
// compiles cleanly, holds no dispatcher or import.meta.main, and starting it
// runs main as the legacy entry did.
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
const marker = /import\s*["']vibelang\/platform\/\w+["']/
const imports = (source, name, module) => new RegExp(`import\\s*\\*\\s*as\\s+${name}\\s+from\\s*["']${module.replace(/\//g, "\\/")}["']`).test(source)
const mainLine = (source) => source.split("\n").find((line) => /function main\(/.test(line))

// project writes the named inputs into a fresh project, compiles it once to
// record the legacy declarations, and runs vibelang --fix.
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
  tsc(root, [])
  const declarations = {}
  for (const name of names) {
    const dts = join(root, "out", `${name}.d.ts`)
    if (name !== "say" && existsSync(dts)) declarations[name] = readFileSync(dts, "utf8")
  }
  rmSync(join(root, "out"), { recursive: true, force: true })
  const fixed = tsc(root, ["--fix"])
  assert.equal(fixed.status, 0, `--fix migrates every eligible startup\n${fixed.stdout}${fixed.stderr}`)
  const compiled = tsc(root, [])
  assert.equal(compiled.status, 0, `the migrated project compiles cleanly\n${compiled.stdout}${compiled.stderr}`)
  assert.doesNotMatch(compiled.stdout, /: error /, compiled.stdout)
  const source = (name) => readFileSync(join(root, `${name}.vibe`), "utf8")
  for (const name of names.filter((name) => name !== "say")) {
    const text = source(name)
    assert.doesNotMatch(text, marker, `${name}: the marker is removed`)
    assert.doesNotMatch(text, /import\.meta\.main/, `${name}: the rewrite introduces no import.meta.main`)
    assert.equal(mainLine(text), mainLine(input(name)), `${name}: main keeps its callable kind`)
    assert.equal(readFileSync(join(root, "out", `${name}.d.ts`), "utf8"), declarations[name], `${name}: main keeps its public types`)
    const js = readFileSync(join(root, "out", `${name}.js`), "utf8")
    assert.doesNotMatch(js, /\$entry|\$runMain|import\.meta\.main/, `${name}.js keeps no retired dispatcher:\n${js}`)
  }
  const start = (name) => {
    const started = spawnSync(process.execPath, [join(root, "out", `${name}.js`)], { cwd: root, encoding: "utf8", timeout: 60000 })
    assert.equal(started.status, 0, `${name}.js\n${started.stdout}${started.stderr}`)
    return started.stdout
  }
  return { root, source, start }
}

const esm = project("entry-fix-runners-", "module", ["node-effect", "node-plain", "say", "node-services", "node-experimental", "bun-effect", "bun-services", "browser"])
try {
  const { source, start } = esm
  let text = source("node-effect")
  assert.ok(imports(text, "NodeRuntime", "@effect/platform-node/NodeRuntime"), text)
  assert.match(text, /NodeRuntime\.runMain\(main\(\)\)/, text)
  assert.doesNotMatch(text, /Services/, `a main that needs no service gets no layer:\n${text}`)
  assert.equal(start("node-effect"), "node effect main ran\n")

  text = source("node-plain")
  assert.ok(imports(text, "NodeRuntime", "@effect/platform-node/NodeRuntime"), text)
  assert.match(text, /NodeRuntime\.runMain\(Effect\.sync\(main\)\)/, text)
  assert.equal(start("node-plain"), "node plain main ran\n")

  text = source("node-services")
  assert.match(text, /NodeRuntime\.runMain\(/, text)
  assert.match(text, /\bNodeServices\.layer\b/, text)
  assert.doesNotMatch(text, /Experimental/, `only the layer the legacy compiler selected:\n${text}`)
  assert.equal(start("node-services"), "node services true\n")

  text = source("node-experimental")
  assert.match(text, /NodeRuntime\.runMain\(/, text)
  assert.match(text, /ExperimentalNodeServices\.layer/, text)
  assert.doesNotMatch(text, /(?<!Experimental)NodeServices\.layer/, `the legacy compiler nested no Effect bundle outside the experimental one:\n${text}`)
  assert.equal(start("node-experimental"), "node experimental true true\n")

  text = source("bun-effect")
  assert.ok(imports(text, "NodeRuntime", "@effect/platform-node/NodeRuntime"), `bun uses the Node runner:\n${text}`)
  assert.match(text, /NodeRuntime\.runMain\(main\(\)\)/, text)
  assert.doesNotMatch(text, /BunServices/, `the bun marker does not by itself add BunServices.layer:\n${text}`)
  assert.equal(start("bun-effect"), "bun effect main ran\n")

  text = source("bun-services")
  assert.ok(imports(text, "NodeRuntime", "@effect/platform-node/NodeRuntime"), `bun uses the Node runner:\n${text}`)
  assert.ok(imports(text, "BunServices", "@effect/platform-bun/BunServices"), text)
  assert.match(text, /BunServices\.layer/, text)
  assert.equal(start("bun-services"), "data/config.json read through BunServices.layer\n")

  text = source("browser")
  assert.ok(imports(text, "BrowserRuntime", "@effect/platform-browser/BrowserRuntime"), text)
  assert.match(text, /BrowserRuntime\.runMain\(main\(\)\)/, text)
  assert.doesNotMatch(text, /NodeRuntime|BrowserServices/, `the browser runner, and no layer main does not need:\n${text}`)
} finally {
  rmSync(esm.root, { recursive: true, force: true })
}

const cjs = project("entry-fix-runners-cjs-", "commonjs", ["commonjs"])
try {
  const text = cjs.source("commonjs")
  assert.ok(imports(text, "NodeRuntime", "@effect/platform-node/NodeRuntime"), text)
  assert.match(text, /NodeRuntime\.runMain\(main\(\)\)/, text)
  assert.equal(cjs.start("commonjs"), "commonjs main ran\n")
} finally {
  rmSync(cjs.root, { recursive: true, force: true })
}
console.log("eligible startups migrate to explicit runners with the legacy-selected layers")
