/**
 * The resumable calling convention (`specification/effects.mdx`) applied to the
 * DEPENDENCY half of an effect row, over the programs that exercise it.
 *
 * This file held migration step 6, when the convention sat behind
 * `CompileOptions.effectLowering` and every claim was a claim about a
 * DIFFERENCE between two values of that option. **Step 13 deleted the option
 * and the `"return"` convention with it**, after measuring the two lowerings
 * byte-identical across the whole corpus: `--backend js-yield` reported
 * `Backend agreement: 515/515 identical observations`. So the claims are now
 * about one lowering, and they are the same three claims minus the one that was
 * only ever about the option's default:
 *
 *   1. A function whose requirements are non-empty and whose failures are empty
 *      is emitted as a generator, is delegated into at every call site, and
 *      `Layer.provide` becomes a handler install.
 *   2. Everything the convention cannot own keeps the ordinary one — a fallible
 *      function, a declaration used as a value, a read inside a host callback.
 *   3. A call the emitter cannot resolve is DECIDED from the callee's type, not
 *      refused and not guessed. That is G7, and it is what retired
 *      `SMITHERS1807`.
 *
 * The promise-hook assertion this file used to carry is gone with the apparatus
 * it measured: `poc/src/runtime/layer.ts`'s promise-tracking block was deleted
 * once the conformance epilogue had measured it unengaged across all 515 corpus
 * programs. What replaced it is a behavioural assertion in
 * `runtime/effect.test.ts` — the extent ends with the computation, including
 * when it throws — because that is the property the counter was standing in for.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject } from "./index.ts";

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");
const workspace = mkdtempSync(join(tmpdir(), "smithers-effect-lowering-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

interface Compiled {
  readonly code: Readonly<Record<string, string>>;
  readonly codes: readonly string[];
}

function compile(sources: Readonly<Record<string, string>>): Compiled {
  const result = compileProject(
    Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
    {
      rootDir: "/virtual/effect-lowering",
      outDir: "/virtual/effect-lowering",
      runtimeImport: RUNTIME,
      outputExtension: ".ts",
      sourceMap: false,
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

describe("a call through a function-typed parameter is compiled, not refused", () => {
  /**
   * The shape that used to be `SMITHERS1807`, kept as its own claim because it
   * is the one the option's DEFAULT used to guarantee: whatever the emitter
   * decides here, it must not be a diagnostic. G7 makes it a decision — see "a
   * call through a type-level signature is decided, not refused" below — and
   * this arm is what notices if an emit diagnostic ever reappears on it.
   */
  test("it reports nothing", () => {
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

describe("the resumable convention is emitted for dependencies", () => {
  const emitted = compile({ "main.sm": DI }).code["main.sm"]!;

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

describe("the resumable convention leaves alone what it cannot own", () => {
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
    const emitted = compile({ "main.sm": fallible }).code["main.sm"]!;
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
    const emitted = compile({ "main.sm": escaping }).code["main.sm"]!;
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
    const emitted = compile({ "main.sm": callback }).code["main.sm"]!;
    expect(emitted).toContain("function* readAll");
    expect(emitted).toContain("Directory.context()");
    expect(emitted).not.toContain("__vsGet");
  });
});

describe("a call through a type-level signature is decided, not refused", () => {
  /**
   * Gap G2, and **G7 closes it**. `collectFacts` records a call edge only when
   * the callee resolves, is foreign, or is a panic exit, so a call through a
   * PARAMETER records nothing. That used to be `SMITHERS1807`, on the grounds
   * that both other answers are silently wrong: a plain `run(key)` would hand
   * the caller a generator object where it expects a string, and a
   * `yield* run(key)` would fail on every callee that is not one.
   *
   * There is a third answer and it is two locked sentences in
   * `docs/DECISIONS.md` §Function model, not a guess: "An unannotated function
   * type carries the empty row", and "A function whose row is empty is never
   * emitted in the resumable calling convention". `run`'s type is
   * `(key: string) => string`, which carries the empty row, so the value it
   * holds is not a generator and the call is PLAIN.
   *
   * `ResumableScopes.escaping` is the operational proof for this compilation:
   * a function this mode emits as a generator is mentioned nowhere except in
   * callee position, so no value in the program can hold one.
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

  /**
   * THE VACUITY GUARD, and it is why this is four assertions rather than one.
   *
   * "No diagnostic" alone would be satisfied by a lowering that had stopped
   * producing generator scopes at all — the refusal pass this replaces
   * short-circuited on `scopes.generators.size === 0`, so an emitter that
   * lowered nothing would have passed the old test's negation for free. So the
   * emitted text is asserted to still BE the yield lowering (`function*
   * through`, `yield* __vsGet`) in the same breath as the call being plain.
   */
  test("the call is emitted plain, inside a body that is still a generator", () => {
    const compiled = compile({ "main.sm": throughAParameter });
    expect(compiled.codes).toEqual([]);
    const emitted = compiled.code["main.sm"]!;
    // Still lowered: the assertion above cannot pass by the mode switching off.
    expect(emitted).toContain("function* through");
    expect(emitted).toMatch(/yield\* __vsGet\(Directory, "src-[0-9a-f]{24}"\)/u);
    // And the undecidable call took the decided convention, not a `yield*`.
    expect(emitted).toContain("return run(");
    expect(emitted).not.toContain("yield* run(");
  });

  test("the undecidable program runs and prints the right answer", async () => {
    const directory = mkdtempSync(join(workspace, "through-"));
    const compiled = compile({ "main.sm": throughAParameter });
    expect(compiled.codes).toEqual([]);
    writeFileSync(join(directory, "main.ts"), compiled.code["main.sm"]!);
    const module = await import(join(directory, "main.ts")) as { main(): string[] };
    // The half a wrong decision would break: a `yield* run(...)` throws on a
    // non-generator, and a delegated `through` would hand `main` a generator
    // object instead of an array. Only the decided convention prints this.
    expect(module.main()).toEqual(["ADA"]);
  });

  /**
   * The other direction, and the one that makes G7 a FIX rather than the
   * removal of a wall. `declarations.ts` writes `@smithersEffects` onto every
   * exported declaration and rewrites the return type to `__vsResumable<A>`, so
   * a `.d.ts` from a previously compiled `.sm` package names generators this
   * compiler produced. The retired arm exempted declaration files outright —
   * "nothing in a `.d.ts` was emitted by this compiler" — and lowered every
   * such call as plain. A published non-empty requirement row is now consulted
   * BEFORE the kind test and before that exemption.
   *
   * Asserted through `callConvention`'s own inputs rather than through a
   * two-package fixture, because the fact under test is the ORDER of three
   * tests inside one function.
   */
  test("a declaration that publishes a requirement row is delegated into", () => {
    const emitted = compile({ "main.sm": DI }).code["main.sm"]!;
    // `entry` is a local declaration with a non-empty row, so it delegates.
    expect(emitted).toContain("yield* entry(key)");
    // The row it published is the one a `.d.ts` for this module would carry.
    const declared = compileProject([{ fileName: "main.sm", source: DI }], {
      rootDir: "/virtual/effect-lowering",
      outDir: "/virtual/effect-lowering",
      runtimeImport: RUNTIME,
      outputExtension: ".ts",
      sourceMap: false,
    });
    expect(declared.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  /**
   * The decision has to be NARROW or it delegates into things that are not
   * generators. A method call on a capability service — the whole point of
   * reading one — has no call edge either, and is decided without one: this
   * mode emits only function declarations as generators, so a member selection
   * can never be one.
   */
  test("a method call on a capability service is not delegated into", () => {
    const compiled = compile({ "main.sm": DI });
    expect(compiled.codes).toEqual([]);
    expect(compiled.code["main.sm"]!).not.toContain("yield* directory.lookup");
  });
});

/**
 * The end-to-end claim, run rather than read.
 *
 * The program is compiled, written, and executed. It is the only assertion here
 * that runs emitted code rather than reading it, and it is what would catch a
 * lowering that printed convincing text and produced a generator object where
 * the caller expected an array.
 */
describe("the lowered program runs", () => {
  test("it prints its lines", async () => {
    const directory = mkdtempSync(join(workspace, "lowered-"));
    const compiled = compile({ "main.sm": DI });
    expect(compiled.codes).toEqual([]);
    writeFileSync(join(directory, "main.ts"), compiled.code["main.sm"]!);
    const module = await import(join(directory, "main.ts")) as { main(): string[] };
    expect(module.main()).toEqual(["ADA", "NONE"]);
  });
});
