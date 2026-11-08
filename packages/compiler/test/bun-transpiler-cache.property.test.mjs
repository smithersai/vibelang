// A TypeScript importer names a migrated module by its JavaScript name
// (./b.js for b.vibe). When b returns to b.ts, or migrates again, a later Bun
// process that reuses the runtime transpiler cache must load the module on
// disk, not the path an earlier process resolved the import to.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const preload = join(compilerPackage, "bun.mjs")
const native = process.env.VIBELANG_BINARY || join(compilerPackage, "native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const runtime = process.env.VIBELANG_RUNTIME || join(repo, "packages/runtime")
const bun = process.env.VIBELANG_TEST_BUN || "bun"
const missing = [native, join(modules, "effect"), join(runtime, "dist/index.js")].find(path => !existsSync(path))
const skip = missing ? "missing test dependency: " + missing : spawnSync(bun, ["--version"]).status !== 0 && "Bun is unavailable"
const regression = JSON.parse(readFileSync(new URL("./property-regressions/smithers-bun-returned-module-cache.json", import.meta.url), "utf8"))

// Bun caches the transpiled output of a module of at least 50 KB only.
const padding = Array.from({ length: 700 }, (_, line) => "// " + line + " " + "x".repeat(80)).join("\n") + "\n"

function inspect({ specifier, dynamic, runner, stages, value }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-cache-")))
  try {
    mkdirSync(join(root, "node_modules"))
    mkdirSync(join(root, "src"))
    symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
    symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], noEmit: true },
      include: ["src"]
    }))
    const load = dynamic
      ? "const { who } = await import(" + JSON.stringify(specifier) + ")\n"
      : "import { who } from " + JSON.stringify(specifier) + "\n"
    const entry = runner === "test" ? "src/main.test.ts" : "src/main.ts"
    writeFileSync(join(root, entry), runner === "test"
      ? 'import { test } from "bun:test"\n' + load + 'test("loads", () => { console.log("RESULT " + who) })\n' + padding
      : load + 'console.log("RESULT " + who)\n' + padding)
    const cache = join(root, ".bun-transpiler-cache")
    const env = { ...process.env, PATH: dirname(bun) + delimiter + process.env.PATH, BUN_OPTIONS: "", NODE_OPTIONS: "",
      VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".vibe-cache"),
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache }
    delete env.NODE_TEST_CONTEXT
    const args = runner === "test" ? ["test", "--preload", preload, "./" + entry] : ["--preload", preload, entry]
    for (const [stage, extension] of stages.entries()) {
      for (const file of ["b.ts", "b.vibe"]) rmSync(join(root, "src", file), { force: true })
      const expected = extension + "-" + value
      writeFileSync(join(root, "src/b." + extension), "export const who: string = " + JSON.stringify(expected) + "\n")
      const run = spawnSync(bun, args, { cwd: root, env, encoding: "utf8", timeout: 30000 })
      const report = JSON.stringify({ input: { specifier, dynamic, runner, stages, value }, stage, stdout: run.stdout, stderr: run.stderr })
      assert.ifError(run.error)
      assert.equal(run.signal, null, report)
      assert.equal(run.status, 0, report)
      assert.match(run.stdout, new RegExp("^RESULT " + expected + "$", "m"), report)
    }
    // The importer itself went through Bun's cache; otherwise this tests nothing.
    const cached = existsSync(cache) ? readdirSync(cache).filter(file => readFileSync(join(cache, file), "latin1").includes("RESULT ")) : []
    assert.ok(cached.length > 0, "Bun cached no importer output in " + cache)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Smithers suite loads a module returned from .vibe to .ts with a reused Bun cache", { skip }, () => {
  assert.ok(readFileSync(join(repo, regression.spec), "utf8").includes(regression.quote))
  inspect(regression.input)
})

const forms = { specifier: ["./b.js", "./b"], dynamic: [false, true], runner: ["run", "test"], stages: [["vibe", "ts", "vibe"], ["ts", "vibe", "ts"]] }

test("every import form follows a .vibe/.ts move with a reused Bun cache", { skip }, () => {
  for (const specifier of forms.specifier) for (const dynamic of forms.dynamic)
    for (const runner of forms.runner) for (const stages of forms.stages) inspect({ specifier, dynamic, runner, stages, value: 7 })
})

test("property: a reused Bun cache follows each .vibe/.ts move of an imported module", { skip }, () => {
  fc.assert(fc.property(fc.record({
    specifier: fc.constantFrom(...forms.specifier),
    dynamic: fc.boolean(),
    runner: fc.constantFrom(...forms.runner),
    stages: fc.array(fc.constantFrom("ts", "vibe"), { minLength: 2, maxLength: 4 }).filter(stages => new Set(stages).size === 2),
    value: fc.integer({ min: 0, max: 99 })
  }), input => { inspect(input); return true }), { seed: 110826, numRuns: 12 })
})
