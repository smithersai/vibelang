export {
  VIBELANG_FAILURE,
  VibeLangFailure,
  __VSError,
  __vsCatch,
  catchFailure,
  isVibeLangFailure,
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
  __vsMatchFailed,
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
  __vsCompleteResult,
  __vsInspectResult,
  __vsResultFailure,
  __vsResultSuccess,
  __vsUnwrapKnownSuccess,
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
export {
  Context,
  Layer,
  __vsUse,
  isLayer,
  useCapability,
} from "./layer.ts";
export type { CapabilityKey, CapabilityService, Layer as LayerType } from "./layer.ts";
/**
 * Generated-code ABI, not the author-facing language surface. The emitter
 * delegates into the request-producing hooks and drives ordinary function
 * entries with the Result delimiters. Handlers and continuations are not
 * exported here; the frontend rejects direct authored access to these hooks.
 */
export { __vsExpect, __vsGet, __vsPerform, __vsProvide, __vsProvideAsync, __vsProvideRoot, __vsProvideRootAsync, __vsPropagate, __vsResultScope, __vsResultScopeAsync, __vsRunEager, __vsRunResult, __vsRunResultAsync } from "./effect.ts";
export type { AnyRequest, AsyncResumable, Resumable } from "./effect.ts";
export { __vsBindSuper, __vsSuperReference } from "./lexical.ts";

/** Runtime identity for the compiler-checked native pin assertion. */
export const native = <F>(pinned: F): F => pinned;
