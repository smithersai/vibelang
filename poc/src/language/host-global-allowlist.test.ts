/**
 * The host-global prohibition is an ALLOWLIST over the ECMAScript-262 global
 * object, and this file is the gate on both of its directions.
 *
 * It used to be eight forbidden spellings — `process`, `window`, `document`,
 * `console`, `fetch`, `setTimeout`, `setInterval`, `globalThis` — matched by
 * name against a `Set`. Everything else the ambient environment publishes was
 * accepted, which measured 22 of 38 sibling globals broken and *executing*:
 *
 *  - `self`, `top`, `parent`, and `frames` alias `globalThis`/`window` in every
 *    DOM and worker host, so they were a total bypass of all eight refused
 *    names at once — `self.fetch(...)` compiled clean.
 *  - `XMLHttpRequest`, `WebSocket`, `EventSource`, and `Worker` are the network
 *    and thread authority that `specification/compatibility.mdx` names in the
 *    same sentence as `process`. `WebSocket` is a live global on Node 22.
 *  - `navigator`, `location`, `localStorage`, and `sessionStorage` are host
 *    identity and host-persistent state; `navigator.userAgent` read with zero
 *    diagnostics, no capability, and no layer.
 *  - `Buffer`, `require`, `module`, `exports`, `__dirname`, `__filename`, and
 *    `setImmediate` are the Node global scope. Four of them are worse than
 *    unportable: the compiler emits ESM, where they do not exist at all, so
 *    they were a guaranteed `ReferenceError` inside a function whose row read
 *    `failures: []`.
 *
 * A denylist over a namespace the host may extend at any time cannot be
 * completed, so it was never a prohibition — it was a spelling table. The rule
 * is now the other way round: the ambient environment is refused unless
 * ECMA-262 publishes the name, or unless it is one of the host-sensitive
 * objects judged per operation.
 *
 * **The load-bearing half of this file is the accepting half.** An allowlist
 * that is too narrow breaks the entire standard library, which is at least
 * loud; one that is too wide is silent. Both are pinned below: every refusal
 * class has a positive control, and the ECMAScript global object is enumerated
 * and required to still compile.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileAndCheckProject } from "./index.ts";

const workspace = mkdtempSync(join(tmpdir(), "smithers-host-global-allowlist-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");

function check(source: string) {
  return compileAndCheckProject([{ fileName: join(workspace, "case.sm"), source }], {
    rootDir: workspace,
    outDir: join(workspace, "out"),
    runtimeImport: RUNTIME,
  });
}

/** Language diagnostics over the authored `.sm`, as `CODE@line:column`. */
function diagnose(source: string): string[] {
  return check(source).result.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`);
}

/**
 * The requirement row `main` publishes, which is what "CHARGE" means.
 *
 * This reader exists because `diagnose` could not see rows three and five at
 * all. Those rows are discharged by a ROW and not by a refusal — the capability
 * has no source-language surface, so there is no remedy a diagnostic could name
 * — and every assertion in this file was written against diagnostics. MEASURED:
 * with row five implemented and only `diagnose` watching, the thirty-member
 * uniformity test below still passed, because charging `Locale` emits no
 * diagnostic. A test that cannot observe the thing it is guarding is not
 * guarding it.
 */
function requires(source: string): readonly string[] {
  const files = check(source).result.files;
  const only = Object.values(files)[0];
  return only?.analysis.rows.main?.requirements ?? [];
}

/**
 * One expression read from a function body. Every root identifier lands at
 * line 2, column 10, so a refusal's position is the same string for every case
 * and a wrong position cannot hide behind a permissive matcher.
 */
function reads(expression: string): string {
  return `export function main(): unknown {\n  return ${expression}\n}\n`;
}

const AT_ROOT = "@2:10";

describe("host globals outside the ECMAScript global object are refused", () => {
  /**
   * One entry per authority the specification names, plus the aliasing routes
   * that reach it. These are NOT the compiler's own tables restated: they are
   * spellings an author would write, and each one compiled clean before the
   * rule was inverted.
   */
  const refused: readonly (readonly [string, string, string])[] = [
    // Aliases of the global object. Refusing `globalThis` while accepting
    // these refused nothing at all.
    ["self", "self", "SMITHERS1601"],
    ["top", "top", "SMITHERS1601"],
    ["parent", "parent", "SMITHERS1601"],
    ["frames", "frames", "SMITHERS1601"],
    // Network and threads: "filesystem, and network MUST NOT be unconditional
    // globals", and `fetch` was the only one of them the old rule knew.
    ["XMLHttpRequest", "XMLHttpRequest", "SMITHERS1601"],
    ["WebSocket", "WebSocket", "SMITHERS1601"],
    ["EventSource", "EventSource", "SMITHERS1601"],
    ["Worker", "Worker", "SMITHERS1601"],
    // Host identity and host-persistent state.
    ["navigator", "navigator", "SMITHERS1601"],
    ["location", "location", "SMITHERS1601"],
    ["localStorage", "localStorage", "SMITHERS1601"],
    ["sessionStorage", "sessionStorage", "SMITHERS1601"],
    // The Node global scope and the CommonJS module wrapper.
    ["Buffer", "Buffer", "SMITHERS1601"],
    ["global", "global", "SMITHERS1601"],
    ["require", "require", "SMITHERS1601"],
    ["module", "module", "SMITHERS1601"],
    ["exports", "exports", "SMITHERS1601"],
    ["__dirname", "__dirname", "SMITHERS1601"],
    ["__filename", "__filename", "SMITHERS1601"],
    ["setImmediate", "setImmediate", "SMITHERS1601"],
    // The same scheduling authority `setTimeout`/`setInterval` were refused for.
    ["queueMicrotask", "queueMicrotask", "SMITHERS1601"],
    ["clearTimeout", "clearTimeout", "SMITHERS1601"],
    ["clearInterval", "clearInterval", "SMITHERS1601"],
    // `structuredClone` can detach an `ArrayBuffer` through `{ transfer: [...] }`,
    // which falsifies `platform/host.ts`'s `fillRandomBytes` `@throws {never}`
    // claim: `getRandomValues` throws on a detached view.
    ["structuredClone", "structuredClone", "SMITHERS1601"],
    // Universally present, and still host APIs rather than language ones.
    ["URL", "URL", "SMITHERS1601"],
    ["TextEncoder", "TextEncoder", "SMITHERS1601"],
    ["AbortController", "AbortController", "SMITHERS1601"],
    // The eight the old rule already refused, so the inversion did not drop them.
    ["process", "process", "SMITHERS1601"],
    ["window", "window", "SMITHERS1601"],
    ["document", "document", "SMITHERS1601"],
    ["console", "console", "SMITHERS1601"],
    ["fetch", "fetch", "SMITHERS1601"],
    ["setTimeout", "setTimeout", "SMITHERS1601"],
    ["setInterval", "setInterval", "SMITHERS1601"],
    ["globalThis", "globalThis", "SMITHERS1601"],
  ];

  test("every one of them is refused, at the identifier that named it", () => {
    const observed = refused.map(([name, expression]) => [name, diagnose(reads(expression))]);
    const expected = refused.map(([name, , code]) => [name, [`${code}${AT_ROOT}`]]);
    expect(observed).toEqual(expected);
  });

  test("a local binding of the same name is an ordinary value, under every spelling", () => {
    // Identity, not spelling. This is the direction an over-broad rule breaks.
    expect(diagnose("export function main(): unknown {\n  const self = { id: 1 }\n  return self\n}\n")).toEqual([]);
    expect(diagnose("export function main(): unknown {\n  const navigator = \"n\"\n  return navigator\n}\n")).toEqual([]);
    expect(diagnose("export class Storage {\n  readonly id: number = 1\n}\nexport function main(): unknown {\n  return new Storage()\n}\n")).toEqual([]);
  });

  test("a name the program declares nowhere is a TypeScript error, not a host global", () => {
    // The rule reaches only names the ambient environment actually publishes,
    // plus the canonical host globals by name. An unresolved identifier is an
    // ordinary typo, and answering it with "ambient host global 'lenght' is
    // unavailable" would be a worse diagnostic AND would preempt the honest
    // one: a SMITHERS error stops the pipeline before the TypeScript check.
    const checked = check(reads("missingHelper"));
    expect(diagnose(reads("missingHelper"))).toEqual([]);
    expect(checked.emitDiagnostics.map((diagnostic) => `TS${diagnostic.code}`)).toEqual(["TS2304"]);
    expect(checked.ok).toBe(false);
  });
});

describe("the ECMAScript global object stays available", () => {
  /**
   * ECMA-262 clause 19, enumerated. This is the "too narrow" gate: if the
   * allowlist loses a name, the whole `.sm` standard library loses it too.
   */
  const universal: readonly string[] = [
    "Infinity", "NaN", "undefined",
    // `eval` and `Function` were HERE until 2026-08-27, asserting that reading
    // them draws no diagnostic at all. That assertion is what the defect below
    // was standing behind: the *name* being available was never in dispute, but
    // this test could not tell the name apart from the ESCAPE, and both
    // backends let `eval("process.platform")` return `darwin` from a function
    // whose row read `failures: [] requirements: []`. They now live in
    // "dynamic code evaluation is refused per operation" below, which pins both
    // directions separately.
    "isFinite", "isNaN", "parseFloat", "parseInt",
    "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
    "AggregateError", "Array", "ArrayBuffer", "BigInt", "BigInt64Array", "BigUint64Array",
    "Boolean", "DataView", "Error", "EvalError",
    "Float32Array", "Float64Array",
    "Int8Array", "Int16Array", "Int32Array", "Map", "Number", "Object",
    "Promise", "Proxy", "RangeError", "ReferenceError", "RegExp", "Set",
    "String", "Symbol", "SyntaxError", "TypeError",
    "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array", "URIError",
    // `WeakRef`, `FinalizationRegistry`, `SharedArrayBuffer`, and `Atomics`
    // were HERE until 2026-08-28, asserting that reading them draws no
    // diagnostic at all. That assertion was this file pinning the contradiction
    // of `specification/compatibility.mdx` §Determinism-Sensitive Members rows
    // one and two, which say all four "MUST NOT be unconditional globals". They
    // now live in "determinism-hostile globals are refused by name" below,
    // which pins both directions separately — the four refusals, and the
    // `WeakMap`/`WeakSet`/`ArrayBuffer`/typed-array siblings that stay.
    "WeakMap", "WeakSet",
    "JSON", "Reflect",
    "escape", "unescape",
  ];

  test("every name in it compiles with no diagnostic at all", () => {
    const observed = universal.map((name) => [name, diagnose(reads(name))]);
    expect(observed).toEqual(universal.map((name) => [name, []]));
  });

  test("and the operations an author actually writes still run through the checker", () => {
    expect(diagnose(`export function main(): string[] {
  const values = new Map<string, number>([["ada", 1]])
  const unique = new Set<number>([1, 1, 2])
  const bytes = new Uint8Array([1, 2, 3])
  return [
    \`\${Object.keys({ a: 1 }).length}\`,
    \`\${Array.of(1, 2).length}\`,
    \`\${values.get("ada")}\`,
    \`\${unique.size}\`,
    \`\${bytes.length}\`,
    \`\${Number.parseFloat("1.5")}\`,
    \`\${Reflect.has({ a: 1 }, "a")}\`,
    \`\${parseInt("41", 10)}\`,
    \`\${JSON.stringify({ n: 1 })}\`,
    \`\${Math.max(2, 7, 5)}\`,
  ]
}
`)).toEqual([]);
  });

  test("the compiler's own prelude names are language surface, not host globals", () => {
    // `Result` and `Panic` are published by a compiler-owned declaration file.
    // Classifying "declared in a .d.ts" as "the host publishes it" would have
    // refused every Result-returning module in the standard library.
    expect(diagnose(`import { Panic } from "smithers:exceptions"

function parse(text: string): Result<number, Panic> {
  return Result.try(() => Number.parseInt(text, 10))
}

export function main(): string[] {
  return [parse("41").match({ ok: (value) => \`\${value}\`, error: () => "panic" })]
}
`)).toEqual([]);
  });
});

