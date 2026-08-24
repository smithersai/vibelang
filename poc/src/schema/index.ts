/**
 * The provisional "Schema and Encoding" standard-library slice.
 *
 * These are immutable ordinary values: no runtime service and no effect
 * wrapper is involved. Recoverable parse/decode failures are Results; absent
 * values and law-check misses are `T | undefined`. Names and signatures remain
 * POC surface and may change before the standard library is settled.
 */

export { Codec, CodecValue, DecodeError, isCodec } from "./codec.ts";
export type { Codec as CodecType, DecodePathSegment } from "./codec.ts";

export {
  Json,
  JsonEncodeError,
  JsonParseError,
  MAX_JSON_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
} from "./json.ts";
export type { JsonPathSegment, JsonValue } from "./json.ts";

export { JsonSchema, JsonSchemaError } from "./json-schema.ts";

export {
  OptionalSchemaValue,
  Schema,
  SchemaValue,
  isSchema,
} from "./schema.ts";
export type {
  OptionalSchema,
  RuntimeSchemaDescriptor,
  Schema as SchemaType,
  SchemaDescriptor,
  SchemaPathSegment,
  SchemaPropertyDescriptor,
  StructType,
} from "./schema.ts";

// Equivalence and Hash are implemented in Core Data and intentionally reused.
export { Equivalence } from "../data/equivalence.ts";
export { Hash } from "../data/hash.ts";
