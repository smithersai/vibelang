import * as M from "effect/ai/AiError"
export function witness(){
const copy={_tag:"AiError", ["~effect/ai/AiError"]:"~effect/ai/AiError"};
if(!M.isAiError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"AiError"},null,{}];
return subjects.map(s=>[M.isAiError(s),M.isAiError(s),false,false]);
}
export function narrow(s:unknown){return M.isAiError(s)?s._tag:undefined;}
