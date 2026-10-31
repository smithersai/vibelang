import { Effect, Layer, Stream } from "effect"

export const program = (n: number): Effect.Effect<number> => Effect.succeed(n)
export const layer = (): Layer.Layer<never> => Layer.empty
export const stream = (): Stream.Stream<number> => Stream.make(1)
export const bound = <T extends Effect.Effect<number>>(value: T): T => value
export const maybe = (n: number): Effect.Effect<number> | undefined => (n > 0 ? Effect.succeed(n) : undefined)
export const same = <T>(value: T): T => value
export const loose = (): any => Effect.succeed(1)
