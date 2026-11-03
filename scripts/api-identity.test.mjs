import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript, publishedEntrypoints } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function fixture(before, after, fn, manifest) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      mkdirSync(join(root, side), { recursive: true })
      for (const [name, text] of Object.entries(typeof files === "string" ? { "index.d.ts": files } : files)) {
        const path = join(root, side, name)
        mkdirSync(join(path, ".."), { recursive: true })
        writeFileSync(path, text)
      }
      if (manifest) writeFileSync(join(root, side, "package.json"), JSON.stringify(manifest))
    }
    return fn(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const compare = (a, b, manifest) => fixture(a, b, (a, b) => compareApiIdentity(ts, a, b), manifest)
const pass = (a, b, manifest) => {
  const result = compare(a, b, manifest)
  assert.equal(result.identical, true, JSON.stringify(result, null, 2))
}
const fail = (a, b, kind = "typeDifferences") => {
  const result = compare(a, b)
  assert.equal(result.identical, false)
  assert.ok(result[kind].length, JSON.stringify(result))
  if (kind === "typeDifferences") assert.match(result.typeDifferences.map(x => x.diagnostic).join("\n"), /TS\d+/)
}

test("tsc-irrelevant syntax: whitespace, quotes, import and member order, type-import syntax, alias expansion", () => {
  pass('export type X = { a: "a"; b: number };', "export type X={b:number\na:'a'}")
  pass("type Hidden = string; export type X = Hidden; export {};", "export type X = string;")
  const dep = { "one.d.ts": "export interface One { x: number }", "two.d.ts": "export interface Two { y: string }" }
  pass({ ...dep, "index.d.ts": 'import type { One } from "./one.js"; import { type Two } from "./two"; export type X = { a: One; b: Two };' },
    { ...dep, "index.d.ts": 'import type { Two } from "./two.js"; import { type One } from "./one"; export type X = { b: Two; a: One };' })
})

test("names, types and docs are three independent lists", () => {
  fail("export type X = string;", "export type Y = string;", "nameDifferences")
  fail("export declare function f(x: string): void;", "export declare function f(x: string | number): void;")
  fail("export interface X { x: string }", "export interface X { x?: string }")
  fail("export type X<T extends string> = { x: T };", "export type X<T extends string | number> = { x: T };")
  fail("/** Hello */ export declare const x: string;", "/** Goodbye */ export declare const x: string;", "docDifferences")
  pass("/** Hello\n * world\n * @since 1.0\n */ export declare const x: string;", "/** Hello world\n * @since 1.0\n */ export declare const x: string;")
  fail("/** @deprecated old */ export type X = string;", "/** @deprecated new */ export type X = string;", "docDifferences")
})

test("generic bodies, constraints, arity and defaults", () => {
  pass("export type X<T extends { x: string }> = { y: T };", "export type X<U extends { x: string }> = { y: U };")
  fail("export type X<T> = T;", "export type X<T> = string;")
  fail("export type X<T> = T extends string ? 1 : 2;", "export type X<T> = T extends string ? 2 : 1;")
  fail("export type X<T = string> = T;", "export type X<T = number> = T;")
  fail("export type X<T, U> = [T, U];", "export type X<T> = [T, T];")
})

test("classes compare instance and static sides; lost overloads and namespace types fail", () => {
  pass("export declare class C { x: string; static n: number; }", "export declare class C { static n: number; x: string; }")
  fail("export declare class C { x: string; static n: number; }", "export declare class C { x: number; static n: number; }")
  fail("export declare class C { x: string; static n: number; }", "export declare class C { x: string; static n: string; }")
  fail("export declare function f(x: string): string; export declare function f(x: number): number;", "export declare function f(x: number): number;")
  fail("export namespace N { type X = string }", "export namespace N { type X = number }")
  fail("export namespace N { type X = string }", "export namespace N { type Y = string }", "nameDifferences")
  pass("export namespace N { type X<T> = { x: T } }", "export namespace N { type X<U> = { x: U } }")
})

test("default, export =, type-only re-exports and enums", () => {
  pass("export default class C<T> { x: T }", "export default class D<U> { x: U }")
  pass("export default function f(x: string): string;", "export default function g(x:string):string;")
  pass("declare function f(x: string): string; export = f;", "declare function g(x: string): string; export = g;")
  fail("export enum E { A = 1 }", "export enum E { A = 2 }")
  const dep = { "dep.d.ts": "/** original */ export interface X { x: string }" }
  pass({ ...dep, "index.d.ts": 'export type { X } from "./dep.js";' }, { ...dep, "index.d.ts": 'export { type X } from "./dep";' })
})

test("public names belong to exports subpaths and conditions; private files can change", () => {
  const manifest = { exports: { ".": { types: "./index.d.ts", default: "./index.js" }, "./extra": { import: { types: "./extra.d.ts" }, require: { types: "./extra.d.cts" } } } }
  const files = { "index.d.ts": "export type X = string;", "extra.d.ts": "export type E = number;", "extra.d.cts": "export type E = number;", "private.d.ts": "export type P = string;" }
  pass(files, { ...files, "private.d.ts": "export type P = number;" }, manifest)
  const result = compare(files, { ...files, "extra.d.cts": "export type E = string;" }, manifest)
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.entrypoint === "./extra#require"))
  fixture(files, files, a => assert.equal(Object.keys(publishedEntrypoints(a)).length, 3), manifest)
  pass({ "index.d.ts": "export type X = string;", "hidden.d.ts": "export type H = string;" },
    { "index.d.ts": "export type X = string;" }, { types: "./index.d.ts" })
})

test("unresolved public declarations and imports fail closed", () => {
  const missing = compare('export type X = import("missing-package").X;', 'export type X = import("missing-package").X;')
  assert.equal(missing.identical, false)
  assert.equal(missing.comparisonComplete, false)
  assert.deepEqual(missing.typeDifferences, [])
  assert.ok(missing.environmentDiagnostics.some(d => d.blocking && /TS2307/.test(d.diagnostic)))
  const r = compare({ "index.d.ts": "export {}" }, { "index.d.ts": "export {}" }, { types: "./missing.d.ts" })
  assert.equal(r.identical, false)
})

test("CLI reports each list, JSON, and failing exit status", () => {
  fixture("export type X = string;", "export type X = number;", (a, b) => {
    const args = ["scripts/api-identity.mjs", "--before", a, "--after", b]
    const plain = spawnSync(process.execPath, args, { encoding: "utf8" })
    assert.equal(plain.status, 1, plain.stderr)
    for (const label of ["Name differences", "Type differences", "Doc-comment differences"]) assert.ok(plain.stdout.includes(label))
    const json = spawnSync(process.execPath, [...args, "--json"], { encoding: "utf8" })
    assert.equal(json.status, 1)
    assert.equal(JSON.parse(json.stdout).identical, false)
  })
})

