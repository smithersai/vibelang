/** @module @throws {never} */
/**
 * Provisional runtime Schema values. Every descriptor tree expressible by the
 * comptime grammar is parsed by build/schema-runtime verbatim. `record` is the
 * sole runtime extension and is handled by a narrow compositional adapter.
 */
import {
  ValidationError,
  __vsSchema,
  type SchemaDescriptor as BuildSchemaDescriptor,
} from "../build/schema-runtime.ts";
import { Equivalence, type Equivalence as EquivalenceInstance } from "../data/equivalence.ts";
import { Hash, type Hash as HashInstance } from "../data/hash.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { panic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";

const { failure, success } = RuntimeValues;

const MAX_DESCRIPTOR_DEPTH = 32;
const MAX_DESCRIPTOR_NODES = 8192;

export type SchemaPathSegment = string | number;

export interface SchemaPropertyDescriptor {
  readonly name: string;
  readonly optional: boolean;
  readonly value: RuntimeSchemaDescriptor;
}

/**
 * The build descriptor grammar, recursively preserved field-for-field, plus
 * the ordinary runtime-only `record` node that TypeScript reification does not
 * currently export.
 */
export type RuntimeSchemaDescriptor =
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "null" }
  | { readonly kind: "literal"; readonly value: string | number | boolean }
  | { readonly kind: "array"; readonly element: RuntimeSchemaDescriptor }
  | { readonly kind: "tuple"; readonly elements: readonly RuntimeSchemaDescriptor[] }
  | { readonly kind: "union"; readonly variants: readonly RuntimeSchemaDescriptor[] }
  | { readonly kind: "object"; readonly properties: readonly SchemaPropertyDescriptor[] }
  | { readonly kind: "record"; readonly value: RuntimeSchemaDescriptor };

export type SchemaDescriptor = RuntimeSchemaDescriptor;

type SchemaShape =
  | { readonly kind: "leaf" }
  | { readonly kind: "array"; readonly element: Schema<unknown> }
  | { readonly kind: "tuple"; readonly elements: readonly Schema<unknown>[] }
  | { readonly kind: "union"; readonly variants: readonly Schema<unknown>[] }
  | { readonly kind: "object"; readonly properties: readonly SchemaField[] }
  | { readonly kind: "record"; readonly value: Schema<unknown> };

interface SchemaField {
  readonly name: string;
  readonly optional: boolean;
  readonly schema: Schema<unknown>;
}

interface Refinement {
  readonly predicate: (value: unknown) => boolean;
  readonly message: string;
}

export interface SchemaInspection {
  readonly descriptor: RuntimeSchemaDescriptor;
  readonly shape: SchemaShape;
  readonly name?: string;
  readonly refinements: readonly Refinement[];
}

interface SchemaState extends SchemaInspection {
  readonly rawParse: (input: unknown, path: readonly SchemaPathSegment[]) => Result<unknown, ValidationError>;
}

const states = new WeakMap<object, SchemaState>();
const localSchemas = new WeakSet<object>();

function stateOf<T>(schema: Schema<T>): SchemaState {
  const state = states.get(schema as object);
  if (!state || !localSchemas.has(schema as object)) panic("forged Schema value");
  return state;
}

export abstract class SchemaValue<T> {
  get descriptor(): RuntimeSchemaDescriptor { return stateOf(this).descriptor; }

  parse(input: unknown): Result<T, ValidationError> {
    const state = stateOf(this);
    const parsed = state.rawParse(input, []);
    if (parsed.isError()) return parsed as Result<T, ValidationError>;
    const value = parsed.unwrap();
    const refinementError = validateParsed(state, value, []);
    return refinementError ? failure(refinementError) : success(value as T);
  }

  refine(predicate: (value: T) => boolean, message: string): Schema<T> {
    if (typeof predicate !== "function") panic("Schema.refine requires a predicate");
    if (typeof message !== "string" || message.length === 0) panic("Schema.refine requires a non-empty message");
    const state = stateOf(this);
    return instantiate({
      ...state,
      refinements: Object.freeze([
        ...state.refinements,
        Object.freeze({ predicate: predicate as (value: unknown) => boolean, message }),
      ]),
    });
  }

  describe(name: string): Schema<T> {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 128) {
      panic("Schema.describe requires a non-empty name of at most 128 characters");
    }
    const state = stateOf(this);
    return instantiate({ ...state, name });
  }

  get [Symbol.toStringTag](): string { return "Schema"; }
}

