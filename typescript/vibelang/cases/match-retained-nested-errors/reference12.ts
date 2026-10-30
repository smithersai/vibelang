import * as M from "effect/http/Headers"
export function witness(){
const copy={_tag:"HeaderParseError", ["~effect/http/Headers/HeaderParseError"]:"~effect/http/Headers/HeaderParseError"};
if(!M.isHeaderParseError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"HeaderParseError"},null,{}];
return subjects.map(s=>[M.isHeaderParseError(s),M.isHeaderParseError(s),false,false]);
}
export function narrow(s:unknown){return M.isHeaderParseError(s)?s._tag:undefined;}
