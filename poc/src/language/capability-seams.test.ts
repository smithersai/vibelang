import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndCheckProject } from "./index.ts";

/**
 * The three seams a `.sm` standard library needs, and the two directions each
 * one has to hold in.
 *
 * The load-bearing half of this file is the *negative* half. Opening a way for
 * a capability implementation to reach the host is exactly the shape that could
 * reintroduce ambient authority, so every accepting case below is paired with a
 * case proving ordinary code is still refused — including a class that merely
 * looks like a capability implementation.
 */

const workspace = mkdtempSync(join(tmpdir(), "smithers-capability-seams-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");
const INTROSPECTION = join(import.meta.dir, "../runtime/introspection.ts");

/**
 * The sanctioned host binding. specification/compatibility.mdx, "Source
 * Relationship": `.ts` modules "MUST retain their own complete syntax and
 * behavior when imported by Smithers", and "Foreign Boundary": "Trusted
 * `@throws {never}` metadata opts out" of the default panic case. This module
 * is an ordinary TypeScript module carrying that trust claim.
 */
writeFileSync(join(workspace, "binding.ts"), `/**
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function wallClockMillis(): number { return Date.now(); }
/** @throws {never} */
export function monotonicMillis(): number { return performance.now(); }
/** @throws {never} */
export function randomUnit(): number { return Math.random(); }
/** @throws {never} */
export function environmentValue(name: string): string | undefined { return process.env[name]; }
/** @throws {never} */
export function fillRandomBytes(target: Uint8Array): void { crypto.getRandomValues(target); }
/** @throws {never} */
export function environmentNamesArray(): readonly string[] { return Object.keys(process.env).sort(); }
`);

interface Compiled {
  readonly codes: readonly string[];
  readonly emitted: number;
  readonly rows: Readonly<Record<string, { failures: readonly string[]; requirements: readonly string[] }>>;
}

function compile(source: string, name = "case.sm"): Compiled {
  const fileName = join(workspace, name);
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
  };
}

