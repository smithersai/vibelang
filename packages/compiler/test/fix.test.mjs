import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// vibelang --fix (D291), end to end through the native compiler: it rewrites
// TypeScript-style Effect code, prints what it fixed, then compiles; a second
// run finds nothing, and a fix that would add an error is not written.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

function project(t, source) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-fix-test-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, noEmit: true },
    include: ["*.vibe"]
  }))
  writeFileSync(join(root, "main.vibe"), source)
  return root
}

function vibelang(root, ...args) {
  return spawnSync(native, args, { cwd: root, encoding: "utf8" })
}

test("--fix accepts computed static properties in ordinary classes", { skip }, (t) => {
  const root = project(t, `const kind = Symbol.for("kind")
export class Ordinary {
  static readonly [kind] = "Ordinary"
  static readonly ["default"] = 1
}
export type Result = Effect.Effect<number>
`)
  const result = vibelang(root, "--fix", "--pretty", "false")
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const text = readFileSync(join(root, "main.vibe"), "utf8")
  assert.match(text, /static readonly \[kind\] = "Ordinary"/)
  assert.match(text, /static readonly \["default"\] = 1/)
  assert.match(text, /Result = number!!/)
})

const source = `import { Data } from "effect"

export class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}

export function find(id: string): Effect.Effect<string, NotFound, never> {
  if (id === "") return Effect.fail(new NotFound({ id }))
  return id
}
`

const fixed = `
export error NotFound { id: string }

export function find(id: string): string!NotFound {
  if (id === "") throw new NotFound({ id })
  return id
}
`

test("--fix runs structured Effect results from VibeLang helpers", { skip }, (t) => {
  const root = project(t, "type Base = Effect.Effect<number>\ninterface Query extends Base { readonly sql: string }\nfunction query(): Query { return null as any }\nexport const run = () => Effect.gen(function* () {\n  const n = yield* query()\n  yield* query()\n  return n\n})\n")
  const result = vibelang(root, "-p", "tsconfig.json", "--fix", "--pretty", "false")
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout, /not fixed|refused/)
  const text = readFileSync(join(root, "main.vibe"), "utf8")
  assert.equal(text.split("query()()").length - 1, 2, text)
  assert.ok(!text.includes("Effect.gen"), text)
  const second = vibelang(root, "-p", "tsconfig.json", "--fix", "--pretty", "false")
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.match(second.stdout, /0 fixes in 0 files/)
})

test("--fix rewrites the forms, reports them, compiles, and is idempotent", { skip }, (t) => {
  const root = project(t, source)
  const first = vibelang(root, "-p", "tsconfig.json", "--fix", "--pretty", "false")
  assert.equal(first.status, 0, first.stdout + first.stderr)
  assert.match(first.stdout, /^vibelang --fix: main\.vibe: 3 fixes \(EK4830 ×1, EK4833 ×1, EK4834 ×1\)$/m)
  assert.match(first.stdout, /^vibelang --fix: 3 fixes in 1 file\.$/m)
  assert.doesNotMatch(first.stdout, /EK48\d\d:/, "the compilation after the fixes reports nothing")
  assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), fixed)
  const second = vibelang(root, "-p", "tsconfig.json", "--fix", "--pretty", "false")
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.match(second.stdout, /^vibelang --fix: 0 fixes in 0 files\.$/m)
  assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), fixed)
})

test("--fix leaves a fix that would add an error, and says why", { skip }, (t) => {
  const root = project(t, `export function modes() {
  const mode = Effect.succeed("fast")
  const all: Array<typeof mode> = [mode]
  all.push("slow")
  return all
}
`)
  const result = vibelang(root, "--fix", "--pretty", "false")
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /^vibelang --fix: main\.vibe:2: EK4834 not fixed: the fixed program would report .*TS2345/m)
  assert.match(result.stdout, /warning EK4834/, "the warning stays")
  assert.match(readFileSync(join(root, "main.vibe"), "utf8"), /Effect\.succeed\("fast"\)/)
})

test("--fix honors a project that turns a code off", { skip }, (t) => {
  const root = project(t, source)
  const config = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"))
  config.vibelang = { diagnostics: { EK4830: "off" } }
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
  const result = vibelang(root, "-p", "tsconfig.json", "--fix", "--pretty", "false")
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(readFileSync(join(root, "main.vibe"), "utf8"), /class NotFound extends Data\.TaggedError/)
})

test("--fix refuses --watch and --build", { skip }, (t) => {
  const root = project(t, source)
  for (const flag of ["--watch", "--build"]) {
    const result = vibelang(root, "--fix", flag)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, new RegExp(`vibelang --fix: ${flag} cannot be combined with --fix`))
  }
  assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), source)
})

test("--fix writes only the project's own files, and leaves a dependency's source as it was", { skip }, (t) => {
  // A workspace dependency whose package exports .vibe source, linked into
  // node_modules: the project compiles it, and tsc would emit none of it.
  const root = project(t, "")
  const config = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"))
  config.include = ["src"]
  config.vibelang = { trustedPackages: ["@repro/*"] }
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
  const dependency = "export type Run = Effect.Effect<number>\nexport const run = 1\n"
  mkdirSync(join(root, "dependency"))
  writeFileSync(join(root, "dependency/package.json"), '{"name":"@repro/dependency","type":"module","exports":"./index.vibe"}')
  writeFileSync(join(root, "dependency/index.vibe"), dependency)
  mkdirSync(join(root, "node_modules/@repro"))
  symlinkSync("../../dependency", join(root, "node_modules/@repro/dependency"))
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "src/index.vibe"), 'import { run } from "@repro/dependency"\nexport const x = run\n')
  writeFileSync(join(root, "src/own.vibe"), dependency)
  const result = vibelang(root, "-p", "tsconfig.json", "--fix", "--pretty", "false")
  assert.match(result.stdout, /^vibelang --fix: src\/own\.vibe: 1 fix \(EK4833 ×1\)$/m)
  assert.match(result.stdout, /^vibelang --fix: 1 fix in 1 file\.$/m)
  assert.equal(readFileSync(join(root, "dependency/index.vibe"), "utf8"), dependency)
  assert.notEqual(readFileSync(join(root, "src/own.vibe"), "utf8"), dependency)
  assert.match(result.stdout, /^dependency\/index\.vibe\(1,\d+\): \w+ EK4833/m, "the compilation still reports the dependency's diagnostic")
})

for (const [name, source, rewrite] of [["direct", "export interface Query extends Effect.Effect<number> { readonly sql: string }\n", false], ["nested", "interface Holder<T> { readonly value: T }\nexport interface Wrapped extends Holder<Effect.Effect<number>> {}\n", true]]) {
  test("--fix respects Effect type heritage grammar: " + name, { skip }, (t) => {
    const root = project(t, source)
    const result = vibelang(root, "-p", "tsconfig.json", "--fix", "--pretty", "false")
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.doesNotMatch(result.stdout, /not fixed|refused/)
    const text = readFileSync(join(root, "main.vibe"), "utf8")
    if (rewrite) {
      assert.ok(text.includes("number!!") && !text.includes("Effect.Effect"), text)
    } else {
      assert.equal(text, source)
      assert.doesNotMatch(result.stdout, /EK4833/)
    }
  })
}

