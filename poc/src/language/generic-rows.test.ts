import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  analyzeProject,
  analyzeSource,
  compileAndCheckProject,
  compileProject,
  emitProjectDeclarations,
  readDeclarationEffects,
} from "./index.ts";

const RUNTIME = resolve(import.meta.dir, "../runtime/index.ts");

/**
 * Library exporting one polymorphic row template. `attempt` charges `Timeout`
 * on its own and forwards the caller-chosen `E`.
 */
const LIBRARY = `
  export class Timeout extends Error {}
  export function attempt<A, E extends Error>(
    limit: number,
    operation: () => Result<A, E>,
  ): Result<A, E | Timeout> {
    if (limit <= 0) throw new Timeout()
    return operation().unwrap()
  }
`;

function analyze(sources: readonly { fileName: string; source: string }[], name: string) {
  return analyzeProject(sources, { rootDir: `/virtual/generic-rows-${name}` });
}

/** Lower a project, transpile every emitted module, and import the entry. */
async function executeProject(
  sources: readonly { fileName: string; source: string }[],
  entry: string,
  name: string,
) {
  const root = await mkdtemp(join(tmpdir(), `smithers-generic-rows-${name}-`));
  try {
    const compiled = compileProject(sources, {
      rootDir: root,
      outDir: root,
      outputExtension: ".mjs",
      sourceMap: false,
      runtimeImport: pathToFileURL(RUNTIME).href,
    });
    expect(compiled.diagnostics).toEqual([]);
    const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
    for (const file of Object.values(compiled.files)) {
      await writeFile(file.outputFileName, transpiler.transformSync(file.code));
    }
    const entryOutput = compiled.files[entry]!.outputFileName;
    return {
      compiled,
      module: await import(pathToFileURL(entryOutput).href) as Record<string, any>,
    };
  } finally {
    await rm(root, { recursive: true });
  }
}

test("instantiates a cross-module row template through inferred type arguments and executes", async () => {
  const sources = [
    { fileName: "library.sm", source: LIBRARY },
    {
      fileName: "consumer.sm",
      source: `
        import { attempt, type Timeout } from "./library.sm"
        export class NotFound extends Error {}
        export function load(id: string, limit: number): Result<string, NotFound | Timeout> {
          return attempt(limit, (): Result<string, NotFound> => {
            if (id === "") throw new NotFound()
            return id
          }).unwrap()
        }
      `,
    },
  ];

  const analysis = analyze(sources, "inferred");
  expect(analysis.diagnostics).toEqual([]);
  // The library keeps its template row; the call site keeps the instantiation.
  expect(analysis.files["library.sm"]!.rows.attempt)
    .toEqual({ failures: ["E", "Timeout"], requirements: [] });
  expect(analysis.files["consumer.sm"]!.rows.load)
    .toEqual({ failures: ["NotFound", "Timeout"], requirements: [] });

  const checked = compileAndCheckProject(sources, {
    rootDir: "/virtual/generic-rows-inferred",
    outDir: "/virtual/generic-rows-inferred-out",
    outputExtension: ".mjs",
    runtimeImport: RUNTIME,
    sourceMap: false,
  });
  expect(checked.result.diagnostics).toEqual([]);
  expect(checked.emitDiagnostics).toEqual([]);
  expect(checked.ok).toBe(true);

  const { module } = await executeProject(sources, "consumer.sm", "inferred");
  expect(module.load("value", 3).match({ ok: (value: string) => value, error: () => "unreachable" }))
    .toBe("value");
  expect(module.load("", 3).match({ ok: () => "unreachable", error: (error: Error) => error.constructor.name }))
    .toBe("NotFound");
  expect(module.load("value", 0).match({ ok: () => "unreachable", error: (error: Error) => error.constructor.name }))
    .toBe("Timeout");
});

