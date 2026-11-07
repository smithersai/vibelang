type P=string&{readonly _tag:"P"}
type S=P|{_tag:"O"}
function classify(subject:S){
 if(subject!==null&&(typeof subject==="object"||typeof subject==="function")&&"_tag" in subject&&subject._tag==="O")return 1
 throw new TypeError()
}
/** @throws {never} */
export function nativeLabels():unknown[]{
 const values:S[]=["primitive" as P,{_tag:"O"}]
 return values.map(value=>{
  try{return classify(value)}
  catch(error){return [error instanceof TypeError?"TypeError":"other",error instanceof Error?error.message:String(error)]}
 })
}
