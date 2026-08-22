import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import {
  annotateDeclarationEffects,
  analyzeProject,
  analyzeSource,
  checkEmittedProject,
  compileAndCheckProject,
  compileProject,
  emitProjectDeclarations,
  readDeclarationEffects,
} from "./index.ts";
import { issueCompilerRuntimeSource } from "./runtime-source-authority.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((character, index) => [character, index]));

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

function lineColumnAt(text: string, offset: number): { readonly line: number; readonly column: number } {
  const prefix = text.slice(0, offset).split(/\r\n|[\n\r\u2028\u2029]/);
  return { line: prefix.length - 1, column: prefix.at(-1)!.length };
}

/** Nearest mapping at or before a generated offset, in authored coordinates. */
function mappedPosition(wire: string, generatedCode: string, generatedOffset: number):
  { readonly source: string; readonly line: number; readonly column: number } | undefined {
  const map = JSON.parse(wire) as { sources: string[]; mappings: string };
  const generated = lineColumnAt(generatedCode, generatedOffset);
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let selected: { source?: number; originalLine?: number; originalColumn?: number } | undefined;
  for (const [line, encodedLine] of map.mappings.split(";").entries()) {
    let generatedColumn = 0;
    for (const encoded of encodedLine ? encodedLine.split(",") : []) {
      const values = decodeVlq(encoded);
      generatedColumn += values[0]!;
      const segment: { source?: number; originalLine?: number; originalColumn?: number } = {};
      if (values.length > 1) {
        source += values[1]!;
        originalLine += values[2]!;
        originalColumn += values[3]!;
        segment.source = source;
        segment.originalLine = originalLine;
        segment.originalColumn = originalColumn;
      }
      if (line === generated.line && generatedColumn <= generated.column) selected = segment;
    }
  }
  if (selected?.source === undefined) return undefined;
  return {
    source: map.sources[selected.source]!,
    line: selected.originalLine!,
    column: selected.originalColumn!,
  };
}

