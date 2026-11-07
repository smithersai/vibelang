import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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

// VIP-38: "`vibelang lint` accepts compiler options and files only, never an
// Oxlint config or lint-specific flags", and "the existing Effect
// language-service configuration in `compilerOptions.plugins` selects the
// imported `effecttsgo/*` rules". Each test names its rule as Oxlint spells it
// and turns it on through that plugin entry, with every other imported rule off.
const assigned = JSON.parse(readFileSync(new URL("../../../docs/tools/lint-code-assignments.json", import.meta.url), "utf8"))
const ruleName = (rule) => rule.replace(/^effecttsgo\//, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())
function lint(rules, files) {
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
    const diagnosticSeverity = Object.fromEntries(Object.keys(assigned).map((name) => [name, "off"]))
    for (const [rule, severity] of Object.entries(rules)) {
      assert.ok(ruleName(rule) in assigned, rule + " is an assigned imported rule")
      diagnosticSeverity[ruleName(rule)] = severity
    }
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, noEmit: true,
        plugins: [{ name: "@effect/language-service", diagnosticSeverity }] },
      files: Object.keys(files)
    }))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    return spawnSync(process.execPath, [launcher, "lint", "-p", "tsconfig.json"], { cwd: dir, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native, NO_COLOR: "1" } })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const header = 'import * as Effect from "effect/Effect"\n'

test("floating-effect reports a .vibe file once, under its imported code", { skip }, () => {
  const result = lint({ "effecttsgo/floating-effect": "error" }, { "m.vibe": header + "export const g = Effect.gen(function* () { Effect.succeed(1); return 1 })\n" })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(result.stdout.match(/m\.vibe\(2,/g)?.length, 1, result.stdout)
  assert.match(result.stdout, /m\.vibe\(2,44\): error EK3801: floatingEffect:/)
})

// docs/user/src/getting-started/012-devtools.md: "In a `.vibe` file, a rule this
// table marks "Not needed" or "Covered" does not run". The removed Oxlint
// adapter ran these rules on .vibe files anyway; native lint runs each on its
// .ts twin, under its assigned code, and on the .vibe file not at all.
const tsHeader = 'import * as Context from "effect/Context"\nimport * as Data from "effect/Data"\nimport * as Effect from "effect/Effect"\nimport * as Layer from "effect/Layer"\n' +
  'export class Boom extends Data.TaggedError("Boom")<{ readonly code: string }> {}\n' +
  'export class Port extends Context.Service<Port, { readonly n: number }>()("Port") {}\n' +
  'export class Host extends Context.Service<Host, { readonly name: string }>()("Host") {}\n'
const vibeOnly = [
  ["effect-succeed-with-void", "EK3834",
    header + "export const e = Effect.succeed(undefined)\n",
    "export const e = Effect.succeed(undefined)\n"],
  ["missing-effect-error", "EK3866",
    "error Boom { readonly code: string }\nexport const wrong: () => number!never = effect () => {\n  throw new Boom({ code: \"x\" })\n}\nexport const right: () => number!Boom = effect () => {\n  throw new Boom({ code: \"x\" })\n}\n",
    "export const wrong: Effect.Effect<number> = Effect.fail(new Boom({ code: \"x\" }))\n"],
  ["missing-effect-context", "EK3865",
    "service Port { static readonly key = \"Port\"; n: number }\nexport const wrong: () => number!never!never = effect () => {\n  const p = try Port\n  return p.n\n}\nexport const right: () => number!never!Port = effect () => {\n  const p = try Port\n  return p.n\n}\n",
    "export const wrong: Effect.Effect<number> = Effect.gen(function* () { const p = yield* Port; return p.n })\n"],
  ["missing-layer-context", "EK3868",
    "service Port { static readonly key = \"Port\"; n: number }\nservice Host { static readonly key = \"Host\"; name: string }\nexport const wrong = (l: Layer.Layer<Port, never, Host>): Layer.Layer<Port> => l\nexport const right = (l: Layer.Layer<Port, never, Host>): Layer.Layer<Port, never, Host> => l\n",
    "export const wrong = (l: Layer.Layer<Port, never, Host>): Layer.Layer<Port> => l\n"],
  ["catch-unfailable-effect", "EK3818",
    "export const never = Effect.succeed(1) |> Effect.catch(%, () => Effect.succeed(2))\n",
    "export const never = Effect.succeed(1).pipe(Effect.catch(() => Effect.succeed(2)))\n"],
  ["missed-pipeable-opportunity", "EK3864",
    header + "export const nested = Effect.asVoid(Effect.flatten(Effect.succeed(Effect.succeed(1))))\n",
    "export const nested = Effect.asVoid(Effect.flatten(Effect.succeed(Effect.succeed(1))))\n"],
]
for (const [rule, code, vibe, ts] of vibeOnly) {
  test(`${rule} reports its .ts twin as ${code} and does not run on the .vibe file`, { skip: skipRuntime }, () => {
    const result = lint({ [`effecttsgo/${rule}`]: "error" }, { "m.vibe": vibe, "t.ts": tsHeader + ts })
    const output = result.stdout + result.stderr
    assert.equal(result.status, 1, output)
    assert.equal(output.match(new RegExp(`^t\\.ts\\(\\d+,\\d+\\): error ${code}: ${ruleName(rule)}:`, "gm"))?.length, 1, output)
    assert.doesNotMatch(output, /^m\.vibe\(\d+,\d+\): \w+ EK38\d+:/m, output)
    assert.doesNotMatch(output, /TS5023/, output)
  })
}
