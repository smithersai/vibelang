/** @throws {never} */
export function optionalRead(read:()=>unknown){try{const value=read();return ["value",typeof value,String(value)]}catch(error){return ["tdz",error instanceof ReferenceError]}}

/** @throws {never} */
export function propertySamples() {
 let reads=0
 const ownGetter={get cell(){reads++;return undefined}}
 const prototype={value:2,get cell(){reads++;return this.value}}
 const inherited=Object.assign(Object.create(prototype),{value:7})
 return {ownGetter,inherited,reads:()=>reads}
}
