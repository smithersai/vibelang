import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import fc from "fast-check";
import { checkProperty } from "../../../scripts/testing/property.mjs";
import { SpecPath } from "../../../scripts/testing/spec-path.mjs";
import { ageDirectories, cacheProject, skip } from "./cache-harness.mjs";

const key = "register-cache:hidden-added-native-source";
const extensionRule = "`.vibe` and `.vibex` are supported source extensions:";
const configRule = "Fields retain their TypeScript meaning with one deliberate file-kind exception:";
const cacheRule = "A file added to or removed from a directory the tsconfig's `include` scans";
test("hidden source cache quotes configuration and included-file contracts", () => {
 assert.ok(readFileSync(SpecPath("007-tooling.md"),"utf8").includes(configRule));
 assert.ok(readFileSync(SpecPath("007-tooling.md"),"utf8").includes(extensionRule));
 assert.ok(readFileSync(new URL("../README.md",import.meta.url),"utf8").includes(cacheRule));
});

// A .vibex source needs a JSX namespace to check.
const jsx = "declare namespace JSX { interface IntrinsicElements { [name: string]: unknown } }\n";

// A real compile through the native compiler, then a new or edited source the
// project includes: the compiler lists it, so the next compile must not be
// served from the cache.
async function check(input) {
 const cleanups=[];
 try {
  const directory=input.hiddenDirectory?".collector":"src";
  const name=(input.hiddenFile?".source-collector-":"source-collector-")+input.suffix+input.extension;
  const added=directory+"/"+name;
  const config=input.selection==="glob"
   ? {include:[directory+"/*.vibe",directory+"/*.vibex",directory+"/.source-collector-*"+input.extension,"jsx.d.ts"]}
   : {files:[directory+"/anchor.vibe",added,"jsx.d.ts"]};
  const files={[directory+"/anchor.vibe"]:"export const marker = 42;\n","jsx.d.ts":jsx};
  if(input.selection==="files")files[added]="export const marker = 43;\n";
  const project=cacheProject({after:fn=>cleanups.push(fn)},files,{...config,compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],skipLibCheck:true,noEmit:true,jsx:"preserve"}});
  ageDirectories(project.app);
  await project.settle();
  const cold=project.compile();
  assert.deepEqual(cold.result.errors,[],"the fixture compiles");
  assert.ok(project.entry.lookup().result,"establish a warm entry before adding source: "+cold.messages.join("\n"));
  assert.equal(project.compile().compiled,false,"a second unchanged compile must hit");
  project.write(added,"export const marker = 44;\n");
  assert.ok(project.listed().has(join(project.app,added)),"the compiler reads "+added);
  const warm=project.compile();
  assert.ok(warm.compiled,key+": an explicitly included native source changed; a stale warm result is invalid");
  assert.deepEqual(warm.result.errors,[]);
  assert.ok([...warm.result.outputs.keys()].includes(join(project.app,added)),"the recompile emits the added source");
 } finally {for(const cleanup of cleanups)cleanup();}
}

test("fixed .vibe additions invalidate every visible and hidden selection layout",{skip},async()=>{
 for(const hiddenFile of [false,true]) for(const hiddenDirectory of [false,true]) for(const selection of ["glob","files"])
  await check({hiddenFile,hiddenDirectory,selection,suffix:73,extension:".vibe"});
});

test("property: Foldkit included hidden native additions invalidate real warm cache entries",{skip},async()=>{
 await checkProperty(fc,{name:"HiddenNativeCacheAddition",
  rule:configRule+" "+cacheRule,
  command:"node --test packages/compiler/test/cache-hidden-addition.property.test.mjs",
  regressions:new URL("./property-regressions/",import.meta.url),numRuns:16,
  arbitrary:fc.record({hiddenFile:fc.boolean(),hiddenDirectory:fc.boolean(),selection:fc.constantFrom("glob","files"),
   suffix:fc.integer({min:0,max:1000}),extension:fc.constantFrom(".vibe",".vibex")}),check});
});
