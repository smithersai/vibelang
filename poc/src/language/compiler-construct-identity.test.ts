import { expect, test } from "bun:test";
import { analyzeSource } from "./analyze.ts";
import { compileSmithers } from "./compile.ts";
import { buildSemanticModel, COMPILER_INTRINSIC_SPECIFIERS } from "./semantic.ts";

/**
 * Recognizing a compiler construct by the SPELLING of a type instead of by the
 * declaration the checker resolved it to.
 *
 * `Result`, `Promise`, `Error` and `Panic` are the four constructs whose
 * identity decides a function's channel, and each of the four was decided by a
 * bare name: `nominalTypeName` (`aliasSymbol.getName() ?? getSymbol().getName()`,
 * with no declaring-file check) for the first three, and membership of the
 * literal row string `"Panic"` for the fourth. A `.sm` author who declares a
 * type of the same name gets the compiler's answer for their own type, and an
 * author who spells the compiler's own type through a `type` alias gets the
 * opposite mistake.
 *
 * Both directions ship. The name-only reading of `Result` injects
 * `__vsResultSuccess` into a function that returns a user struct, and charges
 * SMITHERS1301 against a caller that merely reads a field off it; the name-only
 * reading of `Panic` materializes a real `panic()` as a value inside a failure
 * row that contains only the author's own `Panic`, which is exactly the
 * fail-open `panicMaterializes` is documented to prevent.
 *
 * The sound mechanism was already in this file five times over
 * (`isCompilerPrelude`, at 4832/5013/5072/5723/6323/6524) and the prelude
 * already declares a `__smithersResult` brand for precisely this question. Each
 * case below was RED on the name-only reading; the `negative control` cases pin
 * the compiler's own constructs so a fix cannot buy soundness by ceasing to
 * recognize them.
 */

const FILE = "/virtual/identity.sm";

function analyze(source: string) {
  return analyzeSource(source, { fileName: FILE });
}

function emit(source: string): string {
  return compileSmithers(source, { fileName: FILE, sourceMap: false }).code;
}

function codes(source: string): readonly string[] {
  return analyze(source).diagnostics.map((diagnostic) => diagnostic.code);
}

function channelOf(source: string, name: string): string | undefined {
  return analyze(source).functions.find((fn) => fn.name === name)?.channel;
}

// ---------------------------------------------------------------------------
// Result: a user type spelled `Result` is not the compiler's channel.
// ---------------------------------------------------------------------------

/** A plain user struct. Nothing here is a Smithers channel. */
const USER_RESULT_STRUCT = `
interface Result<A, E> { readonly value: A; readonly other: E }
function make(): Result<string, number> { return { value: "x", other: 1 } }
export function use(): string { return make().value }
`;

test("a user type spelled Result is not lowered as the compiler's channel", () => {
  // RED: emitted `return __vsResultSuccess({ value: "x", other: 1 })` — a
  // runtime Result where the declaration promises the author's own struct.
  expect(emit(USER_RESULT_STRUCT)).not.toContain("__vsResultSuccess");
  expect(channelOf(USER_RESULT_STRUCT, "make")).toBe("plain");
});

test("reading a field off a user type spelled Result is not an unconsumed Result", () => {
  // RED: SMITHERS1301 "Result value is not consumed" against `make().value`.
  expect(codes(USER_RESULT_STRUCT)).toEqual([]);
});

test("a user CLASS spelled Result does not have a channel return spliced into its constructor", () => {
  const source = `
class MyErr extends Error {}
class Result<A, E> { constructor(readonly a: A, readonly e: E) {} }
export function make(): Result<string, MyErr> { return new Result("x", new MyErr()) }
`;
  // RED: the constructor body became `{ return __vsResultSuccess(undefined); }`
  // and SMITHERS1105 was charged against a class the compiler does not own.
  expect(emit(source)).not.toContain("__vsResultSuccess");
  expect(codes(source)).not.toContain("SMITHERS1105");
});

test("the brand alone does not confer the channel; only the prelude's brand does", () => {
  // A user may spell `__smithersResult` themselves. The brand is evidence only
  // when the property RESOLVES to the prelude's declaration of it.
  const source = `
class Missing extends Error {}
interface Result<A, E> { readonly __smithersResult: { readonly success: A; readonly error: E } }
export function make(): Result<string, Missing> { return null as never }
`;
  expect(emit(source)).not.toContain("__vsResultSuccess");
  expect(channelOf(source, "make")).toBe("plain");
});

