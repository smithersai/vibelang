import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// VibeLang's own diagnostics are linked only into the real command, so a port
// such as floating-effect is proved here and not in the lint package's Go tests.
const launcher = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const skip = !existsSync(native) && "run sh scripts/build-vibelang.sh"
const runtime = fileURLToPath(new URL("../../runtime/", import.meta.url))
const skipRuntime = skip || (!existsSync(join(runtime, "dist")) && "build packages/runtime")

function lint(rules, source) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-lint-rules-"))
  try {
    const effect = dirname(createRequire(import.meta.url).resolve("effect/package.json"))
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(effect, join(dir, "node_modules", "effect"))
    // try, catch and service declarations call the runtime: install it as published.
    mkdirSync(join(dir, "node_modules", "vibelang-runtime"))
    cpSync(join(runtime, "package.json"), join(dir, "node_modules", "vibelang-runtime", "package.json"))
    if (existsSync(join(runtime, "dist"))) cpSync(join(runtime, "dist"), join(dir, "node_modules", "vibelang-runtime", "dist"), { recursive: true })
    writeFileSync(join(dir, "package.json"), '{"private":true,"type":"module"}')
    writeFileSync(join(dir, "tsconfig.json"), '{"compilerOptions":{"target":"es2022","module":"nodenext","moduleResolution":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"files":["m.vibe"]}')
    writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify({ rules }))
    writeFileSync(join(dir, "m.vibe"), source)
    return spawnSync(process.execPath, [launcher, "lint"], { cwd: dir, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native, NO_COLOR: "1" } })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const header = 'import * as Effect from "effect/Effect"\n'

// toolcover-alchemy's two repros: 0 errors under vibelang lint, against an error for the .ts twin under Oxlint.
test("effect-succeed-with-void reports a .vibe file under its imported code", { skip }, () => {
  const result = lint({ "effecttsgo/effect-succeed-with-void": "error" }, header + "export const e = Effect.succeed(undefined)\n")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /m\.vibe\(2,18\): error EK3834: effectSucceedWithVoid:/)
  assert.equal(result.stderr, "")
})

test("floating-effect reports a .vibe file once, through its port", { skip }, () => {
  const result = lint({ "effecttsgo/floating-effect": "error" }, header + "export const g = Effect.gen(function* () { Effect.succeed(1); return 1 })\n")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(result.stdout.match(/m\.vibe\(2,/g)?.length, 1, result.stdout)
  assert.match(result.stdout, /error EK4801:/)
})

// alchemy's 207 reports of unknown types came from an unbuilt tree: each sat on a
// compiler error that vibelang lint does not print (TS6305, TS2307 upstream).
// On a typed program each rule reports the fault the compiler finds, once, and
// not the correct twin beside it.
const typeRules = [
  ["missing-effect-error", "error Boom { readonly code: string }\nexport const wrong: () => number!never = effect () => {\n  throw new Boom({ code: \"x\" })\n}\nexport const right: () => number!Boom = effect () => {\n  throw new Boom({ code: \"x\" })\n}\n", /m\.vibe\(2,14\): error EK3866: missingEffectError: Missing errors Boom /],
  ["missing-effect-context", "service Port { static readonly key = \"Port\"; n: number }\nexport const wrong: () => number!never!never = effect () => {\n  const p = try Port\n  return p.n\n}\nexport const right: () => number!never!Port = effect () => {\n  const p = try Port\n  return p.n\n}\n", /m\.vibe\(2,14\): error EK3865: missingEffectContext: .*`Port`/],
  ["missing-layer-context", "service Port { static readonly key = \"Port\"; n: number }\nservice Host { static readonly key = \"Host\"; name: string }\nexport const wrong = (l: Layer.Layer<Port, never, Host>): Layer.Layer<Port> => l\nexport const right = (l: Layer.Layer<Port, never, Host>): Layer.Layer<Port, never, Host> => l\n", /m\.vibe\(3,80\): error EK3868: missingLayerContext: Missing 'Host' /],
  ["catch-unfailable-effect", "error Boom { readonly code: string }\nconst fail = (): number!Boom => effect { throw new Boom({ code: \"x\" }) }\nexport const never = Effect.succeed(1) |> Effect.catch(%, () => Effect.succeed(2))\nexport const fails = fail() |> Effect.catch(%, () => Effect.succeed(2))\nexport const syntax = effect () => (try fail()) catch effect (e) => 2\n", /m\.vibe\(3,43\): error EK3818: catchUnfailableEffect:/],
]
for (const [rule, source, expected] of typeRules) {
  test(`${rule} reports the faulty .vibe declaration and not its correct twin`, { skip: skipRuntime }, () => {
    const result = lint({ [`effecttsgo/${rule}`]: "error" }, source)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, expected)
    assert.equal(result.stdout.match(/m\.vibe\(/g)?.length, 1, result.stdout)
    assert.equal(result.stderr, "")
  })
}

// try x is $try(x) and x catch h is $catchExpression(() => x, h) to the checker,
// so the rule read alchemy's AnomalyDetector.vibe as three nested calls.
test("missed-pipeable-opportunity counts no try or catch as a stage", { skip: skipRuntime }, () => {
  const source = 'import * as Effect from "effect/Effect"\nimport * as Option from "effect/Option"\nimport * as Stream from "effect/Stream"\n' +
    "error Missing { readonly id: string }\n" +
    "const items = (id: string): Stream.Stream<{ alias: string }, Missing> => Stream.fromIterable([{ alias: id }])\n" +
    "export const find = effect (alias: string) => {\n" +
    "  const summary = (Option.getOrUndefined(\n" +
    "    try (items(alias)\n" +
    "      |> Stream.filter(%, (s) => s.alias === alias)\n" +
    "      |> Stream.runHead(%)),\n" +
    "  )) catch effect (e) => match (e) {\n" +
    '    when { _tag: "Missing" }: undefined;\n' +
    "  }\n" +
    "  return summary\n" +
    "}\n" +
    "export const nested = Effect.asVoid(Effect.flatten(Effect.succeed(Effect.succeed(1))))\n" +
    "export const piped = Effect.succeed(1) |> Effect.map(%, (n) => n + 1) |> Effect.map(%, (n) => n + 2)\n"
  const result = lint({ "effecttsgo/missed-pipeable-opportunity": "error" }, source)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(result.stdout.match(/m\.vibe\(/g)?.length, 1, result.stdout)
  assert.match(result.stdout, /m\.vibe\(16,23\): error EK3864: missedPipeableOpportunity:/)
  assert.equal(result.stderr, "")
})
