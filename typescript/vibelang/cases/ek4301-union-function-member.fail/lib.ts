import type * as Effect from "effect/Effect"

export interface Like<R> { readonly witness: R }
export interface Resource<R> extends Like<R> { (id: string): Effect.Effect<R> }
export declare const Thing: Resource<number>
export declare function register<W>(cls: Like<W> | Function): number
export declare function collection<T extends Like<any> | Function>(all: T[]): number
