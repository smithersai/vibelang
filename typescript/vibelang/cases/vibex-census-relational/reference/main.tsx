import {Effect} from "effect"
import {h,type VNode} from "./jsx.js"
declare global { namespace JSX { type Element = VNode; interface IntrinsicElements { [tag:string]: Record<string,unknown> } } }
function Small(): VNode { return <small/> }
function Big(): VNode { return <big/> }
export function main(): Effect.Effect<VNode> {
 return Effect.gen(function*(){ const n=2; return n < 5 ? <Small/> : <Big/> })
}