export type Schema<T> = SchemaValue<T>;

class LocalSchema<T> extends SchemaValue<T> {
  constructor(state: SchemaState) {
    super();
    states.set(this, Object.freeze(state));
    localSchemas.add(this);
    Object.freeze(this);
  }
}

function instantiate<T>(state: SchemaState): Schema<T> {
  return new LocalSchema<T>(state);
}

const optionalStates = new WeakMap<object, Schema<unknown>>();
const localOptionalFields = new WeakSet<object>();

export abstract class OptionalSchemaValue<T> {
  get schema(): Schema<T> {
    const schema = optionalStates.get(this as object);
    if (!schema || !localOptionalFields.has(this as object)) panic("forged optional Schema field");
    return schema as Schema<T>;
  }
  get [Symbol.toStringTag](): string { return "OptionalSchema"; }
}

export type OptionalSchema<T> = OptionalSchemaValue<T>;

class LocalOptionalSchema<T> extends OptionalSchemaValue<T> {
  constructor(schema: Schema<T>) {
    super();
    stateOf(schema);
    optionalStates.set(this, schema as Schema<unknown>);
    localOptionalFields.add(this);
    Object.freeze(this);
  }
}

function optionalState<T>(value: OptionalSchema<T>): Schema<T> {
  const schema = optionalStates.get(value as object);
  if (!schema || !localOptionalFields.has(value as object)) panic("forged optional Schema field");
  return schema as Schema<T>;
}

function isOptionalSchema(value: unknown): value is OptionalSchema<unknown> {
  return typeof value === "object" && value !== null && localOptionalFields.has(value);
}

function prefixError(error: ValidationError, path: readonly SchemaPathSegment[]): ValidationError {
  return path.length === 0 ? error : new ValidationError([...path, ...error.path], error.reason);
}

function buildCompatible(descriptor: RuntimeSchemaDescriptor): descriptor is BuildSchemaDescriptor {
  switch (descriptor.kind) {
    case "record": return false;
    case "array": return buildCompatible(descriptor.element);
    case "tuple": return descriptor.elements.every(buildCompatible);
    case "union": return descriptor.variants.every(buildCompatible);
    case "object": return descriptor.properties.every((property) => buildCompatible(property.value));
    default: return true;
  }
}

function freezeDescriptor(descriptor: RuntimeSchemaDescriptor): RuntimeSchemaDescriptor {
  switch (descriptor.kind) {
    case "array": freezeDescriptor(descriptor.element); break;
    case "tuple": descriptor.elements.forEach(freezeDescriptor); Object.freeze(descriptor.elements); break;
    case "union": descriptor.variants.forEach(freezeDescriptor); Object.freeze(descriptor.variants); break;
    case "object":
      for (const property of descriptor.properties) {
        freezeDescriptor(property.value);
        Object.freeze(property);
      }
      Object.freeze(descriptor.properties);
      break;
    case "record": freezeDescriptor(descriptor.value); break;
  }
  return Object.freeze(descriptor);
}

function assertRuntimeDescriptorBudget(
  descriptor: RuntimeSchemaDescriptor,
  path = "$descriptor",
  depth = 0,
  budget = { nodes: 0 },
): void {
  if (depth > MAX_DESCRIPTOR_DEPTH) throw new TypeError(`${path} exceeds the schema descriptor depth limit`);
  if (++budget.nodes > MAX_DESCRIPTOR_NODES) throw new TypeError(`${path} exceeds the schema descriptor node limit`);
  switch (descriptor.kind) {
    case "array": assertRuntimeDescriptorBudget(descriptor.element, `${path}.element`, depth + 1, budget); break;
    case "tuple": descriptor.elements.forEach((element, index) =>
      assertRuntimeDescriptorBudget(element, `${path}.elements[${index}]`, depth + 1, budget)); break;
    case "union": descriptor.variants.forEach((variant, index) =>
      assertRuntimeDescriptorBudget(variant, `${path}.variants[${index}]`, depth + 1, budget)); break;
    case "object": descriptor.properties.forEach((property, index) =>
      assertRuntimeDescriptorBudget(property.value, `${path}.properties[${index}].value`, depth + 1, budget)); break;
    case "record": assertRuntimeDescriptorBudget(descriptor.value, `${path}.value`, depth + 1, budget); break;
  }
}