describe("checked .vibe project rows", () => {
  test("checks foreign module initialization trust per project import", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibe-project-module-init-"));
    try {
      await writeFile(join(root, "trusted.ts"), `
        /** @module @throws {never} */
        export type Label = string
        export const value = "safe"
      `);
      await writeFile(join(root, "untrusted.ts"), `
        export type Label = string
        export const value = "unsafe"
      `);
      const analysis = analyzeProject([
        {
          fileName: "rejected.vibe",
          source: 'import { value } from "./untrusted.ts"\nexport const copied = value\n',
        },
        {
          fileName: "accepted.vibe",
          source: 'import { value } from "./trusted.ts"\nexport const copied = value\n',
        },
        {
          fileName: "types.vibe",
          source: 'import type { Label } from "./untrusted.ts"\nexport const copied: Label = "type only"\n',
        },
      ], { rootDir: root });
      expect(analysis.files["rejected.vibe"]!.diagnostics
        .filter((diagnostic) => diagnostic.code === "VIBE1510")).toHaveLength(1);
      expect(analysis.files["accepted.vibe"]!.diagnostics
        .filter((diagnostic) => diagnostic.code === "VIBE1510")).toHaveLength(0);
      expect(analysis.files["types.vibe"]!.diagnostics
        .filter((diagnostic) => diagnostic.code === "VIBE1510")).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  test("declaration effect metadata is deterministic, versioned, and strict", () => {
    const declaration = "export declare function run(): string;\n";
    const annotated = annotateDeclarationEffects(declaration, {
      run: { failures: ["Missing"], requirements: ["Clock"] },
    });
    expect(annotated).toBe(
      '/** @vibeEffects {"version":1,"failures":["Missing"],"requirements":["Clock"]} */\n' + declaration,
    );
    expect(readDeclarationEffects(annotated)).toEqual({
      run: { failures: ["Missing"], requirements: ["Clock"] },
    });
    expect(() => annotateDeclarationEffects(annotated, {
      run: { failures: [], requirements: [] },
    })).toThrow("already contains");
    expect(() => readDeclarationEffects(
      '/** @vibeEffects {"version":1,"failures":["Zed","Alpha"],"requirements":[]} */\n' + declaration,
    )).toThrow("sorted and unique");
    expect(() => readDeclarationEffects(
      '/** @vibeEffects {"version":2,"failures":[],"requirements":[]} */\n' + declaration,
    )).toThrow("unsupported envelope");
    expect(() => readDeclarationEffects(
      '/** @vibeEffects {"version":1,"version":1,"failures":[],"requirements":[]} */\n' + declaration,
    )).toThrow("canonical encoding");
    expect(() => annotateDeclarationEffects(declaration, {
      run: { failures: ["Missing", "Missing"], requirements: [] },
    })).toThrow("unique");
    const split = annotateDeclarationEffects(
      "export declare const first: () => string, second: () => number;\n",
      {
        first: { failures: ["FirstFailure"], requirements: [] },
        second: { failures: [], requirements: ["Clock"] },
      },
    );
    expect(readDeclarationEffects(split)).toEqual({
      first: { failures: ["FirstFailure"], requirements: [] },
      second: { failures: [], requirements: ["Clock"] },
    });

    const runtime = JSON.stringify(resolve(import.meta.dir, "../runtime/index.ts"));
    const inferred = emitProjectDeclarations([{
      fileName: "/virtual/inferred.mts",
      code: `
        import { __vsResultFailure, __vsResultSuccess } from ${runtime}
        export class LocalFailure extends Error {}
        export function inferred(flag: boolean) {
          return flag ? __vsResultSuccess("ok") : __vsResultFailure(new LocalFailure())
        }
        export async function inferredAsync(flag: boolean) {
          return flag ? __vsResultSuccess("ok") : __vsResultFailure(new LocalFailure())
        }
        export const first = (flag: boolean) => flag
            ? __vsResultSuccess("first")
            : __vsResultFailure(new LocalFailure()),
          second = (flag: boolean) => flag
            ? __vsResultSuccess("second")
            : __vsResultFailure(new LocalFailure())
        export function unrelated(): Map<string, never> | Map<never, LocalFailure> {
          throw new LocalFailure()
        }
      `,
      effects: {
        inferred: { failures: ["LocalFailure"], requirements: [] },
        inferredAsync: { failures: ["LocalFailure"], requirements: [] },
        first: { failures: ["LocalFailure"], requirements: [] },
        second: { failures: ["LocalFailure"], requirements: ["Clock"] },
        unrelated: { failures: ["LocalFailure"], requirements: [] },
      },
    }]);
    expect(inferred.ok).toBe(true);
    expect(inferred.outputs).toHaveLength(1);
    const inferredOutput = inferred.outputs.find((output) => output.fileName.endsWith("inferred.d.mts"));
    expect(inferredOutput).toBeDefined();
    const inferredCode = inferredOutput!.code.replaceAll(/\s+/g, " ");
    expect(inferredCode).toContain("inferred(flag: boolean): import(");
    expect(inferredCode).toContain(").Result<string, LocalFailure>");
    expect(inferredCode).toContain("inferredAsync(flag: boolean): Promise<import(");
    expect(inferredCode).toContain(").Result<string, LocalFailure>>");
    expect(inferredCode).toContain("first: (flag: boolean) => import(");
    expect(inferredCode).toContain("second: (flag: boolean) => import(");
    expect(inferredCode).toContain("unrelated(): Map<string, never> | Map<never, LocalFailure>");
    const inferredRows = readDeclarationEffects(inferredOutput!.code);
    expect(inferredRows.inferred).toEqual({
      failures: ["LocalFailure"],
      requirements: [],
    });
    expect(inferredRows.first).toEqual({ failures: ["LocalFailure"], requirements: [] });
    expect(inferredRows.second).toEqual({ failures: ["LocalFailure"], requirements: ["Clock"] });
    expect(() => emitProjectDeclarations([
      { fileName: "/virtual/collision.ts", code: "export const fromTs = true" },
      { fileName: "/virtual/collision.js", code: "export const fromJs = true" },
    ])).toThrow("duplicate declaration output");
  });

  test("lowers a checked batch and rewrites authored-module imports to project outputs", () => {
    const sourceSet = [
      {
        fileName: "src/main.vibe",
        source: `
          import { Context } from "vibelang/context"
          import { load, type Missing } from "./service.vibe"
          abstract class Clock extends Context { abstract now(): number }
          export function run(): Result<string, Missing> {
            Clock.context().now()
            return load().unwrap()
          }
        `,
      },
      {
        fileName: "src/service.vibe",
        source: `
          export class Missing extends Error {}
          export function load(): Result<string, Missing> { throw new Missing() }
        `,
      },
    ] as const;
    const compiled = compileProject(sourceSet, {
      rootDir: "/virtual/batch",
      outDir: "/virtual/output",
      outputExtension: ".mjs",
      runtimeImport: "vibelang/runtime",
      sourceMap: false,
    });

    expect(compiled.diagnostics).toHaveLength(0);
    expect(compiled.files["src/main.vibe"]!.outputFileName).toBe("/virtual/output/src/main.mjs");
    expect(compiled.files["src/main.vibe"]!.code).toContain('from "./service.mjs"');
    expect(compiled.files["src/main.vibe"]!.code).toContain("__vsInspectResult");
    expect(compiled.files["src/main.vibe"]!.analysis.rows.run).toEqual({
      failures: ["Missing"],
      requirements: ["Clock"],
    });
    expect(compiled.files["src/service.vibe"]!.code).toContain("__vsRegisterError");

    const checked = compileAndCheckProject(sourceSet, {
      rootDir: "/virtual/batch",
      outDir: "/virtual/output",
      outputExtension: ".mjs",
      runtimeImport: resolve(import.meta.dir, "../runtime/index.ts"),
      sourceMap: false,
    });
    expect(checked.ok).toBe(true);
    expect(checked.emitDiagnostics).toHaveLength(0);

    const declarations = emitProjectDeclarations(Object.values(checked.result.files).map((file) => ({
      fileName: file.outputFileName,
      code: file.code,
      effects: file.analysis.rows,
    })));
    expect(declarations.ok).toBe(true);
    expect(declarations.diagnostics).toHaveLength(0);
    const mainDeclaration = declarations.outputs.find((output) => output.fileName.endsWith("main.d.mts"));
    expect(mainDeclaration?.code).toContain('import { type Missing } from "./service.mjs"');
    expect(mainDeclaration?.code).toContain("run(): Result<string, Missing>");
    expect(mainDeclaration?.code).toContain("@vibeEffects");
    expect(readDeclarationEffects(mainDeclaration!.code, mainDeclaration!.fileName).run).toEqual({
      failures: ["Missing"],
      requirements: ["Clock"],
    });
  });

  test("lowers defer tails in a checked multi-module compile", () => {
    const sourceSet = [
      {
        fileName: "src/main.vibe",
        source: `
          import { load, type ProjectFailure } from "./service.vibe"
          export let cleanupCount = 0
          export function run(): Result<number, ProjectFailure> {
            defer cleanupCount += 1
            errdefer cleanupCount += 10
            return load().unwrap()
          }
        `,
      },
      {
        fileName: "src/service.vibe",
        source: `
          export class ProjectFailure extends Error {}
          export function load(): Result<number, ProjectFailure> {
            throw new ProjectFailure()
          }
        `,
      },
    ] as const;
    const checked = compileAndCheckProject(sourceSet, {
      rootDir: "/virtual/defer-project",
      outDir: "/virtual/defer-output",
      outputExtension: ".mjs",
      runtimeImport: resolve(import.meta.dir, "../runtime/index.ts"),
      sourceMap: false,
    });

    expect(checked.ok).toBe(true);
    expect(checked.result.diagnostics).toHaveLength(0);
    expect(checked.emitDiagnostics).toHaveLength(0);
    const output = checked.result.files["src/main.vibe"]!.code;
    expect(output).toContain("try {");
    expect(output).toContain("finally {");
    expect(output).toContain("__vsInspectResult");
    expect(output).not.toContain("defer cleanupCount");
    expect(output).not.toContain("errdefer cleanupCount");
  });

  test("propagates Error and Context rows through checker-resolved import aliases", () => {
    const analysis = analyzeProject([
      {
        fileName: "app.vibe",
        source: `
          import { load as applicationLoad } from "./service.vibe"
          import type { Missing } from "./domain.vibe"
          import * as domain from "./domain.vibe"
          export function run(id: number): Result<string, Missing> {
            return applicationLoad(id).unwrap()
          }
          export function runNamespace(id: number): Result<string, domain.Missing> {
            return domain.find(id).unwrap()
          }
        `,
      },
      {
        fileName: "domain.vibe",
        source: `
          import { Context } from "vibelang/context"
          export abstract class Db extends Context { abstract read(id: number): string }
          export class Missing extends Error {}
          export function find(id: number): Result<string, Missing> {
            const value = Db.context().read(id)
            if (!value) throw new Missing()
            return value
          }
        `,
      },
      {
        fileName: "service.vibe",
        source: `
          import { find as fetch, type Missing } from "./domain.vibe"
          export function load(id: number): Result<string, Missing> {
            return fetch(id).unwrap()
          }
        `,
      },
    ], { rootDir: "/virtual/vibe-project" });

    expect(Object.keys(analysis.files)).toEqual(["app.vibe", "domain.vibe", "service.vibe"]);
    expect(analysis.files["domain.vibe"]!.rows.find).toEqual({ failures: ["Missing"], requirements: ["Db"] });
    expect(analysis.files["service.vibe"]!.rows.load).toEqual({ failures: ["Missing"], requirements: ["Db"] });
    expect(analysis.files["app.vibe"]!.rows.run).toEqual({ failures: ["Missing"], requirements: ["Db"] });
    expect(analysis.files["app.vibe"]!.rows.runNamespace).toEqual({ failures: ["Missing"], requirements: ["Db"] });
    expect(analysis.diagnostics).toHaveLength(0);
  });

  test("reaches a fixed point across an import cycle", () => {
    const analysis = analyzeProject([
      {
        fileName: "a.vibe",
        source: `
          import { b, type CycleFailure } from "./b.vibe"
          export function a(stop: boolean): Result<number, CycleFailure> {
            if (stop) return 1
            return b(true).unwrap()
          }
        `,
      },
      {
        fileName: "b.vibe",
        source: `
          import { a } from "./a.vibe"
          export class CycleFailure extends Error {}
          export function b(stop: boolean): Result<number, CycleFailure> {
            if (!stop) return a(true).unwrap()
            throw new CycleFailure()
          }
        `,
      },
    ], { rootDir: "/virtual/vibe-cycle" });

    expect(analysis.files["a.vibe"]!.rows.a?.failures).toEqual(["CycleFailure"]);
    expect(analysis.files["b.vibe"]!.rows.b?.failures).toEqual(["CycleFailure"]);
    expect(analysis.diagnostics).toHaveLength(0);
  });

  test("reports source-located unsatisfied top-level project requirements without a foreign panic", () => {
    const analysis = analyzeProject([
      {
        fileName: "capability.vibe",
        source: `
          import { Context } from "vibelang/context"
          export abstract class Clock extends Context { abstract now(): number }
          export function time(): number { return Clock.context().now() }
        `,
      },
      {
        fileName: "main.vibe",
        source: `import { time as currentTime } from "./capability.vibe"
currentTime()
`,
      },
    ], { rootDir: "/virtual/vibe-unsatisfied" });

    const unsatisfied = analysis.diagnostics.find((diagnostic) => diagnostic.code === "VIBE2102");
    expect(unsatisfied).toMatchObject({ fileName: "main.vibe", line: 2, column: 1 });
    expect(unsatisfied?.message).toContain("Clock");
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1505")).toBe(false);
  });

  test("fails closed for missing modules, higher-order escapes, and genuinely polymorphic failure rows", () => {
    const missing = analyzeProject([{
      fileName: "main.vibe",
      source: `import { absent } from "./absent.vibe"\nabsent()\n`,
    }], { rootDir: "/virtual/vibe-missing" });
    expect(missing.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "main.vibe", code: "VIBE1801", line: 1 }),
    ]));

    const invalidExport = analyzeProject([
      { fileName: "library.vibe", source: `export const present = 1` },
      { fileName: "main.vibe", source: `import { absent } from "./library.vibe"\nvoid absent\n` },
    ], { rootDir: "/virtual/vibe-invalid-export" });
    expect(invalidExport.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "main.vibe", code: "VIBE1804", line: 1 }),
    ]));

    const deferred = analyzeProject([
      {
        fileName: "library.vibe",
        source: `
          export class GenericFailure extends Error {}
          export function generic<T>(): Result<T, GenericFailure> { throw new GenericFailure() }
        `,
      },
      {
        fileName: "consumer.vibe",
        source: `
          import { generic, type GenericFailure } from "./library.vibe"
          declare function register(callback: () => unknown): void
          register(generic)
          export function direct(): Result<string, GenericFailure> {
            return generic<string>().unwrap()
          }
        `,
      },
    ], { rootDir: "/virtual/vibe-deferred" });
    expect(deferred.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "consumer.vibe", code: "VIBE1802" }),
    ]));
    expect(deferred.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1803")).toBe(false);
    expect(deferred.files["consumer.vibe"].rows.direct.failures).toEqual(["GenericFailure"]);

    // A row template the call site cannot instantiate: the caller forwards its
    // own type parameter, so the instantiated error is still deferred.
    const forwarded = analyzeProject([
      {
        fileName: "library.vibe",
        source: `
          export function genericFailure<T, E extends Error>(value: T, error: E): Result<T, E> {
            throw error
          }
        `,
      },
      {
        fileName: "consumer.vibe",
        source: `
          import { genericFailure } from "./library.vibe"
          export function forward<F extends Error>(error: F): Result<string, F> {
            return genericFailure("value", error).unwrap()
          }
        `,
      },
    ], { rootDir: "/virtual/vibe-forwarded" });
    const forwardedDeferred = forwarded.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1803");
    expect(forwardedDeferred).toEqual([
      expect.objectContaining({ fileName: "consumer.vibe", code: "VIBE1803" }),
    ]);
    expect(forwardedDeferred[0]!.message).toContain("F");
    expect(forwardedDeferred[0]!.message).toContain("still unresolved at this call site");

    // A row template with no spelled Result contract cannot be instantiated at
    // all; it fails closed on the declaration instead of leaking "E" as a row.
    const uncontracted = analyzeProject([{
      fileName: "library.vibe",
      source: `
        export function leak<E extends Error>(error: E) {
          throw error
        }
      `,
    }], { rootDir: "/virtual/vibe-uncontracted" });
    expect(uncontracted.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "library.vibe", code: "VIBE1803" }),
    ]));
  });

  test("checks and emits cross-module generic success values when failure and requirement rows are concrete", () => {
    const sourceSet = [
      {
        fileName: "library.vibe",
        source: `
          export class GenericFailure extends Error {}
          export function generic<T>(value: T): Result<T, GenericFailure> {
            if (value === undefined) throw new GenericFailure()
            return value
          }
        `,
      },
      {
        fileName: "consumer.vibe",
        source: `
          import { generic, type GenericFailure } from "./library.vibe"
          export function direct(): Result<string, GenericFailure> {
            return generic<string>("value").unwrap()
          }
        `,
      },
    ] as const;
    const checked = compileAndCheckProject(sourceSet, {
      rootDir: "/virtual/generic-concrete",
      outDir: "/virtual/generic-concrete-output",
      outputExtension: ".mjs",
      runtimeImport: resolve(import.meta.dir, "../runtime/index.ts"),
      sourceMap: false,
    });
    expect(checked.ok).toBe(true);
    expect(checked.result.diagnostics).toHaveLength(0);
    expect(checked.emitDiagnostics).toHaveLength(0);
    expect(checked.result.files["consumer.vibe"].analysis.rows.direct).toEqual({
      failures: ["GenericFailure"],
      requirements: [],
    });
  });

  test("serializes module-qualified row IDs when nominal names repeat across modules", () => {
    const capability = (kind: string) => `
      import { Context } from "vibelang/context"
      export abstract class Store extends Context { abstract read(): string }
      export class Duplicate extends Error {}
      export function ${kind}(id: string): Result<string, Duplicate> {
        if (id === "") throw new Duplicate()
        return Store.context().read()
      }
    `;
    const analysis = analyzeProject([
      { fileName: "left.vibe", source: capability("left") },
      { fileName: "nested/right.vibe", source: capability("right") },
      {
        fileName: "main.vibe",
        source: `
          import { left, Duplicate as LeftDuplicate } from "./left.vibe"
          import { right, Duplicate as RightDuplicate } from "./nested/right.vibe"
          export function both(id: string): Result<string, LeftDuplicate | RightDuplicate> {
            const first = left(id).unwrap()
            const second = right(id).unwrap()
            return first + second
          }
          export function describe(error: LeftDuplicate | RightDuplicate): string {
            return error.match({
              LeftDuplicate: () => "left",
              RightDuplicate: () => "right",
            })
          }
        `,
      },
    ], { rootDir: "/virtual/vibe-qualified" });

    expect(analysis.diagnostics).toEqual([]);
    // Same-named Errors and Contexts in different modules stay distinct rows.
    expect(analysis.files["main.vibe"]!.rows.both).toEqual({
      failures: ["Duplicate@left", "Duplicate@nested/right"],
      requirements: ["Store@left", "Store@nested/right"],
    });
    // A name that is unique across the project keeps its plain spelling.
    expect(analysis.files["left.vibe"]!.rows.left!.failures).toEqual(["Duplicate@left"]);

    // Exhaustiveness is checked against resolved row identities, so import
    // aliases select the right case and a missing module is still reported.
    const partial = analyzeProject([
      { fileName: "left.vibe", source: capability("left") },
      { fileName: "nested/right.vibe", source: capability("right") },
      {
        fileName: "main.vibe",
        source: `
          import { Duplicate as LeftDuplicate } from "./left.vibe"
          import { Duplicate as RightDuplicate } from "./nested/right.vibe"
          export function describe(error: LeftDuplicate | RightDuplicate): string {
            return error.match({ LeftDuplicate: () => "left" })
          }
        `,
      },
    ], { rootDir: "/virtual/vibe-qualified-partial" });
    const missing = partial.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1253");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain("Duplicate@nested/right");

    // Qualified identities survive the declaration metadata carrier.
    const annotated = annotateDeclarationEffects(
      "export declare function both(id: string): unknown;\n",
      { both: analysis.files["main.vibe"]!.rows.both! },
    );
    expect(readDeclarationEffects(annotated).both).toEqual({
      failures: ["Duplicate@left", "Duplicate@nested/right"],
      requirements: ["Store@left", "Store@nested/right"],
    });
  });

  test("trusts only nominally issued compiler runtime modules and strips issued import attributes", () => {
    const rootDir = "/virtual/generated-runtime";
    const outDir = "/virtual/generated-runtime-output";
    const generated = `
      /** @module @throws {never} */
      const value = { count: 3, mode: "const" } as const
      export default value
    `;
    const compiled = compileProject([{
      fileName: "main.vibe",
      source: `
        import config from "./config.json" with { type: "json", mode: "const" }
        export function count(): number { return config.count }
      `,
    }], {
      rootDir,
      outDir,
      outputExtension: ".mjs",
      sourceMap: false,
      additionalRuntimeSources: [issueCompilerRuntimeSource({
        sourceFileName: "__vibelang_assets__/config.generated.ts",
        resolutionAliases: ["config.json"],
        source: generated,
      })],
      additionalRuntimeOutputs: [{
        sourceFileName: "__vibelang_assets__/config.generated.ts",
        outputFileName: `${outDir}/__assets/config.mjs`,
        resolutionAliases: ["config.json"],
        stripImportAttributes: true,
      }],
    });
    expect(compiled.diagnostics).toHaveLength(0);
    expect(compiled.files["main.vibe"].code).toContain('from "./__assets/config.mjs"');
    expect(compiled.files["main.vibe"].code).not.toContain(" with {");
    expect(compiled.files["main.vibe"].analysis.rows.count).toEqual({ failures: [], requirements: [] });

    const forged = analyzeProject([{
      fileName: "main.vibe",
      source: `import config from "./config.json" with { type: "json" }\nexport const value = config.count`,
    }], {
      rootDir,
      additionalRuntimeSources: [{
        sourceFileName: "__vibelang_assets__/forged.generated.ts",
        resolutionAliases: ["config.json"],
        source: generated,
      }],
    });
    expect(forged.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1506")).toBe(true);

    const untrusted = analyzeProject([{
      fileName: "main.vibe",
      source: `import config from "./config.json" with { type: "json" }\nexport const value = config`,
    }], {
      rootDir,
      additionalRuntimeSources: [{
        sourceFileName: "__vibelang_assets__/untrusted.generated.ts",
        resolutionAliases: ["config.json"],
        source: "export default { count: 3 }",
      }],
    });
    expect(untrusted.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1510")).toBe(true);

    expect(() => analyzeProject([{ fileName: "main.vibe", source: "export {}" }], {
      rootDir,
      additionalRuntimeSources: [{ sourceFileName: "../escape.ts", source: "export {}" }],
    })).toThrow("must be beneath the project root");

    expect(() => analyzeProject([{ fileName: "main.vibe", source: "export {}" }], {
      rootDir,
      additionalRuntimeSources: [
        { sourceFileName: "same.ts", source: "export const a = 1" },
        { sourceFileName: "same.ts", source: "export const b = 2" },
      ],
    })).toThrow("duplicate path");
  });

  test("the lowered generated-asset graph type-checks and runs on a real ESM loader", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibe-asset-graph-exec-"));
    try {
      const outDir = join(root, "out");
      const generated = `
        /** @module @throws {never} */
        const value = { count: 3, mode: "const" } as const
        export default value
        export const label = "asset"
      `;
      const compiled = compileProject([
        {
          fileName: "assets.vibe",
          source: `export { default as config, label } from "./config.json" with { type: "json" }\n`,
        },
        {
          fileName: "main.vibe",
          source: `import { config, label } from "./assets.vibe"
export function summary(): string { return label + ":" + String(config.count) }
export async function lazy(): Promise<number> {
  const loaded = await import("./config.json", { with: { type: "json" } })
  return loaded.default.count
}
`,
        },
      ], {
        rootDir: root,
        outDir,
        outputExtension: ".mjs",
        sourceMap: false,
        additionalRuntimeSources: [issueCompilerRuntimeSource({
          sourceFileName: "__vibelang_assets__/config.generated.ts",
          resolutionAliases: ["config.json"],
          source: generated,
        })],
        additionalRuntimeOutputs: [{
          sourceFileName: "__vibelang_assets__/config.generated.ts",
          outputFileName: join(outDir, "__assets/config.mjs"),
          resolutionAliases: ["config.json"],
          stripImportAttributes: true,
        }],
      });
      expect(compiled.diagnostics).toEqual([]);

      // The re-export specifier is repointed at the generated module, so the
      // emitted graph resolves (no TS2307 on the authored `./config.json`).
      expect(compiled.files["assets.vibe"].code)
        .toBe('export { default as config, label } from "./__assets/config.mjs";\n');
      const emitted = checkEmittedProject([
        ...Object.values(compiled.files).map((file) => ({ fileName: file.outputFileName, code: file.code })),
        { fileName: join(outDir, "__assets/config.mjs"), code: generated },
      ]).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
      expect(emitted.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")))
        .toEqual([]);

      // No `with { ... }` bag survives into the emitted JavaScript on either
      // form, so a real loader cannot raise ERR_IMPORT_ATTRIBUTE_UNSUPPORTED.
      const transpiler = new Bun.Transpiler({ loader: "ts", target: "node" });
      for (const file of Object.values(compiled.files)) {
        await mkdir(dirname(file.outputFileName), { recursive: true });
        await writeFile(file.outputFileName, transpiler.transformSync(file.code));
      }
      await mkdir(join(outDir, "__assets"), { recursive: true });
      await writeFile(join(outDir, "__assets/config.mjs"), transpiler.transformSync(generated));
      const entry = join(outDir, "entry.mjs");
      await writeFile(
        entry,
        `import { summary, lazy } from "./main.mjs";\nconsole.log(summary());\nconsole.log(await lazy());\n`,
      );

      // Prefer a real Node loader: ERR_IMPORT_ATTRIBUTE_UNSUPPORTED is Node's
      // own failure mode for a surviving attribute bag. Fall back to this
      // runtime's loader only where Node is unavailable.
      const node = Bun.which("node");
      if (node) {
        const executed = Bun.spawnSync([node, entry], { stdout: "pipe", stderr: "pipe" });
        expect(executed.stderr.toString()).toBe("");
        expect(executed.exitCode).toBe(0);
        expect(executed.stdout.toString()).toBe("asset:3\n3\n");
      } else {
        const module = await import(pathToFileURL(join(outDir, "main.mjs")).href) as Record<string, any>;
        expect(module.summary()).toBe("asset:3");
        expect(await module.lazy()).toBe(3);
      }
    } finally {
      await rm(root, { recursive: true });
    }
  });

  test("lowers generated-asset re-exports and literal dynamic imports end to end", () => {
    const rootDir = "/virtual/asset-graph";
    const outDir = "/virtual/asset-graph-output";
    const generated = `
      /** @module @throws {never} */
      const value = { count: 3 } as const
      export default value
      export const label = "asset"
    `;
    const sources = [
      {
        fileName: "assets.vibe",
        source: `export { default as config, label } from "./config.json" with { type: "json" }\n`,
      },
      {
        fileName: "main.vibe",
        source: `import { config, label } from "./assets.vibe"
export function count(): number { return config.count }
export function tag(): string { return label }
export async function lazy(): Promise<number> {
  const loaded = await import("./config.json", { with: { type: "json" } })
  return loaded.default.count
}
`,
      },
    ] as const;
    const runtimeSources = [issueCompilerRuntimeSource({
      sourceFileName: "__vibelang_assets__/config.generated.ts",
      resolutionAliases: ["config.json"],
      source: generated,
    })];
    const runtimeOutputs = [{
      sourceFileName: "__vibelang_assets__/config.generated.ts",
      outputFileName: `${outDir}/__assets/config.mjs`,
      resolutionAliases: ["config.json"],
      stripImportAttributes: true,
    }];

    const compiled = compileProject(sources, {
      rootDir,
      outDir,
      outputExtension: ".mjs",
      sourceMap: false,
      additionalRuntimeSources: runtimeSources,
      additionalRuntimeOutputs: runtimeOutputs,
    });
    // A binding re-exported from a generated asset module resolves through the
    // re-exporting `.vibe` module instead of failing closed as VIBE1804.
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.files["assets.vibe"].code)
      .toBe('export { default as config, label } from "./__assets/config.mjs";\n');
    expect(compiled.files["main.vibe"].code)
      .toContain('await import("./__assets/config.mjs")');
    expect(compiled.files["main.vibe"].code).not.toContain(" with {");
    expect(compiled.files["main.vibe"].code).not.toContain("config.json");

    // Without a strip policy the authored attributes survive on both forms.
    const kept = compileProject(sources, {
      rootDir,
      outDir,
      outputExtension: ".ts",
      sourceMap: false,
      additionalRuntimeSources: runtimeSources,
      additionalRuntimeOutputs: [{
        ...runtimeOutputs[0]!,
        outputFileName: `${outDir}/__assets/config.ts`,
        stripImportAttributes: false,
      }],
    });
    expect(kept.files["assets.vibe"].code).toContain('with { type: "json" }');
    expect(kept.files["main.vibe"].code).toContain('{ with: { type: "json" } }');

    // A dynamic specifier the compiler cannot evaluate keeps its authored text
    // rather than being silently repointed at the generated module.
    const deferred = compileProject([{
      fileName: "main.vibe",
      source: `export async function lazy(name: string): Promise<unknown> {
  return import(name, { with: { type: "json" } })
}
`,
    }], {
      rootDir,
      outDir,
      outputExtension: ".mjs",
      sourceMap: false,
      additionalRuntimeSources: runtimeSources,
      additionalRuntimeOutputs: runtimeOutputs,
    });
    expect(deferred.files["main.vibe"].code).toContain('import(name, { with: { type: "json" } })');

    // A re-export of an untrusted generated module stays fail-closed, and a
    // binding the target neither declares nor re-exports is still VIBE1804.
    const untrusted = analyzeProject([{
      fileName: "assets.vibe",
      source: `export { default as config } from "./config.json" with { type: "json" }\n`,
    }], {
      rootDir,
      additionalRuntimeSources: [{
        sourceFileName: "__vibelang_assets__/untrusted.generated.ts",
        resolutionAliases: ["config.json"],
        source: "export default { count: 3 }",
      }],
    });
    expect(untrusted.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1510")).toBe(true);

    const absent = analyzeProject([
      { fileName: "assets.vibe", source: `export { default as config } from "./config.json" with { type: "json" }\n` },
      { fileName: "main.vibe", source: `import { missing } from "./assets.vibe"\nvoid missing\n` },
    ], { rootDir, additionalRuntimeSources: runtimeSources });
    expect(absent.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "main.vibe", code: "VIBE1804" }),
    ]));
  });

  test("preserveVibeSpecifiers keeps authored .vibe specifiers with exact source-map columns", () => {
    const rootDir = "/virtual/preserve-specifiers";
    const outDir = "/virtual/preserve-specifiers-output";
    const sources = [
      {
        fileName: "domain.vibe",
        source: `export class NotFound extends Error {}
export function find(id: string): Result<string, NotFound> {
  if (id === "") throw new NotFound()
  return id
}
`,
      },
      {
        fileName: "nested/app.vibe",
        source: `import { find, type NotFound } from "../domain.vibe"
export function run(id: string): Result<string, NotFound> {
  return find(id).unwrap()
}
`,
      },
    ] as const;
    const shared = { rootDir, outDir, outputExtension: ".mjs", runtimeImport: "vibelang/runtime" } as const;

    const rewritten = compileProject(sources, { ...shared, sourceMap: false });
    expect(rewritten.files["nested/app.vibe"].code).toContain('from "../domain.mjs"');

    const preserved = compileProject(sources, { ...shared, sourceMap: true, preserveVibeSpecifiers: true });
    const code = preserved.files["nested/app.vibe"].code;
    expect(code).toContain('from "../domain.vibe"');
    expect(code).not.toContain("domain.mjs");
    // Cross-module analysis is untouched: the row still crosses the import.
    expect(preserved.files["nested/app.vibe"].analysis.rows.run)
      .toEqual({ failures: ["NotFound"], requirements: [] });
    expect(preserved.diagnostics).toHaveLength(0);

    // The preserved specifier keeps character-exact authored provenance.
    const authored = sources[1].source;
    const generatedOffset = code.indexOf('"../domain.vibe"');
    expect(generatedOffset).toBeGreaterThan(-1);
    expect(mappedPosition(preserved.files["nested/app.vibe"].sourceMap!, code, generatedOffset))
      .toEqual({ source: "nested/app.vibe", ...lineColumnAt(authored, authored.indexOf('"../domain.vibe"')) });
  });

  test("preserveVibeSpecifiers changes emit only; diagnostics and attribute policy are identical", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibe-preserve-specifiers-"));
    try {
      await writeFile(join(root, "untrusted.ts"), `export const value = "unsafe"\n`);
      const sources = [
        {
          fileName: "library.vibe",
          source: `export class Missing extends Error {}
export class Extra extends Error {}
export function narrow(id: string): Result<string, Missing> {
  if (id === "") throw new Missing()
  if (id === "x") throw new Extra()
  return id
}
`,
        },
        {
          fileName: "main.vibe",
          source: `import { value } from "./untrusted.ts"
import { narrow, type Missing } from "./library.vibe"
export function run(id: string): Result<string, Missing> {
  return narrow(id + value).unwrap()
}
`,
        },
      ] as const;
      const shared = { rootDir: root, outDir: join(root, "out"), outputExtension: ".mjs", sourceMap: false } as const;
      const rewritten = compileProject(sources, shared);
      const preserved = compileProject(sources, { ...shared, preserveVibeSpecifiers: true });

      expect(rewritten.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1510")).toBe(true);
      expect(rewritten.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1104")).toBe(true);
      expect(preserved.diagnostics).toEqual(rewritten.diagnostics);

      // Non-`.vibe` relative specifiers still rewrite under the option.
      expect(preserved.files["main.vibe"].code).toContain('from "./library.vibe"');
      expect(preserved.files["main.vibe"].code).toContain('from "../untrusted.ts"');
      expect(rewritten.files["main.vibe"].code).toContain('from "./library.mjs"');

      expect(() => compileProject(sources, {
        ...shared,
        preserveVibeSpecifiers: "yes" as unknown as boolean,
      })).toThrow("preserveVibeSpecifiers must be a boolean");
    } finally {
      await rm(root, { recursive: true });
    }
  });
});

