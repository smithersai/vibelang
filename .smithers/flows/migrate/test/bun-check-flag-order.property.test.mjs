import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { addCompilerScripts } from "../lib/wire.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/compiler/package.json"))
const fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const bun = process.env.VIBELANG_TEST_BUN || join(repo, "docs/tools/node_modules/bun/bin/bun.exe")
const quote = word => "'" + word.replaceAll("'", "'\\''") + "'"

test("TestBunCheckerFlagOrderRulesQuoted", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes("Module resolution is as in TypeScript"))
  assert.ok(existsSync(compiler), "build the compiler before running checker properties")
  const version = spawnSync(bun, ["--version"], { encoding: "utf8" })
  assert.equal(version.status, 0)
  assert.equal(version.stdout.trim(), "1.4.4")
})

function check({ position, longBuild, projectFlag, depth, bad, noEmit }) {
  const root = mkdtempSync(join(tmpdir(), "bun-checker-selection-"))
  const project = "project with spaces/tsconfig.json"
  const home = dirname(project), stem = "nested/".repeat(depth) + "native"
  const importer = 'import { native } from "./' + stem + '"; export const result: ' + (bad ? "string" : "number") + " = native\n"
  const put = (side, name, text) => {
    const path = join(root, side, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  try {
    const config = { compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
      skipLibCheck: true, types: [], noEmit, composite: true, rootDir: "src", outDir: "out" },
      vibe: { effectGlobals: false, effectModules: false }, include: ["src"] }
    for (const side of ["native", "migrated"]) {
      put(side, "package.json", '{"type":"module"}')
      put(side, project, JSON.stringify(config))
      put(side, home + "/src/main.ts", importer)
      put(side, home + "/src/" + stem + (side === "native" ? ".ts" : ".vibe"), "export const native: number = 42\n")
    }
    const groups = [[longBuild ? "--build" : "-b"], projectFlag ? ["-p", project] : [project]]
    groups.splice(position, 0, ["--no-script"])
    const args = groups.flat()
    const original = "bun check " + args.map(word => word.startsWith("-") ? word : quote(word)).join(" ")
    // Keep --no-script an authored option; quoted project names retain their
    // exact bytes. Bare bun check still has package-script semantics.
    const script = original
    const native = join(root, "native"), migrated = join(root, "migrated")
    const nativeBun = spawnSync(bun, ["check", ...args], { cwd: native, encoding: "utf8", timeout: 60000 })
    assert.ifError(nativeBun.error)
    assert.equal(nativeBun.status === 0, !bad, nativeBun.stdout + nativeBun.stderr)
    const messages = []
    const host = ts.createSolutionBuilderHost(ts.sys, undefined, diagnostic => messages.push(diagnostic))
    const stock = ts.createSolutionBuilder(host, [join(native, project)], { force: true }).build()
    assert.equal(stock === 0, !bad, JSON.stringify(messages.map(d => d.code)))
    if (bad) assert.ok(messages.some(d => d.code === 2322))
    if (position === 0) {
      const cli = join(repo, "docs/tools/node_modules/typescript/bin/tsc")
      const twin = spawnSync(process.execPath, [cli, "-b", project, "--force", "--pretty", "false"], {
        cwd: native, encoding: "utf8", timeout: 60000
      })
      assert.ifError(twin.error)
      assert.equal(twin.status === 0, !bad, twin.stdout + twin.stderr)
      if (bad) assert.match(twin.stdout + twin.stderr, /TS2322/)
    }

    mkdirSync(join(migrated, "node_modules/.bin"), { recursive: true })
    symlinkSync(join(repo, "packages/compiler"), join(migrated, "node_modules/vibelang"))
    symlinkSync(compiler, join(migrated, "node_modules/.bin/vibelang"))
    put("migrated", "bunfig.toml", 'preload = ["vibelang/bun"]\n')
    const untouched = spawnSync(bun, ["check", ...args], { cwd: migrated, encoding: "utf8", timeout: 60000 })
    assert.ifError(untouched.error)
    assert.notEqual(untouched.status, 0)
    assert.match(untouched.stdout + untouched.stderr, /TS2307/, "runtime preloads do not replace Bun's native checker")

    const pkg = addCompilerScripts({ scripts: { typecheck: script } }, "unused")
    assert.match(pkg.scripts.typecheck, /^vibelang (?:-b|--build) /)
    const result = spawnSync("sh", ["-c", pkg.scripts.typecheck + " --force --pretty false"], {
      cwd: migrated, encoding: "utf8", timeout: 60000,
      env: { ...process.env, PATH: join(migrated, "node_modules/.bin") + ":" + process.env.PATH }
    })
    assert.ifError(result.error)
    assert.equal(result.status === 0, !bad, result.stdout + result.stderr + script)
    if (bad) assert.match(result.stdout + result.stderr, /TS2322/)
    if (!bad) {
      for (const side of ["native", "migrated"]) assert.equal(existsSync(join(root, side, home, "out/main.js")), !noEmit)
    }
    assert.equal(readFileSync(join(migrated, home, "src/main.ts"), "utf8"), importer)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("extensionless imports match the TypeScript twin when the forced Bun build script selects VibeLang", () => {
  for (const position of [0, 1, 2]) {
    check({ position, longBuild: false, projectFlag: false, depth: 0, bad: false, noEmit: true })
    check({ position, longBuild: true, projectFlag: true, depth: 1, bad: true, noEmit: false })
  }
  console.log("Bun 1.4.4 and TypeScript " + ts.version + ": Bundler accepts extensionless native twins; migrated builds preserve success and TS2322")
})
test("property: forced checker selection preserves build mode, project selection and diagnostics in every flag order", { timeout: 600000 }, () => {
  fc.assert(fc.property(fc.record({
    position: fc.integer({ min: 0, max: 2 }), longBuild: fc.boolean(), projectFlag: fc.boolean(),
    depth: fc.integer({ min: 0, max: 2 }), bad: fc.boolean(), noEmit: fc.boolean()
  }), check), { numRuns: 10, seed: 332144 })
})
