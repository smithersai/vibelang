import { expect, test } from "bun:test";
import { resolve } from "node:path";
import * as ts from "typescript-js";
import { compileProject, emitProjectDeclarations } from "./index.ts";

/**
 * Coverage for the SHIPPED `.d.ts`, which nothing else in this repository
 * measures.
 *
 * Every other suite asserts a lowered module, a diagnostic list, or the row
 * metadata read back out of a declaration. None of them looks at the emitted
 * declaration text, and the conformance corpus has no declaration expectation
 * field at all, so a declaration-emit defect is invisible here and lands only
 * on the packages that compile against the artifact.
 *
 * Two independent measurements run over the emitted bytes:
 *
 *  1. `declarationRewrites` — the shipped declaration must be byte-identical to
 *     the declaration stock TypeScript emits for the same lowered module,
 *     except for the `@smithersEffects` lines Smithers adds and the exact
 *     return-channel lines a case names. A future pass that rewrites anything
 *     else fails here even where nobody thought to write a case for it.
 *  2. `consumerDiagnostics` — a consumer program is type-checked AGAINST the
 *     emitted declaration and its TypeScript error codes are asserted. This is
 *     the fail-open direction: a declaration that has quietly widened an input
 *     type produces no diagnostic anywhere in this repository, and only a
 *     downstream consumer can see it.
 */

const RUNTIME = resolve(import.meta.dir, "../runtime/index.ts");
const OUT_DIR = "/virtual/declaration-artifact-out";

interface AuthoredSource {
  readonly fileName: string;
  readonly source: string;
}

/**
 * Emit both the shipped declaration (rows attached, so the channel pass runs)
 * and the same batch with no rows at all, which is the raw stock-TypeScript
 * declaration for the identical lowered bytes.
 */
function emitBoth(sources: readonly AuthoredSource[], name: string): {
  readonly shipped: ReadonlyMap<string, string>;
  readonly raw: ReadonlyMap<string, string>;
} {
  const compiled = compileProject(sources, {
    rootDir: `/virtual/declaration-artifact-${name}`,
    outDir: OUT_DIR,
    outputExtension: ".mjs",
    sourceMap: false,
    runtimeImport: RUNTIME,
  });
  expect(compiled.diagnostics).toEqual([]);
  const files = Object.values(compiled.files);
  const emit = (withRows: boolean) => {
    const result = emitProjectDeclarations(files.map((file) => ({
      fileName: file.outputFileName,
      code: file.code,
      ...(withRows ? { effects: file.analysis.rows } : {}),
    })));
    expect(result.diagnostics.map((diagnostic) => diagnostic.messageText)).toEqual([]);
    expect(result.ok).toBe(true);
    return new Map(result.outputs.map((output) => [output.fileName, output.code]));
  };
  return { shipped: emit(true), raw: emit(false) };
}

/** The declaration text with the compiler's own metadata lines removed. */
function withoutEffectTags(code: string): readonly string[] {
  return code.split("\n").filter((line) => !line.includes("@smithersEffects"));
}

/**
 * Every line the Smithers declaration pass changed, as `before -> after`. An
 * empty list means the shipped artifact is stock TypeScript's own output.
 */
function declarationRewrites(shipped: ReadonlyMap<string, string>, raw: ReadonlyMap<string, string>): string[] {
  const rewrites: string[] = [];
  expect([...shipped.keys()].sort()).toEqual([...raw.keys()].sort());
  for (const [fileName, code] of [...shipped].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const after = withoutEffectTags(code);
    const before = raw.get(fileName)!.split("\n");
    expect([fileName, after.length]).toEqual([fileName, before.length]);
    for (const [index, line] of after.entries()) {
      if (line !== before[index]) rewrites.push(`${before[index]!.trim()} -> ${line.trim()}`);
    }
  }
  return rewrites;
}

/**
 * Type-check `consumer` against the emitted declarations and return the
 * TypeScript error codes it reports. The declarations are the only description
 * of the library the consumer can see, exactly as a downstream package sees it.
 */
