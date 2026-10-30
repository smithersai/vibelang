import * as M from "effect/encoding/EncodingError"
export function witness(){
const copy={_tag:"EncodingError", ["~effect/encoding/EncodingError"]:"~effect/encoding/EncodingError"};
if(!M.isEncodingError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"EncodingError"},null,{}];
return subjects.map(s=>[M.isEncodingError(s),M.isEncodingError(s),false,false]);
}
export function narrow(s:unknown){return M.isEncodingError(s)?s._tag:undefined;}