test("property: ignored rewrites pass and one semantic mutation always fails", async () => {
  await checkProperty(fc, {
    name: "api-identity-irrelevant-rewrites",
    rule: "Will: formatting, quotes and member order where tsc does not care do not count; one semantic type change fails",
    command: "node --test scripts/api-identity.test.mjs",
    arbitrary: fc.record({ reverse: fc.boolean(), quote: fc.boolean(), space: fc.constantFrom(" ", "\n", "\n  "), value: fc.integer({ min: 0, max: 1000 }) }),
    numRuns: 24,
    check: ({ reverse, quote, space, value }) => {
      const fields = [`a: ${quote ? "'" : '"'}word${quote ? "'" : '"'}`, `b: ${value}`]
      const before = `export type X = { a: "word"; b: ${value} };`
      const after = "export type X = {" + (reverse ? fields.reverse() : fields).join(";" + space) + "};"
      pass(before, after)
      fail(before, after.replace("b: " + value, "b: " + (value + 1)))
    },
  })
})

test("corresponding nominal identities survive snapshot paths; their semantic mutations fail", () => {
  const privateClass = "export declare class C { private x: string; public y: number; }"
  pass(privateClass, privateClass.replace("public y: number", "public y:number"))
  fail(privateClass, privateClass.replace("y: number", "y: string"))
  const unique = "export declare const key: unique symbol; export interface X { [key]: string }"
  pass(unique, unique.replace("[key]: string", "[key]:string"))
  fail(unique, unique.replace("[key]: string", "[key]:number"))
  pass("export enum E { A=1, B=2 }", "export enum E { B=2, A=1 }")
  fail("export enum E { A=1 }", "export enum E { A=2 }")
})

test("wildcard exports retain subpath names and ignore unreachable files", () => {
  const manifest = { exports: { "./*": { types: "./lib/*.d.ts", default: "./lib/*.js" } } }
  const files = { "lib/a.d.ts": "export type X = string;", "lib/b.d.ts": "export type X = number;" }
  fixture(files, files, a => assert.deepEqual(Object.keys(publishedEntrypoints(a)).sort(), ["./a", "./b"]), manifest)
  pass(files, { ...files, "private.d.ts": "export type Ignore = string;" }, manifest)
  const runtime = { exports: { "./*": "./lib/*.js" } }
  fixture(files, files, a => assert.deepEqual(Object.keys(publishedEntrypoints(a)).sort(), ["./a", "./b"]), runtime)
})
test("type-only class export and value export are different meanings", () => {
  const base = { "dep.d.ts": "export declare class C { x: string }" }
  const result = compare({ ...base, "index.d.ts": 'export type { C } from "./dep";' }, { ...base, "index.d.ts": 'export { C } from "./dep";' })
  assert.equal(result.identical, false)
})

test("JSDoc survives re-exports and covers members of exported shapes", () => {
  fail("/** Original. */ declare const x: number; export { x };", "/** Changed. */ declare const x: number; export { x };", "docDifferences")
  fail("export interface X {\n /** Old. */\n f(): void\n }", "export interface X {\n /** New. */\n f(): void\n }", "docDifferences")
  fail("export type X = { nested: {\n /** Old. */\n x: string } }", "export type X = { nested: {\n /** New. */\n x: string } }", "docDifferences")
  pass("export interface X { /** A */ a: string; /** B */ b: number; }", "export interface X { /** B */ b: number; /** A */ a: string; }")
})

test("opencode catalog minimized migration corpus is API-identical", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-catalog-effect-fn-parameter-declaration.json", import.meta.url)))
  pass(corpus.before, corpus.after)
})

test("nominal emit details, string exports and transitive type-only provenance", () => {
  pass("export declare class C { private brand; x: string }", "export declare class C { private brand; x: string }")
  pass('export declare class C { private x: number; get(): C["x"]; }', 'export declare class C { private x: number; get(): C["x"]; }')
  pass("declare class C { private brand; x: string } export { C as X };", "declare class D { private brand; x: string } export { D as X };")
  pass('declare const x: string; export { x as "a-b" };', 'declare const x: string; export { x as "a-b" };')
  pass('type X = string; export type { X as "x-y" };', 'type Y = string; export type { Y as "x-y" };')
  const files = { "c.d.ts": "export declare class C { x: string }" }
  const manifest = { types: "./index.d.ts" }
  for (const exportLine of ['export { C } from "./c";', 'export * from "./c";']) {
    const a = { ...files, "middle.d.ts": exportLine, "index.d.ts": 'export * from "./middle";' }
    const b = { ...a, "middle.d.ts": exportLine.replace("export ", "export type ") }
    assert.equal(compare(a, b, manifest).identical, false)
  }
})

test("type-only classes retain their instance and static contracts", () => {
  fail("declare class C { x: string } export type { C };", "declare class C { x: number } export type { C };")
  fail("declare class C { static x: string } export type { C };", "declare class C { static x: number } export type { C };")
})

test("export-equals types and generic classes preserve scope", () => {
  pass("interface X { x: string } export = X;", "interface X { x: string } export = X;")
  pass("declare class X<T> { x: T } export = X;", "declare class X<U> { x: U } export = X;")
  fail("declare class X<T extends string> { x: T } export = X;", "declare class X<T extends number> { x: T } export = X;")
})
test("caller resolution options cannot waive invalid declarations or strict checks", () => {
  fixture("export type X = Missing;", "export type X = Missing;", (a, b) => {
    const result = compareApiIdentity(ts, a, b, { compilerOptions: { skipLibCheck: true, strict: false, noEmit: false } })
    assert.equal(result.identical, false)
    assert.equal(result.comparisonComplete, false)
    assert.deepEqual(result.typeDifferences, [])
    assert.match(result.environmentDiagnostics.map(x => x.diagnostic).join("\n"), /TS2304/)
  })
  fixture("export type X = string;", "export type X = string;", (a, b) => {
    assert.equal(compareApiIdentity(ts, a, b, { compilerOptions: { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext } }).identical, true)
  })
})

test("JSDoc type tags and their order remain part of the comment", () => {
  fail("/** @throws {Error} */ export declare function f(): void;", "/** @throws {TypeError} */ export declare function f(): void;", "docDifferences")
  fail("/** @since 1.0\n * @deprecated use g */ export declare function f(): void;", "/** @deprecated use g\n * @since 1.0 */ export declare function f(): void;", "docDifferences")
})
test("nominal normalization cannot hide invalid input declarations", () => {
  const result = compare("export enum E { A = Missing }", "export enum E { A = Missing }")
  assert.equal(result.comparisonComplete, false)
  assert.deepEqual(result.typeDifferences, [])
  assert.ok(result.environmentDiagnostics.some(d => d.blocking && /TS2304/.test(d.diagnostic)))
})

