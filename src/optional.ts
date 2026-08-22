/** Hardened Optional runtime and compatibility aliases for historical hook names. */
export {
  MissingOptionalValue,
  Optional,
  OptionalValue,
  __vsInspectOptional,
  __vsOptionalNone,
  __vsOptionalNone as __optionalAbsent,
  __vsOptionalSome,
  __vsOptionalSome as __optionalPresent,
  isOptional,
} from "../poc/dist/runtime/optional.js";
export type {
  InspectedOptional,
  Optional as OptionalType,
} from "../poc/dist/runtime/optional.js";
export {
  ValueCodecError,
  decodeOptional,
  encodeOptional,
} from "../poc/dist/runtime/wire.js";
export type { ValueCodec } from "../poc/dist/runtime/wire.js";
