import { Context, Effect } from "effect"

type Dispatch_shape = {
  readonly dispatchAsync: (message: unknown) => Effect.Effect<void>
  readonly dispatchSync: (message: unknown) => void
}
/** Effect service tag that provides message dispatching to the view layer. */
export class Dispatch extends Context.Service<Dispatch, Dispatch_shape>()("@foldkit/Dispatch") {}
export declare namespace Dispatch { type Shape = Dispatch_shape }

// alchemy: Domain/Telemetry, which imports Context from effect/Context; the
// migrate gate reads both import forms as one.
type Correlation_shape = { readonly id: string }
export class Correlation extends Context.Service<Correlation, Correlation_shape>()("alchemy/Domain/Correlation") {}
export declare namespace Correlation { type Shape = Correlation_shape }

// alchemy: Domain/Model.
type Store_shape = {
  /** The stored values. */
  items: ReadonlyArray<string>
  // A line comment.
  count: number
  /* A block comment. */
  cursor: number
  /** Reads the first value. */
  first: () => Effect.Effect<string>
}
export class Store extends Context.Service<Store, Store_shape>()("alchemy/Domain/Store") {}
export declare namespace Store { type Shape = Store_shape }