test("enum member docs and numeric reverse-map types remain checked", () => {
  pass("export enum E { A=1 }\nexport type X = (typeof E)[number];", "export enum E { A=1 }\nexport type X = (typeof E)[number];")
  fail("export enum E {\n /** Old */\n A=1 }", "export enum E {\n /** New */\n A=1 }", "docDifferences")
  pass("export declare class C {private p: string; x: number} export type X = keyof C;", 'export declare class C {private p: string; x: number} export type X = "x";')
})

test("value/type export meanings are named separately", () => {
  const result = compare("declare class C { x: string } export { C };", "declare class C { x: string } export type { C };")
  assert.equal(result.identical, false)
  assert.ok(result.nameDifferences.some(x => x.export === "C" && x.meaning === "runtime value"))
  assert.deepEqual(result.typeDifferences, [])
})

test("keyof alias expansion also works without a nominal declaration", () => {
  pass('export interface I { x: number } export type X = keyof I;', 'export interface I { x: number } export type X = "x";')
})

// drive2-opencode's strict tsc witness: private signatures may elide types.
const privateMembers = [
  "private get hidden();",
  "private set hidden(value);",
  "private get hidden(); private set hidden(value);",
  "private method();",
  "private method(value);",
  "private get hidden(); private set hidden(value: number);",
  "private get hidden(): number; private set hidden(value);",
  "private get hidden(): number; private set hidden(value: number);",
  "private static get hidden();",
  "private static set hidden(value);",
  "private static get hidden(); private static set hidden(value);",
  "private static get hidden(); private get hidden();",
  "static #private;",
  "#private;",
  "get #hidden(): number;",
  "set #hidden(value: number);",
  "protected get hidden(): number;",
  "protected set hidden(value: number);",
  "protected get hidden(): number; protected set hidden(value: number);",
  "get #hidden(): number; set #hidden(value: number);",
  "private get hidden(): number;",
  "private set hidden(value: number);",
  "private field: number;",
  "private method(value: number): string;",
]

function nativeDiagnostics(files) {
  const options = { strict: true, noEmit: true, skipLibCheck: false, types: [], target: ts.ScriptTarget.ESNext }
  return ts.getPreEmitDiagnostics(ts.createProgram(files, options))
}

test("private member alignment preserves valid elided signatures", () => {
  const declarations = privateMembers.map((member, i) =>
    `export declare class C${i} { ${member} value(): number; }`).join("\n")
  fixture(declarations, declarations, (a, b) => {
    assert.deepEqual(nativeDiagnostics([join(a, "index.d.ts")]).map(d => "TS" + d.code), [])
    const result = compareApiIdentity(ts, a, b)
    assert.equal(result.identical, true, JSON.stringify(result, null, 2))
    const sameRoot = compareApiIdentity(ts, a, a)
    assert.equal(sameRoot.identical, true, JSON.stringify(sameRoot, null, 2))
  })
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-private-getter.json", import.meta.url)))
  pass(corpus.before, corpus.after)
})

test("adding, removing and renaming private members follows native two-way assignability", () => {
  for (const [before, after, side] of [
    ["private get hidden();", "", "instance"],
    ["", "private set hidden(value);", "instance"],
    ["private field: number;", "private other: number;", "instance"],
    ["#private;", "", "instance"],
    ["private static get hidden();", "", "static"],
    ["private get hidden(): number;", "private get hidden(): string;", "instance"],
    ["protected get hidden(): number;", "protected get hidden(): string;", "instance"],
  ]) {
    const left = `export declare class C { ${before} value(): number; }`
    const right = `export declare class C { ${after} value(): number; }`
    const native = `declare class Left { ${before} value(): number; }
declare class Right { ${after} value(): number; }
declare let left: ${side === "static" ? "typeof Left" : "Left"};
declare let right: ${side === "static" ? "typeof Right" : "Right"};
left = right;
right = left;
export {};`
    fixture({ "index.ts": native }, { "index.ts": native }, a => {
      const diagnostics = nativeDiagnostics([join(a, "index.ts")])
      assert.ok(diagnostics.some(d => [2322, 2741].includes(d.code)), JSON.stringify(diagnostics.map(d => d.code)))
      const result = compare(left, right)
      assert.equal(result.identical, false, JSON.stringify({ before, after, result }))
      assert.ok(result.typeDifferences.length, JSON.stringify(result))
      assert.ok(result.typeDifferences.every(d => d.probe), JSON.stringify(result))
    })
  }
})

test("property: a valid private-member package compared with itself is identical", async () => {
  await checkProperty(fc, {
    name: "api-identity-private-self",
    rule: "Will: a package compared with itself is always identical; private names still carry nominal identity",
    command: "node --test scripts/api-identity.test.mjs",
    arbitrary: fc.record({
      members: fc.uniqueArray(fc.integer({ min: 0, max: privateMembers.length - 1 }), { minLength: 1, maxLength: 5 }),
      name: fc.constantFrom("C", "Renamed", "WithPrivate"),
      generic: fc.boolean(),
    }),
    numRuns: 24,
    check: ({ members, name, generic }) => {
      const body = members.map((index, i) => privateMembers[index].replaceAll("hidden", "hidden" + i)
        .replaceAll("method", "method" + i).replaceAll("field", "field" + i).replace("#private", "#private" + i)).join(" ")
      const text = `export declare class ${name}${generic ? "<T>" : ""} { ${body} value(): ${generic ? "T" : "number"}; }`
      fixture(text, text, (a, b) => {
        assert.deepEqual(nativeDiagnostics([join(a, "index.d.ts")]).map(d => "TS" + d.code), [])
        const result = compareApiIdentity(ts, a, b)
        assert.equal(result.identical, true, JSON.stringify({ text, result }, null, 2))
      })
    },
  })
})

test("frozen declaration edges resolve package aliases within each snapshot", () => {
  const before = { "index.d.ts": 'export { x } from "#frozen";', "leaf.d.ts": "export declare const x: string;" }
  const after = { ...before, "index.d.ts": 'export { x } from "#renamed";' }
  fixture(before, after, (a, b) => {
    const options = { beforeEntrypoints: { ".": "index.d.ts" }, afterEntrypoints: { ".": "index.d.ts" },
      beforeResolutions: [["index.d.ts", "#frozen", "leaf.d.ts"]],
      afterResolutions: [["index.d.ts", "#renamed", "leaf.d.ts"]] }
    assert.equal(compareApiIdentity(ts, a, b).identical, false, "unresolved aliases fail without their frozen edges")
    assert.equal(compareApiIdentity(ts, a, b, options).identical, true)
    writeFileSync(join(b, "leaf.d.ts"), "export declare const x: number;")
    const changed = compareApiIdentity(ts, a, b, options)
    assert.equal(changed.identical, false)
    assert.ok(changed.typeDifferences.some(x => x.export === "x" && /TS2344/.test(x.diagnostic)))
  })
})

