import { Effect } from "effect"
function pick(x: string): Effect.Effect<string>;
function pick(x: number): Effect.Effect<number>;
function pick(x: string | number) { return Effect.gen(function* () { return x }) }
class C {
  m(x: string): Effect.Effect<string>;
  m(x: number): Effect.Effect<number>;
  m(x: string | number) { return Effect.gen(function* () { return x }) }
}
export const stringResult = pick("ok")
export const numberResult = new C().m(7)
export function main(): Effect.Effect<readonly [string, number]> {
  return Effect.gen(function* () { return [yield* stringResult, yield* numberResult] as const })
}