describe("dynamic code evaluation is refused per operation, not by erasing the name", () => {
  /**
   * `eval` and `Function` are in ECMA-262 clause 19 and were therefore in the
   * allowlist. `UNIVERSAL_GLOBALS`'s own note on `globalThis` says why that is
   * wrong — "it is the one language global whose whole purpose is to hand back
   * the host's namespace, so admitting it would readmit every name this set
   * excludes" — and the sentence is true of these two verbatim. Measured before
   * this rule existed, on BOTH backends, each with `failures: []
   * requirements: []` and zero diagnostics, each RUNNING:
   * `eval("process.platform")` -> `darwin`, `eval("Date.now()")` -> a wall-clock
   * instant (where the direct spelling is SMITHERS1602),
   * `eval("Math.random()")` -> randomness (SMITHERS1603 directly),
   * `new Function("return process.platform")()` -> `darwin`, and
   * `eval("globalThis.process.platform")` -> `darwin`, which is the by-name
   * `globalThis` refusal defeated by one sibling spelling.
   *
   * specification/compatibility.mdx §Dynamic Features ("`any` and `eval` remain
   * usable ... the language does not forbid them") and §Host Globals (two
   * MUSTs) both bear on this. The rule below honours the second at the
   * EVALUATION and leaves the NAME alone, which is the shape `crypto` already
   * has. Where exactly the first sentence lands for `eval("1 + 1")` is a
   * specification decision recorded in SEM7-report.md, not settled here.
   */
  test("every spelling that reaches the host through eval or Function is refused", () => {
    const escapes: readonly (readonly [string, string, string])[] = [
      ["direct", `eval("process.platform")`, `SMITHERS1604${AT_ROOT}`],
      ["wall clock", `eval("Date.now()")`, `SMITHERS1604${AT_ROOT}`],
      ["randomness", `eval("Math.random()")`, `SMITHERS1604${AT_ROOT}`],
      ["globalThis by another name", `eval("globalThis.process.platform")`, `SMITHERS1604${AT_ROOT}`],
      ["indirect eval", `(0, eval)("process.platform")`, "SMITHERS1604@2:14"],
      ["new Function", `new Function("return process.platform")()`, "SMITHERS1604@2:14"],
      ["Function called", `(Function as any)("return process.platform")()`, "SMITHERS1604@2:11"],
      ["Function.prototype.constructor", `Function.prototype.constructor`, `SMITHERS1604${AT_ROOT}`],
      ["Reflect.construct", `Reflect.construct(Function, ["return 1"])`, "SMITHERS1604@2:28"],
      ["Reflect.apply", `Reflect.apply(Function, undefined, ["return 1"])`, "SMITHERS1604@2:24"],
      // No name to key on: `(function () {}).constructor` IS the Function
      // constructor, and `new F("return process.platform")()` measured `darwin`.
      ["a callable's own constructor", `(function () {}).constructor`, "SMITHERS1604@2:27"],
      ["an arrow's own constructor", `(() => 1).constructor`, "SMITHERS1604@2:20"],
    ];
    const observed = escapes.map(([name, expression]) => [name, diagnose(reads(expression))]);
    expect(observed).toEqual(escapes.map(([name, , code]) => [name, [code]]));
  });

  test("the names are not erased: a type annotation and a prototype test stay legal", () => {
    // This is the direction the "eval remains usable" sentence protects, and
    // the direction an over-broad by-name refusal breaks.
    expect(diagnose("export function main(cb: Function): boolean {\n  return typeof cb === \"function\"\n}\n")).toEqual([]);
    expect(diagnose("export function main(): boolean {\n  const f = (): number => 1\n  return f instanceof Function\n}\n")).toEqual([]);
    // `constructor instanceof Function` is the exact spelling
    // 20-host-globals/the-date-constructor-in-a-value-position-is-still-charged
    // carries; it must keep charging SMITHERS1602 and nothing else.
    expect(diagnose("export function main(): string[] {\n  const constructor: object = Date as unknown as object\n  return [`${constructor instanceof Function}`]\n}\n"))
      .toEqual(["SMITHERS1602@2:31"]);
  });

  /**
   * FAIL CLOSED ON `any`, and this is a separate test from the narrowness one
   * below because the two pull in opposite directions.
   *
   * `compatibility.mdx` §Dynamic Features: "`any` remains usable, but a
   * receiver typed `any` in a position where the analysis must decide
   * callability MUST be treated as callable — matching the fail-closed default
   * already applied to a dynamically selected member." MEASURED before this
   * landed: `(JSON as any).constructor` compiled with zero diagnostics and an
   * empty row, while the same selection on a resolved callable was
   * `SMITHERS1604`. An `any` has neither call nor construct signatures, so the
   * callability test answered "not callable" for the one receiver type about
   * which nothing is known.
   *
   * This is the hole the migration plan lists under R8 beside `WeakRef.deref()`
   * and `Promise.race`: an `eval` reached through `any` produces no journal
   * entry, therefore no divergence to detect.
   */
  test("a receiver typed `any` is treated as callable", () => {
    expect(diagnose("export function main(v: any): string {\n  return typeof v.constructor\n}\n"))
      .toEqual(["SMITHERS1604@2:19"]);
    expect(diagnose("export function main(): string {\n  return typeof (JSON as any).constructor\n}\n"))
      .toEqual(["SMITHERS1604@2:31"]);
  });

  /**
   * `unknown` is deliberately NOT treated as callable, and needs no arm of its
   * own: it is the type you must narrow before using, so stock TypeScript
   * refuses the selection first and there is nothing for this rule to decide.
   */
  test("a receiver typed `unknown` is refused by TypeScript, not by this rule", () => {
    const source = "export function main(v: unknown): string {\n  return typeof v.constructor\n}\n";
    // No LANGUAGE diagnostic: this rule declines to answer, which is the claim.
    expect(diagnose(source)).toEqual([]);
    // And the program is still refused — by stock TypeScript, whose diagnostics
    // reach `emitDiagnostics` rather than the language list `diagnose` reads.
    // Asserting only the empty list above would have said "accepted".
    const checked = check(source);
    expect(checked.ok).toBe(false);
    expect(checked.emitDiagnostics.length).toBeGreaterThan(0);
  });

  test("an ordinary value's `constructor` is not the Function constructor", () => {
    // The receiver test is what keeps the second arm narrow. None of these
    // compiles a string, and a rule keyed on the member NAME would refuse all
    // of them. Each has a RESOLVED non-callable type, which is what
    // distinguishes them from the `any` above.
    expect(diagnose("export function main(): string {\n  return typeof ({ a: 1 }).constructor\n}\n")).toEqual([]);
    expect(diagnose("export function main(): string {\n  return typeof [1].constructor\n}\n")).toEqual([]);
    expect(diagnose("export function main(): string {\n  return typeof \"x\".constructor\n}\n")).toEqual([]);
    expect(diagnose("export function main(): string {\n  return typeof new Map<string, number>().constructor\n}\n")).toEqual([]);
    expect(diagnose("export class Box {\n  readonly v: number = 1\n}\nexport function main(): string {\n  return typeof new Box().constructor\n}\n")).toEqual([]);
  });

  test("a local binding named Function is an ordinary value", () => {
    // Identity, not spelling — the same direction the host-global rule is
    // pinned in above. (`eval` has no local-binding spelling: strict mode
    // refuses it as a declaration name.)
    expect(diagnose("export function main(): number {\n  const Function = { call: (): number => 1 }\n  return Function.call()\n}\n")).toEqual([]);
  });
});

