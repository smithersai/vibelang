/**
 * A Smithers callback crossing a foreign boundary: whose obligation is its
 * failure channel?
 *
 * The answer is read off three Locked sentences rather than chosen:
 *
 *  1. `specification/compatibility.mdx` §Foreign Boundary — "Calling an
 *     unannotated foreign runtime value MUST add the checked `panic` case,
 *     because JavaScript and TypeScript may throw, reject, or violate a
 *     declaration. Trusted `@throws {never}` metadata opts out; `@throws {T}`
 *     declares a more precise channel." The channel is a property of the CALL,
 *     so a trust claim covers everything that call does — including invoking an
 *     argument it was handed. `failures.mdx` §Foreign Exceptions says the same.
 *  2. `specification/requirements.mdx` §Scoping — "Imported JavaScript or
 *     TypeScript that starts hidden background work owns that work.
 *     Caller-controlled background APIs MUST expose explicit completion or
 *     disposal handles through their adapters." That assigns the DEFERRED half
 *     of a registration to the imported module, and puts the lifetime
 *     obligation on the adapter rather than on `.sm`.
 *  3. `specification/failures.mdx` §Panic Does Not Widen a Return Type — a
 *     function "MUST therefore be able to abort with `panic(...)` while keeping
 *     a plain return type." Panic-freedom is therefore not spellable and not
 *     checkable, so "the callback must independently be panic-free" is not an
 *     available rule: it would admit nothing.
 *
 * The load-bearing half of this file is the NEGATIVE half. This is a trust
 * boundary, so every accepting case is paired with the refusal that proves the
 * claim was needed: an untrusted host still refuses the identical callback, a
 * FOREIGN callable handed on through a trusted call is still refused by
 * SMITHERS1508, the callback's own inferred Result channel is still SMITHERS1303,
 * started async work is still SMITHERS1404, and a host global inside the
 * callback body is still SMITHERS1602.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileAndCheckProject } from "./index.ts";

const workspace = mkdtempSync(join(tmpdir(), "smithers-foreign-callback-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");

/** The sanctioned host binding: ordinary TypeScript carrying the trust claim. */
writeFileSync(join(workspace, "trusted.ts"), `/**
 * @module
 * @throws {never}
 */

const registered: (() => void)[] = [];

/** @throws {never} */
export function onSignal(name: string, listener: () => void): void {
  registered.push(listener);
  listener();
}

/** @throws {never} */
export function scheduleTimer(millis: number, listener: () => void): number {
  listener();
  return millis;
}

/** @throws {never} */
export function onEach(values: readonly string[], listener: (value: string) => void): void {
  for (const value of values) listener(value);
}

/** @throws {never} */
export function register(handlers: { data(value: string): void; end(): void }): void {
  handlers.data("x");
  handlers.end();
}

/** @throws {never} */
export function registerAll(listeners: readonly (() => void)[]): void {
  for (const listener of listeners) listener();
}

/** @throws {never} */
export function awaitable(listener: () => Promise<void>): void {
  void listener();
}

/** A foreign callable handed BACK to Smithers. @throws {never} */
export function getHandler(): () => void {
  return () => {};
}

/** An ordinary foreign function VALUE, minted in this module. */
export function tick(): void {}
`);

/** The same surface with no trust claim anywhere. */
writeFileSync(join(workspace, "untrusted.ts"), `/**
 * @module
 * No throws metadata: every call keeps the default checked panic case.
 */
export function onSignalUnsafe(name: string, listener: () => void): void {
  listener();
}
export function registerUnsafe(handlers: { data(value: string): void }): void {
  handlers.data("x");
}
export function registerAllUnsafe(listeners: readonly (() => void)[]): void {
  for (const listener of listeners) listener();
}
`);

/** A module-level claim with NO per-function claim: not a call-site opt-out. */
writeFileSync(join(workspace, "moduleonly.ts"), `/**
 * @module
 * @throws {never}
 */
export function onSignalModuleOnly(name: string, listener: () => void): void {
  listener();
}
`);

