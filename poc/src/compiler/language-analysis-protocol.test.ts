import { expect, test } from "bun:test";
import { decodeNativeLanguageAnalysis, NATIVE_API_VERSION, type NativeLanguageAnalysisRequest } from "./protocol.ts";

const revision = "a".repeat(40);
const source = "// 😀\nexport function work() { return 42 }";
const request: NativeLanguageAnalysisRequest = { files: [{ path: "main.vibe", kind: "vibelang", text: source }] };
const fn = () => ({name:"work",exported:true,async:false,channel:"plain",explicitReturn:false,
  start:source.indexOf("export"),end:source.length,bodyStart:source.indexOf("{"),bodyEnd:source.length,
  moduleScope:true,failures:[],requirements:[]});
const wire = (): any => ({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result:{checked:true,diagnostics:[],
  files:[{path:"main.vibe",analyzed:true,errors:[],functions:[fn()]}]}});
const decode = (value: unknown) => decodeNativeLanguageAnalysis(JSON.stringify(value), revision, request);

test("native language analysis distinguishes provisional editor facts from checked compilation",()=>{
  expect<unknown>(decode(wire())).toEqual(wire().result);
  const refused=wire();refused.result.checked=false;
  refused.result.diagnostics=[{code:"VIBE2101",category:"error",message:"missing Db",file:"main.vibe",span:{start:0,length:1},phase:"lower"}];
  refused.result.files[0].functions[0].requirements=["Db"];
  expect(decode(refused).checked).toBe(false);
  refused.result.files[0].analyzed=false;refused.result.files[0].functions=[];
  expect(decode(refused).files[0]?.analyzed).toBe(false);
  const empty={...wire(),result:{checked:true,diagnostics:[],files:[]}};
  expect(decodeNativeLanguageAnalysis(JSON.stringify(empty),revision,{files:[]}).checked).toBe(true);
});

for(const [name,mutate] of [
  ["API",(v:any)=>v.apiVersion--],
  ["revision",(v:any)=>v.compilerRevision="b".repeat(40)],
  ["compiler objects",(v:any)=>v.result.program={}],
  ["emitted artifacts",(v:any)=>v.result.artifacts=[]],
  ["unexplained refusal",(v:any)=>v.result.checked=false],
  ["checked error",(v:any)=>v.result.diagnostics=[{code:"TS2304",category:"error",message:"absent"}]],
  ["unchecked source",(v:any)=>{v.result.files[0].analyzed=false;v.result.files[0].functions=[]}],
  ["invented syntax-refused facts",(v:any)=>v.result.files[0].analyzed=false],
  ["unknown file",(v:any)=>v.result.files[0].path="foreign.vibe"],
  ["duplicate file",(v:any)=>v.result.files.push(v.result.files[0])],
  ["missing file",(v:any)=>v.result.files=[]],
  ["null list",(v:any)=>v.result.files[0].errors=null],
  ["source-repaired function",(v:any)=>v.result.files[0].functions[0].name="\ud800"],
  ["missing name",(v:any)=>v.result.files[0].functions[0].name=""],
  ["numeric boolean",(v:any)=>v.result.files[0].functions[0].moduleScope=1],
  ["invalid channel",(v:any)=>v.result.files[0].functions[0].channel="generator"],
  ["negative span",(v:any)=>v.result.files[0].functions[0].start=-1],
  ["fractional span",(v:any)=>v.result.files[0].functions[0].start=1.5],
  ["escaping span",(v:any)=>v.result.files[0].functions[0].end++],
  ["empty span",(v:any)=>v.result.files[0].functions[0].end=fn().start],
  ["escaping body",(v:any)=>v.result.files[0].functions[0].bodyStart=0],
  ["reversed body",(v:any)=>v.result.files[0].functions[0].bodyEnd=fn().bodyStart-1],
  ["lost row",(v:any)=>v.result.files[0].functions[0].requirements=null],
  ["row AST",(v:any)=>v.result.files[0].functions[0].requirements=[{}]],
  ["empty row name",(v:any)=>v.result.files[0].functions[0].requirements=[""]],
  ["NUL row name",(v:any)=>v.result.files[0].functions[0].requirements=["a\0b"]],
  ["duplicate row",(v:any)=>v.result.files[0].functions[0].requirements=["Db","Db"]],
  ["unordered row",(v:any)=>v.result.files[0].functions[0].requirements=["Z","A"]],
  ["plain failure row",(v:any)=>v.result.files[0].functions[0].failures=["Boom"]],
  ["function AST",(v:any)=>v.result.files[0].functions[0].node={}],
  ["duplicate function",(v:any)=>v.result.files[0].functions.push(v.result.files[0].functions[0])],
  ["invented Error body",(v:any)=>v.result.files[0].errors=[{name:"E",fieldsSource:"not authored",start:0,end:1}]],
  ["escaping Error",(v:any)=>v.result.files[0].errors=[{name:"E",fieldsSource:"",start:0,end:source.length+1}]],
  ["escaping diagnostic",(v:any)=>v.result.diagnostics=[{code:"TS2304",category:"warning",message:"absent",file:"main.vibe",span:{start:source.length+1,length:1}}]],
] as const)test(`native language analysis protocol rejects ${name}`,()=>{const value=wire();mutate(value);expect(()=>decode(value)).toThrow()});