test("library imports under node --eval do not invoke the CLI", () => {
  const code = 'import {pathToFileURL} from "node:url"; const m = await import(pathToFileURL(process.argv[1])); console.log(typeof m.compareApiIdentity);'
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", code, fileURLToPath(new URL("./api-identity.mjs", import.meta.url))], { encoding: "utf8" })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, "function\n")
})

test("source wildcard targets, module extensions, assets and publication overrides", () => {
  for (const [target, file] of [["./lib/*.ts", "lib/a.d.ts"], ["./lib/*.vibe", "lib/a.d.ts"], ["./lib/*.mjs", "lib/a.d.mts"], ["./lib/*.cjs", "lib/a.d.cts"]]) {
    const files = { [file]: "export type X = string;" }
    const manifest = { exports: { "./*": target, "./package.json": "./package.json" } }
    fixture(files, files, a => assert.deepEqual(Object.keys(publishedEntrypoints(a)).sort(), ["./a", "./package.json", "./package.json"]), manifest)
    pass(files, files, manifest)
  }
  const manifest = { exports: { "./dev": "./missing.ts" }, publishConfig: { exports: { ".": { types: "./lib/index.d.ts" } } } }
  pass({ "lib/index.d.ts": "export type X = string;" }, { "lib/index.d.ts": "export type X = string;" }, manifest)
})

test("separate installed package snapshots cannot hide a semantic dependency change", () => {
  const files = { "index.d.ts": 'export type X = import("foreign").X;',
    "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/foreign/index.d.ts": "export interface X { value: string }" }
  const manifest = { types: "./index.d.ts" }
  pass(files, files, manifest)
  const result = compare(files, { ...files, "node_modules/foreign/index.d.ts": "export interface X { value: number }" }, manifest)
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.export === "X" && /TS2344/.test(d.diagnostic)))
})

test("project library context ignores unrelated defects while unresolved dependencies fail closed", () => {
  const files = { "index.d.ts": 'export type X = import("foreign").X;',
    "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/foreign/index.d.ts": "export type Unused = Undeclared; export type X = string;" }
  fixture(files, files, (a, b) => {
    assert.equal(compareApiIdentity(ts, a, b).identical, true)
    assert.equal(compareApiIdentity(ts, a, b, { compilerOptions: { skipLibCheck: true } }).identical, true)
    writeFileSync(join(b, "node_modules/foreign/index.d.ts"), 'export type X = import("missing-package").X;')
    assert.equal(compareApiIdentity(ts, a, b, { compilerOptions: { skipLibCheck: true } }).identical, false)
  }, { types: "./index.d.ts" })
})

test("recursive generic member docs terminate and a documented member change fails", () => {
  const before = "export interface Box<T> {\n /** Next item */\n next(): Box<T[]>;\n }"
  pass(before, before)
  fail(before, before.replace("Next item", "Changed item"), "docDifferences")
})

test("type mismatches also report mutual assignability", () => {
  const r = compare("export type X = { a: string } & { b: number };", "export type X = { a: string; b: number };")
  assert.equal(r.identical, false)
  assert.ok(r.typeDifferences.some(d => d.export === "X" && d.mutuallyAssignable === true))
  const changed = compare("export type X = string;", "export type X = number;")
  assert.ok(changed.typeDifferences.some(d => d.mutuallyAssignable === false))
})

test("equivalent deferred infer and mapped declarations share only proved module closures", () => {
  for (const text of [
    "export type InstanceOf<C> = C extends abstract new (...args: any[]) => infer I ? I : never;",
    "export declare const f: <C>(c: C) => C extends (infer I)[] ? I : never;",
    "export type M<T> = { [K in keyof T as K extends string ? K : never]: T[K] };",
  ]) pass(text, text.replaceAll(";"," ;\n"))
  const files = { "index.d.ts": 'import type { Leaf } from "./leaf.js"; export type X<T> = T extends (infer I)[] ? Leaf<I> : never;',
    "leaf.d.ts": "export type Leaf<T> = { value: T };" }
  pass(files, { ...files, "index.d.ts": files["index.d.ts"].replace("./leaf.js", "./leaf") })
  const changed = compare(files, { ...files, "leaf.d.ts": "export type Leaf<T> = { value: number };" })
  assert.equal(changed.identical, false)
  assert.ok(changed.typeDifferences.some(d => d.export === "X"))
  const cyc = { "index.d.ts": 'import type { B } from "./b"; export interface A<T> { next: B<T> } export type X<C> = C extends (infer I)[] ? A<I> : never;',
    "b.d.ts": 'import type { A } from "./index"; export interface B<T> { next: A<T>; value: T }' }
  pass(cyc, cyc)
  assert.equal(compare(cyc, { ...cyc, "b.d.ts": cyc["b.d.ts"].replace("value: T", "value: number") }).identical, false)
})

test("module closure interning preserves distinct same-text nominal dependencies", () => {
  const files = { "index.d.ts": 'import { C as A } from "./a"; import { C as B } from "./b"; export type X = [A, B];',
    "a.d.ts": "export declare class C { private brand; }", "b.d.ts": "export declare class C { private brand; }" }
  pass(files, files)
  assert.equal(compare(files, { ...files, "index.d.ts": files["index.d.ts"].replace('from "./b"', 'from "./a"') }).identical, false)
})

test("nested types conditions and default assignment runtime meaning", () => {
  const files = { "import.d.mts": "export type X = string;", "require.d.cts": "export type X = string;" }
  const manifest = { exports: { ".": { types: { import: "./import.d.mts", require: "./require.d.cts" }, default: "./absent.js" } } }
  fixture(files, files, a => assert.deepEqual(Object.keys(publishedEntrypoints(a)).sort(), [".#import", ".#require"]), manifest)
  pass(files, files, manifest)
  const result = compare("declare class C { x: string } export default C;", "declare class C { x: string } export type { C as default };")
  assert.equal(result.identical, false)
  assert.ok(result.nameDifferences.some(d => d.export === "default" && d.meaning === "runtime value"))
})

test("sidecar trees pair tsc twins and source module suffixes select matching declarations", () => {
  pass({ "main.d.vibe.ts": "export type X = string;" }, { "main.d.ts": "export type X = string;" })
  assert.equal(compare({ "main.d.vibe.ts": "export type X = string;" }, { "main.d.ts": "export type X = number;" }).identical, false)
  for (const [source, declaration] of [["./main.mts", "main.d.mts"], ["./main.cts", "main.d.cts"], ["./main.vibe", "main.d.vibe.ts"]]) {
    const files = { [declaration]: "export type X = string;" }
    pass(files, files, { types: source })
  }
})

