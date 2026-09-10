import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {getNativeCompiler} from "vibelang/compiler";

const source='import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};'+
  'export const Flow=durable((n:number)=>{const a=Work.run(n+1)!;const b=Work.run(2)!;return {z:a*2,a:b}});';
const provider={actionId:"main.vibe#Work",implementationId:"work/v1",implementationDigest:"a".repeat(64),tier:"sealed",
  effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]};
const cli=join(process.cwd(),"bin/vibe.js");
function fixture(run) {
  const directory=realpathSync(mkdtempSync(join(tmpdir(),"vibelang-keyed-cli-")));
  const files={source:join(directory,"main.vibe"),input:join(directory,"input.json"),providers:join(directory,"providers.json"),out:join(directory,"flow.plan.json")};
  writeFileSync(files.source,source);writeFileSync(files.input,"41");writeFileSync(files.providers,JSON.stringify([provider]));
  const invokeRaw=(args,options={})=>spawnSync(process.execPath,[cli,"plan",...args,"--format","json"],
    {cwd:directory,encoding:"utf8",timeout:15_000,...options});
  const invoke=(extra=[],options={})=>invokeRaw([files.source,"--input",files.input,
    "--providers",files.providers,"--planId","cli/plan",...extra],options);
  try{return run({directory,files,invoke,invokeRaw})}finally{rmSync(directory,{recursive:true,force:true})}
}
const report=result=>{assert.equal(result.error,undefined);assert.equal(result.signal,null);return JSON.parse(result.stdout)};

test("default plan command publishes the complete Go-derived keyed graph, not a Manifest",()=>fixture(({files,invoke})=>{
  const result=invoke(["--outFile",files.out]);assert.equal(result.status,0,result.stderr||result.stdout);
  const value=report(result);assert.equal(value.profile,"keyed");assert.equal(value.ok,true);
  assert.equal("manifest" in value,false);assert.equal(value.plan.planId,"cli/plan");assert.equal(value.digest,value.plan.digest);
  assert.deepEqual(value.plan.nodes.map(node=>node.dependsOn),[[],[],["action/0","action/1"]]);
  assert.equal(value.plan.nodes[0].material.body.expression.kind,"compute");
  assert.equal(value.plan.nodes[0].material.body.expression.operator,"add");
  assert.equal(readFileSync(files.out,"utf8"),JSON.stringify(value.plan)+"\n");
  const verified=getNativeCompiler().keyedPlan({operation:"verify",inputJson:readFileSync(files.out,"utf8")});
  assert.equal(verified.ok,true,verified.message);assert.equal(verified.planJson+"\n",readFileSync(files.out,"utf8"));
  const repeated=invoke();assert.equal(repeated.status,0,repeated.stderr||repeated.stdout);
  assert.equal(report(repeated).digest,value.digest);
}));

test("CLI source evidence binds the complete original UTF8 source including its BOM",()=>fixture(({files,invoke})=>{
  writeFileSync(files.source,"\ufeff"+source);
  const result=invoke();assert.equal(result.status,0,result.stderr||result.stdout);
  assert.equal(report(result).plan.nodes[0].material.body.source.sourceDigest,createHash("sha256").update(readFileSync(files.source)).digest("hex"));
}));

for(const body of [
  "const value=Work.run(n)!;if(value===null)return 0;return value+1",
  "const value:number|null=Work.run(n)!;if(value===null)return value;return value+1",
])test(`CLI preserves checked nullable Action success: ${body}`,()=>fixture(({files,invoke})=>{
  writeFileSync(files.source,'import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number|null,never>>{};'+
    `export const Flow=durable((n:number)=>{${body}})`);
  const result=invoke(["--outFile",files.out]);assert.equal(result.status,0,result.stderr||result.stdout);
  const value=report(result);assert.equal(value.ok,true);
  assert.equal(value.plan.nodes.filter(node=>node.material.body.operation==="action").length,1);
  assert.ok(value.plan.nodes.some(node=>node.material.body.operation==="branch"));
  assert.equal(JSON.stringify(value.plan).includes('"kind":"checked"'),false);
  const verified=getNativeCompiler().keyedPlan({operation:"verify",inputJson:readFileSync(files.out,"utf8")});
  assert.equal(verified.ok,true,verified.message);
}));

