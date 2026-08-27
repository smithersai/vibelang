import { describe, expect, test } from "bun:test";
import { analyzeProject } from "./index.ts";

/**
 * The R row is the channel this language exists to keep, and it used to fail
 * OPEN through three independent mechanisms — each one producing a checked
 * `ok: true` program that reads a capability its declared row does not name:
 *
 * 1. `SMITHERS2106` — the receiver of `Capability.context()` did not have to
 *    identify one `Context` subclass. A union, a tuple element, a type
 *    parameter, an intersection, a class expression, or a laundering cast all
 *    recorded NOTHING, and a union of two structurally identical capabilities
 *    is subtype-reduced by TypeScript to its first constituent, so
 *    `(flag ? Db : Log).context()` recorded `["Db"]` and then panicked with
 *    `capability 'Log' was not provided` under a `Db`-only layer.
 * 2. `SMITHERS2102` at top level — a capability read written directly at module
 *    scope, or wrapped in a callback handed to a top-level higher-order call,
 *    was charged to nobody, while the indirect spelling (a top-level call to a
 *    function whose row names the capability) was already refused.
 * 3. `SMITHERS2107` — a DETACHED reference to the compiler-recognized
 *    `Context.context` member. `Reflect.apply(Db.context, Db, [])` checked
 *    `ok: true` with `requirements: []` and ran; the `.call`/`.apply`/`.bind`
 *    and aliased spellings were refused only INCIDENTALLY by the stock type
 *    check over the emitted module, not by any rule.
 *
 * `specification/requirements.mdx` §Context Access is the sentence all three
 * serve: "The receiver MUST identify a `Context` subclass strongly enough for
 * the compiler to record its nominal key."
 *
 * The negative half of this file is the load-bearing half. Refusing an unpinned
 * receiver is one edit away from refusing every legitimate one, so every
 * accepting receiver form below is asserted to keep BOTH its acceptance and its
 * exact row.
 */

const HEADER = `import { Context } from "smthrs/context"
abstract class Db extends Context { abstract find(id: number): string }
abstract class Log extends Context { abstract write(line: string): void }
abstract class Twin extends Context { abstract find(id: number): string }
abstract class Sub extends Db { }
`;

function analyze(body: string) {
  return analyzeProject([{ fileName: "main.sm", source: HEADER + body }], {
    rootDir: "/virtual/context-receiver",
  });
}

function codes(analysis: ReturnType<typeof analyzeProject>): readonly string[] {
  return analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code).sort();
}

function rowOf(analysis: ReturnType<typeof analyzeProject>, name: string): readonly string[] {
  return analysis.files["main.sm"]?.rows[name]?.requirements ?? [];
}

