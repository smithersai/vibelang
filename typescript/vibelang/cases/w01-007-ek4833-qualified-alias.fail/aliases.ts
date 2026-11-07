import { Context } from "effect"
import type { Effect as Fx } from "effect"

export interface Clock { readonly now: number }
export class ClockKey extends Context.Service<ClockKey, Clock>()("ClockKey") {}

// Exact forwarding aliases: every slot forwards, omitted slots default to never.
export declare namespace Forward { type Effect<A, E = never, R = never> = Fx.Effect<A, E, R> }
// A default other than never for an omitted slot.
export declare namespace Defaulted { type Effect<A, E = string, R = never> = Fx.Effect<A, E, R> }
// Parameter order differs from Effect's success, error, requirements order.
export declare namespace Swapped { type Effect<E, A> = Fx.Effect<A, E> }
// A wrapped slot.
export declare namespace Wrapped { type Effect<A> = Fx.Effect<ReadonlyArray<A>> }
// An added requirement.
export declare namespace Required { type Effect<A> = Fx.Effect<A, never, ClockKey> }
// A union branch.
export declare namespace Nullable { type Effect<A> = Fx.Effect<A> | null }
// Named Effect, but not Effect's own interface.
export declare namespace Foreign { type Effect<A> = Promise<A> }
