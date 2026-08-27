/**
 * The callback contract boundary (SMITHERS1303 / SMITHERS2105).
 *
 * A function value whose `Result` channel is *inferred* changes shape when it is
 * lowered: its `throw` becomes `return __vsResultFailure(...)` and its plain
 * returns become `__vsResultSuccess(...)`. A consumer that was type-checked
 * against the authored signature never learns that, so the declared failure
 * arrives at the call site as a success carrying a Result
 * (specification/failures.mdx, "Compiler Lifting": "returning an existing
 * compatible Result MUST preserve it without nesting").
 *
 * These tests execute the emitted modules. A diagnostic-only assertion would
 * have passed against the compiler that produced the hole, because the emitted
 * TypeScript for the failing shapes type-checks.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeSource } from "./analyze.ts";
import { compileSmithers } from "./compile.ts";
import { compileAndCheckSmithers } from "./validate.ts";
import { __vsInspectResult, __vsResultFailure, type Result } from "../runtime/index.ts";

const examples = `${import.meta.dir}/../../examples/language`;

function check(source: string, name: string) {
  return compileAndCheckSmithers(source, {
    fileName: `${examples}/${name}.sm`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.sm`,
    runtimeImport: "../../src/runtime/index.ts",
  });
}

function codes(source: string): readonly string[] {
  return analyzeSource(source).diagnostics.map((diagnostic) => diagnostic.code);
}

async function execute(source: string, name: string): Promise<Record<string, any>> {
  const executable = compileSmithers(source, {
    fileName: `${examples}/${name}.sm`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.sm`,
    runtimeImport: pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  });
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "smithers-callback-"));
  const modulePath = join(directory, `${name}.mjs`);
  try {
    await writeFile(modulePath, javascript);
    return await import(pathToFileURL(modulePath).href) as Record<string, any>;
  } finally {
    await rm(directory, { recursive: true });
  }
}

/** How an executed Result actually came back, in a form a failure message reads well. */
function outcome(value: unknown): { readonly ok: boolean; readonly payload: string } {
  const inspected = __vsInspectResult(value as Result<unknown, Error>);
  const carried = inspected.ok ? inspected.value : inspected.error;
  const name = carried === null || carried === undefined
    ? String(carried)
    : (carried as object).constructor?.name ?? typeof carried;
  return { ok: inspected.ok, payload: name };
}

/** The exact program reported as the soundness hole. */
const REPORTED = `
export class Wrapped extends Error {}

export function mapError(
  result: Result<unknown, Error>,
  mapper: (error: Error) => Wrapped,
): Result<unknown, Wrapped> {
  return result.match({
    ok: (value) => value,
    error: (error) => { throw mapper(error) },
  })
}
`;

/**
 * The same intent — a `throw` written directly in an inline callback — in the
 * spelling SMITHERS1303 asks for. The callback carries the explicit `Result`
 * contract, so the consumer's parameter type says exactly what the lowered
 * callback returns and no nesting can be introduced.
 */
const CONTRACTED = `
export class Wrapped extends Error {}

function apply(
  value: number,
  transform: (n: number) => Result<number, Wrapped>,
): Result<number, Wrapped> {
  const mapped = transform(value)!
  return mapped
}

export function doubleOrFail(value: number): Result<number, Wrapped> {
  const out = apply(value, (n): Result<number, Wrapped> => {
    if (n < 0) throw new Wrapped("negative: " + n)
    return n * 2
  })
  return out
}
`;

