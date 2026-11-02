import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, parse, relative } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { compileProjectSync, parseOutput } from "../project.mjs"

// A loader's compile (vibelang --loader-root) checks and emits only the .vibe
// sources under its root (bun:standalone-cold-project-compiles). The oracle is
// an independent compile of the same project that checks every file: each
// .vibe module's JavaScript, and each diagnostic located in one, must be the
// same, no diagnostic of a .ts file or of another package may reach the
// loader, and a compile with no .vibe error is reused from the cache.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const rule = "docs/design/history/src/428-part4-ch28-tooling.md: a loader's compile checks and emits only the .vibe sources under its project's directory"
const regressions = new URL("./property-regressions/", import.meta.url)

const vibe = fc.record({
  ts: fc.integer({ min: -1, max: 2 }), // the .ts module it imports, or none
  own: fc.boolean(), // an error of its own
  contract: fc.boolean(), // an error that the imported .ts module's types decide
  effect: fc.boolean(), // a `try` whose emit the imported .ts module's types decide
  module: fc.boolean(), // a module declaration (D283)
  outside: fc.boolean() // imports a .vibe module of another package
})
const typescript = fc.record({
  own: fc.boolean(), // an error of its own
  vibe: fc.integer({ min: -1, max: 2 }) // the .vibe module it imports, or none
})
const arbitrary = fc.record({
  vibes: fc.array(vibe, { minLength: 1, maxLength: 3 }),
  ts: fc.array(typescript, { minLength: 1, maxLength: 3 }),
  libraryError: fc.boolean()
})

const options = {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
  allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
}

function files(input) {
  const result = {
    "app/package.json": '{"type":"module"}',
    "app/tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src/**/*"] }),
    "lib/package.json": '{"type":"module"}',
    "lib/tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src/**/*"] }),
    "lib/src/l.vibe": `export const l: number = 7\n${input.libraryError ? 'export const libraryWrong: number = "x" as string\n' : ""}`
  }
  const ts = (index) => index >= 0 && index < input.ts.length ? index : -1
  const vibes = (index) => index >= 0 && index < input.vibes.length ? index : -1
  input.ts.forEach((spec, i) => {
    const target = vibes(spec.vibe)
    result[`app/src/t${i}.ts`] = [
      'import { Effect } from "effect"',
      target >= 0 ? `import { v${target} } from "./v${target}.vibe"` : "",
      `export const t${i}: number = ${i}`,
      `export const eff${i} = Effect.succeed(${i})`,
      target >= 0 ? `export const use${i}: number = v${target} + 1` : "",
      spec.own ? `export const bad${i}: number = "x" as string` : "",
      ""
    ].filter((line, index, all) => line || index === all.length - 1).join("\n")
  })
  input.vibes.forEach((spec, i) => {
    const source = ts(spec.ts)
    result[`app/src/v${i}.vibe`] = [
      source >= 0 ? `import { t${source}, eff${source} } from "./t${source}.ts"` : "",
      spec.outside ? 'import { l } from "../../lib/src/l.vibe"' : "",
      spec.module ? "import { clean } from text" : "",
      spec.module ? `module text {\nexport function clean(value: string): string { return value.trim() + "${i}" }\n}` : "",
      `export const v${i}: number = ${source >= 0 ? `t${source} + ${i}` : i}${spec.outside ? " + l" : ""}`,
      spec.own ? `export const wrong${i}: number = "x" as string` : "",
      spec.contract && source >= 0 ? `export const contract${i}: string = t${source}` : "",
      spec.effect && source >= 0 ? `export effect function get${i}() { const x = try eff${source}; return x + ${i} }` : "",
      spec.module ? `export const cleaned${i} = clean(" a ")` : "",
      ""
    ].filter((line, index, all) => line || index === all.length - 1).join("\n")
  })
  return result
}

