/**
 * Which SYNTAX counts as invoking a checked function, and which reference to a
 * function counts as naming one.
 *
 * `specification/requirements.mdx` §Inference (Locked): "Calling a function with
 * unsatisfied requirements MUST add those capabilities to the caller's `R` row.
 * ... Requirement inference MUST be transitive through ordinary calls."
 *
 * Four independent fail-opens shared one shape — a rule was taught ONE node
 * kind, ONE operator table, or ONE binding form, and every sibling spelling
 * walked straight through it:
 *
 *  1. The call graph was keyed on `ts.CallExpression` alone. A tagged template,
 *     a `new`, an implicit `super()`, and every implicit protocol invocation
 *     (`Symbol.iterator` through a spread / `for…of` / array destructuring,
 *     `toString`, `Symbol.toPrimitive`, `toJSON`, an authored thenable's `then`,
 *     an authored decorator, `Symbol.asyncIterator`) contributed no edge, no row
 *     and no diagnostic. ``return tag`x` `` published
 *     `tag: { requirements: ["Db"] }` beside `f: { requirements: [] }` — the
 *     callee's row computed correctly and then dropped at the call — and the
 *     program ran and panicked with `capability 'Db' was not provided`. The same
 *     blind spot silenced must-consume (SMITHERS1301), SMITHERS1303 and
 *     SMITHERS1404 on the tagged-template spelling. 14 broken spellings against
 *     7 sound, silent on BOTH backends.
 *
 *  2. `resolveFunctionReference` matched only direct symbol identity, so ONE
 *     alias hop defeated SMITHERS1303, SMITHERS1404, the callback requirement
 *     row and the `Result.try` boundary row. `hof(fallible)` was refused;
 *     `const alias = fallible; hof(alias)` compiled, ran to exit 0, and the host
 *     observed the lifted `Result` as its plain success value `{}` — the failure
 *     disappeared. Six more spellings did the same.
 *
 *  3. `collectLayerBindings` recorded `let` and `var`, and
 *     `resolveLayerExpression` trusts an initializer forever, so a reassigned
 *     layer certified a `Layer.provide` as complete and then panicked.
 *
 *  4. And the over-correction that came with the fix for (3)'s sibling rule:
 *     `(Db.context)()` was refused as a DETACHED reference. Parenthesising a
 *     member expression does not detach it — it is still the direct callee of a
 *     zero-argument call — so the row is recordable and must be recorded.
 *
 * The load-bearing half of this file is the NEGATIVE half. Every table below
 * lists the siblings that measured SOUND beside the ones that were broken, and
 * every new refusal is paired with the legitimate program it must still accept
 * at the row it must still record: an ordinary `` tag`x` `` with no capability
 * in it, an ordinary `new C()`, a `for…of` over a plain array, `a ?? b` over two
 * locals, a `const` layer, and every direct spelling of `Capability.context()`.
 */
import { describe, expect, test } from "bun:test";
import { analyzeProject } from "./index.ts";

const CAPABILITY = `import { Context } from "smthrs/context"

abstract class Db extends Context {
  abstract read(): string
}
`;

interface Measured {
  readonly codes: readonly string[];
  readonly rows: Record<string, { requirements: readonly string[]; failures: readonly string[] }>;
}

function measure(source: string): Measured {
  const analysis = analyzeProject([{ fileName: "main.sm", source }], { rootDir: "/virtual/invocation-forms" });
  const rows: Measured["rows"] = {};
  for (const file of Object.values(analysis.files)) {
    for (const [name, row] of Object.entries(file.rows)) rows[name] = row;
  }
  return {
    codes: analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.code).sort(),
    rows,
  };
}

/**
 * Every syntax that invokes a checked function, sound and broken alike.
 *
 * Each body defines a capability-reading callee and calls it through ONE
 * spelling from inside `f`, so the whole table is one assertion:
 * `f.requirements` is `["Db"]`. Add a row here before adding a node kind
 * anywhere: a row that already passes is evidence the model is total over the
 * grammar rather than a list somebody remembered to extend.
 */
