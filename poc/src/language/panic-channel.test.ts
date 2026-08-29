/**
 * Panic does not widen a return type.
 *
 * `docs/src/pages/specification/failures.mdx` §Panic Does Not Widen a Return
 * Type (normative), with the matching Locked entry in `docs/DECISIONS.md`:
 *
 * > Calling `panic(...)` MUST NOT force a function's return type to widen into
 * > `Result<A, Panic>`. ... A function that validates an argument, refuses a
 * > forgery, or asserts an invariant MUST therefore be able to abort with
 * > `panic(...)` while keeping a plain return type.
 *
 * > An author MAY still annotate `Result<A, Panic>` explicitly to materialize a
 * > panic as a value; that is how panic is made explicitly catchable. The
 * > prohibition is on the compiler *forcing* that widening, not on an author
 * > choosing it.
 *
 * The rule is a consequence of two MUSTs the same page already carried — the
 * panic case is "tracked separately from ordinary recoverable Error variants"
 * (§Compiler Lifting) and "Ordinary Result recovery MUST NOT swallow panic
 * implicitly" (§Foreign Exceptions) — because `E` is the *expected*-error
 * channel (`reference/function-channels.mdx`) and a panic is not an expected
 * error. Forcing `Result<A, Panic>` put the panic inside `E`, where `unwrapOr`,
 * `recover`, and `match` consume it as ordinary and it vanishes from the
 * caller's row.
 *
 * These tests EXECUTE the emitted modules. The defect they pin compiled with
 * zero diagnostics and misbehaved only at run time — a diagnostic-only
 * assertion would have passed against the compiler that produced it.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileSmithers } from "./compile.ts";
import { compileAndCheckSmithers } from "./validate.ts";
import { isPanic } from "../runtime/panic.ts";

const examples = `${import.meta.dir}/../../examples/language`;

function check(source: string, name: string) {
  return compileAndCheckSmithers(source, {
    fileName: `${examples}/${name}.sm`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.sm`,
    runtimeImport: "../../src/runtime/index.ts",
  });
}

/** Every error-severity diagnostic, as `CODE@line:column`. */
function refusals(source: string, name: string): readonly string[] {
  const compiled = check(source, name);
  const language = compiled.result.analysis.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`);
  const emitted = compiled.emitDiagnostics.map((diagnostic) => {
    const position = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
    return `TS${diagnostic.code}@${position ? `${position.line + 1}:${position.character + 1}` : "?"}`;
  });
  return [...language, ...emitted];
}

async function execute(source: string, name: string): Promise<Record<string, any>> {
  const executable = compileSmithers(source, {
    fileName: `${examples}/${name}.sm`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.sm`,
    runtimeImport: pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  });
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "smithers-panic-"));
  const modulePath = join(directory, `${name}.mjs`);
  try {
    await writeFile(modulePath, javascript);
    return await import(pathToFileURL(modulePath).href) as Record<string, any>;
  } finally {
    await rm(directory, { recursive: true });
  }
}

/** Run `body`, returning the thrown value rather than propagating it. */
function caught(body: () => unknown): unknown {
  try {
    body();
    return undefined;
  } catch (error) {
    return error;
  }
}

const PANIC = `import { panic } from "smithers:exceptions"\n`;

/**
 * Every construct that can host a `panic(...)` exit and carries a declared or
 * inferred return type. Before the rule, each of these was refused: the
 * panicking declaration drew SMITHERS1101 (or SMITHERS1102 unannotated, or
 * SMITHERS1105 for an accessor or constructor, or SMITHERS1106 for a
 * generator), and every call site drew a cascading SMITHERS1301/1302 for an
 * unconsumed Result that only existed because of the widening.
 */
