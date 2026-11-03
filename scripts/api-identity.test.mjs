import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript, publishedEntrypoints } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function fixture(before, after, fn, manifest) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
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
  fail('export type X = import("missing-package").X;', 'export type X = import("missing-package").X;')
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
    assert.match(result.typeDifferences.map(x => x.diagnostic).join("\n"), /TS2304/)
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
  fail("export enum E { A = Missing }", "export enum E { A = Missing }")
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
