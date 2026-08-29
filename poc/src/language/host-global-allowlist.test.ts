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

  test("an ordinary value's `constructor` is not the Function constructor", () => {
    // The receiver test is what keeps the second arm narrow. None of these
    // compiles a string, and a rule keyed on the member NAME would refuse all
    // of them.
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

  test("the rest of Intl needs no capability", () => {
    expect(diagnose(reads("Intl.getCanonicalLocales(\"EN-us\")"))).toEqual([]);
    expect(diagnose(reads("new Intl.NumberFormat(\"en-US\").format(1)"))).toEqual([]);
    expect(diagnose(reads("new Intl.Collator(\"en-US\").compare(\"a\", \"b\")"))).toEqual([]);
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
   * **This is a positive control, and it is the one row five needs.** Row five
   * is unenforced — all thirty are free today — so the failure mode is not an
   * escape but an over-refusal: the cheapest wrong implementation of row four
   * or row five charges the `Intl` ROOT, which passes every DateTimeFormat
   * assertion above perfectly and silently takes the entire ICU surface of the
   * standard library with it. `20-host-globals/determinism-hostile-siblings-stay-available`
   * guards rows one and two the same way, and `20/the-ecmascript-global-object-stays-available`
   * guards the allowlist. Asserting UNIFORMITY rather than emptiness is what
   * survives row five actually landing: when these do charge `Locale` they must
   * all charge it, and this test then names exactly which members diverged.
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
    // diff rather than hidden behind a per-expression `toEqual([])`.
    const answers = icu.map((expression) => [expression, diagnose(reads(expression))] as const);
    expect(answers).toEqual(icu.map((expression) => [expression, []] as const));
  });

  test("Date's two unnamed locale members are the same as its named ones", () => {
    // Row four gained `toLocaleDateString` and `toLocaleTimeString` on
    // 2026-08-28 by the same argument that widened row five: it already named
    // `toLocaleString`, and these two read the host time zone identically. They
    // are free today for the reason the whole row is — `Date` is analyzed at
    // the root identifier only, so an instance member is never inspected.
    expect(diagnose(reads("new Date(0).toLocaleString(\"en\")"))).toEqual([]);
    expect(diagnose(reads("new Date(0).toLocaleDateString(\"en\")"))).toEqual([]);
    expect(diagnose(reads("new Date(0).toLocaleTimeString(\"en\")"))).toEqual([]);
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
