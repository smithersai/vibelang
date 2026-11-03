import { Effect } from "effect"
import { h, type VNode } from "./jsx.js"
declare global { namespace JSX {
 type Element = VNode
 interface IntrinsicElements { [tag: string]: Record<string, unknown> }
}}
export function main(): Effect.Effect<Array<unknown>> {
 return Effect.gen(function*() {
 const trace: string[] = []
 function mark(s: string) { trace.push(s); return s }
 function jump(): number | VNode {
  mark("return:first")
  return 7
 }
 const result=jump()
 for(let i=0; i<3; i++) {
  mark("loop:"+i)
  if(i===0) continue
  break
 }
 return [result,trace]
 })
}