test("instantiates explicit type arguments, nested calls, and async templates", () => {
  const sources = [
    { fileName: "library.sm", source: LIBRARY },
    {
      fileName: "consumer.sm",
      source: `
        import { attempt, type Timeout } from "./library.sm"
        export class NotFound extends Error {}
        export class Conflict extends Error {}
        export function explicit(id: string): Result<string, NotFound | Timeout> {
          return attempt<string, NotFound>(1, (): Result<string, NotFound> => {
            if (id === "") throw new NotFound()
            return id
          }).unwrap()
        }
        export function nested(id: string): Result<string, Conflict | NotFound | Timeout> {
          return attempt(1, (): Result<string, Conflict | NotFound | Timeout> => {
            return attempt(1, (): Result<string, Conflict | NotFound> => {
              if (id === "") throw new NotFound()
              if (id === "x") throw new Conflict()
              return id
            }).unwrap()
          }).unwrap()
        }
      `,
    },
    {
      fileName: "async-library.sm",
      source: `
        export class Deadline extends Error {}
        export async function guard<A, E extends Error>(
          operation: () => Result<A, E>,
        ): Promise<Result<A, E | Deadline>> {
          return operation().unwrap()
        }
      `,
    },
    {
      fileName: "async-consumer.sm",
      source: `
        import { guard, type Deadline } from "./async-library.sm"
        export class Broken extends Error {}
        export async function run(flag: boolean): Promise<Result<number, Broken | Deadline>> {
          return (await guard((): Result<number, Broken> => {
            if (flag) throw new Broken()
            return 1
          })).unwrap()
        }
      `,
    },
  ];

  const analysis = analyze(sources, "explicit");
  expect(analysis.diagnostics).toEqual([]);
  expect(analysis.files["consumer.sm"]!.rows.explicit.failures).toEqual(["NotFound", "Timeout"]);
  expect(analysis.files["consumer.sm"]!.rows.nested.failures)
    .toEqual(["Conflict", "NotFound", "Timeout"]);
  expect(analysis.files["async-consumer.sm"]!.rows.run.failures).toEqual(["Broken", "Deadline"]);

  const checked = compileAndCheckProject(sources, {
    rootDir: "/virtual/generic-rows-explicit",
    outDir: "/virtual/generic-rows-explicit-out",
    outputExtension: ".mjs",
    runtimeImport: RUNTIME,
    sourceMap: false,
  });
  expect(checked.result.diagnostics).toEqual([]);
  expect(checked.emitDiagnostics).toEqual([]);
});

test("carries concrete Context requirements of a row template through instantiation", () => {
  const sources = [
    {
      fileName: "library.sm",
      source: `
        import { Context } from "smthrs/context"
        export abstract class Clock extends Context { abstract now(): number }
        export class Timeout extends Error {}
        export function timed<A, E extends Error>(operation: () => Result<A, E>): Result<A, E | Timeout> {
          if (Clock.context().now() < 0) throw new Timeout()
          return operation().unwrap()
        }
      `,
    },
    {
      fileName: "consumer.sm",
      source: `
        import { timed, type Timeout } from "./library.sm"
        export class NotFound extends Error {}
        export function load(id: string): Result<string, NotFound | Timeout> {
          return timed((): Result<string, NotFound> => {
            if (id === "") throw new NotFound()
            return id
          }).unwrap()
        }
      `,
    },
  ];
  const analysis = analyze(sources, "requirements");
  expect(analysis.diagnostics).toEqual([]);
  expect(analysis.files["library.sm"]!.rows.timed)
    .toEqual({ failures: ["E", "Timeout"], requirements: ["Clock"] });
  // Requirements are never row variables here: the concrete capability of the
  // template survives instantiation untouched alongside the instantiated row.
  expect(analysis.files["consumer.sm"]!.rows.load)
    .toEqual({ failures: ["NotFound", "Timeout"], requirements: ["Clock"] });
});

