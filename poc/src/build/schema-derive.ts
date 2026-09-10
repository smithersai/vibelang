/**
 * Compiler half of `comptime(Schema.derive<T>())`.
 *
 * Recognition and lowering live in `comptime-intrinsic.ts`; this module owns the
 * compiler-owned virtual module's shape and the checker-driven reification of a
 * TypeScript type, using the native Go checker, into the bounded descriptor that
 * `./schema-runtime.ts` interprets at run time.
 */
import { getNativeCompiler } from "../compiler/native.ts";
import type { NativeCheckedSchemasRequest } from "../compiler/protocol.ts";
import { assertSchemaDescriptor, type SchemaDescriptor } from "./schema-runtime.ts";
import { canonical, digest } from "./stable.ts";

/**
 * Provisional spelling. The specification fixes the semantics of comptime type
 * reification but has never fixed the import; the POC claims this compiler-owned
 * virtual module so the authoring form can be exercised end to end.
 */
export const SCHEMA_MODULE_SPECIFIER = "vibelang:schema";

export const SCHEMA_RUNTIME_ERROR =
  '"vibelang:schema" is compiler-only; compile this module before ordinary JavaScript execution';

/**
 * A loader may expose this source for the compiler-owned virtual module. Its
 * top-level throw rejects dependency evaluation before an importing module's
 * body (and therefore a `Schema.derive` call argument) can run.
 */
export const SCHEMA_RUNTIME_GUARD_SOURCE =
  `export const Schema = { derive() { throw new Error(${JSON.stringify(SCHEMA_RUNTIME_ERROR)}); } };\n` +
  `throw new Error(${JSON.stringify(SCHEMA_RUNTIME_ERROR)});\n`;

/** Ambient declaration used only to give the intrinsic a checker identity. */
export const SCHEMA_PRELUDE = [
  "export declare class ValidationError extends Error {",
  "  readonly path: readonly (string | number)[];",
  "  readonly pointer: string;",
  "  readonly reason: string;",
  "}",
  "export interface DerivedResult<T> {",
  "  isOk(): boolean;",
  "  isError(): boolean;",
  "  unwrap(): T;",
  "  unwrapOr<B>(fallback: B | ((error: ValidationError) => B)): T | B;",
  "  map<B>(mapper: (value: T) => B): DerivedResult<B>;",
  "  match<Ok, Failure>(handlers: {",
  "    readonly ok: (value: T) => Ok;",
  "    readonly error: (error: ValidationError) => Failure;",
  "  }): Ok | Failure;",
  "}",
  "export interface DerivedSchema<T> {",
  "  readonly descriptor: unknown;",
  "  parse(value: unknown): DerivedResult<T>;",
  "}",
  "export declare namespace Schema {",
  "  function derive<T>(): DerivedSchema<T>;",
  "}",
  "",
].join("\n");

/** Reserved local binding the lowered module uses for the runtime engine. */
export const SCHEMA_RUNTIME_BINDING = "__vsSchema";

/** Default module edge for generated code; mirrors the `vibelang/runtime` seam. */
export const DEFAULT_SCHEMA_RUNTIME_IMPORT = "vibelang/schema-runtime";

/** Bounded POC reification budget. Exceeding any limit fails closed. */
export const SchemaDerivationLimits = Object.freeze({
  maximumDepth: 16,
  maximumNodes: 512,
  maximumProperties: 128,
  maximumTupleElements: 64,
  maximumUnionVariants: 64,
});

export type SchemaDerivationFailure = "unsupported" | "budget";

export class SchemaDerivationError extends Error {
  constructor(readonly failure: SchemaDerivationFailure, message: string) {
    super(message);
    this.name = "SchemaDerivationError";
  }
}

/** Reify checked call-site types in one native program. Never pass checker objects. */
export function deriveSchemaDescriptors(request: NativeCheckedSchemasRequest): {
  readonly identity: string;
  readonly schemas: readonly ({ readonly descriptor: SchemaDescriptor } | { readonly error: SchemaDerivationError })[];
} {
  const compiler = getNativeCompiler();
  const result = compiler.checkedSchemas(request);
  // The cache identity includes the compiler/bridge, options encoded by the
  // API, full supplied source closure, module map and exact query spans.
  const identity = digest(canonical({ compiler: compiler.identity, transport: compiler.transportDigest, request }));
  return Object.freeze({
    identity,
    schemas: Object.freeze(result.schemas.map(schema => schema.ok
      ? Object.freeze({ descriptor: assertSchemaDescriptor(JSON.parse(schema.schemaJson)) })
      : Object.freeze({ error: new SchemaDerivationError(schema.failure as SchemaDerivationFailure, schema.message) }))),
  });
}

/**
 * Emit the descriptor as a plain object literal. Every key is a fixed compiler
 * identifier; author-controlled property names appear only as string values, so
 * no authored name can reach a generated key position.
 */
export function emitSchemaDescriptorLiteral(descriptor: SchemaDescriptor): string {
  switch (descriptor.kind) {
    case "string":
    case "number":
    case "boolean":
    case "null":
      return `{ kind: ${JSON.stringify(descriptor.kind)} }`;
    case "literal":
      return `{ kind: "literal", value: ${JSON.stringify(descriptor.value)} }`;
    case "array":
      return `{ kind: "array", element: ${emitSchemaDescriptorLiteral(descriptor.element)} }`;
    case "tuple":
      return `{ kind: "tuple", elements: [${descriptor.elements.map(emitSchemaDescriptorLiteral).join(", ")}] }`;
    case "union":
      return `{ kind: "union", variants: [${descriptor.variants.map(emitSchemaDescriptorLiteral).join(", ")}] }`;
    case "object":
      return `{ kind: "object", properties: [${descriptor.properties.map((property) =>
        `{ name: ${JSON.stringify(property.name)}, optional: ${property.optional}, ` +
        `value: ${emitSchemaDescriptorLiteral(property.value)} }`).join(", ")}] }`;
  }
}

/** The single generated module edge a lowered file gains for derived schemas. */
export function emitSchemaRuntimeImport(specifier: string): string {
  return `import { ${SCHEMA_RUNTIME_BINDING} } from ${JSON.stringify(specifier)};\n`;
}

export function emitSchemaCall(typeText: string, descriptor: SchemaDescriptor): string {
  return `${SCHEMA_RUNTIME_BINDING}<${typeText}>(${emitSchemaDescriptorLiteral(descriptor)})`;
}