describe("determinism-hostile globals are refused by name, with no capability offered", () => {
  /**
   * `specification/compatibility.mdx` §Determinism-Sensitive Members, rows one
   * and two: `WeakRef`/`FinalizationRegistry` and `SharedArrayBuffer`/`Atomics`
   * "MUST NOT be unconditional globals". ECMA-262 publishes all four, so
   * `UNIVERSAL_GLOBALS` admitted them and the two obligations were contradicted
   * rather than merely unmet — measured 2026-08-28, `new WeakRef(o).deref()` and
   * `new SharedArrayBuffer(8)` each compiled with zero diagnostics and an empty
   * requirement row, in the same file where the `Date.now()` control correctly
   * reported SMITHERS1602.
   *
   * They get their OWN code rather than joining SMITHERS1601 because 1601's
   * message ends "access it through a Context capability" and the specification
   * rows say the opposite in as many words: "no capability can mediate it and no
   * journal entry can describe it". Answering a `WeakRef` with a remedy that
   * cannot exist is the "refusal wearing a costume" the `crypto` note in
   * `semantic.ts` rejects by name. SMITHERS1604 is the precedent — dynamic code
   * evaluation is refused per operation, with its own reason, for the same
   * "there is no capability that could provide this" argument.
   */
  const hostile: readonly (readonly [string, string])[] = [
    ["WeakRef", "new WeakRef({ a: 1 }).deref()"],
    ["FinalizationRegistry", "new FinalizationRegistry(() => {})"],
    ["SharedArrayBuffer", "new SharedArrayBuffer(8)"],
    ["Atomics", "Atomics.load(new Int32Array(8), 0)"],
  ];

  test("each of the four is refused as SMITHERS1605 at its own root identifier", () => {
    const observed = hostile.map(([name, expression]) => [name, diagnose(reads(expression))]);
    expect(observed).toEqual([
      ["WeakRef", ["SMITHERS1605@2:14"]],
      ["FinalizationRegistry", ["SMITHERS1605@2:14"]],
      ["SharedArrayBuffer", ["SMITHERS1605@2:14"]],
      ["Atomics", [`SMITHERS1605${AT_ROOT}`]],
    ]);
  });

  test("the refusal names the reason and offers no capability remedy", () => {
    const messages = check(reads("new WeakRef({ a: 1 }).deref()")).result.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.message);
    expect(messages).toEqual([
      "ambient host global 'WeakRef' is unavailable; its result is a function of garbage-collection timing or another agent's schedule, which no capability can mediate and no journal entry can describe",
    ]);
    // The half that would be silently wrong: a capability remedy here would be
    // unsatisfiable, so the message must not offer one.
    expect(messages[0]).not.toContain("Context capability");
    expect(messages[0]).not.toContain(".context()");
  });

  /**
   * The positive control this refusal class needs. The rule is about the four
   * determinism-hostile names, NOT about weak collections or binary data in
   * general: `WeakMap`/`WeakSet` cannot observe collection (they have no
   * `deref`, and iteration is not exposed), and a non-shared `ArrayBuffer` is
   * owned by one agent. Losing these would break the standard library, and an
   * over-broad by-name refusal is exactly how that happens.
   */
  test("the siblings that are NOT determinism-hostile stay available", () => {
    for (const expression of [
      "new WeakMap<object, number>().set({}, 1)",
      "new WeakSet<object>().add({})",
      "new ArrayBuffer(8).byteLength",
      "new Int32Array(8).length",
      "new DataView(new ArrayBuffer(8)).byteLength",
    ]) {
      expect([expression, diagnose(reads(expression))]).toEqual([expression, []]);
    }
  });

  test("the names are not erased: a type annotation and a local binding stay legal", () => {
    // Same direction the `eval`/`Function` rule is pinned in above. These are
    // by-NAME refusals of a value read, so a type position and a lexical shadow
    // must both survive, or the rule has been widened to "any mention".
    expect(diagnose("export function main(r: WeakRef<object>): boolean {\n  return r !== undefined\n}\n")).toEqual([]);
    expect(diagnose("export function main(): number {\n  const Atomics = { load: (): number => 1 }\n  return Atomics.load()\n}\n")).toEqual([]);
  });
});