// The rows that call `fail` guard on the INDEX READ rather than on
// `values.length === 0`. `noUncheckedIndexedAccess` is mandatory
// (compatibility.mdx §Mandatory), so `values[0]` is `string | undefined` and
// `main(): string` cannot return it unnarrowed — the length test never told the
// checker anything about the read. Narrowing the read keeps every row's actual
// subject: a `never`-returning helper is called in a guard, and the enclosing
// function's plain return type is not widened by it.
//
// The guard RETURNS the `fail(...)` call rather than calling it as a statement.
// TypeScript applies never-narrowing to a bare call only when the callee is a
// name with an explicit TYPE annotation, which `const fail = (m: string): never
// => panic(m)` is not — the annotation is on the arrow, not on the binding — so
// the `arrow-concise-body` row alone kept its TS2322. Returning the call needs
// no narrowing at all: `never` is assignable to every return type, which is the
// property these rows are about.
const FORMS: ReadonlyArray<{ readonly name: string; readonly source: string; readonly expected: unknown }> = [
  {
    name: "function-declaration",
    source: `${PANIC}
export function guarded(ok: boolean): string {
  if (!ok) panic("forged value")
  return "real"
}
export function main(): string { return guarded(true) }`,
    expected: "real",
  },
  {
    name: "inferred-return-type",
    source: `${PANIC}
function guarded(ok: boolean) {
  if (!ok) panic("forged value")
  return "real"
}
export function main(): string { return guarded(true) }`,
    expected: "real",
  },
  {
    name: "exported-unannotated",
    source: `${PANIC}
export function guarded(ok: boolean) {
  if (!ok) panic("forged value")
  return "real"
}
export function main(): string { return guarded(true) }`,
    expected: "real",
  },
  {
    name: "void-return",
    source: `${PANIC}
export function assertPositive(value: number): void {
  if (value <= 0) panic("value must be positive")
}
export function main(): string { assertPositive(1); return "ok" }`,
    expected: "ok",
  },
  {
    name: "never-returning-helper",
    source: `${PANIC}
function fail(message: string): never { panic(message) }
export function main(): string {
  const values = ["real"]
  const first = values[0]
  if (first === undefined) return fail("empty")
  return first
}`,
    expected: "real",
  },
  {
    name: "direct-return-of-panic",
    source: `${PANIC}
function fail(message: string): never { return panic(message) }
export function main(): string {
  const values = ["real"]
  const first = values[0]
  if (first === undefined) return fail("empty")
  return first
}`,
    expected: "real",
  },
  {
    name: "reflect-panic",
    source: `
export function guarded(ok: boolean): string {
  if (!ok) Reflect.panic("forged value")
  return "real"
}
export function main(): string { return guarded(true) }`,
    expected: "real",
  },
  {
    name: "arrow-concise-body",
    source: `${PANIC}
const fail = (message: string): never => panic(message)
export function main(): string {
  const values = ["real"]
  const first = values[0]
  if (first === undefined) return fail("empty")
  return first
}`,
    expected: "real",
  },
  {
    name: "arrow-braced-body",
    source: `${PANIC}
const guarded = (ok: boolean): string => {
  if (!ok) panic("forged")
  return "real"
}
export function main(): string { return guarded(true) }`,
    expected: "real",
  },
  {
    name: "arrow-braced-body-unannotated",
    source: `${PANIC}
const guarded = (ok: boolean) => {
  if (!ok) panic("forged")
  return "real"
}
export function main(): string { return guarded(true) }`,
    expected: "real",
  },
  {
    name: "function-expression",
    source: `${PANIC}
const guarded = function (ok: boolean): string {
  if (!ok) panic("forged")
  return "real"
}
export function main(): string { return guarded(true) }`,
    expected: "real",
  },
  {
    name: "instance-method",
    source: `${PANIC}
class Box {
  read(ok: boolean): string {
    if (!ok) panic("forged")
    return "real"
  }
}
export function main(): string { return new Box().read(true) }`,
    expected: "real",
  },
  {
    name: "static-method",
    source: `${PANIC}
class Box {
  static read(ok: boolean): string {
    if (!ok) panic("forged")
    return "real"
  }
}
export function main(): string { return Box.read(true) }`,
    expected: "real",
  },
  {
    name: "object-literal-method",
    source: `${PANIC}
const box = {
  read(ok: boolean): string {
    if (!ok) panic("forged")
    return "real"
  },
}
export function main(): string { return box.read(true) }`,
    expected: "real",
  },
  {
    // The closed contradiction: SMITHERS1101 said "widen to Result" while
    // SMITHERS1105 said an accessor may not carry a Result channel, on the same
    // line. Seven public getters in `poc/src/data/**` had no legal spelling.
    name: "class-getter",
    source: `${PANIC}
class Box {
  constructor(private readonly stored: number) {}
  get size(): number {
    if (this.stored < 0) panic("forged")
    return this.stored
  }
}
export function main(): string { return \`\${new Box(3).size}\` }`,
    expected: "3",
  },
  {
    name: "class-setter",
    source: `${PANIC}
class Box {
  stored = 0
  set size(value: number) {
    if (value < 0) panic("negative")
    this.stored = value
  }
}
export function main(): string {
  const box = new Box()
  box.size = 5
  return \`\${box.stored}\`
}`,
    expected: "5",
  },
  {
    name: "constructor",
    source: `${PANIC}
class Box {
  constructor(readonly size: number) {
    if (size < 0) panic("negative size")
  }
}
export function main(): string { return \`\${new Box(2).size}\` }`,
    expected: "2",
  },
  {
    name: "object-literal-getter",
    source: `${PANIC}
const box = {
  get label(): string { panic("no label") },
  plain: "real",
}
export function main(): string { return box.plain }`,
    expected: "real",
  },
  {
    name: "generator",
    source: `${PANIC}
function* items(ok: boolean): Generator<string> {
  if (!ok) panic("forged")
  yield "real"
}
export function main(): string { return [...items(true)].join("") }`,
    expected: "real",
  },
  {
    name: "async-function",
    source: `${PANIC}
async function guarded(ok: boolean): Promise<string> {
  if (!ok) panic("forged")
  return "real"
}
export async function main(): Promise<string> { return await guarded(true) }`,
    expected: "real",
  },
  {
    name: "async-arrow-unannotated",
    source: `${PANIC}
const guarded = async (ok: boolean) => {
  if (!ok) panic("forged")
  return "real"
}
export async function main(): Promise<string> { return await guarded(true) }`,
    expected: "real",
  },
  {
    name: "inline-callback",
    source: `${PANIC}
export function main(): string {
  return ["real"].map((value: string): string => {
    if (value === "") panic("forged")
    return value
  }).join("")
}`,
    expected: "real",
  },
  {
    name: "inline-callback-unannotated",
    source: `${PANIC}
export function main(): string {
  return ["real"].map((value: string) => {
    if (value === "") panic("forged")
    return value
  }).join("")
}`,
    expected: "real",
  },
  {
    name: "helper-one-hop",
    source: `${PANIC}
function fail(message: string): never { panic(message) }
function guarded(ok: boolean): string {
  if (!ok) fail("forged")
  return "real"
}
export function main(): string { return guarded(true) }`,
    expected: "real",
  },
  {
    name: "helper-two-hops",
    source: `${PANIC}
function fail(message: string): never { panic(message) }
function refuse(ok: boolean): void { if (!ok) fail("forged") }
function guarded(ok: boolean): string {
  refuse(ok)
  return "real"
}
export function main(): string { return guarded(true) }`,
    expected: "real",
  },
  {
    // The `poc/src/data/**` shape verbatim: a branded value type whose accessor
    // reads private state through a helper that refuses a forgery.
    name: "branded-value-type-accessor",
    source: `${PANIC}
type State = { readonly size: number }
const states = new WeakMap<object, State>()
function stateOf(value: object): State {
  const state = states.get(value)
  if (!state) panic("forged receiver")
  return state
}
class Box {
  constructor(size: number) { states.set(this, { size }) }
  get size(): number {
    const state = stateOf(this)
    return state.size
  }
}
export function main(): string { return \`\${new Box(3).size}\` }`,
    expected: "3",
  },
  {
    name: "module-level-value-from-a-panicking-factory",
    source: `${PANIC}
function make(value: number): { readonly value: number } {
  if (value < 0) panic("negative")
  return { value }
}
const one = make(1)
export function main(): string { return \`\${one.value}\` }`,
    expected: "1",
  },
];

