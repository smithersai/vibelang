import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { loaderScope } from "../loader-scope.mjs"
import { compileProjectSync, parseOutput, projects } from "../project.mjs"

// The Effect plugin's ignoreEffectErrorsInTscExitCode and
// ignoreEffectWarningsInTscExitCode keep imported lint diagnostics out of a
// build's exit status; they still print. A loader fails a module on exactly
// the diagnostics that fail `vibelang -p`, so a project the CLI builds also
// loads through vibelang/register, compileProjectSync and the bundler plugins'
// projects().
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [compiler, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing && `build the native compiler and runtime first: ${missing}`

// A .vibe witness for each imported rule, and the code it reports.
const rules = {
  preferSchemaOverJson: { code: "EK3889", source: "export const value = JSON.stringify({ a: 1 })\n" },
  unknownInEffectCatch: {
    code: "EK38122",
    source: 'import { Effect } from "effect"\nexport const value = Effect.tryPromise({ try: () => Promise.resolve(1), catch: (error) => error })\n'
  }
}
const typeError = 'export const wrong: number = "text"\n'

function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-exit-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  mkdirSync(join(root, "src"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "main.mjs"), 'import { value } from "./src/a.vibe"\nconsole.log("loaded", typeof value)\n')
  return root
}

function write(root, { rule, severity, ignoreErrors, ignoreWarnings, wrong }) {
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], noEmit: true,
      plugins: [{
        name: "@effect/language-service", diagnosticSeverity: { [rule]: severity },
        ignoreEffectErrorsInTscExitCode: ignoreErrors, ignoreEffectWarningsInTscExitCode: ignoreWarnings
      }]
    },
    include: ["src"]
  }))
  writeFileSync(join(root, "src/a.vibe"), rules[rule].source + (wrong ? typeError : ""))
}

function cli(root) {
  const run = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 60000 })
  assert.ifError(run.error)
  return { status: run.status, output: run.stdout + run.stderr }
}

const codes = (diagnostics) => diagnostics.map((diagnostic) => diagnostic.code).sort()

test("the loaders fail a module on the diagnostics that fail the CLI build, and report ignored lint errors", { skip, timeout: 120000 }, async (t) => {
  const root = project(t)
  const project_ = join(root, "tsconfig.json")
  const file = join(root, "src/a.vibe")
  const env = { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache") }
  for (const rule of Object.keys(rules)) {
    const { code } = rules[rule]
    write(root, { rule, severity: "error", ignoreErrors: true, ignoreWarnings: true, wrong: false })
    const built = cli(root)
    assert.equal(built.status, 0, built.output)
    assert.match(built.output, new RegExp(`error ${code}:`))
    for (const scope of [false, true]) {
      const result = compileProjectSync({ project: project_, root, compiler, cache: false, [loaderScope]: scope })
      assert.deepEqual(result.errors, [], `${rule}, loader scope ${scope}`)
      assert.deepEqual(result.warnings.map((d) => `${d.category} ${d.code}`), [`error ${code}`], `${rule}, loader scope ${scope}`)
      assert.ok(result.outputs.has(file))
    }
    const loaded = spawnSync(process.execPath, ["--import", register, "main.mjs"], { cwd: root, env, encoding: "utf8", timeout: 60000 })
    assert.equal(loaded.status, 0, loaded.stdout + loaded.stderr)
    assert.match(loaded.stdout, /^loaded /m)
    const modules = projects({ root, project: project_, compiler, cache: false })
    try {
      const module = await modules.load(file)
      assert.deepEqual(module.errors, [])
      assert.deepEqual(codes(module.warnings), [code])
      assert.doesNotMatch(module.code, /did not compile/)
    } finally {
      await modules.close()
    }

    // A type error still fails the build and every loader.
    write(root, { rule, severity: "error", ignoreErrors: true, ignoreWarnings: true, wrong: true })
    assert.notEqual(cli(root).status, 0)
    assert.deepEqual(codes(compileProjectSync({ project: project_, root, compiler, cache: false, [loaderScope]: true }).errors), ["TS2322"])
    const refused = spawnSync(process.execPath, ["--import", register, "main.mjs"], { cwd: root, env, encoding: "utf8", timeout: 60000 })
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /TS2322/)

    // Without the ignore option the lint error fails the build and the loaders.
    write(root, { rule, severity: "error", ignoreErrors: false, ignoreWarnings: true, wrong: false })
    assert.notEqual(cli(root).status, 0)
    assert.deepEqual(codes(compileProjectSync({ project: project_, root, compiler, cache: false, [loaderScope]: true }).errors), [code])
  }
})

test("CLI exit status and loader errors agree over imported rules, severities and ignore options", { skip, timeout: 900000 }, async (t) => {
  const root = project(t)
  const project_ = join(root, "tsconfig.json")
  const file = join(root, "src/a.vibe")
  await fc.assert(fc.asyncProperty(
    fc.record({
      rule: fc.constantFrom(...Object.keys(rules)),
      severity: fc.constantFrom("error", "warning", "suggestion", "off"),
      ignoreErrors: fc.boolean(),
      ignoreWarnings: fc.boolean(),
      wrong: fc.boolean()
    }),
    async (input) => {
      write(root, input)
      const built = cli(root)
      const fails = built.status !== 0
      const visible = input.severity === "error" || input.severity === "warning"
      const context = JSON.stringify({ input, output: built.output })
      for (const scope of [false, true]) {
        const result = compileProjectSync({ project: project_, root, compiler, cache: false, [loaderScope]: scope })
        assert.equal(result.errors.length > 0, fails, context)
        // Ignore options never hide a printed diagnostic.
        if (visible && !fails) assert.ok(result.warnings.some((d) => d.code === rules[input.rule].code), context)
        if (input.wrong) assert.ok(result.errors.some((d) => d.code === "TS2322"), context)
      }
      const modules = projects({ root, project: project_, compiler, cache: false })
      try {
        const module = await modules.load(file)
        assert.equal(module.errors.length > 0, fails, context)
      } finally {
        await modules.close()
      }
    }
  ), { numRuns: 24 })
})

test("parseOutput reads the compiler's exit-ignored lines apart from diagnostics and listings", () => {
  const root = "/project"
  const parsed = parseOutput([
    "src/a.vibe(1,22): error EK3889: JSON.stringify handles JSON without a schema to check it.",
    "  Encode with a schema instead.",
    "src/a.vibe(2,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    "/project/src/a.vibe",
    "bundled:///libs/lib.es5.d.ts",
    "VIBELANG-EXIT-IGNORED: error EK3889",
    "VIBELANG-EXIT-IGNORED: warning EK3897"
  ].join("\n"), root)
  assert.deepEqual([...parsed.exitIgnored].sort(), ["error EK3889", "warning EK3897"])
  assert.deepEqual(parsed.files, ["/project/src/a.vibe"])
  assert.deepEqual(parsed.diagnostics.map((d) => d.text), [
    "JSON.stringify handles JSON without a schema to check it.\n  Encode with a schema instead.",
    "Type 'string' is not assignable to type 'number'."
  ])
})