test("negative control: the compiler's own Result is still recognized", () => {
  const source = `
class Missing extends Error {}
export function lookup(k: string): Result<string, Missing> {
  if (k === "") throw new Missing()
  return k
}
`;
  expect(channelOf(source, "lookup")).toBe("result");
  expect(analyze(source).rows["lookup"]?.failures).toEqual(["Missing"]);
  const code = emit(source);
  expect(code).toContain("__vsResultFailure(new Missing())");
  expect(code).toContain("__vsResultSuccess(k)");
});

test("negative control: the compiler's own Result behind a type alias is still recognized", () => {
  const source = `
class Missing extends Error {}
type R<A, E extends Error> = Result<A, E>;
export function lookup(k: string): R<string, Missing> {
  if (k === "") throw new Missing()
  return k
}
`;
  // RED: `nominalTypeName` reads `aliasSymbol` FIRST, so this answered "R" and
  // `declaredFailureRowType` returned undefined — the author was told to "use
  // Result<A, E>" for a declaration that already is one. An over-refusal on a
  // correct program.
  expect(codes(source)).toEqual([]);
  expect(channelOf(source, "lookup")).toBe("result");
});

// ---------------------------------------------------------------------------
// Promise: a user type spelled `Promise` is not the ambient Promise.
// ---------------------------------------------------------------------------

test("a user type spelled Promise is not unwrapped as the ambient Promise", () => {
  const source = `
class Missing extends Error {}
interface Promise<A> { readonly held: A }
export function grab(): Promise<Result<string, Missing>> { return { held: null as never } }
`;
  // RED: `promisedType` unwrapped the author's own container, found the real
  // `Result` inside it, and published a result channel for a function that
  // synchronously returns a struct — then emitted
  // `return __vsResultSuccess({ held: ... })`, which is not the declared type.
  expect(channelOf(source, "grab")).toBe("plain");
  expect(emit(source)).not.toContain("__vsResultSuccess");
});

test("negative control: the ambient Promise is still unwrapped", () => {
  const source = `
class Missing extends Error {}
export async function grab(k: string): Promise<Result<string, Missing>> {
  if (k === "") throw new Missing()
  return k
}
`;
  const grab = analyze(source).functions.find((fn) => fn.name === "grab");
  expect(grab?.channel).toBe("result");
  expect(grab?.async).toBe(true);
  expect(emit(source)).toContain("__vsResultFailure(new Missing())");
});

// ---------------------------------------------------------------------------
// Error: a user class spelled `Error` is not the ambient Error.
// ---------------------------------------------------------------------------

test("a user class spelled Error does not make its subclasses a recoverable failure", () => {
  const source = `
class Error { constructor(readonly m: string) {} }
class Boom extends Error {}
export function go(): void { throw new Boom("x") }
`;
  // RED: `isErrorType` matched the name, so `throw new Boom("x")` lifted into a
  // failure channel and the emit became `return __vsResultFailure(new
  // Boom("x"))` inside a function declared `: void`. A throw of a non-Error is
  // SMITHERS1103; recognizing it as an Error is a fail-open.
  expect(emit(source)).not.toContain("__vsResultFailure");
  expect(codes(source)).toContain("SMITHERS1103");
});

test("negative control: a real Error subclass is still a recoverable failure", () => {
  const source = `
class Boom extends Error {}
export function go(): Result<number, Boom> { throw new Boom() }
`;
  expect(analyze(source).rows["go"]?.failures).toEqual(["Boom"]);
  expect(emit(source)).toContain("__vsResultFailure(new Boom())");
});

test("negative control: the prelude's Panic is still an Error", () => {
  const source = `
export function go(k: string): Result<number, Panic> {
  if (k === "") throw new Panic()
  return 1
}
`;
  expect(analyze(source).rows["go"]?.failures).toEqual(["Panic"]);
});

// ---------------------------------------------------------------------------
// Panic: the row string "Panic" is not the compiler's Panic.
// ---------------------------------------------------------------------------

