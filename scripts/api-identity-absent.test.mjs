// A declaration that neither snapshot emitted, for the same reason, compares
// equal; exports that reach it are unavailable one by one; nothing else passes.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/t3code-absent-on-both-sides.json", import.meta.url), "utf8"))
const tsOptions = { compilerOptions: { allowImportingTsExtensions: true } }

function fixture(before, after, fn) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-absent-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      mkdirSync(join(root, side), { recursive: true })
      for (const [name, text] of Object.entries(files)) {
        mkdirSync(join(root, side, name, ".."), { recursive: true })
        writeFileSync(join(root, side, name), text)
      }
    }
    return fn(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const entries = keys => Object.fromEntries(keys.map(key => [key, key]))
const compare = (before, after, keys, absentDeclarations, extra = {}) => fixture(before, after, (a, b) =>
  compareApiIdentity(ts, a, b, { beforeEntrypoints: entries(keys), afterEntrypoints: entries(keys), absentDeclarations, ...extra }))
const groupBlockers = result => result.environmentDiagnostics.filter(d => d.blocking && d.scope !== "export")
const unavailable = result => result.environmentDiagnostics.filter(d => d.blocking && d.scope === "export")
  .map(d => d.entrypoint + "#" + d.export).sort()
const same = absent => ({ before: absent, after: absent })

test("t3code mobile: same-reason absences compare equal; only exports reaching them are unavailable", () => {
  const { files, entries: keys, absent } = corpus.mobile
  // Before the fix the first entry group stopped on TS2307 with no per-export result.
  const legacy = compare(files, files, keys)
  assert.equal(legacy.comparisonComplete, false)
  assert.ok(groupBlockers(legacy).length)
  const result = compare(files, files, keys, same(absent), { entryBatchSize: 2 })
  assert.deepEqual(groupBlockers(result), [], JSON.stringify(result, null, 2))
  assert.deepEqual(unavailable(result), [
    "apps/mobile/src/connection/runtime.d.ts#makeRuntime",
    "apps/mobile/src/persistence/layer.d.ts#Layer",
  ])
  assert.match(result.environmentDiagnostics.find(d => d.export === "makeRuntime").diagnostic, /(migration|platform)\.d\.ts, absent on both sides with the same emit diagnostics/)
  assert.equal(result.comparisonComplete, false)
  assert.equal(result.identical, false)
  assert.deepEqual(result.absentDeclarations.map(d => [d.declaration, d.equal]), [
    ["apps/mobile/src/connection/migration.d.ts", true], ["apps/mobile/src/connection/platform.d.ts", true]])
  // The references themselves stay visible, without blocking.
  assert.ok(result.environmentDiagnostics.some(d => !d.blocking && /TS2307/.test(d.diagnostic) && d.absentDeclaration))
})

test("t3code mobile: an export that does not reach the absent module is still compared in a later group", () => {
  const { files, entries: keys, absent } = corpus.mobile
  const changed = { ...files, "apps/mobile/src/connection/onboarding.d.ts": files["apps/mobile/src/connection/onboarding.d.ts"].replace("done: boolean", "done: string") }
  const result = compare(files, changed, keys, same(absent), { entryBatchSize: 1 })
  assert.deepEqual(groupBlockers(result), [])
  assert.deepEqual(result.typeDifferences.map(d => d.entrypoint + "#" + d.export), ["apps/mobile/src/connection/onboarding.d.ts#OnboardingStep"])
  assert.equal(result.identical, false)
})

test("t3code mobile: absences with different emit diagnostics are unavailable, never equal", () => {
  const { files, entries: keys, absent, candidateAbsent } = corpus.mobile
  const result = compare(files, files, keys, { before: absent, after: candidateAbsent })
  assert.deepEqual(groupBlockers(result), [])
  assert.deepEqual(result.absentDeclarations.map(d => d.equal), [false, false])
  for (const key of ["apps/mobile/src/connection/migration.d.ts", "apps/mobile/src/connection/platform.d.ts"])
    assert.match(result.environmentDiagnostics.find(d => d.entrypoint === key && d.export === "*").diagnostic, /different emit diagnostics/)
  assert.equal(result.identical, false)
  // Emit evidence for one side only is not a shared reason either.
  const oneSided = compare(files, files, keys, { before: absent })
  assert.deepEqual(oneSided.absentDeclarations.map(d => d.equal), [false, false])
  assert.equal(oneSided.identical, false)
})

test("t3code server: names re-exported through export * from absent contracts files are unavailable per export", () => {
  const { files, entries: keys, absent } = corpus.server
  const result = compare(files, files, keys, same(absent), tsOptions)
  assert.deepEqual(groupBlockers(result), [], JSON.stringify(result, null, 2))
  assert.deepEqual(unavailable(result), ["apps/server/src/auth/RpcAuthorization.d.ts#authorize"])
  assert.match(result.environmentDiagnostics.find(d => d.export === "authorize").diagnostic, /packages\/contracts\/src\/(environmentHttp|guestStream|orchestrationV2|rpc)\.d\.ts/)
  assert.deepEqual(result.typeDifferences, [])
  // threadOf reaches only the present ids.d.ts: a changed type there still fails.
  const changed = { ...files, "packages/contracts/src/ids.d.ts": "export type ThreadId = number;\n" }
  const negative = compare(files, changed, keys, same(absent), tsOptions)
  assert.deepEqual(negative.typeDifferences.map(d => d.export), ["threadOf"])
})

test("a declaration missing on one side only never compares equal", () => {
  const { files, entries: keys, absent } = corpus.server
  const present = { ...files, "packages/contracts/src/rpc.d.ts": "export type RpcScopeAuthorization = string;\n" }
  for (const [before, after] of [[files, present], [present, files]]) {
    const result = compare(before, after, keys, same(absent), tsOptions)
    assert.equal(result.identical, false)
    assert.ok(groupBlockers(result).some(d => /one-sided absence never compares equal/.test(d.diagnostic)))
  }
})

test("t3code client-runtime: a module tsc refuses stays TypeScript, and a .vibe module that writes its declaration is refused", () => {
  const { files, entries: keys, absent, candidateDeclaration } = corpus.clientRuntime
  // Both snapshots keep the .ts: tsc reports TS7056 at the same nodes, so the absences compare equal.
  const kept = compare(files, files, keys, same(absent), tsOptions)
  assert.deepEqual(groupBlockers(kept), [], JSON.stringify(kept, null, 2))
  assert.deepEqual(kept.absentDeclarations.map(d => d.equal), [true, true])
  assert.deepEqual(unavailable(kept), ["packages/client-runtime/src/rpc/client.d.ts#connect"])
  assert.deepEqual(kept.typeDifferences, [])
  // A .vibe conversion compiles clean and writes the type tsc would not serialize: nothing proves it equal.
  const written = compare(files, { ...files, ...candidateDeclaration }, keys, same(absent), tsOptions)
  assert.equal(written.identical, false)
  assert.ok(groupBlockers(written).some(d => /one-sided absence never compares equal/.test(d.diagnostic)))
})

test("negative controls: changed references into an absent module never pass", () => {
  const absent = same({ "absent.d.ts": [{ code: 2883, file: "absent.ts", line: 1, column: 1 }] })
  const control = (before, after) => {
    const result = compare({ "index.d.ts": before }, { "index.d.ts": after }, ["index.d.ts"], absent)
    assert.equal(result.identical, false, JSON.stringify(result, null, 2))
    return result
  }
  const head = 'import type { Foo, Bar } from "./absent";\n'
  // The candidate changes a type that refers to the absent module.
  control(head + "export type T = { a: Foo; b: string };", head + "export type T = { a: Foo; b: number };")
  // Swapped references, in mapped, conditional, generic and heritage positions.
  control(head + "export type T = Foo;", head + "export type T = Bar;")
  control(head + "export type T = { [K in keyof Foo]: string };", head + "export type T = { [K in keyof Bar]: string };")
  control(head + "export type T<X> = X extends Foo ? 1 : 2;", head + "export type T<X> = X extends Bar ? 1 : 2;")
  control(head + "export interface T extends Foo {}", head + "export interface T extends Bar {}")
  control('import * as A from "./absent";\nexport type T = A.Foo;', 'import * as A from "./absent";\nexport type T = A.Bar;')
  control('export type T = import("./absent").Foo;', 'export type T = import("./absent").Bar;')
  // Re-export renamed, and a dropped export * of the absent module.
  control('export { Foo as T } from "./absent";', 'export { Bar as T } from "./absent";')
  const dropped = control('export * from "./absent";\nexport type U = string;', "export type U = string;")
  assert.ok(groupBlockers(dropped).some(d => /References into absent declarations differ/.test(d.diagnostic)))
})

test("an unused reference into a same-reason absence leaves the module identical", () => {
  const absent = same({ "absent.d.ts": [{ code: 7056, file: "absent.ts", line: 3, column: 14 }] })
  const text = 'import type { Foo } from "./absent";\nexport type U = { value: string };'
  const result = compare({ "index.d.ts": text }, { "index.d.ts": text }, ["index.d.ts", "absent.d.ts"], absent)
  assert.equal(result.comparisonComplete, true, JSON.stringify(result, null, 2))
  assert.equal(result.identical, true)
  assert.deepEqual(result.absentDeclarations.map(d => d.equal), [true])
})

test("a shared ambient environment keeps comparing past an absent entry point", () => {
  // @types/node is such an environment in the t3code witnesses.
  const globals = { "../shared/globals.d.ts": "declare var sharedGlobal: number;\n" }
  const head = '/// <reference path="../shared/globals.d.ts" />\n'
  const files = { ...globals, "index.d.ts": head + "export declare const value: string;\n",
    "dep.d.ts": head + 'import type { Gone } from "./gone";\nexport type Dep = { gone: Gone };\n' }
  const keys = ["dep.d.ts", "gone.d.ts", "index.d.ts"]
  const absent = { before: { "gone.d.ts": [{ code: 2883, file: "gone.ts", line: 4, column: 7 }] },
    after: { "gone.d.ts": [{ code: 2883, file: "gone.vibe", line: 3, column: 7 }] } }
  const changed = { ...files, "index.d.ts": files["index.d.ts"].replace("value: string", "value: number") }
  const result = compare(files, changed, keys, absent)
  assert.deepEqual(groupBlockers(result), [], JSON.stringify(result, null, 2))
  assert.deepEqual(unavailable(result), ["dep.d.ts#Dep", "gone.d.ts#*"])
  assert.deepEqual(result.typeDifferences.map(d => d.export), ["value"])
})

test("property: random absent-file sets never pass a change and never block unrelated modules", async () => {
  await checkProperty(fc, {
    name: "api-identity-absent-on-both-sides",
    rule: "t3code: an absence with the same emit diagnostics on both sides compares equal; dependents are unavailable per export; one-sided absences and real changes never pass",
    command: "node --test scripts/api-identity-absent.test.mjs",
    numRuns: 20,
    arbitrary: fc.record({
      edges: fc.array(fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }), { minLength: 5, maxLength: 5 }),
      absent: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
      mutate: fc.option(fc.integer({ min: 0, max: 4 })),
      oneSided: fc.boolean(),
      batch: fc.integer({ min: 1, max: 5 }),
      ambient: fc.boolean(),
      sameReason: fc.boolean(),
    }),
    check: ({ edges, absent, mutate, oneSided, batch, ambient, sameReason }) => {
      // Module i may refer to lower modules only; absent ones are not emitted.
      const deps = i => edges[i].map((edge, j) => edge && j < i ? j : -1).filter(j => j >= 0)
      const module = (i, mutated) => (ambient ? '/// <reference path="../shared/globals.d.ts" />\n' : "") + deps(i).map(j => `import type { T${j} } from "./m${j}";\n`).join("") +
        `export type T${i} = { own: ${mutated ? "number" : "string"}${deps(i).map(j => `; d${j}: T${j}`).join("")} };\n` +
        `export declare const plain${i}: string;\n`
      const absentSet = new Set(absent.flatMap((x, i) => x ? [i] : []))
      if (mutate !== null && absentSet.has(mutate)) absentSet.delete(mutate)
      const tree = changed => ({ ...(ambient ? { "../shared/globals.d.ts": "declare var sharedGlobal: number;\n" } : {}),
        ...Object.fromEntries([0, 1, 2, 3, 4].filter(i => !absentSet.has(i)).map(i => [`m${i}.d.ts`, module(i, changed && i === mutate)])) })
      const keys = [0, 1, 2, 3, 4].map(i => `m${i}.d.ts`)
      const evidence = Object.fromEntries([...absentSet].map(i => [`m${i}.d.ts`, [{ code: 2883, file: `m${i}.ts`, line: i + 1, column: 1 }]]))
      const candidateEvidence = sameReason ? evidence
        : Object.fromEntries([...absentSet].map(i => [`m${i}.d.ts`, [{ code: 2883, file: `m${i}.vibe`, line: i + 2, column: 1 }]]))
      const reaches = i => absentSet.has(i) || deps(i).some(reaches)
      const before = tree(false), after = tree(true)
      if (oneSided && absentSet.size) {
        const [first] = absentSet
        after[`m${first}.d.ts`] = module(first, false)
        const result = compare(before, after, keys, same(evidence), { entryBatchSize: batch })
        assert.equal(result.identical, false)
        assert.ok(groupBlockers(result).length, "one-sided absence must block")
        return
      }
      const result = compare(before, after, keys, { before: evidence, after: candidateEvidence }, { entryBatchSize: batch })
      assert.deepEqual(groupBlockers(result), [], JSON.stringify(result, null, 2))
      const expected = [0, 1, 2, 3, 4].flatMap(i => absentSet.has(i) ? (sameReason ? [] : [`m${i}.d.ts#*`])
        : reaches(i) ? [`m${i}.d.ts#T${i}`] : []).sort()
      assert.deepEqual(unavailable(result), expected)
      // plain exports never reach an absent module and are always compared.
      if (mutate === null) assert.deepEqual(result.typeDifferences, [])
      else {
        assert.equal(result.identical, false)
        const reported = new Set([...result.typeDifferences.map(d => d.entrypoint + "#" + d.export), ...unavailable(result)])
        assert.ok(reported.has(`m${mutate}.d.ts#T${mutate}`), JSON.stringify(result, null, 2))
      }
      assert.equal(result.identical, mutate === null && !expected.length)
    },
  })
})
