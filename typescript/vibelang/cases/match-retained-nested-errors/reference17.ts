import * as M from "effect/socket/DatagramSocket"
export function witness(){
const copy={_tag:"DatagramSocketError", ["~effect/socket/DatagramSocket/DatagramSocketError"]:"~effect/socket/DatagramSocket/DatagramSocketError"};
if(!M.isDatagramSocketError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"DatagramSocketError"},null,{}];
return subjects.map(s=>[M.isDatagramSocketError(s),M.isDatagramSocketError(s),false,false]);
}
export function narrow(s:unknown){return M.isDatagramSocketError(s)?s._tag:undefined;}
