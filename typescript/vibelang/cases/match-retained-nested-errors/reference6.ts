import * as M from "effect/encoding/Ndjson"
export function witness(){
const copy={_tag:"NdjsonError", ["~effect/encoding/Ndjson/NdjsonError"]:"~effect/encoding/Ndjson/NdjsonError"};
if(!M.isNdjsonError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"NdjsonError"},null,{}];
return subjects.map(s=>[M.isNdjsonError(s),M.isNdjsonError(s),false,false]);
}
export function narrow(s:unknown){return M.isNdjsonError(s)?s._tag:undefined;}
