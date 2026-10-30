import * as M from "effect/encoding/Zip"
export function witness(){
const copy={_tag:"ZipError", ["~effect/encoding/Zip/ZipError"]:"~effect/encoding/Zip/ZipError"};
if(!M.isZipError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"ZipError"},null,{}];
return subjects.map(s=>[M.isZipError(s),M.isZipError(s),false,false]);
}
export function narrow(s:unknown){return M.isZipError(s)?s._tag:undefined;}