function create<T>(
  descriptor: RuntimeSchemaDescriptor,
  shape: SchemaShape,
  adapter?: (input: unknown, path: readonly SchemaPathSegment[]) => Result<unknown, ValidationError>,
): Schema<T> {
  let canonical: RuntimeSchemaDescriptor;
  let rawParse: SchemaState["rawParse"];
  if (buildCompatible(descriptor)) {
    // This is the authoritative shared validation engine. It also asserts and
    // deeply freezes the descriptor, preventing the runtime and comptime paths
    // from drifting on their common grammar.
    const derived = __vsSchema<unknown>(descriptor);
    canonical = derived.descriptor;
    rawParse = (input, path) => derived.parse(input).mapError((error) => prefixError(error, path));
  } else {
    if (!adapter) panic("runtime-only Schema descriptor has no validation adapter");
    assertRuntimeDescriptorBudget(descriptor);
    canonical = freezeDescriptor(descriptor);
    rawParse = adapter;
  }
  return instantiate({
    descriptor: canonical,
    shape: Object.freeze(shape),
    refinements: Object.freeze([]),
    rawParse,
  });
}

function validateParsed(
  state: SchemaState,
  value: unknown,
  path: readonly SchemaPathSegment[],
): ValidationError | undefined {
  let childError: ValidationError | undefined;
  switch (state.shape.kind) {
    case "leaf": break;
    case "array": {
      const child = stateOf(state.shape.element);
      for (let index = 0; index < (value as readonly unknown[]).length; index += 1) {
        childError = validateParsed(child, (value as readonly unknown[])[index], [...path, index]);
        if (childError) return childError;
      }
      break;
    }
    case "tuple":
      for (let index = 0; index < state.shape.elements.length; index += 1) {
        childError = validateParsed(stateOf(state.shape.elements[index]!), (value as readonly unknown[])[index], [...path, index]);
        if (childError) return childError;
      }
      break;
    case "object":
      for (const property of state.shape.properties) {
        if (property.optional && !Object.hasOwn(value as object, property.name)) continue;
        childError = validateParsed(
          stateOf(property.schema),
          (value as Record<string, unknown>)[property.name],
          [...path, property.name],
        );
        if (childError) return childError;
      }
      break;
    case "record":
      for (const key of Object.keys(value as object).sort()) {
        childError = validateParsed(stateOf(state.shape.value), (value as Record<string, unknown>)[key], [...path, key]);
        if (childError) return childError;
      }
      break;
    case "union": {
      let firstRefinementError: ValidationError | undefined;
      for (const variant of state.shape.variants) {
        const child = stateOf(variant);
        const structural = child.rawParse(value, path);
        if (structural.isError()) continue;
        const candidate = validateParsed(child, structural.unwrap(), path);
        if (!candidate) {
          firstRefinementError = undefined;
          break;
        }
        firstRefinementError ??= candidate;
      }
      if (firstRefinementError) return firstRefinementError;
      break;
    }
  }

  for (const refinement of state.refinements) {
    let accepted = false;
    try {
      accepted = refinement.predicate(value) === true;
    } catch {
      return new ValidationError(path, `failed refinement: ${refinement.message} (predicate threw)`);
    }
    if (!accepted) return new ValidationError(path, `failed refinement: ${refinement.message}`);
  }
  return undefined;
}

function ownData(host: object, key: string | number, path: readonly SchemaPathSegment[]): unknown | ValidationError {
  const descriptor = Object.getOwnPropertyDescriptor(host, String(key));
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
    return new ValidationError([...path, key], "is not an enumerable data property");
  }
  return descriptor.value;
}

function plainArray(
  input: unknown,
  path: readonly SchemaPathSegment[],
  descriptor: RuntimeSchemaDescriptor,
): ValidationError | undefined {
  // A value that is not an array at all is described by the shape that was
  // wanted, which is how `__vsSchema` words it. Saying "expected a plain array"
  // here made the reason leak which of the two engines had run. The prototype
  // and extra-property wordings below already matched and are unchanged.
  if (!Array.isArray(input)) return new ValidationError(path, `expected ${describeDescriptor(descriptor)}`);
  if (Object.getPrototypeOf(input) !== Array.prototype) {
    return new ValidationError(path, "expected a plain array");
  }
  for (const key of Reflect.ownKeys(input)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length) {
      return new ValidationError(path, "expected a plain array without extra properties");
    }
  }
  return undefined;
}

