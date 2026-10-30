import * as M from "effect/http/HttpServerError"
export function witness(){
const copy={_tag:"HttpServerError", ["~effect/http/HttpServerError"]:"~effect/http/HttpServerError"};
if(!M.isHttpServerError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"HttpServerError"},null,{}];
return subjects.map(s=>[M.isHttpServerError(s),M.isHttpServerError(s),false,false]);
}
export function narrow(s:unknown){return M.isHttpServerError(s)?s._tag:undefined;}
