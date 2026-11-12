import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { createRequire } from "node:module"
import { checkProperty } from "./testing/property.mjs"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const ts = loadTypeScript()
const fixtureRequire = createRequire(new URL("../docs/tools/package.json", import.meta.url))
const fc = fixtureRequire("fast-check")
const effectPackage = dirname(fixtureRequire.resolve("effect/package.json"))
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-recursive-alias-body-split.json", import.meta.url)))
assert.ok(readFileSync(new URL("../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(corpus.rule))
function compare({ change = text => text, synthetic = false, helper = "ServicesOf", body = "runner.vibe.body", depth = 8, dependency = "direct", mutateDependency = false, mutateDocs = false, mutateExternal = false, missingExternal = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-recursive-alias-"))
  try {
    for (const side of ["before", "after"]) {
      const dir = join(root, side)
      mkdirSync(dir)
      if (!synthetic) {
        mkdirSync(join(dir, "node_modules"))
        symlinkSync(effectPackage, join(dir, "node_modules", "effect"), "dir")
      }
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      for (const [original, source] of Object.entries(corpus[side])) {
        const file = original.replaceAll("runner.vibe.body", body)
        const prefix = file.split("/").length > 1 ? "../".repeat(file.split("/").length - 1) : "./"
        let text = source.replaceAll("runner.vibe.body", body).replaceAll("ServicesOf", helper)
          .replace('extends 8 ?', 'extends ' + depth + ' ?')
        if (original === "runner.vibe.body.d.ts") text = text.replace('from "./interpreter.js"', 'from "' + prefix + 'interpreter.js"').replace('from "./runner.js"', 'from "' + prefix + 'runner.js"')
        if (synthetic) text = text.replace('from "effect"', 'from "./effect.js"')
        if (file === "runtime.d.ts") {
          text = text.replace("export type Services", "/** Required services. */ export type Services")
          if (dependency !== "direct") text = text.replace("? R :", "? Read<R> :") +
            (dependency === "cycle"
              ? "\ntype Read<T> = T extends object ? Next<T[keyof T]> : T; type Next<T> = T extends readonly unknown[] ? Read<T[number]> : T;\n"
              : "\ntype Read<T> = T;\n")
          if (side === "after") {
            text = change(text)
            if (mutateDocs) text = text.replace("Required services.", "Different documentation.")
            if (mutateDependency) text = dependency === "cycle"
              ? text.replace("? Read<T[number]> : T;", "? Read<T[number]> : number;")
              : text.replace("type Read<T> = T;", "type Read<T> = T[];")
          }
        }
        mkdirSync(dirname(join(dir, file)), { recursive: true })
        writeFileSync(join(dir, file), text)
      }
      if (synthetic && !(missingExternal && side === "after")) writeFileSync(join(dir, "effect.d.ts"),
        "export namespace Effect { interface Effect<A, E, R> { readonly result: A; readonly error: E; readonly services: " +
        (mutateExternal && side === "after" ? "R[]" : "R") + " } }")
    }
    const entries = { runtime: "runtime.d.ts", interpreter: "interpreter.d.ts", runner: "runner.d.ts" }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), {
      beforeEntrypoints: entries, afterEntrypoints: entries,
      compilerOptions: { types: [], lib: [synthetic ? "lib.es5.d.ts" : "lib.es2022.d.ts"] },
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("an unchanged recursive alias retains strict identity through a partial dependency re-export", () => {
  const result = compare()
  assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.identical, true, JSON.stringify(result.typeDifferences))
})
test("a changed recursive alias branch remains an API difference", () => {
  const result = compare({ change: text => text.replace('? R :', '? R[] :') })
  assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(item => ["Services", "ServicesOf"].includes(item.export)), JSON.stringify(result))
})

for (const dependency of ["alias", "cycle"]) {
  test("a recursive alias keeps identity through a " + dependency + " dependency", () => {
    const result = compare({ synthetic: true, dependency })
    assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
    assert.equal(result.identical, true, JSON.stringify(result.typeDifferences))
  })
  test("changed " + dependency + " dependencies invalidate the recursive proof", () => {
    const result = compare({ synthetic: true, dependency, mutateDependency: true })
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.ok(result.typeDifferences.length || result.environmentDiagnostics.some(item => item.blocking))
  })
}
test("documentation remains checked when a recursive alias has a binding proof", () => {
  const result = compare({ synthetic: true, mutateDocs: true })
  assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.identical, false)
  assert.ok(result.docDifferences.some(item => item.export === "Services"), JSON.stringify(result))
})
test("property: recursive aliases preserve split identities and reject changed branches and dependencies", async () => {
  await checkProperty(fc, {
    name: corpus.property, rule: corpus.rule,
    command: "node --test scripts/api-identity-recursive-alias.test.mjs",
    arbitrary: fc.record({
      helper: fc.constantFrom("ServicesOf", "RequirementsOf", "ExtractServices"),
      body: fc.constantFrom("runner.vibe.body", "private/scheduler", "deep/internal/runner"),
      depth: fc.integer({ min: 3, max: 9 }),
      dependency: fc.constantFrom("direct", "alias", "cycle"),
    }),
    numRuns: 12,
    check: shape => {
      const same = compare({ ...shape, synthetic: true })
      assert.equal(same.comparisonComplete, true, JSON.stringify(same.environmentDiagnostics))
      assert.equal(same.identical, true, JSON.stringify(same.typeDifferences))
      const branch = compare({ ...shape, synthetic: true,
        change: text => text.replace("? R :", "? R[] :").replace("? Read<R> :", "? Read<R>[] :") })
      assert.equal(branch.identical, false, JSON.stringify(branch))
      assert.ok(branch.typeDifferences.length || branch.environmentDiagnostics.some(item => item.blocking))
      if (shape.dependency !== "direct") {
        const dependency = compare({ ...shape, synthetic: true, mutateDependency: true })
        assert.equal(dependency.identical, false, JSON.stringify(dependency))
      }
    },
  })
})

test("identical alias text cannot hide a changed imported type binding", () => {
  const result = compare({ synthetic: true, mutateExternal: true })
  assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result.typeDifferences.length)
})
test("a missing alias dependency keeps the comparison unavailable", () => {
  const result = compare({ synthetic: true, missingExternal: true })
  assert.equal(result.comparisonComplete, false)
  assert.equal(result.identical, false)
  assert.ok(result.environmentDiagnostics.some(item => item.blocking && /TS2307/.test(item.diagnostic)), JSON.stringify(result))
})