describe("SMITHERS2106 — the receiver of context() must pin one nominal key", () => {
  test("every receiver that can evaluate to a different capability is refused", () => {
    // `Twin` is structurally identical to `Db` on purpose: that is what makes
    // TypeScript reduce the union and hand the analysis a receiver type that
    // has forgotten the other arm.
    const spellings: readonly (readonly [string, string])[] = [
      ["ternary over two capabilities", "export function f(flag: boolean): void { void (flag ? Db : Log).context() }"],
      ["ternary over two same-shape capabilities", "export function f(flag: boolean): void { void (flag ? Db : Twin).context() }"],
      ["nested ternary", "export function f(a: boolean, b: boolean): void { void (a ? Db : b ? Log : Db).context() }"],
      ["const bound to a reduced ternary", "export function f(flag: boolean): void { const c = flag ? Db : Twin; void c.context() }"],
      ["?? over two capabilities", "export function f(c: typeof Log | undefined): void { void (c ?? Db).context() }"],
      ["|| over two capabilities", "export function f(c: typeof Log | undefined): void { void (c || Db).context() }"],
      ["a union parameter", "export function f(c: typeof Db | typeof Log): void { void c.context() }"],
      ["a union of a class and its subclass", "export function f(c: typeof Db | typeof Sub): void { void c.context() }"],
      ["a reassignable union binding", "export function f(flag: boolean): void { let c: typeof Db | typeof Log = Db; if (flag) c = Log; void c.context() }"],
      ["a tuple element under a union index", "const all = [Db, Log] as const\nexport function f(i: 0 | 1): void { void all[i].context() }"],
      ["an index-signature lookup", "const all: Record<string, typeof Db | typeof Log> = { db: Db }\nexport function f(k: string): void { void all[k].context() }"],
      ["a generic type parameter", "export function f<C extends typeof Db>(c: C): void { void c.context() }"],
      ["a generic type parameter with a default", "export function f<C extends typeof Db = typeof Db>(c: C): void { void c.context() }"],
      ["an intersection parameter", "export function f(c: typeof Db & typeof Log): void { void c.context() }"],
      ["an anonymous class expression", "export function f(): void { void (class extends Context { }).context() }"],
      [
        "a structural cast inside a generic helper",
        `export function get<C extends abstract new (...args: never[]) => Context>(c: C): InstanceType<C> {
  return (c as unknown as { context(): InstanceType<C> }).context()
}`,
      ],
    ];
    for (const [label, body] of spellings) {
      const analysis = analyze(body);
      expect({ [label]: codes(analysis) }).toEqual({ [label]: ["SMITHERS2106"] });
    }
  });

  test("every receiver that DOES pin one key keeps its acceptance and its exact row", () => {
    const spellings: readonly (readonly [string, string, string])[] = [
      ["direct", "export function f(): string { return Db.context().find(1) }", "Db"],
      ["local alias", "const A = Db\nexport function f(): string { return A.context().find(1) }", "Db"],
      ["element access with a literal key", 'export function f(): string { return Db["context"]().find(1) }', "Db"],
      ["element access with a template key", "export function f(): string { return Db[`context`]().find(1) }", "Db"],
      ["parenthesized", "export function f(): string { return (Db).context().find(1) }", "Db"],
      ["optional chain on the receiver", "export function f(): string { return Db?.context().find(1) }", "Db"],
      ["optional call", "export function f(): string | undefined { return Db.context?.().find(1) }", "Db"],
      ["assignment expression", "export function f(): string { let c: typeof Db; return (c = Db).context().find(1) }", "Db"],
      ["object property", "const registry = { db: Db }\nexport function f(): string { return registry.db.context().find(1) }", "Db"],
      ["tuple element under a literal index", "const all = [Db, Log] as const\nexport function f(): string { return all[0].context().find(1) }", "Db"],
      ["a typeof-Db parameter", "export function f(c: typeof Db): string { return c.context().find(1) }", "Db"],
      ["a function return typed typeof Db", "function pick(): typeof Db { return Db }\nexport function f(): string { return pick().context().find(1) }", "Db"],
      ["an awaited receiver", "async function pick(): Promise<typeof Db> { return Db }\nexport async function f(): Promise<string> { return (await pick()).context().find(1) }", "Db"],
      ["a subclass receiver", "export function f(): string { return Sub.context().find(1) }", "Sub"],
      ["both ternary arms naming the same class", "export function f(flag: boolean): string { return (flag ? Db : Db).context().find(1) }", "Db"],
      ["both ternary arms naming the same class through an alias", "const A = Db\nexport function f(flag: boolean): string { return (flag ? Db : A).context().find(1) }", "Db"],
      ["?? whose arms name the same class", "export function f(c: typeof Db | undefined): string { return (c ?? Db).context().find(1) }", "Db"],
      ["satisfies", "export function f(): string { return (Db satisfies typeof Db).context().find(1) }", "Db"],
      ["a cast asserting the class over an opaque value", "export function f(x: unknown): void { void (x as typeof Db).context() }", "Db"],
      ["polymorphic static this", "abstract class P extends Context { abstract v(): number\n  static get(): P { return this.context() } }\nexport function f(): number { return P.get().v() }", "P"],
    ];
    for (const [label, body, requirement] of spellings) {
      const analysis = analyze(body);
      expect({ [label]: codes(analysis) }).toEqual({ [label]: [] });
      const rows = analysis.files["main.sm"]!.rows;
      const target = rows.f ?? rows.get;
      expect({ [label]: target?.requirements }).toEqual({ [label]: [requirement] });
    }
  });

  test("a cast never hides the class the receiver really is", () => {
    // `as` changes the type and never the value, so both of these call `Db`'s
    // inherited static at run time. Measured before the fix: both checked
    // `ok: true` with `requirements: []` and both RAN, returning the provided
    // `Db` service.
    for (const body of [
      "export function f(): void { void (Db as any).context() }",
      "export function f(): void { void (Db as unknown as { context(): Db }).context() }",
      "export function f(): void { const x: any = Db; void x.context() }",
    ]) {
      const analysis = analyze(body);
      expect(codes(analysis)).toEqual([]);
      expect(rowOf(analysis, "f")).toEqual(["Db"]);
    }
  });

  test("an ordinary member named context is untouched", () => {
    // The rule keys on the receiver being a `Context` class, never on the
    // member name alone.
    const method = analyze(`class Holder { context(): number { return 1 } }
export function f(h: Holder): number { return h.context() }`);
    expect(codes(method)).toEqual([]);
    expect(rowOf(method, "f")).toEqual([]);

    const literal = analyze(`const holder = { context: (): number => 1 }
export function f(): number { return holder.context() }`);
    expect(codes(literal)).toEqual([]);
    expect(rowOf(literal, "f")).toEqual([]);

    const unionOfPlainClasses = analyze(`class A { context(): number { return 1 } }
class B { context(): number { return 2 } }
export function f(x: A | B): number { return x.context() }`);
    expect(codes(unionOfPlainClasses)).toEqual([]);
    expect(rowOf(unionOfPlainClasses, "f")).toEqual([]);
  });
});

