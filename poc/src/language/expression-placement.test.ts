import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { compileSmithers } from "./compile.ts";
import { analyzeSource } from "./analyze.ts";
import { checkEmittedTypeScript, compileAndCheckProject } from "./validate.ts";
import { recoverSmithersSyntax } from "./recover.ts";
import { __vsInspectResult, __vsInspectOptional } from "../runtime/index.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((character, index) => [character, index]));

interface DecodedSegment {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly source?: number;
  readonly originalLine?: number;
  readonly originalColumn?: number;
}

function decodeVlq(text: string): readonly number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of text) {
    const digit = BASE64_VALUE.get(character)!;
    value += (digit & 31) * 2 ** shift;
    if ((digit & 32) !== 0) {
      shift += 5;
    } else {
      values.push((value & 1) === 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
      value = 0;
      shift = 0;
    }
  }
  return values;
}

function decodeMappings(wire: string): readonly DecodedSegment[] {
  const map = JSON.parse(wire) as { readonly mappings: string };
  const mappings: DecodedSegment[] = [];
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  for (const [generatedLine, line] of map.mappings.split(";").entries()) {
    let generatedColumn = 0;
    for (const encoded of line ? line.split(",") : []) {
      const values = decodeVlq(encoded);
      generatedColumn += values[0]!;
      if (values.length === 1) {
        mappings.push({ generatedLine, generatedColumn });
      } else {
        source += values[1]!;
        originalLine += values[2]!;
        originalColumn += values[3]!;
        mappings.push({ generatedLine, generatedColumn, source, originalLine, originalColumn });
      }
    }
  }
  return mappings;
}

function lineColumnAt(text: string, offset: number): { readonly line: number; readonly column: number } {
  const prefix = text.slice(0, offset).split(/\r\n|[\n\r\u2028\u2029]/);
  return { line: prefix.length - 1, column: prefix.at(-1)!.length };
}

function mappedOriginal(
  wire: string,
  generatedCode: string,
  generatedOffset: number,
): { readonly line: number; readonly column: number } | undefined {
  const generated = lineColumnAt(generatedCode, generatedOffset);
  const selected = decodeMappings(wire).filter((mapping) =>
    mapping.generatedLine === generated.line && mapping.generatedColumn <= generated.column).at(-1);
  if (selected?.originalLine === undefined || selected.originalColumn === undefined) return undefined;
  return {
    line: selected.originalLine,
    column: selected.originalColumn + (generated.column - selected.generatedColumn),
  };
}

function compilePlacement(source: string, name: string) {
  const compiled = compileSmithers(source, {
    fileName: `${import.meta.dir}/${name}.sm`,
    outputFileName: `${import.meta.dir}/${name}.generated.ts`,
    sourceName: `${name}.sm`,
    runtimeImport: "../runtime/index.ts",
  });
  return compiled;
}

async function executePlacement(source: string, name: string) {
  const compiled = compilePlacement(source, name);
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
  const directory = await mkdtemp(join(tmpdir(), "smithers-expression-placement-"));
  try {
    const modulePath = join(directory, `${name}.mjs`);
    await writeFile(modulePath, javascript);
    return { compiled, module: await import(pathToFileURL(modulePath).href) as Record<string, any> };
  } finally {
    await rm(directory, { recursive: true });
  }
}

