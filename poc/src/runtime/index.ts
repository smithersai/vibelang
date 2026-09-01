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
export {
  Context,
  Layer,
  __vsUse,
  isLayer,
  useCapability,
} from "./layer.ts";
export type { CapabilityKey, CapabilityService, Layer as LayerType } from "./layer.ts";
/**
 * The three hooks the resumable-lowering emitter writes into a lowered
 * module, and nothing else from `effect.ts`.
 *
 * That file's header records why the module is otherwise unreachable — a
 * request, a continuation and a handler MUST NOT be reifiable as values an
 * authored `.sm` can name — and these three do not weaken it. `__vsGet` and
 * `__vsProvide*` are spelled with the `__vs` prefix the frontend reserves, so
 * no authored program can bind them, and none of them hands back a request, a
 * continuation, or a handler: `__vsGet` answers with the capability instance,
 * `__vsProvideRoot` answers with the delimited computation's value, and
 * `__vsProvide` answers with a generator the emitter only ever `yield*`s.
 */
export { __vsGet, __vsProvide, __vsProvideRoot } from "./effect.ts";
export type { AnyRequest, Resumable } from "./effect.ts";

/** Runtime identity for the compiler-checked native pin assertion. */
export const native = <F>(pinned: F): F => pinned;
