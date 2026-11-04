import { Effect } from "effect"
export const defaulted = (x: number = 7) => Effect.gen(function* () { return x })
export const prefixed = (a: number, x: number = 7) => Effect.gen(function* () { return a + x })
export const destructured = ({ x }: { x: number } = { x: 7 }) => Effect.gen(function* () { return x })
export const rested = (x: number = 7, ...tail: number[]) => Effect.gen(function* () { return x + tail.length })
export function declaration(x: number = 7) { return Effect.gen(function* () { return x }) }
export const method = { run(x: number = 7) { return Effect.gen(function* () { return x }) } }.run
export const array = ([x]: number[] = [7]) => Effect.gen(function* () { return x })
