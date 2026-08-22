import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { compileVibe } from "./compile.ts";
import { analyzeSource } from "./analyze.ts";
import { checkEmittedTypeScript } from "./validate.ts";
import { recoverVibeSyntax } from "./recover.ts";
import { __vsInspectResult } from "../runtime/index.ts";

function compileLabeled(source: string, name: string) {
  return compileVibe(source, {
    fileName: `${import.meta.dir}/${name}.vibe`,
    outputFileName: `${import.meta.dir}/${name}.generated.ts`,
    sourceName: `${name}.vibe`,
    runtimeImport: "../runtime/index.ts",
  });
}

async function executeLabeled(source: string, name: string) {
  const compiled = compileLabeled(source, name);
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(checkEmittedTypeScript(compiled.code, `${import.meta.dir}/${name}.generated.ts`)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  const executable = compileVibe(source, {
    fileName: `${import.meta.dir}/${name}.vibe`,
    outputFileName: `${import.meta.dir}/${name}.generated.ts`,
    sourceName: `${name}.vibe`,
    runtimeImport: pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  });
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "vibe-labeled-values-"));
  try {
    const modulePath = join(directory, `${name}.mjs`);
    await writeFile(modulePath, javascript);
    return { compiled, module: await import(pathToFileURL(modulePath).href) as Record<string, any> };
  } finally {
    await rm(directory, { recursive: true });
  }
}

test("labeled block values execute with typed joins and authored order", async () => {
  const { compiled, module } = await executeLabeled(`
    export const events: string[] = []
    function tag<T>(label: string, value: T): T {
      events.push(label)
      return value
    }
    function use(a: number, b: number, c: number): number { return a * 100 + b * 10 + c }
    export function classify(input: string): string {
      const kind = verdict: {
        if (input.length === 0) break :verdict "empty"
        if (input.length > 5) break :verdict "long"
        break :verdict "short"
      }
      return kind
    }
    export function viaReturn(k: number): number {
      return pick: {
        if (k > 0) break :pick k * 2;
        break :pick -k;
      }
    }
    export function inCall(k: number): number {
      return use(tag("first", 1), pick2: { if (k > 0) break :pick2 tag("pos", 2); break :pick2 tag("neg", 3) }, tag("last", 4))
    }
    export function nested(a: boolean, b: boolean): number {
      const x = outer: {
        const y = inner: { if (b) break :inner 1; break :inner 2 }
        if (a) break :outer y
        break :outer y + 10
      }
      return x
    }
    export function mixed(a: boolean, b: boolean): number {
      const x = pick3: {
        const y = if (b) { 20 } else { 30 }
        if (a) break :pick3 y
        break :pick3 y + 1
      }
      return x
    }
    export function returnTail(k: number): number {
      const x = pick4: {
        if (k > 0) break :pick4 k
        return -1
      }
      return x
    }
    export function innerLoop(values: number[]): number {
      const found = scan: {
        for (const value of values) {
          if (value % 2 === 0) break :scan value
        }
        break :scan -1
      }
      return found
    }
  `, "labeled-execution");

  // The inferred join stays a precise literal union in the emitted output.
  expect(compiled.code).toMatch(/let __vibe_label_value_\d+: "empty" \| "long" \| "short";/);

  expect(module.classify("")).toBe("empty");
  expect(module.classify("abcdefg")).toBe("long");
  expect(module.classify("ab")).toBe("short");
  expect(module.viaReturn(4)).toBe(8);
  expect(module.viaReturn(-3)).toBe(3);
  expect(module.inCall(1)).toBe(124);
  expect(module.events.splice(0)).toEqual(["first", "pos", "last"]);
  expect(module.inCall(-1)).toBe(134);
  expect(module.events.splice(0)).toEqual(["first", "neg", "last"]);
  expect(module.nested(true, true)).toBe(1);
  expect(module.nested(true, false)).toBe(2);
  expect(module.nested(false, true)).toBe(11);
  expect(module.mixed(true, true)).toBe(20);
  expect(module.mixed(false, false)).toBe(31);
  expect(module.returnTail(3)).toBe(3);
  expect(module.returnTail(-4)).toBe(-1);
  // An inner unlabeled loop break stays contained; the loop's completion
  // falls through to the explicit no-match value.
  expect(module.innerLoop([1, 3, 4])).toBe(4);
  expect(module.innerLoop([1, 3, 5])).toBe(-1);
});