describe("SMITHERS2102 — module evaluation has no row to carry a capability", () => {
  test("a capability read written directly at top level is refused", () => {
    // The INDIRECT spelling — a top-level call to a function whose row names
    // the capability — was already refused here; the direct one compiled clean
    // and panicked with `capability 'Db' was not provided`.
    const direct = analyze(`export const v = Db.context().find(1)`);
    expect(codes(direct)).toEqual(["SMITHERS2102"]);

    const indirect = analyze(`function use(): string { return Db.context().find(1) }
export const v = use()`);
    expect(codes(indirect)).toEqual(["SMITHERS2102"]);
  });

  test("a top-level callback that reads a capability is refused", () => {
    const viaCallback = analyze(`export const v = [1, 2].map((x) => Db.context().find(x))`);
    expect(codes(viaCallback)).toEqual(["SMITHERS2102"]);
  });

  test("an unpinned receiver at top level is still the receiver rule", () => {
    const ambiguous = analyze(`declare const flag: boolean
export const v = (flag ? Db : Log).context()`);
    expect(codes(ambiguous)).toEqual(["SMITHERS2106"]);
  });

  test("a top-level read inside a Layer.provide computation stays accepted", () => {
    const provided = analyze(`import { Layer } from "smthrs/provider"
function use(): string { return Db.context().find(1) }
export const v = Layer.provide(Layer.succeed(Db, { find: (id: number) => \`row \${id}\` }), () => use())`);
    expect(codes(provided)).toEqual([]);
  });

  test("an ordinary top-level higher-order call with no capability is accepted", () => {
    const plain = analyze(`export const v = [1, 2].map((x) => x * 2)`);
    expect(codes(plain)).toEqual([]);
  });
});

