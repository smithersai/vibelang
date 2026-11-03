import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
type Subject={_tag:"A"|"B"; x:number}|{_tag:"A"|"B"; y:string}
function label(s: Subject): number { switch(s._tag){case "A":return 1;case "B":return 2} }
return [label({_tag:"A",x:1}),label({_tag:"B",y:"x"})]
}) }
