// Metamorphic ESLint rule-soundness and autofix-compilability fuzzer.
//
// Why this exists:
//   Third-party PR #666 reported that @typescript-eslint/consistent-type-imports
//   flagged `import { Held } from "./held.vibe"` as type-only when `Held` was
//   used in a schema field (`schema File { source: Held }`). ESLint's autofix
//   rewrote it to `import type { Held }`, which `vibelang` then rejected with
//   TS1361 because Schema.Struct reads `Held` as a runtime value.
//
// Universal metamorphic oracle:
//   1. Every generated VibeLang module compiles cleanly under `vibelang`.
//   2. Running ESLint with real @typescript-eslint + core scope/import rules
//      produces zero fatal errors and zero false-positive errors on clean code.
//   3. Whenever ESLint's `verifyAndFix` rewrites a compiling .vibe module,
//      the rewritten module MUST still parse with `vibelang/eslint`, compile
//      cleanly under `vibelang` with zero diagnostics, and be fix-idempotent.
//   4. Anti-vacuity controls: pure type-only imports (`type T = typeof Held`,
//      `type T = PlainType`, `type E = number!Boom`) MUST still be flagged by
//      `consistent-type-imports` and compile cleanly after its autofix.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import vibelang, { parseForESLint } from "../../eslint.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { repo } from "./helpers.mjs"

const require = createRequire(import.meta.url)
const { Linter } = require("eslint")
const tseslint = require("typescript-eslint")
const fc = require("fast-check")

const compilerBin = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const effectNodeModules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const runtimePackageDir = join(repo, "packages/runtime")
const regressions = new URL("./property-regressions/", import.meta.url)
const propertyName = "ESLintValueImportAutofixSoundness"

const DEFS_SOURCE = [
  "export schema Held { name: string }",
  'export schema HeldAlias = "a" | "b"',
  "export schema error HeldErr { code: number }",
  "export error Boom { id: string }",
  'export service Store { static readonly key = "test/Store"; get(id: string): string!Boom }',
  "export data State { Idle; Active { count: number } }",
  "export effect function load(id: string): string!Boom { return id }",
  "export interface PlainType { label: string }",
  "export type PlainAlias = { ok: boolean }",
  "",
].join("\n")

