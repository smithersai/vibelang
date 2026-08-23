import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeSource } from "./analyze.ts";
import { compileSmithers } from "./compile.ts";
import { checkEmittedTypeScript } from "./validate.ts";

/**
 * Retired-syntax recognition is a GRAMMAR property, not a token-adjacency
 * property. Every rule here has both halves asserted:
 *
 *  - a NEGATIVE row: a legal program that names one of the retired words in an
 *    ordinary position compiles clean, and (where it has runtime meaning) is
 *    executed so the "legal" claim is proven rather than asserted;
 *  - a POSITIVE row: the genuinely retired spelling is still refused with
 *    SMITHERS1001 at the exact authored line and column.
 *
 * A rejection that is too broad is its own bug, and so is a fix that stops
 * rejecting real retired syntax.
 */

const examples = `${import.meta.dir}/../../examples/language`;

function retired(source: string) {
  return analyzeSource(source)
    .diagnostics
    .filter((diagnostic) => diagnostic.code === "SMITHERS1001" || diagnostic.code === "SMITHERS1000")
    .map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`);
}

function errorCodes(source: string) {
  return analyzeSource(source)
    .diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
}

/** Compile, type-check the emitted TypeScript, and run `main()`. */
async function runModule(source: string, name: string) {
  const options = {
    fileName: `${examples}/${name}.sm`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.sm`,
  };
  const checked = compileSmithers(source, { ...options, runtimeImport: "../../src/runtime/index.ts" });
  expect(checked.analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(checkEmittedTypeScript(checked.code, options.outputFileName)
    .filter((diagnostic) => diagnostic.category === 1)).toEqual([]);

  const executable = compileSmithers(source, {
    ...options,
    runtimeImport: pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  });
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "smithers-retired-"));
  try {
    const modulePath = join(directory, `${name}.mjs`);
    await writeFile(modulePath, javascript);
    const module = await import(pathToFileURL(modulePath).href) as { main(): string[] };
    return module.main();
  } finally {
    await rm(directory, { recursive: true });
  }
}

