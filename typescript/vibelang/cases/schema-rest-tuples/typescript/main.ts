import { Effect, Schema } from "effect"
export const Readings = Schema.TupleWithRest(Schema.Tuple([Schema.String, Schema.optional(Schema.Number)]), [Schema.Boolean])
export type Readings = typeof Readings.Type
export const Bounded = Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number, Schema.Boolean])
export type Bounded = typeof Bounded.Type
export const Numbers = Schema.TupleWithRest(Schema.Tuple([]), [Schema.Number])
export type Numbers = typeof Numbers.Type
export const MutableRest = Schema.mutable(Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number, Schema.Boolean]))
export type MutableRest = typeof MutableRest.Type
export const FixedSpread = Schema.Tuple([Schema.String,Schema.Number,Schema.Boolean])
export type FixedSpread = typeof FixedSpread.Type
export const MutableFixedSpread = Schema.mutable(Schema.Tuple([Schema.String,Schema.Number,Schema.Boolean]))
export type MutableFixedSpread = typeof MutableFixedSpread.Type
export const NestedFixedSpread = Schema.Tuple([Schema.String,Schema.Number,Schema.Boolean,Schema.String])
export type NestedFixedSpread = typeof NestedFixedSpread.Type
export const TrailingFixedSpread = Schema.TupleWithRest(Schema.Tuple([Schema.String]),[Schema.Number,Schema.Boolean,Schema.String])
export type TrailingFixedSpread = typeof TrailingFixedSpread.Type
export const EmptyFixedSpread = Schema.Tuple([Schema.String])
export type EmptyFixedSpread = typeof EmptyFixedSpread.Type
export const OptionalHeadSpread = Schema.Tuple([Schema.Union([Schema.Number,Schema.Undefined]),Schema.String])
export type OptionalHeadSpread = typeof OptionalHeadSpread.Type
export const OptionalOperandSpread = Schema.Tuple([Schema.Union([Schema.Number,Schema.Undefined]),Schema.String])
export type OptionalOperandSpread = typeof OptionalOperandSpread.Type
export const NestedArraySpread = Schema.TupleWithRest(Schema.Tuple([Schema.String,Schema.Number]),[Schema.Boolean])
export type NestedArraySpread = typeof NestedArraySpread.Type
export const OptionalAfterArraySpread = Schema.TupleWithRest(Schema.Tuple([]),[Schema.Union([Schema.Number,Schema.Boolean,Schema.Undefined])])
export type OptionalAfterArraySpread = typeof OptionalAfterArraySpread.Type
export function main() {
  return Effect.gen(function* () {
    const readings = yield* Schema.decodeUnknownEffect(Readings)(["sensor", 2, true, false])
    const explicitUndefined = yield* Schema.decodeUnknownEffect(Readings)(["sensor", undefined, true])
    const empty = yield* Schema.decodeUnknownEffect(Readings)(["sensor"])
    const bounded = yield* Schema.decodeUnknownEffect(Bounded)(["sensor", 1, 2, true])
    const noNumbers = yield* Schema.decodeUnknownEffect(Numbers)([])
    const numbers = yield* Schema.decodeUnknownEffect(Numbers)([1, 2])
    const mutable = yield* Schema.decodeUnknownEffect(MutableRest)(["sensor", 1, true])
    mutable[0] = "changed"
    const fixedSpread = yield* Schema.decodeUnknownEffect(FixedSpread)(["sensor",1,true])
    const mutableFixed = yield* Schema.decodeUnknownEffect(MutableFixedSpread)(["sensor",1,true])
    mutableFixed[0] = "changed-fixed"
    const nestedFixed = yield* Schema.decodeUnknownEffect(NestedFixedSpread)(["sensor",1,true,"tail"])
    const trailingFixed = yield* Schema.decodeUnknownEffect(TrailingFixedSpread)(["sensor",1,2,true,"tail"])
    const emptyFixed = yield* Schema.decodeUnknownEffect(EmptyFixedSpread)(["sensor"])
    const optionalHead = yield* Schema.decodeUnknownEffect(OptionalHeadSpread)([undefined,"tail"])
    const optionalOperand = yield* Schema.decodeUnknownEffect(OptionalOperandSpread)([1,"tail"])
    const nestedArray = yield* Schema.decodeUnknownEffect(NestedArraySpread)(["sensor",1,true,false])
    const optionalAfterArray = yield* Schema.decodeUnknownEffect(OptionalAfterArraySpread)([1,true,undefined])
    return [readings, empty, bounded, noNumbers, numbers, Schema.is(Bounded)(["sensor", 1]), mutable, explicitUndefined, fixedSpread, mutableFixed, nestedFixed, trailingFixed, emptyFixed, Schema.is(FixedSpread)(["sensor",1]), optionalHead, optionalOperand, nestedArray, optionalAfterArray, Schema.is(OptionalHeadSpread)(["tail"]), Schema.is(NestedArraySpread)(["sensor",true])]
  })
}
