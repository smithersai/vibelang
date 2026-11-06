/** @throws {never} */
export function nativeLabels(): Array<number|string>{
 let reads=0
 const Key={get field():"_tag"{reads++;return "_tag"}}
 function label<T extends {_tag:"A"|"B"}>(s:T):number{
  const tag=s[Key.field]
  if(tag==="A")return 1
  if((Key.field,tag)==="B")return 2
  throw new TypeError()
 }
 const a=label({_tag:"A"}),b=label({_tag:"B"})
 let missing="bad"
 try{label({_tag:"C"} as any)}catch(error){missing=error instanceof TypeError&&error.message===""?"TypeError":"wrong"}
 return [a,b,missing,reads,exhaustive({_tag:"A"},"_tag")]
}
export function exhaustive<T extends {_tag:"A"|"B"}>(s:T,key:"_tag"):number{
 const tag:"A"|"B"=s[key]
 switch(tag){case "A":return 1;case "B":return 2;default:{const remaining:never=tag;return remaining}}
}