describe("panic does not widen a return type", () => {
  // One test per form rather than one loop over all of them: each row compiles
  // and then executes a whole module, so a single combined test is slow enough
  // to trip the default timeout under full-suite load even though every row is
  // fast on its own.
  for (const form of FORMS) {
    test(`${form.name} keeps its plain return type, and runs`, async () => {
      expect({ [form.name]: refusals(form.source, `panic-form-${form.name}`) })
        .toEqual({ [form.name]: [] });
      const module = await execute(form.source, `panic-run-${form.name}`);
      expect(await module.main()).toEqual(form.expected);
    });
  }

  test("a panicking function publishes an empty failure row", () => {
    const rows = check(
      `${PANIC}
export function guarded(ok: boolean): string {
  if (!ok) panic("forged value")
  return "real"
}`,
      "panic-row",
    ).result.analysis.rows;
    expect(rows).toEqual({ guarded: { failures: [], requirements: [] } });
  });
});

describe("a panic is not an expected error", () => {
  const UNANNOTATED = `${PANIC}
export function guarded(ok: boolean): string {
  if (!ok) panic("forged value")
  return "real"
}`;

  test("the panic arrives as a thrown Panic, not as a recoverable failure", async () => {
    const module = await execute(UNANNOTATED, "panic-unannotated");
    expect(module.guarded(true)).toBe("real");
    const failure = caught(() => module.guarded(false));
    expect(isPanic(failure)).toBe(true);
    expect((failure as Error).message).toBe("forged value");
  });

  test("unwrapOr cannot consume it, because there is no Result to consume", () => {
    // This is the executed reproduction of the defect, inverted. With the
    // widening in place `guarded` published `Result<string, Panic>`, this line
    // compiled with ZERO diagnostics, returned "fallback", and the panic
    // disappeared from `withDefault`'s row entirely.
    const source = `${UNANNOTATED}
export function withDefault(ok: boolean): string {
  return guarded(ok).unwrapOr("fallback")
}`;
    expect(refusals(source, "panic-unwrapor")).toEqual(["TS2339@10:24"]);
  });

  test("recover and match cannot consume it either", () => {
    // `recover` is not a member of `string` at all. `match` IS
    // (`String.prototype.match`), so it is refused by argument type instead —
    // which is the point: whichever way an author reaches for ordinary Result
    // recovery, a plain return type has none to offer.
    const observed: Record<string, readonly string[]> = {};
    for (const [name, spelling] of [
      ["recover", `guarded(ok).recover(() => "fallback")`],
      ["match", `guarded(ok).match({ ok: (value) => value, error: () => "fallback" })`],
    ] as const) {
      const source = `${UNANNOTATED}
export function withDefault(ok: boolean): string {
  return ${spelling}
}`;
      observed[name] = refusals(source, `panic-${name}`);
    }
    expect(observed).toEqual({
      recover: ["TS2339@10:24"],
      match: ["TS2322@10:5", "TS2769@10:32", "TS7006@10:37"],
    });
  });

  test("a panic does not enter a declared recoverable error channel", async () => {
    // The over-correction guard. `force` publishes `Missing` as its expected
    // error channel; materializing the panic into that channel would hand a
    // Panic to an exhaustive `match` over `Missing`. Before this change the
    // annotated half was caught by SMITHERS1104 while the INFERRED half
    // compiled clean and emitted `__vsResultFailure(__vsPanicValue(...))` with
    // a published row of `["Missing","Panic"]`.
    const source = `${PANIC}
export class Missing extends Error {
  constructor(readonly key: string) { super(\`no entry for \${key}\`) }
}
export function force(key: string): Result<string, Missing> {
  if (key === "") panic("empty key")
  if (key !== "ada") throw new Missing(key)
  return "Ada Lovelace"
}
export function main(key: string): string {
  return force(key).match({ ok: (value) => value, error: (error) => \`missing: \${error.key}\` })
}`;
    expect(refusals(source, "panic-not-in-e")).toEqual([]);
    const rows = check(source, "panic-not-in-e").result.analysis.rows;
    expect(rows.force).toEqual({ failures: ["Missing"], requirements: [] });

    const module = await execute(source, "panic-not-in-e-run");
    expect(module.main("ada")).toBe("Ada Lovelace");
    expect(module.main("zoe")).toBe("missing: zoe");
    const failure = caught(() => module.main(""));
    expect(isPanic(failure)).toBe(true);
    expect((failure as Error).message).toBe("empty key");
  });
});

