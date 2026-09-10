import { expect, test } from "bun:test";
import { getNativeCompiler } from "../compiler/native.ts";
import { compileVibeLang } from "./compile.ts";
import { compileProject } from "./project-compile.ts";
import { composeSourceMaps, createPreciseSourceMap, originalPosition } from "./source-map.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((character, index) => [character, index]));

interface DecodedSegment {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly source?: number;
  readonly originalLine?: number;
  readonly originalColumn?: number;
}

interface DecodedMap {
  readonly version: number;
  readonly file?: string;
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly (string | null)[];
  readonly mappings: string;
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

function decodeSourceMap(wire: string): { readonly map: DecodedMap; readonly mappings: readonly DecodedSegment[] } {
  const map = JSON.parse(wire) as DecodedMap;
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
  return { map, mappings };
}

function lineColumnAt(text: string, offset: number): { readonly line: number; readonly column: number } {
  const prefix = text.slice(0, offset).split(/\r\n|[\n\r\u2028\u2029]/);
  return { line: prefix.length - 1, column: prefix.at(-1)!.length };
}

function mappedPosition(wire: string, generatedCode: string, generatedOffset: number):
  { readonly source: string; readonly line: number; readonly column: number } | undefined {
  const decoded = decodeSourceMap(wire);
  const generated = lineColumnAt(generatedCode, generatedOffset);
  const selected = decoded.mappings.filter((mapping) =>
    mapping.generatedLine === generated.line && mapping.generatedColumn <= generated.column).at(-1);
  if (selected?.source === undefined || selected.originalLine === undefined || selected.originalColumn === undefined) {
    return undefined;
  }
  return {
    source: decoded.map.sources[selected.source]!,
    line: selected.originalLine,
    column: selected.originalColumn,
  };
}

function expectExact(
  wire: string,
  generatedCode: string,
  generatedOffset: number,
  sourceName: string,
  source: string,
  originalOffset: number,
): void {
  expect(mappedPosition(wire, generatedCode, generatedOffset)).toEqual({
    source: sourceName,
    ...lineColumnAt(source, originalOffset),
  });
}

function encodeVlq(value: number): string {
  let current = Math.abs(value) * 2 + (value < 0 ? 1 : 0);
  let result = "";
  do {
    let digit = current % 32;
    current = Math.floor(current / 32);
    if (current > 0) digit += 32;
    result += BASE64[digit];
  } while (current > 0);
  return result;
}

function encodeTestMappings(mappings: readonly DecodedSegment[]): string {
  const maximumLine = mappings.at(-1)?.generatedLine ?? 0;
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  const lines: string[] = [];
  for (let line = 0; line <= maximumLine; line++) {
    let generatedColumn = 0;
    const segments: string[] = [];
    for (const mapping of mappings.filter((value) => value.generatedLine === line)) {
      let segment = encodeVlq(mapping.generatedColumn - generatedColumn);
      generatedColumn = mapping.generatedColumn;
      if (mapping.source !== undefined && mapping.originalLine !== undefined && mapping.originalColumn !== undefined) {
        segment += encodeVlq(mapping.source - source) + encodeVlq(mapping.originalLine - originalLine) +
          encodeVlq(mapping.originalColumn - originalColumn);
        source = mapping.source;
        originalLine = mapping.originalLine;
        originalColumn = mapping.originalColumn;
      }
      segments.push(segment);
    }
    lines.push(segments.join(","));
  }
  return lines.join(";");
}

test("single-coordinate lookup preserves offsets, source roots and unmapped glue", () => {
  const wire = JSON.stringify({ version: 3, sources: ["flow.vibe"], sourceRoot: "src", names: [],
    mappings: encodeTestMappings([
      { generatedLine: 0, generatedColumn: 3, source: 0, originalLine: 2, originalColumn: 8 },
      { generatedLine: 0, generatedColumn: 9 },
      { generatedLine: 2, generatedColumn: 0, source: 0, originalLine: 4, originalColumn: 1 },
    ]),
  });
  expect(originalPosition(wire, 0, 2)).toBeUndefined();
  expect(originalPosition(wire, 0, 5)).toEqual({ source: "src/flow.vibe", line: 2, column: 10 });
  expect(originalPosition(wire, 0, 9)).toBeUndefined();
  expect(originalPosition(wire, 1, 3)).toBeUndefined();
  expect(originalPosition(wire, 2, 0)).toEqual({ source: "src/flow.vibe", line: 4, column: 1 });
  for (const coordinate of [-1, 0.5, NaN, Infinity]) {
    expect(() => originalPosition(wire, coordinate, 0)).toThrow(TypeError);
    expect(() => originalPosition(wire, 0, coordinate)).toThrow(TypeError);
  }
  expect(() => originalPosition("{}", 0, 0)).toThrow(TypeError);
});

test("emits deterministic exact identity mappings for unchanged source", () => {
  const source = [
    "export const alpha = 1",
    "",
    "export function add(left: number, right: number): number {",
    "  return left + right",
    "}",
    "",
  ].join("\n");
  const options = {
    fileName: "/virtual/identity.vibe",
    outputFileName: "/virtual/identity.generated.ts",
    sourceName: "src/identity.vibe",
  } as const;
  const first = compileVibeLang(source, options);
  const second = compileVibeLang(source, options);

  expect(first.code).toBe(source);
  expect(first.sourceMap).toBe(second.sourceMap);
  const decoded = decodeSourceMap(first.sourceMap!);
  expect(decoded.map).toMatchObject({
    version: 3,
    file: "identity.generated.ts",
    sources: ["src/identity.vibe"],
    sourcesContent: [source],
  });
  for (let offset = 0; offset < source.length; offset++) {
    if (!/[\n\r\u2028\u2029]/.test(source[offset]!)) {
      expectExact(first.sourceMap!, first.code, offset, "src/identity.vibe", source, offset);
    }
  }
});

test("rejects retired .? on a nullable call without claiming invalid source-map provenance", () => {
  const source = [
    "function lookup(id: number): string | undefined { return id === 1 ? \"Ada\" : undefined }",
    "export function main(): string[] {",
    "  const name = lookup(1).?",
    "  return [name]",
    "}",
    "",
  ].join("\n");
  const result = compileVibeLang(source, {
    fileName: "/virtual/retired-dot-question.vibe",
    outputFileName: "/virtual/retired-dot-question.generated.ts",
    sourceName: "src/retired-dot-question.vibe",
  });

  expect(result.analysis.diagnostics.map(({ code, line, column }) => ({ code, line, column }))).toContainEqual({
    code: "VIBE1001",
    line: 3,
    column: 25,
  });
  expect(result.sourceMap).toBeUndefined();
});

test("maps transformed tokens exactly and leaves generated delimiter helpers unmapped", () => {
  const source = [
    "class Failure extends Error {}",
    "function leaf(",
    "  value: number,",
    "): Result<number, Failure> {",
    "  if (value < 0) throw new Failure()",
    "  return value",
    "}",
    "export function run(",
    "  value: number,",
    "): Result<number, Failure> {",
    "  const unwrapped = leaf(",
    "    value,",
    "  )!",
    "  return unwrapped",
    "}",
    "",
  ].join("\n");
  const result = compileVibeLang(source, {
    fileName: "/virtual/transformed.vibe",
    outputFileName: "/virtual/transformed.generated.ts",
    sourceName: "src/transformed.vibe",
    runtimeImport: "vibelang/runtime",
  });
  const wire = result.sourceMap!;

  const helperImport = result.code.indexOf("__vsResultSuccess");
  expect(helperImport).toBeGreaterThan(0);
  expect(mappedPosition(wire, result.code, helperImport)).toBeUndefined();
  const success = result.code.lastIndexOf("return __vsResultSuccess(unwrapped)");
  expectExact(wire, result.code, success, "src/transformed.vibe", source, source.lastIndexOf("return unwrapped"));
  expect(mappedPosition(wire, result.code, success + "return ".length)).toBeUndefined();
  expectExact(
    wire,
    result.code,
    success + "return __vsResultSuccess(".length,
    "src/transformed.vibe",
    source,
    source.lastIndexOf("unwrapped"),
  );

  const failure = result.code.indexOf("return __vsResultFailure(new Failure())");
  expectExact(wire, result.code, failure, "src/transformed.vibe", source, source.indexOf("throw new Failure()"));
  expect(mappedPosition(wire, result.code, failure + "return ".length)).toBeUndefined();
  expectExact(
    wire,
    result.code,
    failure + "return __vsResultFailure(".length,
    "src/transformed.vibe",
    source,
    source.indexOf("new Failure()"),
  );

  const propagation = result.code.lastIndexOf("__vsPropagate(");
  expect(propagation).toBeGreaterThan(0);
  expect(mappedPosition(wire, result.code, propagation)).toBeUndefined();
  const inspectedLeaf = result.code.indexOf("leaf(", propagation);
  expectExact(wire, result.code, inspectedLeaf, "src/transformed.vibe", source, source.indexOf("leaf(\n", source.indexOf("const unwrapped")));
  const inspectedArgument = result.code.indexOf("value", inspectedLeaf);
  expectExact(wire, result.code, inspectedArgument, "src/transformed.vibe", source, source.indexOf("value,", source.indexOf("const unwrapped")));
});

test("anchors rewritten import tokens without claiming rewritten columns", () => {
  const source = 'import { value } from "./dep.vibe"\nexport const result = value\n';
  const compiled = compileProject([{fileName:"src/main.vibe",source}, {fileName:"src/dep.vibe",source:"export const value = 42"}], {
    rootDir:"/virtual/project", outDir:"/virtual/project/dist",
  });
  expect(compiled.diagnostics).toEqual([]);
  const result = compiled.files["src/main.vibe"]!;
  const rewritten = result.code.indexOf('"./dep.ts"');
  expect(rewritten).toBeGreaterThan(0);
  expectExact(result.sourceMap!, result.code, rewritten, "src/main.vibe", source, source.indexOf('"./dep.vibe"'));
  expectExact(result.sourceMap!, result.code, rewritten + 1, "src/main.vibe", source, source.indexOf('"./dep.vibe"') + 1);
  expectExact(result.sourceMap!, result.code, rewritten + 6, "src/main.vibe", source, source.indexOf('"./dep.vibe"') + 6);
  expect(mappedPosition(result.sourceMap!, result.code, rewritten + 7)).toBeUndefined();
  expectExact(result.sourceMap!, result.code, result.code.indexOf("value"), "src/main.vibe", source, source.indexOf("value"));
});

test("composes emitted JavaScript locations back to authored .vibe source", () => {
  const source = `class Failure extends Error {}\nexport function value(): Result<number, Failure> { return 1 }\n`;
  const lowered = compileVibeLang(source, {
    fileName: "/virtual/source.vibe",
    outputFileName: "/virtual/output.mjs",
    sourceName: "src/source.vibe",
    runtimeImport: "vibelang/runtime",
  });
  const javascript = getNativeCompiler().transpile({
    files: [{path:"output.mjs.ts",text:lowered.code}],
    options: {
      target: "es2022",
      module: "esnext",
      sourceMap: true,
      inlineSources: true,
    },
  }).files[0]!;
  expect(javascript.emitSkipped).toBe(false);
  expect(javascript.diagnostics).toEqual([]);
  const composedWire = composeSourceMaps(
    javascript.sourceMap,
    lowered.sourceMap!,
    "/virtual/output.mjs",
  );
  const composed = JSON.parse(composedWire) as {
    version: number;
    file: string;
    sources: string[];
    sourcesContent: string[];
    mappings: string;
  };

  expect(composed).toMatchObject({
    version: 3,
    file: "output.mjs",
    sources: ["src/source.vibe"],
    sourcesContent: [source],
  });
  expect(composed.mappings.length).toBeGreaterThan(0);
  const helper = javascript.javascript.lastIndexOf("__vsResultSuccess");
  expect(mappedPosition(composedWire, javascript.javascript, helper)).toBeUndefined();
  const generatedValue = javascript.javascript.indexOf("1", helper);
  expectExact(
    composedWire,
    javascript.javascript,
    generatedValue,
    "src/source.vibe",
    source,
    source.lastIndexOf("1"),
  );
  expect(() => composeSourceMaps("{}", lowered.sourceMap!, "bad.mjs")).toThrow(
    "unsupported version-3 shape",
  );
});

test("composition preserves comptime-style cross-file sourcesContent and unmapped stops", () => {
  const inner = JSON.stringify({
    version: 3,
    file: "intermediate.ts",
    sourceRoot: "",
    sources: ["main.vibe", "config.vibe"],
    sourcesContent: ["main authored", "config authored"],
    names: [],
    mappings: encodeTestMappings([
      { generatedLine: 0, generatedColumn: 0, source: 0, originalLine: 0, originalColumn: 0 },
      { generatedLine: 0, generatedColumn: 4 },
      { generatedLine: 0, generatedColumn: 8, source: 1, originalLine: 0, originalColumn: 2 },
    ]),
  });
  const outer = JSON.stringify({
    version: 3,
    file: "output.js",
    sourceRoot: "",
    sources: ["intermediate.ts", "vendor.ts"],
    sourcesContent: ["intermediate generated", "vendor authored"],
    names: [],
    mappings: encodeTestMappings([
      { generatedLine: 0, generatedColumn: 0, source: 0, originalLine: 0, originalColumn: 0 },
      { generatedLine: 0, generatedColumn: 4, source: 0, originalLine: 0, originalColumn: 4 },
      { generatedLine: 0, generatedColumn: 8, source: 0, originalLine: 0, originalColumn: 8 },
      { generatedLine: 0, generatedColumn: 12, source: 1, originalLine: 0, originalColumn: 1 },
      { generatedLine: 0, generatedColumn: 16 },
    ]),
  });
  const code = "abcdefghijklmnopq";
  const composed = composeSourceMaps(outer, inner, "/virtual/output.js");
  const decoded = decodeSourceMap(composed);

  expect(decoded.map.sources).toEqual(["main.vibe", "config.vibe", "vendor.ts"]);
  expect(decoded.map.sourcesContent).toEqual(["main authored", "config authored", "vendor authored"]);
  expect(mappedPosition(composed, code, 0)).toEqual({ source: "main.vibe", line: 0, column: 0 });
  expect(mappedPosition(composed, code, 4)).toBeUndefined();
  expect(mappedPosition(composed, code, 8)).toEqual({ source: "config.vibe", line: 0, column: 2 });
  expect(mappedPosition(composed, code, 12)).toEqual({ source: "vendor.ts", line: 0, column: 1 });
  expect(mappedPosition(composed, code, 16)).toBeUndefined();
});

test("source-map generation and composition fail closed at deterministic bounds", () => {
  const oversized = "x".repeat(1_000_001);
  expect(() => createPreciseSourceMap({
    generatedCode: oversized,
    generatedBody: oversized,
    generatedPrefix: "",
    source: oversized,
    sourceName: "oversized.vibe",
    fileName: "oversized.ts",
    identity: true,
  })).toThrow("1000000 UTF-16 unit POC limit");

  const inner = JSON.stringify({
    version: 3,
    file: "intermediate.ts",
    sources: ["source.vibe"],
    sourcesContent: ["source"],
    names: [],
    mappings: "AAAA",
  });
  const negativeColumn = JSON.stringify({
    version: 3,
    sources: ["intermediate.ts"],
    sourcesContent: ["generated"],
    names: [],
    mappings: "D",
  });
  expect(() => composeSourceMaps(negativeColumn, inner, "output.js")).toThrow("must not backtrack");

  const ambiguous = JSON.stringify({
    version: 3,
    sources: ["left/intermediate.ts", "right/intermediate.ts"],
    sourcesContent: ["left", "right"],
    names: [],
    mappings: "AAAA",
  });
  expect(() => composeSourceMaps(ambiguous, inner, "output.js")).toThrow("cannot uniquely identify");

  const tooManyLines = JSON.stringify({
    version: 3,
    sources: ["intermediate.ts"],
    sourcesContent: ["generated"],
    names: [],
    mappings: ";".repeat(1_000_001),
  });
  expect(() => composeSourceMaps(tooManyLines, inner, "output.js")).toThrow("bounded generated lines");
});