const INVOCATION_FORMS: readonly { readonly id: string; readonly source: string }[] = [
  { id: "a plain call", source: `
function g(): string { return Db.context().read() }
export function f(): string { return g() }` },
  { id: "a method call", source: `
class O { m(): string { return Db.context().read() } }
const o = new O()
export function f(): string { return o.m() }` },
  { id: "a static method call", source: `
class Svc { static stat(): string { return Db.context().read() } }
export function f(): string { return Svc.stat() }` },
  { id: "a class getter read", source: `
class O { get p(): string { return Db.context().read() } }
const o = new O()
export function f(): string { return o.p }` },
  { id: "an object-literal getter read", source: `
const o = { get p(): string { return Db.context().read() } }
export function f(): string { return o.p }` },
  { id: "a builtin higher-order callback", source: `
export function f(): readonly number[] { const xs = [2, 1]; return xs.sort((a, b) => (Db.context().read() ? a - b : b - a)) }` },
  { id: "a class field initializer inside the function", source: `
export function f(): string { class C { v = Db.context().read() } return new C().v }` },
  { id: "a tagged template", source: `
function tag(parts: TemplateStringsArray): string { return parts.join("") + Db.context().read() }
export function f(): string { return tag\`x\` }` },
  { id: "a tagged template with a substitution", source: `
function tag(parts: TemplateStringsArray, v: string): string { return parts.join("") + v + Db.context().read() }
export function f(): string { return tag\`x\${"y"}\` }` },
  { id: "a constructor", source: `
class C { readonly v: string; constructor() { this.v = Db.context().read() } }
export function f(): string { return new C().v }` },
  { id: "an IMPLICIT super constructor", source: `
class Base { readonly v: string; constructor() { this.v = Db.context().read() } }
class Derived extends Base {}
export function f(): string { return new Derived().v }` },
  { id: "an explicit super() call", source: `
class Base { readonly v: string; constructor() { this.v = Db.context().read() } }
class Derived extends Base { constructor() { super() } }
export function f(): string { return new Derived().v }` },
  { id: "Symbol.iterator through a spread", source: `
class It { *[Symbol.iterator](): Generator<string> { yield Db.context().read() } }
const it = new It()
export function f(): readonly string[] { return [...it] }` },
  { id: "Symbol.iterator through for…of", source: `
class It { *[Symbol.iterator](): Generator<string> { yield Db.context().read() } }
const it = new It()
export function f(): string { let out = ""; for (const x of it) out += x; return out }` },
  { id: "Symbol.iterator through array destructuring", source: `
class It { *[Symbol.iterator](): Generator<string> { yield Db.context().read() } }
const it = new It()
export function f(): string { const [a] = it; return a as string }` },
  { id: "Symbol.iterator through yield*", source: `
class It { *[Symbol.iterator](): Generator<string> { yield Db.context().read() } }
const it = new It()
export function f(): Generator<string> { function* inner(): Generator<string> { yield* it } return inner() }` },
  { id: "toString through a template substitution", source: `
class T { toString(): string { return Db.context().read() } }
const t = new T()
export function f(): string { return \`v \${t}\` }` },
  { id: "Symbol.toPrimitive through a template substitution", source: `
class T { [Symbol.toPrimitive](hint: string): string { return Db.context().read() } }
const t = new T()
export function f(): string { return \`v \${t}\` }` },
  { id: "toString through String()", source: `
class T { toString(): string { return Db.context().read() } }
const t = new T()
export function f(): string { return String(t) }` },
  { id: "toString through string concatenation", source: `
class T { toString(): string { return Db.context().read() } }
const t = new T()
export function f(): string { return "v " + t }` },
  { id: "toJSON through JSON.stringify", source: `
class T { toJSON(): string { return Db.context().read() } }
const t = new T()
export function f(): string { return JSON.stringify(t) }` },
  { id: "then through await on an authored thenable", source: `
class P { then(resolve: (v: string) => void): void { resolve(Db.context().read()) } }
const p = new P()
export async function f(): Promise<string> { return await p }` },
  { id: "Symbol.asyncIterator through for await…of", source: `
class It { async *[Symbol.asyncIterator](): AsyncGenerator<string> { yield Db.context().read() } }
const it = new It()
export async function f(): Promise<string> { let out = ""; for await (const x of it) out += x; return out }` },
];

describe("every invocation form charges the row of what it invokes", () => {
  for (const form of INVOCATION_FORMS) {
    test(form.id, () => {
      const measured = measure(CAPABILITY + form.source);
      expect(measured.codes).toEqual([]);
      expect(measured.rows.f?.requirements).toEqual(["Db"]);
    });
  }
});

/**
 * The one implicit invocation that is not charged to a caller, because it does
 * not happen at any call: a decorator runs when the CLASS DEFINITION is
 * evaluated. Reading it at the `ts.Decorator` node put a method decorator inside
 * the decorated method's own scope, where nothing ever runs it, and the program
 * panicked at import time with an empty row everywhere.
 */
