import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {assessInvocation,extractProjects,projectInvocation} from "../scripts/docs-snippets-gate.mjs";

function probe({status=0,report,stdout,metadata="",files={}},check) {
  const directory=mkdtempSync(join(tmpdir(),"vibelang-doc-gate-probe-"));
  try {
    for(const path of ["scripts","bin","docs/src/pages"])mkdirSync(join(directory,path),{recursive:true});
    copyFileSync("scripts/docs-snippets-gate.mjs",join(directory,"scripts/docs-snippets-gate.mjs"));
    symlinkSync(join(process.cwd(),"poc"),join(directory,"poc"),"dir");
    const source='# Fixture\n\n```ts [main.vibe] '+metadata+'\nexport const value=1;\n```\n'+
      Object.entries(files).map(([name,text])=>'\n```json ['+name+']\n'+text+'\n```\n').join("");
    writeFileSync(join(directory,"docs/src/pages/index.mdx"),source);
    // The fixture controls only the compiler response, never the gate verdict.
    writeFileSync(join(directory,"bin/vibe.js"),
      'require("node:fs").writeFileSync('+JSON.stringify(join(directory,"args.json"))+',JSON.stringify(process.argv.slice(2)));'+
      'process.stdout.write('+JSON.stringify(stdout??JSON.stringify(report))+');process.exitCode='+status+';');
    const result=spawnSync(process.execPath,[join(directory,"scripts/docs-snippets-gate.mjs"),"--verbose"],{encoding:"utf8",timeout:15_000});
    assert.equal(result.error,undefined);assert.equal(result.signal,null);
    check(result,()=>JSON.parse(readFileSync(join(directory,"args.json"),"utf8")));
  } finally {rmSync(directory,{recursive:true,force:true});}
}

for(const [name,configuration] of [
  ["JSON backend error",{status:2,report:{ok:false,code:"VIBELANG_BACKEND_ERROR",message:"compiler failed"}}],
  ["empty JSON response",{report:{}}],
  ["missing file reports",{report:{ok:true,files:[]}}],
  ["malformed JSON",{stdout:"not JSON"}],
  ["a failed process claiming success",{status:1,report:{ok:true,files:[{input:"main.vibe",diagnostics:[]}]}}],
])test(`documentation gate refuses ${name}`,()=>probe(configuration,result=>{
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.doesNotMatch(result.stdout,/docs-snippets-gate: ok/);
}));

test("a keyed documentation refusal goes through plan, never check",()=>probe({status:1,metadata:"plan=docs/refusal expect=refuse",
  files:{"input.json":"1","providers.json":"[]"},report:{ok:false,profile:"keyed",file:"main.vibe",diagnostics:[{code:"VIBE4199",message:"unsupported graph",category:"error"}]}},(result,args)=>{
  assert.equal(result.status,0,result.stderr);assert.equal(args()[0],"plan");
  assert.ok(args().includes("--planId"));assert.ok(args().includes("docs/refusal"));
}));

test("keyed documentation cannot earn success from a Manifest report",()=>probe({metadata:"plan=docs/manifest",
  files:{"input.json":"1","providers.json":"[]"},report:{ok:true,profile:"manifest-compat",manifest:{digest:"forged"}}},result=>{
  assert.notEqual(result.status,0,result.stdout+result.stderr);
}));

const document=(metadata="",name="main.vibe")=>'# Sample\n\n```ts ['+name+'] '+metadata+'\nexport const value=1\n```\n';
const data='\n```json [input.json]\n1\n```\n\n```json [providers.json]\n[]\n```\n';
const project=metadata=>extractProjects(document(metadata)+data,"example.mdx")[0];

test("keyed examples select only the real default plan route with explicit data",()=>{
  const value=project("plan=docs/p"),invocation=projectInvocation(value);
  assert.equal(invocation.mode,"keyed");assert.deepEqual(invocation.files,["main.vibe"]);
  assert.deepEqual(invocation.args,["plan","main.vibe","--input","input.json","--providers","providers.json","--planId","docs/p","--format","json"]);
  assert.equal(invocation.args.includes("manifest-compat"),false);
});

test("historical body examples are counted separately without inventing a CLI option",()=>{
  const invocation=projectInvocation(project("legacy-body"));
  assert.equal(invocation.mode,"legacy-body");assert.deepEqual(invocation.args,["check","main.vibe","--format","json"]);
});

for(const metadata of ["plan=","plane=docs/p","expect=success","plan=a plan=b","plan=a plan=a","legacy-body legacy-body","plan=a legacy-body"])
test(`documentation metadata fails closed: ${metadata}`,()=>assert.throws(()=>project(metadata)));

