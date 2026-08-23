/**
 * Compiler half of `comptime(Schema.derive<T>())`.
 *
 * Recognition and lowering live in `comptime-intrinsic.ts`; this module owns the
 * compiler-owned virtual module's shape and the checker-driven reification of a
 * TypeScript type into the bounded canonical descriptor that
 * `./schema-runtime.ts` interprets at run time.
 */
import * as ts from "typescript-js";
import type { SchemaDescriptor, SchemaProperty } from "./schema-runtime.ts";
import { canonical, compareStableStrings } from "./stable.ts";

/**
 * Provisional spelling. The specification fixes the semantics of comptime type
 * reification but has never fixed the import; the POC claims this compiler-owned
 * virtual module so the authoring form can be exercised end to end.
 */
export const SCHEMA_MODULE_SPECIFIER = "smithers:schema";

export const SCHEMA_RUNTIME_ERROR =
  '"smithers:schema" is compiler-only; compile this module before ordinary JavaScript execution';

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

/** Default module edge for generated code; mirrors the `smthrs/runtime` seam. */
export const DEFAULT_SCHEMA_RUNTIME_IMPORT = "smthrs/schema-runtime";

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

function unsupported(what: string): never {
  throw new SchemaDerivationError("unsupported", `${what} is not a reifiable type`);
}

function overBudget(message: string): never {
  throw new SchemaDerivationError("budget", message);
}

interface DerivationState {
  nodes: number;
}

/**
 * Reify a checked type into the canonical descriptor grammar. `location` gives
 * the checker a scope for property types and is normally the derive call site.
 */
export function deriveSchemaDescriptor(
  checker: ts.TypeChecker,
  typeNode: ts.TypeNode,
  location: ts.Node,
): SchemaDescriptor {
  const type = checker.getTypeFromTypeNode(typeNode);
  return convertType(checker, type, location, 0, new Set<ts.Type>(), { nodes: 0 });
}

const UNRESOLVED_OPERATOR = ts.TypeFlags.Index | ts.TypeFlags.IndexedAccess | ts.TypeFlags.Conditional |
  ts.TypeFlags.Substitution | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping;

function convertType(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node,
  depth: number,
  stack: Set<ts.Type>,
  state: DerivationState,
): SchemaDescriptor {
  if (depth > SchemaDerivationLimits.maximumDepth) {
    overBudget(`derived type nests deeper than the ${SchemaDerivationLimits.maximumDepth} level POC limit`);
  }
  if (++state.nodes > SchemaDerivationLimits.maximumNodes) {
    overBudget(`derived type expands past the ${SchemaDerivationLimits.maximumNodes} descriptor node POC limit`);
  }
  const flags = type.flags;
  if (flags & ts.TypeFlags.Any) unsupported("any");
  if (flags & ts.TypeFlags.Unknown) unsupported("unknown");
  if (flags & ts.TypeFlags.Never) unsupported("never");
  if (flags & ts.TypeFlags.Void) unsupported("void");
  if (flags & ts.TypeFlags.Undefined) unsupported("undefined");
  if (flags & ts.TypeFlags.TypeParameter) unsupported("a free type parameter");
  if (flags & UNRESOLVED_OPERATOR) unsupported("an unresolved type operator");
  if (flags & ts.TypeFlags.EnumLike) unsupported("an enum");
  if (flags & ts.TypeFlags.BigIntLike) unsupported("bigint");
  if (flags & ts.TypeFlags.ESSymbolLike) unsupported("symbol");
  if (flags & ts.TypeFlags.NonPrimitive) unsupported("the non-primitive object keyword");
  if (flags & ts.TypeFlags.Null) return { kind: "null" };
  if (flags & ts.TypeFlags.Boolean) return { kind: "boolean" };
  if (flags & ts.TypeFlags.String) return { kind: "string" };
  if (flags & ts.TypeFlags.Number) return { kind: "number" };
  if (type.isStringLiteral()) return { kind: "literal", value: type.value };
  if (type.isNumberLiteral()) {
    if (!Number.isFinite(type.value)) unsupported("a non-finite numeric literal");
    return { kind: "literal", value: type.value === 0 ? 0 : type.value };
  }
  if (flags & ts.TypeFlags.BooleanLiteral) {
    return { kind: "literal", value: booleanLiteralValue(checker, type) };
  }
  if (type.isIntersection()) unsupported("an intersection type");
  if (type.isUnion()) {
    if (type.types.length > SchemaDerivationLimits.maximumUnionVariants) {
      overBudget(`union has more than the ${SchemaDerivationLimits.maximumUnionVariants} variant POC limit`);
    }
    return normalizeUnion(type.types.map((variant) =>
      convertType(checker, variant, location, depth + 1, stack, state)));
  }
  if (flags & ts.TypeFlags.Object) return convertObject(checker, type, location, depth, stack, state);
  unsupported(`${checker.typeToString(type)}`);
}