for(const [body,type,inputJson,actions=1] of [
  ["return n>0&&Work.run(n)!","number","41"],
  ["return n>0&&Work.run(n)!","number","-1"],
  ["return n>0||Work.run(n)!","number","41"],
  ["return n>0||Work.run(n)!","number","-1"],
  ["return n??Work.run(41)!","number|null","null"],
  ["return n??Work.run(41)!","number|null","0"],
  ["if(n>0)return Work.run(n);return Work.run(2)","number","41",2],
  ["if(n>0)return Work.run(n);return Work.run(2)","number","-1",2],
  ["if(n===null)return 0;return Work.run(n)","number|null","null"],
  ["if(n===null)return 0;return Work.run(n)","number|null","2"],
  ['if(n.kind==="a")return Work.run(n.x);return Work.run(n.y)','{kind:"a";x:number}|{kind:"b";y:number}','{"kind":"a","x":2}',2],
  ['if(n.kind==="a")return Work.run(n.x);return Work.run(n.y)','{kind:"a";x:number}|{kind:"b";y:number}','{"kind":"b","y":3}',2],
])test(`CLI publishes a complete conditional graph: ${body} on ${inputJson}`,()=>fixture(({files,invoke})=>{
  writeFileSync(files.source,'import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};'+
    `export const Flow=durable((n:${type})=>{${body}})`);
  writeFileSync(files.input,inputJson);
  const result=invoke(["--outFile",files.out]);assert.equal(result.status,0,result.stderr||result.stdout);
  const value=report(result);assert.equal(value.ok,true);assert.equal(value.profile,"keyed");
  assert.equal(value.plan.nodes.filter(node=>node.material.body.operation==="action").length,actions);
  const branch=value.plan.nodes.find(node=>node.material.body.operation==="branch");
  assert.ok(branch);
  const {condition,whenTrue,whenFalse}=branch.material.body.control;
  for(const dependency of [condition,whenTrue,whenFalse])assert.ok(branch.dependsOn.includes(dependency));
  const verified=getNativeCompiler().keyedPlan({operation:"verify",inputJson:readFileSync(files.out,"utf8")});
  assert.equal(verified.ok,true,verified.message);
}));

test("keyed CLI discovery follows checked source modules within the declared root",()=>fixture(({directory,files,invoke})=>{
  mkdirSync(join(directory,"actions"));
  writeFileSync(join(directory,"actions/work.vibe"),'import {Action} from "vibelang:flows";export class Work extends Action<(n:number)=>Result<number,never>>{}');
  writeFileSync(files.source,'import {durable} from "vibelang:flows";import {Work} from "./actions/work.js";export const Flow=durable((n:number)=>{return Work.run(n)!});');
  writeFileSync(files.providers,JSON.stringify([{...provider,actionId:"actions/work.vibe#Work"}]));
  const result=invoke(["--rootDir",directory]);assert.equal(result.status,0,result.stderr||result.stdout);
  const value=report(result);assert.match(value.plan.nodes[0].material.body.source.projectDigest,/^[a-f0-9]{64}$/);
  assert.equal(value.plan.nodes[0].material.body.contract.id,"actions/work.vibe#Work");
  assert.equal(value.plan.nodes[0].material.body.source.fileName,"main.vibe");
}));

test("entry selection and Flow identity options reach the same native source compiler",()=>fixture(({files,invoke})=>{
  writeFileSync(files.source,'import {durable} from "vibelang:flows";export const First=durable((n:number)=>{return n});export const Second=durable((n:number)=>{return n+1});');
  writeFileSync(files.providers,"[]");
  const result=invoke(["--exportName","Second","--flowId","cli/Second","--flowVersion","3"]);
  assert.equal(result.status,0,result.stderr||result.stdout);
  const value=report(result);assert.equal(value.plan.flow,"cli/Second");
  assert.equal(value.plan.nodes[0].material.body.source.exportName,"Second");assert.equal(value.plan.nodes[0].material.body.source.flowVersion,3);
}));

