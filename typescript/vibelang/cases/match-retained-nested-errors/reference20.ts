import * as M from "effect/workers/WorkerError"
export function witness(){
const copy={_tag:"WorkerError", ["~effect/workers/WorkerError"]:"~effect/workers/WorkerError"};
if(!M.isWorkerError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"WorkerError"},null,{}];
return subjects.map(s=>[M.isWorkerError(s),M.isWorkerError(s),false,false]);
}
export function narrow(s:unknown){return M.isWorkerError(s)?s._tag:undefined;}
