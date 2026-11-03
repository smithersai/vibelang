/** @throws {never} */
export function poison<A extends Function>(fn:A,events:string[]):A {
 for(const key of ["call","bind"])Object.defineProperty(fn,key,{get(){events.push("wrong-"+key);throw "observable helper lookup"}})
 return fn
}
