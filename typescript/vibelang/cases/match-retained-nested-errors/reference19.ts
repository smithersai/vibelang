import * as M from "effect/sql/SqlError"
export function witness(){
const copy={_tag:"SqlError", ["~effect/sql/SqlError"]:"~effect/sql/SqlError"};
if(!M.isSqlError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"SqlError"},null,{}];
return subjects.map(s=>[M.isSqlError(s),M.isSqlError(s),false,false]);
}
export function narrow(s:unknown){return M.isSqlError(s)?s._tag:undefined;}
