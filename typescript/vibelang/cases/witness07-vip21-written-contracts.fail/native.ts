import { Effect, Queue, Stream } from "effect"
declare const needsDb: Effect.Effect<number, never, "Db">
type Numbers = Stream.Stream<number>
const one = Stream.callback<number>((q) => Queue.offer(q, 1))

export function okDirect(): Stream.Stream<number> { return one }
export function okFull(): Stream.Stream<number, string, "Db"> { return Stream.callback<number, string, "Db">((q) => Effect.gen(function* () { yield* Queue.offer(q, yield* needsDb); return yield* Effect.fail("bad") })) }
export function okWide(): Stream.Stream<number | string, string | boolean, "Db" | "Log"> { return one }
export function badYield(): Stream.Stream<string> { return one }
export function badError(): Stream.Stream<number> { return Stream.callback<number, string>((q) => Effect.andThen(Queue.offer(q, 1), Effect.fail("bad"))) }
export function badRequirement(): Stream.Stream<number> { return Stream.callback<number, never, "Db">((q) => Effect.flatMap(needsDb, (n) => Queue.offer(q, n))) }
export function okStructural(): {} { return one }
export function badEffect(): Effect.Effect<number> { return one }
export function badIterable(): Iterable<number> { return one }
export const okExpression = function (): Stream.Stream<number> { return one }
export const badExpression = function (): Stream.Stream<string> { return one }

export function okAlias(): Numbers { return one }
export function okAny(): any { return one }
export function okUnknown(): unknown { return one }
export function okUnion(): Numbers | Stream.Stream<string> { return one }
export function okOptional(): Numbers | undefined { return one }
export function badUnion(): Stream.Stream<string> | undefined { return one }
export function badNever(): never { return one }
