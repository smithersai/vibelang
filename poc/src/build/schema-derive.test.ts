import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as ts from "typescript-js";
import { checkEmittedProject } from "../language/validate.ts";
import { decodeError, encodeError } from "../runtime/index.ts";
import {
  COMPTIME_MODULE_SPECIFIER,
  ComptimeCompiler,
  ComptimeIntrinsicDiagnosticCode,
  compileComptimeIntrinsics,
  digest,
  SCHEMA_MODULE_SPECIFIER,
  SCHEMA_RUNTIME_BINDING,
  SCHEMA_RUNTIME_ERROR,
  SCHEMA_RUNTIME_GUARD_SOURCE,
  SchemaDerivationLimits,
  ValidationError,
  __vsSchema,
  type SchemaDescriptor,
} from "./index.ts";

const BUILD_DIRECTORY = import.meta.dir;
const SCHEMA_RUNTIME_PATH = resolve(BUILD_DIRECTORY, "schema-runtime.ts");

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function compiler(): Promise<{ root: string; cache: string; compiler: ComptimeCompiler }> {
  const root = await mkdtemp(join(tmpdir(), "vibelang-schema-derive-"));
  roots.push(root);
  const cache = join(root, ".cache");
  return { root, cache, compiler: new ComptimeCompiler({ root, cacheDirectory: cache, target: "node" }) };
}

