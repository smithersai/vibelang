import type * as Effect from "effect/Effect"

export interface Resource<R> { (id: string): Effect.Effect<R> }
export declare const Thing: Resource<number>
export declare function take(callback: Function): number
