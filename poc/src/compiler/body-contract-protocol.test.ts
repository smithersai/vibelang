import { expect, test } from "bun:test";
import { decodeNativeBodyContract, NATIVE_API_VERSION } from "./protocol.ts";

const revision = "a".repeat(40);
const request = {project:{files:[{path:"/body/entry.ts",text:"export const Flow = (n: number) => n + 1"}],currentDirectory:"/body",diskDependencies:false},
  entryFile:"/body/entry.ts",entry:"Flow",logicalFileName:"entry.vibe",runtimeSpecifier:"vibelang/runtime",resumable:false,async:false};
const schema = (role:string) => ({format:"canonical-json",schemaVersion:1,role,shape:"structural",source:"compiler-derived",descriptor:{kind:"number"},digest:"b".repeat(64)});
const wire = ():any => ({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result:{ok:true,diagnostics:[],reason:"",message:"",schemasJson:JSON.stringify({inputSchema:schema("input"),successSchema:schema("success"),failureSchema:{...schema("error"),descriptor:{kind:"never"}}})}});
const decode = (value:unknown) => decodeNativeBodyContract(JSON.stringify(value),revision,request);
test("native body contracts carry only schemas and bounded diagnostics",()=>{
  const result = decode(wire());
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.schemasJson).successSchema.descriptor).toEqual({kind:"number"});
});
for (const [name,mutate] of [
  ["wrong API",(w:any)=>{w.apiVersion--}],
  ["wrong revision",(w:any)=>{w.compilerRevision="b".repeat(40)}],
  ["compiler object",(w:any)=>{w.result.checker={}}],
  ["success with refusal",(w:any)=>{w.result.reason="entry"}],
  ["success with message",(w:any)=>{w.result.message="bad"}],
  ["missing schemas",(w:any)=>{w.result.schemasJson=""}],
  ["invalid schema JSON",(w:any)=>{w.result.schemasJson="{"}],
  ["null schemas",(w:any)=>{w.result.schemasJson="null"}],
  ["unknown schemas",(w:any)=>{w.result.schemasJson=JSON.stringify({...JSON.parse(w.result.schemasJson),fallback:true})}],
  ["check failure without findings",(w:any)=>{Object.assign(w.result,{ok:false,reason:"check",message:"bad",schemasJson:""})}],
  ["unknown refusal",(w:any)=>{Object.assign(w.result,{ok:false,reason:"unsupported",message:"bad",schemasJson:""})}],
  ["retained schemas on failure",(w:any)=>{Object.assign(w.result,{ok:false,reason:"boundary",message:"bad"})}],
  ["incorrect diagnostic code",(w:any)=>{w.result.diagnostics=[{code:"VIBE4110",category:"warning",phase:"check",message:"bad"}]}],
  ["out-of-root diagnostic",(w:any)=>{w.result.diagnostics=[{code:"TS2322",category:"warning",phase:"check",message:"bad",file:"/other.ts"}]}],
  ["out-of-range diagnostic",(w:any)=>{w.result.diagnostics=[{code:"TS2322",category:"warning",phase:"check",message:"bad",file:request.entryFile,span:{start:999,length:1}}]}],
  ["schemas budget",(w:any)=>{w.result.schemasJson=" ".repeat(16*1024*1024+1)}],
] as const) test(`native body contract protocol rejects ${name}`,()=>{const w=wire();mutate(w);expect(()=>decode(w)).toThrow()});
for (const [name,mutate] of [
  ["legacy JSON hole",(s:any)=>{s.inputSchema.shape="json-value";s.inputSchema.source="compiler-derived-poc-stub"}],
  ["wrong schema role",(s:any)=>{s.failureSchema.role="success"}],
  ["missing descriptor",(s:any)=>{delete s.successSchema.descriptor}],
  ["unknown schema field",(s:any)=>{s.successSchema.type={}}],
  ["invalid digest",(s:any)=>{s.successSchema.digest="nope"}],
  ["non-scalar text",(s:any)=>{s.successSchema.descriptor={kind:"literal",value:"\ud800"}}],
  ["depth budget",(s:any)=>{for(let i=0;i<300;i++) s.successSchema.descriptor={kind:"array",element:s.successSchema.descriptor}}],
] as const) test(`native body schema protocol rejects ${name}`,()=>{
  const w=wire(),s=JSON.parse(w.result.schemasJson);mutate(s);w.result.schemasJson=JSON.stringify(s);expect(()=>decode(w)).toThrow();
});
test("body protocol preserves entry and boundary refusal data without partial codecs",()=>{
  for(const reason of ["entry","boundary"] as const){
    const w=wire();Object.assign(w.result,{ok:false,reason,message:"refused",schemasJson:""});
    expect(decode(w)).toEqual(w.result);
  }
  const w=wire();Object.assign(w.result,{ok:false,reason:"check",message:"not checked",schemasJson:"",diagnostics:[{code:"TS2322",category:"error",phase:"check",message:"bad",file:request.entryFile,span:{start:13,length:4}}]});
  expect(decode(w)).toEqual(w.result);
});
