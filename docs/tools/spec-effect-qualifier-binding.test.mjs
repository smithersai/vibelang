import assert from "node:assert/strict"
import test from "node:test"
import * as EffectNamespace from "effect/Effect"
import { Array as Arr } from "effect"
import { chapter, read } from "./spec-witness.mjs"
test("collision qualifiers belong only to the implicit binding",()=>{
 const text=chapter("005-services")
 assert.ok(text.includes("Where `Effect` is the compiler's implicit binding"))
 assert.ok(text.includes("A written binding keeps its ordinary TypeScript meaning"))
 assert.ok(text.includes("TS2339"))
 assert.match(read("docs/design/vips/0014-effect-modules-in-scope.md"),/implicit binding/)
})
test("the pinned Effect namespace has no collision modules; aliased root imports do",()=>{
 for(const name of ["Array","String","Record","Number","Boolean","Symbol","Function","Iterable"]) assert.equal(name in EffectNamespace,false,name)
 for(let n=0;n<128;n++) assert.equal(Arr.head([n,n+1]).value,n)
 const Effect={Array:{head:xs=>xs[0]+1}}
 assert.equal(Effect.Array.head([7]),8)
})
