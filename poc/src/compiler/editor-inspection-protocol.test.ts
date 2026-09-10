import { expect, test } from "bun:test";
import { decodeNativeInspection, NATIVE_API_VERSION } from "./protocol.ts";

const revision="a".repeat(40),text='import(`./a`); import(name)';
const sources=[{path:"editor.vibe",text,scriptKind:"typescript" as const}];
test("literal kind and exact range stay separate from resolved value and containing expression",()=>{
  const facts=[{kind:"dynamic-import",topLevel:false,span:{start:0,length:13},specifier:"./a",specifierKind:"template",specifierSpan:{start:7,length:5}},
    {kind:"dynamic-import",topLevel:false,span:{start:15,length:12}}];
  const result={files:[{path:sources[0].path,diagnostics:[],moduleSyntax:facts}]};
  // The nonliteral expression has no fabricated target or token range.
  expect<unknown>(decodeNativeInspection(JSON.stringify({apiVersion:NATIVE_API_VERSION,compilerRevision:revision,result}),revision,sources)).toEqual(result);
});