function convertObject(
  checker: ts.TypeChecker,
  type: ts.Type,
  location: ts.Node,
  depth: number,
  stack: Set<ts.Type>,
  state: DerivationState,
): SchemaDescriptor {
  // Structural identity is the checker's own Type object, so a type alias that
  // reaches itself through any number of aliases is caught here exactly once.
  if (stack.has(type)) unsupported("a recursive type");
  stack.add(type);
  try {
    if (checker.isTupleType(type)) {
      const reference = type as ts.TupleTypeReference;
      if ((reference.target.combinedFlags & ~ts.ElementFlags.Required) !== 0) {
        unsupported("a tuple with optional, rest, or variadic elements");
      }
      const elements = checker.getTypeArguments(reference);
      if (elements.length > SchemaDerivationLimits.maximumTupleElements) {
        overBudget(`tuple has more than the ${SchemaDerivationLimits.maximumTupleElements} element POC limit`);
      }
      return {
        kind: "tuple",
        elements: elements.map((element) => convertType(checker, element, location, depth + 1, stack, state)),
      };
    }
    if (checker.isArrayType(type)) {
      const elements = checker.getTypeArguments(type as ts.TypeReference);
      if (elements.length !== 1) unsupported("an array without exactly one element type");
      return { kind: "array", element: convertType(checker, elements[0]!, location, depth + 1, stack, state) };
    }
    if (type.getCallSignatures().length > 0) unsupported("a function type");
    if (type.getConstructSignatures().length > 0) unsupported("a constructor type");
    if (type.isClass()) unsupported("a class instance type");
    if (checker.getIndexInfosOfType(type).length > 0) unsupported("a type with an index signature");

    const symbols = type.getProperties();
    if (symbols.length > SchemaDerivationLimits.maximumProperties) {
      overBudget(`object has more than the ${SchemaDerivationLimits.maximumProperties} property POC limit`);
    }
    const properties: SchemaProperty[] = [];
    const seen = new Set<string>();
    for (const symbol of symbols) {
      const name = symbol.getName();
      if (name.startsWith("__@")) unsupported("a symbol-keyed property");
      if (symbol.flags & (ts.SymbolFlags.Method | ts.SymbolFlags.Function)) {
        unsupported(`property ${JSON.stringify(name)}, which is a method`);
      }
      if (symbol.flags & ts.SymbolFlags.Accessor) {
        unsupported(`property ${JSON.stringify(name)}, which is an accessor`);
      }
      for (const declaration of symbol.declarations ?? []) {
        const modifiers = ts.getCombinedModifierFlags(declaration as ts.Declaration);
        if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) {
          unsupported(`property ${JSON.stringify(name)}, which is not public`);
        }
      }
      if (seen.has(name)) unsupported(`duplicate property ${JSON.stringify(name)}`);
      seen.add(name);
      const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
      const propertyType = checker.getTypeOfSymbolAtLocation(symbol, location);
      properties.push({
        name,
        optional,
        value: convertPropertyType(checker, propertyType, optional, location, depth + 1, stack, state),
      });
    }
    properties.sort((left, right) => compareStableStrings(left.name, right.name));
    return { kind: "object", properties };
  } finally {
    stack.delete(type);
  }
}

/**
 * `x?: T` reaches the checker as `T | undefined` under strict mode. The optional
 * flag already carries absence, so `undefined` is stripped exactly there and
 * remains unreifiable in every other position.
 */
function convertPropertyType(
  checker: ts.TypeChecker,
  type: ts.Type,
  optional: boolean,
  location: ts.Node,
  depth: number,
  stack: Set<ts.Type>,
  state: DerivationState,
): SchemaDescriptor {
  if (!optional || !type.isUnion()) return convertType(checker, type, location, depth, stack, state);
  const defined = type.types.filter((variant) => (variant.flags & ts.TypeFlags.Undefined) === 0);
  if (defined.length === 0) unsupported("an optional property with no defined type");
  if (defined.length > SchemaDerivationLimits.maximumUnionVariants) {
    overBudget(`union has more than the ${SchemaDerivationLimits.maximumUnionVariants} variant POC limit`);
  }
  return normalizeUnion(defined.map((variant) => convertType(checker, variant, location, depth + 1, stack, state)));
}

function booleanLiteralValue(checker: ts.TypeChecker, type: ts.Type): boolean {
  const intrinsic = (type as unknown as { readonly intrinsicName?: unknown }).intrinsicName;
  if (intrinsic === "true") return true;
  if (intrinsic === "false") return false;
  const text = checker.typeToString(type);
  if (text === "true") return true;
  if (text === "false") return false;
  unsupported("an unrecognized boolean literal type");
}

function isBooleanLiteral(descriptor: SchemaDescriptor, value: boolean): boolean {
  return descriptor.kind === "literal" && descriptor.value === value;
}

/**
 * Canonicalize a union: flatten, collapse `true | false` back to `boolean`,
 * drop duplicates, and unwrap a single survivor. Ordering follows the checker's
 * deterministic constituent order so identical sources digest identically.
 */
function normalizeUnion(variants: readonly SchemaDescriptor[]): SchemaDescriptor {
  const flattened: SchemaDescriptor[] = [];
  for (const variant of variants) {
    if (variant.kind === "union") flattened.push(...variant.variants);
    else flattened.push(variant);
  }
  const collapsible = flattened.some((variant) => isBooleanLiteral(variant, true)) &&
    flattened.some((variant) => isBooleanLiteral(variant, false));
  const unique: SchemaDescriptor[] = [];
  const seen = new Set<string>();
  for (const variant of flattened) {
    const normalized: SchemaDescriptor =
      collapsible && (isBooleanLiteral(variant, true) || isBooleanLiteral(variant, false))
        ? { kind: "boolean" }
        : variant;
    const key = canonical(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }
  if (unique.length === 0) unsupported("an empty union");
  if (unique.length === 1) return unique[0]!;
  if (unique.length > SchemaDerivationLimits.maximumUnionVariants) {
    overBudget(`union has more than the ${SchemaDerivationLimits.maximumUnionVariants} variant POC limit`);
  }
  return { kind: "union", variants: unique };
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