describe("a decorator is charged where the class definition is evaluated", () => {
  for (const form of [
    {
      id: "a method decorator", source: `
function deco(target: unknown, key: unknown): void { Db.context().read() }
class C { @deco m(): void {} }
export function f(): C { return new C() }`,
    },
    {
      id: "a class decorator", source: `
function deco(target: unknown): void { Db.context().read() }
@deco
class C { m(): void {} }
export function f(): C { return new C() }`,
    },
  ]) {
    test(`${form.id} at top level is refused, not charged to the method`, () => {
      const measured = measure(CAPABILITY + form.source);
      expect(measured.codes).toEqual(["SMITHERS2102"]);
      expect(measured.rows.f?.requirements).toEqual([]);
    });
  }

  test("inside a function it is charged to that function", () => {
    const measured = measure(CAPABILITY + `
function deco(target: unknown, key: unknown): void { Db.context().read() }
export function f(): unknown { class C { @deco m(): void {} } return new C() }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual(["Db"]);
  });
});

/**
 * The negative half of the table above. These programs use the very same syntax
 * over values that carry no capability, and a rule that refused them — or
 * charged them a row — would be useless.
 */
describe("the same syntax over ordinary values is untouched", () => {
  for (const form of [
    { id: "an ordinary tag`x` with no capability in it", source: `
function tag(parts: TemplateStringsArray): string { return parts.join("") }
export function f(): string { return tag\`x\` }` },
    { id: "an ordinary new C()", source: `
class C { readonly v = "v" }
export function f(): string { return new C().v }` },
    { id: "a new C() with a plain constructor", source: `
class C { readonly v: string; constructor(v: string) { this.v = v } }
export function f(): string { return new C("x").v }` },
    { id: "for…of over a plain array", source: `
export function f(): number { let n = 0; for (const x of [1, 2, 3]) n += x; return n }` },
    { id: "a spread of a plain array", source: `
export function f(): readonly number[] { return [...[1, 2, 3]] }` },
    { id: "array destructuring of a plain array", source: `
export function f(): number { const [a] = [1, 2]; return a as number }` },
    { id: "a template over a plain string", source: `
export function f(v: string): string { return \`a \${v} b\` }` },
    { id: "string concatenation of plain values", source: `
export function f(v: string): string { return "a" + v }` },
    { id: "String() of a plain value", source: `
export function f(v: number): string { return String(v) }` },
    { id: "JSON.stringify of a plain object", source: `
export function f(): string { return JSON.stringify({ a: 1 }) }` },
    { id: "await of a real Promise", source: `
export async function f(): Promise<number> { return await Promise.resolve(1) }` },
  ]) {
    test(form.id, () => {
      const measured = measure(form.source);
      expect(measured.codes).toEqual([]);
      expect(measured.rows.f?.requirements).toEqual([]);
    });
  }
});

/**
 * A tagged template is a call, so every rule that governs a call governs it.
 * These four were each measured silent on the template spelling while firing on
 * the identical `tag(parts, …)` spelling.
 */
describe("the rules that govern a call govern a tagged template", () => {
  const FALLIBLE = `
class Boom extends Error { constructor() { super("boom") } }
function inner(): string { if (Math.random() > 2) throw new Boom(); return "v" }
function tag(parts: TemplateStringsArray): string { return parts.join("") + inner() }
`;

  test("SMITHERS1301: a dropped Result from a tagged template is refused", () => {
    const dropped = measure(FALLIBLE + `export function f(): void { tag\`bad\` }`);
    const droppedCall = measure(FALLIBLE + `export function f(): void { tag(["bad"] as unknown as TemplateStringsArray) }`);
    expect(dropped.codes).toContain("SMITHERS1301");
    expect(dropped.codes).toEqual(droppedCall.codes);
  });

  test("SMITHERS1303: an inferred-fallible substitution needs a contract", () => {
    const source = `
class Boom extends Error { constructor() { super("boom") } }
const fallible = (): string => { throw new Boom() }
function tag(parts: TemplateStringsArray, cb: () => string): string { return parts.join("") + cb() }
export function f(): string { return tag\`x\${fallible}\` }`;
    expect(measure(source).codes).toContain("SMITHERS1303");
  });

  test("SMITHERS1404: an async substitution needs proven ownership", () => {
    const source = `
function tag(parts: TemplateStringsArray, cb: () => Promise<string>): string { void cb(); return parts.join("") }
export function f(): string { return tag\`x\${async () => "v"}\` }`;
    expect(measure(source).codes).toContain("SMITHERS1404");
  });

  test("but an ordinary tagged template over ordinary values stays clean", () => {
    const source = `
function tag(parts: TemplateStringsArray, cb: () => string): string { return parts.join("") + cb() }
export function f(): string { return tag\`x\${() => "v"}\` }`;
    expect(measure(source).codes).toEqual([]);
  });
});

/**
 * `resolveFunctionReference`: one alias hop used to defeat four rules at once.
 * `capability` below reads `Db` and is inferred-fallible, so a spelling that
 * resolves it charges `f` the `Db` row AND draws SMITHERS1303; a spelling that
 * does not is silent on both.
 */
const ALIAS_HEAD = CAPABILITY + `
class Boom extends Error { constructor() { super("boom") } }
function hof(callback: () => unknown): string { return String(callback()) }
const capability = (): string => { if (Db.context().read() === "") throw new Boom(); return "v" }
`;

describe("a function value is followed to the function it names", () => {
  for (const form of [
    { id: "a direct reference", body: `return hof(capability)` },
    { id: "a parenthesized reference", body: `return hof((capability))` },
    { id: "a cast reference", body: `return hof(capability as () => unknown)` },
    { id: "a const alias", body: `const alias = capability; return hof(alias)` },
    { id: "an object property", body: `const table = { capability }; return hof(table.capability)` },
    { id: "an array element", body: `const list = [capability]; return hof(list[0] as () => unknown)` },
    { id: "a ternary over one function", body: `return hof(true ? capability : capability)` },
    { id: ".bind()", body: `return hof(capability.bind(undefined))` },
    { id: "a destructured property", body: `const table = { capability }; const { capability: d } = table; return hof(d)` },
  ]) {
    test(form.id, () => {
      const measured = measure(`${ALIAS_HEAD}export function f(): string { ${form.body} }`);
      expect(measured.codes).toContain("SMITHERS1303");
      expect(measured.rows.f?.requirements).toEqual(["Db"]);
    });
  }

  test("a wrapper arrow charges the row without the contract, because no VALUE crosses", () => {
    const measured = measure(`${ALIAS_HEAD}export function f(): string { return hof(() => capability()) }`);
    expect(measured.codes).not.toContain("SMITHERS1303");
    expect(measured.rows.f?.requirements).toEqual(["Db"]);
  });

  test("a MUTABLE binding resolves to nothing rather than to its stale initializer", () => {
    // Two function values with the same shape have the same TYPE, so narrowing
    // cannot separate them and the binding keeps the type it was initialized
    // with. Reading it would charge `Log` — a capability the program never reads
    // — while dropping the `Db` it does. A wrong row is worse than no row; this
    // is the same reason `constantInitializer` reads only `const` and
    // SMITHERS1508 refuses a mutable foreign alias.
    const measured = measure(CAPABILITY + `
abstract class Log extends Context { abstract write(m: string): void }
function hof(callback: () => string): string { return callback() }
const usesLog = (): string => { Log.context().write("x"); return "l" }
const usesDb = (): string => Db.context().read()
export function f(): string { let cb = usesLog; cb = usesDb; return hof(cb) }`);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("an ordinary local function value is not made fallible by being aliased", () => {
    const measured = measure(`
function hof(callback: () => unknown): string { return String(callback()) }
const plain = (): string => "v"
export function f(): string { const alias = plain; return hof(alias) }`);
    expect(measured.codes).toEqual([]);
    expect(measured.rows.f?.requirements).toEqual([]);
  });

  test("the Result.try boundary row no longer depends on the spelling", () => {
    // `Result` is a prelude GLOBAL, not an importable module.
    const head = `${CAPABILITY}
function inner(): string { return Db.context().read() }
`;
    const direct = measure(`${head}export function f(): Result<string, Error> { return Result.try(inner) }`);
    const aliased = measure(`${head}export function f(): Result<string, Error> { const aliased = inner; return Result.try(aliased) }`);
    expect(direct.rows.f?.requirements).toEqual(["Db"]);
    expect(aliased.rows.f?.requirements).toEqual(direct.rows.f?.requirements);
  });
});

/**
 * A layer binding is only its initializer when it cannot be reassigned.
 * `resolveLayerExpression` trusts an initializer forever, so recording a `let`
 * let `Layer.provide` certify a closure it does not have.
 */
const LAYER_HEAD = `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"

abstract class Db extends Context { abstract read(): string }
abstract class Log extends Context { abstract write(m: string): void }

const db: Db = { read: () => "DB" }
const log: Log = { write: () => {} }

function needsDb(): string { return Db.context().read() }
`;

describe("only a const layer binding is resolved from its initializer", () => {
  for (const form of [
    { id: "a reassigned let", tail: `
let app: Layer<typeof Db> | Layer<typeof Log> = Layer.succeed(Db, db)
app = Layer.succeed(Log, log)
Layer.provide(app, () => needsDb())` },
    { id: "a reassigned var", tail: `
var app: Layer<typeof Db> | Layer<typeof Log> = Layer.succeed(Db, db)
app = Layer.succeed(Log, log)
Layer.provide(app, () => needsDb())` },
    { id: "a let reassigned inside a helper", tail: `
let app: Layer<typeof Db> | Layer<typeof Log> = Layer.succeed(Db, db)
function swap(): void { app = Layer.succeed(Log, log) }
swap()
Layer.provide(app, () => needsDb())` },
    { id: "a let that is never reassigned (fail-closed, not proven)", tail: `
let app = Layer.succeed(Db, db)
Layer.provide(app, () => needsDb())` },
  ]) {
    test(`${form.id} is refused as opaque`, () => {
      expect(measure(LAYER_HEAD + form.tail).codes).toEqual(["SMITHERS2104"]);
    });
  }

  test("a const layer still resolves completely and satisfies the row", () => {
    expect(measure(LAYER_HEAD + `
const app = Layer.succeed(Db, db)
Layer.provide(app, () => needsDb())`).codes).toEqual([]);
  });

  test("a const merge still resolves completely", () => {
    expect(measure(LAYER_HEAD + `
function needsBoth(): string { Log.context().write("x"); return Db.context().read() }
const app = Layer.merge(Layer.succeed(Db, db), Layer.succeed(Log, log))
Layer.provide(app, () => needsBoth())`).codes).toEqual([]);
  });

  test("a const layer that is MISSING a capability is still the precise SMITHERS2101, not the opaque one", () => {
    expect(measure(LAYER_HEAD + `
const app = Layer.succeed(Log, log)
Layer.provide(app, () => needsDb())`).codes).toEqual(["SMITHERS2101"]);
  });
});

/**
 * SMITHERS2107 is about a DETACHED reference, and parentheses do not detach.
 * `(Db.context)()` is the same member access, the same `this` binding and the
 * same emitted call as `Db.context()`; refusing it told the author to "invoke it
 * directly as Capability.context()" — advice the program was already following.
 */
describe("a parenthesized immediate callee is an invocation, not a detached reference", () => {
  for (const form of [
    { id: "Db.context()", body: `return Db.context().read()` },
    { id: "(Db.context)()", body: `return (Db.context)().read()` },
    { id: "((Db.context))()", body: `return ((Db.context))().read()` },
    { id: "(Db).context()", body: `return (Db).context().read()` },
    { id: "(Db as any).context()", body: `return (Db as any).context().read()` },
    { id: `Db["context"]()`, body: `return Db["context"]().read()` },
    { id: "Db.context?.()", body: `return Db.context?.().read()` },
  ]) {
    test(`${form.id} records Db and draws no diagnostic`, () => {
      const measured = measure(`${CAPABILITY}export function f(): string { ${form.body} }`);
      expect(measured.codes).toEqual([]);
      expect(measured.rows.f?.requirements).toEqual(["Db"]);
    });
  }

  for (const form of [
    { id: "handing it to another function", body: `
function take(fn: () => Db): Db { return fn() }
export function f(): string { return take(Db.context).read() }` },
    { id: "handing it over parenthesized", body: `
function take(fn: () => Db): Db { return fn() }
export function f(): string { return take((Db.context)).read() }` },
    { id: "binding it to a local", body: `
export function f(): string { const c = Db.context; return c().read() }` },
    { id: "calling it through .call", body: `
export function f(): string { return Db.context.call(Db).read() }` },
  ]) {
    test(`${form.id} is still SMITHERS2107`, () => {
      const measured = measure(CAPABILITY + form.body);
      expect(measured.codes).toContain("SMITHERS2107");
      expect(measured.rows.f?.requirements).toEqual([]);
    });
  }
});
