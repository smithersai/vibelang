import { Effect } from "effect"
import { h, type VNode } from "./jsx.js"
declare global { namespace JSX {
 type Element = VNode
 interface IntrinsicElements { [tag: string]: Record<string, unknown> }
}}
export function main(): Effect.Effect<Array<unknown>> {
 return Effect.gen(function*() {
 const x: unknown = {name:"Ada"}
 let name: unknown
 const view = <box ok={typeof x==="object" && x!==null && "name" in x && (name=x.name,true)} label={name}/>
 return [view,name]
 })
}
