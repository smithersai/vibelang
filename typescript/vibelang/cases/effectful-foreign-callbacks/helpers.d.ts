import type { Effect, Stream, Layer } from "effect"
/** @throws {Error} */
export declare function fx(): Effect.Effect<number>
/** @throws {unknown} */
export declare function unknownFx(): Effect.Effect<number>
/** @throws {Error} */
export declare function stream(): Stream.Stream<number>
/** @throws {Error} */
export declare function layer(): Layer.Layer<never>
/** @throws {Error} */
export declare function union(): Effect.Effect<number> | Effect.Effect<string>
/** @throws {Error} */
export declare function genericFx<T extends Effect.Effect<number>>(): T
/** @throws {unknown} */
export declare function genericStream<T extends Stream.Stream<number>>(): T
/** @throws {Error} */
export declare function genericLayer<T extends Layer.Layer<never>>(): T
/** @throws {Error} */
export declare function promise(): Promise<number>
/** @throws {Error} */
export declare function anyResult(): any
/** @throws {Error} */
export declare function unknownResult(): unknown
/** @throws {Error} */
export declare function neverResult(): never
/** @throws {Error} */
export declare function mixed(): Effect.Effect<number> | number
/** @throws {Error} */
export declare function generic<T>(): T
/** @throws {Error} */
export declare function defaultGeneric<T = Effect.Effect<number>>(): T
export namespace Fake { export type Effect<A> = number }
/** @throws {Error} */
export declare function fake(): Fake.Effect<number>
export interface Fx { (): Effect.Effect<number> }
export interface St { (): Stream.Stream<number> }
export interface La { (): Layer.Layer<never> }
export interface Un { (): Effect.Effect<number> | Effect.Effect<string> }
export interface GF { <T extends Effect.Effect<number>>(): T }
export interface GS { <T extends Stream.Stream<number>>(): T }
export interface GL { <T extends Layer.Layer<never>>(): T }
export interface Pr { (): Promise<number> }
export interface An { (): any }
export interface Uk { (): unknown }
export interface Nv { (): never }
export interface Mx { (): Effect.Effect<number> | number }
export interface Gn { <T>(): T }
export interface Dg { <T = Effect.Effect<number>>(): T }
export interface Fk { (): Fake.Effect<number> }
/** @throws {never} */
export declare function takeFx(value: Fx): void
/** @throws {never} */
export declare function takeStream(value: St): void
/** @throws {never} */
export declare function takeLayer(value: La): void
/** @throws {never} */
export declare function takeUnion(value: Un): void
/** @throws {never} */
export declare function takeGF(value: GF): void
/** @throws {never} */
export declare function takeGS(value: GS): void
/** @throws {never} */
export declare function takeGL(value: GL): void
/** @throws {never} */
export declare function takePromise(value: Pr): void
/** @throws {never} */
export declare function takeAny(value: An): void
/** @throws {never} */
export declare function takeUnknown(value: Uk): void
/** @throws {never} */
export declare function takeNever(value: Nv): void
/** @throws {never} */
export declare function takeMixed(value: Mx): void
/** @throws {never} */
export declare function takeGeneric(value: Gn): void
/** @throws {never} */
export declare function takeDefault(value: Dg): void
/** @throws {never} */
export declare function takeFake(value: Fk): void
/** @throws {never} */
export declare function wrongFx(value: () => Effect.Effect<string>): void
/** @throws {never} */
export declare function wrongStream(value: () => Stream.Stream<string>): void