test("general if/switch placement executes once with authored evaluation order", async () => {
  const { module } = await executePlacement(`
    export const events: string[] = []
    function tag<T>(label: string, value: T): T {
      events.push(label)
      return value
    }
    function use(a: number, b: number, c: number): number { return a * 100 + b * 10 + c }

    export function callArgs(active: boolean): number {
      return use(tag("first", 1), if (active) { tag("then", 2) } else { tag("else", 3) }, tag("last", 4))
    }
    export let shared = 0
    export function branchMutatesLater(active: boolean): number {
      shared = 0
      return use(tag("m-first", 1), if (active) { shared = 7; 2 } else { 2 }, shared)
    }
    export function identifierReadsEarly(active: boolean): number {
      let local = 1
      const result = use(local, if (active) { local = 9; 2 } else { 2 }, 0)
      return result
    }
    export function literals(active: boolean): number {
      const list = [tag("a-first", 1), if (active) { 2 } else { 3 }, tag("a-last", 4)]
      const first = tag("o-short", 5)
      const object = { first, pick: if (active) { 6 } else { 7 }, last: tag("o-last", 8) }
      return list[1]! * 100 + object.first * 10 + object.pick
    }
    export const conciseArrow = (active: boolean): string => if (active) { "yes" } else { "no" }
    export const deepArrow = (active: boolean): number => use(1, if (active) { 2 } else { 3 }, 4)
    export function nestedInitializer(active: boolean): number {
      const doubled = 2 * (if (active) { tag("n-then", 3) } else { tag("n-else", 4) })
      return doubled
    }
    export function returnAdjacent(active: boolean): number {
      return (
        if (active) { 21 } else { 42 }
      )
    }
    export function nestedConstructs(outer: boolean, inner: boolean): number {
      return use(1, if (outer) { use(0, if (inner) { tag("inner-then", 5) } else { tag("inner-else", 6) }, 0) } else { tag("outer-else", 7) }, 2)
    }
    export function conditionHost(active: boolean, inner: boolean): string {
      const chosen = if (use(0, if (inner) { tag("cond-inner", 1) } else { 0 }, 0) > 0 && active) { "both" } else { "not" }
      return chosen
    }
    export function switchArg(kind: string): number {
      return use(tag("s-first", 1), switch (kind) { case "one": tag("s-one", 2); default: tag("s-default", 3) }, tag("s-last", 4))
    }
    export function multiDeclarator(active: boolean): number {
      const base = 1, picked = use(7, if (active) { 5 } else { 6 }, 0)
      return base + picked
    }
    class Chooser {
      choose(value: number): number { return value + 1 }
      run(active: boolean): number { return this.choose(if (active) { 10 } else { 20 }) }
    }
    export const chooser = new Chooser()
  `, "placement-execution");

  expect(module.callArgs(true)).toBe(124);
  expect(module.events.splice(0)).toEqual(["first", "then", "last"]);
  expect(module.callArgs(false)).toBe(134);
  expect(module.events.splice(0)).toEqual(["first", "else", "last"]);

  // The construct's branch runs before later sibling arguments evaluate.
  expect(module.branchMutatesLater(true)).toBe(127);
  module.events.splice(0);

  // An identifier operand before the construct reads its authored-time value.
  expect(module.identifierReadsEarly(true)).toBe(120);

  expect(module.literals(false)).toBe(357);
  expect(module.events.splice(0)).toEqual(["a-first", "a-last", "o-short", "o-last"]);

  expect(module.conciseArrow(true)).toBe("yes");
  expect(module.conciseArrow(false)).toBe("no");
  expect(module.deepArrow(false)).toBe(134);

  expect(module.nestedInitializer(true)).toBe(6);
  expect(module.events.splice(0)).toEqual(["n-then"]);

  expect(module.returnAdjacent(false)).toBe(42);

  expect(module.nestedConstructs(true, false)).toBe(702);
  expect(module.events.splice(0)).toEqual(["inner-else"]);
  expect(module.nestedConstructs(false, true)).toBe(172);
  expect(module.events.splice(0)).toEqual(["outer-else"]);

  expect(module.conditionHost(true, true)).toBe("both");
  expect(module.events.splice(0)).toEqual(["cond-inner"]);

  expect(module.switchArg("one")).toBe(124);
  expect(module.events.splice(0)).toEqual(["s-first", "s-one", "s-last"]);
  expect(module.switchArg("other")).toBe(134);
  expect(module.events.splice(0)).toEqual(["s-first", "s-default", "s-last"]);

  expect(module.multiDeclarator(true)).toBe(751);
  expect(module.chooser.run(false)).toBe(21);
});

test("Result and Optional exits propagate out of general placements", async () => {
  const { module } = await executePlacement(`
    export const events: string[] = []
    class Missing extends Error {}
    function leaf(fail: boolean): Result<number, Missing> {
      events.push("leaf")
      if (fail) throw new Missing()
      return 5
    }
    function tag<T>(label: string, value: T): T {
      events.push(label)
      return value
    }
    function use(a: number, b: number, c: number): number { return a + b + c }
    export function resultPlacement(active: boolean, fail: boolean): Result<number, Missing> {
      return use(tag("before", 1), if (active) { leaf(fail).unwrap() } else { 0 }, tag("after", 2))
    }
    function find(present: boolean): Optional<number> {
      return present ? Optional.fromNullable(7) : Optional.fromNullable<number>(null)
    }
    export function optionalPlacement(present: boolean): Optional<number> {
      return use(tag("o-before", 1), if (present) { find(present).unwrap() } else { 0 }, tag("o-after", 2))
    }
    export function optionalAbsent(): Optional<number> {
      return use(tag("x-before", 1), if (true) { find(false).unwrap() } else { 0 }, tag("x-after", 2))
    }
  `, "placement-exits");

  expect(__vsInspectResult(module.resultPlacement(true, false) as any)).toMatchObject({ ok: true, value: 8 });
  expect(module.events.splice(0)).toEqual(["before", "leaf", "after"]);
  const failed = __vsInspectResult(module.resultPlacement(true, true) as any);
  expect(failed.ok).toBe(false);
  // The failing unwrap exits before later sibling operands can run.
  expect(module.events.splice(0)).toEqual(["before", "leaf"]);

  expect(__vsInspectOptional(module.optionalPlacement(true) as any)).toMatchObject({ some: true, value: 10 });
  expect(module.events.splice(0)).toEqual(["o-before", "o-after"]);
  expect(__vsInspectOptional(module.optionalAbsent() as any)).toMatchObject({ some: false });
  expect(module.events.splice(0)).toEqual(["x-before"]);
});

