/**
 * `CompileOptions.effectLowering`, both values, over the same programs.
 *
 * This file holds migration step 6: the resumable calling convention
 * (`specification/effects.mdx`) applied to the DEPENDENCY half of an effect row
 * and to nothing else, behind a flag whose default is the lowering that shipped.
 *
 * Three claims, and the file is organized as three claims rather than as a list
 * of assertions because two of them are about what does NOT change:
 *
 *   1. `"return"` — the default and every caller that names nothing — emits
 *      byte-identical text to the compiler that had no such option. Asserted by
 *      comparing the two calls rather than by pinning a snapshot, so it stays
 *      true as the emitter changes for other reasons.
 *   2. `"yield"` emits a generator for a function whose requirements are
 *      non-empty and whose failures are empty, delegates into it at every call
 *      site, and turns `Layer.provide` into a handler install — with the SAME
 *      observable output, which is checked by running both.
 *   3. Everything `"yield"` cannot decide is REFUSED, loudly, with a code. The
 *      refusal is the whole safety margin of the step: `specification/compatibility`
 *      requires that "infallible functions MUST NOT be wrapped", this mode
 *      wraps every function it lowers, and the contradiction is only tolerable
 *      because it is scoped to a flag AND cannot silently produce a wrong
 *      answer where the flag's assumption does not hold.
 *
 * The promise-hook assertion is here and not only in the conformance harness
 * because it is the measurement that makes "`layer.ts:16-119` is dead under the
 * flag" a fact. It reads `engagements` as well as `live`, and the extra counter
 * is not belt-and-braces: `live` returns to zero after any balanced run, and on
 * Bun — the host these tests and every conformance case execute on — no lease
 * is ever taken at all, because `promiseHooks.createHook` throws there. An
 * assertion on `live` alone would pass on this host without measuring anything,
 * so the test proves the counter can move by moving it with the default
 * lowering first.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, type EffectLowering } from "./index.ts";
import { __vsPromiseHookLeases } from "../runtime/index.ts";

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");
const workspace = mkdtempSync(join(tmpdir(), "smithers-effect-lowering-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

interface Compiled {
  readonly code: Readonly<Record<string, string>>;
  readonly codes: readonly string[];
}

function compile(
  sources: Readonly<Record<string, string>>,
  lowering?: EffectLowering,
): Compiled {
  const result = compileProject(
    Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
    {
      rootDir: "/virtual/effect-lowering",
      outDir: "/virtual/effect-lowering",
      runtimeImport: RUNTIME,
      outputExtension: ".ts",
      sourceMap: false,
      ...(lowering === undefined ? {} : { effectLowering: lowering }),
    },
  );
  return {
    code: Object.fromEntries(Object.entries(result.files).map(([name, file]) => [name, file.code])),
    codes: result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.code).sort(),
  };
}

const HEAD = `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"

abstract class Directory extends Context {
  abstract lookup(key: string): string
}

const live: Directory = { lookup: (key) => (key === "ada" ? "Ada" : "none") }
`;

/** One capability read, one caller, one provide: the smallest complete shape. */
const DI = `${HEAD}
function entry(key: string): string {
  return Directory.context().lookup(key)
}

function shout(key: string): string {
  return entry(key).toUpperCase()
}

export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => [shout("ada"), shout("zoe")])
}
`;

describe("the default lowering is the lowering that shipped", () => {
  /**
   * Compared against the SAME compiler called without the option, not against a
   * transcript. A pinned snapshot would go stale the first time the emitter
   * changed for an unrelated reason and would then be updated rather than
   * consulted; this stays a real equality no matter what the emitter does next.
   */
  test("naming \"return\" and naming nothing emit the same text", () => {
    expect(compile({ "main.sm": DI }, "return").code).toEqual(compile({ "main.sm": DI }).code);
  });

  test("the default emits no request, no handler, and no generator", () => {
    const emitted = compile({ "main.sm": DI }).code["main.sm"]!;
    expect(emitted).toContain("Directory.context()");
    expect(emitted).toContain("Layer.provide(");
    expect(emitted).not.toContain("__vsGet");
    expect(emitted).not.toContain("__vsProvide");
    expect(emitted).not.toContain("function*");
  });

  /**
   * The refusal is emitted only under the flag, so the default cannot acquire a
   * diagnostic it did not have. This is the arm that keeps `SMITHERS1807` from
   * being a language change smuggled in behind an emit option.
   */
  test("the default never reports SMITHERS1807", () => {
    const undecidable = `${HEAD}
function through(run: (key: string) => string, key: string): string {
  Directory.context().lookup(key)
  return run(key)
}

export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => [through((key) => key, "ada")])
}
`;
    expect(compile({ "main.sm": undecidable }).codes).toEqual([]);
  });
});

