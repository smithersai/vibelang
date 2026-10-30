import * as M from "effect/http/Cookies"
export function witness(){
const copy={_tag:"CookiesError", ["~effect/http/Cookies/CookieError"]:"~effect/http/Cookies/CookieError"};
if(!M.isCookiesError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"CookiesError"},null,{}];
return subjects.map(s=>[M.isCookiesError(s),M.isCookiesError(s),false,false]);
}
export function narrow(s:unknown){return M.isCookiesError(s)?s._tag:undefined;}
