import * as M from "effect/encoding/Tar"
export function witness(){
const copy={_tag:"TarError", ["~effect/encoding/Tar/TarError"]:"~effect/encoding/Tar/TarError"};
if(!M.isTarError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"TarError"},null,{}];
return subjects.map(s=>[M.isTarError(s),M.isTarError(s),false,false]);
}
export function narrow(s:unknown){return M.isTarError(s)?s._tag:undefined;}
