// The part of @effect/vitest 4.1.0's declarations that runners use, so cases
// need not install vitest. The real package re-exports vitest's describe.
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"

export declare namespace Vitest {
  interface TestFunction<A, E, R, TestArgs extends Array<any>> {
    (...args: TestArgs): Effect.Effect<A, E, R>
  }
  interface Test<R> {
    <A, E>(name: string, self: TestFunction<A, E, R, [unknown]>, timeout?: number): void
  }
  interface Tester<R> extends Vitest.Test<R> {
    skip: Vitest.Test<R>
    only: Vitest.Test<R>
    each: <T>(cases: ReadonlyArray<T>) => <A, E>(name: string, self: TestFunction<A, E, R, [T, unknown]>, timeout?: number) => void
  }
  interface MethodsNonLive<R = never> {
    readonly effect: Vitest.Tester<R | Scope.Scope>
    readonly layer: <R2, E>(layer: Layer.Layer<R2, E, R>) => {
      (f: (it: Vitest.MethodsNonLive<R | R2>) => void): void
      (name: string, f: (it: Vitest.MethodsNonLive<R | R2>) => void): void
    }
  }
  interface Methods<R = never> extends MethodsNonLive<R> {
    readonly live: Vitest.Tester<Scope.Scope | R>
  }
}

export declare const describe: (name: string, f: () => void) => void
export declare const it: Vitest.Methods
export declare const layer: <R, E>(layer_: Layer.Layer<R, E>) => {
  (f: (it: Vitest.MethodsNonLive<R>) => void): void
  (name: string, f: (it: Vitest.MethodsNonLive<R>) => void): void
}
