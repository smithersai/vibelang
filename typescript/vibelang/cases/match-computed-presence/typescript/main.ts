import { Effect } from "effect"
const field="field"
const symbol=Symbol.for("presence")
let reads=0
let keyReads=0
const value={get field(){reads++;return 7}}
const names={get field(){keyReads++;return "field"}}
function has(x:unknown,key:PropertyKey){return (typeof x==="object"&&x!==null||typeof x==="function")&&key in x}
function literal(x:unknown){return has(x,"field")}
function identifier(x:unknown){return has(x,field)}
function numeric(x:unknown){return has(x,1)}
function symbolic(x:unknown){return has(x,symbol)}
function dynamic(x:unknown){if((typeof x!=="object"||x===null)&&typeof x!=="function")return false;return names.field in x}
export function main():Effect.Effect<readonly unknown[],never>{return Effect.sync(():readonly unknown[] => [
 literal(value),identifier(value),numeric({1:undefined}),symbolic({[symbol]:undefined}),
 literal(Object.create({field:undefined})),literal({}),literal(1),
 dynamic(value),dynamic(1),reads,keyReads
])}
