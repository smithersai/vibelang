import {Effect} from "effect"
import {h,type VNode} from "./jsx.js"
declare global { namespace JSX { type Element=VNode; interface IntrinsicElements { [tag:string]: Record<string,unknown> } } }
function Tag(): VNode { return <tag/> }
const fork = {in:Tag,scoped:Tag}
const join = {value:Tag}
export function main(): Effect.Effect<VNode> {
 return Effect.gen(function*(){ return <box><fork.in/><fork.scoped/><join.value/></box> })
}
