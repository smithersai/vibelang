import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { compileSmithers } from "./compile.ts";
import { analyzeSource } from "./analyze.ts";
import { checkEmittedTypeScript } from "./validate.ts";
import { __vsInspectResult } from "../runtime/index.ts";

async function executeLoops(source: string, name: string) {
  const compiled = compileSmithers(source, {
    fileName: `${import.meta.dir}/${name}.sm`,
    outputFileName: `${import.meta.dir}/${name}.generated.ts`,
    sourceName: `${name}.sm`,
    runtimeImport: "../runtime/index.ts",
  });
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(checkEmittedTypeScript(compiled.code, `${import.meta.dir}/${name}.generated.ts`)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  const executable = compileSmithers(source, {
    fileName: `${import.meta.dir}/${name}.sm`,
    outputFileName: `${import.meta.dir}/${name}.generated.ts`,
    sourceName: `${name}.sm`,
    runtimeImport: pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  });
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "smithers-loop-values-"));
  try {
    const modulePath = join(directory, `${name}.mjs`);
    await writeFile(modulePath, javascript);
    return { compiled, module: await import(pathToFileURL(modulePath).href) as Record<string, any> };
  } finally {
    await rm(directory, { recursive: true });
  }
}

test("loop expression values execute as runtime loops with break and else paths", async () => {
  const { compiled, module } = await executeLoops(`
    export const events: string[] = []
    function tag<T>(label: string, value: T): T {
      events.push(label)
      return value
    }
    function use(a: number, b: number, c: number): number { return a * 100 + b * 10 + c }
    export function firstEven(values: number[]): number {
      const found = search: for (const value of values) {
        if (value % 2 === 0) break :search value
      } else -1
      return found
    }
    export function whileForm(limit: number): string {
      let count = 0
      const verdict = scan: while (count < limit) {
        count = count + 1
        if (count === 3) break :scan "three"
      } else "none"
      return verdict
    }
    export function inCall(values: number[]): number {
      return use(tag("before", 1), pick: for (const v of values) { events.push("step:" + v); if (v > 10) break :pick v } else 0, tag("after", 2))
    }
    export function plainBreakFallsToElse(values: number[]): number {
      const found = quest: for (const v of values) {
        if (v < 0) break quest
        if (v > 100) break :quest v
      } else -5
      return found
    }
    export function continueKeepsScanning(values: number[]): number {
      const found = filter: for (const v of values) {
        if (v % 2 === 1) continue
        break :filter v
      } else -7
      return found
    }
    export function elseOnly(values: number[]): number {
      let total = 0
      const result = sum: for (const v of values) {
        total = total + v
      } else total
      return result
    }
  `, "loop-execution");

  // Runtime-sized loops stay ordinary runtime loops; nothing unrolls.
  expect(compiled.code).toContain("for (const value of values)");
  expect(compiled.code).toMatch(/let __smithers_loop_value_\d+: "three" \| "none";/);

  expect(module.firstEven([1, 3, 4])).toBe(4);
  expect(module.firstEven([1, 3, 5])).toBe(-1);
  expect(module.whileForm(5)).toBe("three");
  expect(module.whileForm(2)).toBe("none");
  expect(module.inCall([2, 30])).toBe(402);
  expect(module.events.splice(0)).toEqual(["before", "step:2", "step:30", "after"]);
  expect(module.inCall([1, 2])).toBe(102);
  expect(module.events.splice(0)).toEqual(["before", "step:1", "step:2", "after"]);
  expect(module.plainBreakFallsToElse([1, -2, 300])).toBe(-5);
  expect(module.plainBreakFallsToElse([1, 2, 300])).toBe(300);
  expect(module.continueKeepsScanning([1, 3, 6])).toBe(6);
  expect(module.continueKeepsScanning([1, 3, 5])).toBe(-7);
  // A loop with no value breaks still has a defined else completion value.
  expect(module.elseOnly([1, 2, 3])).toBe(6);
});

test("Result exits propagate out of loop expression bodies", async () => {
  const { module } = await executeLoops(`
    export const events: string[] = []
    class Missing extends Error {}
    function leaf(value: number, fail: boolean): Result<number, Missing> {
      events.push("leaf:" + value)
      if (fail) throw new Missing()
      return value * 10
    }
    export function hunt(values: number[], fail: boolean): Result<number, Missing> {
      const found = quest: for (const v of values) {
        const scaled = leaf(v, fail).unwrap()
        if (scaled > 20) break :quest scaled
      } else -1
      return found
    }
  `, "loop-exits");
  expect(__vsInspectResult(module.hunt([1, 3], false) as any)).toMatchObject({ ok: true, value: 30 });
  expect(module.events.splice(0)).toEqual(["leaf:1", "leaf:3"]);
  expect(__vsInspectResult(module.hunt([1, 3], true) as any).ok).toBe(false);
  expect(module.events.splice(0)).toEqual(["leaf:1"]);
});

test("unsafe loop value shapes fail closed with stable diagnostics", () => {
  const codesOf = (source: string): readonly string[] =>
    analyzeSource(source).diagnostics.map((diagnostic) => diagnostic.code);

  // A value loop requires an else completion value.
  expect(codesOf(`
    function f(values: number[]): number {
      const found = search: for (const v of values) {
        if (v > 0) break :search v
      }
      return found
    }
  `)).toContain("SMITHERS1715");
  // The else needs a delimitable value expression.
  expect(codesOf(`
    function f(values: number[]): number {
      const found = search: for (const v of values) {
        if (v > 0) break :search v
      } else
      return found
    }
  `)).toContain("SMITHERS1715");
  // Statement position has no value destination: the label diagnostic and
  // the stray value-break diagnostic both fail the compile.
  const statementPosition = codesOf(`
    function f(values: number[]): void {
      search: for (const v of values) {
        if (v > 0) break :search v
      } else 0
    }
  `);
  expect(statementPosition).toContain("SMITHERS1704");
  expect(statementPosition).toContain("SMITHERS1714");
  // A value break may not sit inside a nested function.
  expect(codesOf(`
    function f(values: number[]): number {
      const found = search: for (const v of values) {
        const g = () => { break :search v }
        break :search v
      } else -1
      return found
    }
  `)).toContain("SMITHERS1715");
  // A jump may not escape the construct.
  expect(codesOf(`
    function f(values: number[]): number {
      outerLoop: for (const first of values) {
        const found = search: for (const v of values) {
          if (v > first) continue outerLoop
          break :search v
        } else -1
        return found
      }
      return 0
    }
  `)).toContain("SMITHERS1715");
  // Raw Result values keep the shared ownership gate.
  expect(codesOf(`
    declare function attempt(): Result<number, Error>
    function f(values: number[]) {
      const found = search: for (const v of values) {
        if (v > 0) break :search attempt()
      } else attempt()
      return found
    }
  `)).toContain("SMITHERS1706");
});

test("ordinary labeled loops without value syntax keep existing behavior", () => {
  const analysis = analyzeSource(`
    function f(values: number[]): number {
      let last = 0
      walk: for (const v of values) {
        if (v < 0) break walk
        last = v
      }
      return last
    }
  `);
  expect(analysis.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["SMITHERS1704"]);
});
