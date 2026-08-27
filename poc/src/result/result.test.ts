import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  compileAndCheckSmithers,
  emitProjectDeclarations,
  readDeclarationEffects,
} from "../language/index.ts";
import { __vsResultFailure, __vsResultSuccess, type Result } from "../runtime/index.ts";

const SOURCE_FILE = resolve(import.meta.dir, "result.sm");
const RUNTIME_IMPORT = resolve(import.meta.dir, "../runtime/index.ts");

function compile() {
  return compileAndCheckSmithers(readFileSync(SOURCE_FILE, "utf8"), {
    fileName: SOURCE_FILE,
    outputFileName: resolve(import.meta.dir, "result.generated.ts"),
    runtimeImport: RUNTIME_IMPORT,
    sourceName: "result.sm",
  });
}

class Missing extends Error {}

/** The `.sm` combinator surface, as the emitted module exposes it. */
type Combinators = {
  map<A, B, E extends Error>(result: Result<A, E>, mapper: (value: A) => B): Result<B, E>;
  andThen<A, B, E extends Error, F extends Error>(
    result: Result<A, E>,
    mapper: (value: A) => Result<B, F>,
  ): Result<B, E | F>;
  andThenAsync<A, B, E extends Error, F extends Error>(
    result: Result<A, E>,
    mapper: (value: A) => Promise<Result<B, F>>,
  ): Promise<Result<B, E | F>>;
  tap<A, E extends Error>(result: Result<A, E>, observer: (value: A) => void): Result<A, E>;
  tapAsync<A, E extends Error>(
    result: Result<A, E>,
    observer: (value: A) => Promise<void>,
  ): Promise<Result<A, E>>;
  all<A, E extends Error>(results: Iterable<Result<A, E>>): Result<readonly A[], E>;
  allAsync<A, E extends Error>(
    pending: Iterable<Promise<Result<A, E>>>,
  ): Promise<Result<readonly A[], E>>;
  partition<A, E extends Error>(
    results: Iterable<Result<A, E>>,
  ): { readonly values: readonly A[]; readonly errors: readonly E[] };
  partitionAsync<A, E extends Error>(
    pending: Iterable<Promise<Result<A, E>>>,
  ): Promise<{ readonly values: readonly A[]; readonly errors: readonly E[] }>;
};

async function load(): Promise<{ module: Combinators; dispose: () => Promise<void> }> {
  const checked = compile();
  if (!checked.ok) throw new TypeError("result.sm did not compile");
  const root = await mkdtemp(join(tmpdir(), "smithers-result-sm-"));
  const entry = join(root, "result.ts");
  await writeFile(entry, checked.result.code);
  const module = await import(pathToFileURL(entry).href) as Combinators;
  return { module, dispose: () => rm(root, { recursive: true, force: true }) };
}

