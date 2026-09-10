import {expect,test} from "bun:test";
import {decodeNativeDeclarationText,decodeNativeGeneratedDeclarations,NATIVE_API_VERSION} from "./protocol.ts";

const revision = "a".repeat(40);
const request = {project:{files:[{path:"/project/main.mjs",text:"export const x: number = 42;"}],currentDirectory:"/project",diskDependencies:false}};
const wire = ():any => ({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result:{ok:true,outputs:[{path:"/project/main.d.mts",text:"export declare const x: number;"}],diagnostics:[]}});
const decode = (value:unknown) => decodeNativeGeneratedDeclarations(JSON.stringify(value),revision,request);
test("native declaration protocol accepts complete outputs and explicit diagnostic refusals",()=>{
  expect(decode(wire()).ok).toBe(true);
  const refused=wire(); refused.result.ok=false;refused.result.outputs=[];
  refused.result.diagnostics=[{code:"TS2322",category:"error",phase:"check",file:"/project/main.mjs",span:{start:13,length:1},message:"not assignable"}];
  expect(decode(refused).ok).toBe(false);
});
for (const [name,mutate] of [
  ["wrong compiler",(v:any)=>{v.compilerRevision="b".repeat(40)}],
  ["wrong API",(v:any)=>{v.apiVersion--}],
  ["compiler object",(v:any)=>{v.result.program={}}],
  ["missing output",(v:any)=>{v.result.outputs=[]}],
  ["wrong output extension",(v:any)=>{v.result.outputs[0].path="/project/main.js"}],
  ["foreign output path",(v:any)=>{v.result.outputs[0].path="/elsewhere/main.d.mts"}],
  ["duplicate output",(v:any)=>{v.result.outputs.push(v.result.outputs[0])}],
  ["partial refused output",(v:any)=>{v.result.ok=false}],
  ["non scalar output",(v:any)=>{v.result.outputs[0].text="\ud800"}],
  ["output budget",(v:any)=>{v.result.outputs[0].text=" ".repeat(4*1024*1024+1)}],
  ["success with diagnostic error",(v:any)=>{v.result.diagnostics=[{code:"TS2322",category:"error",phase:"check",message:"bad"}]}],
  ["diagnostic outside inputs",(v:any)=>{v.result.diagnostics=[{code:"TS2322",category:"warning",phase:"check",message:"bad",file:"/elsewhere/source.ts"}]}],
  ["diagnostic past EOF",(v:any)=>{v.result.diagnostics=[{code:"TS2322",category:"warning",phase:"check",message:"bad",file:"/project/main.mjs",span:{start:999,length:1}}]}],
  ["missing phase",(v:any)=>{v.result.diagnostics=[{code:"TS2322",category:"warning",message:"bad"}]}],
] as const) test(`native declaration protocol refuses ${name}`,()=>{const value=wire();mutate(value);expect(()=>decode(value)).toThrow()});

const inspection = {operation:"read" as const,path:"/project/main.d.ts",text:""};
const inspected = ():any => ({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result:{text:"",effects:{f:{failures:["Missing"],requirements:["Clock"]}}}});
const read = (value:unknown) => decodeNativeDeclarationText(JSON.stringify(value),revision,inspection);
test("declaration text protocol returns ordinary bounded row data",()=>{expect(read(inspected()).effects.f).toEqual({failures:["Missing"],requirements:["Clock"]})});
for (const [name,mutate] of [
  ["changed inspected source",(v:any)=>{v.result.text="changed"}],
  ["null row table",(v:any)=>{v.result.effects=null}],
  ["null names",(v:any)=>{v.result.effects.f.failures=null}],
  ["unknown row key",(v:any)=>{v.result.effects.f.signature={}}],
  ["unsorted names",(v:any)=>{v.result.effects.f.failures=["Zed","Alpha"]}],
  ["duplicate names",(v:any)=>{v.result.effects.f.failures=["Missing","Missing"]}],
  ["non scalar name",(v:any)=>{v.result.effects.f.failures=["\ud800"]}],
  ["row name budget",(v:any)=>{v.result.effects.f.failures=Array.from({length:1025},(_,i)=>"x"+String(i).padStart(5,"0"))}],
  ["scalar name budget",(v:any)=>{v.result.effects.f.failures=["x".repeat(1025)]}],
] as const) test(`declaration text protocol refuses ${name}`,()=>{const value=inspected();mutate(value);expect(()=>read(value)).toThrow()});
test("mutating declaration text operations cannot return an invented inspection table",()=>{
  expect(()=>decodeNativeDeclarationText(JSON.stringify(inspected()),revision,{...inspection,operation:"annotate"})).toThrow();
});