test("order-unsafe placements fail closed with stable diagnostics", () => {
  const codesOf = (source: string): readonly string[] =>
    analyzeSource(source).diagnostics.map((diagnostic) => diagnostic.code);

  expect(codesOf(`
    function f(active: boolean, gate: number) { const x = gate && (if (active) { 1 } else { 2 }); return x }
  `)).toContain("SMITHERS1707");
  expect(codesOf(`
    function f(active: boolean, pick: boolean) { const x = pick ? (if (active) { 1 } else { 2 }) : 3; return x }
  `)).toContain("SMITHERS1707");
  expect(codesOf(`
    function f(active: boolean) { while (use(if (active) { 1 } else { 0 })) { break } }
    declare function use(v: number): boolean
  `)).toContain("SMITHERS1707");
  expect(codesOf(`
    function f(active: boolean, xs: number[]) { use(...xs, if (active) { 1 } else { 2 }) }
    declare function use(...values: number[]): void
  `)).toContain("SMITHERS1707");
  expect(codesOf(`
    function f(active: boolean) { let x = 1; x += use(if (active) { 1 } else { 2 }); return x }
    declare function use(v: number): number
  `)).toContain("SMITHERS1707");
  expect(codesOf(`
    function f(active: boolean) {
      defer use(if (active) { 1 } else { 2 })
      work()
    }
    declare function use(v: number): void
    declare function work(): void
  `)).toContain("SMITHERS1707");
  expect(codesOf(`
    function f(active: boolean, effect: () => number) {
      const first = effect(), second = use(if (active) { 1 } else { 2 })
      return first + second
    }
    declare function use(v: number): number
  `)).toContain("SMITHERS1707");
  expect(codesOf(`
    function f(active: boolean) {
      const first = 1, second = use(if (active) { first } else { 2 })
      return second
    }
    declare function use(v: number): number
  `)).toContain("SMITHERS1707");
  // A hoisted sibling operand may not read a name the statement declares.
  expect(codesOf(`
    function f(active: boolean) {
      const first = 1, second = use(first, if (active) { 2 } else { 3 })
      return second
    }
    declare function use(a: number, b: number): number
  `)).toContain("SMITHERS1707");

  // Callee stability is verified, not assumed.
  expect(codesOf(`
    let handler = (value: number): number => value
    export function swap(): void { handler = (value) => value * 2 }
    function f(active: boolean) { const x = handler(if (active) { 1 } else { 2 }); return x }
  `)).toContain("SMITHERS1708");
  expect(codesOf(`
    const api: { run: (value: number) => number } = { run: (value) => value }
    function f(active: boolean) { const x = api.run(if (active) { 1 } else { 2 }); return x }
  `)).toContain("SMITHERS1708");

  // Braced branches are required in general expression positions.
  expect(codesOf(`
    function f(active: boolean) { use(if (active) 1 else 2) }
    declare function use(v: number): void
  `)).toContain("SMITHERS1709");

  // Placements recovery does not attempt keep the existing fail-closed code.
  expect(codesOf(`
    function f(active: boolean) { let x = 0; x = if (active) { 1 } else { 2 }; return x }
  `)).toContain("SMITHERS1702");
});

test("statement-position keywords after case labels stay valid and byte-identical", () => {
  const source = `declare const foo: number
declare function use(v: number): void
export function f(k: number): void {
  switch (k) { case foo: if (k) { use(k) } }
  branch: if (k) { use(k) }
}
`;
  const recovery = recoverSmithersSyntax(source);
  expect(recovery.changed).toBe(false);
  expect(recovery.diagnostics).toEqual([]);
  const analysis = analyzeSource(source);
  // The label still receives its own diagnostic; the statement `if` after
  // `case foo:` must not be misclassified as a value expression.
  expect(analysis.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["SMITHERS1704"]);

  const caseOnly = `declare const foo: number
declare function use(v: number): void
export function f(k: number): void {
  switch (k) { case foo: if (k) { use(k) } }
}
`;
  const compiled = compileSmithers(caseOnly);
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(compiled.code).toBe(caseOnly);
});