test("Smithers: sidecarDir imports compare identical without writing beside sources", () => {
  const files = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { rootDirs: [".", ".cache/types"] }, vibe: { sidecarDir: ".cache/types" } }),
    "index.d.ts": 'export { value } from "./src/entry.vibe";',
    "src/entry.vibe": "export const value = secretVibeSyntax;",
    ".cache/types/src/entry.d.vibe.ts": '/** Stored value */ export declare const value: { id: string };',
  }
  fixture(files, files, (a, b) => {
    for (const [left, right] of [[a, a], [a, b]]) {
      const result = compareApiIdentity(ts, left, right)
      assert.equal(result.identical, true, JSON.stringify(result))
      assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    }
    writeFileSync(join(b, ".cache/types/src/entry.d.vibe.ts"), 'export declare const value: { id: number };')
    assert.equal(compareApiIdentity(ts, a, b).identical, false)
  }, { types: "./index.d.ts" })
})

test("Smithers: unrelated diagnostics are environment and do not become export differences", () => {
  const files = {
    "index.d.ts": 'export type X = import("foreign").X;',
    "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", types: "index.d.ts" }),
    "node_modules/foreign/index.d.ts": "export type Unrelated = Missing; export type X = string;",
  }
  fixture(files, files, (a, b) => {
    const result = compareApiIdentity(ts, a, b)
    assert.equal(result.identical, true, JSON.stringify(result))
    assert.equal(result.comparisonComplete, true)
    assert.deepEqual(result.typeDifferences, [])
    assert.ok(result.environmentDiagnostics.some(x => /TS2304/.test(x.diagnostic)))
    const cli = spawnSync(process.execPath, ["scripts/api-identity.mjs", "--before", a, "--after", b, "--json"], { encoding: "utf8" })
    assert.equal(cli.status, 0, cli.stdout + cli.stderr)
    writeFileSync(join(b, "index.d.ts"), 'export type X = import("foreign").X; export type Broken = import("missing").X;')
    const blocked = compareApiIdentity(ts, b, b)
    assert.equal(blocked.identical, false, JSON.stringify(blocked))
    assert.equal(blocked.comparisonComplete, false)
    assert.deepEqual(blocked.typeDifferences, [])
    const invalid = spawnSync(process.execPath, ["scripts/api-identity.mjs", "--before", b, "--after", b, "--json"], { encoding: "utf8" })
    assert.equal(invalid.status, 2, invalid.stdout + invalid.stderr)
    assert.match(invalid.stdout, /environmentDiagnostics/)
  }, { types: "./index.d.ts" })
})

test("property: a package compared with itself is API-identical", async () => {
  await checkProperty(fc, {
    name: "api-identity-reflexivity",
    rule: "Will: package self-comparison has no API differences; unrelated diagnostics are environment",
    command: "node --test scripts/api-identity.test.mjs",
    arbitrary: fc.record({ value: fc.integer({ min: 0, max: 100 }), nominal: fc.boolean(), unrelated: fc.boolean() }),
    numRuns: 8,
    check: ({ value, nominal, unrelated }) => fixture({
      "index.d.ts": (nominal ? "export declare class C { private brand; }\n" : "") +
        'export { X } from "./value.vibe";' + (unrelated ? '\nimport "foreign";' : ""),
      "value.d.vibe.ts": `export type X = { value: ${value} };`,
      "node_modules/foreign/package.json": JSON.stringify({ types: "index.d.ts" }),
      "node_modules/foreign/index.d.ts": "export type Unused = Missing;",
    }, {}, a => {
      const result = compareApiIdentity(ts, a, a)
      assert.equal(result.identical, true, JSON.stringify(result))
      assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    }, { types: "./index.d.ts" }),
  })
})

test("Smithers journal resolves sidecarDir and beside .vibe declarations", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-journal-sidecar-dir.json", import.meta.url)))
  fixture(corpus, corpus, (a, b) => {
    for (const result of [compareApiIdentity(ts, a, a), compareApiIdentity(ts, a, b)])
      assert.equal(result.identical, true, JSON.stringify(result))
    writeFileSync(join(b, ".vibe/declarations/internal/WriteTally.d.vibe.ts"), "export interface WriteTally { readonly count: string }")
    const changed = compareApiIdentity(ts, a, b)
    assert.ok(changed.typeDifferences.some(d => d.export === "WriteTally" && /TS2344/.test(d.diagnostic)), JSON.stringify(changed))
  })
  const files = { "index.d.ts": 'export type { X } from "./dep.vibe";', "dep.d.vibe.ts": "export type X = string;" }
  pass(files, files, { types: "./index.d.ts" })
})

test("unrelated outside diagnostics are environment records, never API differences", () => {
  const files = { "index.d.ts": 'export type X = import("foreign").X;',
    "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", version: "1", types: "index.ts" }),
    "node_modules/foreign/index.ts": 'import { missing } from "./missing.vibe"; const bad: string = 123; export type X = string;' }
  fixture(files, files, (a, b) => {
    const result = compareApiIdentity(ts, a, b)
    assert.equal(result.identical, true, JSON.stringify(result))
    assert.deepEqual(result.typeDifferences, [])
    assert.ok(result.environmentDiagnostics.some(d => /TS2307/.test(d.diagnostic) && !d.blocking))
    assert.ok(result.environmentDiagnostics.some(d => /TS2322/.test(d.diagnostic) && !d.blocking))
    const cli = spawnSync(process.execPath, ["scripts/api-identity.mjs", "--before", a, "--after", b, "--json"], { encoding: "utf8" })
    assert.equal(cli.status, 0, cli.stdout + cli.stderr)
  }, { types: "./index.d.ts" })
})

test("unresolved compared types report unavailable comparison with distinct CLI exit", () => {
  const files = { "index.d.ts": 'export type X = import("foreign").X;',
    "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", version: "1", types: "index.d.ts" }),
    "node_modules/foreign/index.d.ts": 'export type X = import("missing-package").X;' }
  fixture(files, files, (a, b) => {
    const result = compareApiIdentity(ts, a, b)
    assert.equal(result.identical, false)
    assert.equal(result.comparisonComplete, false)
    assert.deepEqual(result.typeDifferences, [])
    assert.ok(result.environmentDiagnostics.some(d => d.blocking), JSON.stringify(result))
    const cli = spawnSync(process.execPath, ["scripts/api-identity.mjs", "--before", a, "--after", b, "--json"], { encoding: "utf8" })
    assert.equal(cli.status, 2, cli.stdout + cli.stderr)
    assert.deepEqual(JSON.parse(cli.stdout).typeDifferences, [])
  }, { types: "./index.d.ts" })
})

