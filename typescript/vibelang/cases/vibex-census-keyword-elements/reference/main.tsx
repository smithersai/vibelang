import {Effect} from "effect"
import {h,type VNode} from "./jsx.js"
declare global { namespace JSX { type Element=VNode; interface IntrinsicElements { [tag:string]: Record<string,unknown> } } }
function Show(props: Record<string,unknown>): VNode { return {tag:"Show",props,children:[]} }
export function main(): Effect.Effect<Array<VNode>> {
 return Effect.gen(function*(){
 const names=<keywords><try/><match/><effect/><service/><data/><fork/><join/><provide/><catch/><when/><is/><control/><handle/><layer/><map/><select/></keywords>
 const attrs=<Show when={true} is="a" match={1} try={2} effect={3} fork provide="y"/>
 const text=<p title="{try p}">Hi! 50% off |&gt;</p>
 return [names,attrs,text]
 })
}
