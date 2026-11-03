import { Effect } from "effect"
enum Tag{A,B}
function shared(s:{_tag:"A";x:number}|{_tag:"A";y:number}):number{if(s._tag==="A")return 1;throw new TypeError()}
function unions(s:{_tag:"A"|"B"}|{_tag:"C"}):number{if(s._tag==="A")return 1;if(s._tag==="B")return 2;if(s._tag==="C")return 3;throw new TypeError()}
function numbers(s:{_tag:1|2}):number{if(s._tag===1)return 1;if(s._tag===2)return 2;throw new TypeError()}
function bigints(s:{_tag:1n|2n}):number{if(s._tag===1n)return 1;if(s._tag===2n)return 2;throw new TypeError()}
function booleans(s:{_tag:true|false}):number{if(s._tag===true)return 1;if(s._tag===false)return 2;throw new TypeError()}
function enums(s:{_tag:Tag}):number{if(s._tag===Tag.A)return 1;if(s._tag===Tag.B)return 2;throw new TypeError()}
function undefinedTag(s:{_tag:undefined}):number{if(s._tag===undefined)return 1;throw new TypeError()}
export function main():Effect.Effect<readonly number[]>{return Effect.sync(()=>[shared({_tag:"A",x:1}),shared({_tag:"A",y:2}),unions({_tag:"A"}),unions({_tag:"B"}),unions({_tag:"C"}),numbers({_tag:1}),numbers({_tag:2}),bigints({_tag:1n}),bigints({_tag:2n}),booleans({_tag:true}),booleans({_tag:false}),enums({_tag:Tag.A}),enums({_tag:Tag.B}),undefinedTag({_tag:undefined})])}