describe("SMITHERS2107 — Context.context is a call, not a value", () => {
  test("every detached spelling is refused by a rule, not by a typing accident", () => {
    const spellings: readonly (readonly [string, string])[] = [
      ["Reflect.apply", "export function f(): string { return (Reflect.apply(Db.context, Db, []) as Db).find(1) }"],
      [".call", "export function f(): string { return Db.context.call(Db).find(1) }"],
      [".apply", "export function f(): string { return Db.context.apply(Db).find(1) }"],
      [".bind", "export function f(): string { return Db.context.bind(Db)().find(1) }"],
      ["an alias binding", "export function f(): string { const m = Db.context; return m.call(Db).find(1) }"],
      ["a comma-detached callee", "export function f(): string { return (0, Db.context)().find(1) }"],
      ["object destructuring", "const { context } = Db\nexport function f(): string { return context.call(Db).find(1) }"],
      ["element-access detachment", "export function f(): string { const m = Db[\"context\"]; return m.call(Db).find(1) }"],
      ["handed to another function", "function run(fn: () => Db): Db { return fn() }\nexport function f(): string { return run(Db.context).find(1) }"],
      ["a template interpolation", "export function f(): string { return `${Db.context}` }"],
      ["a class field", "class X { readonly m = Db.context }\nexport function f(): string { return new X().m.call(Db).find(1) }"],
      // The reflective spelling of `Db["context"]`, with no member-access node
      // in the program at all: measured accepted with `requirements: []`, and
      // it RAN, returning the provided service.
      ["Reflect.get with a literal key", 'export function f(): string { const m = Reflect.get(Db, "context") as () => Db; return m.call(Db).find(1) }'],
    ];
    for (const [label, body] of spellings) {
      const analysis = analyze(body);
      expect({ [label]: codes(analysis).filter((code) => code.startsWith("SMITHERS")) })
        .toEqual({ [label]: ["SMITHERS2107"] });
    }
  });

  test("invoking it directly, and naming its type, both stay legal", () => {
    const invoked = analyze(`export function f(): string { return Db.context().find(1) }`);
    expect(codes(invoked)).toEqual([]);
    expect(rowOf(invoked, "f")).toEqual(["Db"]);

    const typePosition = analyze(`type Reader = typeof Db.context
export const marker: Reader | undefined = undefined
export function f(): string { return Db.context().find(1) }`);
    expect(codes(typePosition)).toEqual([]);
    expect(rowOf(typePosition, "f")).toEqual(["Db"]);

    // An ordinary member named `context` on a non-capability may still be
    // passed around as a value.
    const ordinary = analyze(`const holder = { context: (): number => 1 }
export function f(): number { const m = holder.context; return m() }`);
    expect(codes(ordinary)).toEqual([]);

    // ...including through the reflective read, whose target decides.
    const reflectivePlain = analyze(`const holder = { context: (): number => 1 }
export function f(): unknown { return Reflect.get(holder, "context") }`);
    expect(codes(reflectivePlain)).toEqual([]);
  });
});

describe("a static receiver keys on the constructor the call is made through", () => {
  test("super.context() records the containing class, not the superclass", () => {
    // `super.context()` in a static method invokes the inherited static with
    // `this` bound to the CONTAINING class, so `typeof Db` — the checker type
    // of `super` — is the one key the read can never have. Measured before the
    // fix: `requirements: ["Db"]`, `ok: true`, a `Db` layer satisfied the
    // declared row, and the program panicked with `capability 'S2' was not
    // provided`.
    const analysis = analyze(`abstract class S2 extends Db { static read(): string { return super.context().find(1) } }
export function f(): string { return S2.read() }`);
    expect(codes(analysis)).toEqual([]);
    expect(rowOf(analysis, "f")).toEqual(["S2"]);
    expect(rowOf(analysis, "read")).toEqual(["S2"]);
  });

  test("the layer check sees the key the runtime will look up", () => {
    const wrongLayer = analyze(`import { Layer } from "smthrs/provider"
abstract class S2 extends Db { static read(): string { return super.context().find(1) } }
function f(): string { return S2.read() }
export const v = Layer.provide(Layer.succeed(Db, { find: (id: number) => \`row \${id}\` }), () => f())`);
    expect(codes(wrongLayer)).toEqual(["SMITHERS2101"]);
  });
});