function write(root, entries) {
  for (const [file, text] of Object.entries(entries)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}

// The loader's arguments (project.mjs emitArgs) without --loader-root.
const fullArgs = (project, out) => [
  "--project", project, "--pretty", "false", "--listFiles", "true", "--rootDir", parse(project).root,
  "--outDir", out, "--sourceMap", "true", "--inlineSources", "true", "--inlineSourceMap", "false",
  "--sourceRoot", "/", "--declaration", "false", "--declarationMap", "false", "--noEmit", "false",
  "--emitDeclarationOnly", "false", "--noEmitOnError", "false", "--rewriteRelativeImportExtensions", "true",
  "--composite", "false", "--incremental", "false"
]

const located = (diagnostic) => `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}`
let diagnostics = ""

async function check(input) {
  for (const path of [compiler, effect, join(repo, "packages/runtime/dist/index.js")]) {
    assert.ok(existsSync(path), `property setup: missing ${path}; build the compiler and runtime and install Effect first`)
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-loader-scope-")))
  diagnostics = ""
  try {
    const app = join(root, "app")
    mkdirSync(join(app, "node_modules"), { recursive: true })
    symlinkSync(realpathSync(effect), join(app, "node_modules/effect"))
    symlinkSync(join(repo, "packages/runtime"), join(app, "node_modules/vibelang-runtime"))
    write(root, files(input))
    const project = join(app, "tsconfig.json")
    const out = join(root, "full")
    const run = spawnSync(compiler, fullArgs(project, out), { cwd: app, encoding: "utf8", maxBuffer: 1 << 28 })
    assert.ifError(run.error)
    const full = parseOutput(run.stdout + run.stderr, app).diagnostics.filter((d) => d.category === "error")
    diagnostics += `full compile:\n${run.stdout}${run.stderr}\n`
    const loaded = compileProjectSync({ project, compiler, cache: false })
    diagnostics += `loader errors: ${JSON.stringify(loaded.errors)}\n`

    // The loader reports exactly the full compile's errors in .vibe sources under the root.
    const served = (file) => file.endsWith(".vibe") && !relative(app, file).startsWith("..")
    const expected = full.filter((d) => d.file === undefined || served(d.file)).map(located).sort()
    assert.deepEqual(loaded.errors.map(located).sort(), expected)
    for (const error of loaded.errors) assert.ok(error.file === undefined || served(error.file), `${located(error)} is not a served .vibe source's`)

    // Each served module's JavaScript, module declarations included, is the full compile's.
    for (const [path, output] of loaded.outputs) {
      assert.ok(/\.vibe(?:\.\w+\.js)?$/.test(path) && served(path.replace(/(\.vibe)\.\w+\.js$/, "$1")), `the loader emitted ${path}`)
      const emitted = join(out, relative(parse(path).root, path).replace(/\.vibe$/, ".js"))
      assert.equal(output.code, readFileSync(emitted, "utf8").replace(/\/\/# sourceMappingURL=.*$/m, ""), path)
    }
    for (let i = 0; i < input.vibes.length; i++) {
      assert.ok(loaded.outputs.has(join(app, `src/v${i}.vibe`)), `v${i}.vibe is served`)
      if (input.vibes[i].module) assert.ok(loaded.outputs.has(join(app, `src/v${i}.vibe.text.js`)), `v${i}.vibe.text.js is served`)
    }
    assert.ok(![...loaded.outputs.keys()].some((path) => path.startsWith(join(root, "lib"))), "another package's module is its own project's")

    // With no .vibe error, a second process reuses the compile.
    if (loaded.errors.length === 0) {
      await sleep(120) // cache.mjs keeps a file stamped too near a compile's start out of the cache
      const directory = join(root, "cache")
      const trace = []
      compileProjectSync({ project, compiler, cache: { directory }, debug: (line) => trace.push(line) })
      compileProjectSync({ project, compiler, cache: { directory }, debug: (line) => trace.push(line) })
      diagnostics += trace.join("\n")
      assert.match(trace.at(-1), /from the cache/)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("loader-check-scope", async () => {
  await checkProperty(fc, {
    name: "loader-check-scope", rule, arbitrary, check, numRuns: 12, regressions,
    command: "node --test packages/compiler/test/loader-check-scope.property.test.mjs",
    artifacts: files, diagnostics: () => diagnostics
  })
})
