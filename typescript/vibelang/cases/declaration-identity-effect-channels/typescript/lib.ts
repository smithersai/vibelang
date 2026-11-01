import * as Effect from "effect/Effect"

export class A { readonly _tag = "A" }
export class B { readonly _tag = "B" }
export class C { readonly _tag = "C" }
export class Base { readonly code: number = 1 }
export class Derived extends Base { readonly detail: string = "" }
export type TagError = A | B
export type UntagError = A | B
export type ListError = A | B | C
export declare const tag: () => Effect.Effect<void, TagError>
export declare const untag: () => Effect.Effect<void, UntagError>
export declare const list: () => Effect.Effect<void, ListError>
export declare const read: () => Effect.Effect<number, UntagError>
export declare const base: () => Effect.Effect<void, Base>
export declare const derived: () => Effect.Effect<number, Derived>