test("property: a valid package compared with itself is always identical", async () => {
  await checkProperty(fc, {
    name: "api-identity-self-comparison",
    rule: "Will: a package compared with itself is always API-identical; sidecarDir and unrelated external diagnostics cannot fabricate differences",
    command: "node --test scripts/api-identity.test.mjs",
    arbitrary: fc.record({ sidecar: fc.boolean(), value: fc.integer({ min: 0, max: 100 }), nominal: fc.boolean() }),
    numRuns: 8,
    check: ({ sidecar, value, nominal }) => {
      const files = { "index.d.ts": 'export { X } from "./dep.vibe";',
        "tsconfig.json": JSON.stringify({ vibe: sidecar ? { sidecarDir: ".vibe/declarations" } : {} }),
        [(sidecar ? ".vibe/declarations/" : "") + "dep.d.vibe.ts"]:
          nominal ? `export declare class X { private brand; value: ${value} }` : `export interface X { value: ${value} }` }
      fixture(files, files, a => {
        const result = compareApiIdentity(ts, a, a)
        assert.equal(result.identical, true, JSON.stringify(result))
        assert.deepEqual(result.nameDifferences, [])
        assert.deepEqual(result.typeDifferences, [])
        assert.deepEqual(result.docDifferences, [])
      }, { types: "./index.d.ts" })
    },
  })
})

test("external nominal packages retain identity across harmless entry import reordering", () => {
  const deps = {
    "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/foreign/index.d.ts": "export declare const brand: unique symbol; export interface X { readonly [brand]: string }",
    "node_modules/other/package.json": JSON.stringify({ name: "other", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/other/index.d.ts": "export type Y = number;",
  }
  const a = { ...deps, "index.d.ts": 'import type { X } from "foreign"; import type { Y } from "other"; export type Api = [X, Y];' }
  const b = { ...deps, "index.d.ts": 'import type { Y } from "other"; import type { X } from "foreign"; export type Api = [X, Y];' }
  pass(a, b, { types: "./index.d.ts" })
  const changed = compare(a, { ...b, "node_modules/foreign/index.d.ts": deps["node_modules/foreign/index.d.ts"].replace("]: string", "]: number") }, { types: "./index.d.ts" })
  assert.equal(changed.identical, false)
  assert.ok(changed.typeDifferences.some(d => d.export === "Api"))
})

test("unrelated diagnostics cannot recurse indefinitely through exported generic shapes", () => {
  const files = { "index.d.ts": 'import "foreign"; export interface Box<T> { next: Box<T[]>; value: T }',
    "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", types: "index.d.ts" }),
    "node_modules/foreign/index.d.ts": "export type Unused = Missing;" }
  pass(files, files, { types: "./index.d.ts" })
})

test("unresolved external types remain blocking through nested and repeated generic arguments", () => {
  for (const body of ["Box<Box<Missing>>", "[Box<string>, Box<Missing>]"]) {
    const files = { "index.d.ts": 'export type X = import("foreign").X;',
      "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", types: "index.d.ts" }),
      "node_modules/foreign/index.d.ts": `interface Box<T> { value: T } export type X = ${body};` }
    const result = compare(files, files, { types: "./index.d.ts" })
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.deepEqual(result.typeDifferences, [])
    assert.ok(result.environmentDiagnostics.some(d => d.blocking))
  }
})

test("inherited sidecarDir uses the selected config source root and declaring config output base", () => {
  for (const setting of [".declarations", "${configDir}/.declarations"]) {
    const output = setting.startsWith("${configDir}") ? "pkg/.declarations" : ".declarations"
    const files = {
      "base.json": JSON.stringify({ vibe: { sidecarDir: setting } }),
      "pkg/package.json": JSON.stringify({ types: "./index.d.ts" }),
      "pkg/tsconfig.json": JSON.stringify({ extends: "../base.json" }),
      "pkg/index.d.ts": 'export type { X } from "./src/value.vibe";',
      "pkg/src/value.vibe": "export const unsupported = effect { 1 };",
      [output + "/src/value.d.vibe.ts"]: "export type X = string;",
    }
    fixture(files, files, (a, b) => {
      const result = compareApiIdentity(ts, join(a, "pkg"), join(b, "pkg"))
      assert.equal(result.identical, true, JSON.stringify(result))
      writeFileSync(join(b, output, "src/value.d.vibe.ts"), "export type X = number;")
      assert.ok(compareApiIdentity(ts, join(a, "pkg"), join(b, "pkg")).typeDifferences.some(d => d.export === "X"))
    })
  }
})

test("distinct external nominal origins cannot be interned by matching declaration text", () => {
  for (const nominal of [true, false]) {
    const text = nominal ? "export declare class C { private brand: void; value: string }" : "export interface C { value: string }"
    const deps = {
      "node_modules/foo/package.json": JSON.stringify({ name: "foo", version: "1", types: "index.d.ts" }),
      "node_modules/foo/index.d.ts": text,
      "node_modules/bar/package.json": JSON.stringify({ name: "bar", version: "1", types: "index.d.ts" }),
      "node_modules/bar/index.d.ts": text,
    }
    const a = { ...deps, "index.d.ts": 'import { C } from "foo"; export declare function f(x: C): void;' }
    const b = { ...deps, "index.d.ts": 'import { C } from "bar"; export declare function f(x: C): void;' }
    const result = compare(a, b, { types: "./index.d.ts" })
    assert.equal(result.identical, !nominal, JSON.stringify(result))
    if (nominal) assert.ok(result.typeDifferences.some(d => d.export === "f" && /TS2344/.test(d.diagnostic)))
  }
})

test("instance and static member comments remain distinct with matching member names", () => {
  const before = "export declare class C {\n /** Instance */\n x: string;\n /** Static */\n static x: number;\n }"
  for (const text of [before.replace("Instance", "Changed"), before.replace("Static", "Changed")])
    fail(before, text, "docDifferences")
})

test("property: nominal origin and instance/static doc mutations always fail", async () => {
  await checkProperty(fc, {
    name: "api-identity-origins-and-docs",
    rule: "Will: an export retains tsc type identity and the same doc comments; matching dependency text cannot erase a distinct nominal origin or an instance comment",
    command: "node --test scripts/api-identity.test.mjs",
    arbitrary: fc.record({ member: fc.constantFrom("Instance", "Static"), value: fc.integer({ min: 0, max: 100 }) }),
    numRuns: 4,
    check: ({ member, value }) => {
      const before = `export declare class C {\n /** Instance ${value} */\n x: string;\n /** Static ${value} */\n static x: number;\n }`
      pass(before, before)
      fail(before, before.replace(member + " " + value, member + " changed " + value), "docDifferences")
      const deps = {
        "node_modules/foo/package.json": JSON.stringify({ name: "foo", version: "1", types: "index.d.ts" }),
        "node_modules/bar/package.json": JSON.stringify({ name: "bar", version: "1", types: "index.d.ts" }),
        "node_modules/foo/index.d.ts": `export declare class C { private brand; value: ${value} }`,
        "node_modules/bar/index.d.ts": `export declare class C { private brand; value: ${value} }`,
      }
      const a = { ...deps, "index.d.ts": 'export type C = import("foo").C;' }
      const b = { ...deps, "index.d.ts": 'export type C = import("bar").C;' }
      assert.ok(compare(a, b, { types: "./index.d.ts" }).typeDifferences.some(d => d.export === "C"))
    },
  })
})

