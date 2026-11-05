let calls=0
export const syntax=new SyntaxError("listed")
export const range=new RangeError("contract")
export const defect=new TypeError("defect")
/** @throws {RangeError} */
export const read:typeof JSON.parse=(text:string)=>{
 calls++
 if(text==="listed")throw syntax
 if(text==="contract")throw range
 if(text==="defect")throw defect
 return JSON.parse(text)
}
/** @throws {never} */
export const count=()=>calls
/** @throws {never} */
export function describeAll(exits:any[]) {
 const describe=(e:any)=>e._tag==="Success"?["Success",e.value]:["Failure",e.cause.reasons.map((r:any)=>[r._tag,(r.error||r.defect).name])]
 return [exits.map(describe),exits[1].cause.reasons[0].error===syntax,
  exits[2].cause.reasons[0].defect===range,exits[3].cause.reasons[0].defect===defect,calls]
}
