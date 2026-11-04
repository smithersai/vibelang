// A renumbering authorization never licenses a new acceptance predicate.
import {createHash} from "node:crypto"
import {goTokens} from "./diagnostic-identity.mjs"
export const renameRoles = {
 "handlers.go":{EK9210:"EK2005"},
 "layers_check.go":{EK9209:"EK2104"},
 "wire.go":{EK9211:"EK3201"},
 "service_key_calls.go":{EK9214:"EK3007","9214":"3007"},
 "project.go":{"9203":"2003"},
 "forms_resolve.go":{"9005":"9100"},
 "data_methods.go":{"9006":"9101"},
 "syntax_diagnostics.go":{"9209":"2104","2101":"CodeUnprojectedForm"},
}
const replace=(values,from,to)=>{
 const out=[]
 for(let i=0;i<values.length;) {
  if(from.every((v,j)=>values[i+j]===v)){out.push(...to);i+=from.length}
  else out.push(values[i++])
 }
 return out
}
export function identityTokens(text,file) {
 let values=goTokens(text).map(t=>t.value)
 const tokens=text=>goTokens(text).map(t=>t.value)
 if(file.endsWith("/for_try.go")) {
  const assignment="registry[forTryHead.Code] = forTryHead"
  values=replace(values,tokens("if registry[forTryHead.Code] == nil {"+assignment+"}"),["FOR_TRY_HEAD_REGISTRATION"])
  values=replace(values,tokens(assignment),["FOR_TRY_HEAD_REGISTRATION"])
 }
 if(file.endsWith("/effect_pin.go")) {
  const message='"The resolved effect is {0}; VibeLang {1} pins {2}: upgrade both together."'
  values=replace(values,tokens("var effectPinDiagnostic = EK3201.With("+message+")"),["EFFECT_PIN_PRIMARY_REGISTRATION"])
  values=replace(values,tokens("var EK3201 = message(3201,errorCategory,"+message+")\nvar effectPinDiagnostic = EK3201\nfunc init() { registry[EK3201.Code] = EK3201 }"),["EFFECT_PIN_PRIMARY_REGISTRATION"])
 }
 if(file.endsWith("/syntax_diagnostics.go")) {
  // VIP-9 retired the body's missing-type refusal. Native noImplicitAny
  // owns service signatures; the incomplete control's refusal is renamed.
  values=replace(values,tokens('if member.Type() == nil { p.syntaxDiagnostic(member.Name(), 2101, class.Name().Text()+"."+member.Name().Text()+" has no body to infer from. Write its return type.") }'),[])
 }
 const map=renameRoles[file.split("/").at(-1)]??{}
 return values.map(v=>map[v]??v)
}
export const identityHash=(text,file)=>createHash("sha256").update(JSON.stringify(identityTokens(text,file))).digest("hex")