test("Result exits propagate out of labeled block values", async () => {
  const { module } = await executeLabeled(`
    export const events: string[] = []
    class Missing extends Error {}
    function leaf(fail: boolean): Result<number, Missing> {
      events.push("leaf")
      if (fail) throw new Missing()
      return 5
    }
    export function attempt(fail: boolean): Result<number, Missing> {
      const value = compute: {
        const base = leaf(fail).unwrap()
        if (base > 3) break :compute base + 10
        break :compute base
      }
      return value
    }
  `, "labeled-exits");
  expect(__vsInspectResult(module.attempt(false) as any)).toMatchObject({ ok: true, value: 15 });
  expect(module.events.splice(0)).toEqual(["leaf"]);
  expect(__vsInspectResult(module.attempt(true) as any).ok).toBe(false);
  expect(module.events.splice(0)).toEqual(["leaf"]);
});

test("labeled join types are enforced against authored annotations", () => {
  const compiled = compileVibe(`
    function f(k: number): number {
      const value: number = pick: {
        if (k > 0) break :pick k
        break :pick "wrong"
      }
      return value
    }
  `, {
    fileName: "/virtual/labeled-annotated.vibe",
    outputFileName: "/virtual/labeled-annotated.ts",
  });
  expect(compiled.analysis.diagnostics).toEqual([]);
  const emitted = checkEmittedTypeScript(compiled.code, "/virtual/labeled-annotated.ts")
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  expect(emitted).toHaveLength(1);
  expect(emitted[0]).toContain("is not assignable to type 'number'");
});

test("unsafe labeled value shapes fail closed with stable diagnostics", () => {
  const codesOf = (source: string): readonly string[] =>
    analyzeSource(source).diagnostics.map((diagnostic) => diagnostic.code);

  // Falling off the block end without a value.
  expect(codesOf(`
    function f(k: number): number {
      const x = pick: {
        if (k > 0) break :pick 1
      }
      return x
    }
  `)).toContain("VIBE1714");
  // A plain labeled break completes without a value.
  expect(codesOf(`
    function f(k: number): number {
      const x = pick: {
        if (k > 0) break pick
        break :pick 1
      }
      return x
    }
  `)).toContain("VIBE1714");
  // A value break may not sit inside a nested function.
  expect(codesOf(`
    function f(k: number): number {
      const x = pick: {
        const inner = () => { break :pick 1 }
        break :pick 2
      }
      return x
    }
  `)).toContain("VIBE1714");
  // A jump may not escape the construct.
  expect(codesOf(`
    function f(values: number[]): number {
      for (const value of values) {
        const x = pick: {
          if (value > 0) continue
          break :pick value
        }
        return x
      }
      return 0
    }
  `)).toContain("VIBE1714");
  // Statement position has no value destination.
  expect(codesOf(`
    function f(k: number): void {
      pick: {
        if (k > 0) break :pick k
      }
    }
  `)).toContain("VIBE1714");
  // `break :label` requires a delimitable value expression.
  expect(codesOf(`
    function f(k: number): number {
      const x = pick: {
        if (k > 0) break :pick
        break :pick 1
      }
      return x
    }
  `)).toContain("VIBE1714");
  // Raw Result values keep the shared ownership gate.
  expect(codesOf(`
    declare function attempt(): Result<number, Error>
    function f(k: number) {
      const x = pick: {
        if (k > 0) break :pick attempt()
        break :pick attempt()
      }
      return x
    }
  `)).toContain("VIBE1706");
});

test("authored labels and ternary object literals are never reclassified", () => {
  const ternary = `declare const active: boolean
declare const base: { color: string }
export const style = active ? base : { color: "red" }
`;
  expect(recoverVibeSyntax(ternary).changed).toBe(false);
  const analysis = analyzeSource(ternary);
  expect(analysis.diagnostics).toEqual([]);
  const compiled = compileVibe(ternary);
  expect(compiled.code).toBe(ternary);

  // A labeled statement without value breaks keeps its existing diagnostic.
  const labeled = analyzeSource(`
    function f(k: number): void {
      work: { if (k > 0) break work }
    }
  `);
  expect(labeled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["VIBE1704"]);
});

test("labeled break values map exactly to authored positions", () => {
  const source = `export function classify(input: string): string {
  const kind = verdict: {
    if (input.length === 0) break :verdict "empty"
    break :verdict "other"
  }
  return kind
}
`;
  const compiled = compileVibe(source, {
    fileName: "/virtual/labeled-map.vibe",
    outputFileName: "/virtual/labeled-map.ts",
    sourceName: "labeled-map.vibe",
  });
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(compiled.sourceMap).toBeDefined();
  const map = JSON.parse(compiled.sourceMap!) as { sources: string[]; sourcesContent: string[]; mappings: string };
  expect(map.sources).toEqual(["labeled-map.vibe"]);
  expect(map.sourcesContent[0]).toBe(source);
  // The value literal survives verbatim in the emitted assignment.
  expect(compiled.code).toContain('"empty"');
  expect(compiled.code).toContain("break verdict;");
});
