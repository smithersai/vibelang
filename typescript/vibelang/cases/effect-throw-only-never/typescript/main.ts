import { Effect } from "effect"
import { plainFail, PlainWorker } from "./plain.js"
export function fail() { return Effect.gen(function* () { return yield* Effect.fail("stop") }) }
export function branch(flag: boolean) { return Effect.gen(function* () { if (flag) return yield* Effect.fail(1); else return yield* Effect.fail(2) }) }
export function empty() { return Effect.gen(function* () {}) }
export function fallthrough(flag: boolean) { return Effect.gen(function* () { if (flag) return yield* Effect.fail("stop") }) }
export function returnVoid() { return Effect.gen(function* () { return }) }
export const arrow = () => Effect.gen(function* () { return yield* Effect.fail("stop") })
export class Worker { fail() { return Effect.gen(function* () { return yield* Effect.fail("stop") }) } }
export const worker = { fail() { return Effect.gen(function* () { return yield* Effect.fail("stop") }) } }
export function nestedCallable() { return Effect.gen(function* () { function inner() { throw "nested" }; const arrow = () => { throw "nested" }; void inner; void arrow }) }
export function nestedClass() { return Effect.gen(function* () { class Inner { fail() { throw "nested" } }; void Inner }) }
export function diverges() { return Effect.gen(function* () { while (true) {} }) }
export function throwOrReturn(flag: boolean) { return Effect.gen(function* () { if (flag) return yield* Effect.fail("stop"); return }) }
type Success<F extends (...args: any[]) => any> = Effect.Success<ReturnType<F>>
type IsNever<T> = [T] extends [never] ? true : false
type Exact<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type IsVoid<T> = Exact<T, void>
type IsUndefined<T> = Exact<T, undefined>
const declaration: IsNever<Success<typeof fail>> = true
const branches: IsNever<Success<typeof branch>> = true
const classMethod: IsNever<Success<Worker["fail"]>> = true
const arrowMethod: IsNever<Success<typeof arrow>> = true
const objectMethod: IsNever<Success<typeof worker.fail>> = true
const emptyVoid: IsVoid<Success<typeof empty>> = true
const fallthroughVoid: IsUndefined<Success<typeof fallthrough>> = true
const explicitVoid: IsVoid<Success<typeof returnVoid>> = true
const plainVoid: IsVoid<ReturnType<typeof plainFail>> = true
const plainMethodVoid: IsVoid<ReturnType<PlainWorker["fail"]>> = true
const nestedFunctionVoid: IsVoid<Success<typeof nestedCallable>> = true
const nestedClassVoid: IsVoid<Success<typeof nestedClass>> = true
const divergingNever: IsNever<Success<typeof diverges>> = true
const throwOrReturnUndefined: IsUndefined<Success<typeof throwOrReturn>> = true
export function acceptsNever() { return Effect.gen(function* () {
 const value: never = yield* fail()
 return value
}) }
export function main() { return Effect.gen(function* () {
 const a = yield* Effect.exit(fail())
 const b = yield* Effect.exit(branch(true))
 return [
  declaration, branches, classMethod, arrowMethod, objectMethod,
    nestedFunctionVoid, nestedClassVoid, divergingNever, throwOrReturnUndefined,
  emptyVoid, fallthroughVoid, explicitVoid, plainVoid, plainMethodVoid,
  a._tag === "Failure" && a.cause.reasons[0]?._tag === "Fail" && a.cause.reasons[0].error === "stop",
  b._tag === "Failure" && b.cause.reasons[0]?._tag === "Fail" && b.cause.reasons[0].error === 1,
 ]
}) }