test("keeps each call site's instantiation separate and reaches the propagation fixed point", () => {
  const sources = [
    { fileName: "library.sm", source: LIBRARY },
    {
      fileName: "consumer.sm",
      source: `
        import { attempt, type Timeout } from "./library.sm"
        export class NotFound extends Error {}
        export class Conflict extends Error {}
        function missing(id: string): Result<string, NotFound> {
          if (id === "") throw new NotFound()
          return id
        }
        function conflicting(id: string): Result<string, Conflict> {
          if (id === "x") throw new Conflict()
          return id
        }
        export function left(id: string): Result<string, NotFound | Timeout> {
          return attempt(1, (): Result<string, NotFound> => { return missing(id) }).unwrap()
        }
        export function right(id: string): Result<string, Conflict | Timeout> {
          return attempt(1, (): Result<string, Conflict> => { return conflicting(id) }).unwrap()
        }
        export function both(id: string): Result<string, Conflict | NotFound | Timeout> {
          const first = left(id).unwrap()
          const second = right(id).unwrap()
          return first + second
        }
      `,
    },
  ];
  const analysis = analyze(sources, "sites");
  expect(analysis.diagnostics).toEqual([]);
  const rows = analysis.files["consumer.sm"]!.rows;
  // An implementation that merged instantiations into the shared callee row
  // would report Conflict on `left` and NotFound on `right`.
  expect(rows.left!.failures).toEqual(["NotFound", "Timeout"]);
  expect(rows.right!.failures).toEqual(["Conflict", "Timeout"]);
  // Instantiated rows still take part in ordinary fixed-point propagation.
  expect(rows.both!.failures).toEqual(["Conflict", "NotFound", "Timeout"]);
});

test("a widened type argument widens the row instead of silently keeping the narrow one", () => {
  const sources = [
    { fileName: "library.sm", source: LIBRARY },
    {
      fileName: "consumer.sm",
      source: `
        import { attempt, type Timeout } from "./library.sm"
        export class NotFound extends Error {}
        export function widened(id: string): Result<string, NotFound | Timeout> {
          return attempt<string, Error>(1, (): Result<string, NotFound> => {
            if (id === "") throw new NotFound()
            return id
          }).unwrap()
        }
      `,
    },
  ];
  const analysis = analyze(sources, "widened");
  // `Error` is not `NotFound`: the declared contract must be widened too, so
  // the omitted-failure rule fires rather than an unsound narrow row.
  const omitted = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1104");
  expect(omitted).toHaveLength(1);
  expect(omitted[0]!.message).toContain("Error");
});

test("rejects an explicit type argument that would narrow a callback's real row", () => {
  const sources = [
    { fileName: "library.sm", source: LIBRARY },
    {
      fileName: "consumer.sm",
      source: `
        import { attempt, type Timeout } from "./library.sm"
        export class NotFound extends Error {}
        export class Conflict extends Error {}
        export function unsound(id: string): Result<string, NotFound | Timeout> {
          return attempt<string, NotFound>(1, (): Result<string, Conflict> => {
            if (id === "x") throw new Conflict()
            return id
          }).unwrap()
        }
      `,
    },
  ];
  // Two authored `class X extends Error {}` declarations are the same
  // structural type, so stock assignability cannot reject this on its own.
  // The nominal coverage gate does: publishing `NotFound | Timeout` for a
  // callback that can only produce `Conflict` would be an unsound row.
  const analysis = analyze(sources, "unsound");
  const rejected = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1806");
  expect(rejected).toHaveLength(1);
  expect(rejected[0]!.message).toContain("Conflict");
  expect(rejected[0]!.message).toContain("NotFound | Timeout");

  const checked = compileAndCheckProject(sources, {
    rootDir: "/virtual/generic-rows-unsound",
    outDir: "/virtual/generic-rows-unsound-out",
    outputExtension: ".mjs",
    runtimeImport: RUNTIME,
    sourceMap: false,
  });
  expect(checked.ok).toBe(false);
});