describe("callback row and task ownership gates", () => {
  test("rejects inferred-fallible callbacks, including Layer.provide callbacks", () => {
    const analysis = analyzeSource(`
      import { Context } from "vibelang/context"
      import { Layer } from "vibelang/provider"
      abstract class Db extends Context { abstract read(): string }
      class CallbackFailure extends Error {}
      declare function register(callback: () => unknown): void
      const DbLive = Layer.succeed(Db, { read: () => "ok" })
      register(() => { throw new CallbackFailure() })
      Layer.provide(DbLive, () => { throw new CallbackFailure() })
    `);
    expect(analysis.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "VIBE1303" }),
      expect.objectContaining({ code: "VIBE2105" }),
    ]));

    const explicit = analyzeSource(`
      import { Context } from "vibelang/context"
      import { Layer } from "vibelang/provider"
      abstract class Db extends Context { abstract read(): string }
      class CallbackFailure extends Error {}
      const DbLive = Layer.succeed(Db, { read: () => "ok" })
      function checked(): Result<string, CallbackFailure> {
        return Layer.provide(DbLive, (): Result<string, CallbackFailure> => {
          throw new CallbackFailure()
        })
      }
    `);
    expect(explicit.diagnostics.some((diagnostic) => diagnostic.code === "VIBE2105")).toBe(false);
  });

  test("rejects unowned async callbacks but accepts an awaited Layer computation", () => {
    const escaped = analyzeSource(`
      declare function work(): Promise<number>
      const pending = [1].map(async () => work())
    `);
    expect(escaped.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1404")).toBe(true);

    const owned = analyzeSource(`
      import { Context } from "vibelang/context"
      import { Layer } from "vibelang/provider"
      abstract class Db extends Context { abstract read(): string }
      const DbLive = Layer.succeed(Db, { read: () => "ok" })
      async function run(): Promise<number> {
        return Layer.provide(DbLive, async (): Promise<number> => 1)
      }
    `);
    expect(owned.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1404")).toBe(false);
  });
});