describe("smthrs/result authored in Smithers", () => {
  test("the .sm source satisfies the acceptance rule with no diagnostics", () => {
    const checked = compile();
    expect(checked.result.analysis.diagnostics).toEqual([]);
    expect(checked.emitDiagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
  });

  test("failure rows are inferred from postfix ! rather than declared by hand", () => {
    const rows = compile().result.analysis.rows;
    expect(rows.map).toEqual({ failures: ["E"], requirements: [] });
    expect(rows.andThen).toEqual({ failures: ["E", "F"], requirements: [] });
    expect(rows.andThenAsync).toEqual({ failures: ["E", "F"], requirements: [] });
    expect(rows.tap).toEqual({ failures: ["E"], requirements: [] });
    expect(rows.tapAsync).toEqual({ failures: ["E"], requirements: [] });
    expect(rows.all).toEqual({ failures: ["E"], requirements: [] });
    expect(rows.allAsync).toEqual({ failures: ["E"], requirements: [] });
    // `partition` reports every outcome instead of short-circuiting, so it is
    // infallible and must not acquire a failure channel.
    expect(rows.partition).toEqual({ failures: [], requirements: [] });
    expect(rows.partitionAsync).toEqual({ failures: [], requirements: [] });
  });

  test("lowering uses only compiler-owned Result hooks", () => {
    const code = compile().result.code;
    expect(code).toContain("__vsInspectResult");
    expect(code).toContain("__vsResultSuccess");
    expect(code).toContain("__vsResultFailure");
    // Nothing in the authored source names a lowering hook.
    const authored = readFileSync(SOURCE_FILE, "utf8");
    for (const hook of ["__vsInspectResult", "__vsResultSuccess", "__vsResultFailure"]) {
      expect(authored).not.toContain(hook);
    }
  });

  test("declaration emit publishes the inferred effect rows", () => {
    const checked = compile();
    const declarations = emitProjectDeclarations([{
      fileName: resolve(import.meta.dir, "result.generated.ts"),
      code: checked.result.code,
      effects: checked.result.analysis.rows,
    }]);
    expect(declarations.diagnostics).toEqual([]);
    expect(declarations.ok).toBe(true);
    const output = declarations.outputs[0]!;
    expect(output.code).toContain("@smithersEffects");
    const effects = readDeclarationEffects(output.code, output.fileName);
    expect(effects.map).toEqual({ failures: ["E"], requirements: [] });
    expect(effects.all).toEqual({ failures: ["E"], requirements: [] });
  });

  test("the emitted module executes against the real runtime", async () => {
    const { module, dispose } = await load();
    try {
      const ok = __vsResultSuccess(2) as Result<number, Missing>;
      const bad = __vsResultFailure(new Missing("gone")) as Result<number, Missing>;

      expect(module.map(ok, (value) => value * 3).unwrapOr(0)).toBe(6);
      expect(module.map(bad, (value) => value * 3).isError()).toBe(true);

      expect(module.andThen(ok, (value) => __vsResultSuccess(value + 1)).unwrapOr(0)).toBe(3);
      expect(module.andThen(ok, () => __vsResultFailure(new Missing("later"))).isError()).toBe(true);
      expect(module.andThen(bad, (value) => __vsResultSuccess(value)).isError()).toBe(true);

      const seen: number[] = [];
      expect(module.tap(ok, (value) => void seen.push(value)).unwrapOr(0)).toBe(2);
      expect(module.tap(bad, (value) => void seen.push(value)).isError()).toBe(true);
      expect(seen).toEqual([2]);

      expect(module.all([ok, __vsResultSuccess(5) as Result<number, Missing>]).unwrapOr([]))
        .toEqual([2, 5]);
      const shortCircuited = module.all([ok, bad, __vsResultSuccess(9) as Result<number, Missing>]);
      expect(shortCircuited.isError()).toBe(true);

      expect(module.partition([ok, bad, __vsResultSuccess(9) as Result<number, Missing>]))
        .toEqual({ values: [2, 9], errors: [expect.any(Missing)] });
    } finally {
      await dispose();
    }
  });

  test("the async combinators await without collapsing the Result", async () => {
    const { module, dispose } = await load();
    try {
      const ok = __vsResultSuccess(2) as Result<number, Missing>;
      const bad = __vsResultFailure(new Missing("gone")) as Result<number, Missing>;

      const chained = await module.andThenAsync(ok, async (value) =>
        __vsResultSuccess(value * 4) as Result<number, Missing>);
      expect(chained.unwrapOr(0)).toBe(8);
      const chainedFailure = await module.andThenAsync(bad, async (value) =>
        __vsResultSuccess(value) as Result<number, Missing>);
      expect(chainedFailure.isError()).toBe(true);

      const observed: number[] = [];
      const tapped = await module.tapAsync(ok, async (value) => void observed.push(value));
      expect(tapped.unwrapOr(0)).toBe(2);
      expect(observed).toEqual([2]);

      const collected = await module.allAsync([Promise.resolve(ok), Promise.resolve(ok)]);
      expect(collected.unwrapOr([])).toEqual([2, 2]);
      const collectedFailure = await module.allAsync([Promise.resolve(ok), Promise.resolve(bad)]);
      expect(collectedFailure.isError()).toBe(true);

      expect(await module.partitionAsync([Promise.resolve(ok), Promise.resolve(bad)]))
        .toEqual({ values: [2], errors: [expect.any(Missing)] });
    } finally {
      await dispose();
    }
  });
});
