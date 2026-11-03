import { Effect } from "effect"
export class ApiError extends Error { readonly _tag = "ApiError"; readonly status = 503 }
export declare const hostname: () => Effect.Effect<string | undefined, Error | ApiError>
export class A { readonly _tag = "A" }
export class B { readonly _tag = "B" }
export type TagError = A | B
export declare const tag: () => Effect.Effect<void, TagError>
