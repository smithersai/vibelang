import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const fc = require("fast-check")
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const effect = realpathSync(join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect"))
const runtime = join(repo, "packages/runtime")
const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-storedauthprovider-optional-effect-fallback.json", import.meta.url), "utf8"))

function sourceFor(input) {
  const parameters = "config: { complete?: (values: { token: string }) => Effect.Effect<{ token: string }> | undefined }, values: { token: string }"
  const setup = input.access === "binding" ? "  const { complete } = config\n" : ""
  const callback = input.access === "binding" ? "complete" : input.access === "computed" ? 'config["complete"]' : "config.complete"
  const fallback = input.fallback === "values" ? "values" : JSON.stringify({ token: input.token })
  const body = setup + "  const selected = " + callback + "?.(values) ?? Effect.succeed(" + fallback + ")\n  return yield* selected\n"
  const generator = "Effect.gen(function* () {\n" + body + "})"
  return 'import { Effect } from "effect"\n/** Completes stored credentials lazily. */\n' + (input.home === "function"
    ? "export function run(" + parameters + ") {\n  return " + generator + "\n}\n"
    : "export const run = (" + parameters + ") => " + generator + "\n")
}

async function check(input, { source = sourceFor(input), mutate = false } = {}) {
  assert.ok(existsSync(native), "build the checkout compiler")
  const root = realpathSync(mkdtempSync(join(tmpdir(), "alchemy-optional-effect-")))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(effect, join(root, "node_modules/effect"))
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], declaration: true, outDir: "out" },
      files: ["control.ts", "candidate.vibe"]
    }))
    writeFileSync(join(root, "control.ts"), source)
    writeFileSync(join(root, "candidate.vibe"), source)
    const compile = (args = [], project = "tsconfig.json") => {
      const r = spawnSync(native, ["-p", project, "--pretty", "false", ...args], {
        cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 2 << 20,
        env: { ...process.env, GOMAXPROCS: "2" }
      })
      assert.ifError(r.error)
      assert.equal(r.signal, null)
      return { exit: r.status, output: r.stdout + r.stderr }
    }
    const fixed = compile(["--fix"])
    assert.equal(fixed.exit, 0, fixed.output)
    assert.equal(readFileSync(join(root, "control.ts"), "utf8"), source, "the official fix leaves its TypeScript oracle untouched")
    const converted = readFileSync(join(root, "candidate.vibe"), "utf8")
    assert.doesNotMatch(converted, /Effect\.gen|yield\*/, "the official codemod converts the generator")
    assert.match(converted, /\?\.\(values\) \?\? Effect\.succeed\(/, "the fallback stays a program")
    if (mutate) {
      const fallback = input.fallback === "values" ? "values" : JSON.stringify({ token: input.token })
      const broken = converted.replace("Effect.succeed(" + fallback + ")", fallback)
      assert.notEqual(broken, converted, "the mutation removes the fallback wrapper")
      writeFileSync(join(root, "candidate.vibe"), broken)
      const rejected = compile(["--noEmit"])
      assert.notEqual(rejected.exit, 0, "the historic mixed Effect/value operand must be rejected")
      assert.match(rejected.output, /EK0502/)
      return
    }
    const emitted = compile()
    assert.equal(emitted.exit, 0, emitted.output)
    // API identity: compare public types in both directions, allowing spelling.
    writeFileSync(join(root, "identity.ts"), [
      'type Before = typeof import("./out/control.js").run',
      'type After = typeof import("./out/candidate.js").run',
      "type Assert<T extends true> = T",
      "export type Forward = Assert<[Before] extends [After] ? true : false>",
      "export type Backward = Assert<[After] extends [Before] ? true : false>"
    ].join("\n"))
    writeFileSync(join(root, "identity.tsconfig.json"), JSON.stringify({
      extends: "./tsconfig.json", compilerOptions: { noEmit: true }, files: ["identity.ts"]
    }))
    const identity = compile([], "identity.tsconfig.json")
    assert.equal(identity.exit, 0, "public types agree in both directions: " + identity.output)
    const comments = name => readFileSync(join(root, "out/" + name + ".d.ts"), "utf8").match(/\/\*\*[\s\S]*?\*\//g) || []
    assert.ok(comments("control").some(comment => comment.includes("Completes stored credentials lazily.")), "the documentation control contains a public comment")
    assert.deepEqual(comments("candidate"), comments("control"), "declaration documentation is unchanged")
    const original = await import(pathToFileURL(join(root, "out/control.js")))
    const changed = await import(pathToFileURL(join(root, "out/candidate.js")))
    assert.deepEqual(Object.keys(changed).sort(), Object.keys(original).sort(), "exported names are unchanged")
    const Effect = await import(pathToFileURL(join(effect, "dist/Effect.js")))
    for (const mode of ["absent", "present", "returns-undefined"]) {
      const observe = async (run) => {
        const events = []
        const values = { token: input.token }
        const callback = (value) => {
          events.push("call")
          return mode === "returns-undefined" ? undefined : Effect.sync(() => {
            events.push("run")
            return { token: value.token + "-completed" }
          })
        }
        const config = { get complete() { events.push("lookup"); return mode === "absent" ? undefined : callback } }
        const program = run(config, values)
        assert.deepEqual(events, [], "calling the function must leave the generator body cold")
        const value = await Effect.runPromise(program)
        assert.equal(value === values, mode !== "present" && input.fallback === "values", "a values fallback preserves the original object identity")
        return { events, value }
      }
      const before = await observe(original.run), after = await observe(changed.run)
      const events = mode === "present" ? ["lookup", "call", "run"] : mode === "absent" ? ["lookup"] : ["lookup", "call"]
      const value = { token: mode === "present" ? input.token + "-completed" : input.token }
      assert.deepEqual(before, { events, value }, "the TypeScript control independently establishes the expected order")
      assert.deepEqual(after, before, "the converted optional branch has identical evaluation and success")
    }
    const again = compile(["--fix"])
    assert.equal(again.exit, 0, again.output)
    assert.equal(readFileSync(join(root, "control.ts"), "utf8"), source, "idempotence leaves the TypeScript oracle untouched")
    assert.equal(readFileSync(join(root, "candidate.vibe"), "utf8"), converted, "conversion is idempotent")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("optional Effect fallback coverage quotes the codemod's preservation rule", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})

test("Alchemy StoredAuthProvider: optional callbacks retain a lazy Effect fallback and their declaration", () => check(corpus.input, { source: corpus.sourceCode }))

test("the optional-fallback oracle rejects the historic removed-wrapper mutation", () => check(corpus.input, { source: corpus.sourceCode, mutate: true }))

test("property: optional Effect fallback preserves absent, present and undefined-returning callbacks", async () => {
  await checkProperty(fc, {
    name: "MigrationOptionalEffectFallback", rule: quote,
    command: "node --test packages/compiler/test/optional-effect-fallback.property.test.mjs",
    regressions: new URL("./property-regressions/", import.meta.url), numRuns: 12,
    arbitrary: fc.record({
      home: fc.constantFrom("arrow", "function"), access: fc.constantFrom("property", "computed", "binding"),
      fallback: fc.constantFrom("values", "literal"), token: fc.constantFrom("", "fallback", "token-42", "λ")
    }), check
  })
})