for(const [name,change] of [
  ["source type error",files=>writeFileSync(files.source,source.replace("n+1",'"wrong"'))],
  ["unsupported switch statement",files=>writeFileSync(files.source,source.replace("const a=Work.run(n+1)!;const b=Work.run(2)!;return {z:a*2,a:b}","switch(n){case 0:return Work.run(n);default:return Work.run(2)}"))],
  ["unconsumed logical Result",files=>writeFileSync(files.source,source.replace("const a=Work.run(n+1)!;const b=Work.run(2)!;return {z:a*2,a:b}","const lost=n>0&&Work.run(n);return 0"))],
  ["ordinary loop",files=>writeFileSync(files.source,source.replace("const a=Work.run(n+1)!;const b=Work.run(2)!;return {z:a*2,a:b}","let total=0;for(let i=0;i<n;i++)total++;return total"))],
  ["duplicate input keys",files=>writeFileSync(files.input,'{"n":1,"n":2}')],
  ["negative-zero input",files=>writeFileSync(files.input,"-0")],
  ["input BOM",files=>writeFileSync(files.input,"\ufeff41")],
  ["provider BOM",files=>writeFileSync(files.providers,"\ufeff"+JSON.stringify([provider]))],
  ["duplicate provider fields",files=>writeFileSync(files.providers,JSON.stringify([provider]).replace('"tier":"sealed"','"tier":"sealed","tier":"irreversible"'))],
  ["missing provider",files=>writeFileSync(files.providers,"[]")],
  ["inferred recovery tier",files=>{const value={...provider};delete value.tier;writeFileSync(files.providers,JSON.stringify([value]))}],
  ["wrong input contract",files=>writeFileSync(files.input,'"wrong"')],
] )test(`native Plan refusal preserves prior output: ${name}`,()=>fixture(({files,invoke})=>{
  writeFileSync(files.out,"prior artifact");change(files);
  const result=invoke(["--outFile",files.out]);assert.equal(result.status,1,result.stderr||result.stdout);
  const value=report(result);assert.equal(value.ok,false);assert.ok(value.diagnostics.length>0);
  assert.equal("plan" in value,false);assert.equal("manifest" in value,false);
  assert.equal(readFileSync(files.out,"utf8"),"prior artifact");
}));

for(const name of ["source","input","providers"])test(`Plan output cannot overwrite its ${name} or an alias`,()=>fixture(({directory,files,invoke})=>{
  const original=readFileSync(files[name]),hard=join(directory,"hard.json"),symbolic=join(directory,"symbolic.json");
  linkSync(files[name],hard);symlinkSync(files[name],symbolic);
  for(const output of [files[name],hard,symbolic]){
    const result=invoke(["--outFile",output]);assert.equal(result.status,2,result.stderr||result.stdout);
    assert.match(report(result).message,/cannot overwrite|symbolic link/);
    assert.deepEqual(readFileSync(files[name]),original);
  }
}));

test("Plan output cannot overwrite a discovered dependency",()=>fixture(({directory,files,invoke})=>{
  const dependency=join(directory,"work.vibe"),text='import {Action} from "vibelang:flows";export class Work extends Action<(n:number)=>Result<number,never>>{}';
  writeFileSync(dependency,text);
  writeFileSync(files.source,'import {durable} from "vibelang:flows";import {Work} from "./work";export const Flow=durable((n:number)=>{return Work.run(n)!});');
  writeFileSync(files.providers,JSON.stringify([{...provider,actionId:"work.vibe#Work"}]));
  const result=invoke(["--outFile",dependency]);assert.equal(result.status,2,result.stderr||result.stdout);
  assert.match(report(result).message,/cannot overwrite/);assert.equal(readFileSync(dependency,"utf8"),text);
}));

test("historical bindings do not silently select the withdrawn Manifest model",()=>fixture(({files,directory})=>{
  const bindings=join(directory,"bindings.json");writeFileSync(bindings,'{"actions":[]}');
  const result=spawnSync(process.execPath,[cli,"plan",files.source,"--bindings",bindings,"--format","json"],{encoding:"utf8",timeout:15_000});
  assert.equal(result.status,2,result.stderr||result.stdout);assert.match(report(result).message,/manifest-compat/);
}));

test("a source refusal does not create an output directory",()=>fixture(({directory,files,invoke})=>{
  writeFileSync(files.source,"export const x=1");const output=join(directory,"not-created/plan.json");
  const result=invoke(["--outFile",output]);assert.equal(result.status,1,result.stderr||result.stdout);
  assert.equal(existsSync(join(directory,"not-created")),false);
}));

for(const omitted of ["--input","--providers","--planId"])test(`keyed CLI requires explicit ${omitted}`,()=>fixture(({files,invokeRaw})=>{
  const options=[["--input",files.input],["--providers",files.providers],["--planId","cli/plan"]].filter(([flag])=>flag!==omitted).flat();
  const result=invokeRaw([files.source,...options]);assert.equal(result.status,2,result.stderr||result.stdout);
  assert.match(report(result).message,/requires --input .*--providers .*--planId/);
}));

test("mixing keyed arguments with explicit compatibility inspection refuses",()=>fixture(({files,invoke})=>{
  const result=invoke(["--profile","manifest-compat","--bindings",files.providers]);
  assert.equal(result.status,2,result.stderr||result.stdout);assert.match(report(result).message,/not keyed Plan options/);
}));

