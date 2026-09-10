import { expect, test } from "bun:test";
import { decodeNativeLanguageLowering, NATIVE_API_VERSION, type NativeLanguageLoweringRequest } from "./protocol.ts";

const revision = "a".repeat(40);
const source = "// 😀\r\nexport const answer = 42;\n";
const request: NativeLanguageLoweringRequest = {project:{files:[{path:"main.vibe",kind:"vibelang",text:source}]},
  runtimeImport:"vibelang/runtime",outputs:[{path:"main.vibe",sourceName:"authored/main.vibe",outputFileName:"/output/main.ts"}]};
const wire = (): any => ({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result:{ok:true,
  analysis:{checked:true,diagnostics:[],files:[{path:"main.vibe",analyzed:true,errors:[],functions:[]}]},diagnostics:[],
  files:[{path:"main.vibe",text:source,sourceMap:JSON.stringify({version:3,file:"main.ts",sourceRoot:"",
    sources:["authored/main.vibe"],sourcesContent:[source],names:[],mappings:"AAAA;AACA"})}]}});
const decode = (value: unknown) => decodeNativeLanguageLowering(JSON.stringify(value),revision,request);
const editMap = (mutate: (map:any)=>void) => (value:any) => {
  const map=JSON.parse(value.result.files[0].sourceMap); mutate(map); value.result.files[0].sourceMap=JSON.stringify(map);
};

test("SDK lowering protocol retains exact authored Unicode and output identity",()=>{
  expect<unknown>(decode(wire())).toEqual(wire().result);
  const empty=wire(); empty.result.files[0].text="";
  editMap(map=>map.mappings="")(empty);
  expect(decode(empty).files[0]!.text).toBe("");
});
for(const [name,mutate] of [
  ["missing completion",(v:any)=>delete v.result.ok],
  ["null completion",(v:any)=>v.result.ok=null],
  ["unexplained refusal",(v:any)=>v.result.ok=false],
  ["compiler object",(v:any)=>v.result.ast={}],
  ["missing file",(v:any)=>v.result.files=[]],
  ["duplicate file",(v:any)=>v.result.files.push(v.result.files[0])],
  ["foreign file",(v:any)=>v.result.files[0].path="other.vibe"],
  ["missing text",(v:any)=>delete v.result.files[0].text],
  ["null text",(v:any)=>v.result.files[0].text=null],
  ["empty mapped output",(v:any)=>v.result.files[0].text=""],
  ["missing source map",(v:any)=>delete v.result.files[0].sourceMap],
  ["unknown file field",(v:any)=>v.result.files[0].node={}],
  ["missing sources content",editMap(v=>delete v.sourcesContent)],
  ["null sources content",editMap(v=>v.sourcesContent=null)],
  ["changed source content",editMap(v=>v.sourcesContent=["wrong"])],
  ["missing map file",editMap(v=>delete v.file)],
  ["null map file",editMap(v=>v.file=null)],
  ["wrong output identity",editMap(v=>v.file="other.ts")],
  ["missing source root",editMap(v=>delete v.sourceRoot)],
  ["null source root",editMap(v=>v.sourceRoot=null)],
  ["missing names",editMap(v=>delete v.names)],
  ["null names",editMap(v=>v.names=null)],
  ["null name",editMap(v=>v.names=[null])],
  ["noncanonical source identity",editMap(v=>v.sources=["authored/./main.vibe"])],
  ["truncated VLQ",editMap(v=>v.mappings="g")],
  ["invalid field count",editMap(v=>v.mappings="AA")],
  ["wrong source index",editMap(v=>v.mappings="ACAA")],
  ["source line outside text",editMap(v=>v.mappings="AAgBA")],
  ["source column outside text",editMap(v=>v.mappings="AAAgB")],
  ["generated column outside text",editMap(v=>v.mappings="gBAAA")],
  ["invalid name index",editMap(v=>v.mappings="AAAAA")],
  ["analysis is not a proof",(v:any)=>v.result.analysis.checked=false],
] as const) test(`SDK lowering protocol rejects ${name}`,()=>{const value=wire();mutate(value);expect(()=>decode(value)).toThrow()});