describe("the yield lowering emits the resumable convention for dependencies", () => {
  const emitted = compile({ "main.sm": DI }, "yield").code["main.sm"]!;

  test("a requirements-only function declaration becomes a generator", () => {
    expect(emitted).toContain("function* entry(key: string): __vsResumable<string>");
    expect(emitted).toContain("function* shout(key: string): __vsResumable<string>");
  });

  /**
   * The declared return type MUST be rewritten, not merely tolerated: the
   * emitted module set is checked by stock TypeScript, which rejects
   * `function* entry(): string` outright.
   */
  test("the declared return type is rewritten rather than left behind", () => {
    expect(emitted).not.toContain("function* entry(key: string): string");
  });

  test("a capability read becomes a get request carrying its site identity", () => {
    expect(emitted).toMatch(/yield\* __vsGet\(Directory, "src-[0-9a-f]{24}"\)/u);
  });

  test("a call to a resumable function is delegated into", () => {
    expect(emitted).toContain("yield* entry(key)");
  });

  test("Layer.provide becomes a handler install and Layer.provide is not called", () => {
    expect(emitted).toContain("__vsProvideRoot(Layer.succeed(Directory, live), function* ()");
    expect(emitted).not.toContain("Layer.provide(");
  });

  /**
   * `main` is not a generator, and that is not an accident of this program: a
   * provide SUBTRACTS the capabilities it supplies, so the enclosing function's
   * requirement row is empty and the mode leaves it in the ordinary convention.
   * It is what lets an ordinary caller — a test, a CLI, this file's own harness
   * — call `main()` and get an array.
   */
  test("a function whose row the provide emptied stays an ordinary function", () => {
    expect(emitted).toContain("export function main(): string[]");
  });
});

describe("the yield lowering leaves alone what it cannot own", () => {
  /**
   * DI only. A non-empty failure row means the function already carries the
   * other lowering — a `Result` return and a `return` of the error variant at
   * every `!` — and mixing the two conventions in one body is step 7's problem,
   * not this step's.
   */
  test("a fallible function keeps the ordinary convention", () => {
    const fallible = `${HEAD}
export class Missing extends Error {}

function entry(key: string): Result<string, Missing> {
  const found = Directory.context().lookup(key)
  if (found === "none") throw new Missing()
  return found
}

export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => [
    entry("ada").match({ ok: (value) => value, error: () => "missing" }),
  ])
}
`;
    const emitted = compile({ "main.sm": fallible }, "yield").code["main.sm"]!;
    expect(emitted).toContain("function entry(key: string): ");
    expect(emitted).not.toContain("function* entry");
    expect(emitted).toContain("Directory.context()");
  });

  /**
   * MEASURED on `05-context-rows/the-coercion-row-reaches-the-provide-site-and-runs`,
   * which is why the rule is about the REFERENCE and not about `valueOf`: with
   * the function emitted as a generator, `Number(referenceProperty)` produced
   * `NaN`, because the coercion protocol called the slot and got a generator
   * object back. An array of handlers, a field, a default argument and a
   * re-export all do the same thing.
   */
  test("a function declaration used as a value keeps the ordinary convention", () => {
    const escaping = `${HEAD}
function reads(): string {
  return Directory.context().lookup("ada")
}

const held = { reads }

export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => [held.reads()])
}
`;
    const emitted = compile({ "main.sm": escaping }, "yield").code["main.sm"]!;
    expect(emitted).not.toContain("function* reads");
    expect(emitted).toContain("Directory.context()");
  });

  /**
   * An accessor cannot be a generator and a host callback will not drive one,
   * so a read in either position stays a `useCapability` call and is answered
   * by the environment scope `__vsProvide` opens. That shim is why R5 of the
   * migration plan keeps the ALS store past the flag's deletion.
   */
  test("a read inside a host callback stays a plain capability read", () => {
    const callback = `${HEAD}
function readAll(keys: readonly string[]): string[] {
  return keys.map((key) => Directory.context().lookup(key))
}

export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => readAll(["ada"]))
}
`;
    const emitted = compile({ "main.sm": callback }, "yield").code["main.sm"]!;
    expect(emitted).toContain("function* readAll");
    expect(emitted).toContain("Directory.context()");
    expect(emitted).not.toContain("__vsGet");
  });
});

