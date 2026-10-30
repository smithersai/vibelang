import * as M from "effect/socket/Socket"
export function witness(){
const copy={_tag:"SocketError", ["~effect/socket/Socket/SocketError"]:"~effect/socket/Socket/SocketError"};
if(!M.isSocketError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"SocketError"},null,{}];
return subjects.map(s=>[M.isSocketError(s),M.isSocketError(s),false,false]);
}
export function narrow(s:unknown){return M.isSocketError(s)?s._tag:undefined;}
