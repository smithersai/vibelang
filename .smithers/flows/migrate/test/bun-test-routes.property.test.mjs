import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { wireBunTests } from "../lib/wire.mjs"

// bun test reads only [test]'s preload (Bun 1.4.2 and 1.4.4), so a package
// whose tests run under Bun by any route needs vibelang/bun there. Without
// it Bun loads x.vibe as a file asset: a self-namespace re-export reports
// "Export named 'X' not found" and an extensionless import of x.vibe
// "Cannot find module" (opencode packages/core, loaderns-opencode).
//
// Each case wires a package, then runs its tests with real Bun, against a
// .ts twin that keeps the native bunfig. vibelang/bun is a stand-in for the
// loader: it records that it ran, loads .vibe as TypeScript, and points an
// extensionless import at x.vibe, so only the wiring decides the outcome.
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-bun-test-preload-via-program.json", import.meta.url), "utf8"))

const standIn = `import { existsSync, readFileSync, appendFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
appendFileSync(process.env.STAND_IN_LOG, "loaded\\n")
Bun.plugin({ name: "vibelang-stand-in", setup(build) {
  build.onLoad({ filter: /\\.vibe$/ }, ({ path }) => ({ contents: readFileSync(path, "utf8"), loader: "ts" }))
  build.onLoad({ filter: /\\.test\\.ts$/ }, ({ path }) => ({ loader: "ts", contents: readFileSync(path, "utf8").replace(/(["'])(\\.\\.?\\/[^"'.]+)\\1/g,
    (m, q, s) => existsSync(resolve(dirname(path), s + ".vibe")) ? q + s + ".vibe" + q : m) }))
} })
`

const bun = (args, cwd, log) => spawnSync("bun", args, { cwd, encoding: "utf8", timeout: 60000, env: { ...process.env, STAND_IN_LOG: log, NO_COLOR: "1" } })

function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-bun-test-route-"))
  const put = (name, text) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text) }
  put("package.json", JSON.stringify({ name: "w", private: true, type: "module", workspaces: ["packages/*"] }))
  put("node_modules/vibelang/package.json", JSON.stringify({ name: "vibelang", type: "module", exports: { "./bun": "./bun.mjs" } }))
  put("node_modules/vibelang/bun.mjs", standIn)
  for (const [name, text] of Object.entries(files)) put(name, text)
  return { root, put, read: (name) => readFileSync(join(root, name), "utf8") }
}

// Runs the package's tests the way the case says they run; returns the exit status and whether the loader ran.
function runTests(root, input) {
  const dir = join(root, "packages/core"), log = join(root, "loader.log")
  rmSync(log, { force: true })
  const run = input.route === "existing" ? bun(["test"], dir, log) : bun(["run", "test"], dir, log)
  return { status: run.status, loaded: existsSync(log), output: run.stdout + run.stderr }
}

const spawners = {
  execPath: 'const child = Bun.spawn({ cmd: [process.execPath, "test", ...process.argv.slice(2)], stdout: "inherit", stderr: "inherit" })\nprocess.exitCode = await child.exited\n',
  shell: 'import { $ } from "bun"\nconst result = await $`bun test`.nothrow()\nprocess.exitCode = result.exitCode\n',
}

function files(input) {
  const ext = input.migrated ? ".vibe" : ".ts"
  const name = input.name
  const module = {
    selfNamespace: `export * as ${name} from "./${name.toLowerCase()}${ext}"\nexport const create = (n: number) => n + 1\n`,
    plain: "export const create = (n: number) => n + 1\n",
  }[input.module]
  const specifier = input.import === "extensionless" ? `../src/${name.toLowerCase()}` : `../src/${name.toLowerCase()}${ext}`
  const use = input.module === "selfNamespace" ? `import { ${name} } from "${specifier}"\nconst create = ${name}.create\n` : `import { create } from "${specifier}"\n`
  const scripts = { literal: { test: "bun test" }, execPath: { test: "bun run script/test.ts" }, shell: { test: "bun run script/test.ts" }, existing: { test: "turbo run test" } }[input.route]
  const out = {
    "packages/core/package.json": JSON.stringify({ name: "core", type: "module", scripts }),
    [`packages/core/src/${name.toLowerCase()}${ext}`]: module,
    "packages/core/test/a.test.ts": `import { expect, test } from "bun:test"\n${use}test("loads", () => expect(create(1)).toBe(2))\n`,
    "packages/core/test/setup.ts": "globalThis.setupRan = true\n",
  }
  if (input.route in spawners) out["packages/core/script/test.ts"] = spawners[input.route]
  const bunfig = { none: "", top: 'preload = ["vibelang/bun"]\n', testSingle: '[test]\npreload = "./test/setup.ts"\n', testArray: '[test]\npreload = ["./test/setup.ts"]\n', testTimeout: '[test]\ntimeout = 9000\n' }[input.route === "existing" ? (input.bunfig === "testSingle" ? "testSingle" : "testArray") : input.bunfig]
  if (bunfig) out["packages/core/bunfig.toml"] = bunfig
  return out
}

