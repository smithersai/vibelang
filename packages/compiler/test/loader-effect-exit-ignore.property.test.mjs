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
import { reportWarnings } from "../diagnostics.mjs"

// The Effect plugin's ignoreEffectErrorsInTscExitCode and
// ignoreEffectWarningsInTscExitCode keep imported lint diagnostics out of a
// build's exit status; they still print. A loader fails a module on exactly
// the diagnostics that fail `vibelang -p`, so a project the CLI builds also
// loads through vibelang/register, compileProjectSync and the bundler plugins'
// projects().
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
const bunPreload = fileURLToPath(new URL("../bun.mjs", import.meta.url))
const hasBun = spawnSync("bun", ["--version"]).status === 0
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

// The CLI prints an ignored lint error and exits 0; vibelang/register and
// vibelang/bun load the module and print the same finding once on standard
// error, as the bundler plugins hand it to the bundler's log.
for (const [name, run] of [
  ["vibelang/register", (root, env) => spawnSync(process.execPath, ["--import", register, "main.mjs"], { cwd: root, env, encoding: "utf8", timeout: 60000 })],
  ["vibelang/bun", (root, env) => spawnSync("bun", ["--preload", bunPreload, "main.mjs"], { cwd: root, env, encoding: "utf8", timeout: 60000 })]
]) {
  const skipLoader = skip || (name === "vibelang/bun" && !hasBun && "bun is not on PATH")
  test(`${name} loads a module with an ignored Effect lint error and prints it once as a warning`, { skip: skipLoader, timeout: 120000 }, (t) => {
    const root = project(t)
    const env = { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), NO_COLOR: "1" }
    for (const rule of Object.keys(rules)) {
      const { code } = rules[rule]
      write(root, { rule, severity: "error", ignoreErrors: true, ignoreWarnings: true, wrong: false })
      const built = cli(root)
      assert.equal(built.status, 0, built.output)
      const loaded = run(root, env)
      assert.equal(loaded.status, 0, loaded.stdout + loaded.stderr)
      assert.match(loaded.stdout, /^loaded /m)
      const printed = loaded.stderr.split("\n").filter((line) => line.startsWith(`${name}: `) && line.includes(` error ${code}: `))
      assert.equal(printed.length, 1, `${rule}: ${loaded.stderr}`)
      assert.ok(printed[0].startsWith(`${name}: ${join(root, "src/a.vibe")}:`), printed[0])

      // A finding the build fails on is the load's error, not a warning.
      write(root, { rule, severity: "error", ignoreErrors: false, ignoreWarnings: true, wrong: false })
      const refused = run(root, env)
      assert.notEqual(refused.status, 0)
      assert.match(refused.stderr, new RegExp(`did not compile[^]*error ${code}:`))
    }
  })
}

test("reportWarnings prints a module's warnings and the project-wide ones once per compile", () => {
  const a = "/project/src/a.vibe", b = "/project/src/b.vibe"
  const ownA = { file: a, line: 1, column: 22, category: "error", code: "EK3889", text: "a" }
  const ownB = { file: b, line: 2, column: 1, category: "warning", code: "EK38122", text: "b" }
  const global = { category: "warning", code: "TS5110", text: "project" }
  const result = { files: [a, b], errors: [], warnings: [ownA, ownB, global] }
  const printed = []
  const report = (text) => printed.push(text)
  reportWarnings(result, a, report)
  reportWarnings(result, a, report)
  reportWarnings(result, b, report)
  assert.deepEqual(printed, [
    "/project/src/a.vibe:1:22 - error EK3889: a",
    "warning TS5110: project",
    "/project/src/b.vibe:2:1 - warning EK38122: b"
  ])
  // A new compile is a new result, whose warnings print again.
  reportWarnings({ ...result }, a, report)
  assert.equal(printed.length, 5)
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
        // Ignore options never hide a printed diagnostic: the build prints it,
        // and so does the reporter vibelang/register and vibelang/bun share.
        if (visible && !fails) {
          const code = rules[input.rule].code
          assert.ok(result.warnings.some((d) => d.code === code), context)
          const printed = []
          reportWarnings(result, file, (text) => printed.push(text))
          assert.equal(printed.filter((text) => text.includes(` ${code}: `)).length, 1, context)
        }
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