for(const name of ["../outside.vibe","/outside.vibe","C:/outside.vibe","nested/../outside.vibe","node_modules/vibelang/owned.vibe","nested\\outside.vibe"])
test(`documentation file paths cannot escape staging: ${name}`,()=>assert.throws(()=>extractProjects(document("",name),"example.mdx")));

test("keyed examples cannot ignore missing data or a declared TypeScript config",()=>{
  assert.throws(()=>extractProjects(document("plan=a"),"example.mdx"));
  assert.throws(()=>extractProjects(document("plan=a")+data+'\n```json [tsconfig.json]\n{}\n```',"example.mdx"));
});

test("duplicate file names, unterminated fences and malformed titles refuse",()=>{
  assert.throws(()=>extractProjects(document()+document().replace("# Sample\n", ""),"example.mdx"));
  assert.throws(()=>extractProjects('```ts [main.vibe]\nsource',"example.mdx"));
  assert.throws(()=>extractProjects('```ts [main.vibe\nsource\n```',"example.mdx"));
});

test("file-looking text inside a longer fragment fence is not a documented program",()=>{
  assert.deepEqual(extractProjects('````md\n'+document()+data+'\n````',"example.mdx"),[]);
  assert.deepEqual(extractProjects('~~~md\n'+document()+data+'\n~~~',"example.mdx"),[]);
});

const success=report=>({status:0,signal:null,stdout:JSON.stringify(report),stderr:""});
test("compiler errors, termination and contradictory success are never an empty successful check",()=>{
  const p=project(),invocation=projectInvocation(p),report={ok:true,files:[{input:"main.vibe",diagnostics:[]}]};
  assert.deepEqual(assessInvocation(p,invocation,success(report)),[]);
  for(const result of [{...success(report),signal:"SIGKILL"},{...success(report),error:new Error("spawn failed")},
    {...success(report),status:1},success({...report,ok:false}),success({...report,files:[...report.files,...report.files]}),
    success({...report,files:[{input:"other.vibe",diagnostics:[]}]})]) {
    assert.ok(assessInvocation(p,invocation,result).length>0);
  }
});

test("a successful Plan must pass the independent native verifier with the same bytes",()=>{
  const p=project("plan=docs/p"),invocation=projectInvocation(p),plan={planId:"docs/p",digest:"declared",nodes:[]};
  const result=success({ok:true,profile:"keyed",file:"main.vibe",planId:plan.planId,digest:plan.digest,plan});
  let seen;
  assert.deepEqual(assessInvocation(p,invocation,result,bytes=>{seen=bytes;return {ok:true,planJson:bytes}}),[]);
  assert.equal(seen,JSON.stringify(plan));
  for(const verifier of [undefined,()=>({ok:false}),()=>({ok:true,planJson:"different"}),()=>{throw new Error("native crash")}]) {
    assert.ok(assessInvocation(p,invocation,result,verifier).length>0);
  }
  assert.ok(assessInvocation(p,invocation,success({...JSON.parse(result.stdout),
    diagnostics:[{code:"VIBE4199",message:"cannot compile"}]}),()=>{throw new Error("must refuse before verification")}).length>0);
});

test("a graph-shaped JSON response does not bypass real native verification",()=>probe({metadata:"plan=docs/p",
  files:{"input.json":"1","providers.json":"[]"},report:{ok:true,profile:"keyed",file:"main.vibe",planId:"docs/p",digest:"forged",
    plan:{planId:"docs/p",digest:"forged",nodes:[]}}},result=>{
  assert.notEqual(result.status,0,result.stdout+result.stderr);assert.match(result.stderr,/native Plan verification refused/);
}));

test("expected Plan refusal cannot hide an emitted artifact, warning or command error",()=>{
  const p=project("plan=docs/p expect=refuse"),invocation=projectInvocation(p);
  const report={ok:false,profile:"keyed",file:"main.vibe",diagnostics:[{code:"VIBE4199",message:"unsupported",category:"error"}]};
  const result={...success(report),status:1};
  assert.deepEqual(assessInvocation(p,invocation,result),[]);
  for(const changed of [{...report,plan:{}},{...report,artifact:"partial.json"},{...report,diagnostics:[]},{...report,diagnostics:[{...report.diagnostics[0],category:"warning"}]},
    {...report,file:"other.vibe"},{...report,profile:"manifest-compat"}])assert.ok(assessInvocation(p,invocation,{...result,stdout:JSON.stringify(changed)}).length>0);
  assert.ok(assessInvocation(p,invocation,{...result,status:2}).length>0);
});