test("foreign generic alias constraints and defaults cannot disappear into a primitive body", () => {
  for (const parameter of ["T = Missing", "T extends Missing", "T = Box<Missing>", "T extends Box<Missing>", "T = keyof Missing", "T extends keyof Missing"]) {
    const files = { "index.d.ts": 'export type { X } from "foreign";',
      "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", types: "index.d.ts" }),
      "node_modules/foreign/index.d.ts": `interface Box<T> { value: T } export type X<${parameter}> = string;` }
    const result = compare(files, files, { types: "./index.d.ts" })
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.deepEqual(result.typeDifferences, [])
    assert.ok(result.environmentDiagnostics.some(d => d.blocking))
  }
})

test("deferred infer identity survives import declaration and member order and type-import spelling", () => {
  const deps = { "a.d.ts": "export interface A { a: string; b: number }", "b.d.ts": "export type B = number;" }
  const before = { ...deps, "index.d.ts": 'import type { A } from "./a"; import type { B } from "./b"; export type X<T> = T extends (infer I)[] ? I : never; export type Used = [A, B];' }
  for (const after of [
    'import type { B } from "./b"; import type { A } from "./a"; export type X<T> = T extends (infer I)[] ? I : never; export type Used = [A, B];',
    'import { type B } from "./b.js"; import { type A } from "./a.js"; export type X<T> = T extends (infer I)[] ? I : never; export type Used = [A, B];',
  ]) pass(before, { ...deps, "a.d.ts": "export interface A { b: number; a: string }", "index.d.ts": after }, { types: "./index.d.ts" })
})

test("module closure proof follows import-equals dependency changes", () => {
  const a = { "index.d.cts": 'import Dep = require("./dep"); export type X = Dep.X;', "dep.d.ts": "export type X = string;" }
  const b = { ...a, "dep.d.ts": "export type X = number;" }
  const result = compare(a, b, { types: "./index.d.cts" })
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result.typeDifferences.some(d => d.export === "X"))
})

test("property: ignored rewrites around deferred aliases pass and a dependency mutation fails", async () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/deferred-infer-import-order.json", import.meta.url)))
  await checkProperty(fc, {
    name: "api-identity-deferred-import-rewrites",
    rule: corpus.rule + " A real dependency type mutation still fails.",
    command: "node --test scripts/api-identity.test.mjs",
    arbitrary: fc.record({ reverse: fc.boolean(), inline: fc.boolean(), members: fc.boolean() }),
    numRuns: 4,
    check: ({ reverse, inline, members }) => {
      const imports = ["A", "B"].map(name => inline ? `import { type ${name} } from "./${name.toLowerCase()}.js";` : `import type { ${name} } from "./${name.toLowerCase()}";`)
      if (reverse) imports.reverse()
      const before = { ...corpus.dependencies, "index.d.ts": corpus.before }
      const after = { ...corpus.dependencies,
        "a.d.ts": members ? "export interface A { b: number; a: string }" : corpus.dependencies["a.d.ts"],
        "index.d.ts": imports.join(" ") + ' export type X<T> = T extends (infer I)[] ? I : never; export type Used = [A, B];' }
      pass(before, after, corpus.manifest)
      const changed = compare(before, { ...after, "b.d.ts": "export type B = string;" }, corpus.manifest)
      assert.ok(changed.typeDifferences.some(d => d.export === "Used"), JSON.stringify(changed))
    },
  })
})

test("path-mapped external dependency identity survives alias expansion", () => {
  const deps = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { foreign: ["./node_modules/foreign/index.d.ts"] } } }),
    "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", version: "1.0.0", types: "index.d.ts" }),
    "node_modules/foreign/index.d.ts": "export declare const brand: unique symbol; export interface X { readonly [brand]: string }",
  }
  const a = { ...deps, "index.d.ts": 'import type { X } from "foreign"; export type Api = X; export {};' }
  const b = { ...deps, "index.d.ts": 'import type { X } from "foreign"; type Alias = X; export type Api = Alias; export {};' }
  pass(a, b, { types: "./index.d.ts" })
  const changed = compare(a, { ...b, "node_modules/foreign/index.d.ts": deps["node_modules/foreign/index.d.ts"].replace("]: string", "]: number") }, { types: "./index.d.ts" })
  assert.ok(changed.typeDifferences.some(d => d.export === "Api"))
})

