import { expect, test } from "bun:test";
import { decodeNativeGeneratedProject, NATIVE_API_VERSION } from "./protocol.ts";

const revision = "a".repeat(40);
const request = { files:[{path:"/project/main.ts",text:"// 😀\nlet x: number = 'bad';"}],currentDirectory:"/project",diskDependencies:false };
const wire = (): any => ({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result:{diagnostics:[{
  code:"TS2322",category:"error",message:"not assignable",file:request.files[0]!.path,span:{start:10,length:1},phase:"check",
}]}});
const decode = (value: unknown) => decodeNativeGeneratedProject(JSON.stringify(value),revision,request);
test("generated project protocol returns plain root, global and empty diagnostics", () => {
  expect(decode(wire()).diagnostics[0]?.span).toEqual({start:10,length:1});
  const global = wire(); delete global.result.diagnostics[0].file; delete global.result.diagnostics[0].span;
  expect(decode(global).diagnostics[0]?.file).toBeUndefined();
  const empty = wire(); empty.result.diagnostics = [];
  expect(decode(empty).diagnostics).toEqual([]);
});
for (const [name, mutate] of [
  ["wrong compiler",(v:any)=>{v.compilerRevision="b".repeat(40)}],
  ["wrong API",(v:any)=>{v.apiVersion--}],
  ["AST escape",(v:any)=>{v.result.program={}}],
  ["missing diagnostics",(v:any)=>{delete v.result.diagnostics}],
  ["null diagnostics",(v:any)=>{v.result.diagnostics=null}],
  ["budget",(v:any)=>{v.result.diagnostics=Array(4097).fill(v.result.diagnostics[0])}],
] as const) test(`generated project protocol refuses ${name}`,()=>{const value=wire();mutate(value);expect(()=>decode(value)).toThrow()});
for (const [name, mutate] of [
  ["dependency finding",(d:any)=>{d.file="/project/dependency.ts"}],
  ["missing source",(d:any)=>{delete d.file}],
  ["negative start",(d:any)=>{d.span.start=-1}],
  ["fractional length",(d:any)=>{d.span.length=0.5}],
  ["past EOF",(d:any)=>{d.span.start=request.files[0]!.text.length;d.span.length=1}],
  ["language-checker code",(d:any)=>{d.code="VIBE1101"}],
  ["emit phase",(d:any)=>{d.phase="emit"}],
  ["missing phase",(d:any)=>{delete d.phase}],
  ["compiler source object",(d:any)=>{d.file={fileName:d.file}}],
  ["non-scalar message",(d:any)=>{d.message="\ud800"}],
] as const) test(`generated project protocol refuses ${name}`,()=>{const value=wire();mutate(value.result.diagnostics[0]);expect(()=>decode(value)).toThrow()});