describe("an author may still choose the widening", () => {
  const ANNOTATED = `import { Panic, panic } from "smithers:exceptions"
export function force(key: string): Result<string, Panic> {
  if (key !== "ada") panic(\`no entry for \${key}\`)
  return "Ada Lovelace"
}
export function main(key: string): string {
  return force(key).match({ ok: (value) => value, error: (error) => \`panic: \${error.message}\` })
}`;

  test("an annotated Result<A, Panic> still materializes the panic as a value", async () => {
    expect(refusals(ANNOTATED, "panic-annotated")).toEqual([]);
    const compiled = check(ANNOTATED, "panic-annotated");
    expect(compiled.result.analysis.rows.force).toEqual({ failures: ["Panic"], requirements: [] });
    expect(compiled.result.code).toContain("return __vsResultFailure(__vsPanicValue(");

    const module = await execute(ANNOTATED, "panic-annotated-run");
    expect(module.main("ada")).toBe("Ada Lovelace");
    expect(module.main("zoe")).toBe("panic: no entry for zoe");
  });

  test("the materialized failure is a real Panic, so rethrowPanics can restore the unwind", async () => {
    const module = await execute(ANNOTATED, "panic-annotated-value");
    const failure = module.force("zoe");
    const carried = failure.match({ ok: () => undefined, error: (error: Error) => error });
    expect(isPanic(carried)).toBe(true);
  });
});

