import * as M from "effect/encoding/Csv"
export function witness(){
const copy={_tag:"CsvError", ["~effect/encoding/Csv/CsvError"]:"~effect/encoding/Csv/CsvError"};
if(!M.isCsvError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"CsvError"},null,{}];
return subjects.map(s=>[M.isCsvError(s),M.isCsvError(s),false,false]);
}
export function narrow(s:unknown){return M.isCsvError(s)?s._tag:undefined;}