function describeDescriptor(descriptor: RuntimeSchemaDescriptor): string {
  switch (descriptor.kind) {
    case "literal": return JSON.stringify(descriptor.value);
    case "array": return `${describeDescriptor(descriptor.element)}[]`;
    case "tuple": return `[${descriptor.elements.map(describeDescriptor).join(", ")}]`;
    case "union": return descriptor.variants.map(describeDescriptor).join(" | ");
    case "object": return "an object";
    case "record": return "a record";
    default: return descriptor.kind;
  }
}

function array<T>(element: Schema<T>): Schema<readonly T[]> {
  const child = stateOf(element);
  const descriptor: RuntimeSchemaDescriptor = { kind: "array", element: child.descriptor };
  return create(descriptor, { kind: "array", element: element as Schema<unknown> }, (input, path) => {
    const invalid = plainArray(input, path, descriptor);
    if (invalid) return failure(invalid);
    const output: unknown[] = [];
    for (let index = 0; index < (input as unknown[]).length; index += 1) {
      const value = ownData(input as object, index, path);
      if (value instanceof ValidationError) return failure(value);
      const parsed = child.rawParse(value, [...path, index]);
      if (parsed.isError()) return parsed;
      output.push(parsed.unwrap());
    }
    return success(Object.freeze(output));
  });
}

type SchemaType<S> = S extends SchemaValue<infer T> ? T : never;

function tuple<const Parts extends readonly SchemaValue<unknown>[]>(
  ...elements: Parts
): Schema<Readonly<{ [Index in keyof Parts]: SchemaType<Parts[Index]> }>> {
  const children = elements.map(stateOf);
  const descriptor: RuntimeSchemaDescriptor = { kind: "tuple", elements: children.map((child) => child.descriptor) };
  return create(descriptor, { kind: "tuple", elements }, (input, path) => {
    const invalid = plainArray(input, path, descriptor);
    if (invalid) return failure(invalid);
    if ((input as unknown[]).length !== children.length) {
      return failure(new ValidationError(path, `expected a ${children.length}-element tuple but received ${(input as unknown[]).length}`));
    }
    const output: unknown[] = [];
    for (let index = 0; index < children.length; index += 1) {
      const value = ownData(input as object, index, path);
      if (value instanceof ValidationError) return failure(value);
      const parsed = children[index]!.rawParse(value, [...path, index]);
      if (parsed.isError()) return parsed;
      output.push(parsed.unwrap());
    }
    return success(Object.freeze(output));
  });
}

function union<const Variants extends readonly SchemaValue<unknown>[]>(
  ...variants: Variants
): Schema<SchemaType<Variants[number]>> {
  if (variants.length < 2) panic("Schema.union requires at least two schemas");
  const children = variants.map(stateOf);
  const descriptor: RuntimeSchemaDescriptor = { kind: "union", variants: children.map((child) => child.descriptor) };
  return create(descriptor, { kind: "union", variants }, (input, path) => {
    for (const child of children) {
      const parsed = child.rawParse(input, path);
      if (parsed.isOk()) return parsed;
    }
    return failure(new ValidationError(path, `expected ${describeDescriptor(descriptor)}`));
  });
}

type StructEntry = SchemaValue<unknown> | OptionalSchemaValue<unknown>;
type RequiredFieldKeys<Fields extends Readonly<Record<string, StructEntry>>> = {
  [Key in keyof Fields]-?: Fields[Key] extends OptionalSchemaValue<unknown> ? never : Key
}[keyof Fields];
type OptionalFieldKeys<Fields extends Readonly<Record<string, StructEntry>>> = {
  [Key in keyof Fields]-?: Fields[Key] extends OptionalSchemaValue<unknown> ? Key : never
}[keyof Fields];
type EntryType<Entry> = Entry extends OptionalSchemaValue<infer T> ? T : Entry extends SchemaValue<infer T> ? T : never;
export type StructType<Fields extends Readonly<Record<string, StructEntry>>> = Readonly<
  { [Key in RequiredFieldKeys<Fields>]: EntryType<Fields[Key]> } &
  { [Key in OptionalFieldKeys<Fields>]?: EntryType<Fields[Key]> }
>;

function dataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function struct<const Fields extends Readonly<Record<string, StructEntry>>>(fields: Fields): Schema<StructType<Fields>> {
  if (!dataRecord(fields)) panic("Schema.struct requires a record of schemas");
  const properties: SchemaField[] = Object.keys(fields).sort().map((name) => {
    const entry = fields[name]!;
    if (isOptionalSchema(entry)) return Object.freeze({ name, optional: true, schema: optionalState(entry) as Schema<unknown> });
    if (!isSchema(entry)) panic(`Schema.struct.${name} requires a Schema value`);
    return Object.freeze({ name, optional: false, schema: entry as Schema<unknown> });
  });
  const descriptor: RuntimeSchemaDescriptor = {
    kind: "object",
    properties: properties.map((property) => ({
      name: property.name,
      optional: property.optional,
      value: stateOf(property.schema).descriptor,
    })),
  };
  const shape: SchemaShape = { kind: "object", properties: Object.freeze(properties) };
  return create(descriptor, shape, (input, path) => {
    if (!dataRecord(input)) return failure(new ValidationError(path, "expected an object"));
    const declared = new Set(properties.map((property) => property.name));
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return failure(new ValidationError(path, "expected an object without symbol-keyed properties"));
      if (!declared.has(key)) return failure(new ValidationError([...path, key], "is not declared by the derived type"));
    }
    const output: Record<string, unknown> = {};
    for (const property of properties) {
      if (!Object.hasOwn(input, property.name)) {
        if (property.optional) continue;
        return failure(new ValidationError(
          [...path, property.name],
          `is required and expected ${describeDescriptor(stateOf(property.schema).descriptor)}`,
        ));
      }
      const value = ownData(input, property.name, path);
      if (value instanceof ValidationError) return failure(value);
      const parsed = stateOf(property.schema).rawParse(value, [...path, property.name]);
      if (parsed.isError()) return parsed;
      Object.defineProperty(output, property.name, {
        value: parsed.unwrap(), enumerable: true, configurable: false, writable: false,
      });
    }
    return success(Object.freeze(output));
  });
}

function record<T>(value: Schema<T>): Schema<Readonly<Record<string, T>>> {
  const child = stateOf(value);
  const descriptor: RuntimeSchemaDescriptor = { kind: "record", value: child.descriptor };
  return create(descriptor, { kind: "record", value: value as Schema<unknown> }, (input, path) => {
    if (!dataRecord(input)) return failure(new ValidationError(path, "expected a record"));
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return failure(new ValidationError(path, "expected a record without symbol-keyed properties"));
      const owned = ownData(input, key, path);
      if (owned instanceof ValidationError) return failure(owned);
    }
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const owned = ownData(input, key, path);
      if (owned instanceof ValidationError) return failure(owned);
      const parsed = child.rawParse(owned, [...path, key]);
      if (parsed.isError()) return parsed;
      Object.defineProperty(output, key, {
        value: parsed.unwrap(), enumerable: true, configurable: false, writable: false,
      });
    }
    return success(Object.freeze(output));
  });
}

function literal<const Value extends string | number | boolean>(value: Value): Schema<Value> {
  if (!(typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) {
    panic("Schema.literal requires a finite string, number, or boolean");
  }
  return create({ kind: "literal", value }, { kind: "leaf" });
}

function optional<T>(schema: Schema<T>): OptionalSchema<T> {
  stateOf(schema);
  return new LocalOptionalSchema(schema);
}

function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return union(schema as SchemaValue<unknown>, nullSchema) as Schema<T | null>;
}

function matchingVariant(state: SchemaState, value: unknown): number {
  if (state.shape.kind !== "union") return 0;
  for (let index = 0; index < state.shape.variants.length; index += 1) {
    const child = stateOf(state.shape.variants[index]!);
    const parsed = child.rawParse(value, []);
    if (parsed.isOk() && !validateParsed(child, parsed.unwrap(), [])) return index;
  }
  return 0;
}

function equivalentState(state: SchemaState, left: unknown, right: unknown): boolean {
  if (left === right || (left !== left && right !== right)) return true;
  switch (state.shape.kind) {
    case "leaf": return false;
    case "array": {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      const child = stateOf(state.shape.element);
      return left.every((item, index) => equivalentState(child, item, right[index]));
    }
    case "tuple": {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      return state.shape.elements.every((child, index) => equivalentState(stateOf(child), left[index], right[index]));
    }
    case "object":
      return state.shape.properties.every((property) => {
        const leftOwn = Object.hasOwn(left as object, property.name);
        const rightOwn = Object.hasOwn(right as object, property.name);
        return leftOwn === rightOwn && (!leftOwn || equivalentState(
          stateOf(property.schema),
          (left as Record<string, unknown>)[property.name],
          (right as Record<string, unknown>)[property.name],
        ));
      });
    case "record": {
      const recordShape = state.shape;
      const leftKeys = Object.keys(left as object).sort();
      const rightKeys = Object.keys(right as object).sort();
      return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
        key === rightKeys[index] && equivalentState(
          stateOf(recordShape.value),
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ));
    }
    case "union": {
      const variant = matchingVariant(state, left);
      if (variant !== matchingVariant(state, right)) return false;
      return equivalentState(stateOf(state.shape.variants[variant]!), left, right);
    }
  }
}