test("fails closed for higher-order escape and for a still-deferred instantiation", () => {
  const escaped = analyze([
    { fileName: "library.sm", source: LIBRARY },
    {
      fileName: "consumer.sm",
      source: `
        import { attempt } from "./library.sm"
        declare function register(callback: unknown): void
        register(attempt)
      `,
    },
  ], "escaped");
  expect(escaped.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1802")).toBe(true);

  const conditional = analyze([
    {
      fileName: "library.sm",
      source: `
        export class Missing extends Error {}
        export class Invalid extends Error {}
        export type FailureFor<T> = T extends string ? Missing : Invalid
        export function pick<T>(value: T): Result<T, FailureFor<T>> {
          if (typeof value === "string") throw new Missing()
          throw new Invalid()
        }
      `,
    },
    {
      fileName: "consumer.sm",
      source: `
        import { pick, type FailureFor } from "./library.sm"
        export function resolved(): Result<string, FailureFor<string>> {
          return pick("value").unwrap()
        }
        export function forwarded<T>(value: T): Result<T, FailureFor<T>> {
          return pick(value).unwrap()
        }
      `,
    },
  ], "conditional");
  const deferred = conditional.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1803");
  // A conditional row the checker fully resolves at the site is instantiable;
  // the same row forwarded over the caller's own type parameter is not.
  expect(deferred).toHaveLength(1);
  expect(deferred[0]!.message).toContain("still unresolved at this call site");
  expect(conditional.files["consumer.sm"]!.rows.resolved!.failures).toEqual(["Missing"]);
});

test("emits declaration metadata carrying the instantiated row, not the template", () => {
  const sources = [
    { fileName: "library.sm", source: LIBRARY },
    {
      fileName: "consumer.sm",
      source: `
        import { attempt, type Timeout } from "./library.sm"
        export class NotFound extends Error {}
        export function load(id: string): Result<string, NotFound | Timeout> {
          return attempt(1, (): Result<string, NotFound> => {
            if (id === "") throw new NotFound()
            return id
          }).unwrap()
        }
      `,
    },
  ];
  const compiled = compileProject(sources, {
    rootDir: "/virtual/generic-rows-declarations",
    outDir: "/virtual/generic-rows-declarations-out",
    outputExtension: ".mjs",
    sourceMap: false,
    runtimeImport: RUNTIME,
  });
  expect(compiled.diagnostics).toEqual([]);

  const emitted = emitProjectDeclarations(Object.values(compiled.files).map((file) => ({
    fileName: file.outputFileName,
    code: file.code,
    effects: file.analysis.rows,
  })));
  expect(emitted.diagnostics.map((diagnostic) => diagnostic.messageText)).toEqual([]);
  expect(emitted.ok).toBe(true);

  const byName = new Map(emitted.outputs.map((output) => [output.fileName, output.code]));
  const consumer = [...byName].find(([name]) => name.endsWith("consumer.d.mts"))![1];
  const library = [...byName].find(([name]) => name.endsWith("library.d.mts"))![1];
  expect(readDeclarationEffects(consumer, "consumer.d.mts").load)
    .toEqual({ failures: ["NotFound", "Timeout"], requirements: [] });
  // The template itself keeps its type-parameter row members; they name the
  // declaration's own visible type parameters, not nominal row identities.
  expect(readDeclarationEffects(library, "library.d.mts").attempt)
    .toEqual({ failures: ["E", "Timeout"], requirements: [] });
});

test("module-local generic calls instantiate without a project pass", () => {
  const analysis = analyzeSource(`
    class Timeout extends Error {}
    class NotFound extends Error {}
    function attempt<A, E extends Error>(operation: () => Result<A, E>): Result<A, E | Timeout> {
      return operation().unwrap()
    }
    export function load(id: string): Result<string, NotFound | Timeout> {
      return attempt((): Result<string, NotFound> => {
        if (id === "") throw new NotFound()
        return id
      }).unwrap()
    }
  `);
  expect(analysis.diagnostics).toEqual([]);
  expect(analysis.rows.load!.failures).toEqual(["NotFound", "Timeout"]);
});
