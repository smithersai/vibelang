import * as M from "effect/crypto/CryptoError"
export function witness(){
const copy={_tag:"CryptoError", ["~effect/crypto/CryptoError"]:"~effect/crypto/CryptoError"};
if(!M.isCryptoError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"CryptoError"},null,{}];
return subjects.map(s=>[M.isCryptoError(s),M.isCryptoError(s),false,false]);
}
export function narrow(s:unknown){return M.isCryptoError(s)?s._tag:undefined;}