function consumerDiagnostics(declarations: ReadonlyMap<string, string>, consumer: string): readonly string[] {
  const entry = resolve(OUT_DIR, "consumer.mts");
  const virtual = new Map<string, string>([...declarations, [entry, consumer]]);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
  };
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  const realpath = host.realpath?.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const code = virtual.get(resolve(name));
    return code === undefined
      ? getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(resolve(name), code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  };
  host.fileExists = (name) => virtual.has(resolve(name)) || fileExists(name);
  host.readFile = (name) => virtual.get(resolve(name)) ?? readFile(name);
  host.directoryExists = (name) => resolve(name) === resolve(OUT_DIR) || Boolean(directoryExists?.(name));
  host.realpath = (name) => (virtual.has(resolve(name)) ? resolve(name) : realpath?.(name) ?? name);
  const program = ts.createProgram({ rootNames: [entry], options, host });
  return ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => `TS${diagnostic.code}`)
    .sort();
}

/**
 * `User.Result` shares only its terminal spelling with the compiler's channel,
 * and it sits in a PARAMETER, which no generated channel occupies. Recognizing
 * the channel by that spelling published `User.Result<string, RangeError>` here
 * — a type the author never wrote and the implementation never handled.
 */
const UNRELATED_USER_TYPE = `
  export class Boom extends Error {}

  export namespace User {
    export interface Result<A, B> {
      left: A
      takeLeft: (value: A) => void
      right: B
      takeRight: (value: B) => void
    }
  }

  export function run(
    input: User.Result<string, never> | User.Result<never, RangeError>
  ): Result<number, Boom> {
    throw new Boom()
  }
`;

/**
 * The compiler's own `Result`, in a union the AUTHOR wrote. Every member is a
 * genuine runtime channel reference, so provenance alone does not save it:
 * merging the members publishes `Result<string | number, ParseError |
 * RangeError>`, a strict supertype pairing `number` with `ParseError`.
 */
const AUTHORED_RUNTIME_UNION = `
  export class ParseError extends Error {}
  export function pick(
    input: Result<string, ParseError> | Result<number, RangeError>
  ): Result<string, ParseError> {
    if (input.isOk()) throw new ParseError()
    throw new ParseError()
  }
`;

test("an unrelated user type spelled Result is shipped exactly as authored", () => {
  const { shipped, raw } = emitBoth([{ fileName: "main.sm", source: UNRELATED_USER_TYPE }], "unrelated");
  expect(declarationRewrites(shipped, raw)).toEqual([]);
  expect([...shipped.values()][0]).toContain(
    "export declare function run(input: User.Result<string, never> | User.Result<never, RangeError>):" +
      " Result<number, Boom>;",
  );
});

test("a consumer of that declaration still gets TS2345 on a wrong argument", () => {
  const { shipped } = emitBoth([{ fileName: "main.sm", source: UNRELATED_USER_TYPE }], "unrelated-consumer");
  // The authored union admits `<string, never>` and `<never, RangeError>` and
  // refuses the merged `<string, RangeError>`. A collapsed declaration accepts
  // all three and reports nothing at all — invisible to this repository.
  const call = (argument: string) => `
    import { run, type User } from "./main.mjs"
    declare const value: ${argument}
    run(value)
  `;
  expect(consumerDiagnostics(shipped, call("User.Result<string, never>"))).toEqual([]);
  expect(consumerDiagnostics(shipped, call("User.Result<never, RangeError>"))).toEqual([]);
  expect(consumerDiagnostics(shipped, call("User.Result<string, RangeError>"))).toEqual(["TS2345"]);
});

test("an authored union of real runtime Results is shipped exactly as authored", () => {
  const { shipped, raw } = emitBoth([{ fileName: "main.sm", source: AUTHORED_RUNTIME_UNION }], "authored-union");
  expect(declarationRewrites(shipped, raw)).toEqual([]);
  expect([...shipped.values()][0]).toContain(
    "export declare function pick(input: Result<string, ParseError> | Result<number, RangeError>):" +
      " Result<string, ParseError>;",
  );
});

