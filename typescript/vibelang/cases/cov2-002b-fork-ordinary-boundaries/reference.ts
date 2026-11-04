import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
function fork(n: number) { return n + 1 }
function join(n: number) { return n + 2 }
class Plain { static value = 0; static { this.value = join(4) } }
const ordinary = async (join: number) => join
export function main() { return Effect.gen(function* () {
 class Fields { value = fork(4) }
 enum Count { One = join(4) }
 function plain(join: number) { return join }
 const later = async (value: number) => { const join = value; return join }
 const props = { join: plain, fork: 2 }
 return { field: new Fields().value, enumValue: Count.One as number, plainStatic: Plain.value, names: plain(7), property: props.join(2), asyncValue: yield* Effect.promise(() => later(8)), outside: yield* Effect.promise(() => ordinary(9)) }
}) }