for(const version of ["0","-1","1.5","9007199254740992","NaN"])test(`CLI schema rejects invalid Flow version ${version}`,()=>fixture(({files,invoke})=>{
  writeFileSync(files.out,"prior artifact");
  const result=invoke(["--flowVersion",version,"--outFile",files.out]);assert.equal(result.status,1,result.stderr||result.stdout);
  const value=report(result);assert.equal(value.code,"VALIDATION_ERROR");
  assert.ok(value.fieldErrors.some(error=>error.path==="flowVersion"));
  assert.equal(readFileSync(files.out,"utf8"),"prior artifact");
}));

for(const [name,change,expected] of [
  ["non-UTF8 source",({files})=>writeFileSync(files.source,Buffer.from([0xff])),/not valid UTF-8/],
  ["non-UTF8 input",({files})=>writeFileSync(files.input,Buffer.from([0xc3,0x28])),/not valid UTF-8/],
  ["non-UTF8 providers",({files})=>writeFileSync(files.providers,Buffer.from([0xff])),/not valid UTF-8/],
  ["source byte bound",({files})=>writeFileSync(files.source," ".repeat(2*1024*1024+1)),/exceeds 2097152 bytes/],
  ["input byte bound",({files})=>writeFileSync(files.input," ".repeat(16*1024*1024+1)),/exceeds 16777216 bytes/],
  ["provider byte bound",({files})=>writeFileSync(files.providers," ".repeat(16*1024*1024+1)),/exceeds 16777216 bytes/],
  ["directory input",({files,directory})=>{files.input=directory},/must be a regular file/],
  ["directory providers",({files,directory})=>{files.providers=directory},/must be a regular file/],
  ["directory output",({files,directory})=>{files.out=directory},/output must be a regular file/],
  ["dangling output symlink",({files,directory})=>{files.out=join(directory,"dangling.json");symlinkSync(join(directory,"absent.json"),files.out)},/cannot be a symbolic link/],
  ["disguised TypeScript input",({files,directory})=>{const target=join(directory,"hidden.ts");writeFileSync(target,source);files.source=join(directory,"hidden.vibe");symlinkSync(target,files.source)},/canonical \.vibe input/],
] )test(`CLI file validation refuses ${name} without replacing prior output`,()=>fixture(context=>{
  const prior=context.files.out;writeFileSync(prior,"prior artifact");change(context);
  const result=context.invoke(["--outFile",context.files.out]);assert.equal(result.status,2,result.stderr||result.stdout);
  assert.match(report(result).message,expected);assert.equal(readFileSync(prior,"utf8"),"prior artifact");
}));

test("the default project root cannot discover a parent-directory source",()=>fixture(({files,directory,invoke})=>{
  mkdirSync(join(directory,"nested"));writeFileSync(join(directory,"work.vibe"),'import {Action} from "vibelang:flows";export class Work extends Action<(n:number)=>Result<number,never>>{}');
  files.source=join(directory,"nested/main.vibe");
  writeFileSync(files.source,'import {durable} from "vibelang:flows";import {Work} from "../work";export const Flow=durable((n:number)=>{return Work.run(n)!});');
  const result=invoke();assert.equal(result.status,2,result.stderr||result.stdout);assert.match(report(result).message,/outside --rootDir/);
  writeFileSync(files.providers,JSON.stringify([{...provider,actionId:"work.vibe#Work"}]));
  const widened=invoke(["--rootDir",directory]);assert.equal(widened.status,0,widened.stderr||widened.stdout);
  assert.equal(report(widened).plan.nodes[0].material.body.source.fileName,"nested/main.vibe");
}));

test("ambiguous module resolution does not silently select a source graph",()=>fixture(({files,directory,invoke})=>{
  writeFileSync(join(directory,"work.vibe"),'export const value=1');writeFileSync(join(directory,"work.js"),'export const value=2');
  writeFileSync(files.source,'import {durable} from "vibelang:flows";import {value} from "./work.js";export const Flow=durable((n:number)=>{return n+value});');
  const result=invoke();assert.equal(result.status,2,result.stderr||result.stdout);assert.match(report(result).message,/is ambiguous/);
}));

test("multiple exports require an explicit checked Flow selection",()=>fixture(({files,invoke})=>{
  writeFileSync(files.source,'import {durable} from "vibelang:flows";export const First=durable((n:number)=>{return n});export const Second=durable((n:number)=>{return n+1});');
  writeFileSync(files.providers,"[]");
  for(const options of [[],["--exportName","Missing"]]){
    const result=invoke(options);assert.equal(result.status,1,result.stderr||result.stdout);
    assert.equal(report(result).ok,false);assert.ok(report(result).diagnostics.length>0);
  }
}));
