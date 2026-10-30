import * as M from "effect/encoding/Xml"
export function witness(){
const copy={_tag:"XmlError", ["~effect/encoding/Xml/XmlError"]:"~effect/encoding/Xml/XmlError"};
if(!M.isXmlError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"XmlError"},null,{}];
return subjects.map(s=>[M.isXmlError(s),M.isXmlError(s),false,false]);
}
export function narrow(s:unknown){return M.isXmlError(s)?s._tag:undefined;}