describe("a requirement crosses every callback boundary the other channels already model", () => {
  test("the enclosing function publishes the callback's capabilities", () => {
    const positions: readonly (readonly [string, string])[] = [
      ["a builtin higher-order call", "export function f(xs: readonly number[]): string[] { return xs.map((x) => Db.context().find(x)) }"],
      ["an authored higher-order call", "function invoke(fn: () => string): string { return fn() }\nexport function f(): string { return invoke(() => Db.context().find(1)) }"],
      ["a new-expression argument", "export function f(): Promise<string> { return new Promise<string>((res) => { res(Db.context().find(1)) }) }"],
      ["an object-literal property", "function run(handlers: { ok(): string }): string { return handlers.ok() }\nexport function f(): string { return run({ ok: () => Db.context().find(1) }) }"],
      ["a named local passed by reference", "const read = (): string => Db.context().find(1)\nfunction invoke(fn: () => string): string { return fn() }\nexport function f(): string { return invoke(read) }"],
    ];
    for (const [label, body] of positions) {
      const analysis = analyze(body);
      expect({ [label]: codes(analysis) }).toEqual({ [label]: [] });
      expect({ [label]: rowOf(analysis, "f") }).toEqual({ [label]: ["Db"] });
    }
  });

  test("the shapes that were already sound stay sound", () => {
    const iife = analyze("export function f(): string { return ((): string => Db.context().find(1))() }");
    expect(rowOf(iife, "f")).toEqual(["Db"]);

    const generator = analyze("export function* f(): Generator<string> { yield Db.context().find(1) }");
    expect(rowOf(generator, "f")).toEqual(["Db"]);

    // A callback with no capability inside charges nothing: the propagation
    // follows the callback's own row, not the mere presence of a callback.
    const plain = analyze("export function f(xs: readonly number[]): number[] { return xs.map((x) => x * 2) }");
    expect(codes(plain)).toEqual([]);
    expect(rowOf(plain, "f")).toEqual([]);
  });

  test("a Layer.provide computation is not charged the capabilities its layer provides", () => {
    // The provide site reconciles the computation's row against the layer's
    // provided closure; charging it a second time through the callback edge
    // would report exactly the capabilities the program satisfies.
    const provided = analyze(`import { Layer } from "smthrs/provider"
export function f(): string {
  return Layer.provide(Layer.succeed(Db, { find: (id: number) => \`row \${id}\` }), () => Db.context().find(1))
}`);
    expect(codes(provided)).toEqual([]);
    expect(rowOf(provided, "f")).toEqual([]);

    const nestedCallback = analyze(`import { Layer } from "smthrs/provider"
export function f(): string {
  return Layer.provide(Layer.succeed(Db, { find: (id: number) => \`row \${id}\` }), () => [1].map((x) => Db.context().find(x)).join(""))
}`);
    expect(codes(nestedCallback)).toEqual([]);
    expect(rowOf(nestedCallback, "f")).toEqual([]);
  });
});

describe("SMITHERS1601 — import.meta is an ambient host namespace", () => {
  test("every import.meta spelling is refused", () => {
    // ECMA-262 hands `import.meta`'s properties to the host
    // (`HostGetImportMetaProperties`), which is host authority by
    // `ALWAYS_FORBIDDEN_HOST_GLOBALS`'s own criterion. It is a meta-property
    // rather than an identifier, so the name-keyed rule never saw it:
    // `import.meta.url` compiled and RAN, printing the host filesystem path,
    // and `import.meta.dirname`/`import.meta.filename` compiled here while the
    // fork answered TS2339 — the very divergence the `__dirname`/`__filename`
    // entries in that list exist to close.
    const spellings: readonly (readonly [string, string])[] = [
      ["url", "export function f(): string { return import.meta.url }"],
      ["resolve", 'export function f(): string { return import.meta.resolve("smthrs/context") }'],
      ["dirname", "export function f(): string { return import.meta.dirname }"],
      ["filename", "export function f(): string { return import.meta.filename }"],
      ["a cast-laundered member", "export function f(): unknown { return (import.meta as { env?: unknown }).env }"],
      ["the whole namespace as a value", "export function f(): ImportMeta { return import.meta }"],
    ];
    for (const [label, body] of spellings) {
      const analysis = analyze(body);
      expect({ [label]: codes(analysis) }).toEqual({ [label]: ["SMITHERS1601"] });
    }
  });

  test("new.target is the language's own meta-property and stays available", () => {
    const analysis = analyze(`export class Thing {
  readonly kind: string
  constructor() { this.kind = new.target.name }
}
export function f(): string { return new Thing().kind }`);
    expect(codes(analysis)).toEqual([]);
  });

  test("an import.meta-free module is unaffected", () => {
    const analysis = analyze("export function f(a: number, b: number): number { return Math.max(a, b) }");
    expect(codes(analysis)).toEqual([]);
  });
});