describe("host-sensitive operations are judged per operation, not per object", () => {
  test("the clock, the monotonic clock, and randomness still need their capability", () => {
    expect(diagnose(reads("Date.now()"))).toEqual([`SMITHERS1602${AT_ROOT}`]);
    expect(diagnose(reads("new Date()"))).toEqual(["SMITHERS1602@2:14"]);
    expect(diagnose(reads("performance.now()"))).toEqual([`SMITHERS1602${AT_ROOT}`]);
    expect(diagnose(reads("Math.random()"))).toEqual([`SMITHERS1603${AT_ROOT}`]);
  });

  test("a spread argument to `new Date` does not prove an instant was supplied", () => {
    // The exemption is about the RUNTIME arity. `new Date(...[])` is one
    // syntactic argument and zero actual ones, so it reads the clock — measured
    // clean, and executing, on both backends before this.
    expect(diagnose(`export function main(): number {
  const instant: readonly number[] = []
  return new Date(...(instant as [number])).getTime()
}
`)).toEqual(["SMITHERS1602@3:14"]);
  });

  test("an authored instant still constructs without a capability", () => {
    expect(diagnose(reads("new Date(1700000000000).getTime()"))).toEqual([]);
    expect(diagnose(reads("Date.parse(\"2020-01-01\")"))).toEqual([]);
    expect(diagnose(reads("Date.UTC(2020, 0, 1)"))).toEqual([]);
  });

  test("Intl.DateTimeFormat formats *now* when it is called with no instant", () => {
    // `new Intl.DateTimeFormat("en").format()` formats the current time, and
    // `Intl` was not a root the rule modelled at all. Charging the CONSTRUCTOR
    // fails closed: which call reads the clock depends on the arity of a call
    // on an instance, and `resolvedOptions().timeZone` reads the host zone with
    // no call at all.
    expect(diagnose(reads("new Intl.DateTimeFormat(\"en-US\").format()"))).toEqual(["SMITHERS1602@2:14"]);
    expect(diagnose(reads("Intl"))).toEqual([`SMITHERS1602${AT_ROOT}`]);
  });

  test("the rest of Intl is not refused, and charges Locale instead", () => {
    // Row five's verb is CHARGE, not refuse. `compatibility.mdx`
    // §Determinism-Sensitive Members: the ambient spelling is additionally
    // refused only "where the capability has a source-language surface the
    // author can write instead", and `Locale` is a capability class that exists
    // nowhere in this tree — a refusal would name `Locale.context()`, which
    // cannot be written. So both halves are asserted: no diagnostic, and a row.
    for (const expression of [
      "Intl.getCanonicalLocales(\"EN-us\")",
      "new Intl.NumberFormat(\"en-US\").format(1)",
      "new Intl.Collator(\"en-US\").compare(\"a\", \"b\")",
    ]) {
      expect([expression, diagnose(reads(expression))]).toEqual([expression, []]);
      expect([expression, requires(reads(expression))]).toEqual([expression, ["Locale"]]);
    }
  });

  /**
   * The whole ICU-backed class answers the SAME way, and this is the assertion
   * that says so rather than thirty that each say "no diagnostic".
   *
   * `specification/compatibility.mdx` §Determinism-Sensitive Members row five
   * used to name four members — `Intl.NumberFormat`, `Intl.Collator`,
   * `String.prototype.localeCompare`, `Number.prototype.toLocaleString` — and
   * the hazard it describes covers thirty. The list was incomplete, not narrow:
   * every member below is a function of the host ICU version and locale data
   * for the identical reason, and nothing distinguished the four. The class was
   * re-derived on 2026-08-28 by sweeping the ambient lib for `Intl` value
   * members, `toLocale*`, `localeCompare`, and `normalize`, and measuring each
   * spelling; an earlier estimate of fifteen was fifteen short.
   *
   * **Row five has now landed, and this test is what it landed against.** The
   * uniformity framing was written for exactly this moment: "when these do
   * charge `Locale` they must all charge it, and this test then names exactly
   * which members diverged." So the assertion moved from `[]` to `["Locale"]`
   * and stayed one answer for the whole class.
   *
   * It also moved from `diagnose` to `requires`, and that change is the whole
   * reason the test kept its teeth. Row five's verb is CHARGE, which emits no
   * diagnostic — MEASURED: with the rule implemented and only `diagnose`
   * watching, this test still passed on all thirty members while asserting
   * `[]`, because it was reading a channel the rule does not write to.
   *
   * Both directions are still guarded. Over-refusal is the failure mode the
   * cheapest wrong implementation produces — charging the `Intl` ROOT passes
   * every `DateTimeFormat` assertion above perfectly and silently takes the
   * entire ICU surface with it — so the diagnostics are asserted empty as well
   * as the row asserted uniform.
   */
  test("every ICU-backed member of row five answers identically", () => {
    const icu: readonly string[] = [
      // `Intl` namespace value members, minus `DateTimeFormat`, which is row
      // four's clock hazard rather than row five's locale one.
      "Intl.getCanonicalLocales(\"EN-us\")",
      "Intl.supportedValuesOf(\"calendar\")",
      "new Intl.NumberFormat(\"en-US\").format(1)",
      "new Intl.Collator(\"en\").compare(\"a\", \"b\")",
      "new Intl.PluralRules(\"en\").select(1)",
      "new Intl.ListFormat(\"en\").format([\"a\", \"b\"])",
      "new Intl.RelativeTimeFormat(\"en\").format(1, \"day\")",
      "new Intl.Segmenter(\"en\").resolvedOptions().locale",
      "new Intl.DisplayNames([\"en\"], { type: \"region\" }).of(\"US\")",
      "new Intl.Locale(\"en-US\").baseName",
      // Locale-sensitive prototype members. These are instance reads with no
      // root identifier for the walk to key on, which is WHY they are free and
      // why row five needs the type-directed analysis row four is blocked on.
      "\"a\".localeCompare(\"b\")",
      "\"a\".toLocaleUpperCase(\"en\")",
      "\"A\".toLocaleLowerCase(\"en\")",
      "\"a\\u0301\".normalize(\"NFC\")",
      "(1).toLocaleString(\"en-US\")",
      "(1n).toLocaleString(\"en-US\")",
      "[1, 2].toLocaleString()",
      "({ a: 1 }).toLocaleString()",
      // `toLocaleString` on each of the twelve typed arrays. Enumerated rather
      // than sampled: a rule keyed on one array kind closes one and none of the
      // others, the same way the `eval` rule needed all twenty spellings.
      "new Int8Array(2).toLocaleString()",
      "new Uint8Array(2).toLocaleString()",
      "new Uint8ClampedArray(2).toLocaleString()",
      "new Int16Array(2).toLocaleString()",
      "new Uint16Array(2).toLocaleString()",
      "new Int32Array(2).toLocaleString()",
      "new Uint32Array(2).toLocaleString()",
      "new Float16Array(2).toLocaleString()",
      "new Float32Array(2).toLocaleString()",
      "new Float64Array(2).toLocaleString()",
      "new BigInt64Array(2).toLocaleString()",
      "new BigUint64Array(2).toLocaleString()",
    ];
    expect(icu.length).toBe(30);
    // One answer for the whole class, so a member that diverges is named by the
    // diff rather than hidden behind a per-expression assertion.
    const rows = icu.map((expression) => [expression, requires(reads(expression))] as const);
    expect(rows).toEqual(icu.map((expression) => [expression, ["Locale"]] as const));
    // And not refused: row five charges, it does not refuse.
    const refusals = icu.map((expression) => [expression, diagnose(reads(expression))] as const);
    expect(refusals).toEqual(icu.map((expression) => [expression, []] as const));
  });

  /**
   * **Row four, landed.** These were free because `Date` was analyzed at the
   * ROOT IDENTIFIER only: `new Date(instant)` correctly returned an empty row —
   * the instant is authored — and no instance member was ever inspected after
   * it. So `new Date(0).getTimezoneOffset()` compiled clean in the same file
   * where the `Date.now()` control reported `SMITHERS1602`.
   *
   * `SMITHERS1602` and not a new code, because it is the same refusal for the
   * same reason as `Date.now()`. Row four's verb is CHARGE `Clock`, and `Clock`
   * DOES have a source-language surface, so by `compatibility.mdx`'s own
   * reconciling criterion the ambient spelling is additionally refused and the
   * row is charged by the `Clock.context()` the author writes instead. That is
   * why the row here is empty and the diagnostic is not — the same pair
   * `Date.now()` has published all along.
   *
   * The member set is WIDER than the seven the row names, by the row's own
   * criterion and by the precedent row five set when its four names measured
   * twenty-six short. Every local getter reads the zone identically.
   */
  test("a Date instance's host-zone members are refused, at the member", () => {
    const zoneReads: readonly string[] = [
      // The seven the specification names.
      "new Date(0).getHours()",
      "new Date(0).getDay()",
      "new Date(0).getTimezoneOffset()",
      "new Date(0).toLocaleString(\"en\")",
      "new Date(0).toLocaleDateString(\"en\")",
      "new Date(0).toLocaleTimeString(\"en\")",
      "new Date(0).toString()",
      // The seven that carry the identical hazard for the identical reason.
      "new Date(0).getFullYear()",
      "new Date(0).getMonth()",
      "new Date(0).getDate()",
      "new Date(0).getMinutes()",
      "new Date(0).getSeconds()",
      "new Date(0).toDateString()",
      "new Date(0).toTimeString()",
    ];
    // Reported at the MEMBER, not at the root: the root is `new Date(0)`, which
    // is legal, and pointing there would name the wrong operation.
    const observed = zoneReads.map((expression) => [expression, diagnose(reads(expression))] as const);
    expect(observed).toEqual(zoneReads.map((expression) => [expression, ["SMITHERS1602@2:22"]] as const));
    // The refusal charges nothing, exactly as `Date.now()` charges nothing.
    expect(requires(reads("new Date(0).getHours()"))).toEqual([]);
  });

  /**
   * The positive control row four needs, and the one an over-broad rule breaks.
   * `getTime()` is named in the row as staying free, and every UTC-anchored
   * member stays free by the same sentence: their results do not depend on the
   * host zone. Without this, a rule keyed on "any `Date` member" passes every
   * assertion above and makes an absolute instant unreadable.
   */
  test("a Date instance's absolute and UTC members stay free", () => {
    for (const expression of [
      "new Date(0).getTime()",
      "new Date(0).valueOf()",
      "new Date(0).toISOString()",
      "new Date(0).toUTCString()",
      "new Date(0).toJSON()",
      "new Date(0).getUTCHours()",
      "new Date(0).getUTCFullYear()",
      "new Date(0).getMilliseconds()",
    ]) {
      expect([expression, diagnose(reads(expression))]).toEqual([expression, []]);
      expect([expression, requires(reads(expression))]).toEqual([expression, []]);
    }
  });

  /**
   * Row three, and the whole of it: `Promise.race` and `Promise.any` "MUST
   * charge a `Scheduler` requirement, because their value *is* arrival order.
   * Every other `Promise` member stays free."
   *
   * NO REFUSAL, deliberately, and this is the assertion that pins the decision.
   * `durable-execution.mdx` §Deterministic Scheduling says the scheduler "has no
   * source-language surface", so a refusal here would name `Scheduler.context()`
   * as a remedy the author cannot write. The refusal reading was considered and
   * answered rather than dropped; asserting the empty diagnostics list beside
   * the row is what keeps it answered.
   */
  test("Promise.race and Promise.any charge Scheduler, and nothing else does", () => {
    for (const expression of ["Promise.race([Promise.resolve(1)])", "Promise.any([Promise.resolve(1)])"]) {
      expect([expression, requires(reads(expression))]).toEqual([expression, ["Scheduler"]]);
      expect([expression, diagnose(reads(expression))]).toEqual([expression, []]);
    }
    for (const expression of [
      "Promise.all([Promise.resolve(1)])",
      "Promise.allSettled([Promise.resolve(1)])",
      "Promise.resolve(1)",
    ]) {
      expect([expression, requires(reads(expression))]).toEqual([expression, []]);
      expect([expression, diagnose(reads(expression))]).toEqual([expression, []]);
    }
  });

  /** Identity, not spelling — the direction every other rule here is pinned in. */
  test("a local binding named Promise charges nothing", () => {
    expect(diagnose("export function main(): number {\n  const Promise = { race: (): number => 1 }\n  return Promise.race()\n}\n")).toEqual([]);
    expect(requires("export function main(): number {\n  const Promise = { race: (): number => 1 }\n  return Promise.race()\n}\n")).toEqual([]);
  });

  test("Error.prototype.stack is unclassified, and that is recorded rather than decided", () => {
    // Host-varying and named by no specification page. Measured 2026-08-28 and
    // deliberately left alone: ECMA-262 publishes no `Error.prototype.stack` at
    // all, so the allowlist's own criterion — the NAME is admitted because
    // ECMA-262 publishes it — does not classify a property of an instance;
    // its variance is across engines and minification rather than between two
    // hosts at one instant, which §Determinism-Sensitive Members answers with a
    // SHOULD about pinning an engine version rather than with a capability; and
    // it is the language's only stack-trace surface, which `src/cli.ts` reads
    // in the scaffolding it emits. This pins the status quo so that deciding it
    // later is a visible change rather than a silent one.
    expect(diagnose("export function main(): string | undefined {\n  return new Error(\"x\").stack\n}\n")).toEqual([]);
    expect(diagnose("export function main(): string {\n  return new Error(\"x\").message\n}\n")).toEqual([]);
  });
});
