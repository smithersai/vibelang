import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { wireNewPackages } from "../lib/steps.mjs"
import { hasVibeLang, specsFrom } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const typescript = dirname(require.resolve("typescript/package.json"))

// t3code (drive-t3code 02:50Z, codemod-gap:setup-unwired-non-package-dirs): an
// earlier setup wired packages/*, and the run, set up with --no-wire, also
// names oxlint-plugin-t3code, scripts and evals, which had no vibelang-runtime,
// so a migrated module there failed to load (ERR_MODULE_NOT_FOUND).
const { contracts, plugin, tsconfig } = JSON.parse(readFileSync(new URL("./corpus/t3code-setup-no-wire.json", import.meta.url), "utf8"))

function target(t, files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-no-wire-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof text === "string" ? text : JSON.stringify(text, null, 2) + "\n")
  }
  mkdirSync(join(root, "node_modules"))
  symlinkSync(typescript, join(root, "node_modules/typescript"))
  mkdirSync(join(root, "logs"))
  return root
}

const config = (root, dirs) => ({
  target: root,
  packages: dirs.map((dir) => ({ dir, tsconfig: "tsconfig.json", dtsTsconfig: "tsconfig.json", sources: ["src"] })),
  install: "true",
  toolchain: { kind: "npm", version: "0.0.11" },
  test: { command: "true", cwd: "." }
})

const read = (root, path) => readFileSync(join(root, path), "utf8")

test("t3code: under --no-wire, setup wires a package new to the run with the tarballs the wired ones install, and nothing else", async (t) => {
  const root = target(t, {
    "package.json": { name: "t3code", private: true },
    "packages/contracts/package.json": contracts,
    "packages/contracts/tsconfig.json": tsconfig,
    "oxlint-plugin-t3code/package.json": plugin,
    "oxlint-plugin-t3code/tsconfig.json": tsconfig
  })
  const before = { package: read(root, "packages/contracts/package.json"), tsconfig: read(root, "packages/contracts/tsconfig.json") }
  const wired = await wireNewPackages(config(root, ["packages/contracts", "oxlint-plugin-t3code"]), join(root, "logs"))
  assert.deepEqual(wired.added, ["oxlint-plugin-t3code"])
  const next = JSON.parse(read(root, "oxlint-plugin-t3code/package.json"))
  assert.equal(next.dependencies["vibelang-runtime"], "file:../.vibelang-toolchain/vibelang-runtime-0.0.11-0123456789ab.tgz")
  assert.equal(next.devDependencies.vibelang, "file:../.vibelang-toolchain/vibelang-0.0.11-ba9876543210.tgz")
  assert.equal(next.scripts.typecheck, "vibelang --noEmit")
  assert.equal(next.scripts.test, "vp test run")
  assert.match(read(root, "oxlint-plugin-t3code/tsconfig.json"), /\*\*\/\*\.vibe/)
  assert.equal(read(root, "packages/contracts/package.json"), before.package, "a wired package stays as it is")
  assert.equal(read(root, "packages/contracts/tsconfig.json"), before.tsconfig)
  assert.deepEqual(wired.changed.sort(), ["oxlint-plugin-t3code/package.json", "oxlint-plugin-t3code/tsconfig.json"])
  // Every package has VibeLang now: a second setup wires nothing.
  assert.equal(await wireNewPackages(config(root, ["packages/contracts", "oxlint-plugin-t3code"]), join(root, "logs")), null)
})

test("--no-wire with no wired package in the run wires nothing, rather than guess specifiers", async (t) => {
  const root = target(t, { "package.json": { name: "t3code", private: true }, "oxlint-plugin-t3code/package.json": plugin, "oxlint-plugin-t3code/tsconfig.json": tsconfig })
  assert.equal(await wireNewPackages(config(root, ["oxlint-plugin-t3code"]), join(root, "logs")), null)
  assert.equal(read(root, "oxlint-plugin-t3code/package.json"), JSON.stringify(plugin, null, 2) + "\n")
})

const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/)
const dir = fc.oneof(fc.constant("."), fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => parts.join("/")))

test("property: a rebased file: specifier names the same file from the new package, and any other specifier is kept", () => {
  fc.assert(fc.property(dir, dir, fc.array(segment, { maxLength: 2 }), fc.stringMatching(/^[a-z-]{1,12}-0\.0\.\d{1,2}(-[0-9a-f]{12})?\.tgz$/), fc.constantFrom("0.0.11", "^0.0.11", "workspace:*", "file:/opt/vibelang.tgz"), (from, to, under, file, other) => {
    const at = posix.join(...under, file)
    const relative = posix.relative(from, at)
    const spec = `file:${relative.startsWith(".") ? relative : `./${relative}`}`
    const pkg = { dependencies: { "vibelang-runtime": spec }, devDependencies: { vibelang: other } }
    const specs = specsFrom(pkg, from, to)
    assert.ok(specs["vibelang-runtime"].startsWith("file:"))
    assert.equal(posix.join(to, specs["vibelang-runtime"].slice("file:".length)), posix.normalize(at))
    assert.equal(specs.vibelang, other)
    assert.equal(hasVibeLang(pkg), true)
  }), { numRuns: 300 })
})

