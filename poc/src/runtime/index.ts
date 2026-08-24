export {
  SMITHERS_FAILURE,
  SmithersFailure,
  __VSError,
  __vsCatch,
  catchFailure,
  isSmithersFailure,
  throwExpression,
  __vsThrow,
} from "./failure.ts";
export {
  Panic,
  __vsPanic,
  __vsPanicValue,
  catchPanic,
  catchPanicPromise,
  isPanic,
  makePanic,
  panic,
} from "./panic.ts";
export {
  ErrorCodecError,
  UnhandledException,
  __vsErrorCases,
  __vsRegisterError,
  __vsValidateForeignError,
  decodeError,
  encodeError,
  errorCases,
  errorIdentity,
  errorIs,
  errorMatches,
  isLocalError,
  matchError,
  matchErrorPartial,
  registerErrorCodec,
  registerErrorType,
  rootCause,
} from "./errors.ts";
export type {
  ErrorCase,
  ErrorConstructor,
  ErrorInstance,
  ErrorPayloadCodec,
  JsonValue,
  NominalError,
} from "./errors.ts";
export {
  Result,
  ResultValue,
  __vsInspectResult,
  __vsResultFailure,
  __vsResultSuccess,
  foreignBoundary,
  foreignBoundaryPromise,
  isResult,
  rethrowPanics,
} from "./result.ts";
export type { InspectedResult, Result as ResultType } from "./result.ts";
export {
  ValueCodecError,
  decodeResult,
  encodeResult,
} from "./wire.ts";
export type { ValueCodec } from "./wire.ts";
export { RuntimeValues } from "./values.ts";
export { Context, Layer, __vsUse, isLayer, useCapability } from "./layer.ts";
export type { CapabilityKey, CapabilityService, Layer as LayerType } from "./layer.ts";

/** Runtime identity for the compiler-checked native pin assertion. */
export const native = <F>(pinned: F): F => pinned;
