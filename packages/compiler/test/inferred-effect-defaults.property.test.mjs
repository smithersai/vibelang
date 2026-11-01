import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const fc = require("fast-check")
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/t3code-inferred-effect-defaults.json", import.meta.url), "utf8"))
const raw = process.env.VIBELANG_INFERRED_DEFAULTS_RAW === "1"
const quote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

test("the inferred Effect default oracle quotes Chapter 1", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(quote))
})

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-inferred-defaults-"))
  try {
    const declarations = {}
    for (const phase of ["native", "vibe"]) {
      const dir = join(root, phase), prefix = Array.from({ length: input.depth }, (_, i) => "d" + i).join("/")
      const source = prefix ? prefix + "/" : ""
      mkdirSync(join(dir, "node_modules"), { recursive: true })
      mkdirSync(join(dir, source), { recursive: true })
      symlinkSync(join(modules, "effect"), join(dir, "node_modules/effect"), "dir")
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      const written = "Effect.Effect<string" + (input.arity > 1 ? ", Error" : "") + (input.arity > 2 ? ", never" : "") + ">"
      const sugar = input.arity === 1 ? "string!!" : input.arity === 2 ? "string!Error" : "string!Error!never"
      const type = phase === "vibe" && input.syntax === "shorthand" ? sugar : written
      const effect = input.namespace === "root" ? 'import type { Effect } from "effect"' : 'import type * as Effect from "effect/Effect"'
      const ext = phase === "native" ? "ts" : "vibe"
      const dependency = effect + "\nexport interface Provider { readonly generate: (input: string) => " + type + " }\n"
      const specifier = input.route === "package" ? "provider/core" : "./core.js"
      const importer = 'import type { Provider } from "' + specifier + '"\ndeclare const core: Provider\n' +
        (input.form === "object" ? "export const muse = { generate: core.generate }\n" :
          input.form === "direct" ? "export const generate = core.generate\n" :
          "export const muse = { generate(input: string) { return core.generate(input) } }\n")
      writeFileSync(join(dir, source, "core." + ext), dependency)
      writeFileSync(join(dir, source, "main.ts"), importer)
      if (input.route === "package") {
        mkdirSync(join(dir, "node_modules/provider"), { recursive: true })
        writeFileSync(join(dir, "node_modules/provider/package.json"), JSON.stringify({
          name: "provider", type: "module", exports: { "./core": { types: "./core." + ext } },
        }))
        symlinkSync(join(dir, source, "core." + ext), join(dir, "node_modules/provider/core." + ext))
      }
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true, skipLibCheck: true, declaration: true, emitDeclarationOnly: true,
          module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", rootDir: ".", outDir: "out", types: [] },
        vibe: { effectModules: false, effectGlobals: false }, files: [source + "main.ts", source + "core." + ext],
      }))
      const result = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], {
        cwd: dir, encoding: "utf8", timeout: 120000, maxBuffer: 2 << 20,
        env: { ...process.env, GOMAXPROCS: "2" },
      })
      assert.ifError(result.error)
      assert.equal(result.signal, null)
      assert.equal(result.status, 0, phase + ": " + result.stdout + result.stderr)
      declarations[phase] = readFileSync(join(dir, "out", source, "main.d.ts"), "utf8")
    }
    const key = input.syntax === "shorthand" && corpus.pending[input.arity + ":" + input.form]
    if (!raw && key) {
      assert.equal(corpus.owner, "migfix-t3code")
      assert.notEqual(declarations.vibe, declarations.native, "XPASS " + key + ": retire the exact pending entry")
      // The only admitted gap is expansion of omitted Effect defaults. This
      // replacement is a diagnostic bound on that gap; the oracle above and
      // every healthy control still compare raw bytes.
      const expanded = input.arity === 1 ? "Effect<string, never, never>" : "Effect<string, Error, never>"
      const omitted = input.arity === 1 ? "Effect<string>" : "Effect<string, Error>"
      assert.ok(declarations.vibe.includes(expanded), key)
      assert.equal(declarations.vibe.replaceAll(expanded, omitted), declarations.native, key)
    } else assert.equal(declarations.vibe, declarations.native, "t3code: inferred Effect defaults changed: " + JSON.stringify(input))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("t3code: a typed provider dependency preserves its TypeScript importer's raw declaration", () => check(corpus.input))

test("inferred default arguments cover annotations, method forms, module routes and nesting", () => {
  for (const arity of [1, 2, 3]) for (const syntax of ["native", "shorthand"]) for (const form of ["object", "direct", "method"])
    check({ ...corpus.input, arity, syntax, form })
  fc.assert(fc.property(fc.record({
    arity: fc.integer({ min: 1, max: 3 }), syntax: fc.constantFrom("native", "shorthand"),
    form: fc.constantFrom("object", "direct", "method"), depth: fc.integer({ min: 0, max: 2 }),
    route: fc.constantFrom("relative", "package"), namespace: fc.constantFrom("root", "subpath"),
  }), check), { seed: 31111955, numRuns: 24, endOnFailure: true })
})