/** `@throws {Never}` — the wrong casing is not the trust claim. */
writeFileSync(join(workspace, "casing.ts"), `/**
 * @module
 * @throws {never}
 */

/** @throws {Never} */
export function onSignalNever(name: string, listener: () => void): void {
  listener();
}
`);

interface Compiled {
  readonly codes: readonly string[];
  readonly emitted: number;
  readonly rows: Readonly<Record<string, { failures: readonly string[]; requirements: readonly string[] }>>;
  readonly code: string;
}

let sequence = 0;
function compile(source: string): Compiled {
  sequence += 1;
  const fileName = join(workspace, `case-${sequence}.sm`);
  const checked = compileAndCheckProject([{ fileName, source }], {
    rootDir: workspace,
    outDir: join(workspace, "out"),
    runtimeImport: RUNTIME,
  });
  const errors = checked.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const file = Object.values(checked.result.files)[0];
  return {
    codes: errors.map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`),
    emitted: checked.emitDiagnostics.length,
    rows: (file?.analysis.rows ?? {}) as Compiled["rows"],
    code: file?.code ?? "",
  };
}

/** Every shape that can put a Smithers function value into a call argument. */
const ACCEPTED_FORMS: readonly { readonly id: string; readonly source: string }[] = [
  {
    id: "an inline arrow",
    source: `import { onSignal } from "./trusted.ts"
export function f(sink: string[]): void {
  onSignal("SIGINT", () => { sink.push("int") })
}
`,
  },
  {
    id: "a function expression",
    source: `import { onSignal } from "./trusted.ts"
export function f(sink: string[]): void {
  onSignal("SIGINT", function () { sink.push("int") })
}
`,
  },
  {
    id: "a named function reference",
    source: `import { onSignal } from "./trusted.ts"
function handler(): void { }
export function f(): void {
  onSignal("SIGINT", handler)
}
`,
  },
  {
    id: "a method reference",
    source: `import { onSignal } from "./trusted.ts"
class Handlers { run(): void { } }
export function f(h: Handlers): void {
  onSignal("SIGINT", h.run)
}
`,
  },
  {
    id: "a bound function",
    source: `import { onSignal } from "./trusted.ts"
class Handlers { run(): void { } }
export function f(h: Handlers): void {
  onSignal("SIGINT", h.run.bind(h))
}
`,
  },
  {
    id: "a callback stored in a const and then passed",
    source: `import { onSignal } from "./trusted.ts"
export function f(sink: string[]): void {
  const handler = () => { sink.push("int") }
  onSignal("SIGINT", handler)
}
`,
  },
  {
    id: "a callback that calls a fallible .sm function and consumes its Result",
    source: `class Bad extends Error {}
import { onSignal } from "./trusted.ts"
function fallible(n: number): Result<number, Bad> {
  if (n < 0) throw new Bad("neg")
  return n
}
export function f(sink: string[]): void {
  onSignal("SIGINT", () => {
    sink.push(\`\${fallible(1).match({ ok: (v) => v, error: () => 0 })}\`)
  })
}
`,
  },
  {
    id: "a callback with a spelled Result contract",
    source: `class Bad extends Error {}
import { onEach } from "./trusted.ts"
export function f(values: readonly string[]): void {
  onEach(values, (value): Result<number, Bad> => {
    if (value === "") throw new Bad("empty")
    return value.length
  })
}
`,
  },
  {
    id: "a callback that panics",
    source: `import { panic } from "smithers:exceptions"
import { onSignal } from "./trusted.ts"
export function f(): void {
  onSignal("SIGINT", () => { panic("boom") })
}
`,
  },
  {
    id: "callbacks in an object-literal argument",
    source: `import { register } from "./trusted.ts"
export function f(sink: string[]): void {
  register({ data: (value: string) => { sink.push(value) }, end: () => { sink.push("end") } })
}
`,
  },
  {
    id: "shorthand methods in an object-literal argument",
    source: `import { register } from "./trusted.ts"
export function f(sink: string[]): void {
  register({ data(value: string) { sink.push(value) }, end() { sink.push("end") } })
}
`,
  },
  {
    id: "shorthand property names in an object-literal argument",
    source: `import { register } from "./trusted.ts"
export function f(sink: string[]): void {
  const data = (value: string): void => { sink.push(value) }
  const end = (): void => { sink.push("end") }
  register({ data, end })
}
`,
  },
  {
    id: "callbacks in an array-literal argument",
    source: `import { registerAll } from "./trusted.ts"
export function f(sink: string[]): void {
  registerAll([() => { sink.push("a") }, () => { sink.push("b") }])
}
`,
  },
  {
    id: "a callback behind an as-assertion",
    source: `import { onSignal } from "./trusted.ts"
export function f(sink: string[]): void {
  onSignal("SIGINT", (() => { sink.push("int") }) as (() => void))
}
`,
  },
  {
    id: "a callback behind a satisfies-expression",
    source: `import { onSignal } from "./trusted.ts"
export function f(sink: string[]): void {
  onSignal("SIGINT", (() => { sink.push("int") }) satisfies (() => void))
}
`,
  },
  {
    id: "a registration handing back a primitive handle",
    source: `import { scheduleTimer } from "./trusted.ts"
export function f(sink: string[]): number {
  return scheduleTimer(10, () => { sink.push("tick") })
}
`,
  },
];

describe("a trusted host binding may be handed a Smithers callback", () => {
  test("every shape that carries a function value is accepted, with an EMPTY failure row", () => {
    const accepted: Record<string, string> = {};
    const rows: Record<string, unknown> = {};
    const expectedAccepted: Record<string, string> = {};
    const expectedRows: Record<string, unknown> = {};
    for (const form of ACCEPTED_FORMS) {
      const compiled = compile(form.source);
      accepted[form.id] = compiled.codes.join(" ") || "ACCEPT";
      expectedAccepted[form.id] = "ACCEPT";
      // The row is the point. Before the trust marker was honoured in the
      // argument position, SMITHERS1509 charged `f` a Panic the marker had just
      // removed, which is what then cascaded into SMITHERS1101.
      rows[form.id] = compiled.rows.f;
      expectedRows[form.id] = { failures: [], requirements: [] };
      expect(compiled.emitted).toBe(0);
    }
    expect(accepted).toEqual(expectedAccepted);
    expect(rows).toEqual(expectedRows);
  });

  test("a registration really runs, and no Result wrapper was introduced", async () => {
    const source = `import { onSignal, scheduleTimer } from "./trusted.ts"

export function install(sink: string[]): number {
  onSignal("SIGINT", () => { sink.push("int") })
  return scheduleTimer(7, () => { sink.push("tick") })
}
`;
    sequence += 1;
    const fileName = join(workspace, `executed-${sequence}.sm`);
    const checked = compileAndCheckProject([{ fileName, source }], {
      rootDir: workspace,
      outDir: join(workspace, "executed-out"),
      runtimeImport: pathToFileURL(RUNTIME).href,
    });
    expect(checked.result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(checked.emitDiagnostics).toEqual([]);

    const file = Object.values(checked.result.files)[0]!;
    // Nothing needed lowering: no Result wrapper, no panic catch, no runtime
    // import at all. `install` keeps its plain `number` contract end to end.
    expect(file.code).not.toContain("__vsResult");
    expect(file.code).not.toContain("__vsPanic");
    expect(file.code).not.toContain("Result.try");
    expect(file.code).not.toContain("smthrs");
    expect(file.code).toContain(`onSignal("SIGINT",`);
    expect(file.code).toContain("return scheduleTimer(7,");

    const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(file.code);
    const modulePath = join(workspace, `executed-${sequence}.mjs`);
    writeFileSync(modulePath, javascript.replace(`"../trusted.ts"`, `"./trusted.ts"`));
    const module = await import(pathToFileURL(modulePath).href) as {
      install(sink: string[]): number;
    };
    const sink: string[] = [];
    // A plain `number` comes back, not a Result: the binding's claim removed the
    // panic case and nothing re-added it.
    expect(module.install(sink)).toBe(7);
    expect(sink).toEqual(["int", "tick"]);
  });
});

describe("the trust claim is exactly as wide as the sentence that grants it", () => {
  test("an UNTRUSTED host still refuses every one of the same shapes", () => {
    const forms: readonly { readonly id: string; readonly source: string; readonly at: string }[] = [
      {
        id: "an inline arrow",
        at: "SMITHERS1509@3:28",
        source: `import { onSignalUnsafe } from "./untrusted.ts"
export function f(sink: string[]): void {
  onSignalUnsafe("SIGINT", () => { sink.push("int") })
}
`,
      },
      {
        id: "a named function reference",
        at: "SMITHERS1509@4:28",
        source: `import { onSignalUnsafe } from "./untrusted.ts"
function handler(): void { }
export function f(): void {
  onSignalUnsafe("SIGINT", handler)
}
`,
      },
      {
        id: "callbacks in an object literal",
        at: "SMITHERS1509@3:18",
        source: `import { registerUnsafe } from "./untrusted.ts"
export function f(sink: string[]): void {
  registerUnsafe({ data: (value: string) => { sink.push(value) } })
}
`,
      },
      {
        id: "callbacks in an array literal",
        at: "SMITHERS1509@3:21",
        source: `import { registerAllUnsafe } from "./untrusted.ts"
export function f(sink: string[]): void {
  registerAllUnsafe([() => { sink.push("a") }])
}
`,
      },
    ];
    const refused: Record<string, boolean> = {};
    const positions: Record<string, string | undefined> = {};
    const expectedRefused: Record<string, boolean> = {};
    const expectedPositions: Record<string, string> = {};
    for (const form of forms) {
      const compiled = compile(form.source);
      refused[form.id] = compiled.codes.length > 0;
      positions[form.id] = compiled.codes.find((code) => code.startsWith("SMITHERS1509"));
      expectedRefused[form.id] = true;
      expectedPositions[form.id] = form.at;
    }
    expect(positions).toEqual(expectedPositions);
    expect(refused).toEqual(expectedRefused);
  });

  test("a module-level claim is not a call-site opt-out, and the casing is exact", () => {
    // `@module @throws {never}` answers SMITHERS1510 — may this edge be imported
    // at all — and never doubles as a per-call trust claim.
    expect(compile(`import { onSignalModuleOnly } from "./moduleonly.ts"
export function f(sink: string[]): void {
  onSignalModuleOnly("SIGINT", () => { sink.push("int") })
}
`).codes).toContain("SMITHERS1509@3:32");

    // `@throws {Never}` is not `@throws {never}`; the annotation is unreifiable,
    // the policy stays the default panic policy, and the callback stays refused.
    const cased = compile(`import { onSignalNever } from "./casing.ts"
export function f(sink: string[]): void {
  onSignalNever("SIGINT", () => { sink.push("int") })
}
`);
    expect(cased.codes).toContain("SMITHERS1502@3:3");
    expect(cased.codes).toContain("SMITHERS1509@3:27");
  });

  test("a FOREIGN callable handed on through a trusted call is still refused, by SMITHERS1508", () => {
    // This is the fail-open the narrow fix would have opened. SMITHERS1509 used
    // to claim every callable argument at a foreign call and so covered this
    // case too; now that a trusted call no longer claims the position, the
    // neighbouring provenance rule takes it back. A `@throws {never}` claim is
    // about THIS callee — it cannot speak for the panic behaviour of a callable
    // minted in another module.
    const forms: readonly { readonly id: string; readonly source: string; readonly at: string }[] = [
      {
        id: "a foreign callable returned, stored, then passed",
        at: "SMITHERS1508@4:22",
        source: `import { onSignal, getHandler } from "./trusted.ts"
export function f(): void {
  const handler = getHandler()
  onSignal("SIGINT", handler)
}
`,
      },
      {
        id: "a foreign callable passed directly",
        at: "SMITHERS1508@3:22",
        source: `import { onSignal, getHandler } from "./trusted.ts"
export function f(): void {
  onSignal("SIGINT", getHandler())
}
`,
      },
      {
        id: "an imported foreign function value",
        at: "SMITHERS1508@3:22",
        source: `import { onSignal, tick } from "./trusted.ts"
export function f(): void {
  onSignal("SIGINT", tick)
}
`,
      },
      {
        id: "a foreign callable inside an object-literal argument",
        at: "SMITHERS1508@4:12",
        source: `import { register, getHandler } from "./trusted.ts"
export function f(): void {
  const handler = getHandler()
  register({ data: (value: string) => { }, end: handler })
}
`,
      },
    ];
    const observed: Record<string, string> = {};
    const expected: Record<string, string> = {};
    for (const form of forms) {
      const compiled = compile(form.source);
      observed[form.id] = compiled.codes.join(" ");
      // The escape is charged as a real panic boundary, so the enclosing plain
      // `void` contract is refused too.
      expected[form.id] = `SMITHERS1101@2:1 ${form.at}`;
    }
    expect(observed).toEqual(expected);
  });

  test("the module-initialization trust marker is matched with the exact case, like the call-site one", () => {
    // SETTLED. This test previously recorded the opposite: `semantic.ts` matched
    // the module claim with `/@throws\s*\{\s*never\s*\}/i` and the fork's
    // `exactThrowsNeverMarker` lowercased the whole comment, so `@throws {Never}`
    // opened a module edge that only `@throws {never}` should open, while the
    // per-CALL policy compared exactly. One spelling was a trust claim in one
    // rule and a declared channel in the other.
    //
    // The specification settles which of the two is wrong.
    // `specification/failures.mdx` §Foreign Exceptions (Locked): "`@throws
    // {never}` removes the default panic case; `@throws {T}` declares the stated
    // foreign error channel." Those are two productions of one syntax and the
    // ONLY thing separating them is the spelling inside the braces. `T` is a
    // TypeScript type name, and TypeScript type identity is case-sensitive, so
    // `Never` is the second production — a declared channel whose Error
    // constructor must resolve — and never the first. Matching case-insensitively
    // merges the productions and converts a channel the compiler could not reify
    // into the trusted opt-out, which is the fail-open direction. The call
    // boundary was right; the module boundary was the defect.
    //
    // The stake is higher at the module boundary than at the call: this marker
    // suppresses SMITHERS1510, whose job is to stop an unchecked foreign module
    // initializer from running before any checked call boundary exists.
    //
    // Every near-miss below is REFUSED with SMITHERS1510 at the import
    // specifier — a different outcome from being silently ignored, which is what
    // a rule that merely stopped granting trust without reporting would do.
    const miscased: readonly (readonly [string, string])[] = [
      ["never-capitalized", "/**\n * @module\n * @throws {Never}\n */"],
      ["never-upper", "/**\n * @module\n * @throws {NEVER}\n */"],
      ["never-mixed", "/**\n * @module\n * @throws {nEvEr}\n */"],
      ["module-upper", "/**\n * @MODULE\n * @throws {never}\n */"],
      ["module-title", "/**\n * @Module\n * @throws {never}\n */"],
      ["throws-upper", "/**\n * @module\n * @THROWS {never}\n */"],
      ["throws-title", "/**\n * @module\n * @Throws {never}\n */"],
      ["all-upper", "/** @MODULE @THROWS {NEVER} */"],
      ["one-line-never-capitalized", "/** @module @throws {Never} */"],
    ];
    for (const [name, header] of miscased) {
      writeFileSync(join(workspace, `miscased-${name}.ts`), `${header}\nexport const value: number = 1;\n`);
      expect([name, compile(`import { value } from "./miscased-${name}.ts"
export function f(): string { return typeof value }
`).codes]).toEqual([name, ["SMITHERS1510@1:23"]]);
    }

    // The over-correction guard. Six over-corrections have shipped in this
    // repository while closing marker rules, and the available one here is a
    // comparison that stops accepting the genuine header too. Both documented
    // shapes must keep conferring module trust, and brace padding is still the
    // marker rather than a near miss.
    const genuine: readonly (readonly [string, string])[] = [
      ["one-line", "/** @module @throws {never} */"],
      ["decorated", "/**\n * A real header.\n *\n * @module\n * @throws {never}\n */"],
      ["padded", "/** @module @throws { never } */"],
    ];
    for (const [name, header] of genuine) {
      writeFileSync(join(workspace, `genuine-${name}.ts`), `${header}\nexport const value: number = 1;\n`);
      expect([name, compile(`import { value } from "./genuine-${name}.ts"
export function f(): string { return typeof value }
`).codes]).toEqual([name, []]);
    }

    // The call-site marker in the same file is exact, and stays exact.
    expect(compile(`import { onSignalNever } from "./casing.ts"
export function f(sink: string[]): void {
  onSignalNever("SIGINT", () => { sink.push("int") })
}
`).codes).toContain("SMITHERS1509@3:27");

    // And the module claim still never doubles as the FIRST declaration's own
    // function-level claim: `module-init-only`'s rule, re-read through the now
    // case-sensitive `@module` guard.
    writeFileSync(join(workspace, "module-init-guard.ts"), `/** @module @throws {never} */
export function danger(): string {
  throw new Error("the module initializer is trusted; this function is not");
}
`);
    expect(compile(`import { danger } from "./module-init-guard.ts"
export function f(): string { return danger() }
`).codes.length).toBeGreaterThan(0);
  });
});

describe("the neighbouring obligations are untouched, and they are the callback's own", () => {
  test("an inferred-fallible callback still needs a spelled contract (SMITHERS1303)", () => {
    // The trust claim speaks for the CALL. The callback's own Result channel is
    // its own contract, checked where the callback is written — which is what
    // SMITHERS1303 has always owned, and it never consults the boundary's trust.
    const compiled = compile(`class Bad extends Error {}
import { onEach } from "./trusted.ts"
function fallible(n: number): Result<number, Bad> {
  if (n < 0) throw new Bad("neg")
  return n
}
export function f(values: readonly string[]): void {
  onEach(values, (value) => { const n = fallible(value.length)!; return n })
}
`);
    expect(compiled.codes).toEqual(["SMITHERS1303@8:18"]);
  });

  test("an async callback still has no proven owner (SMITHERS1404)", () => {
    // A rule about STARTED work, not about a lost failure channel. A trusted
    // registration does not tell the compiler who awaits the Promise the
    // callback returns, so requirements.mdx §Scoping still applies.
    expect(compile(`import { awaitable } from "./trusted.ts"
export function f(sink: string[]): void {
  awaitable(async () => { sink.push("tick") })
}
`).codes).toEqual(["SMITHERS1404@3:13"]);
  });

  test("a host global inside the callback body is still refused (SMITHERS1602)", () => {
    // Ambient authority stays impossible for ordinary `.sm`. Being the argument
    // of a trusted binding buys the body nothing, because the host-global rule
    // never consults the enclosing call.
    expect(compile(`import { onSignal } from "./trusted.ts"
export function f(sink: string[]): void {
  onSignal("SIGINT", () => { sink.push(\`\${Date.now()}\`) })
}
`).codes).toEqual(["SMITHERS1602@3:43"]);
  });

  test("an untrusted call inside the callback body still charges its panic channel", () => {
    // The panic channel is still charged where it is real: the inner call is
    // untrusted, so its Result must be consumed and its own callback is refused.
    const compiled = compile(`import { onSignal } from "./trusted.ts"
import { onSignalUnsafe } from "./untrusted.ts"
export function f(): void {
  onSignal("SIGINT", () => { onSignalUnsafe("x", () => {}) })
}
`);
    expect(compiled.codes).toEqual([
      "SMITHERS1510@2:32",
      "SMITHERS1303@4:22",
      "SMITHERS1301@4:30",
      "SMITHERS1509@4:50",
    ]);
  });
});

describe("what this lane did NOT close, pinned so a later fix reads as deliberate", () => {
  test("an inline callback's capability requirements are charged to the enclosing function", () => {
    // Formerly pinned OPEN here: requirement propagation followed a resolved
    // callee's row, an accessor, a `Result.try` boundary body, or a
    // `Layer.provide` body — never an arbitrary callback argument, so both
    // spellings below published `requirements: []` while reading `Clock`
    // through the ambient scope at run time. The boundary was already modelled
    // for the other two channels (SMITHERS1303 for a fallible callback,
    // SMITHERS1404 for an async one); `SemanticFunction.callbackValues` now
    // wires the R row to the same value edge.
    const local = compile(`import { Context } from "smthrs/context"
export abstract class Clock extends Context { abstract now(): number }
function take(callback: () => void): void { callback() }
export function f(sink: string[]): void {
  take(() => { sink.push(\`\${Clock.context().now()}\`) })
}
`);
    expect(local.codes).toEqual([]);
    expect(local.rows.f).toEqual({ failures: [], requirements: ["Clock"] });

    const foreign = compile(`import { Context } from "smthrs/context"
import { onSignal } from "./trusted.ts"
export abstract class Clock extends Context { abstract now(): number }
export function f(sink: string[]): void {
  onSignal("SIGINT", () => { sink.push(\`\${Clock.context().now()}\`) })
}
`);
    expect(foreign.codes).toEqual([]);
    expect(foreign.rows.f).toEqual({ failures: [], requirements: ["Clock"] });

    // The control that shows the row machinery works when the callee is
    // resolvable: a direct capability use IS charged.
    const direct = compile(`import { Context } from "smthrs/context"
export abstract class Clock extends Context { abstract now(): number }
export function f(sink: string[]): void {
  sink.push(\`\${Clock.context().now()}\`)
}
`);
    expect(direct.rows.f).toEqual({ failures: [], requirements: ["Clock"] });

    // A callback with no capability inside still publishes an empty row: the
    // propagation follows the callback's OWN row, it does not mark every
    // higher-order call as capability-using.
    const plain = compile(`function take(callback: () => void): void { callback() }
export function f(sink: string[]): void {
  take(() => { sink.push("plain") })
}
`);
    expect(plain.codes).toEqual([]);
    expect(plain.rows.f).toEqual({ failures: [], requirements: [] });
  });

  test("a spelled Result contract narrowed to a void callback parameter drops its E", () => {
    // Also NOT introduced here, and also already open for an ordinary LOCAL
    // higher-order call: TypeScript makes `() => Result<A, E>` assignable to
    // `() => void`, so the consumer discards the Result and the `E` is charged
    // to nobody. The *inferred*-fallible spelling of the same program is still
    // refused by SMITHERS1303 in both places, which is the half that keeps a
    // silently-lowered callback from lying about its shape.
    const local = compile(`class Bad extends Error {}
function take(callback: (value: string) => void): void { callback("x") }
export function f(): void {
  take((value): Result<number, Bad> => { if (value === "") throw new Bad("e"); return value.length })
}
`);
    expect(local.codes).toEqual([]);
    expect(local.rows.f).toEqual({ failures: [], requirements: [] });

    const foreign = compile(`class Bad extends Error {}
import { onEach } from "./trusted.ts"
export function f(values: readonly string[]): void {
  onEach(values, (value): Result<number, Bad> => { if (value === "") throw new Bad("e"); return value.length })
}
`);
    expect(foreign.codes).toEqual([]);
    expect(foreign.rows.f).toEqual({ failures: [], requirements: [] });

    // The half that is NOT open: an inferred contract still cannot cross.
    expect(compile(`class Bad extends Error {}
function take(callback: (value: string) => void): void { callback("x") }
export function f(): void {
  take((value) => { if (value === "") throw new Bad("e"); return value.length })
}
`).codes).toEqual(["SMITHERS1303@4:8"]);
  });

  test("a trusted binding returning an OBJECT handle is still SMITHERS1508", () => {
    // SEAM's residual Seam 1 wall, unchanged and unrelated to the callback rule:
    // the registration's callbacks are accepted and only the returned object is
    // refused. The primitive-handle spelling is the working alternative today.
    const object = compile(`import { getHandler } from "./trusted.ts"
export function f(): () => void {
  return getHandler()
}
`);
    expect(object.codes).toEqual(["SMITHERS1101@2:1", "SMITHERS1508@3:10"]);
  });
});
