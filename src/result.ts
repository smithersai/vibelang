/** Hardened Result runtime and compatibility aliases for historical hook names. */
export {
  Result,
  ResultValue,
  __vsInspectResult,
  __vsResultFailure,
  __vsResultFailure as __resultError,
  __vsResultSuccess,
  __vsResultSuccess as __resultSuccess,
  foreignBoundary,
  foreignBoundaryPromise,
  isResult,
} from "../poc/dist/runtime/result.js";
export type {
  InspectedResult,
  Result as ResultType,
} from "../poc/dist/runtime/result.js";
export {
  ValueCodecError,
  decodeResult,
  encodeResult,
} from "../poc/dist/runtime/wire.js";
export type { ValueCodec } from "../poc/dist/runtime/wire.js";
export {
  ErrorCodecError,
  UnhandledException,
  decodeError,
  encodeError,
  errorCases,
  errorIdentity,
  errorIs,
  errorMatches,
  matchError,
  matchErrorPartial,
  registerErrorCodec,
  registerErrorType,
  rootCause,
} from "../poc/dist/runtime/errors.js";
export type {
  ErrorCase,
  ErrorConstructor,
  ErrorPayloadCodec,
  JsonValue,
} from "../poc/dist/runtime/errors.js";

import { registerErrorType } from "../poc/dist/runtime/errors.js";

/** @deprecated Compiler output registers constructors directly with __vsRegisterError. */
export function __setErrorIdentity(error: Error, identity: string): void {
  const prototype = Object.getPrototypeOf(error) as { constructor?: unknown } | null;
  const constructor = prototype?.constructor;
  if (typeof constructor !== "function") throw new TypeError("Error has no nominal constructor");
  registerErrorType(constructor as abstract new (...args: any[]) => Error, identity);
}
