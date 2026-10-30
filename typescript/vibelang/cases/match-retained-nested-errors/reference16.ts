import * as M from "effect/http/Multipart"
export function witness(){
const copy={_tag:"MultipartError", ["~effect/http/Multipart/MultipartError"]:"~effect/http/Multipart/MultipartError"};
if(!M.isMultipartError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"MultipartError"},null,{}];
return subjects.map(s=>[M.isMultipartError(s),M.isMultipartError(s),false,false]);
}
export function narrow(s:unknown){return M.isMultipartError(s)?s._tag:undefined;}
