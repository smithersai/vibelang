import { expect, test } from "bun:test";
import { decodeNativeSourceRecovery, NATIVE_API_VERSION } from "./protocol.ts";

const revision = "a".repeat(40);
const source = "// 🐱\nvalue";
const wire = (): any => ({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result:{
  code:source,changed:false,identityFallback:false,diagnostics:[],rejectedStarts:[],
  verbatim:[{derivedStart:0,authoredStart:0,length:source.length}],glue:[],
  tokens:[{kind:"Identifier",text:"value",start:source.indexOf("value"),end:source.length,endsExpression:true}],
}});
const decode = (value: unknown) => decodeNativeSourceRecovery(JSON.stringify(value),revision,source);
test("source recovery preserves scalar UTF16 spellings, exact maps, and native named token kinds",()=>{
  expect<unknown>(decode(wire())).toEqual(wire().result);
  const wrapped=wire();
  wrapped.result.code="{ "+source+" }";wrapped.result.changed=true;
  wrapped.result.verbatim[0].derivedStart=2;
  wrapped.result.glue=[{derivedStart:0,length:2,anchor:0},{derivedStart:source.length+2,length:2,anchor:source.length}];
  expect<unknown>(decode(wrapped)).toEqual(wrapped.result);
  const refused=wire();refused.result.diagnostics=[{severity:"error",code:"VIBE1717",message:"bounded refusal",start:0}];
  refused.result.identityFallback=true;
  expect(decode(refused).identityFallback).toBe(true);
});
for(const [name,mutate] of [
  ["API",(w:any)=>w.apiVersion--],
  ["revision",(w:any)=>w.compilerRevision="b".repeat(40)],
  ["compiler objects",(w:any)=>w.result.ast={}],
  ["missing code",(w:any)=>delete w.result.code],
  ["source repair",(w:any)=>w.result.code="\ud800"],
  ["output budget",(w:any)=>w.result.code=" ".repeat(4*1024*1024+65537)],
  ["changed identity",(w:any)=>w.result.changed=true],
  ["missing list",(w:any)=>delete w.result.glue],
  ["null tokens",(w:any)=>w.result.tokens=null],
  ["nonintegral run",(w:any)=>w.result.verbatim[0].length=0.5],
  ["negative run",(w:any)=>w.result.verbatim[0].authoredStart=-1],
  ["excessive run",(w:any)=>w.result.verbatim[0].length++],
  ["altered spelling",(w:any)=>{w.result.code=w.result.code.replace("value","other");w.result.changed=true}],
  ["unmapped code",(w:any)=>w.result.verbatim[0].length--],
  ["overlapping code",(w:any)=>w.result.verbatim.push({...w.result.verbatim[0]})],
  ["unknown run",(w:any)=>w.result.verbatim[0].node={}],
  ["overlapping glue",(w:any)=>w.result.glue.push({derivedStart:1,length:1,anchor:0})],
  ["empty glue",(w:any)=>w.result.glue.push({derivedStart:0,length:0,anchor:0})],
  ["unbound glue anchor",(w:any)=>w.result.glue.push({derivedStart:0,length:1,anchor:source.length+1})],
  ["unordered rejections",(w:any)=>w.result.rejectedStarts=[1,0]],
  ["duplicate rejections",(w:any)=>w.result.rejectedStarts=[1,1]],
  ["unbound rejections",(w:any)=>w.result.rejectedStarts=[source.length+1]],
  ["wrong diagnostic",(w:any)=>w.result.diagnostics=[{severity:"error",code:"TS1000",message:"bad",start:0}]],
  ["empty diagnostic",(w:any)=>w.result.diagnostics=[{severity:"error",code:"VIBE1717",message:"",start:0}]],
  ["foreign diagnostic",(w:any)=>w.result.diagnostics=[{severity:"error",code:"VIBE1717",message:"bad",start:source.length+1}]],
  ["empty token",(w:any)=>w.result.tokens[0].end=w.result.tokens[0].start],
  ["unbound token",(w:any)=>w.result.tokens[0].end++],
  ["false token spelling",(w:any)=>w.result.tokens[0].text="other"],
  ["numeric token kind",(w:any)=>w.result.tokens[0].kind=80],
  ["invalid token name",(w:any)=>w.result.tokens[0].kind="Identifier()"],
  ["missing boundary fact",(w:any)=>delete w.result.tokens[0].endsExpression],
  ["token AST",(w:any)=>w.result.tokens[0].parent={}],
  ["overlapping tokens",(w:any)=>w.result.tokens.push({...w.result.tokens[0]})],
  ["unexplained fallback",(w:any)=>w.result.identityFallback=true],
] as const) test(`source recovery protocol rejects ${name}`,()=>{
  const w=wire();mutate(w);expect(()=>decode(w)).toThrow();
});
