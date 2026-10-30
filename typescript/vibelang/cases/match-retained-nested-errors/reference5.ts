import * as M from "effect/encoding/JsonArray"
export function witness(){
const copy={_tag:"JsonArrayError", ["~effect/encoding/JsonArray/JsonArrayError"]:"~effect/encoding/JsonArray/JsonArrayError"};
if(!M.isJsonArrayError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"JsonArrayError"},null,{}];
return subjects.map(s=>[M.isJsonArrayError(s),M.isJsonArrayError(s),false,false]);
}
export function narrow(s:unknown){return M.isJsonArrayError(s)?s._tag:undefined;}
