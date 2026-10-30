import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { resolve, join } from "node:path"
import { tmpdir } from "node:os"
import { root, artifactPath, generateThrowsInventory, serializeInventory } from "./throws-inventory.mjs"
import { SourceAnalysis } from "./throws-source.mjs"

test("the normative throws inventory is current for the exact pinned inputs", { timeout: 300_000 }, () => {
  const actual = readFileSync(resolve(root, artifactPath), "utf8")
  const expected = serializeInventory(generateThrowsInventory())
  if (actual !== expected) {
    let difference = 0
    while (difference < actual.length && actual[difference] === expected[difference]) difference++
    assert.fail("run node docs/tools/throws-inventory.mjs --write; first difference at " + difference + ": " +
      JSON.stringify(actual.slice(Math.max(0, difference - 60), difference + 100)) + " vs " +
      JSON.stringify(expected.slice(Math.max(0, difference - 60), difference + 100)))
  }
})

test("direct calls, callbacks, validation and returned decoders have separate contracts", () => {
  const { entries, inputs } = JSON.parse(readFileSync(resolve(root, artifactPath), "utf8"))
  assert.equal(inputs.effect.version, "4.1.0")
  assert.ok(inputs.typescript.files.length > 100)
  assert.ok(inputs.effect.sources.some(f => f.file === "effect/dist/internal/option.js"))
  const find = (module, declaration) => {
    const result = entries.filter(e => e.module === module && e.declaration === declaration)
    assert.ok(result.length, module + "." + declaration)
    return result
  }
  assert.equal(find("global", "JSON.parse")[0].ownThrows, "SyntaxError")
  assert.equal(find("global", "JSON.stringify")[0].ownThrows, "TypeError")
  assert.equal(find("global", "Math.max")[0].ownThrows, "never")
  assert.equal(find("global", "Array.push")[0].ownThrows, "never")
  assert.equal(find("global", "String.repeat")[0].ownThrows, "RangeError")
  for (const method of ["padStart", "padEnd"]) {
    assert.equal("x"[method](-1), "x")
    assert.ok(find("global", "String." + method).every(e => e.ownThrows === "never"), method + " uses ToLength, not repeat-style validation")
  }
  const normalize = find("global", "String.normalize")
  const closedForms = normalize.filter(e => e.signature.includes('"NFC"'))
  const openForms = normalize.filter(e => !closedForms.includes(e))
  assert.ok(closedForms.length && openForms.length)
  assert.ok(closedForms.every(e => e.ownThrows === "never"), "every form in the closed overload is valid")
  assert.ok(openForms.every(e => e.ownThrows === "RangeError"), "the open string overload admits invalid forms")
  for (const form of ["NFC", "NFD", "NFKC", "NFKD"]) assert.doesNotThrow(() => "text".normalize(form))
  assert.equal("x".repeat(1), "x")
  assert.ok(find("global", "String.repeat").every(e => e.ownThrows === "RangeError"), "a safe count does not narrow the whole signature (detail 205)")

  assert.throws(() => new String(Symbol()), TypeError)
  assert.equal(String(Symbol("ok")), "Symbol(ok)")
  assert.equal(find("global", "String").find(e => e.kind === "construct").ownThrows, "TypeError")
  assert.equal(find("global", "String").find(e => e.kind === "call").ownThrows, "never")
  assert.ok(find("global", "Array.map").every(e => e.rethrows.includes("callbackfn") && e.callbacks[0].admits === "unknown"))
  function* throwingEntries() { throw new Error("iterator"); yield ["key", 1] }
  assert.throws(() => new Map(throwingEntries()), /iterator/)
  assert.throws(() => Array.from(throwingEntries()), /iterator/)
  assert.equal(find("global", "Map").find(e => e.signature.startsWith("()")).ownThrows, "never")
  assert.ok(find("global", "Map").filter(e => !e.signature.startsWith("()")).every(e => e.ownThrows === "never"))
  assert.ok(find("global", "Array.from").every(e => e.ownThrows === "never"))
  const promise = find("global", "Promise").find(e => e.kind === "construct")
  assert.equal(promise.ownThrows, "never")
  assert.deepEqual(promise.rethrows, [])
  assert.equal(promise.callbacks.find(c => c.parameter === "executor").admits, "unknown")
  assert.equal(find("effect/Option", "some")[0].ownThrows, "never")
  for (const name of ["decodeUnknownSync", "decodeSync"]) {
    const decoder = find("effect/Schema", name)[0]
    assert.equal(decoder.ownThrows, "never")
    assert.equal(decoder.returns[0].ownThrows, "SchemaError")
  }
  for (const name of ["try", "tryPromise"]) {
    assert.ok(find("effect/Effect", name).some(e => e.callbacks.some(c => c.admits === "unknown")))
  }
  assert.ok(find("effect/Effect", "sync").every(e => e.callbacks.every(c => c.admits === "never")))
  const keys = entries.map(e => JSON.stringify([e.module, e.declaration, e.kind, e.signature]))
  assert.equal(new Set(keys).size, keys.length)
})