test("diagnostics inside moved constructs report authored positions", () => {
  const source = `declare function task(): Promise<number>
declare function use(v: unknown): void
async function f(active: boolean) {
  use(if (active) { task() } else { task() })
}
`;
  const analysis = analyzeSource(source);
  const ownership = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1706");
  expect(ownership).toHaveLength(2);
  const firstTask = source.indexOf("task()", source.indexOf("if (active)"));
  expect(ownership[0]!.start).toBe(firstTask);
  expect(ownership[0]!.line).toBe(4);
  expect(ownership[0]!.column).toBe(source.slice(source.lastIndexOf("\n", firstTask) + 1, firstTask).length + 1);
});

test("composed source maps keep authored provenance and leave glue unmapped", () => {
  const source = `declare function tag(label: string, value: number): number
declare function use(a: number, b: number, c: number): number
export function f(active: boolean): number {
  return use(tag("first", 1), if (active) { tag("then", 2) } else { tag("else", 3) }, tag("last", 4))
}
`;
  const compiled = compilePlacement(source, "placement-map");
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(compiled.sourceMap).toBeDefined();
  const map = JSON.parse(compiled.sourceMap!) as { sources: string[]; sourcesContent: string[] };
  expect(map.sources).toEqual(["placement-map.sm"]);
  expect(map.sourcesContent[0]).toBe(source);

  // The moved branch value text maps exactly to its authored location.
  const generatedThen = compiled.code.indexOf('tag("then", 2)');
  const authoredThen = source.indexOf('tag("then", 2)');
  expect(generatedThen).toBeGreaterThan(-1);
  expect(mappedOriginal(compiled.sourceMap!, compiled.code, generatedThen))
    .toEqual(lineColumnAt(source, authoredThen));

  // An untouched declaration keeps exact provenance too.
  const generatedDeclare = compiled.code.indexOf("declare function tag");
  expect(mappedOriginal(compiled.sourceMap!, compiled.code, generatedDeclare))
    .toEqual(lineColumnAt(source, source.indexOf("declare function tag")));

  // Compiler glue (the hoisted temporary declaration keyword) is unmapped
  // instead of inheriting a misleading nearby authored position.
  const hoistedConst = compiled.code.indexOf("const __smithers_operand");
  expect(hoistedConst).toBeGreaterThan(-1);
  expect(mappedOriginal(compiled.sourceMap!, compiled.code, hoistedConst)).toBeUndefined();
});

test("template substitutions never skew downstream construct recognition", () => {
  // Regression: the naive scanner treated the text after a `${...}`
  // substitution as raw tokens, deriving a phantom template that swallowed
  // the rest of the file and broke every later token-based check.
  const analysis = analyzeSource(`
    class Wrapped extends Error {
      constructor(readonly value: number) { super(\`value \${value} out of range\`) }
    }
    export function pick(active: boolean): number {
      return use(1, if (active) { 2 } else { 3 })
    }
    declare function use(a: number, b: number): number
  `);
  expect(analysis.diagnostics).toEqual([]);
});

test("the expression-flow example compiles, checks, and executes", async () => {
  const source = await Bun.file(`${import.meta.dir}/../../examples/language/expression-flow.sm`).text();
  const { compiled, module } = await executePlacement(source, "expression-flow-example");
  expect(compiled.code).toContain("let __smithers_");
  expect(module.describe("retry")).toBe("resit scheduled");
  expect(__vsInspectResult(module.weighted(50, true) as any)).toMatchObject({ ok: true, value: 60 });
  expect(__vsInspectResult(module.weighted(500, true) as any).ok).toBe(false);
  expect(module.classify("")).toBe("empty");
  expect(module.classify("abcdefghij")).toBe("long");
  expect(module.firstPassing([40, 75, 90])).toBe(75);
  expect(module.firstPassing([10, 20])).toBe(-1);
});

test("project compilation lowers general placements across modules", () => {
  const checked = compileAndCheckProject([
    {
      fileName: "choice.sm",
      source: `export function choose(active: boolean): number {
  return combine(1, if (active) { 2 } else { 3 }, 4)
}
function combine(a: number, b: number, c: number): number { return a + b + c }
`,
    },
    {
      fileName: "main.sm",
      source: `import { choose } from "./choice.sm"
export function main(): number { return choose(true) }
`,
    },
  ], { rootDir: "/virtual/project", outDir: "/virtual/project/out" });
  expect(checked.result.diagnostics).toEqual([]);
  expect(checked.emitDiagnostics).toEqual([]);
  expect(checked.ok).toBe(true);
  expect(checked.result.files["choice.sm"]!.code).toContain("let __smithers_if_value_");
});