describe("a fallible callback may not cross a boundary without a spelled contract", () => {
  test("the reported program is refused, at the callback that carries the throw", () => {
    const checked = check(REPORTED, "reported-callback-throw");
    expect(checked.result.analysis.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", code: "SMITHERS1303", line: 10, column: 12 }),
    ]);
    expect(checked.ok).toBe(false);
    // The row it declared is still the row it declared; refusing the program is
    // what stops the row from being a lie, not rewriting the row.
    expect(checked.result.analysis.rows.mapError).toEqual({ failures: ["Wrapped"], requirements: [] });
  });

  test("an accepted callback throw arrives at the caller AS a failure", async () => {
    const checked = check(CONTRACTED, "contracted-callback-throw");
    expect(checked.result.analysis.diagnostics).toEqual([]);
    expect(checked.emitDiagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
    expect(checked.result.analysis.rows.doubleOrFail).toEqual({ failures: ["Wrapped"], requirements: [] });

    const module = await execute(CONTRACTED, "contracted-callback-throw");
    const failed = module.doubleOrFail(-4);
    expect({ isOk: failed.isOk(), isError: failed.isError() }).toEqual({ isOk: false, isError: true });
    const inspected = __vsInspectResult(failed as Result<number, Error>);
    expect(inspected.ok).toBe(false);
    if (inspected.ok) throw new TypeError("unreachable");
    expect(inspected.error).toBeInstanceOf(module.Wrapped);
    expect(inspected.error.message).toBe("negative: -4");

    // The other direction: a plain value returned from a Result function is
    // still lifted to a success carrying that plain value, never a Result.
    const succeeded = module.doubleOrFail(21);
    expect(outcome(succeeded)).toEqual({ ok: true, payload: "Number" });
    expect(succeeded.unwrapOr(0)).toBe(42);
  });

  test("every accepted member of the class executes its declared failure as a failure", async () => {
    /**
     * One entry per spelling that can put a function value on the far side of a
     * consumer. Every consumer here is a local function, so each program is
     * self-contained and can actually be run.
     *
     * The load-bearing assertion is the executed one: whichever members the
     * acceptance rule admits, running them MUST deliver the declared `Wrapped`
     * failure through the failure channel. Before this gate was widened the
     * five `accepted: false` members compiled with zero language diagnostics and
     * zero emitted-TypeScript diagnostics, and every one of them executed to
     * `isOk() === true` carrying a `Result` as its success payload.
     */
    const forms: readonly {
      readonly id: string;
      readonly accepted: boolean;
      readonly source: string;
      readonly run: (module: Record<string, any>) => unknown;
    }[] = [
      {
        id: "inline callback inside an object-literal argument",
        accepted: false,
        source: `
export class Wrapped extends Error {}
function take(handlers: { ok: () => unknown }): unknown { return handlers.ok() }
export function f(): Result<unknown, Wrapped> {
  const v = take({ ok: () => { throw new Wrapped("x") } })
  return v
}
`,
        run: (module) => module.f(),
      },
      {
        id: "shorthand method inside an object-literal argument",
        accepted: false,
        source: `
export class Wrapped extends Error {}
function take(handlers: { ok(): unknown }): unknown { return handlers.ok() }
export function f(): Result<unknown, Wrapped> {
  const v = take({ ok() { throw new Wrapped("x") } })
  return v
}
`,
        run: (module) => module.f(),
      },
      {
        id: "inline callback inside an array-literal argument",
        accepted: false,
        source: `
export class Wrapped extends Error {}
function take(callbacks: readonly (() => unknown)[]): unknown {
  for (const callback of callbacks) return callback()
  return 0
}
export function f(): Result<unknown, Wrapped> {
  const v = take([() => { throw new Wrapped("x") }])
  return v
}
`,
        run: (module) => module.f(),
      },
      {
        id: "inline callback argument wrapped in parentheses",
        accepted: false,
        source: `
export class Wrapped extends Error {}
function take(callback: () => unknown): unknown { return callback() }
export function f(): Result<unknown, Wrapped> {
  const v = take((() => { throw new Wrapped("x") }))
  return v
}
`,
        run: (module) => module.f(),
      },
      {
        id: "callback whose Result channel comes only from postfix !",
        accepted: false,
        source: `
export class Wrapped extends Error {}
function take(callback: () => unknown): unknown { return callback() }
export function f(r: Result<number, Wrapped>): Result<unknown, Wrapped> {
  const v = take(() => { const n = r!; return n })
  return v
}
`,
        run: (module) => module.f(__vsResultFailure(new module.Wrapped("gone"))),
      },
      {
        id: "inline callback with a spelled contract",
        accepted: true,
        source: CONTRACTED,
        run: (module) => module.doubleOrFail(-4),
      },
      {
        id: "callback forwarding an already-Result value",
        accepted: true,
        source: `
export class Wrapped extends Error {}
function produce(flag: boolean): Result<number, Wrapped> {
  if (!flag) throw new Wrapped("produced")
  return 1
}
function apply(callback: () => Result<number, Wrapped>): Result<number, Wrapped> {
  const value = callback()!
  return value
}
export function f(flag: boolean): Result<number, Wrapped> {
  const out = apply(() => produce(flag))
  return out
}
`,
        run: (module) => module.f(false),
      },
    ];

    const acceptance: Record<string, boolean> = {};
    const expectedAcceptance: Record<string, boolean> = {};
    const executed: Record<string, { readonly ok: boolean; readonly payload: string }> = {};
    const expectedExecution: Record<string, { readonly ok: boolean; readonly payload: string }> = {};

    for (const [index, form] of forms.entries()) {
      const name = `callback-class-${index}`;
      const checked = check(form.source, name);
      acceptance[form.id] = checked.ok;
      expectedAcceptance[form.id] = form.accepted;
      // A refused program has no build, so there is nothing to run. Anything the
      // rule does admit is run, and must come back as a failure.
      if (!checked.ok) continue;
      const module = await execute(form.source, name);
      executed[form.id] = outcome(form.run(module));
      expectedExecution[form.id] = { ok: false, payload: "Wrapped" };
    }

    expect(executed).toEqual(expectedExecution);
    expect(acceptance).toEqual(expectedAcceptance);
  });
});

