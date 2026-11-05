// One export's verdict comes from that export's own closure, whatever else the
// program reports. Declarations outside both snapshots are one physical file,
// so their errors cannot make the two sides differ; errors that belong to a
// side still fail.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
import { createEs2015FixtureGuard } from "./testing/fixture-libraries.mjs"

const stockTs = loadTypeScript()
const compilerOptions = { lib: ["lib.es2015.d.ts"] }
const { ts, assertLibraries } = createEs2015FixtureGuard(stockTs, "Unrelated-diagnostic fixtures")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/t3code-unrelated-diagnostic.json", import.meta.url), "utf8"))
const message = /unresolved or erroneous type/

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
}
function compare(before, after, keys, shared = corpus.shared) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-unrelated-"))
  try {
    write(join(root, "node_modules"), shared)
    write(join(root, "before"), before)
    write(join(root, "after"), after)
    const entries = Object.fromEntries(keys.map(key => [key, key]))
    const result = compareApiIdentity(ts, join(root, "before"), join(root, "after"),
      { beforeEntrypoints: entries, afterEntrypoints: entries, moduleRoots: [join(root, "node_modules")], compilerOptions })
    assertLibraries()
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const flagged = result => [...new Set(result.environmentDiagnostics.filter(d => message.test(d.diagnostic))
  .map(d => d.entrypoint + "#" + d.export))].sort()
const sharedWith = text => ({ ...corpus.shared, "bad/package.json": "{\"name\":\"bad\",\"version\":\"1.0.0\",\"types\":\"index.d.ts\"}\n", "bad/index.d.ts": text })
const fail = (result, why) => assert.equal(result.identical, false, why + ": " + JSON.stringify(result, null, 2))
const pass = result => {
  assert.equal(result.identical, true, JSON.stringify(result, null, 2))
  assert.equal(result.comparisonComplete, true)
}

test("t3code desktop: a TS7016 inside a dependency does not arm the walk over Vite's UserConfig", () => {
  const { files } = corpus
  pass(compare(files, files, ["config.d.ts"]))
  const result = compare(files, files, ["config.d.ts", "menu.d.ts"])
  assert.ok(result.environmentDiagnostics.some(d => /TS7016/.test(d.diagnostic) && !d.blocking), JSON.stringify(result, null, 2))
  pass(result)
})

test("the reported form: an owned TS7016 stays blocking in its file and leaves the other export's verdict alone", () => {
  const { files } = corpus
  const result = compare(files, files, ["config.d.ts", "other.d.ts"])
  assert.deepEqual(flagged(result).filter(key => key.startsWith("config.d.ts")), [], JSON.stringify(result, null, 2))
  assert.ok(result.environmentDiagnostics.some(d => d.blocking && /TS7016/.test(d.diagnostic)))
  assert.equal(result.identical, false)
})

test("a shared declaration re-exported by both sides is the same declaration", () => {
  const files = { "config.d.ts": "export type { UserConfig } from \"dep\";\n", "menu.d.ts": corpus.files["menu.d.ts"] }
  pass(compare(files, files, ["config.d.ts", "menu.d.ts"]))
})

// Negative controls run alone and beside an unrelated diagnostic: the verdict
// must fail in both, and it must not depend on the batch.
for (const [label, keys] of [["alone", ["a.d.ts"]], ["beside an unrelated diagnostic", ["a.d.ts", "menu.d.ts"]]]) {
  const menu = { "menu.d.ts": corpus.files["menu.d.ts"] }
  const owned = "// @ts-ignore\nimport type { Options } from \"optional-peer\";\n"

  test("negative, " + label + ": an error in the export's own closure fails", () => {
    const files = { ...menu, "a.d.ts": owned + "export interface A { css: Options }\n" }
    const result = compare(files, files, keys)
    fail(result, "owned error"); assert.deepEqual(flagged(result), ["a.d.ts#A"])
  })
  test("negative, " + label + ": an owned error through a shared generic argument fails", () => {
    const files = { ...menu, "a.d.ts": owned + "export declare const a: Map<string, { css: Options }>;\n" }
    const shared = sharedWith("export interface Box<T> { value: T }\n")
    const boxed = { ...menu, "a.d.ts": owned + "import type { Box } from \"bad\";\nexport declare const a: Box<{ css: Options }>;\n" }
    fail(compare(files, files, keys), "lib generic argument")
    fail(compare(boxed, boxed, keys, shared), "shared generic argument")
  })
  test("negative, " + label + ": an owned augmentation of a shared interface fails", () => {
    const files = { ...menu, "a.d.ts": owned + "import type { PlainConfig } from \"dep\";\ndeclare module \"dep\" { interface PlainConfig { css: Options } }\nexport declare const a: PlainConfig;\n" }
    fail(compare(files, files, keys), "augmentation")
  })
  test("negative, " + label + ": switching to a different erroneous shared declaration fails", () => {
    const shared = sharedWith("// @ts-ignore\nimport type { One, Two } from \"optional-peer\";\nexport interface First { css: One }\nexport interface Second { css: Two }\n")
    const side = name => ({ ...menu, "a.d.ts": "import type { " + name + " } from \"bad\";\nexport declare const a: " + name + ";\n" })
    fail(compare(side("First"), side("Second"), keys, shared), "changed shared target")
  })
  test("negative, " + label + ": swapping erroneous shared declarations between members fails", () => {
    const shared = sharedWith("// @ts-ignore\nimport type { One, Two } from \"optional-peer\";\nexport interface First { css: One }\nexport interface Second { css: Two }\n")
    const side = (x, y, z) => ({ ...menu, "a.d.ts": "import type { First, Second } from \"bad\";\nexport interface A { x: " + x + "; y: " + y + "; z: " + z + " }\n" })
    fail(compare(side("First", "Second", "Second"), side("Second", "First", "Second"), keys, shared), "swapped members")
    fail(compare(side("First", "First", "Second"), side("First", "Second", "First"), keys, shared), "repeated members")
  })
  test("negative, " + label + ": a shared generic with a hidden error keeps its argument difference", () => {
    const shared = sharedWith("// @ts-ignore\nimport type { One } from \"optional-peer\";\nexport interface Holder<T> { value: T extends string ? One : number }\n")
    const side = arg => ({ ...menu, "a.d.ts": "import type { Holder } from \"bad\";\nexport declare const a: Holder<" + arg + ">;\n" })
    fail(compare(side("string"), side("\"x\""), keys, shared), "changed instantiation")
  })
  test("negative, " + label + ": a real type change next to a shared error is a type difference", () => {
    const side = name => ({ ...menu, "a.d.ts": "import type { UserConfig, " + name + " } from \"dep\";\nexport interface A { config: UserConfig; extra: " + name + " }\n" })
    const result = compare(side("PlainConfig"), side("OtherConfig"), keys)
    fail(result, "changed member")
    assert.deepEqual(result.typeDifferences.map(d => d.entrypoint + "#" + d.export), ["a.d.ts#A"])
  })
}

test("property: adding an unrelated diagnostic never changes a verdict", async () => {
  const bodies = {
    clean: name => "export interface " + name + " { value: string }\n",
    shared: name => "import type { UserConfig } from \"dep\";\nexport interface " + name + " { config: UserConfig }\n",
    owned: name => "// @ts-ignore\nimport type { Options } from \"optional-peer\";\nexport interface " + name + " { css: Options }\n",
  }
  const extras = {
    dependency: { "extra-dep.d.ts": corpus.files["menu.d.ts"].replace("updater:", "extra:") },
    ownedFile: { "extra-own.d.ts": corpus.files["other.d.ts"] },
    ignored: { "extra-ignored.d.ts": "// @ts-ignore\nimport type { Nothing } from \"nowhere\";\nexport interface Extra { nothing: Nothing }\n" },
  }
  const verdict = (keys, result) => Object.fromEntries(keys.map(key => [key, flagged(result).includes(key + "#E" + key[1])]))
  await checkProperty(fc, {
    name: "api-identity-unrelated-diagnostic", generatorVersion: 1, numRuns: 12,
    rule: "The verdict for one export must not depend on unrelated diagnostics elsewhere in the program.",
    command: "node --test scripts/api-identity-unrelated-diagnostic.test.mjs",
    arbitrary: fc.record({
      kinds: fc.array(fc.constantFrom("clean", "shared", "owned"), { minLength: 1, maxLength: 3 }),
      added: fc.subarray(Object.keys(extras), { minLength: 1 }),
    }),
    check: ({ kinds, added }) => {
      const files = Object.fromEntries(kinds.map((kind, index) => ["m" + index + ".d.ts", bodies[kind]("E" + index)]))
      const keys = Object.keys(files)
      const alone = verdict(keys, compare(files, files, keys))
      const extra = Object.assign({}, ...added.map(name => extras[name]))
      const crowded = { ...files, ...extra }
      const beside = verdict(keys, compare(crowded, crowded, Object.keys(crowded)))
      assert.deepEqual(beside, alone)
      assert.deepEqual(alone, Object.fromEntries(keys.map((key, index) => [key, kinds[index] === "owned"])))
    },
  })
})


function native(source, check) {
  const root = mkdtempSync(join(tmpdir(), "api-unrelated-native-")), file = join(root, "index.d.ts")
  try {
    writeFileSync(file, source)
    const options = { ...compilerOptions, strict: true, noEmit: true, types: [] }
    const program = ts.createProgram([file], options)
    assertLibraries()
    return check(program, file, options)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const mapSource = value => "export declare const value: Map<string, { value: " + value + " }>;"
function validMap(source) {
  native(source, (program, file) => {
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
    const declaration = program.getSourceFile(file).statements[0].declarationList.declarations[0]
    const symbol = program.getTypeChecker().getSymbolAtLocation(declaration.type.typeName)
    assert.ok(symbol.declarations.some(node => /[/\\]lib\.es2015\.collection\.d\.ts$/.test(node.getSourceFile().fileName)),
      "Map must bind to the actual TypeScript collection declaration")
  })
}

test("unrelated-diagnostic fixtures retain native Map identity and argument changes", () => {
  const source = mapSource("string"), files = { "index.d.ts": source }
  validMap(source)
  native(source, (program, file, options) => {
    const missing = ts.createProgram([file], { ...options, lib: ["lib.es5.d.ts"] })
    assert.ok(ts.getPreEmitDiagnostics(missing).some(d => d.code === 2583), "ES5 alone cannot supply Map")
    assertLibraries()
  })
  pass(compare(files, files, ["index.d.ts"]))
  const changed = compare(files, { "index.d.ts": mapSource("number") }, ["index.d.ts"])
  fail(changed, "native Map argument changed")
  assert.deepEqual(changed.typeDifferences.map(d => d.export), ["value"])
})

test("ES2015 diagnostic fixtures preserve missing BigInt library errors", () => {
  const source = "export declare const value: BigInt;"
  native(source, program => assert.ok(ts.getPreEmitDiagnostics(program).some(d => d.code === 2583)))
  const files = { "index.d.ts": source }, result = compare(files, files, ["index.d.ts"])
  assert.equal(result.comparisonComplete, false)
  assert.equal(result.identical, false)
  assert.ok(result.environmentDiagnostics.some(d => d.blocking && /TS2583/.test(d.diagnostic)))
})

test("property: native Map value mutations remain observable beside unrelated diagnostics", async () => {
  await checkProperty(fc, {
    name: "api-identity-unrelated-native-map",
    rule: "An export retains its native Map argument identity beside unrelated shared diagnostics.",
    command: "node --test scripts/api-identity-unrelated-diagnostic.test.mjs",
    numRuns: 4,
    arbitrary: fc.record({
      value: fc.constantFrom("string", "number", "boolean"),
      beside: fc.boolean(),
      reverse: fc.boolean(),
    }),
    check: ({ value, beside, reverse }) => {
      const changed = value === "string" ? "number" : "string"
      const source = mapSource(value), candidate = mapSource(changed)
      validMap(source); validMap(candidate)
      const menu = beside ? { "menu.d.ts": corpus.files["menu.d.ts"] } : {}
      const before = { ...menu, "index.d.ts": source }, after = { ...menu, "index.d.ts": candidate }
      const keys = Object.keys(before)
      pass(compare(before, before, keys))
      const result = reverse ? compare(after, before, keys) : compare(before, after, keys)
      fail(result, "Map value mutation")
      assert.deepEqual(result.typeDifferences.map(d => d.export), ["value"])
    },
  })
})