function verify(input) {
  const twin = workspace(files({ ...input, migrated: false }))
  const migrated = workspace(files({ ...input, migrated: true }))
  try {
    const native = runTests(twin.root, input)
    assert.equal(native.status, 0, native.output)
    // Before setup the migrated package fails under bun test: the property is not vacuous.
    assert.notEqual(runTests(migrated.root, input).status, 0)
    const options = { root: migrated.root, packages: [{ dir: "packages/core" }], specsFor: () => ({ vibelang: "file:compiler.tgz" }) }
    const wired = wireBunTests(options)
    assert.deepEqual(wired.warnings, [])
    const after = runTests(migrated.root, input)
    assert.equal(after.status, native.status, after.output)
    assert.ok(after.loaded, "vibelang/bun must load under bun test")
    // An existing test preload keeps running after the loader.
    const parsed = JSON.parse(bun(["-e", "console.log(JSON.stringify(Bun.TOML.parse(require('fs').readFileSync(process.argv[1], 'utf8'))))", join(migrated.root, "packages/core/bunfig.toml")], migrated.root, join(migrated.root, "toml.log")).stdout)
    assert.equal(parsed.test.preload[0], "vibelang/bun")
    if (/^test(Single|Array)$/.test(input.bunfig) || input.route === "existing") assert.deepEqual(parsed.test.preload.slice(1), ["./test/setup.ts"])
    assert.deepEqual(wireBunTests(options), { changed: [], warnings: [] })
  } finally {
    rmSync(twin.root, { recursive: true, force: true })
    rmSync(migrated.root, { recursive: true, force: true })
  }
}

test("opencode: a package whose Bun program spawns bun test gets vibelang/bun in [test]", () => {
  const f = workspace(corpus.files)
  try {
    f.put("packages/core/package.json", JSON.stringify(corpus.manifest))
    const before = runTests(f.root, { route: "execPath" })
    assert.notEqual(before.status, 0)
    assert.match(before.output, /Export named 'CodeModeTool' not found|Cannot find module '\.\.\/src\/environment\/unavailable'/)
    const wired = wireBunTests({ root: f.root, packages: [{ dir: "packages/core" }], specsFor: () => ({ vibelang: "file:compiler.tgz" }) })
    assert.deepEqual(wired.warnings, [])
    const bunfig = f.read("packages/core/bunfig.toml")
    assert.match(bunfig, /^\[test\]\npreload = \["vibelang\/bun", "\.\/test\/preload\.ts"\]$/m)
    const after = runTests(f.root, { route: "execPath" })
    assert.equal(after.status, 0, after.output)
    assert.ok(after.loaded)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("property: every route that runs bun test loads vibelang/bun, against the .ts twin", () => {
  verify({ name: "CodeModeTool", module: "selfNamespace", import: "explicit", route: "execPath", bunfig: "testArray" })
  fc.assert(fc.property(fc.record({
    name: fc.constantFrom("CodeModeTool", "Plugin", "Env"),
    module: fc.constantFrom("selfNamespace", "plain"),
    import: fc.constantFrom("explicit", "extensionless"),
    route: fc.constantFrom("literal", "execPath", "shell", "existing"),
    bunfig: fc.constantFrom("none", "top", "testSingle", "testArray", "testTimeout"),
  }), verify), { seed: 20261104, numRuns: 24 })
})
