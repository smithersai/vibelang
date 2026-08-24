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

describe("checked .sm project rows", () => {
  test("checks foreign module initialization trust per project import", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-project-module-init-"));
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
          fileName: "rejected.sm",
          source: 'import { value } from "./untrusted.ts"\nexport const copied = value\n',
        },
        {
          fileName: "accepted.sm",
          source: 'import { value } from "./trusted.ts"\nexport const copied = value\n',
        },
        {
          fileName: "types.sm",
          source: 'import type { Label } from "./untrusted.ts"\nexport const copied: Label = "type only"\n',
        },
      ], { rootDir: root });
      expect(analysis.files["rejected.sm"]!.diagnostics
        .filter((diagnostic) => diagnostic.code === "SMITHERS1510")).toHaveLength(1);
      expect(analysis.files["accepted.sm"]!.diagnostics
        .filter((diagnostic) => diagnostic.code === "SMITHERS1510")).toHaveLength(0);
      expect(analysis.files["types.sm"]!.diagnostics
        .filter((diagnostic) => diagnostic.code === "SMITHERS1510")).toHaveLength(0);
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
      '/** @smithersEffects {"version":1,"failures":["Missing"],"requirements":["Clock"]} */\n' + declaration,
    );
    expect(readDeclarationEffects(annotated)).toEqual({
      run: { failures: ["Missing"], requirements: ["Clock"] },
    });
    expect(() => annotateDeclarationEffects(annotated, {
      run: { failures: [], requirements: [] },
    })).toThrow("already contains");
    expect(() => readDeclarationEffects(
      '/** @smithersEffects {"version":1,"failures":["Zed","Alpha"],"requirements":[]} */\n' + declaration,
    )).toThrow("sorted and unique");
    expect(() => readDeclarationEffects(
      '/** @smithersEffects {"version":2,"failures":[],"requirements":[]} */\n' + declaration,
    )).toThrow("unsupported envelope");
    expect(() => readDeclarationEffects(
      '/** @smithersEffects {"version":1,"version":1,"failures":[],"requirements":[]} */\n' + declaration,
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
        fileName: "src/main.sm",
        source: `
          import { Context } from "smthrs/context"
          import { load, type Missing } from "./service.sm"
          abstract class Clock extends Context { abstract now(): number }
          export function run(): Result<string, Missing> {
            Clock.context().now()
            return load()!
          }
        `,
      },
      {
        fileName: "src/service.sm",
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
      runtimeImport: "smthrs/runtime",
      sourceMap: false,
    });

    expect(compiled.diagnostics).toHaveLength(0);
    expect(compiled.files["src/main.sm"]!.outputFileName).toBe("/virtual/output/src/main.mjs");
    expect(compiled.files["src/main.sm"]!.code).toContain('from "./service.mjs"');
    expect(compiled.files["src/main.sm"]!.code).toContain("__vsInspectResult");
    expect(compiled.files["src/main.sm"]!.analysis.rows.run).toEqual({
      failures: ["Missing"],
      requirements: ["Clock"],
    });
    expect(compiled.files["src/service.sm"]!.code).toContain("__vsRegisterError");

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
    expect(mainDeclaration?.code).toContain("@smithersEffects");
    expect(readDeclarationEffects(mainDeclaration!.code, mainDeclaration!.fileName).run).toEqual({
      failures: ["Missing"],
      requirements: ["Clock"],
    });
  });

  test("propagates Error and Context rows through checker-resolved import aliases", () => {
    const analysis = analyzeProject([
      {
        fileName: "app.sm",
        source: `
          import { load as applicationLoad } from "./service.sm"
          import type { Missing } from "./domain.sm"
          import * as domain from "./domain.sm"
          export function run(id: number): Result<string, Missing> {
            return applicationLoad(id)!
          }
          export function runNamespace(id: number): Result<string, domain.Missing> {
            return domain.find(id)!
          }
        `,
      },
      {
        fileName: "domain.sm",
        source: `
          import { Context } from "smthrs/context"
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
        fileName: "service.sm",
        source: `
          import { find as fetch, type Missing } from "./domain.sm"
          export function load(id: number): Result<string, Missing> {
            return fetch(id)!
          }
        `,
      },
    ], { rootDir: "/virtual/smithers-project" });

    expect(Object.keys(analysis.files)).toEqual(["app.sm", "domain.sm", "service.sm"]);
    expect(analysis.files["domain.sm"]!.rows.find).toEqual({ failures: ["Missing"], requirements: ["Db"] });
    expect(analysis.files["service.sm"]!.rows.load).toEqual({ failures: ["Missing"], requirements: ["Db"] });
    expect(analysis.files["app.sm"]!.rows.run).toEqual({ failures: ["Missing"], requirements: ["Db"] });
    expect(analysis.files["app.sm"]!.rows.runNamespace).toEqual({ failures: ["Missing"], requirements: ["Db"] });
    expect(analysis.diagnostics).toHaveLength(0);
  });

  // The withdrawal tripwire. On 2026-08-23 the portability pin, the `TypeScript`
  // requirement, the portable/required/forbidden classification and the portable
  // Wasm backend were withdrawn, and `poc/src/targets/classify.ts` — which
  // computed a SECOND requirement row of its own to decide the pin — was
  // deleted with them. The rows below are the FRONTEND's and always were, but
  // that is exactly the kind of thing a removal lane assumes rather than
  // measures. Each assertion here names one survivor the withdrawal could have
  // taken with it, in one program, so a future deletion that quietly weakens the
  // capability system fails here rather than passing silently.
  test("the capability system survives the portability withdrawal", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-withdrawal-survivors-"));
    try {
      await writeFile(join(root, "foreign.ts"), `
        export function readSetting(key: string): string { return key }
      `);
      const analysis = analyzeProject([
        {
          fileName: "main.sm",
          source: [
            'import { Context } from "smthrs/context"',
            'import { Layer } from "smthrs/provider"',
            'import { readSetting } from "./foreign.ts"',
            "export abstract class Config extends Context { abstract get(key: string): string }",
            "export abstract class Clock extends Context { abstract now(): number }",
            "",
            "// 1. a nominal capability is charged to the row that reads it, and",
            "//    propagates through an ordinary call.",
            'export function mode(): string { return Config.context().get("mode") }',
            "export function describe(): string { return mode() }",
            "",
            "// 2. two capabilities compose, and Layer provision SUBTRACTS the one",
            "//    it provides while leaving the one it does not.",
            'export function stamped(): string { return String(Clock.context().now()) + ":" + mode() }',
            "const clock: Clock = { now: () => 7 }",
            "export function scoped(): string[] {",
            "  return Layer.provide(Layer.succeed(Clock, clock), () => [stamped()])",
            "}",
            "",
            "// 3. an unannotated foreign call still charges the checked panic",
            "//    channel, because JavaScript can throw. This one is the survivor",
            "//    most easily mistaken for portability machinery.",
            'export function read(): Result<string, Panic> { return readSetting("mode") }',
            "",
          ].join("\n"),
        },
      ], { rootDir: root });

      const rows = analysis.files["main.sm"]!.rows;
      // Context rows are still computed and still propagate through calls.
      expect(rows.mode!.requirements).toEqual(["Config"]);
      expect(rows.describe!.requirements).toEqual(["Config"]);
      expect(rows.stamped!.requirements).toEqual(["Clock", "Config"]);

      // Layer provision still subtracts exactly what it provides.
      expect(rows.scoped!.requirements).toEqual(["Config"]);

      // The checked panic channel is still charged on an unannotated foreign call.
      expect(rows.read!.failures).toEqual(["Panic"]);

      // And the withdrawn machinery is gone rather than merely unused: no
      // portability diagnostic reaches a caller of the frontend any more.
      expect(analysis.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("SMITHERS30")))
        .toEqual([]);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  test("reaches a fixed point across an import cycle", () => {
    const analysis = analyzeProject([
      {
        fileName: "a.sm",
        source: `
          import { b, type CycleFailure } from "./b.sm"
          export function a(stop: boolean): Result<number, CycleFailure> {
            if (stop) return 1
            return b(true)!
          }
        `,
      },
      {
        fileName: "b.sm",
        source: `
          import { a } from "./a.sm"
          export class CycleFailure extends Error {}
          export function b(stop: boolean): Result<number, CycleFailure> {
            if (!stop) return a(true)!
            throw new CycleFailure()
          }
        `,
      },
    ], { rootDir: "/virtual/smithers-cycle" });

    expect(analysis.files["a.sm"]!.rows.a?.failures).toEqual(["CycleFailure"]);
    expect(analysis.files["b.sm"]!.rows.b?.failures).toEqual(["CycleFailure"]);
    expect(analysis.diagnostics).toHaveLength(0);
  });

  test("reports source-located unsatisfied top-level project requirements without a foreign panic", () => {
    const analysis = analyzeProject([
      {
        fileName: "capability.sm",
        source: `
          import { Context } from "smthrs/context"
          export abstract class Clock extends Context { abstract now(): number }
          export function time(): number { return Clock.context().now() }
        `,
      },
      {
        fileName: "main.sm",
        source: `import { time as currentTime } from "./capability.sm"
currentTime()
`,
      },
    ], { rootDir: "/virtual/smithers-unsatisfied" });

    const unsatisfied = analysis.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS2102");
    expect(unsatisfied).toMatchObject({ fileName: "main.sm", line: 2, column: 1 });
    expect(unsatisfied?.message).toContain("Clock");
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1505")).toBe(false);
  });

  test("fails closed for missing modules, higher-order escapes, and genuinely polymorphic failure rows", () => {
    const missing = analyzeProject([{
      fileName: "main.sm",
      source: `import { absent } from "./absent.sm"\nabsent()\n`,
    }], { rootDir: "/virtual/smithers-missing" });
    expect(missing.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "main.sm", code: "SMITHERS1801", line: 1 }),
    ]));

    const invalidExport = analyzeProject([
      { fileName: "library.sm", source: `export const present = 1` },
      { fileName: "main.sm", source: `import { absent } from "./library.sm"\nvoid absent\n` },
    ], { rootDir: "/virtual/smithers-invalid-export" });
    expect(invalidExport.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "main.sm", code: "SMITHERS1804", line: 1 }),
    ]));

    const deferred = analyzeProject([
      {
        fileName: "library.sm",
        source: `
          export class GenericFailure extends Error {}
          export function generic<T>(): Result<T, GenericFailure> { throw new GenericFailure() }
        `,
      },
      {
        fileName: "consumer.sm",
        source: `
          import { generic, type GenericFailure } from "./library.sm"
          declare function register(callback: () => unknown): void
          register(generic)
          export function direct(): Result<string, GenericFailure> {
            return generic<string>()!
          }
        `,
      },
    ], { rootDir: "/virtual/smithers-deferred" });
    expect(deferred.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "consumer.sm", code: "SMITHERS1802" }),
    ]));
    expect(deferred.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1803")).toBe(false);
    expect(deferred.files["consumer.sm"].rows.direct.failures).toEqual(["GenericFailure"]);

    // A row template the call site cannot instantiate: the caller forwards its
    // own type parameter, so the instantiated error is still deferred.
    const forwarded = analyzeProject([
      {
        fileName: "library.sm",
        source: `
          export function genericFailure<T, E extends Error>(value: T, error: E): Result<T, E> {
            throw error
          }
        `,
      },
      {
        fileName: "consumer.sm",
        source: `
          import { genericFailure } from "./library.sm"
          export function forward<F extends Error>(error: F): Result<string, F> {
            return genericFailure("value", error)!
          }
        `,
      },
    ], { rootDir: "/virtual/smithers-forwarded" });
    const forwardedDeferred = forwarded.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1803");
    expect(forwardedDeferred).toEqual([
      expect.objectContaining({ fileName: "consumer.sm", code: "SMITHERS1803" }),
    ]);
    expect(forwardedDeferred[0]!.message).toContain("F");
    expect(forwardedDeferred[0]!.message).toContain("still unresolved at this call site");

    // A row template with no spelled Result contract cannot be instantiated at
    // all; it fails closed on the declaration instead of leaking "E" as a row.
    const uncontracted = analyzeProject([{
      fileName: "library.sm",
      source: `
        export function leak<E extends Error>(error: E) {
          throw error
        }
      `,
    }], { rootDir: "/virtual/smithers-uncontracted" });
    expect(uncontracted.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "library.sm", code: "SMITHERS1803" }),
    ]));
  });

  test("checks and emits cross-module generic success values when failure and requirement rows are concrete", () => {
    const sourceSet = [
      {
        fileName: "library.sm",
        source: `
          export class GenericFailure extends Error {}
          export function generic<T>(value: T): Result<T, GenericFailure> {
            if (value === undefined) throw new GenericFailure()
            return value
          }
        `,
      },
      {
        fileName: "consumer.sm",
        source: `
          import { generic, type GenericFailure } from "./library.sm"
          export function direct(): Result<string, GenericFailure> {
            return generic<string>("value")!
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
    expect(checked.result.files["consumer.sm"].analysis.rows.direct).toEqual({
      failures: ["GenericFailure"],
      requirements: [],
    });
  });

  test("serializes module-qualified row IDs when nominal names repeat across modules", () => {
    const capability = (kind: string) => `
      import { Context } from "smthrs/context"
      export abstract class Store extends Context { abstract read(): string }
      export class Duplicate extends Error {}
      export function ${kind}(id: string): Result<string, Duplicate> {
        if (id === "") throw new Duplicate()
        return Store.context().read()
      }
    `;
    const analysis = analyzeProject([
      { fileName: "left.sm", source: capability("left") },
      { fileName: "nested/right.sm", source: capability("right") },
      {
        fileName: "main.sm",
        source: `
          import { left, Duplicate as LeftDuplicate } from "./left.sm"
          import { right, Duplicate as RightDuplicate } from "./nested/right.sm"
          export function both(id: string): Result<string, LeftDuplicate | RightDuplicate> {
            const first = left(id)!
            const second = right(id)!
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
    ], { rootDir: "/virtual/smithers-qualified" });

    expect(analysis.diagnostics).toEqual([]);
    // Same-named Errors and Contexts in different modules stay distinct rows.
    expect(analysis.files["main.sm"]!.rows.both).toEqual({
      failures: ["Duplicate@left", "Duplicate@nested/right"],
      requirements: ["Store@left", "Store@nested/right"],
    });
    // A name that is unique across the project keeps its plain spelling.
    expect(analysis.files["left.sm"]!.rows.left!.failures).toEqual(["Duplicate@left"]);

    // Exhaustiveness is checked against resolved row identities, so import
    // aliases select the right case and a missing module is still reported.
    const partial = analyzeProject([
      { fileName: "left.sm", source: capability("left") },
      { fileName: "nested/right.sm", source: capability("right") },
      {
        fileName: "main.sm",
        source: `
          import { Duplicate as LeftDuplicate } from "./left.sm"
          import { Duplicate as RightDuplicate } from "./nested/right.sm"
          export function describe(error: LeftDuplicate | RightDuplicate): string {
            return error.match({ LeftDuplicate: () => "left" })
          }
        `,
      },
    ], { rootDir: "/virtual/smithers-qualified-partial" });
    const missing = partial.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1253");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain("Duplicate@nested/right");

    // Qualified identities survive the declaration metadata carrier.
    const annotated = annotateDeclarationEffects(
      "export declare function both(id: string): unknown;\n",
      { both: analysis.files["main.sm"]!.rows.both! },
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
      fileName: "main.sm",
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
        sourceFileName: "__smithers_assets__/config.generated.ts",
        resolutionAliases: ["config.json"],
        source: generated,
      })],
      additionalRuntimeOutputs: [{
        sourceFileName: "__smithers_assets__/config.generated.ts",
        outputFileName: `${outDir}/__assets/config.mjs`,
        resolutionAliases: ["config.json"],
        stripImportAttributes: true,
      }],
    });
    expect(compiled.diagnostics).toHaveLength(0);
    expect(compiled.files["main.sm"].code).toContain('from "./__assets/config.mjs"');
    expect(compiled.files["main.sm"].code).not.toContain(" with {");
    expect(compiled.files["main.sm"].analysis.rows.count).toEqual({ failures: [], requirements: [] });

    const forged = analyzeProject([{
      fileName: "main.sm",
      source: `import config from "./config.json" with { type: "json" }\nexport const value = config.count`,
    }], {
      rootDir,
      additionalRuntimeSources: [{
        sourceFileName: "__smithers_assets__/forged.generated.ts",
        resolutionAliases: ["config.json"],
        source: generated,
      }],
    });
    expect(forged.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1506")).toBe(true);

    const untrusted = analyzeProject([{
      fileName: "main.sm",
      source: `import config from "./config.json" with { type: "json" }\nexport const value = config`,
    }], {
      rootDir,
      additionalRuntimeSources: [{
        sourceFileName: "__smithers_assets__/untrusted.generated.ts",
        resolutionAliases: ["config.json"],
        source: "export default { count: 3 }",
      }],
    });
    expect(untrusted.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1510")).toBe(true);

    expect(() => analyzeProject([{ fileName: "main.sm", source: "export {}" }], {
      rootDir,
      additionalRuntimeSources: [{ sourceFileName: "../escape.ts", source: "export {}" }],
    })).toThrow("must be beneath the project root");

    expect(() => analyzeProject([{ fileName: "main.sm", source: "export {}" }], {
      rootDir,
      additionalRuntimeSources: [
        { sourceFileName: "same.ts", source: "export const a = 1" },
        { sourceFileName: "same.ts", source: "export const b = 2" },
      ],
    })).toThrow("duplicate path");
  });

  test("the lowered generated-asset graph type-checks and runs on a real ESM loader", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-asset-graph-exec-"));
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
          fileName: "assets.sm",
          source: `export { default as config, label } from "./config.json" with { type: "json" }\n`,
        },
        {
          fileName: "main.sm",
          source: `import { config, label } from "./assets.sm"
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
          sourceFileName: "__smithers_assets__/config.generated.ts",
          resolutionAliases: ["config.json"],
          source: generated,
        })],
        additionalRuntimeOutputs: [{
          sourceFileName: "__smithers_assets__/config.generated.ts",
          outputFileName: join(outDir, "__assets/config.mjs"),
          resolutionAliases: ["config.json"],
          stripImportAttributes: true,
        }],
      });
      expect(compiled.diagnostics).toEqual([]);

      // The re-export specifier is repointed at the generated module, so the
      // emitted graph resolves (no TS2307 on the authored `./config.json`).
      expect(compiled.files["assets.sm"].code)
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
        fileName: "assets.sm",
        source: `export { default as config, label } from "./config.json" with { type: "json" }\n`,
      },
      {
        fileName: "main.sm",
        source: `import { config, label } from "./assets.sm"
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
      sourceFileName: "__smithers_assets__/config.generated.ts",
      resolutionAliases: ["config.json"],
      source: generated,
    })];
    const runtimeOutputs = [{
      sourceFileName: "__smithers_assets__/config.generated.ts",
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
    // re-exporting `.sm` module instead of failing closed as SMITHERS1804.
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.files["assets.sm"].code)
      .toBe('export { default as config, label } from "./__assets/config.mjs";\n');
    expect(compiled.files["main.sm"].code)
      .toContain('await import("./__assets/config.mjs")');
    expect(compiled.files["main.sm"].code).not.toContain(" with {");
    expect(compiled.files["main.sm"].code).not.toContain("config.json");

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
    expect(kept.files["assets.sm"].code).toContain('with { type: "json" }');
    expect(kept.files["main.sm"].code).toContain('{ with: { type: "json" } }');

    // A dynamic specifier the compiler cannot evaluate keeps its authored text
    // rather than being silently repointed at the generated module.
    const deferred = compileProject([{
      fileName: "main.sm",
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
    expect(deferred.files["main.sm"].code).toContain('import(name, { with: { type: "json" } })');

    // A re-export of an untrusted generated module stays fail-closed, and a
    // binding the target neither declares nor re-exports is still SMITHERS1804.
    const untrusted = analyzeProject([{
      fileName: "assets.sm",
      source: `export { default as config } from "./config.json" with { type: "json" }\n`,
    }], {
      rootDir,
      additionalRuntimeSources: [{
        sourceFileName: "__smithers_assets__/untrusted.generated.ts",
        resolutionAliases: ["config.json"],
        source: "export default { count: 3 }",
      }],
    });
    expect(untrusted.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1510")).toBe(true);

    const absent = analyzeProject([
      { fileName: "assets.sm", source: `export { default as config } from "./config.json" with { type: "json" }\n` },
      { fileName: "main.sm", source: `import { missing } from "./assets.sm"\nvoid missing\n` },
    ], { rootDir, additionalRuntimeSources: runtimeSources });
    expect(absent.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "main.sm", code: "SMITHERS1804" }),
    ]));
  });

  test("preserveSmithersSpecifiers keeps authored .sm specifiers with exact source-map columns", () => {
    const rootDir = "/virtual/preserve-specifiers";
    const outDir = "/virtual/preserve-specifiers-output";
    const sources = [
      {
        fileName: "domain.sm",
        source: `export class NotFound extends Error {}
export function find(id: string): Result<string, NotFound> {
  if (id === "") throw new NotFound()
  return id
}
`,
      },
      {
        fileName: "nested/app.sm",
        source: `import { find, type NotFound } from "../domain.sm"
export function run(id: string): Result<string, NotFound> {
  return find(id)!
}
`,
      },
    ] as const;
    const shared = { rootDir, outDir, outputExtension: ".mjs", runtimeImport: "smthrs/runtime" } as const;

    const rewritten = compileProject(sources, { ...shared, sourceMap: false });
    expect(rewritten.files["nested/app.sm"].code).toContain('from "../domain.mjs"');

    const preserved = compileProject(sources, { ...shared, sourceMap: true, preserveSmithersSpecifiers: true });
    const code = preserved.files["nested/app.sm"].code;
    expect(code).toContain('from "../domain.sm"');
    expect(code).not.toContain("domain.mjs");
    // Cross-module analysis is untouched: the row still crosses the import.
    expect(preserved.files["nested/app.sm"].analysis.rows.run)
      .toEqual({ failures: ["NotFound"], requirements: [] });
    expect(preserved.diagnostics).toHaveLength(0);

    // The preserved specifier keeps character-exact authored provenance.
    const authored = sources[1].source;
    const generatedOffset = code.indexOf('"../domain.sm"');
    expect(generatedOffset).toBeGreaterThan(-1);
    expect(mappedPosition(preserved.files["nested/app.sm"].sourceMap!, code, generatedOffset))
      .toEqual({ source: "nested/app.sm", ...lineColumnAt(authored, authored.indexOf('"../domain.sm"')) });
  });

  test("preserveSmithersSpecifiers changes emit only; diagnostics and attribute policy are identical", async () => {
    const root = await mkdtemp(join(tmpdir(), "smithers-preserve-specifiers-"));
    try {
      await writeFile(join(root, "untrusted.ts"), `export const value = "unsafe"\n`);
      const sources = [
        {
          fileName: "library.sm",
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
          fileName: "main.sm",
          source: `import { value } from "./untrusted.ts"
import { narrow, type Missing } from "./library.sm"
export function run(id: string): Result<string, Missing> {
  return narrow(id + value)!
}
`,
        },
      ] as const;
      const shared = { rootDir: root, outDir: join(root, "out"), outputExtension: ".mjs", sourceMap: false } as const;
      const rewritten = compileProject(sources, shared);
      const preserved = compileProject(sources, { ...shared, preserveSmithersSpecifiers: true });

      expect(rewritten.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1510")).toBe(true);
      expect(rewritten.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1104")).toBe(true);
      expect(preserved.diagnostics).toEqual(rewritten.diagnostics);

      // Non-`.sm` relative specifiers still rewrite under the option.
      expect(preserved.files["main.sm"].code).toContain('from "./library.sm"');
      expect(preserved.files["main.sm"].code).toContain('from "../untrusted.ts"');
      expect(rewritten.files["main.sm"].code).toContain('from "./library.mjs"');

      expect(() => compileProject(sources, {
        ...shared,
        preserveSmithersSpecifiers: "yes" as unknown as boolean,
      })).toThrow("preserveSmithersSpecifiers must be a boolean");
    } finally {
      await rm(root, { recursive: true });
    }
  });
});

describe("callback row and task ownership gates", () => {
  test("rejects inferred-fallible callbacks, including Layer.provide callbacks", () => {
    const analysis = analyzeSource(`
      import { Context } from "smthrs/context"
      import { Layer } from "smthrs/provider"
      abstract class Db extends Context { abstract read(): string }
      class CallbackFailure extends Error {}
      declare function register(callback: () => unknown): void
      const DbLive = Layer.succeed(Db, { read: () => "ok" })
      register(() => { throw new CallbackFailure() })
      Layer.provide(DbLive, () => { throw new CallbackFailure() })
    `);
    expect(analysis.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SMITHERS1303" }),
      expect.objectContaining({ code: "SMITHERS2105" }),
    ]));

    const explicit = analyzeSource(`
      import { Context } from "smthrs/context"
      import { Layer } from "smthrs/provider"
      abstract class Db extends Context { abstract read(): string }
      class CallbackFailure extends Error {}
      const DbLive = Layer.succeed(Db, { read: () => "ok" })
      function checked(): Result<string, CallbackFailure> {
        return Layer.provide(DbLive, (): Result<string, CallbackFailure> => {
          throw new CallbackFailure()
        })
      }
    `);
    expect(explicit.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS2105")).toBe(false);
  });

  test("rejects unowned async callbacks but accepts an awaited Layer computation", () => {
    const escaped = analyzeSource(`
      declare function work(): Promise<number>
      const pending = [1].map(async () => work())
    `);
    expect(escaped.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1404")).toBe(true);

    const owned = analyzeSource(`
      import { Context } from "smthrs/context"
      import { Layer } from "smthrs/provider"
      abstract class Db extends Context { abstract read(): string }
      const DbLive = Layer.succeed(Db, { read: () => "ok" })
      async function run(): Promise<number> {
        return Layer.provide(DbLive, async (): Promise<number> => 1)
      }
    `);
    expect(owned.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1404")).toBe(false);
  });
});