describe("the refusals this rule does not touch", () => {
  test("an ordinary recoverable Error exit still requires a Result contract", () => {
    // failures.mdx §Compiler Lifting: "A `.sm` function with a reachable
    // recoverable Error exit MUST return or infer a Result. An explicit
    // non-Result return annotation on such a function MUST be a compile error."
    expect(refusals(
      `export class Missing extends Error {}
export function guarded(ok: boolean): string {
  if (!ok) throw new Missing()
  return "real"
}`,
      "panic-control-throw",
    )).toEqual(["SMITHERS1101@2:1"]);
  });

  test("an accessor with an ordinary recoverable failure is still refused", () => {
    expect(refusals(
      `export class Missing extends Error {}
export class Box {
  get size(): number { throw new Missing() }
}`,
      "panic-control-getter",
    )).toEqual(["SMITHERS1101@3:3", "SMITHERS1105@3:3"]);
  });

  test("a generator with an ordinary recoverable failure is still refused", () => {
    expect(refusals(
      `export class Missing extends Error {}
export function* items(ok: boolean): Generator<string> {
  if (!ok) throw new Missing()
  yield "real"
}`,
      "panic-control-generator",
    )).toEqual(["SMITHERS1101@2:1", "SMITHERS1106@2:1"]);
  });

  test("an exported unannotated function with an ordinary failure still spells its contract", () => {
    expect(refusals(
      `export class Missing extends Error {}
export function guarded(ok: boolean) {
  if (!ok) throw new Missing()
  return "real"
}`,
      "panic-control-exported",
    )).toEqual(["SMITHERS1102@2:1"]);
  });

  test("a panic written where a value is expected is still a placement refusal", () => {
    expect(refusals(
      `${PANIC}
export function force(key: string): string {
  const value = key === "ada" ? key : panic(\`no entry for \${key}\`)
  return value
}`,
      "panic-control-placement",
    )).toEqual(["SMITHERS1503@4:39"]);
  });

  test("a top-level panic and a static block are still refused", () => {
    expect(refusals(`${PANIC}\npanic("no")\n`, "panic-control-top-level"))
      .toEqual(["SMITHERS1505@3:1"]);
    expect(refusals(
      `${PANIC}
export class Box {
  static { panic("no") }
}`,
      "panic-control-static-block",
    )).toEqual(["SMITHERS1107@4:3"]);
  });

  test("a fallible getter in an argument still cannot cross a callback boundary", () => {
    // R1FIX's `H5` recorded SMITHERS1105 as this shape's refusal. SMITHERS1105
    // stops firing for a PANICKING accessor under this rule, so the shape that
    // still carries a failure channel must keep a refusal of its own: it does,
    // and it is SMITHERS1303, which the Go backend has always been the only
    // refusal on (it implements no SMITHERS1105).
    expect(refusals(
      `export class Missing extends Error {}
function apply(handlers: { transform: unknown }): string {
  return String(handlers.transform)
}
export function main(): string {
  return apply({ get transform() { throw new Missing() } })
}`,
      "panic-control-h5",
    )).toEqual(["SMITHERS1105@6:18", "SMITHERS1303@6:18"]);
  });
});
