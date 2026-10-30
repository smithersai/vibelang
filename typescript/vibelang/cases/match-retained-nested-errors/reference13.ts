import * as M from "effect/http/HttpBody"
export function witness(){
const copy={_tag:"HttpBodyError", ["~effect/http/HttpBody/HttpBodyError"]:"~effect/http/HttpBody/HttpBodyError"};
if(!M.isHttpBodyError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"HttpBodyError"},null,{}];
return subjects.map(s=>[M.isHttpBodyError(s),M.isHttpBodyError(s),false,false]);
}
export function narrow(s:unknown){return M.isHttpBodyError(s)?s._tag:undefined;}
