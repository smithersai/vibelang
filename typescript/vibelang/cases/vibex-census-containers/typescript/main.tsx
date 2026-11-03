import { Effect, Data } from "effect"
import { h, type VNode } from "./jsx.js"
declare global {
 namespace JSX {
  type Element = VNode
  interface IntrinsicElements { task: {task?: Effect.Effect<number>; run?: unknown; onClick?: () => void}; [tag: string]: Record<string, unknown> }
 }
}
class Missing extends Data.TaggedError("Missing")<{readonly id:string}> {}
type User = { id: string }
/** @throws {never} */
function Task<T>(props: { run: T }): VNode { return <task run={props.run}/> }
const lift = <T extends Effect.Effect<User, Missing>>(v: T) => Effect.gen(function*(){ return v })
export const identity = <T,>(x: T) => Effect.gen(function*(){ return x })
export function main(): Effect.Effect<Array<VNode>> {
 return Effect.gen(function*() {
 let calls = 0
 const work = Effect.gen(function*(){ calls++; return 7 })
 const cold = <task task={work} onClick={() => Effect.gen(function*(){ calls++; return 9 })}/>
 const before = <count>{calls}</count>
 const n = yield* identity(yield* work)
 const view = ((topic: number) => <box f={() => topic}>{topic}{n % 2}</box>)(n)
 const value = n === 0 ? <small/> : <big/>
 const child = <root>{yield* Effect.succeed(2)}{3}{n === 7 ? <seven/> : <other/>}</root>
 const nested = <box task={Effect.gen(function*(){ return 1 })} value={{ effect: 1 }} />
 const typed = <Task<Effect.Effect<User, Missing>> run={Effect.succeed({ id: "u" })} />
 const slots = <Task<Effect.Effect<User>> run={Effect.succeed({ id: "v" })} />
 const props = { p: Effect.succeed(4) }
 const spread = <box {...props} />
 class C { render() { return Effect.gen(function*(){ return <b/> }) } }
 const obj = { m<T>(x: T) { return Effect.gen(function*(){ return x }) } }
 const rendered = yield* new C().render()
 const fromMethod = yield* obj.m(5)
 const recovered = yield* Effect.catch(Effect.fail("missing"), <E,>(e: E) => Effect.succeed(11))
 return [cold, before, view, value, child, nested, typed, slots, spread, rendered, <count>{fromMethod}{recovered}{calls}</count>]
 })
}