test("a real panic() does not materialize into a row holding only the author's own Panic", () => {
  const source = `
class Panic extends Error {}
export function force(k: string): Result<string, Panic> {
  if (k === "") throw new Panic()
  if (k === "!") Reflect.panic("boom")
  return k
}
`;
  // RED: `panicMaterializes` asked `owner.failures.has("Panic")`, the row string
  // the author's own class also mints, and emitted
  // `return __vsResultFailure(__vsPanicValue("boom"))`. That places a runtime
  // panic value in a channel whose only declared member is the author's
  // `Panic`, so a caller's exhaustive `match`/`is(Panic)` does not recognize it
  // — the exact fail-open the `panicMaterializes` comment says it prevents.
  const code = emit(source);
  expect(code).toContain("throw __vsPanicValue(\"boom\")");
  expect(code).not.toContain("__vsResultFailure(__vsPanicValue(\"boom\"))");
});

test("negative control: a real panic() still materializes into a row holding the compiler's Panic", () => {
  const source = `
export function force(k: string): Result<string, Panic> {
  if (k === "!") Reflect.panic("boom")
  return k
}
`;
  expect(emit(source)).toContain("__vsResultFailure(__vsPanicValue(\"boom\"))");
});

test("negative control: a panic in a plain-channel function still unwinds", () => {
  const source = `
export function force(k: string): string {
  if (k === "!") Reflect.panic("boom")
  return k
}
`;
  expect(emit(source)).toContain("throw __vsPanicValue(\"boom\")");
});

// ---------------------------------------------------------------------------
// Fences. Neither of these is a defect today; both were REPORTED as one, and a
// fence nobody can see move is how the last three "unreachable by
// construction" claims in this repo went stale.
// ---------------------------------------------------------------------------

test("fence: a user class spelled Context is not a capability", () => {
  // `extendsImportedContext` tests the name at one line and the DECLARING FILE
  // at the next, so the name test is a pre-filter and not the decision. This
  // pins that ordering: delete the `isCompilerPrelude` half and this goes red.
  const userContext = `
class Context { static context<C>(this: C): C { return this } }
class Db extends Context {}
export function go(): number { Db.context(); return 1 }
`;
  expect(analyze(userContext).rows["go"]?.requirements).toEqual([]);

  const realContext = `
import { Context } from "smthrs/context";
class Db extends Context {}
export function go(): number { Db.context(); return 1 }
`;
  expect(analyze(realContext).rows["go"]?.requirements).toEqual(["Db"]);
});

test("fence: every module the prelude declares is a compiler-intrinsic specifier", () => {
  // `resolvedModuleSourceFile` skips declarations that live in the prelude,
  // because resolving an authored `import ... from "smithers:exceptions"` to the
  // prelude's own `declare module` would hand the SMITHERS1510 module-trust pass
  // a `.d.ts` with no `@throws {never}` marker and refuse the compiler's own
  // prelude. Nothing reaches that state today only because all three call sites
  // filter compiler-intrinsic specifiers out FIRST. That makes this list
  // containment the real fence, so it is asserted rather than assumed: add a
  // `declare module` to the prelude without adding it here and this goes red
  // instead of the compiler refusing itself.
  const model = buildSemanticModel(`export function f(): number { return 1 }`, { fileName: FILE });
  const prelude = model.program.getSourceFiles()
    .find((file) => file.fileName.endsWith("__smithers_frontend_prelude__.d.ts"));
  expect(prelude).toBeDefined();

  const declared = [...prelude!.text.matchAll(/declare module "([^"]+)"/g)].map((match) => match[1]!);
  expect(declared.length).toBeGreaterThan(0);
  for (const specifier of declared) {
    expect([specifier, COMPILER_INTRINSIC_SPECIFIERS.has(specifier)]).toEqual([specifier, true]);
  }
});

test("fence: the prelude is identified by an absolute path, not by the bare file name", () => {
  // `PRELUDE_NAME` is a bare basename and every prelude source file is created
  // with `resolve(<dir>, PRELUDE_NAME)`. A guard spelled `fileName !==
  // PRELUDE_NAME` is therefore vacuous — it can never be equal, so it never
  // excludes anything. This pins the fact that makes `endsWith`/`isCompilerPrelude`
  // the only correct spelling.
  const model = buildSemanticModel(`export function f(): number { return 1 }`, { fileName: FILE });
  const prelude = model.program.getSourceFiles()
    .find((file) => file.fileName.endsWith("__smithers_frontend_prelude__.d.ts"));
  expect(prelude!.fileName).not.toBe("__smithers_frontend_prelude__.d.ts");
});
