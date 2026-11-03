import { Effect } from "effect"
function uniform(s:{_tag:"A"|"B"}):string {
 switch(s._tag){case "A":return "a";case "B":return "b";}
 // @ts-expect-error TS2322: exhausting a union-valued property does not make its object never.
 const left:never=s
 return "unreachable"
}
function members(s:{_tag:"A"}|{_tag:"B"}):string {
 switch(s._tag){case "A":return "a";case "B":return "b";}
 const left:never=s
 return "unreachable"
}
function original(a:object,id:number):unknown {if("id" in a){const branchId=a.id;return branchId}return id}
function incorrectlyRetargeted(a:object,id:number):unknown {let id2:unknown;if("id" in a){id2=a.id;return id2}return id2}
function witness():boolean {
 const authorWritten={} as {n:number}
 if(authorWritten.n!==undefined)throw new Error("author assertion changed runtime value")
 if(uniform({_tag:"A"})!=="a"||members({_tag:"B"})!=="b")throw new Error("tag control")
 if(original({},7)!==7||original({id:5},7)!==5||incorrectlyRetargeted({},7)!==undefined||incorrectlyRetargeted({id:5},7)!==5)throw new Error("unknown return is not a value-preservation proof")
 return true
}
export function main():Effect.Effect<boolean>{return Effect.sync(witness)}