describe("retired syntax is recognized by grammar shape, not token adjacency", () => {
  // ------------------------------------------------------------------
  // prefix `try` and postfix `catch`
  // ------------------------------------------------------------------

  test("an object literal with `try` and `catch` members is ordinary code", async () => {
    // The reproduction. `try` and `catch` are ECMAScript reserved words, so an
    // occurrence that is neither statement-form nor an operator with operands
    // is always a property name. Testing only the preceding token reported
    // both of these as retired Smithers grammar.
    const source = `
export function main(): string[] {
  const adapter = { try: (value: number): number => value + 1, catch: (): string => "handled" }
  return [String(adapter.try(41)), adapter.catch()]
}
`;
    expect(retired(source)).toEqual([]);
    expect(await runModule(source, "retired-object-members")).toEqual(["42", "handled"]);
  });

  test("`try` and `catch` are legal in every member-name position", () => {
    const rows: Array<[string, string]> = [
      ["object literal members", `const a = { try: 1, catch: 2 }`],
      ["object literal methods", `const a = { try() { return 1 }, catch() { return 2 } }`],
      ["object accessor", `const a = { get catch(): number { return 1 } }`],
      ["destructuring pattern", `const { try: t, catch: c } = { try: 1, catch: 2 }`],
      ["class methods", `class A { try(): number { return 1 }\n  catch(): number { return 2 } }`],
      ["class static methods", `class A { static try(): number { return 1 }\n  static catch(): number { return 2 } }`],
      ["class async method", `class A { async try(): Promise<number> { return 1 } }`],
      ["class fields", `class A { try = 1\n  catch = 2 }`],
      ["interface members", `interface A { try: number; catch: number }`],
      ["interface optional member", `interface A { catch?: () => number }`],
      ["type-literal call signatures", `type A = { try(): number; catch(): number }`],
      ["enum members", `enum Kind { try = 1, catch = 2 }`],
      ["member access", `declare const p: { try(): void; catch(): void }\nconst r = [p.try(), p.catch()]`],
      ["optional member access", `declare const p: { catch?(): void } | undefined\nconst r = p?.catch?.()`],
    ];
    for (const [label, body] of rows) {
      expect(`${label}: ${retired(body).join(",")}`).toBe(`${label}: `);
    }
  });

  test("statement-form try/catch/finally stays legal", async () => {
    const source = `
export function main(): string[] {
  const seen: string[] = []
  try {
    seen.push("body")
  } catch (error) {
    seen.push("caught")
  } finally {
    seen.push("finally")
  }
  return seen
}
`;
    expect(retired(source)).toEqual([]);
    expect(await runModule(source, "retired-statement-try")).toEqual(["body", "finally"]);
  });

  test("a Promise .catch() is owned by the Promise discipline, not the retired rule", () => {
    const source = `
async function load(): Promise<string> { return "value" }
export async function run(): Promise<string> {
  return await load().catch(() => "fallback")
}
`;
    expect(retired(source)).toEqual([]);
    // Reporting this as retired grammar would send the author to entirely the
    // wrong migration, so the codes are pinned, not merely their absence.
    expect(errorCodes(source)).toContain("SMITHERS1401");
  });

  test("the retired prefix `try` marker is still refused at the marker", () => {
    // `\n` puts the construct on line 3, column 16 — the `t` of `try`.
    expect(retired(`
function compute(key: string): string { return key }
const name = try compute("ada")
`)).toEqual(["SMITHERS1001@3:14"]);
  });

  test("the retired postfix `catch` expression is still refused at the keyword", () => {
    expect(retired(`
function compute(key: string): string { return key }
const name = compute("zoe") catch "Guest"
`)).toEqual(["SMITHERS1001@3:29"]);
  });

  test("both retired markers survive together, each at its own position", () => {
    expect(retired(`
declare const db: { read(): string }
const value = try db.read() catch "none"
`)).toEqual(["SMITHERS1001@3:15", "SMITHERS1001@3:29"]);
  });

  // ------------------------------------------------------------------
  // `orelse`
  // ------------------------------------------------------------------

  test("`orelse` is an ordinary identifier in every non-operator position", async () => {
    const rows: Array<[string, string]> = [
      ["object member", `const a = { orelse: 7 }`],
      ["shorthand member", `const orelse = 7\nconst a = { orelse }`],
      ["binding", `const orelse = 7`],
      ["call argument", `declare function f(v: number): void\nconst orelse = 1\nf(orelse)`],
      ["call target", `const orelse = (): number => 1\nconst v = orelse()`],
      ["binary operand", `const orelse = 1\nconst total = 2 + orelse`],
      ["member access", `const a = { orelse: 1 }\nconst v = a.orelse`],
      ["array element", `const orelse = 1\nconst v = [orelse]`],
      ["parameter name", `function f(orelse: number): number { return orelse }`],
    ];
    for (const [label, body] of rows) {
      expect(`${label}: ${retired(body).join(",")}`).toBe(`${label}: `);
    }
    const source = `
export function main(): string[] {
  const orelse = (value: number): number => value + 1
  const totals = { orelse: orelse(6) }
  return [String(totals.orelse)]
}
`;
    expect(retired(source)).toEqual([]);
    expect(await runModule(source, "retired-orelse-identifier")).toEqual(["7"]);
  });

  test("the retired `orelse` operator is still refused at the operator", () => {
    expect(retired(`
function lookup(id: number): Optional<string> { return id === 1 ? "Ada" : null }
const name = lookup(1) orelse "Guest"
`)).toEqual(["SMITHERS1001@3:24"]);
  });

  // ------------------------------------------------------------------
  // `error Name {}` declaration
  // ------------------------------------------------------------------

  test("`error` is an ordinary identifier, including across an ASI statement break", () => {
    const rows: Array<[string, string]> = [
      ["object member", `const payload = { error: "boom" }`],
      ["binding", `const error = { code: 1 }`],
      ["catch binding", `try { } catch (error) { }`],
      ["parameter name", `function report(error: string): string { return error }`],
      // Two statements plus a block. `error` is followed by an identifier and
      // then `{`, but a line terminator separates them, so this is ASI, not a
      // declaration header.
      ["ASI statement pair", `declare const error: unknown\ndeclare const Missing: unknown\nerror\nMissing\n{\n  const inner = 1\n}`],
    ];
    for (const [label, body] of rows) {
      expect(`${label}: ${retired(body).join(",")}`).toBe(`${label}: `);
    }
  });

  test("the retired `error Name {}` declaration is still refused at the keyword", () => {
    expect(retired(`error Missing {}\n`)).toEqual(["SMITHERS1001@1:1"]);
    expect(retired(`error Missing { id: string }\n`)).toEqual(["SMITHERS1001@1:1"]);
  });

  // ------------------------------------------------------------------
  // `throws` / `uses` clauses
  // ------------------------------------------------------------------

  test("`throws` and `uses` are legal type and member names", () => {
    const rows: Array<[string, string]> = [
      ["object members", `const meta = { throws: 1, uses: 2 }`],
      ["member access", `const meta = { throws: 1, uses: 2 }\nconst v = [meta.throws, meta.uses]`],
      ["bindings", `const throws = 1\nconst uses = 2`],
      ["return type member", `function describe(): { throws: string } { return { throws: "x" } }`],
      ["type argument", `type uses = string\nfunction pick(key: string): Array<uses> { return [key] }`],
      ["union member", `type throws = string\nfunction pick(key: string): string | throws { return key }`],
      ["nested type argument", `type uses = number\nconst f = function (n: number): Record<string, uses> { return { n } }`],
      ["parameter name", `const f = function (throws: number): number { return throws }`],
    ];
    for (const [label, body] of rows) {
      expect(`${label}: ${retired(body).join(",")}`).toBe(`${label}: `);
    }
  });

  test("the retired `throws` and `uses` clauses are still refused at the clause keyword", () => {
    expect(retired(`
class Missing extends Error {}
export function lookup(key: string): string throws Missing {
  return "Ada Lovelace"
}
`)).toEqual(["SMITHERS1001@3:45"]);
    expect(retired(`
declare const Clock: unknown
export function stamp(): number uses Clock {
  return 7
}
`)).toEqual(["SMITHERS1001@3:33"]);
  });

  // ------------------------------------------------------------------
  // `!T` and `?T` type markers
  // ------------------------------------------------------------------

  test("a logical negation directly after a colon is not the `!T` marker", async () => {
    const rows: Array<[string, string]> = [
      ["object literal value", `const failed = false\nconst state = { ok: !failed }`],
      ["ternary alternate", `const a = true\nconst b = false\nconst v = a ? b : !b`],
      ["nested ternary", `const a = true\nconst b = false\nconst v = a ? !b : !a`],
    ];
    for (const [label, body] of rows) {
      expect(`${label}: ${retired(body).join(",")}`).toBe(`${label}: `);
    }
    const source = `
export function main(): string[] {
  const failed = false
  const state = { ok: !failed }
  return [String(state.ok), String(failed ? failed : !failed)]
}
`;
    expect(retired(source)).toEqual([]);
    expect(await runModule(source, "retired-bang-negation")).toEqual(["true", "true"]);
  });

  test("the retired `!T` and `?T` markers are still refused at the marker", () => {
    expect(retired(`
class Missing extends Error {}
export function lookup(key: string): !string {
  if (key !== "ada") throw new Missing(key)
  return "Ada Lovelace"
}
`)).toEqual(["SMITHERS1001@3:38"]);
    expect(retired(`export function lookup(id: number): ?string {\n  return null\n}\n`))
      .toEqual(["SMITHERS1001@1:37"]);
    // The `!?T` pair reports both markers, each at its own column.
    expect(retired(`export function lookup(id: number): !?string {\n  return null\n}\n`))
      .toEqual(["SMITHERS1001@1:37", "SMITHERS1001@1:38"]);
  });

  test("an ordinary optional/ternary `?` is not the `?T` marker", () => {
    const rows: Array<[string, string]> = [
      ["optional parameter", `function greet(name?: string): string { return name ?? "guest" }`],
      ["optional type member", `type Rec = { name?: string }`],
      ["ternary chain", `const a = true\nconst c = false\nconst v = a ? "b" : c ? "d" : "e"`],
      ["object value ternary", `const b = true\nconst o = { a: b ? "c" : "d" }`],
      ["non-null then ternary", `declare const s: { flag?: boolean }\nconst v = s.flag! ? "yes" : "no"`],
    ];
    for (const [label, body] of rows) {
      expect(`${label}: ${retired(body).join(",")}`).toBe(`${label}: `);
    }
  });

  // ------------------------------------------------------------------
  // `.?` postfix operator
  // ------------------------------------------------------------------

  test("optional chaining and member-then-ternary are not the `.?` operator", () => {
    const rows: Array<[string, string]> = [
      ["optional chain", `declare const a: { b?: string }\nconst v = a?.b ?? "none"`],
      ["optional call", `declare const a: { b?: () => string }\nconst v = a.b?.() ?? "none"`],
      ["optional element", `declare const a: { b?: string[] }\nconst v = a.b?.[0] ?? "none"`],
      ["member then ternary", `const a = { b: true }\nconst v = a.b ? "x" : "y"`],
      ["spread", `const parts = ["a"]\nconst all = [...parts]`],
    ];
    for (const [label, body] of rows) {
      expect(`${label}: ${retired(body).join(",")}`).toBe(`${label}: `);
    }
  });

  test("the retired `.?` operator is still refused at the dot", () => {
    expect(retired(`
function lookup(id: number): Optional<string> { return id === 1 ? "Ada" : null }
const name = lookup(1).?
`)).toEqual(["SMITHERS1001@3:23"]);
  });

  // ------------------------------------------------------------------
  // literals carry no grammar
  // ------------------------------------------------------------------

  test("strings, templates, regular expressions, and comments carry no grammar", () => {
    const rows: Array<[string, string]> = [
      ["string literal", `const s = "try catch orelse throws uses .? error Missing {}"`],
      ["template literal", "const n = 1\nconst s = `try ${n} catch orelse throws uses`"],
      ["template with braces", "const n = 1\nconst s = `${n} catch` + `orelse ${n}`"],
      // Without the scanner's regex re-scan, `/catch/` would enter the token
      // stream as a bare `catch` preceded by `/` — neither `}` nor `.`, so
      // both of the old adjacency guards would have passed.
      ["regex /catch/", `const re = /catch/\nconst v = re.test("catch")`],
      ["regex /try/", `const re = /try/`],
      ["regex /orelse/", `const re = /orelse/`],
      ["regex /throws|uses/", `const re = /throws|uses/`],
      ["line comment", `// try catch orelse throws uses error Missing {}\nconst v = 1`],
      ["block comment", `/* try catch orelse\n   throws uses */\nconst v = 1`],
    ];
    for (const [label, body] of rows) {
      expect(`${label}: ${retired(body).join(",")}`).toBe(`${label}: `);
    }
  });

  // ------------------------------------------------------------------
  // throw is not an expression
  // ------------------------------------------------------------------

  test("statement `throw` is legal and expression `throw` is SMITHERS1000", () => {
    expect(retired(`
class Missing extends Error {}
export function lookup(key: string): Result<string, Missing> {
  if (key !== "ada") throw new Missing(key)
  return "Ada Lovelace"
}
`)).toEqual([]);
    expect(retired(`
class Missing extends Error {}
export function lookup(key: string): Result<string, Missing> {
  const name = key === "ada" ? "Ada Lovelace" : throw new Missing(key)
  return name
}
`)).toEqual(["SMITHERS1000@4:49"]);
  });

  // ------------------------------------------------------------------
  // narrowing must not become under-rejection
  // ------------------------------------------------------------------

  test("retired spellings the corpus does not pin are still refused", () => {
    // Each row is a genuinely retired form in a shape no corpus case covers.
    // Narrowing the rules to a grammar shape must not let any of them through.
    const rows: Array<[string, string]> = [
      ["prefix try on a member call", `declare const db: { read(): string }\nconst v = try db.read()`],
      ["prefix try on a parenthesized operand", `declare function compute(): string\nconst v = try (compute())`],
      ["postfix catch with a parenthesized operand", `declare function compute(): string\nconst v = compute() catch ("Guest")`],
      ["postfix catch on a member call", `declare const db: { read(): string }\nconst v = db.read() catch "none"`],
      ["orelse after a member call", `declare const db: { read(): string }\nconst v = db.read() orelse "none"`],
      ["orelse after an identifier", `declare const a: string\nconst v = a orelse "none"`],
      ["orelse after a literal", `const v = "x" orelse "none"`],
      ["!T on a variable annotation", `declare function f(): unknown\nconst v: !string = f()`],
      ["!T on a type member", `type Rec = { name: !string }`],
      ["throws clause on a function declaration", `class Missing extends Error {}\nfunction look(k: string): string throws Missing { return k }`],
      ["uses clause on a function declaration", `declare const Clock: unknown\nfunction stamp(): number uses Clock { return 7 }`],
      [".? on a call", `declare function lookup(): Optional<string>\nconst v = lookup().?`],
    ];
    for (const [label, body] of rows) {
      const codes = retired(body);
      expect(`${label}: ${codes.some((code) => code.startsWith("SMITHERS1001")) ? "refused" : codes.join(",")}`)
        .toBe(`${label}: refused`);
    }
    // Retired clauses on arrows and methods are not claimed by the migration
    // sweep (it recognizes the `function` keyword), but they still fail closed
    // as the grammar rule rather than being accepted.
    for (const body of [
      `class Missing extends Error {}\nconst f = (k: string): string throws Missing => k`,
      `class Missing extends Error {}\nclass A { look(k: string): string throws Missing { return k } }`,
    ]) {
      expect(retired(body).every((code) => code.startsWith("SMITHERS1000"))).toBe(true);
      expect(retired(body).length).toBeGreaterThan(0);
    }
  });

  // ------------------------------------------------------------------
  // the composite the earlier suite pinned, still refused in full
  // ------------------------------------------------------------------

  test("every retired spelling in one module is still rejected", () => {
    const messages = analyzeSource(`
      error Missing { id: string }
      function old(): !?string throws Missing uses db: Db {
        return try db.read() orelse "none"
      }
      const value = old() catch "fallback"
    `)
      .diagnostics
      .filter((diagnostic) => diagnostic.code === "SMITHERS1001")
      .map((diagnostic) => diagnostic.message)
      .join("\n");
    expect(messages).toContain("historical `error Name {}`");
    expect(messages).toContain("`throws` row grammar was removed");
    expect(messages).toContain("named `uses` grammar was removed");
    expect(messages).toContain("`!T` return marker was removed");
    expect(messages).toContain("`?T` type grammar was removed");
    expect(messages).toContain("`orelse` operator was removed");
    expect(messages).toContain("prefix `try`");
    expect(messages).toContain("postfix catch expression");
  });
});
