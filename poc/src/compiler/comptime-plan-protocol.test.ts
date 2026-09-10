import { expect, test } from "bun:test";
import { decodeNativeComptimePlan, NATIVE_API_VERSION, type NativeComptimePlanRequest } from "./protocol.ts";

const revision="a".repeat(40);
const request:NativeComptimePlanRequest={files:[{path:"main.ts",text:"comptime(42)",scriptKind:"typescript"}],target:"typescript-node",schemaRuntimeImport:"bound:schema",inputs:[]};
const at={file:"main.ts",span:{start:0,length:12}};
const argument={file:"main.ts",span:{start:9,length:2}};
const wire=():any=>({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result:{complete:true,diagnostics:[],reads:[],
  calls:[{at,argument,mappedOrigin:argument,origins:[argument],inputs:[],valueJson:'{"version":1,"nodes":[],"root":42}',schemaType:""}],
  edits:[{at,kind:"intrinsic-call",text:"(42 as const)",mappedOrigin:argument,origins:[argument]}]}});
const decode=(value:unknown,req=request)=>decodeNativeComptimePlan(JSON.stringify(value),revision,req);

test("native phase protocol distinguishes complete plans, read requests, and refusals",()=>{
  expect<unknown>(decode(wire())).toEqual(wire().result);
  for(const partial of [
    {diagnostics:[{at,code:"VCT1004",message:"unsupported"}],reads:[]},
    {diagnostics:[],reads:[{at,specifier:"./value.txt"}]},
  ]){
    const value=wire();value.result={complete:false,...partial,calls:[],edits:[]};
    expect(decode(value).complete).toBe(false);
  }
});
for(const [name,mutate] of [
  ["API",(v:any)=>v.apiVersion--],
  ["revision",(v:any)=>v.compilerRevision="b".repeat(40)],
  ["compiler AST",(v:any)=>v.result.program={}],
  ["unexplained incomplete",(v:any)=>v.result.complete=false],
  ["partial refusal",(v:any)=>{v.result.complete=false;v.result.diagnostics=[{at,code:"VCT1004",message:"bad"}]}],
  ["pending reads on success",(v:any)=>v.result.reads=[{at,specifier:"./x"}]],
  ["unknown source",(v:any)=>v.result.calls[0].at={...at,file:"other.ts"}],
  ["negative span",(v:any)=>v.result.calls[0].at={...at,span:{start:-1,length:12}}],
  ["escaping span",(v:any)=>v.result.calls[0].at={...at,span:{start:0,length:13}}],
  ["empty argument",(v:any)=>v.result.calls[0].argument={...at,span:{start:12,length:0}}],
  ["missing origins",(v:any)=>v.result.calls[0].origins=[]],
  ["duplicate origins",(v:any)=>v.result.calls[0].origins=[argument,argument]],
  ["unknown origin",(v:any)=>v.result.calls[0].mappedOrigin={...at,file:"other.ts"}],
  ["unknown input",(v:any)=>v.result.calls[0].inputs=[0]],
  ["extra value fields",(v:any)=>v.result.calls[0].checker={}],
  ["invalid graph JSON",(v:any)=>v.result.calls[0].valueJson="{"],
  ["plain JSON tree",(v:any)=>v.result.calls[0].valueJson='{"x":42}'],
  ["forward graph reference",(v:any)=>v.result.calls[0].valueJson='{"version":1,"nodes":[],"root":["ref",0]}'],
  ["unused graph definition",(v:any)=>v.result.calls[0].valueJson='{"version":1,"nodes":[{"kind":"array","items":[]}],"root":42}'],
  ["reordered graph keys",(v:any)=>v.result.calls[0].valueJson='{"version":1,"nodes":[{"kind":"object","entries":[["2",1],["1",2]]}],"root":["ref",0]}'],
  ["repaired source string",(v:any)=>v.result.calls[0].schemaType="\ud800"],
  ["overlapping calls",(v:any)=>v.result.calls.push(v.result.calls[0])],
  ["overlapping edits",(v:any)=>v.result.edits.push(v.result.edits[0])],
  ["invalid edit kind",(v:any)=>v.result.edits[0].kind="evaluate"],
  ["erasure inserts source",(v:any)=>v.result.edits[0].kind="remove-import"],
  ["invalid generated edge",(v:any)=>v.result.edits[0].kind="schema-runtime-import"],
] as const)test(`comptime phase protocol rejects ${name}`,()=>{const value=structuredClone(wire());mutate(value);expect(()=>decode(value)).toThrow()});
