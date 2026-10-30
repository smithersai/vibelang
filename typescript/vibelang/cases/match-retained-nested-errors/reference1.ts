import * as M from "effect/ai/McpClientError"
export function witness(){
const copy={_tag:"McpClientError", ["~effect/ai/McpClientError"]:"~effect/ai/McpClientError"};
if(!M.isMcpClientError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"McpClientError"},null,{}];
return subjects.map(s=>[M.isMcpClientError(s),M.isMcpClientError(s),false,false]);
}
export function narrow(s:unknown){return M.isMcpClientError(s)?s._tag:undefined;}