describe("a call the yield lowering cannot decide is refused, never guessed", () => {
  /**
   * Gap G2, exactly as `semantic.ts:2425-2428` leaves it: `collectFacts`
   * records a call edge only when the callee resolves, is foreign, or is a
   * panic exit, so a call through a PARAMETER records nothing and the callee's
   * type carries no requirement row until G7 lands. There is no third answer,
   * and both wrong ones are silent: a plain `run(key)` would hand the caller a
   * generator object where it expects a string, and a `yield* run(key)` would
   * fail on every callee that is not one.
   */
  const throughAParameter = `${HEAD}
function through(run: (key: string) => string, key: string): string {
  const directory = Directory.context()
  return run(directory.lookup(key))
}

export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => [
    through((value) => value.toUpperCase(), "ada"),
  ])
}
`;

  test("SMITHERS1807 refuses a call through a function-typed parameter", () => {
    expect(compile({ "main.sm": throughAParameter }, "yield").codes).toEqual(["SMITHERS1807"]);
  });

  test("the refusal names the call, in authored coordinates", () => {
    const result = compileProject([{ fileName: "main.sm", source: throughAParameter }], {
      rootDir: "/virtual/effect-lowering",
      outDir: "/virtual/effect-lowering",
      runtimeImport: RUNTIME,
      outputExtension: ".ts",
      sourceMap: false,
      effectLowering: "yield",
    });
    const refusal = result.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS1807")!;
    const line = throughAParameter.split("\n")[refusal.line - 1]!;
    expect(line.slice(refusal.column - 1)).toStartWith("run(directory.lookup(key))");
  });

  /**
   * The refusal has to be NARROW or it refuses the language. A method call on a
   * capability service — the whole point of reading one — has no call edge
   * either, and is decided without one: this mode emits only function
   * declarations as generators, so a member selection can never be one.
   */
  test("a method call on a capability service is not refused", () => {
    expect(compile({ "main.sm": DI }, "yield").codes).toEqual([]);
  });
});

/**
 * The end-to-end claim, run rather than read.
 *
 * Both lowerings of one program are compiled, written beside each other, and
 * executed; the two must print the same lines. The promise-hook counter is read
 * in the same process afterwards, which is what makes the "dead under the flag"
 * claim a measurement — the emitted module imports the runtime this test
 * imports, so the counter it reads is the one the program would have moved.
 */
describe("both lowerings of one program produce one observation", () => {
  test("the yield lowering runs, agrees, and never engages the promise hooks", async () => {
    const before = __vsPromiseHookLeases().engagements;
    const outputs: string[][] = [];
    for (const lowering of ["return", "yield"] as const) {
      const directory = mkdtempSync(join(workspace, `${lowering}-`));
      const compiled = compile({ "main.sm": DI }, lowering);
      expect(compiled.codes).toEqual([]);
      writeFileSync(join(directory, "main.ts"), compiled.code["main.sm"]!);
      const module = await import(join(directory, "main.ts")) as { main(): string[] };
      outputs.push(module.main());
    }
    expect(outputs[1]).toEqual(outputs[0]!);
    expect(outputs[1]).toEqual(["ADA", "NONE"]);
    // The default lowering DOES reach the apparatus — `Layer.provide` enters
    // the tracking path on every call — so the two arms are separated rather
    // than summed. Asserting only "zero at the end" would be satisfied by both,
    // and asserting on LEASES would be satisfied by both on this host, where
    // `promiseHooks.createHook` throws and no lease is ever taken.
    expect(__vsPromiseHookLeases().engagements).toBeGreaterThan(before);
    const afterBoth = __vsPromiseHookLeases().engagements;
    const directory = mkdtempSync(join(workspace, "yield-only-"));
    writeFileSync(join(directory, "main.ts"), compile({ "main.sm": DI }, "yield").code["main.sm"]!);
    const module = await import(join(directory, "main.ts")) as { main(): string[] };
    expect(module.main()).toEqual(["ADA", "NONE"]);
    expect(__vsPromiseHookLeases().engagements).toBe(afterBoth);
    expect(__vsPromiseHookLeases().live).toBe(0);
  });
});