function dataModule(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const IMPORTS = [
  `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
  `import { Schema } from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)};`,
].join("\n");

/** Compile one in-memory file whose generated code can resolve the real engine. */
async function lower(source: string, fileName = "main.ts"): Promise<{
  readonly ok: boolean;
  readonly codes: readonly string[];
  readonly messages: readonly string[];
  readonly descriptor?: SchemaDescriptor;
  readonly code?: string;
  readonly identity?: string;
  readonly key?: string;
  readonly cacheHit?: boolean;
}> {
  const build = await compiler();
  return lowerWith(build.compiler, source, fileName);
}

async function lowerWith(
  instance: ComptimeCompiler,
  source: string,
  fileName = "main.ts",
): Promise<{
  readonly ok: boolean;
  readonly codes: readonly string[];
  readonly messages: readonly string[];
  readonly descriptor?: SchemaDescriptor;
  readonly code?: string;
  readonly identity?: string;
  readonly key?: string;
  readonly cacheHit?: boolean;
}> {
  const result = await compileComptimeIntrinsics({
    compiler: instance,
    sources: { [fileName]: source },
    schemaRuntimeImport: "./schema-runtime.ts",
  });
  return {
    ok: result.ok,
    codes: result.diagnostics.map((diagnostic) => diagnostic.code),
    messages: result.diagnostics.map((diagnostic) => diagnostic.message),
    descriptor: result.calls[0]?.value as SchemaDescriptor | undefined,
    code: result.loweredSources?.[fileName],
    identity: result.loweredFiles?.[fileName]?.identity,
    key: result.calls[0]?.build.key,
    cacheHit: result.calls[0]?.build.cacheHit,
  };
}

/** Derive one root type and return the descriptor the frontend cached. */
async function derive(declarations: string, typeText: string): Promise<SchemaDescriptor> {
  const lowered = await lower([
    IMPORTS,
    declarations,
    `export const Derived = comptime(Schema.derive<${typeText}>());`,
  ].join("\n"));
  if (!lowered.ok) throw new Error(`derivation failed: ${lowered.codes.join(",")} ${lowered.messages.join(" | ")}`);
  return lowered.descriptor!;
}

async function rejects(declarations: string, typeText: string): Promise<{ code: string; message: string }> {
  const lowered = await lower([
    IMPORTS,
    declarations,
    `export const Derived = comptime(Schema.derive<${typeText}>());`,
  ].join("\n"));
  expect(lowered.ok).toBe(false);
  expect(lowered.code).toBeUndefined();
  return { code: lowered.codes[0]!, message: lowered.messages[0]! };
}

function parsed(descriptor: SchemaDescriptor, value: unknown): { ok: boolean; value?: unknown; pointer?: string; reason?: string } {
  return __vsSchema<unknown>(descriptor).parse(value).match({
    ok: (parsedValue) => ({ ok: true, value: parsedValue }),
    error: (error) => ({ ok: false, pointer: error.pointer, reason: error.reason }),
  });
}

describe("comptime Schema.derive reification", () => {
  test("derives the whole supported descriptor grammar from one checked type", async () => {
    const descriptor = await derive(
      [
        `type Contact = { email: string; verified: boolean };`,
        `type Signup = {`,
        `  email: string;`,
        `  age: number;`,
        `  active: boolean;`,
        `  deletedAt: null;`,
        `  role: "admin" | "member";`,
        `  retries: 0 | 1;`,
        `  nickname?: string;`,
        `  tags: string[];`,
        `  point: [number, string];`,
        `  contact: Contact;`,
        `  fallback: string | null;`,
        `  toggles: boolean[];`,
        `  contacts: readonly Contact[];`,
        `};`,
      ].join("\n"),
      "Signup",
    );
    expect(descriptor).toEqual({
      kind: "object",
      properties: [
        { name: "active", optional: false, value: { kind: "boolean" } },
        { name: "age", optional: false, value: { kind: "number" } },
        {
          name: "contact",
          optional: false,
          value: {
            kind: "object",
            properties: [
              { name: "email", optional: false, value: { kind: "string" } },
              { name: "verified", optional: false, value: { kind: "boolean" } },
            ],
          },
        },
        {
          name: "contacts",
          optional: false,
          value: {
            kind: "array",
            element: {
              kind: "object",
              properties: [
                { name: "email", optional: false, value: { kind: "string" } },
                { name: "verified", optional: false, value: { kind: "boolean" } },
              ],
            },
          },
        },
        { name: "deletedAt", optional: false, value: { kind: "null" } },
        { name: "email", optional: false, value: { kind: "string" } },
        { name: "fallback", optional: false, value: { kind: "union", variants: [{ kind: "null" }, { kind: "string" }] } },
        { name: "nickname", optional: true, value: { kind: "string" } },
        { name: "point", optional: false, value: { kind: "tuple", elements: [{ kind: "number" }, { kind: "string" }] } },
        { name: "retries", optional: false, value: { kind: "union", variants: [{ kind: "literal", value: 0 }, { kind: "literal", value: 1 }] } },
        { name: "role", optional: false, value: { kind: "union", variants: [{ kind: "literal", value: "admin" }, { kind: "literal", value: "member" }] } },
        { name: "tags", optional: false, value: { kind: "array", element: { kind: "string" } } },
        { name: "toggles", optional: false, value: { kind: "array", element: { kind: "boolean" } } },
      ],
    });
  });

  test("round-trips valid data and reports path-accurate failures", async () => {
    const descriptor = await derive(
      [
        `type Meta = { source: string | null; retries?: number };`,
        `type Payload = { email: string; tags: string[]; point: [number, number]; meta: Meta };`,
      ].join("\n"),
      "Payload",
    );
    const valid = { email: "a@b.c", tags: ["x", "y"], point: [1, 2], meta: { source: null } };
    const success = parsed(descriptor, valid);
    expect(success.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(success.value))).toEqual(valid);

    expect(parsed(descriptor, { ...valid, tags: ["x", 7] })).toMatchObject({
      ok: false,
      pointer: "$.tags[1]",
      reason: "expected string",
    });
    expect(parsed(descriptor, { ...valid, meta: { source: 7 } })).toMatchObject({
      ok: false,
      pointer: "$.meta.source",
      reason: "expected null | string",
    });
    expect(parsed(descriptor, { ...valid, point: [1] })).toMatchObject({
      ok: false,
      pointer: "$.point",
      reason: "expected a 2-element tuple but received 1",
    });
    expect(parsed(descriptor, { tags: [], point: [1, 2], meta: { source: null } })).toMatchObject({
      ok: false,
      pointer: "$.email",
      reason: "is required and expected string",
    });
    expect(parsed(descriptor, { ...valid, extra: 1 })).toMatchObject({
      ok: false,
      pointer: "$.extra",
      reason: "is not declared by the derived type",
    });
    expect(parsed(descriptor, null)).toMatchObject({ ok: false, pointer: "$", reason: "expected an object" });
    expect(parsed(descriptor, { ...valid, meta: { source: "s", retries: 3 } }).ok).toBe(true);
    expect(parsed(descriptor, { ...valid, meta: { source: "s", retries: "3" } })).toMatchObject({
      pointer: "$.meta.retries",
      reason: "expected number",
    });
  });

  test("rejects prototype-borrowed, exotic, and non-finite runtime values", async () => {
    const descriptor = await derive(`type Row = { role: string; scores: number[] };`, "Row");
    // A borrowed prototype never satisfies an exact object: the value is
    // rejected at its own root rather than reading an inherited property.
    const inherited = Object.create({ role: "admin" }) as Record<string, unknown>;
    inherited.scores = [];
    expect(parsed(descriptor, inherited)).toMatchObject({ ok: false, pointer: "$", reason: "expected an object" });
    expect(parsed(descriptor, Object.assign(Object.create(null), { role: "admin", scores: [] })).ok).toBe(true);

    const accessor = { scores: [] as number[] };
    Object.defineProperty(accessor, "role", { get: () => "admin", enumerable: true });
    expect(parsed(descriptor, accessor)).toMatchObject({ ok: false, pointer: "$.role" });

    const sparse = [1, 2];
    delete (sparse as unknown as Record<string, unknown>)["0"];
    expect(parsed(descriptor, { role: "admin", scores: sparse })).toMatchObject({
      ok: false,
      pointer: "$.scores[0]",
      reason: "is not an enumerable data property",
    });
    const tagged = [1];
    (tagged as unknown as Record<string, unknown>).extra = "x";
    expect(parsed(descriptor, { role: "admin", scores: tagged })).toMatchObject({
      ok: false,
      pointer: "$.scores",
      reason: "expected a plain array without extra properties",
    });

    expect(parsed(descriptor, { role: "admin", scores: [Number.NaN] })).toMatchObject({
      ok: false,
      pointer: "$.scores[0]",
      reason: "expected number",
    });
    expect(parsed(descriptor, { role: "admin", scores: [] }).ok).toBe(true);
  });

  test("keeps a __proto__ property name in data position without touching a prototype", async () => {
    const descriptor = await derive(`type Weird = { "__proto__": string };`, "Weird");
    expect(descriptor).toEqual({
      kind: "object",
      properties: [{ name: "__proto__", optional: false, value: { kind: "string" } }],
    });
    const input = JSON.parse('{"__proto__":"payload"}') as Record<string, unknown>;
    const result = parsed(descriptor, input);
    expect(result.ok).toBe(true);
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(result.value as object, "__proto__")?.value).toBe("payload");
  });

  test("collapses optional booleans and duplicate union variants canonically", async () => {
    expect(await derive(`type Flags = { on?: boolean; mode: "a" | "a" | "b" };`, "Flags")).toEqual({
      kind: "object",
      properties: [
        { name: "mode", optional: false, value: { kind: "union", variants: [{ kind: "literal", value: "a" }, { kind: "literal", value: "b" }] } },
        { name: "on", optional: true, value: { kind: "boolean" } },
      ],
    });
  });

  test("recognizes named, aliased, and namespace imports by checker identity", async () => {
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `import { Schema, Schema as Reify } from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)};`,
      `import * as Compiler from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)};`,
      `type Row = { id: number };`,
      `export const direct = comptime(Schema.derive<Row>());`,
      `export const alias = comptime(Reify.derive<Row>());`,
      `export const namespaced = comptime(Compiler.Schema.derive<Row>());`,
    ].join("\n");
    const build = await compiler();
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "main.ts": source },
      schemaRuntimeImport: "./schema-runtime.ts",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.calls).toHaveLength(3);
    expect(result.calls.every((call) => JSON.stringify(call.value) === JSON.stringify(result.calls[0]!.value))).toBe(true);
    const lowered = result.loweredSources!["main.ts"]!;
    expect(lowered).not.toContain(SCHEMA_MODULE_SPECIFIER);
    // One module edge per file, however many derive calls or import spellings.
    expect(lowered.split(`${SCHEMA_RUNTIME_BINDING} }`)).toHaveLength(2);
    expect(lowered).toContain(`${SCHEMA_RUNTIME_BINDING}<Row>(`);
    expect(checkEmittedProject([{ fileName: join(BUILD_DIRECTORY, "__schema_alias__.ts"), code: lowered }]))
      .toEqual([]);
  });

  test("rejects a spelling-only imposter that never resolves to the compiler intrinsic", async () => {
    const imposter = await lower([
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `type Row = { id: number };`,
      `const Schema = { derive<T>(): { parse(value: unknown): T } { throw new Error("no"); } };`,
      `export const Derived = comptime(Schema.derive<Row>());`,
    ].join("\n"));
    expect(imposter.ok).toBe(false);
    expect(imposter.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaUnrelatedIdentity);
    expect(imposter.code).toBeUndefined();

    const unbound = await lower([
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `type Row = { id: number };`,
      `export const Derived = comptime((Schema as any).derive<Row>());`,
    ].join("\n"));
    expect(unbound.ok).toBe(false);
    expect(unbound.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaUnrelatedIdentity);
  });

  test("derive is valid only as the whole argument of an explicit comptime root", async () => {
    const bare = await lower([IMPORTS, `type Row = { id: number };`, `export const S = Schema.derive<Row>();`].join("\n"));
    expect(bare.ok).toBe(false);
    expect(bare.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaOutsideComptime);

    const nested = await lower([
      IMPORTS,
      `type Row = { id: number };`,
      `export const S = comptime({ inner: Schema.derive<Row>() });`,
    ].join("\n"));
    expect(nested.ok).toBe(false);
    expect(nested.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaOutsideComptime);

    const escaped = await lower([IMPORTS, `export const S = Schema;`].join("\n"));
    expect(escaped.ok).toBe(false);
    expect(escaped.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaOutsideComptime);

    const wrapped = await lower([
      IMPORTS,
      `type Row = { id: number };`,
      `export const S = comptime((Schema.derive<Row>()));`,
    ].join("\n"));
    expect(wrapped.ok).toBe(true);
  });

  test("rejects malformed derive calls and malformed compiler-module imports", async () => {
    const shape = await lower([
      IMPORTS,
      `type Row = { id: number };`,
      `export const S = comptime(Schema.derive<Row>(1 as never));`,
    ].join("\n"));
    expect(shape.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaCallShape);

    const noTypeArgument = await lower([IMPORTS, `export const S = comptime(Schema.derive());`].join("\n"));
    expect(noTypeArgument.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaCallShape);

    const badImport = await lower([
      `import Schema from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)};`,
      `export const S = 1;`,
    ].join("\n"));
    expect(badImport.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaImportShape);

    const unknownExport = await lower([
      `import { derive } from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)};`,
      `export const S = 1;`,
    ].join("\n"));
    expect(unknownExport.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaImportShape);

    const typeOnly = await lower([
      `import type { Schema } from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)};`,
      `export const S = 1;`,
    ].join("\n"));
    expect(typeOnly.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaImportShape);

    const javascript = await lower(
      [`import { Schema } from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)};`, `export const S = 1;`].join("\n"),
      "main.js",
    );
    expect(javascript.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaImportShape);
  });

  test("refuses to lower a file that already binds the reserved runtime identifier", async () => {
    const reserved = await lower([
      IMPORTS,
      `type Row = { id: number };`,
      `const ${SCHEMA_RUNTIME_BINDING} = 1;`,
      `export const S = comptime(Schema.derive<Row>());`,
      `export const used = ${SCHEMA_RUNTIME_BINDING};`,
    ].join("\n"));
    expect(reserved.ok).toBe(false);
    expect(reserved.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaReservedIdentifier);
  });

  test("every unreifiable type category fails closed with a stable code", async () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ["", "any", "any"],
      ["", "unknown", "unknown"],
      ["", "never", "never"],
      ["", "void", "void"],
      ["", "undefined", "undefined"],
      ["", "object", "non-primitive"],
      ["", "bigint", "bigint"],
      ["", "symbol", "symbol"],
      ["", "() => void", "function type"],
      ["", "{ go(): void }", "method"],
      ["", "{ handler: (value: string) => void }", "function type"],
      ["class Account { id = 1; }", "Account", "class instance type"],
      ["", "Date", "method"],
      ["", "Map<string, string>", "method"],
      ["", "Record<string, string>", "index signature"],
      ["", "{ a: string } & { b: number }", "intersection"],
      ["enum Level { Low = \"low\" }", "Level", "enum"],
      ["type Chain = { next: Chain | null };", "Chain", "recursive"],
      ["", "[number, ...string[]]", "tuple with optional, rest, or variadic"],
      ["", "[number, string?]", "tuple with optional, rest, or variadic"],
      ["", "{ a: string | undefined }", "undefined"],
      ["", "`prefix-${string}`", "unresolved type operator"],
      ["", "new () => object", "constructor type"],
    ];
    for (const [declarations, typeText, fragment] of cases) {
      const failure = await rejects(declarations, typeText);
      expect(`${typeText} => ${failure.code}`).toBe(
        `${typeText} => ${ComptimeIntrinsicDiagnosticCode.SchemaUnsupportedType}`,
      );
      expect(`${typeText} => ${failure.message}`).toContain(fragment);
    }
  });

  test("a free type parameter is never reified into a runtime check", async () => {
    const failure = await lower([
      IMPORTS,
      `export function schemaFor<T>() { return comptime(Schema.derive<T>()); }`,
    ].join("\n"));
    expect(failure.ok).toBe(false);
    expect(failure.codes).toContain(ComptimeIntrinsicDiagnosticCode.SchemaUnsupportedType);
    expect(failure.messages.join(" ")).toContain("free type parameter");
  });

  test("bounded reification budgets fail closed", async () => {
    const deep = `type Deep = ${"{ a: ".repeat(SchemaDerivationLimits.maximumDepth + 2)}string${" }".repeat(SchemaDerivationLimits.maximumDepth + 2)};`;
    const depth = await rejects(deep, "Deep");
    expect(depth.code).toBe(ComptimeIntrinsicDiagnosticCode.SchemaBudget);

    const wide = `type Wide = { ${Array.from(
      { length: SchemaDerivationLimits.maximumProperties + 1 },
      (_, index) => `p${index}: string`,
    ).join("; ")} };`;
    const width = await rejects(wide, "Wide");
    expect(width.code).toBe(ComptimeIntrinsicDiagnosticCode.SchemaBudget);

    const variants = `type Wide = ${Array.from(
      { length: SchemaDerivationLimits.maximumUnionVariants + 1 },
      (_, index) => `"v${index}"`,
    ).join(" | ")};`;
    const union = await rejects(variants, "Wide");
    expect(union.code).toBe(ComptimeIntrinsicDiagnosticCode.SchemaBudget);
  });

  test("identical inputs produce byte-identical lowered output and reuse the cache", async () => {
    const build = await compiler();
    const source = [
      IMPORTS,
      `type Row = { id: number; label?: string };`,
      `export const Derived = comptime(Schema.derive<Row>());`,
    ].join("\n");
    const first = await lowerWith(build.compiler, source);
    const second = await lowerWith(build.compiler, source);
    expect(first.ok).toBe(true);
    expect(second.code).toBe(first.code!);
    expect(second.identity).toBe(first.identity!);
    expect(second.key).toBe(first.key!);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);

    // Descriptor bytes are the cached value, so a type edit is a cache miss.
    const edited = await lowerWith(
      build.compiler,
      source.replace("id: number", "id: string"),
    );
    expect(edited.key).not.toBe(first.key!);
    expect(edited.cacheHit).toBe(false);

    // Declaration order is not descriptor identity: properties are canonical.
    const reordered = await lowerWith(
      build.compiler,
      [IMPORTS, `type Row = { label?: string; id: number };`, `export const Derived = comptime(Schema.derive<Row>());`].join("\n"),
    );
    expect(JSON.stringify(reordered.descriptor)).toBe(JSON.stringify(first.descriptor));
  });

  test("lowered output is valid self-contained TypeScript whose success type is the original T", async () => {
    const build = await compiler();
    const source = [
      IMPORTS,
      `type Signup = { email: string; age: number; nickname?: string };`,
      `const SignupSchema = comptime(Schema.derive<Signup>());`,
      `export function handle(body: unknown): string {`,
      `  return SignupSchema.parse(body).match({`,
      `    ok: (request: Signup) => request.email,`,
      `    error: (failure) => failure.pointer + " " + failure.reason,`,
      `  });`,
      `}`,
      // Deliberate proof that checking sees Result<Signup, ValidationError>.
      `export const exact: Signup = SignupSchema.parse({}).unwrap();`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "main.ts": source },
      schemaRuntimeImport: "./schema-runtime.ts",
    });
    expect(result.diagnostics).toEqual([]);
    const code = result.loweredSources!["main.ts"]!;
    const diagnostics = checkEmittedProject([{ fileName: join(BUILD_DIRECTORY, "__schema_typed__.ts"), code }]);
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);

    const widened = code.replace("export const exact: Signup", "export const exact: { email: number }");
    const rejected = checkEmittedProject([{ fileName: join(BUILD_DIRECTORY, "__schema_widened__.ts"), code: widened }]);
    expect(rejected.length).toBeGreaterThan(0);
  });

  test("lowers .vibe source and records the generated edge in provenance", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)}`,
      `import { Schema } from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)}`,
      `type Row = { id: number, label?: string }`,
      `export const RowSchema = comptime(Schema.derive<Row>())`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "main.vibe": source },
      schemaRuntimeImport: "vibelang/schema-runtime",
    });
    expect(result.diagnostics).toEqual([]);
    const lowered = result.loweredFiles!["main.vibe"]!;
    expect(lowered.code).toContain(`import { ${SCHEMA_RUNTIME_BINDING} } from "vibelang/schema-runtime";`);
    expect(lowered.provenance.authoredDigest).toBe(digest(source));
    expect(lowered.provenance.loweredDigest).toBe(digest(lowered.code));

    const edge = lowered.provenance.edits.find((edit) => edit.kind === "schema-runtime-import")!;
    expect(edge.authored).toMatchObject({ file: "main.vibe", start: 0, end: 0 });
    expect(edge.generated.start).toBe(0);

    const call = lowered.provenance.edits.find((edit) => edit.kind === "intrinsic-call")!;
    expect(source.slice(call.authored.start, call.authored.end)).toBe("comptime(Schema.derive<Row>())");
    expect(lowered.code.slice(call.generated.start, call.generated.end)).toContain(`${SCHEMA_RUNTIME_BINDING}<Row>(`);

    const map = JSON.parse(lowered.sourceMap) as {
      version: number;
      sources: string[];
      sourcesContent: string[];
      mappings: string;
    };
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(["main.vibe"]);
    expect(map.sourcesContent).toEqual([source]);
    expect(map.mappings.split(";")).toHaveLength(lowered.code.split("\n").length);
  });

  test("the compiler-owned schema module throws before an importing module body runs", async () => {
    const guard = dataModule(SCHEMA_RUNTIME_GUARD_SOURCE);
    const importer = dataModule([
      `import { Schema } from ${JSON.stringify(guard)};`,
      `export const derived = Schema.derive();`,
    ].join("\n"));
    await expect(import(importer)).rejects.toThrow(SCHEMA_RUNTIME_ERROR);
  });

  test("ValidationError carries a registered wire codec", () => {
    const error = new ValidationError(["contacts", 0, "e-mail"], "expected string");
    expect(error.pointer).toBe('$.contacts[0]["e-mail"]');
    expect(error.message).toBe('$.contacts[0]["e-mail"] expected string');
    const decoded = decodeError(encodeError(error));
    expect(decoded).toBeInstanceOf(ValidationError);
    expect((decoded as ValidationError).path).toEqual(["contacts", 0, "e-mail"]);
    expect((decoded as ValidationError).reason).toBe("expected string");
  });

  test("the runtime engine refuses a descriptor it did not receive from the compiler", () => {
    expect(() => __vsSchema({ kind: "mystery" } as unknown as SchemaDescriptor)).toThrow("is not a schema descriptor kind");
    expect(() => __vsSchema({ kind: "object", properties: [
      { name: "a", optional: false, value: { kind: "string" } },
      { name: "a", optional: false, value: { kind: "string" } },
    ] } as SchemaDescriptor)).toThrow("duplicate property");
  });

  test("lowers a multi-file project and executes the generated program under bun", async () => {
    const build = await compiler();
    const sources = {
      "types.ts": [
        `export type Signup = {`,
        `  email: string;`,
        `  age: number;`,
        `  role: "admin" | "member";`,
        `  tags: string[];`,
        `  nickname?: string;`,
        `};`,
      ].join("\n"),
      "schema.ts": [
        IMPORTS,
        `import type { Signup } from "./types.ts";`,
        `export const SignupSchema = comptime(Schema.derive<Signup>());`,
      ].join("\n"),
      "main.ts": [
        `import { SignupSchema } from "./schema.ts";`,
        `const good = SignupSchema.parse({ email: "a@b.c", age: 30, role: "admin", tags: ["x"] });`,
        `const bad = SignupSchema.parse({ email: "a@b.c", age: 30, role: "owner", tags: ["x"] });`,
        `const missing = SignupSchema.parse({ email: "a@b.c", age: 30, role: "admin" });`,
        `console.log(JSON.stringify({`,
        `  good: good.match({ ok: (value) => value, error: () => null }),`,
        `  bad: bad.match({ ok: () => null, error: (error) => error.pointer + " " + error.reason }),`,
        `  missing: missing.match({ ok: () => null, error: (error) => error.pointer }),`,
        `}));`,
      ].join("\n"),
    };
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources,
      schemaRuntimeImport: SCHEMA_RUNTIME_PATH,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.loweredFiles?.["schema.ts"]?.provenance.edits.map((edit) => edit.kind)).toEqual([
      "schema-runtime-import",
      "remove-import",
      "remove-import",
      "intrinsic-call",
    ]);
    // Only the deriving module gains the runtime edge.
    expect(result.loweredSources!["main.ts"]).not.toContain(SCHEMA_RUNTIME_BINDING);

    for (const [fileName, code] of Object.entries(result.loweredSources!)) {
      await writeFile(join(build.root, fileName), code);
    }
    const child = Bun.spawn(["bun", join(build.root, "main.ts")], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(`${status} ${stderr}`).toBe("0 ");
    expect(JSON.parse(stdout)).toEqual({
      good: { age: 30, email: "a@b.c", role: "admin", tags: ["x"] },
      bad: "$.role expected \"admin\" | \"member\"",
      missing: "$.tags",
    });
  });
});
