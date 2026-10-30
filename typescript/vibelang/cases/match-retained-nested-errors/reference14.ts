import * as M from "effect/http/HttpClientError"
export function witness(){
const copy={_tag:"HttpClientError", ["~effect/http/HttpClientError"]:"~effect/http/HttpClientError"};
if(!M.isHttpClientError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"HttpClientError"},null,{}];
return subjects.map(s=>[M.isHttpClientError(s),M.isHttpClientError(s),false,false]);
}
export function narrow(s:unknown){return M.isHttpClientError(s)?s._tag:undefined;}