test("source proofs follow imports and constructors, skip returned bodies, and retain unknown calls", () => {
  const temp = mkdtempSync(join(tmpdir(), "vibelang-throws-"))
  try {
    writeFileSync(join(temp, "helper.js"), "export const identity = x => x; export const make = x => new Box(x); const Box = function(x) { this.x = x };")
    writeFileSync(join(temp, "surface.js"), [
      'import { identity, make } from "./helper.js";',
      "export const pure = x => identity(x);",
      "export const constructor = x => make(x);",
      "export const callback = f => f();",
      "export const foreign = x => external(x);",
      "export const nativeBox = () => new String(Symbol());",
      "export const nullableObject = () => Object.getPrototypeOf(null);",
      "export const iterableMath = values => Math.sumPrecise(values);",
      "export const aggregate = values => new AggregateError(values);",
      "export const opaqueMath = value => Math.abs(value);",
      "export const literalMath = () => Math.max(1, 2);",
      "export const spread = values => [...values];",
      "export const destructure = ([value]) => value;",
      "export const iterate = values => { for (const value of values) {} };",
      "export const computedMethod = () => ({ [external()]() {} });",
      "export const tagged = tag => tag`value`;",
      "export const outer = () => () => { throw new RangeError(); };",
      "export const invalid = () => { throw new TypeError(); };",
      "export const asyncBoundary = async () => { throw new Error(); };",
      "export const asyncGeneratorDefault = async function* (x = external()) {};",
      "export const generatorDefault = function* (x = external()) {};",
      "export const generatorBoundary = function* () { throw new Error(); };",
      "const dual = (n, f) => () => { throw new Error() };",
      "export const fakeDual = dual(2, () => 1);",
      "export const defaults = (x = external()) => x;",
      "export const nestedDefault = ({x = external()}) => x;",
      "export const computedParameter = ({[external()]: x}) => x;",
      "export const staticClass = () => class { static x = external() };",
      "export class InstanceFields { x = external() };",
      "export let mutable = () => 1; mutable = () => { throw new Error() };",
      "export const shadowed = () => { function identity() { throw new Error() }; return identity(); };",
    ].join("\n").replaceAll("\\n", "\n"))
    const analysis = new SourceAnalysis()
    const callable = name => analysis.callable(join(temp, "surface.js"), name)
    assert.equal(analysis.analyze(callable("pure")), "never")
    assert.equal(analysis.analyze(callable("constructor")), "never")
    assert.equal(analysis.analyze(callable("callback")), "unknown")
    assert.equal(analysis.analyze(callable("foreign")), "unknown")
    assert.equal(analysis.analyze(callable("nativeBox")), "TypeError")
    assert.equal(analysis.analyze(callable("nullableObject")), "TypeError")
    assert.equal(analysis.analyze(callable("iterableMath")), "unknown")
    assert.equal(analysis.analyze(callable("aggregate")), "unknown")
    assert.equal(analysis.analyze(callable("literalMath")), "never")
    for (const name of ["opaqueMath", "spread", "destructure", "iterate", "computedMethod", "tagged"])
      assert.equal(analysis.analyze(callable(name)), "unknown", name)
    assert.equal(analysis.analyze(callable("outer")), "never")
    assert.equal(analysis.analyze(analysis.returned(callable("outer"))), "RangeError")
    assert.equal(analysis.analyze(callable("invalid")), "TypeError")
    assert.equal(analysis.analyze(callable("asyncBoundary")), "never")
    assert.equal(analysis.analyze(callable("generatorBoundary")), "never")
    assert.equal(analysis.analyze(callable("shadowed")), "unknown")
    for (const name of ["defaults", "nestedDefault", "computedParameter", "staticClass", "InstanceFields", "mutable", "generatorDefault", "asyncGeneratorDefault", "fakeDual"])
      assert.equal(analysis.analyze(callable(name)), "unknown", name)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test("native proofs cover typed iterables, null targets and byte syntax", () => {
  const { entries } = JSON.parse(readFileSync(resolve(root, artifactPath), "utf8"))
  const find = declaration => {
    const found = entries.filter(e => e.module === "global" && e.declaration === declaration)
    assert.ok(found.length, declaration)
    return found
  }
  assert.throws(() => BigInt("invalid"), SyntaxError)
  assert.throws(() => BigInt(1.5), RangeError)
  assert.ok(find("BigInt").every(e => e.ownThrows.split(" | ").sort().join(" | ") === "RangeError | SyntaxError"),
    "the pinned bigint/boolean/number/string parameter excludes invalid-type TypeError")
  function* badValues() { throw new Error("iterator") }
  assert.throws(() => new Uint8Array(badValues()), /iterator/)
  assert.throws(() => Uint8Array.from(badValues()), /iterator/)
  assert.ok(find("Uint8Array.from").every(e => e.ownThrows === "unknown"))
  const iterableConstructors = find("Uint8Array").filter(e => /\b(?:Iterable|ArrayLike)\b/.test(e.signature))
  assert.ok(iterableConstructors.length)
  assert.ok(iterableConstructors.every(e => e.ownThrows === "unknown"))
  assert.ok(find("Uint8Array").some(e => /\(length\??: number\)/.test(e.signature) && e.ownThrows === "RangeError"))
  assert.ok(find("Uint8Array.from").some(e => e.callbacks.some(c => c.admits === "unknown") && e.rethrows.length))
  for (const [method, invoke] of [
    ["getPrototypeOf", () => Object.getPrototypeOf(null)],
    ["getOwnPropertyNames", () => Object.getOwnPropertyNames(null)],
    ["getOwnPropertySymbols", () => Object.getOwnPropertySymbols(null)],
    ["getOwnPropertyDescriptor", () => Object.getOwnPropertyDescriptor(null, "x")],
    ["getOwnPropertyDescriptors", () => Object.getOwnPropertyDescriptors(null)],
  ]) {
    assert.throws(invoke, TypeError)
    assert.ok(find("Object." + method).every(e => e.ownThrows === "TypeError"), method)
  }
  for (const method of ["fromBase64", "fromHex"]) {
    if (typeof Uint8Array[method] === "function") assert.throws(() => Uint8Array[method]("%%%"), SyntaxError)
    assert.ok(find("Uint8Array." + method).every(e => e.ownThrows === "SyntaxError"), method)
  }
  for (const method of ["setFromBase64", "setFromHex"]) {
    if (typeof Uint8Array.prototype[method] === "function") assert.throws(() => new Uint8Array(8)[method]("%%%"), SyntaxError)
    assert.ok(find("Uint8Array." + method).every(e => e.ownThrows === "SyntaxError"), method)
  }
  assert.ok(find("Math.sumPrecise").every(e => e.ownThrows === "unknown"))
  assert.throws(() => new Date(NaN).toISOString(), RangeError)
  assert.ok(find("Date.toISOString").every(e => e.ownThrows === "never"), "invalid receiver state is implicit (detail 81)")
})

test("protocol hooks are implicit and dual factories defer full invocations (detail 202)", () => {
  const { entries } = JSON.parse(readFileSync(resolve(root, artifactPath), "utf8"))
  const find = (module, declaration) => {
    const found = entries.filter(e => e.module === module && e.declaration === declaration)
    assert.ok(found.length, module + "." + declaration)
    return found
  }
  for (const declaration of ["Map", "Set", "Array.from"])
    assert.ok(find("global", declaration).every(e => e.ownThrows === "never"), declaration)
  for (const declaration of ["map", "retry", "catchTag"]) {
    const factories = find("effect/Effect", declaration).filter(e => e.returns.length)
    assert.ok(factories.length, declaration)
    assert.ok(factories.every(e => e.ownThrows === "never"), declaration)
  }
  const compose = find("effect/Function", "compose")
  const dataFirst = compose.filter(e => e.signature.startsWith("<A, B, C>(self:"))
  const dataLast = compose.filter(e => !dataFirst.includes(e))
  assert.ok(dataFirst.length && dataLast.length)
  assert.ok(dataFirst.every(e => e.returns[0].ownThrows === "unknown"), "full compose builds a callback whose invocation is unresolved")
  assert.ok(dataLast.every(e => e.ownThrows === "never" && e.returns[0].ownThrows === "never" &&
    e.returns[0].returns[0].ownThrows === "unknown"), "a data-last call defers the full body, then its callback")
})

test("dual selectors need a proof; numeric aliases and namespace imports remain supported", () => {
  const temp = mkdtempSync(join(tmpdir(), "vibelang-throws-dual-"))
  try {
    const dualPath = join(temp, "Function.js")
    writeFileSync(dualPath, "export const dual = (arity, body) => function(...args) { return (typeof arity === 'number' ? args.length >= arity : arity(args)) ? body(...args) : self => body(self, ...args) }; export const local = dual(2, () => 1);")
    const path = join(temp, "surface.js")
    writeFileSync(path, [
      'import { dual as wrap } from "./Function.js";',
      'import * as F from "./Function.js";',
      'export const numeric = wrap(2, () => 1);',
      'export const namespaced = F.dual(2, () => 1);',
      'export const dynamic = wrap(args => { throw new Error("selector") }, () => 1);',
      'export const dynamicNamespace = F.dual(args => external(args), () => 1);',
    ].join("\n"))
    const analysis = new SourceAnalysis({ dualPath })
    for (const name of ["numeric", "namespaced"]) {
      assert.equal(analysis.dualArity(path, name), 2)
      assert.equal(analysis.analyze(analysis.callable(path, name)), "never")
    }
    assert.equal(analysis.analyze(analysis.callable(dualPath, "local")), "never")
    for (const name of ["dynamic", "dynamicNamespace"]) {
      assert.equal(analysis.dualArity(path, name), undefined)
      assert.equal(analysis.analyze(analysis.callable(path, name)), "unknown", name)
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test("normative chapters publish the throws inventory and its generator", () => {
  for (const page of ["docs/design/src/003-failures.md", "docs/design/src/900-appendices.md"]) {
    const text = readFileSync(resolve(root, page), "utf8")
    assert.ok(text.includes("https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/throws.json"), page)
    assert.match(text, /\x60node docs\/tools\/throws-inventory\.mjs --write\x60/, page)
    assert.doesNotMatch(text, /artifact awaits its generator|incomplete for shipped thrown contracts|generator and the file are not published yet/, page)
  }
})

test("normal documentation generation and checking include the inventory", () => {
  const scripts = JSON.parse(readFileSync(new URL("../../.smithers/package.json", import.meta.url), "utf8")).scripts
  assert.ok(scripts["docs:generate"].includes("throws-inventory.mjs --write"))
  assert.ok(scripts["docs:check"].includes("throws-inventory.mjs --check"))
})

test("symbolic property contracts use source names rather than checker IDs", () => {
  const { entries } = JSON.parse(readFileSync(resolve(root, artifactPath), "utf8"))
  assert.ok(entries.some(e => e.module === "global" && e.declaration === "Array.[Symbol.species]"))
  assert.ok(entries.some(e => e.module === "global" && e.declaration === "CSS.highlights.[Symbol.iterator]"))
  assert.ok(entries.filter(e => e.module === "global" && e.declaration === "String.match")
    .some(e => e.callbacks.some(callback => callback.parameter === "matcher.[Symbol.match]")))
  assert.doesNotMatch(JSON.stringify(entries), /__@[^@"]+@[0-9]+/, "TypeScript's process-local symbol IDs are not declaration names")
})