test("a consumer of that declaration still gets TS2345 on a merged Result", () => {
  const { shipped } = emitBoth([{ fileName: "main.sm", source: AUTHORED_RUNTIME_UNION }], "authored-union-consumer");
  const call = (argument: string) => `
    import { pick, type ParseError } from "./main.mjs"
    import type { Result } from ${JSON.stringify(RUNTIME)}
    declare const value: ${argument}
    pick(value)
  `;
  expect(consumerDiagnostics(shipped, call("Result<string, ParseError>"))).toEqual([]);
  expect(consumerDiagnostics(shipped, call("Result<number, RangeError>"))).toEqual([]);
  // The merged type the collapse used to publish. It must not type-check.
  expect(consumerDiagnostics(shipped, call("Result<string | number, ParseError | RangeError>")))
    .toEqual(["TS2345"]);
});

test("a namespace-qualified foreign type spelled Result is shipped exactly as authored", () => {
  const { shipped, raw } = emitBoth([
    {
      fileName: "types.sm",
      source: `
        export interface Result<A, B> { readonly left: A; readonly right: B }
      `,
    },
    {
      fileName: "main.sm",
      source: `
        import type * as user from "./types.sm"
        export class Boom extends Error {}
        export function run(
          input: user.Result<string, never> | user.Result<never, RangeError>
        ): Result<number, Boom> {
          throw new Boom()
        }
      `,
    },
  ], "namespace-qualified");
  expect(declarationRewrites(shipped, raw)).toEqual([]);
  expect([...shipped].find(([name]) => name.endsWith("main.d.mts"))![1]).toContain(
    "export declare function run(input: user.Result<string, never> | user.Result<never, RangeError>):" +
      " Result<number, Boom>;",
  );
});

test("the compiler-generated channel is still collapsed, and only it", () => {
  const { shipped, raw } = emitBoth([{
    fileName: "main.sm",
    source: `
      export class Missing extends Error {}
      // Not exported, so the checker infers the split channel rather than
      // requiring an authored Result contract; the alias publishes it. The
      // parameter carries the SAME complementary-never shape over a type that
      // is not the runtime channel, so provenance and position are the only
      // things separating the two unions in one declaration.
      function inner(input: Map<string, never> | Map<never, Missing>, id: string) {
        if (id === "") throw new Missing()
        return input
      }
      export const load = inner
    `,
  }], "generated-channel");
  const runtime = JSON.stringify(RUNTIME).slice(1, -1);
  const parameters = "input: Map<string, never> | Map<never, Missing>, id: string";
  const success = "Map<string, never> | Map<never, Missing>";
  expect(declarationRewrites(shipped, raw)).toEqual([
    `declare function inner(${parameters}): import("${runtime}").Result<never, Missing> |` +
      ` import("${runtime}").Result<${success}, never>;` +
      ` -> declare function inner(${parameters}): import("${runtime}").Result<${success}, Missing>;`,
  ]);
});

test("a consumer reads the collapsed channel as one Result", () => {
  const { shipped } = emitBoth([{
    fileName: "main.sm",
    source: `
      export class Missing extends Error {}
      function inner(id: string) {
        if (id === "") throw new Missing()
        return id
      }
      export const load = inner
    `,
  }], "collapsed-consumer");
  expect(consumerDiagnostics(shipped, `
    import { load, type Missing } from "./main.mjs"
    import type { Result } from ${JSON.stringify(RUNTIME)}
    declare const sink: (value: Result<string, Missing>) => void
    sink(load("id"))
  `)).toEqual([]);
  expect(consumerDiagnostics(shipped, `
    import { load } from "./main.mjs"
    declare const sink: (value: string) => void
    sink(load("id"))
  `)).toEqual(["TS2345"]);
});
