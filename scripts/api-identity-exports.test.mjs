import { checkProperty } from "./testing/property.mjs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {createRequire} from "node:module";
import { publishedEntrypoints } from "./api-identity.mjs";
const req=createRequire(new URL("../docs/tools/package.json",import.meta.url));
const fc=req("fast-check"),ts=req("typescript");
const scratch=tmpdir();
function fixture(exports,fn,files=["public","private","internal/secret","public/internal","public/extra","alternate"]) {
 const root=mkdtempSync(join(scratch,"null-export-test-")),pkg=join(root,"node_modules/fixture");
 try {
  for(const f of files) {
   const dest=join(pkg,"lib",f+".d.ts");mkdirSync(join(dest,".."),{recursive:true});writeFileSync(dest,"export type X=string;");
  }
  writeFileSync(join(pkg,"package.json"),JSON.stringify({name:"fixture",exports}));
  return fn(pkg,root);
 } finally {rmSync(root,{force:true,recursive:true});}
}
const broad={"types":"./lib/*.d.ts"};
test("exact and pattern null exports exclude declarations",()=>{
 fixture({"./*":broad,"./private":null,"./internal/*":null,"./*/internal":null},pkg=>{
  assert.deepEqual(Object.keys(publishedEntrypoints(pkg)),["./alternate","./public","./public/extra"]);
 });
});
test("exact subpaths override broad patterns in either insertion order",()=>{
 for(const reverse of [false,true]) {
  const items=[["./private","./lib/alternate.d.ts"],["./*",broad]];
  fixture(Object.fromEntries(reverse?items.reverse():items),pkg=>{
   assert.equal(publishedEntrypoints(pkg)["./private"],join(pkg,"lib/alternate.d.ts"));
  });
 }
});
test("more-specific pattern controls win over null and broad targets",()=>{
 fixture({"./public/*":"./lib/public/*.d.ts","./*":null},pkg=>{
  assert.deepEqual(Object.keys(publishedEntrypoints(pkg)),["./public/extra","./public/internal"]);
 });
 fixture({"./public/*":null,"./*":broad},pkg=>{
  assert.deepEqual(Object.keys(publishedEntrypoints(pkg)),["./alternate","./internal/secret","./private","./public"]);
 });
});
test("conditional wildcard entrypoints inherit exclusions",()=>{
 fixture({"./*":{import:"./lib/*.d.ts",require:"./lib/*.d.ts"},"./private":null},pkg=>{
  const entries=publishedEntrypoints(pkg);
  assert.ok(!Object.keys(entries).some(key=>key.startsWith("./private")));
  assert.ok(entries["./public#import"]);assert.ok(entries["./public#require"]);
 });
});
test("property: shuffled export keys agree with stock tsc on every candidate subpath", async ()=>{
 await checkProperty(fc, {
  name: "api-identity-null-export-precedence",
  rule: "Will: compare names per published entry point. Exact and most-specific exports keys, including null exclusions, determine publication; use stock tsc as the oracle.",
  command: "node --test scripts/api-identity-exports.test.mjs",
  arbitrary: fc.record({ exact: fc.boolean(), internal: fc.boolean(), reverse: fc.boolean() }),
  numRuns: 24,
  check: ({exact,internal,reverse})=>{
  let pairs=[["./*",broad],["./public/*","./lib/public/*.d.ts"]];
  if(exact)pairs.push(["./private",null]);
  if(internal)pairs.push(["./*/internal",null],["./internal/*",null]);
  if(reverse)pairs.reverse();
  fixture(Object.fromEntries(pairs),(pkg,root)=>{
   const entries=publishedEntrypoints(pkg);
   for(const name of ["public","private","internal/secret","public/internal","public/extra","alternate"]){
    const resolved=ts.resolveModuleName("fixture/"+name,join(root,"consumer.ts"),{
     module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler
    },ts.sys).resolvedModule;
    assert.equal(entries["./"+name],resolved?.resolvedFileName,JSON.stringify({name,pairs,entries,resolved}));
   }
  });
  }
 });
});

test("Alchemy internal export exclusions stay private",()=>{
 const corpus=JSON.parse(readFileSync(new URL("./api-identity-corpus/alchemy-null-internal-exports.json",import.meta.url),"utf8"));
 fixture(corpus.exports,pkg=>assert.deepEqual(Object.keys(publishedEntrypoints(pkg)),corpus.published),corpus.files);
});
