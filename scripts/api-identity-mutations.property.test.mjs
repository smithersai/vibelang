// Mutation-based API-identity fuzzer (Issue #539).
//
// Universal differential oracle:
//   For every public API mutation (before -> after) whose consumer compatibility
//   genuinely differs under stock TypeScript (a consumer compiles cleanly against
//   one side and fails against the other), `compareApiIdentity(ts, before, after)`
//   MUST report `identical === false` (never silently pass a breaking API change).
//   And as a reflexive control, each side compared against itself MUST report
//   `identical === true && comparisonComplete === true`.

import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"

const { ts, assertLibraries } = createEs5FixtureGuard(loadTypeScript(), "API-identity mutation fuzzer")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const regressions = new URL("./api-identity-mutation-regressions/", import.meta.url)
const propertyName = "api-identity-breaking-mutations"

const compilerOptions = { lib: ["lib.es5.d.ts"] }
const baseNativeOptions = {
  ...compilerOptions,
  strict: true,
  noEmit: true,
  types: [],
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}

// Each mutation defines a genuinely breaking declaration change proven by a
// witness consumer that compiles on one side and fails on the other.
const MUTATIONS = [
  // Control mutations that api-identity ALREADY catches (always run live!)
  {
    id: "return-type-change",
    family: "core-types",
    before: { "index.d.ts": "export declare function f(x: number): number;\n" },
    after: { "index.d.ts": "export declare function f(x: number): string;\n" },
    consumer: 'import { f } from "./pkg/index.js";\nexport const n: number = f(1);\n',
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
  {
    id: "optional-param-vs-undefined",
    family: "core-types",
    before: { "index.d.ts": "export declare function f(x?: number): void;\n" },
    after: { "index.d.ts": "export declare function f(x: number | undefined): void;\n" },
    consumer: 'import { f } from "./pkg/index.js";\nf();\n',
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
  {
    id: "type-param-default-change",
    family: "core-types",
    before: { "index.d.ts": "export interface Box<T = string> { value: T; }\n" },
    after: { "index.d.ts": "export interface Box<T = number> { value: T; }\n" },
    consumer: 'import type { Box } from "./pkg/index.js";\nexport const b: Box = { value: "hi" };\n',
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
  {
    id: "overload-reorder",
    family: "core-types",
    before: {
      "index.d.ts":
        "export declare function parse(x: string | number): string;\nexport declare function parse(x: string): number;\n",
    },
    after: {
      "index.d.ts":
        "export declare function parse(x: string): number;\nexport declare function parse(x: string | number): string;\n",
    },
    consumer: 'import { parse } from "./pkg/index.js";\nexport const s: string = parse("a");\n',
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
  {
    id: "top-level-value-to-type-reexport",
    family: "core-types",
    before: {
      "x.d.ts": "export declare class X { a: number; }\n",
      "index.d.ts": 'import { X } from "./x.js";\nexport { X };\n',
    },
    after: {
      "x.d.ts": "export declare class X { a: number; }\n",
      "index.d.ts": 'import type { X } from "./x.js";\nexport { X };\n',
    },
    consumer: 'import { X } from "./pkg/index.js";\nexport const x = new X();\n',
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
  {
    id: "readonly-property-removed",
    family: "core-types",
    before: { "index.d.ts": "export interface Config { readonly host: string; }\n" },
    after: { "index.d.ts": "export interface Config { host: string; }\n" },
    consumer:
      'import type { Config } from "./pkg/index.js";\nexport function set(c: Config) { c.host = "x"; }\n',
    beforeConsumerOk: false,
    afterConsumerOk: true,
  },
  // Issue #539 breaking mutation families
  {
    id: "constructor-visibility",
    family: "issue-539",
    before: {
      "index.d.ts": "export declare class C { private constructor(); static make(): C; }\n",
    },
    after: {
      "index.d.ts": "export declare class C { constructor(); static make(): C; }\n",
    },
    consumer: 'import { C } from "./pkg/index.js";\nexport const c = new C();\n',
    beforeConsumerOk: false,
    afterConsumerOk: true,
  },
  {
    id: "abstract-member",
    family: "issue-539",
    before: { "index.d.ts": "export declare abstract class A { abstract m(): void; }\n" },
    after: { "index.d.ts": "export declare abstract class A { m(): void; }\n" },
    consumer: 'import { A } from "./pkg/index.js";\nexport class B extends A {}\n',
    beforeConsumerOk: false,
    afterConsumerOk: true,
  },
  {
    id: "variance-annotation",
    family: "issue-539",
    before: { "index.d.ts": "export interface Box<in out T> { v: T; }\n" },
    after: { "index.d.ts": "export interface Box<T> { v: T; }\n" },
    consumer:
      'import type { Box } from "./pkg/index.js";\nexport function widen(b: Box<string>): Box<unknown> { return b; }\n',
    beforeConsumerOk: false,
    afterConsumerOk: true,
  },
  {
    id: "const-type-parameter",
    family: "issue-539",
    before: { "index.d.ts": "export declare function f<const T>(x: T): T;\n" },
    after: { "index.d.ts": "export declare function f<T>(x: T): T;\n" },
    consumer:
      'import { f } from "./pkg/index.js";\nconst v = f(["a"]);\nexport const x: readonly ["a"] = v;\n',
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
  {
    id: "this-parameter-dropped",
    family: "issue-539",
    before: { "index.d.ts": "export declare class C { m(this: C): void; }\n" },
    after: { "index.d.ts": "export declare class C { m(): void; }\n" },
    consumer:
      'import { C } from "./pkg/index.js";\ndeclare const c: C;\nconst fn = c.m;\nfn();\n',
    beforeConsumerOk: false,
    afterConsumerOk: true,
  },
  {
    id: "method-vs-property-bivariance",
    family: "issue-539",
    before: { "index.d.ts": "export interface I { m(x: string): void; }\n" },
    after: { "index.d.ts": "export interface I { m: (x: string) => void; }\n" },
    consumer:
      'import type { I } from "./pkg/index.js";\nexport const i: I = { m(x: "a") { void x; } };\n',
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
  {
    id: "const-enum-vs-enum",
    family: "issue-539",
    before: { "index.d.ts": "export declare enum E { A = 1 }\n" },
    after: { "index.d.ts": "export declare const enum E { A = 1 }\n" },
    consumer: 'import { E } from "./pkg/index.js";\nexport const ref = E;\n',
    consumerOptions: { isolatedModules: true },
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
  {
    id: "namespace-type-only-reexport",
    family: "issue-539",
    before: {
      "x.d.ts": "export declare class X { a: number; }\n",
      "dep.d.ts": 'import { X } from "./x.js";\nexport { X };\n',
      "index.d.ts": 'export * as ns from "./dep.js";\n',
    },
    after: {
      "x.d.ts": "export declare class X { a: number; }\n",
      "dep.d.ts": 'import type { X } from "./x.js";\nexport { X };\n',
      "index.d.ts": 'export * as ns from "./dep.js";\n',
    },
    consumer: 'import { ns } from "./pkg/index.js";\nexport const x = new ns.X();\n',
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
  {
    id: "exact-optional-property-types",
    family: "issue-539",
    before: { "index.d.ts": "export declare const o: { a?: string };\n" },
    after: { "index.d.ts": "export declare const o: { a?: string | undefined };\n" },
    consumer: 'import { o } from "./pkg/index.js";\nexport const copy: { a?: string } = o;\n',
    consumerOptions: { exactOptionalPropertyTypes: true },
    beforeConsumerOk: true,
    afterConsumerOk: false,
  },
]

function writePkg(root, files, extraTsconfig = {}) {
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@demo/mut", version: "1.0.0", type: "module", types: "./index.d.ts" }),
  )
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, ...extraTsconfig } }),
  )
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(root, name), text)
  }
}

function checkConsumer(dir, pkgFiles, consumerText, extraOptions = {}) {
  const pkgDir = join(dir, "pkg")
  rmSync(pkgDir, { recursive: true, force: true })
  writePkg(pkgDir, pkgFiles, extraOptions)
  const consumerFile = join(dir, "consumer.ts")
  writeFileSync(consumerFile, consumerText)
  const program = ts.createProgram([consumerFile], { ...baseNativeOptions, ...extraOptions })
  assertLibraries()
  return ts.getPreEmitDiagnostics(program)
}

class MissedApiMutationError extends Error {}

function checkMutation(mutation) {
  const dir = mkdtempSync(join(tmpdir(), "api-mut-"))
  try {
    const beforeDir = join(dir, "before")
    const afterDir = join(dir, "after")
    writePkg(beforeDir, mutation.before, mutation.consumerOptions)
    writePkg(afterDir, mutation.after, mutation.consumerOptions)

    // 1. Prove via stock TypeScript that the consumer compatibility genuinely differs.
    const beforeDiags = checkConsumer(
      join(dir, "c-before"),
      mutation.before,
      mutation.consumer,
      mutation.consumerOptions,
    )
    const afterDiags = checkConsumer(
      join(dir, "c-after"),
      mutation.after,
      mutation.consumer,
      mutation.consumerOptions,
    )
    assert.equal(
      beforeDiags.length === 0,
      mutation.beforeConsumerOk,
      `${mutation.id}: before witness consumer expectation mismatch: ${beforeDiags.map((d) => d.messageText)}`,
    )
    assert.equal(
      afterDiags.length === 0,
      mutation.afterConsumerOk,
      `${mutation.id}: after witness consumer expectation mismatch: ${afterDiags.map((d) => d.messageText)}`,
    )

    // 2. Reflexive controls: each side MUST be identical to itself.
    const selfBefore = compareApiIdentity(ts, beforeDir, beforeDir, { compilerOptions })
    assert.equal(selfBefore.comparisonComplete, true, `${mutation.id}: before self incomplete`)
    assert.equal(selfBefore.identical, true, `${mutation.id}: before self not identical`)

    // 3. Differential mutation check: compareApiIdentity MUST detect the breaking change!
    const diff = compareApiIdentity(ts, beforeDir, afterDir, { compilerOptions })
    if (diff.identical) {
      throw new MissedApiMutationError(
        `#539: compareApiIdentity reported identical=true for breaking mutation ${mutation.id}`,
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("property: compareApiIdentity detects every consumer-observable breaking declaration mutation", async () => {
  const byId = new Map(MUTATIONS.map((m) => [m.id, m]))
  const records = existsSyncSafe(regressions)
    ? readdirSync(regressions)
        .filter((name) => name.endsWith(".json"))
        .map((name) => JSON.parse(readFileSync(new URL(name, regressions), "utf8")))
        .filter((record) => record.property === propertyName)
    : []
  const pendingIds = new Set(
    records.filter((r) => r.knownFailure).map((r) => r.input.mutationId),
  )
  const live = MUTATIONS.filter((m) => !pendingIds.has(m.id))
  assert.ok(live.length > 0, "at least one mutation must run live")

  let unexpectedKnownFailure
  await checkProperty(fc, {
    name: propertyName,
    rule: "API identity (#539): any declaration mutation that breaks a stock TypeScript consumer must report identical=false.",
    command: "node --test scripts/api-identity-mutations.property.test.mjs",
    regressions,
    numRuns: 30,
    arbitrary: fc.record({
      mutationId: fc.constantFrom(...live.map((m) => m.id)),
    }),
    check(input) {
      try {
        const mutation = byId.get(input.mutationId)
        assert.ok(mutation, `unknown mutation ${input.mutationId}`)
        checkMutation(mutation)
      } catch (error) {
        if (!(error instanceof MissedApiMutationError)) unexpectedKnownFailure = error
        throw error
      }
    },
  })
  assert.ifError(unexpectedKnownFailure)
})

function existsSyncSafe(url) {
  try {
    readdirSync(url)
    return true
  } catch {
    return false
  }
}
