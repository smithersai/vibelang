import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { EmittedDiagnostic } from "./generated-check.ts";
import { compileVibeLang } from "./compile.ts";
import { checkEmittedProject, compileAndCheckProject } from "./validate.ts";
import { registerErrorType } from "../runtime/index.ts";

const GENERATED = resolve(import.meta.dir, "nominal.generated.ts");
const PROBE = resolve(import.meta.dir, "nominal.probe.ts");

const SOURCE = `
export class NotFound extends Error {}
export class Conflict extends Error {}
abstract class Family extends Error {}
export class FamilyLeft extends Family {}
export class Parameterized<T> extends Error {
  constructor(readonly detail: T) { super("parameterized") }
}
export function find(id: string): Result<string, NotFound> {
  if (id === "") throw new NotFound()
  return id
}
`;

function compile() {
  return compileVibeLang(SOURCE, {
    fileName: resolve(import.meta.dir, "nominal.vibe"),
    outputFileName: GENERATED,
    sourceName: "nominal.vibe",
    runtimeImport: resolve(import.meta.dir, "../runtime/index.ts"),
    sourceMap: false,
  });
}

/** Drop exactly the emitted type-only nominal merge, keeping everything else. */
function withoutNominalMerges(code: string): string {
  const lines = code.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^(?:export )?interface \w+ extends __vsNominalError<"[^"]*"> \{$/.test(lines[index]!)) {
      expect(lines[index + 1]).toBe("}");
      index += 1;
      continue;
    }
    kept.push(lines[index]!);
  }
  return kept.join("\n");
}

function errorsOf(diagnostics: readonly EmittedDiagnostic[]): readonly string[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.category === "error")
    .map((diagnostic) => diagnostic.message);
}

// The probe fails to compile unless same-shape siblings are nominally
// distinct: without the brand the assignment succeeds and the directive is
// reported as unused.
const PROBE_CODE = `
import type { Conflict, NotFound } from "./nominal.generated.ts";
export function siblingsAreDistinct(error: NotFound): Conflict {
  // @ts-expect-error same-shape sibling Errors must not be mutually assignable
  return error;
}
`;

test("emits a type-only nominal merge beside each registered Error class", () => {
  const compiled = compile();
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(compiled.code).toMatch(/import \{[^}]*\btype NominalError as __vsNominalError[, }]/);
  expect(compiled.code)
    .toContain('export interface NotFound extends __vsNominalError<"vibelang:nominal.vibe:NotFound"> {');
  expect(compiled.code)
    .toContain('export interface Conflict extends __vsNominalError<"vibelang:nominal.vibe:Conflict"> {');
  // The brand identity is exactly the runtime registration identity.
  expect(compiled.code).toContain('__vsRegisterError(NotFound, "vibelang:nominal.vibe:NotFound");');

  // Exactly one level of an inheritance chain may carry a brand, and a generic
  // Error class would need its type parameter list restated, so both are left
  // to inherit / go unbranded.
  expect(compiled.code).toContain("interface Family extends __vsNominalError<");
  expect(compiled.code).not.toContain("interface FamilyLeft extends __vsNominalError<");
  expect(compiled.code).not.toContain("interface Parameterized extends __vsNominalError<");
});

test("the nominal merge makes same-shape siblings distinct in the generated program", () => {
  const compiled = compile();
  expect(errorsOf(checkEmittedProject([
    { fileName: GENERATED, code: compiled.code },
    { fileName: PROBE, code: PROBE_CODE },
  ]))).toEqual([]);

  // Remove only the merge lines: the same probe stops type-checking, which is
  // what proves the merge (and not something else) supplies the narrowing.
  const unbranded = errorsOf(checkEmittedProject([
    { fileName: GENERATED, code: withoutNominalMerges(compiled.code) },
    { fileName: PROBE, code: PROBE_CODE },
  ]));
  expect(unbranded.length).toBeGreaterThan(0);
  expect(unbranded.join("\n")).toContain("Unused '@ts-expect-error' directive");
});

test("a cross-module Error subclass inherits its ancestor's brand", () => {
  const sources = [
    { fileName: "base.vibe", source: `export class Base extends Error {}\n` },
    {
      fileName: "leaf.vibe",
      source: `import { Base } from "./base.vibe"
export class Sub extends Base {}
export function fail(): Result<string, Sub> { throw new Sub() }
`,
    },
  ];
  const checked = compileAndCheckProject(sources, {
    rootDir: "/virtual/nominal-chain",
    outDir: "/virtual/nominal-chain-out",
    outputExtension: ".ts",
    runtimeImport: resolve(import.meta.dir, "../runtime/index.ts"),
    sourceMap: false,
  });
  expect(checked.result.diagnostics).toEqual([]);
  // Only the top of the chain is branded, so the generated program has no
  // conflicting inherited brand property.
  expect(checked.result.files["base.vibe"]!.code).toContain("interface Base extends __vsNominalError<");
  expect(checked.result.files["leaf.vibe"]!.code).not.toContain("interface Sub extends __vsNominalError<");
  expect(errorsOf(checked.emitDiagnostics)).toEqual([]);
  expect(checked.ok).toBe(true);
});

test("the nominal merge leaves the emitted JavaScript byte-identical", () => {
  const compiled = compile();
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
  const branded = transpiler.transformSync(compiled.code);
  const plain = transpiler.transformSync(withoutNominalMerges(compiled.code));
  expect(branded).toBe(plain);
  expect(branded).not.toContain("NominalError");
  // The registrations, and therefore every runtime shape, are untouched.
  expect(branded).toContain('__vsRegisterError(NotFound, "vibelang:nominal.vibe:NotFound")');
});

test("a non-ASCII Error class name mints an identity the runtime accepts", () => {
  // failures.mdx, "Error Classes": ANY named class extending `Error` is a
  // nominal recoverable error. `Café` is an ordinary TypeScript identifier, so
  // the identity minted for it must be one the runtime validator admits —
  // otherwise the program type-checks and then dies registering itself.
  const compiled = compileVibeLang(`
export class Café extends Error {}
export function seat(who: string): Result<string, Café> {
  if (who === "ada") return "table 4"
  throw new Café()
}
`, {
    fileName: resolve(import.meta.dir, "nominal-unicode.vibe"),
    outputFileName: resolve(import.meta.dir, "nominal-unicode.generated.ts"),
    sourceName: "nominal-unicode.vibe",
    runtimeImport: resolve(import.meta.dir, "../runtime/index.ts"),
    sourceMap: false,
  });
  expect(compiled.analysis.diagnostics).toEqual([]);
  // The printer escapes the literal; the identity it denotes is the class name.
  expect(compiled.code).toContain('__vsRegisterError(Café, "vibelang:nominal-unicode.vibe:Caf\\u00E9")');
  expect(JSON.parse(/__vsRegisterError\(Café, (".*?")\);/.exec(compiled.code)![1]!))
    .toBe("vibelang:nominal-unicode.vibe:Café");

  class Café extends Error {}
  expect(registerErrorType(Café, "vibelang:nominal-unicode.vibe:Café")).toBe(Café);
});