const ARRAY_SEED = 0x9e3779b1;
const STRUCT_SEED = 0x85ebca6b;
const UNION_SEED = 0x1b873593;

function hashState(state: SchemaState, value: unknown): number {
  switch (state.descriptor.kind) {
    case "string": return Hash.string.hash(value as string);
    case "number": return Hash.number.hash(value as number);
    case "boolean": return Hash.boolean.hash(value as boolean);
    case "null": return Hash.any.hash(null);
    case "literal":
      return typeof value === "string" ? Hash.string.hash(value) :
        typeof value === "number" ? Hash.number.hash(value) : Hash.boolean.hash(value as boolean);
    default: break;
  }
  switch (state.shape.kind) {
    case "leaf": return Hash.any.hash(value);
    case "array": {
      let output = Hash.combine(ARRAY_SEED, Hash.number.hash((value as readonly unknown[]).length));
      const child = stateOf(state.shape.element);
      for (const item of value as readonly unknown[]) output = Hash.combine(output, hashState(child, item));
      return output;
    }
    case "tuple": {
      let output = Hash.combine(ARRAY_SEED, Hash.number.hash(state.shape.elements.length));
      state.shape.elements.forEach((child, index) => { output = Hash.combine(output, hashState(stateOf(child), (value as readonly unknown[])[index])); });
      return output;
    }
    case "object": {
      let output = Hash.combine(STRUCT_SEED, Hash.number.hash(state.shape.properties.length));
      for (const property of state.shape.properties) {
        output = Hash.combine(output, Hash.string.hash(property.name));
        output = Hash.combine(output, Object.hasOwn(value as object, property.name)
          ? hashState(stateOf(property.schema), (value as Record<string, unknown>)[property.name])
          : Hash.any.hash(undefined));
      }
      return output;
    }
    case "record": {
      const keys = Object.keys(value as object).sort();
      let output = Hash.combine(STRUCT_SEED, Hash.number.hash(keys.length));
      const child = stateOf(state.shape.value);
      for (const key of keys) {
        output = Hash.combine(Hash.combine(output, Hash.string.hash(key)), hashState(child, (value as Record<string, unknown>)[key]));
      }
      return output;
    }
    case "union": {
      const variant = matchingVariant(state, value);
      return Hash.combine(Hash.combine(UNION_SEED, Hash.number.hash(variant)), hashState(stateOf(state.shape.variants[variant]!), value));
    }
  }
}

function equivalence<T>(schema: Schema<T>): EquivalenceInstance<T> {
  const state = stateOf(schema);
  return Equivalence.make((left: T, right: T) => equivalentState(state, left, right));
}

function hash<T>(schema: Schema<T>): HashInstance<T> {
  const state = stateOf(schema);
  return Hash.make((value: T) => hashState(state, value));
}

export function isSchema(value: unknown): value is Schema<unknown> {
  return typeof value === "object" && value !== null && localSchemas.has(value);
}

/** Internal read-only seam used by JsonSchema; intentionally not in the namespace. */
export function inspectSchema(schema: Schema<unknown>): SchemaInspection {
  const state = stateOf(schema);
  return Object.freeze({
    descriptor: state.descriptor,
    shape: state.shape,
    ...(state.name === undefined ? {} : { name: state.name }),
    refinements: state.refinements,
  });
}

const stringSchema = create<string>({ kind: "string" }, { kind: "leaf" });
const numberSchema = create<number>({ kind: "number" }, { kind: "leaf" });
const booleanSchema = create<boolean>({ kind: "boolean" }, { kind: "leaf" });
const nullSchema = create<null>({ kind: "null" }, { kind: "leaf" });

export const Schema = Object.freeze({
  isSchema,
  isOptionalSchema,
  string: stringSchema,
  number: numberSchema,
  boolean: booleanSchema,
  null: nullSchema,
  literal,
  array,
  tuple,
  struct,
  union,
  optional,
  nullable,
  record,
  equivalence,
  hash,
});