test("variance-annotated generic exports compare with themselves using valid probes", () => {
  for (const text of [
    "export interface Box<out T> { readonly value: T }",
    "export type Box<out T> = { readonly value: T };",
    "export declare class Box<out T> { readonly value: T }",
    "export interface Box<in T> { consume(value: T): void }",
    "export interface Box<in out T> { value: T }",
  ]) fixture(text, text, (a, b) => {
    const original = ts.createProgram([join(a, "index.d.ts")], { strict: true, noEmit: true, types: [] })
    assert.deepEqual(ts.getPreEmitDiagnostics(original).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
    for (const result of [compareApiIdentity(ts, a, a), compareApiIdentity(ts, a, b)])
      assert.equal(result.identical, true, JSON.stringify(result))
  })
})

test("property: variance-annotated export families preserve identity and reject a changed field", async () => {
  await checkProperty(fc, {
    name: "api-identity-variance-bridges",
    rule: "Valid generic exports compare identically with themselves; variance modifiers cannot make the generated function probe invalid, and a changed public field must fail.",
    command: "node --test scripts/api-identity.test.mjs",
    arbitrary: fc.record({ variance: fc.constantFrom("out", "in", "in out"), shape: fc.constantFrom("interface", "type", "class"), value: fc.integer({ min: 0, max: 100 }) }),
    numRuns: 4,
    check: ({ variance, shape, value }) => {
      const member = variance === "in" ? "consume(value: T): void;" : "readonly value: T;"
      const body = `{ ${member} readonly tag: ${value}; }`
      const before = shape === "type" ? `export type Box<${variance} T> = ${body};`
        : `export ${shape === "class" ? "declare class" : "interface"} Box<${variance} T> ${body}`
      pass(before, before)
      fail(before, before.replace("tag: " + value, "tag: " + (value + 1)))
    },
  })
})

const jsonCorpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/foldkit-oxlint-json-export.json", import.meta.url)))
const jsonManifest = jsonCorpus.manifest
const jsonCompare = (a, b, compilerOptions = { resolveJsonModule: true }) => fixture(
  { "all.json": JSON.stringify(a) }, { "all.json": JSON.stringify(b) },
  (a, b) => compareApiIdentity(ts, a, b, { compilerOptions }), jsonManifest)

test("JSON assets use stock resolveJsonModule types and remain compared", () => {
  const input = jsonCorpus.before
  assert.equal(jsonCompare(input, jsonCorpus.after).identical, true)
  fixture({ "all.json": JSON.stringify(input) }, { "all.json": JSON.stringify(input) }, (a, b) => {
    for (const dir of [a, b]) {
      const program = ts.createProgram([join(dir, "all.json")], {
        noEmit: true, resolveJsonModule: true, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler, types: [],
      })
      assert.deepEqual(ts.getPreEmitDiagnostics(program), [], "stock tsc 5.9.3 accepts the fixture")
    }
    assert.equal(ts.version, "5.9.3")
    for (const after of [a, b]) {
      const result = compareApiIdentity(ts, a, after, { compilerOptions: { resolveJsonModule: true } })
      assert.equal(result.identical, true, JSON.stringify(result))
    }
  }, jsonManifest)
  assert.equal(jsonCompare(input, { ...input, count: "one" }).identical, false)
  assert.equal(jsonCompare(input, { ...input, count: 2 }).identical, true, "tsc widens JSON numeric values")
  assert.equal(jsonCompare(input, { ...input, list: [1] }).identical, false)
  assert.equal(jsonCompare(input, { ...input, extra: true }).identical, false)
})

test("property: JSON asset packages compared with themselves are identical", async () => {
  await checkProperty(fc, {
    name: "api-identity-json-self",
    rule: "Will: a package compared with itself is always identical; a JSON import has tsc's resolveJsonModule type",
    command: "node --test scripts/api-identity.test.mjs",
    arbitrary: fc.record({ value: fc.jsonValue(), reverse: fc.boolean() }),
    numRuns: 24,
    check: ({ value, reverse }) => {
      const input = { value, enabled: true }
      const after = reverse ? { enabled: true, value } : input
      const result = jsonCompare(input, after)
      assert.equal(result.identical, true, JSON.stringify(result))
      assert.equal(jsonCompare(input, { ...after, enabled: "yes" }).identical, false)
    },
  })
})


test("JSON wildcard exports, scalar roots and invalid inputs stay visible", () => {
  fixture({ "assets/one.json": "true", "assets/two.json": "[1, 2]" }, { "assets/one.json": "true", "assets/two.json": "[1, 2]" }, (a, b) => {
    assert.deepEqual(Object.keys(publishedEntrypoints(a)).sort(), ["./one.json", "./two.json"])
    const result = compareApiIdentity(ts, a, b)
    assert.equal(result.identical, true, JSON.stringify(result))
  }, { exports: { "./*.json": "./assets/*.json" } })
  for (const input of [true, null, 1, "word", [1, 2]]) assert.equal(jsonCompare(input, input).identical, true)
  assert.equal(jsonCompare(true, "true").identical, false)
  const disabled = jsonCompare({}, {}, { resolveJsonModule: false })
  assert.equal(disabled.identical, false)
  assert.equal(disabled.comparisonComplete, false)
  assert.deepEqual(disabled.typeDifferences, [])
  fixture({ "all.json": "{broken}" }, { "all.json": "{broken}" }, (a, b) => {
    const result = compareApiIdentity(ts, a, b)
    assert.equal(result.identical, false)
    assert.equal(result.comparisonComplete, false)
    assert.deepEqual(result.typeDifferences, [])
  }, jsonManifest)
})


test("JSON comparison honors the inherited project setting", () => {
  const files = { "all.json": "{}", "base.json": '{"compilerOptions":{"resolveJsonModule":false}}', "tsconfig.json": '{"extends":"./base.json"}' }
  fixture(files, files, (a, b) => {
    writeFileSync(join(a, "..", "vibe.config.json"), '{"compilerOptions":{"resolveJsonModule":true}}')
    assert.equal(compareApiIdentity(ts, a, b).identical, false)
    assert.equal(compareApiIdentity(ts, a, b, { compilerOptions: { resolveJsonModule: true } }).identical, true)
    for (const dir of [a, b]) writeFileSync(join(dir, "base.json"), '{"compilerOptions":{"resolveJsonModule":true}}')
    const result = compareApiIdentity(ts, a, b)
    assert.equal(result.identical, true, JSON.stringify(result))
  }, jsonManifest)
})

test("comparison exceptions are explicit invalid results, including self-comparison", () => {
  fixture("export type X = string;", "export type X = string;", (before, after) => {
    for (const other of [before, after]) {
      const crashing = { ...ts, createProgram() { throw new RangeError("Maximum call stack size exceeded") } }
      const result = compareApiIdentity(crashing, before, other)
      assert.equal(result.identical, false)
      assert.equal(result.comparisonComplete, false)
      assert.deepEqual(result.typeDifferences, [])
      assert.ok(result.environmentDiagnostics.some(d => d.blocking && /RangeError/.test(d.diagnostic)))
      assert.equal(result.failure.stage, "create-input-program")
    }
  })
})

test("property: compiler exceptions never establish API identity", async () => {
  await checkProperty(fc, {
    name: "api-identity-exception-invalid",
    rule: "Will: a crash is an explicit invalid result, never identical",
    command: "node --test scripts/api-identity.test.mjs",
    arbitrary: fc.record({ operation: fc.constantFrom("createCompilerHost", "createProgram"),
      kind: fc.constantFrom("RangeError", "Error", "TypeError") }),
    numRuns: 12,
    check: ({ operation, kind }) => fixture("export {};", "export {};", (before, after) => {
      const compiler = { ...ts, [operation]() { throw new globalThis[kind]("injected compiler failure") } }
      const result = compareApiIdentity(compiler, before, after)
      assert.equal(result.identical, false)
      assert.equal(result.comparisonComplete, false)
      assert.equal(result.failure.error, kind)
      assert.ok(result.environmentDiagnostics.some(d => d.blocking))
      assert.deepEqual(result.typeDifferences, [])
    }),
  })
})

test("fatal worker signals and empty successful exits are invalid CLI receipts", () => {
  fixture({ "index.d.ts": "export type X = string;" }, { "index.d.ts": "export type X = string;" }, (a, b) => {
    for (const action of ["process.kill(process.pid, 'SIGKILL')", "process.exit(0)"]) {
      const hook = join(a, "worker-hook.mjs")
      writeFileSync(hook, "if (process.argv.includes('--api-identity-worker')) " + action)
      const run = spawnSync(process.execPath, ["--import", hook, "scripts/api-identity.mjs", "--before", a, "--after", b, "--json"],
        { encoding: "utf8", timeout: 30000 })
      assert.equal(run.signal, null, run.stderr)
      assert.equal(run.status, 2, run.stderr)
      const result = JSON.parse(run.stdout)
      assert.equal(result.identical, false)
      assert.equal(result.comparisonComplete, false)
      assert.equal(result.failure.stage, "worker")
      if (action.includes("SIGKILL")) assert.equal(result.failure.signal, "SIGKILL")
      else assert.equal(result.failure.exitCode, 0)
      assert.ok(result.environmentDiagnostics.some(d => d.blocking))
    }
  })
})