const VALUE_IMPORT_SCENARIOS = [
  // Schema codec value reads (PR #666 family)
  {
    id: "schema-field",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File { source: ${r} }`,
  },
  {
    id: "schema-optional-field",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File { source?: ${r} }`,
  },
  {
    id: "schema-readonly-field",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File { readonly source: ${r} }`,
  },
  {
    id: "schema-array-field",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File { items: ${r}[] }`,
  },
  {
    id: "schema-readonly-array-field",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File { items: ReadonlyArray<${r}> }`,
  },
  {
    id: "schema-record-field",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File { map: Record<string, ${r}> }`,
  },
  {
    id: "schema-nested-union-field",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File { nested: { inner: ${r} | null } }`,
  },
  {
    id: "schema-tuple-field",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File { pair: readonly [${r}, string] }`,
  },
  {
    id: "schema-alias-bare",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File = ${r}`,
  },
  {
    id: "schema-alias-array",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema File = ${r}[]`,
  },
  {
    id: "schema-alias-ref-alias",
    family: "schema-import",
    symbol: "HeldAlias",
    body: (r) => `export schema File { code: ${r} }`,
  },
  {
    id: "schema-error-field",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema error FileErr { source: ${r} }`,
  },
  {
    id: "schema-error-nested-array",
    family: "schema-import",
    symbol: "Held",
    body: (r) => `export schema error FileErr { items: Array<${r}> }`,
  },
  {
    id: "schema-ref-schema-error",
    family: "schema-import",
    symbol: "HeldErr",
    body: (r) => `export schema File { err: ${r} }`,
  },
  // Non-schema VibeLang value-consuming constructs
  {
    id: "service-try",
    family: "vibe-value-import",
    symbol: "Store",
    body: (r) => `export effect function run() { const s = try ${r}; return try s.get("x") }`,
  },
  {
    id: "service-provide",
    family: "vibe-value-import",
    symbol: "Store",
    body: (r) =>
      `export effect function run(impl: ${r}.Shape) { provide ${r} = impl { const s = try ${r}; return try s.get("x") } }`,
  },
  {
    id: "service-provide-only",
    family: "vibe-value-import",
    symbol: "Store",
    body: (r) =>
      `export effect function run(impl: ${r}.Shape) { provide ${r} = impl { return 1 } }`,
  },
  {
    id: "service-layer-provide",
    family: "vibe-value-import",
    symbol: "Store",
    body: (r) =>
      `export effect function run(impl: ${r}.Shape) { const layer = Layer.succeed(${r}, impl); provide layer { return 1 } }`,
  },
  {
    id: "error-throw",
    family: "vibe-value-import",
    symbol: "Boom",
    body: (r) => `export effect function fail(): string!${r} { throw new ${r}({ id: "1" }) }`,
  },
  {
    id: "error-match-when",
    family: "vibe-value-import",
    symbol: "Boom",
    body: (r) =>
      `export function inspect(e: ${r} | number): number { return match (e) { when ${r}: 1; default: 0; } }`,
  },
  {
    id: "error-is-test",
    family: "vibe-value-import",
    symbol: "Boom",
    body: (r) => `export function isBoom(e: unknown): boolean { return e is ${r} }`,
  },
  {
    id: "error-is-binding",
    family: "vibe-value-import",
    symbol: "Boom",
    body: (r) =>
      `export function getId(e: unknown): string { if (e is ${r}(let b)) return b.id; return "" }`,
  },
  {
    id: "error-match-extractor",
    family: "vibe-value-import",
    symbol: "Boom",
    body: (r) =>
      `export function getId(e: unknown): string { return match (e) { when ${r}(let b): b.id; default: ""; } }`,
  },
  {
    id: "schema-error-is",
    family: "vibe-value-import",
    symbol: "HeldErr",
    body: (r) => `export function isErr(e: unknown): boolean { return e is ${r} }`,
  },
  {
    id: "schema-error-match",
    family: "vibe-value-import",
    symbol: "HeldErr",
    body: (r) =>
      `export function getCode(e: unknown): number { return match (e) { when ${r}(let b): b.code; default: 0; } }`,
  },
  {
    id: "data-construct",
    family: "vibe-value-import",
    symbol: "State",
    body: (r) => `export function make() { return ${r}.Active({ count: 1 }) }`,
  },
  {
    id: "data-match-construct",
    family: "vibe-value-import",
    symbol: "State",
    body: (r) =>
      `export function next(s: ${r}): ${r} { return match (s) { when { _tag: "Idle" }: ${r}.Active({ count: 1 }); when { _tag: "Active" }: ${r}.Idle(); } }`,
  },
  {
    id: "effect-fn-try",
    family: "vibe-value-import",
    symbol: "load",
    body: (r) => `export effect function run(id: string) { return try ${r}(id) }`,
  },
  {
    id: "effect-fn-fork-join",
    family: "vibe-value-import",
    symbol: "load",
    body: (r) => `export effect function run(id: string) { const f = fork ${r}(id); return join f }`,
  },
  {
    id: "effect-fn-for-concurrent",
    family: "vibe-value-import",
    symbol: "load",
    body: (r) =>
      `export effect function run(ids: ReadonlyArray<string>) { for concurrent(2) (const id of ids) { try ${r}(id) } }`,
  },
  {
    id: "effect-fn-catch-handler",
    family: "vibe-value-import",
    symbol: "load",
    body: (r) =>
      `export effect function run(id: string): string!! { return ${r}(id) catch () => "fallback" }`,
  },
  {
    id: "try-all-import",
    family: "vibe-value-import",
    symbol: "load",
    body: (r) => `export effect function run() { return try.all [${r}("a"), ${r}("b")] }`,
  },
  {
    id: "try-race-import",
    family: "vibe-value-import",
    symbol: "load",
    body: (r) => `export effect function run() { return try.race [${r}("a"), ${r}("b")] }`,
  },
  {
    id: "pipe-import",
    family: "vibe-value-import",
    symbol: "load",
    body: (r) => `export effect function run(id: string) { return try (id |> ${r}(%)) }`,
  },
  {
    id: "uninterruptible-import",
    family: "vibe-value-import",
    symbol: "load",
    body: (r) =>
      `export effect function run(id: string) { uninterruptible { restore { return try ${r}(id) } } }`,
  },
  {
    id: "producer-for-try",
    family: "vibe-value-import",
    symbol: "load",
    body: (r) => `export effect function* gen(id: string) { yield try ${r}(id) }`,
  },
]

const TYPE_ONLY_SCENARIOS = [
  {
    id: "type-interface-alias",
    symbol: "PlainType",
    body: (r) => `export type Alias = ${r}`,
  },
  {
    id: "type-typeof-schema",
    symbol: "Held",
    body: (r) => `export type Alias = { source: typeof ${r} }`,
  },
  {
    id: "type-param-return",
    symbol: "PlainAlias",
    body: (r) => `export function id(x: ${r}): ${r} { return x }`,
  },
  {
    id: "type-effect-error-slot",
    symbol: "Boom",
    body: (r) => `export type Failing = number!${r}`,
  },
  {
    id: "type-effect-service-slot",
    symbol: "Store",
    body: (r) => `export type NeedsStore = number!never!${r}`,
  },
]

const IMPORT_STYLES = ["named", "aliased", "namespace"]
const FIX_STYLES = ["separate-type-imports", "inline-type-imports"]

function buildSource(scenario, importStyle) {
  switch (importStyle) {
    case "named":
      return `import { ${scenario.symbol} } from "./defs.vibe"\n${scenario.body(scenario.symbol)}\n`
    case "aliased": {
      const alias = `${scenario.symbol}Ref`
      return `import { ${scenario.symbol} as ${alias} } from "./defs.vibe"\n${scenario.body(alias)}\n`
    }
    case "namespace":
      return `import * as defs from "./defs.vibe"\n${scenario.body(`defs.${scenario.symbol}`)}\n`
    default:
      throw new Error(`unknown importStyle: ${importStyle}`)
  }
}

function makeConfig(fixStyle) {
  return [
    {
      files: ["**/*.vibe"],
      languageOptions: { parser: vibelang, sourceType: "module" },
      plugins: { "@typescript-eslint": tseslint.plugin },
      rules: {
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle },
        ],
        "@typescript-eslint/no-unused-vars": "error",
        "@typescript-eslint/no-import-type-side-effects": "error",
        "@typescript-eslint/no-use-before-define": "error",
        "@typescript-eslint/array-type": ["error", { default: "generic", readonly: "generic" }],
        "no-undef": "off",
        "no-redeclare": "error",
        "no-shadow": "error",
        "prefer-const": "error",
        "no-var": "error",
        "no-unreachable": "error",
      },
    },
  ]
}

function compileProject(files) {
  assert.ok(existsSync(compilerBin), `missing compiler binary: ${compilerBin}`)
  assert.ok(existsSync(effectNodeModules), `missing effect node_modules: ${effectNodeModules}`)
  const dir = mkdtempSync(join(tmpdir(), "vl-eslint-fuzz-"))
  try {
    const nm = join(dir, "node_modules")
    mkdirSync(nm, { recursive: true })
    symlinkSync(join(effectNodeModules, "effect"), join(nm, "effect"))
    symlinkSync(runtimePackageDir, join(nm, "vibelang-runtime"))
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
        },
      }),
    )
    writeFileSync(join(dir, "defs.vibe"), DEFS_SOURCE)
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content)
    }
    const result = spawnSync(compilerBin, ["-p", dir], { encoding: "utf8", timeout: 60_000 })
    return {
      status: result.status,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function lintAndFix(code, fixStyle) {
  const linter = new Linter({ configType: "flat", cwd: "/" })
  const config = makeConfig(fixStyle)
  const initial = linter.verify(code, config, { filename: "/main.vibe" })
  const fixed = linter.verifyAndFix(code, config, { filename: "/main.vibe" })
  const second = fixed.fixed
    ? linter.verifyAndFix(fixed.output, config, { filename: "/main.vibe" })
    : { fixed: false, output: fixed.output, messages: fixed.messages }
  return { initial, fixed, second }
}

class SchemaImportTypeBug extends Error {}

test("all generated ESLint fuzz scenarios compile cleanly under vibelang before linting", () => {
  const files = {}
  let i = 0
  for (const scenario of [...VALUE_IMPORT_SCENARIOS, ...TYPE_ONLY_SCENARIOS]) {
    for (const style of IMPORT_STYLES) {
      files[`case_${String(i++).padStart(3, "0")}_${scenario.id}_${style}.vibe`] = buildSource(
        scenario,
        style,
      )
    }
  }
  const compiled = compileProject(files)
  assert.equal(compiled.status, 0, `generated corpus must compile cleanly:\n${compiled.output}`)
})

test("property: ESLint rules and autofixes preserve VibeLang compilability across all value-import forms", async () => {
  const byId = new Map(VALUE_IMPORT_SCENARIOS.map((s) => [s.id, s]))
  const records = readdirSync(regressions)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(new URL(name, regressions), "utf8")))
    .filter((record) => record.property === propertyName)
  const pendingFamilies = new Set(
    records.filter((record) => record.knownFailure && record.pendingFamily).map((record) => record.pendingFamily),
  )
  const available = VALUE_IMPORT_SCENARIOS.filter((s) => !pendingFamilies.has(s.family))
  assert.ok(available.length > 0, "at least one value-import scenario family must run live")

  let unexpectedKnownFailure
  await checkProperty(fc, {
    name: propertyName,
    rule: "Chapter 6 & 7: ESLint rules and autofixes must not report value-used VibeLang imports as type-only/unused or break vibelang compilation.",
    command:
      "cd packages/compiler/test/eslint && node --test eslint-autofix-soundness.property.test.mjs",
    regressions,
    numRuns: 100,
    arbitrary: fc.record({
      scenarioId: fc.constantFrom(...available.map((s) => s.id)),
      importStyle: fc.constantFrom(...IMPORT_STYLES),
      fixStyle: fc.constantFrom(...FIX_STYLES),
    }),
    check(input) {
      try {
        const scenario = byId.get(input.scenarioId)
        assert.ok(scenario, `unknown scenario ${input.scenarioId}`)
        const code = buildSource(scenario, input.importStyle)
        const { initial, fixed, second } = lintAndFix(code, input.fixStyle)

        assert.deepEqual(
          initial.filter((m) => m.fatal),
          [],
          `fatal ESLint parse error on valid ${input.scenarioId} (${input.importStyle}): ${JSON.stringify(initial)}`,
        )

        const unexpectedRules = initial.filter(
          (m) =>
            m.ruleId === "@typescript-eslint/consistent-type-imports" ||
            m.ruleId === "@typescript-eslint/no-unused-vars" ||
            m.ruleId === "@typescript-eslint/no-use-before-define" ||
            m.ruleId === "no-redeclare" ||
            m.ruleId === "no-shadow",
        )

        if (fixed.fixed) {
          assert.doesNotThrow(
            () => parseForESLint(fixed.output, { filePath: "/main.vibe" }),
            `ESLint autofix broke vibelang/eslint parsing:\n${fixed.output}`,
          )
          assert.equal(second.fixed, false, `ESLint autofix was not idempotent:\n${fixed.output}`)
          const recompiled = compileProject({ "main.vibe": fixed.output })
          if (
            recompiled.status !== 0 &&
            scenario.family === "schema-import" &&
            /TS1361/.test(recompiled.output)
          ) {
            throw new SchemaImportTypeBug(
              `ESLint consistent-type-imports autofix broke vibelang compilation (TS1361) for ${input.scenarioId} (${input.importStyle}, ${input.fixStyle}):\n${recompiled.output}`,
            )
          }
          assert.equal(
            recompiled.status,
            0,
            `ESLint autofix broke vibelang compilation for ${input.scenarioId} (${input.importStyle}, ${input.fixStyle}):\n` +
              `--- before ---\n${code}--- after ---\n${fixed.output}--- compiler ---\n${recompiled.output}`,
          )
        }

        assert.deepEqual(
          unexpectedRules.map((m) => `${m.ruleId}: ${m.message}`),
          [],
          `false-positive ESLint report on valid value import ${input.scenarioId} (${input.importStyle}):\n${code}`,
        )
      } catch (error) {
        if (!(error instanceof SchemaImportTypeBug)) unexpectedKnownFailure = error
        throw error
      }
    },
    artifacts: (input) => {
      const scenario = byId.get(input.scenarioId)
      return {
        "defs.vibe": DEFS_SOURCE,
        "main.vibe": buildSource(scenario, input.importStyle),
      }
    },
  })
  assert.ifError(unexpectedKnownFailure)
})

test("control: type-only imports (including typeof Schema and effect error/service type slots) are flagged and compile after autofix", () => {
  const fixedFiles = {}
  for (const scenario of TYPE_ONLY_SCENARIOS) {
    for (const importStyle of ["named", "aliased"]) {
      for (const fixStyle of FIX_STYLES) {
        const code = buildSource(scenario, importStyle)
        const { initial, fixed, second } = lintAndFix(code, fixStyle)
        assert.ok(
          initial.some((m) => m.ruleId === "@typescript-eslint/consistent-type-imports"),
          `control must fire consistent-type-imports for ${scenario.id} (${importStyle}):\n${code}`,
        )
        assert.equal(fixed.fixed, true, `control must autofix for ${scenario.id} (${importStyle})`)
        assert.equal(second.fixed, false, `control autofix must be idempotent for ${scenario.id}`)
        fixedFiles[`ctrl_${scenario.id}_${importStyle}_${fixStyle.replace(/-/g, "_")}.vibe`] =
          fixed.output
      }
    }
  }
  const compiled = compileProject(fixedFiles)
  assert.equal(
    compiled.status,
    0,
    `autofixed type-only controls must still compile cleanly:\n${compiled.output}`,
  )
})