describe("SEAM 1 — a capability implementation reaches the host through a trusted binding", () => {
  test("a live Clock, Random, and Environment are authorable in .sm", () => {
    const compiled = compile(`import { Context } from "smthrs/context"
import { wallClockMillis, monotonicMillis, randomUnit, environmentValue, fillRandomBytes } from "./binding.ts"

export abstract class Clock extends Context {
  abstract now(): number
  abstract monotonic(): number
}
export class SystemClock extends Clock {
  now(): number { return wallClockMillis() }
  monotonic(): number { return monotonicMillis() }
  get millis(): number { return wallClockMillis() }
}
export abstract class Random extends Context {
  abstract unit(): number
  abstract fill(target: Uint8Array): void
}
export class SystemRandom extends Random {
  unit(): number { return randomUnit() }
  fill(target: Uint8Array): void { fillRandomBytes(target) }
}
export abstract class Environment extends Context {
  abstract get(name: string): string | undefined
}
export class SystemEnvironment extends Environment {
  get(name: string): string | undefined { return environmentValue(name) }
}
export const SYSTEM_CLOCK: Clock = new SystemClock()
export function makeClock(): Clock { return new SystemClock() }
`);
    expect(compiled.codes).toEqual([]);
    expect(compiled.emitted).toBe(0);
    // The implementation IS the capability, so it charges no row of its own.
    expect(compiled.rows.now).toEqual({ failures: [], requirements: [] });
    expect(compiled.rows.unit).toEqual({ failures: [], requirements: [] });
  });

  test("consumers still charge the capability row, and a layer still subtracts it", () => {
    const compiled = compile(`import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"
import { wallClockMillis, randomUnit } from "./binding.ts"

export abstract class Clock extends Context { abstract now(): number }
export abstract class Random extends Context { abstract unit(): number }
export class SystemClock extends Clock { now(): number { return wallClockMillis() } }
export class FixedClock extends Clock {
  constructor(private readonly instant: number) { super() }
  now(): number { return this.instant }
}
export function stamp(message: string): string {
  const clock = Clock.context()
  const again = Clock.context()
  const random = Random.context()
  return \`\${message}:\${clock.now()}:\${again.now()}:\${random.unit()}\`
}
export const LIVE = Layer.succeed(Clock, new SystemClock())
export const TEST = Layer.succeed(Clock, new FixedClock(1))
export function runLive(): string { return Layer.provide(LIVE, () => stamp("live")) }
export function runTest(): string { return Layer.provide(TEST, () => stamp("test")) }
`, "layers.sm");
    expect(compiled.codes).toEqual([]);
    // Duplicate nominal requirements collapse; two capabilities stay two.
    expect(compiled.rows.stamp).toEqual({ failures: [], requirements: ["Clock", "Random"] });
    // `provide` subtracts exactly what the layer provides and no more: both
    // layers supply `Clock`, so `Random` is still unsatisfied in both — which is
    // the half of the accounting a layer could plausibly over-subtract.
    expect(compiled.rows.runLive).toEqual({ failures: [], requirements: ["Random"] });
    expect(compiled.rows.runTest).toEqual({ failures: [], requirements: ["Random"] });
  });

  test("ordinary code still cannot read a host global, in any spelling", () => {
    const compiled = compile(`export function directCall(): number { return Date.now() }
export function bareConstruction(): number { return new Date().getTime() }
export function monotonic(): number { return performance.now() }
export function randomness(): number { return Math.random() }
export function uuid(): string { return crypto.randomUUID() }
export function environment(name: string): string | undefined { return process.env[name] }
export function everything(): unknown { return globalThis }
export function logging(text: string): void { console.log(text) }
export function network(url: string): unknown { return fetch(url) }
export function timers(): unknown { return setTimeout(() => {}, 1) }
export function browser(): unknown { return document }
export function aliased(): number { const D = Date; return D.now() }
export function destructured(): number { const { now } = Date; return now() }
export function computed(): number { return Date["now"]() }
export function captured(): unknown { return { Date } }
export function escaped(sink: (value: unknown) => void): void { sink(Math) }
`, "ordinary.sm");
    const codes = compiled.codes.map((entry) => entry.split("@")[0]);
    expect(codes).toHaveLength(16);
    expect(new Set(codes)).toEqual(new Set(["SMITHERS1601", "SMITHERS1602", "SMITHERS1603"]));
  });

  test("a class that merely looks like a capability implementation gets no exemption", () => {
    // There is no opt-out to claim: the refusal is unconditional, so neither
    // extending a Context subclass nor being named `SystemClock` buys anything.
    const compiled = compile(`import { Context } from "smthrs/context"
export abstract class Clock extends Context { abstract now(): number }
export class ForgedClock extends Clock { now(): number { return Date.now() } }
export class SystemClock { now(): number { return Date.now() } }
`, "forged.sm");
    expect(compiled.codes).toEqual(["SMITHERS1602@3:65", "SMITHERS1602@4:51"]);
  });

  test("a host binding returning an object is still refused; a Smithers-owned buffer is not", () => {
    // The residual wall for the port lane, pinned so it cannot regress silently
    // in either direction: the trust marker clears the panic channel, and the
    // foreign-value rules still refuse the returned object itself.
    const refused = compile(`import { environmentNamesArray } from "./binding.ts"
export function names(): readonly string[] { return environmentNamesArray() }
`, "objects.sm");
    expect(refused.codes.map((entry) => entry.split("@")[0])).toEqual(["SMITHERS1101", "SMITHERS1508"]);

    const owned = compile(`import { fillRandomBytes } from "./binding.ts"
export function bytes(count: number): Uint8Array {
  const target = new Uint8Array(count)
  fillRandomBytes(target)
  return target
}
`, "owned.sm");
    expect(owned.codes).toEqual([]);
  });

  test("`value instanceof Date` is a prototype test, not a host-sensitive operation", () => {
    // specification/compatibility.mdx, "Host Globals": only host-sensitive
    // *operations* need a capability. The rule is already per-operation for
    // `Date.parse`, `Date.UTC`, and `new Date(authoredInstant)`; the right
    // operand of `instanceof` reads no host state either.
    const compiled = compile(`export function isDate(value: unknown): boolean { return value instanceof Date }
export function pureParse(iso: string): number { return Date.parse(iso) }
export function authoredInstant(millis: number): number { return new Date(millis).getTime() }
export function shadowed(value: unknown): boolean { class Date {}; return value instanceof Date }
`, "instanceof.sm");
    expect(compiled.codes).toEqual([]);
    expect(compiled.emitted).toBe(0);
  });

  test("the object itself in a value position is still charged", () => {
    const compiled = compile(`export function escapes(): boolean { return (Date as unknown as object) instanceof Function }
export function stillRefused(): number { return Date.now() }
export function bareConstruction(): number { return new Date().getTime() }
`, "escape.sm");
    expect(compiled.codes).toEqual(["SMITHERS1602@1:46", "SMITHERS1602@2:49", "SMITHERS1602@3:57"]);
  });
});

describe("SEAM 3 — the brand-introspection seam is reachable from .sm", () => {
  test("isResult and isPanic are callable and add no failure channel", () => {
    const compiled = compile(`import { isResult, isPanic } from ${JSON.stringify(INTROSPECTION)}

export function route(scrutinee: unknown): string {
  if (!isResult(scrutinee)) return "not-a-result"
  return scrutinee.isOk() ? "ok" : "error"
}
export function channel(value: unknown): string {
  return isPanic(value) ? "panic" : "plain"
}
`, "seam3.sm");
    expect(compiled.codes).toEqual([]);
    expect(compiled.emitted).toBe(0);
    expect(compiled.rows.route).toEqual({ failures: [], requirements: [] });
    expect(compiled.rows.channel).toEqual({ failures: [], requirements: [] });
  });

  test("the seam is load-bearing: an unmarked wrapper is still refused", () => {
    writeFileSync(join(workspace, "unmarked.ts"), `import { isResult as brand } from ${JSON.stringify(join(import.meta.dir, "../runtime/result.ts"))};
export function isResult(value: unknown): boolean { return brand(value); }
`);
    const compiled = compile(`import { isResult } from "./unmarked.ts"
export function route(scrutinee: unknown): string { return isResult(scrutinee) ? "result" : "plain" }
`, "unmarked-case.sm");
    expect(compiled.codes.map((entry) => entry.split("@")[0])).toContain("SMITHERS1510");
  });
});
