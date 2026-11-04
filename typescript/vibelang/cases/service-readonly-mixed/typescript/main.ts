import { Context, Effect } from "effect"
type Store_shape = { readonly id: string; count: number; readonly label?: string; options?: { readonly key: string; value: number }; load?(): Effect.Effect<number>; callback: (n: number) => Effect.Effect<string> }
export class Store extends Context.Service<Store, Store_shape>()("test/Store") {}
export declare namespace Store { type Shape = Store_shape }
