import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import fc from "fast-check";
import { projectCache } from "../cache.mjs";
import { checkProperty } from "../../../scripts/testing/property.mjs";
import { SpecPath } from "../../../scripts/testing/spec-path.mjs";

const key = "register-cache:hidden-added-native-source";
const extensionRule = "`.vibe` and `.vibex` are supported source extensions:";
const configRule = "Fields retain their TypeScript meaning with one deliberate file-kind exception:";
const cacheRule = "A file added to or removed from a directory the tsconfig's `include` scans";
test("hidden source cache quotes configuration and included-file contracts", () => {
 assert.ok(readFileSync(SpecPath("007-tooling.md"),"utf8").includes(configRule));
 assert.ok(readFileSync(SpecPath("007-tooling.md"),"utf8").includes(extensionRule));
 assert.ok(readFileSync(new URL("../README.md",import.meta.url),"utf8").includes(cacheRule));
});

async function check(input) {
 const root = realpathSync(mkdtempSync(join(tmpdir(),"vibelang-hidden-cache-")));
 try {
  const app=join(root,"app"),directory=input.hiddenDirectory?".collector":"src",src=join(app,directory);
  mkdirSync(src,{recursive:true});
  const anchor=join(src,"anchor.vibe");
  const name=(input.hiddenFile?".source-collector-":"source-collector-")+input.suffix+input.extension;
  const added=join(src,name),project=join(app,"tsconfig.json");
  writeFileSync(anchor,"export const marker = 42;\n");
  if(input.selection==="files")writeFileSync(added,"export const marker = 43;\n");
  const config=input.selection==="glob"
   ? {include:[directory+"/*.vibe",directory+"/*.vibex",directory+"/.source-collector-*"+input.extension]}
   : {files:[directory+"/anchor.vibe",directory+"/"+name]};
  writeFileSync(project,JSON.stringify(config));
  await sleep(250);
  const trace=[];
  const cache=projectCache({project,root:app,compiler:process.execPath,cache:join(root,"cache"),debug:line=>trace.push(line)});
  const inputs=input.selection==="files"?[anchor,added]:[anchor];
  cache.store(cache.begin(),{outputs:new Map(),errors:[],warnings:[],inputs},inputs);
  assert.ok(cache.lookup().result,"establish a warm entry before adding source: "+trace.join("\n"));
  assert.ok(cache.lookup().result,"a second unchanged lookup must hit");
  writeFileSync(added,"export const marker = 44;\n");
  await sleep(250);
  const lookup=cache.lookup();
  const pending = input.selection !== "glob" ? undefined
   : input.extension === ".vibex"
    ? {key:input.hiddenFile ? "cache.mjs:hidden-vibex-input-invalidation" : "cache.mjs:vibex-input-invalidation",
       owner:input.hiddenFile ? "migfix-foldkit + vibex-bundlers" : "vibex-bundlers"}
    : undefined;
  const requireMiss=()=>assert.ok(lookup.miss,key+": an explicitly included native source changed; a stale warm result is invalid");
  if(pending && process.env.HIDDEN_CACHE_RAW!=="1") {
   // These remaining .vibex gaps have actual cache-level raw proofs. They must fail
   // only the desired invalidation assertion; fixed implementations XPASS.
   assert.ok(lookup.result,"the known gap is a stale warm result, not an unrelated cache failure");
   assert.throws(requireMiss,error=>error.code==="ERR_ASSERTION" && error.message.startsWith(key),
    "XPASS "+pending.key+": remove this exact native-addition allowance (owner "+pending.owner+")");
  } else requireMiss();
 } finally {rmSync(root,{recursive:true,force:true});}
}

test("fixed .vibe additions invalidate every visible and hidden selection layout",async()=>{
 for(const hiddenFile of [false,true]) for(const hiddenDirectory of [false,true]) for(const selection of ["glob","files"])
  await check({hiddenFile,hiddenDirectory,selection,suffix:73,extension:".vibe"});
});

test("property: Foldkit included hidden native additions invalidate real warm cache entries",async()=>{
 await checkProperty(fc,{name:"HiddenNativeCacheAddition",
  rule:configRule+" "+cacheRule,
  command:"node --test packages/compiler/test/cache-hidden-addition.property.test.mjs",
  regressions:new URL("./property-regressions/",import.meta.url),numRuns:32,
  arbitrary:fc.record({hiddenFile:fc.boolean(),hiddenDirectory:fc.boolean(),selection:fc.constantFrom("glob","files"),
   suffix:fc.integer({min:0,max:1000}),extension:fc.constantFrom(".vibe",".vibex")}),check});
});
