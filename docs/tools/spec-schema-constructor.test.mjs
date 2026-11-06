import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { Schema } from "effect"
import fc from "fast-check"
import { check, checkConstructorDocs, constructorRule, documentationPaths } from "./spec-schema-constructor.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const validDocuments = () => new Map(documentationPaths.map(path => [path,
  path.endsWith("900-appendices.md")
    ? "| interim `EK4814` | warning: a `Schema` class overrides its constructor. " + constructorRule + " | 38 | Tooling |"
    : "`EK4814` warns about a Schema constructor override. " + constructorRule
]))

test("Schema constructor documentation agrees across the diagnostic table and guides", () => {
  assert.deepEqual(check(root), [])
})

test("the former Appendix B claim is rejected", () => {
  const stale = validDocuments()
  const path = documentationPaths[0]
  stale.set(path, stale.get(path).replace(constructorRule, "Decoding does not invoke the override."))
  assert.ok(checkConstructorDocs(stale).some(problem => problem.startsWith(path)))
})

test("missing and duplicate diagnostic rows cannot satisfy the contract", () => {
  for (const replacement of ["", validDocuments().get(documentationPaths[0]) + "\n" + validDocuments().get(documentationPaths[0])]) {
    const docs = validDocuments()
    docs.set(documentationPaths[0], replacement)
    assert.ok(checkConstructorDocs(docs).length)
  }
})

test("unrelated prose and stale variants cannot hide the incorrect claim", () => {
  fc.assert(fc.property(
    fc.constantFrom(...documentationPaths),
    fc.constantFrom("Decoding does not invoke the override.", "Decoding never calls the constructor.", "Decoding builds instances without calling it."),
    fc.stringMatching(/^[a-z ]{0,100}$/),
    (path, stale, prose) => {
      const docs = validDocuments()
      docs.set(path, docs.get(path).replace(constructorRule, prose + " " + stale))
      assert.ok(checkConstructorDocs(docs).some(problem => problem.startsWith(path)))
    }
  ), { seed: 4814, numRuns: 100 })
})

// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Decoding invokes the override.
// VIP-32 pins the native Effect behavior; these are ordinary Schema classes.
test("pinned Schema decoding invokes overrides after validation and encoding does not", () => {
  const factories = [
    () => Schema.Class("Observed")({ n: Schema.Number }),
    () => Schema.TaggedClass()("Observed", { n: Schema.Number }),
    () => Schema.TaggedError()("Observed", { n: Schema.Number })
  ]
  fc.assert(fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 8 }), values => {
    for (const factory of factories) {
      const calls = []
      class Observed extends factory() {
        constructor(input, options) {
          super(input, options)
          calls.push(input.n)
        }
      }
      const made = new Observed({ n: values[0] })
      assert.equal(made.n, values[0])
      const decode = Schema.decodeUnknownSync(Observed)
      for (const n of values) {
        const decoded = decode({ n, _tag: "Observed" })
        assert.ok(decoded instanceof Observed)
        assert.equal(decoded.n, n)
        assert.equal(Schema.encodeSync(Observed)(decoded).n, n)
      }
      assert.deepEqual(calls, [values[0], ...values])
      assert.throws(() => decode({ n: "invalid", _tag: "Observed" }))
      assert.deepEqual(calls, [values[0], ...values])
    }
  }), { seed: 324814, numRuns: 100 })
})

test("the constructor documentation contract is selected by the specification gate", () => {
  const targets = readFileSync(new URL("../../PACKAGE.ts", import.meta.url), "utf8")
  assert.match(targets, /"spec-schema-constructor": specSchemaConstructor/)
  assert.match(targets, /data: \[specRegistry[^\]]*specSchemaConstructor/)
  assert.match(targets, /node docs\/tools\/spec-schema-constructor\.mjs && node --test docs\/tools\/spec-schema-constructor\.test\.mjs/)
})
