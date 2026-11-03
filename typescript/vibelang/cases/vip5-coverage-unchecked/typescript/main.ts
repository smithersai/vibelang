import { Effect } from "effect"
export function tail(value: any) { return Effect.gen(function* () { return yield* value }) }
export function statement(value: any) { return Effect.gen(function* () { const result = yield* value; return result }) }
export function contextual(value: any) { return Effect.gen(function* () { const checked: string = yield* value; return checked }) }
export function resolver(loose: any, port: number) { return Effect.gen(function* () { const host: string = yield* loose; return { endpoint: `${host}:${port}` } }) }
declare const loose: any
export const named = Effect.fn("resolve")(function* (port: number) {
  const host: string = yield* loose
  return { endpoint: `${host}:${port}` }
})
type Exact<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const directSuccessIsAny: Exact<Effect.Success<ReturnType<typeof tail>>,any> = true
const namedErrorIsUnknown: Exact<Effect.Error<ReturnType<typeof named>>,unknown> = true
const namedServicesAreUnknown: Exact<Effect.Services<ReturnType<typeof named>>,unknown> = true
const namedSuccess: Exact<Effect.Success<ReturnType<typeof named>>,{ endpoint: string }> = true