// RD-008: setup must finish the documented repair and then reach a fixed point.
// README: "with no wired package in the run, setup wires nothing".
// Packages with a runtime dependency count as wired, even if their scripts or
// configs are incomplete: --no-wire preserves those bytes rather than repairs them.
test("property: --no-wire repairs generated workspaces once and preserves already wired packages", async () => {
  const states = fc.array(fc.record({
    state: fc.constantFrom("new", "compiler-only", "config-only", "wired", "runtime-only"),
    depth: fc.integer({ min: 1, max: 4 }),
    solution: fc.boolean(),
    extension: fc.constantFrom(".js", ".ts", ".vibe")
  }), { minLength: 1, maxLength: 6 })
  await fc.assert(fc.asyncProperty(states, fc.boolean(), async (generated, tarballs) => {
    const cleanup = []
    const files = { "package.json": { name: "generated", private: true } }
    const dirs = generated.map((pkg, i) => posix.join(...Array(pkg.depth).fill("packages"), `pkg-${i}`))
    const expectedAdded = []
    const preserved = []
    for (const [i, pkg] of generated.entries()) {
      const at = dirs[i]
      const manifest = { name: `pkg-${i}`, scripts: { typecheck: "tsc --noEmit", test: "custom-test" } }
      if (pkg.state === "wired" || pkg.state === "runtime-only") {
        const specs = tarballs ? specsFrom(contracts, "packages/contracts", at)
          : { "vibelang-runtime": "0.0.11", vibelang: "0.0.11" }
        manifest.dependencies = { "vibelang-runtime": specs["vibelang-runtime"] }
        if (pkg.state === "wired") manifest.devDependencies = { vibelang: specs.vibelang }
        preserved.push(at)
      } else {
        expectedAdded.push(at)
        if (pkg.state === "compiler-only") manifest.devDependencies = { vibelang: "0.0.10" }
      }
      files[`${at}/package.json`] = manifest
      const project = { compilerOptions: { strict: true }, include: ["src/**/*.ts"] }
      if (pkg.state === "config-only") project.include.push("src/**/*.vibe")
      if (pkg.solution) {
        files[`${at}/tsconfig.json`] = { files: [], references: [{ path: "./tsconfig.src.json" }] }
        files[`${at}/tsconfig.src.json`] = project
      } else files[`${at}/tsconfig.json`] = project
      files[`${at}/src/index.ts`] = `export { value } from "./value${pkg.extension}"\n`
      files[`${at}/src/value.ts`] = "export const value = 1\n"
    }
    const root = target({ after: (fn) => cleanup.push(fn) }, files)
    const snapshot = () => Object.fromEntries(Object.keys(files).map(path => [path, read(root, path)]))
    try {
      const before = snapshot()
      const cfg = config(root, dirs)
      const result = await wireNewPackages(cfg, join(root, "logs"))
      if (!preserved.length || !expectedAdded.length) {
        assert.equal(result, null)
        assert.deepEqual(snapshot(), before)
      } else {
        assert.deepEqual(result.added, expectedAdded)
        for (const at of preserved) {
          for (const path of Object.keys(files).filter(path => path.startsWith(at + "/"))) {
            assert.equal(read(root, path), before[path], path)
          }
        }
        for (const at of expectedAdded) {
          const next = JSON.parse(read(root, `${at}/package.json`))
          const specs = specsFrom(JSON.parse(before[`${preserved[0]}/package.json`]), preserved[0], at)
          assert.equal(next.dependencies["vibelang-runtime"], specs["vibelang-runtime"])
          assert.equal(next.devDependencies.vibelang, specs.vibelang)
          assert.equal(next.scripts.typecheck, "vibelang --noEmit")
          assert.equal(next.scripts.test, "custom-test")
          const project = generated[dirs.indexOf(at)].solution ? "tsconfig.src.json" : "tsconfig.json"
          assert.match(read(root, `${at}/${project}`), /src\/\*\*\/\*\.vibe/)
          assert.doesNotMatch(read(root, `${at}/${project}`), /rewriteRelativeImportExtensions/)
        }
        assert.ok(result.changed.every(path => expectedAdded.some(at => path.startsWith(at + "/"))))
      }
      const after = snapshot()
      assert.equal(await wireNewPackages(cfg, join(root, "logs")), null)
      assert.deepEqual(snapshot(), after, "a second setup changes no project bytes")
    } finally {
      for (const fn of cleanup) fn()
    }
  }), { seed: 8008, numRuns: 100 })
})

test("RD-008: repairing a new package reports mixed import spellings and wires referenced projects", async t => {
  const root = target(t, {
    "package.json": { private: true },
    "packages/contracts/package.json": contracts,
    "packages/contracts/tsconfig.json": tsconfig,
    "tools/package.json": plugin,
    "tools/tsconfig.json": { files: [], references: [{ path: "./tsconfig.src.json" }] },
    "tools/tsconfig.src.json": { include: ["src/**/*.ts"] },
    "tools/src/a.ts": 'export { a } from "./a.js"\nexport { b } from "./b.ts"\n'
  })
  const cfg = config(root, ["packages/contracts", "tools"])
  const result = await wireNewPackages(cfg, join(root, "logs"))
  assert.deepEqual(result.added, ["tools"])
  assert.ok(result.warnings.some(warning => warning.includes("tools") && warning.includes("mix relative import spellings")))
  assert.match(read(root, "tools/tsconfig.src.json"), /src\/\*\*\/\*\.vibe/)
  assert.equal(await wireNewPackages(cfg, join(root, "logs")), null)
})