describe("the callback gate does not fire where nothing is being hidden", () => {
  test("a spelled Result contract, a caught throw, and a forwarded Result all stay accepted", () => {
    // A callback that spells its contract.
    expect(codes(`
      class Failure extends Error {}
      declare function take(callback: (n: number) => Result<number, Failure>): number
      export function f(): Result<number, Failure> {
        const v = take((n): Result<number, Failure> => { throw new Failure("x") })
        return v
      }
    `)).toEqual([]);

    // A throw the callback itself catches is not a failure channel at all.
    expect(codes(`
      class Failure extends Error {}
      declare function take(handlers: { ok: () => unknown }): unknown
      export function f(): unknown {
        const v = take({ ok: () => { try { throw new Failure("x") } catch { return 0 } } })
        return v
      }
    `)).toEqual([]);

    // A callback that forwards an already-Result value introduces no nesting,
    // so its inferred contract is trustworthy and needs no annotation.
    expect(codes(`
      class Failure extends Error {}
      function produce(flag: boolean): Result<number, Failure> {
        if (!flag) throw new Failure("x")
        return 1
      }
      declare function take(callback: () => Result<number, Failure>): number
      export function f(flag: boolean): Result<number, Failure> {
        const v = take(() => produce(flag))
        return v
      }
    `)).toEqual([]);

    // An object literal that never crosses a boundary is not a callback edge:
    // the local call site is analyzed, so the lowering is accounted for.
    expect(codes(`
      class Failure extends Error {}
      export function f(): Result<number, Failure> {
        const handlers = { ok: (n: number) => { throw new Failure("x") } }
        const v = handlers.ok(1)
        return v
      }
    `)).toEqual([]);
  });

  test("an ordinary throw still charges its own function, and postfix ! is untouched", async () => {
    const source = `
export class Missing extends Error {}

export function lookup(flag: boolean): Result<number, Missing> {
  if (!flag) throw new Missing("absent")
  return 7
}

export function forward(flag: boolean): Result<number, Missing> {
  const value = lookup(flag)!
  return value + 1
}
`;
    const checked = check(source, "ordinary-throw-and-propagation");
    expect(checked.result.analysis.diagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
    // The throw is charged to the function that wrote it, and propagation
    // carries the same row outward.
    expect(checked.result.analysis.rows).toEqual({
      lookup: { failures: ["Missing"], requirements: [] },
      forward: { failures: ["Missing"], requirements: [] },
    });
    expect(checked.result.code).toContain("__vsInspectResult");

    const module = await execute(source, "ordinary-throw-and-propagation");
    expect(outcome(module.lookup(false))).toEqual({ ok: false, payload: "Missing" });
    expect(outcome(module.lookup(true))).toEqual({ ok: true, payload: "Number" });
    expect(outcome(module.forward(false))).toEqual({ ok: false, payload: "Missing" });
    expect(outcome(module.forward(true))).toEqual({ ok: true, payload: "Number" });
    expect(module.forward(true).unwrapOr(0)).toBe(8);
  });

  test("a program that needs no lowering is still emitted byte-for-byte", () => {
    const source = `declare function take(callback: (n: number) => number): number\n` +
      `export const applied = take((n) => n * 2)\n`;
    const result = compileSmithers(source, {
      fileName: `${examples}/untouched-callback.sm`,
      outputFileName: `${examples}/untouched-callback.generated.ts`,
      sourceName: "examples/language/untouched-callback.sm",
      runtimeImport: "../../src/runtime/index.ts",
    });
    expect(result.analysis.diagnostics).toEqual([]);
    expect(result.code).toBe(source);
  });
});
