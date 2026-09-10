// Explicit, isolated integration with the reviewed upstream runtime. This is
// not a bundled runtime, a replacement scheduler or part of the default gate.
// Node >=22.19 is needed for registerHooks and upstream type stripping.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname, tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args=process.argv.slice(2), option=name=>{
  const index=args.indexOf(name);
  if(index<0||!args[index+1]||args[index+1].startsWith("--"))throw new Error(`required ${name}`);
  return args[index+1];
};
const reference=resolve(option("--reference")),dependencies=resolve(option("--dependencies"));
assert.equal(execFileSync("git",["-C",reference,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),"6bcbaa2d03a10afe8fe59934dabe262f55f012e7");
assert.equal(JSON.parse(readFileSync(join(dependencies,"node_modules/effect/package.json"),"utf8")).version,"4.0.0-rc.112");
const script=fileURLToPath(import.meta.url),root=fileURLToPath(new URL("../",import.meta.url));
const phase=args.includes("--phase")?option("--phase"):"parent";

if(phase==="parent") {
  const directory=mkdtempSync(join(tmpdir(),"vibelang-keyed-worker-oracle.")),reports=[];
  for(const mode of ["parallel","crash","compute-parallel","compute-crash"]) {
    const crash=mode.endsWith("crash");
    const state=join(directory,mode);mkdirSync(state);
    const invoke=phase=>{
      const child=spawnSync(process.execPath,[script,"--reference",reference,"--dependencies",dependencies,"--phase",phase,"--state",state,"--mode",mode],
        {encoding:"utf8",timeout:60000,maxBuffer:16*1024*1024,env:process.env});
      writeFileSync(join(state,phase+".stdout"),child.stdout??"",{flag:"wx"});
      writeFileSync(join(state,phase+".stderr"),child.stderr??"",{flag:"wx"});
      if(child.error)throw child.error;
      return child;
    };
    const first=invoke("run");
    if(crash) {
      assert.equal(first.signal,"SIGKILL",first.stderr);
      const commit=JSON.parse(readFileSync(join(state,"killed-after-commit.json"),"utf8"));
      assert.equal(commit.eventType,"flows.engine.node-settled");
      assert.equal(commit.payload.nodeId,"action/0");assert.equal(commit.payload.outcome,"built");
    } else assert.equal(first.status,0,first.stderr);
    const resumed=invoke("resume");assert.equal(resumed.status,0,resumed.stderr);
    const replayed=invoke("resume-again");assert.equal(replayed.status,0,replayed.stderr);
    const calls=readFileSync(join(state,"calls.ndjson"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
    assert.deepEqual(calls.map(call=>call.id).sort(),["action/0","action/1","result"]);
    assert.equal(calls.filter(call=>call.id==="action/0")[0].phase,"run");
    if(crash)assert.equal(calls.find(call=>call.id==="action/1").phase,"resume");
    reports.push({mode,state,calls,first:crash?"SIGKILL after committed node":JSON.parse(first.stdout),
      resumed:JSON.parse(resumed.stdout),replayed:JSON.parse(replayed.stdout)});
  }
  console.log(JSON.stringify({scope:"product authenticated worker + real SQL Control, scheduler, journal and fresh-process recovery; external reference composition",directory,reports},null,2));
} else {
  const state=resolve(option("--state")),mode=option("--mode"),fresh=phase==="run";
  assert.ok(["run","resume","resume-again"].includes(phase));assert.ok(["parallel","crash","compute-parallel","compute-crash"].includes(mode));
  const parallel=mode.endsWith("parallel"),compute=mode.startsWith("compute-");
  const packages=new Map();
  for(const file of execFileSync("rg",["--files",join(reference,"packages"),"-g","package.json"],{encoding:"utf8"}).trim().split("\n")) {
    const metadata=JSON.parse(readFileSync(file,"utf8"));if(!metadata.name?.startsWith("@smthrs/"))continue;
    assert.equal(packages.has(metadata.name),false);packages.set(metadata.name,pathToFileURL(file).href);
  }
  const dependencyParent=pathToFileURL(join(dependencies,"package.json")).href;
  registerHooks({resolve(specifier,context,next){
    if(specifier.startsWith("@smthrs/")) {
      const parentURL=packages.get(specifier.split("/").slice(0,2).join("/"));assert.ok(parentURL,specifier);
      return next(specifier,{...context,parentURL});
    }
    if(!specifier.startsWith(".")&&!specifier.startsWith("/")&&!specifier.includes(":"))return next(specifier,{...context,parentURL:dependencyParent});
    return next(specifier,context);
  }});
  const [Effect,Layer,Latch,Stream,Duration,Ownership,NodeCrypto,NodeFileSystem,PlanScheduler,StepBoundary,StepSandbox,TestStores,RunStore,NodeJj,Workspace,
    ArtifactStore,Journal,Control,ControlRuntime,ControlLive,SqlControlRuntime,NotificationQueue,Registry,Product]=await Promise.all([
    "effect/Effect","effect/Layer","effect/Latch","effect/Stream","effect/Duration","@smthrs/run-store/Ownership","@effect/platform-node/NodeCrypto","@effect/platform-node/NodeFileSystem",
    "@smthrs/engine-store/PlanScheduler","@smthrs/engine-store/StepBoundary","@smthrs/engine-store/StepSandbox","@smthrs/engine-store/test/TestStores",
    "@smthrs/run-store/RunStore","@smthrs/jj/node/NodeJj","@smthrs/kernel/Workspace","@smthrs/artifacts/ArtifactStore","@smthrs/journal/Journal",
    "@smthrs/control/Control","@smthrs/control/ControlRuntime","@smthrs/control/ControlLive","@smthrs/control/SqlControlRuntime",
    "@smthrs/notifications/NotificationQueue","@smthrs/registry/Registry",pathToFileURL(join(root,"dist/durable.js")).href,
  ].map(name=>import(name)));
  const wire=value=>JSON.parse(JSON.stringify(value)),workspace=join(state,"workspace");
  const observer={hostId:hostname(),pid:process.pid,nonce:randomUUID()};
  if(fresh){mkdirSync(workspace);execFileSync("jj",["git","init",workspace],{stdio:"pipe"});}
  const runtime=Product.createKeyedWorkerRuntime({timeoutMs:5000});
  let persisted;
  if(fresh) {
    const source={fileName:"flow.vibe",flowId:"oracle/Flow",flowVersion:1,source:`import {Action,durable} from "vibelang:flows";
      class Work extends Action<(n:number)=>Result<number,never>>{}
      export const Flow=durable((input:{z:number;a:number})=>{const first=Work.run(${compute?"input.z+1":"input.z"})!;
      ${compute ? parallel ? "const second=Work.run(input.a*2)!;return {z:first*2,a:second-1,ok:first>second}" :
      "const second=Work.run(first*2)!;return second-1" : parallel ? "const second=Work.run(input.a)!;return {z:first,a:second}" : "return Work.run(first)"}});`};
    const action=Product.compileActionContract('import {Action} from "vibelang:flows";export class Work extends Action<(n:number)=>Result<number,never>>{}',
      {fileName:"flow.vibe",exportName:"Work",id:"flow.vibe#Work",version:1});assert.equal(action.ok,true,JSON.stringify(action));
    const contract=Product.compileActionImplementationSourceContract({action:action.descriptor,implementationId:"work/v1",implementationVersion:"1",
      entryFile:"provider.vibe",exportName:"work",sources:[{fileName:"provider.vibe",source:"export function work(n:number):number{return n+1}"}]});
    const bundle=Product.buildWorkerPoolBundle({poolId:"work",target:"typescript-deno",sandbox:"deno-subprocess/no-permissions",valueCodec:"vibelang/keyed-source/v2",
      selections:[{action:action.descriptor,contract}]});
    const deployment=Product.buildKeyedSourceDeployment({source,runtime,bundles:[bundle],providers:[{actionId:action.descriptor.id,tier:"sealed",
      effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}]});
    const keys=Product.SignedDeployment.generateKeyPair();
    persisted={signed:Buffer.from(Product.encodeSignedKeyedSourceDeployment(deployment,keys)).toString("utf8"),trust:[Product.SignedDeployment.verificationKey(keys)],inputJson:'{"z":41,"a":2}'};
  } else persisted=JSON.parse(readFileSync(join(state,"invocation.json"),"utf8"));
  const authenticated=Product.authenticateKeyedSourceDeployment(persisted.signed,persisted.trust,runtime),invocations=new Map();
  const approval={envelope:{capabilities:[],flows:[],budget:{}},deployClass:false};
  const flow={flowId:authenticated.deployment.source.flowId,description:"Actual checked language worker",...approval,executionDigest:authenticated.deployment.executionDigest,
    decode:input=>Effect.sync(()=>Product.decodeKeyedValue(input)),
    plan:(input,planId)=>Effect.sync(()=>{const value=Product.compileAuthenticatedKeyedInvocation(authenticated,{planId,inputJson:JSON.stringify(input)});
      invocations.set(planId,value);return {plan:JSON.parse(value.planJson)};})};
  const artifacts=ArtifactStore.layerFileSystem({directory:join(state,"objects")}).pipe(Layer.provide(NodeFileSystem.layer));
  const host=Layer.mergeAll(NodeFileSystem.layer,artifacts,Workspace.layer(workspace));
  const boundaries=Layer.mergeAll(StepBoundary.layer,StepSandbox.layer).pipe(Layer.provide(host));
  const control=ControlLive.layer.pipe(Layer.provideMerge(Layer.mergeAll(SqlControlRuntime.layer({flows:[flow],owner:observer}),NotificationQueue.layer,Registry.layerNoop())));
  const services=Layer.mergeAll(control,boundaries,NodeJj.layerAt(workspace),host).pipe(
    Layer.provideMerge(TestStores.layerAt(join(state,"runtime.sqlite"))),Layer.provideMerge(NodeCrypto.layer));
  let calls=0,active=0,maximum=0;
  const reject=effect=>effect.pipe(Effect.match({onFailure:error=>error._tag,onSuccess:()=>"unexpected success"}));
  const program=Effect.gen(function*(){
    const api=yield* Control.Control,store=yield* ControlRuntime.ControlRuntime,runs=yield* RunStore.RunStore,journal=yield* Journal.Journal;
    const card=fresh?yield* api.plan({flowId:flow.flowId,input:Product.encodeKeyedValue(JSON.parse(persisted.inputJson))}):(yield* store.getPlan(persisted.planId)).card;
    const stored=yield* store.getPlan(card.planId);
    const invocation=fresh?invocations.get(card.planId):Product.restoreAuthenticatedKeyedInvocation(authenticated,{planId:card.planId,inputJson:JSON.stringify(stored.decodedInput),planJson:JSON.stringify(card.plan)});
    assert.deepEqual(wire(Product.keyedInvocationApprovalTarget(invocation,approval)),wire(card.approval.target));
    const altered=JSON.parse(invocation.planJson);altered.nodes[0].priority++;
    assert.throws(()=>Product.restoreAuthenticatedKeyedInvocation(authenticated,{planId:card.planId,inputJson:persisted.inputJson,planJson:JSON.stringify(altered)}));
    assert.throws(()=>Product.createAuthenticatedKeyedNodeWorker({...invocation}));
    let runId,owner;
    if(fresh) {
      assert.equal((yield* store.launch(card.planId,card.digest,card.envelope))._tag,"Parked");assert.equal(calls,0);
      assert.equal(yield* reject(api.approve({...card.approval,principal:{id:"intruder",kind:"operator",stampedAt:1}})),"/control/Unauthorized");
      assert.equal(yield* reject(api.approve({...card.approval,target:{...card.approval.target,digest:invocation.planDigest}})),"/control/PlanDigestMismatch");
      assert.equal((yield* store.grants).length,0);
      assert.equal((yield* api.approve(card.approval))._tag,"Accepted");assert.equal((yield* api.approve(card.approval))._tag,"AlreadyApplied");
      const launched=yield* store.launch(card.planId,card.digest,card.envelope);assert.equal(launched._tag,"Started");
      runId=launched.run.runId;owner=(yield* runs.get(runId)).owner;
      writeFileSync(join(state,"invocation.json"),JSON.stringify({...persisted,planId:card.planId,runId}),{flag:"wx"});
    } else {
      assert.equal(stored.decision,"approved");assert.equal((yield* store.grants).length,1);
      runId=persisted.runId;const previous=yield* runs.get(runId);assert.ok(previous.owner);
      assert.equal(previous.owner.hostId,observer.hostId);
      assert.throws(()=>process.kill(previous.owner.pid,0),error=>error.code==="ESRCH");
      const snapshot={status:previous.status,owner:previous.owner,heartbeatAtMs:previous.heartbeatAtMs};
      // A confirmed dead pid does not bypass the real lease cutoff. Wait on
      // the real clock, without altering the persisted heartbeat or policy.
      const staleAt=previous.heartbeatAtMs+Duration.toMillis(Ownership.heartbeatStaleAfter)+1;
      if(Date.now()<staleAt) {
        const now=Date.now();
        assert.equal((yield* runs.claimAndOwn(runId,snapshot,observer,now,
          {expectedOwner:previous.owner,checkedAtMs:now,kind:"same-host-pid-dead"}))._tag,"HeartbeatFresh");
        yield* Effect.sleep(Math.max(1,staleAt-Date.now()));
      }
      assert.equal((yield* runs.claimAndOwn(runId,snapshot,observer,Date.now()))._tag,"EvidenceRequired");
      assert.throws(()=>process.kill(previous.owner.pid,0),error=>error.code==="ESRCH");
      const now=Date.now(),claimed=yield* runs.claimAndOwn(runId,snapshot,observer,now,
        {expectedOwner:previous.owner,checkedAtMs:now,kind:"same-host-pid-dead"});assert.equal(claimed._tag,"Activated");owner=observer;
    }
    const worker=Product.createAuthenticatedKeyedNodeWorker(invocation),latch=yield* Latch.make();
    const executor={execute:work=>Effect.gen(function*(){
      // Test-only pre-dispatch suspension ensures the process is killed with
      // remaining work. The provider and approved graph are unchanged.
      if(fresh&&!parallel&&work.node.id==="action/1")yield* Effect.never;
      calls++;appendFileSync(join(state,"calls.ndjson"),JSON.stringify({id:work.node.id,attempt:work.attempt,phase})+"\n");
      if(work.node.id!=="result") {
        active++;maximum=Math.max(maximum,active);
        if(fresh&&parallel) {if(active===2)yield* latch.open;yield* latch.await;}
      }
      const exit=yield* Effect.tryPromise({try:signal=>worker.execute(work,{signal}),catch:error=>error});
      if(work.node.id!=="result")active--;
      switch(exit.kind){case "success":return exit.value;case "failure":return yield* Effect.fail(exit.error);
        case "defect":return yield* Effect.die(exit.defect);case "interrupted":return yield* Effect.interrupt;}
      throw new Error("unknown worker exit");
    })};
    if(fresh&&!parallel)yield* Effect.forkScoped(Stream.runForEach(journal.stream({runId}),entry=>Effect.sync(()=>{
      if(entry.eventType==="flows.engine.node-settled"&&entry.payload.nodeId==="action/0"&&entry.payload.outcome==="built"){
        writeFileSync(join(state,"killed-after-commit.json"),JSON.stringify(entry),{flag:"wx"});process.kill(process.pid,"SIGKILL");
      }
    })));
    const scheduler=PlanScheduler.make({runId,owner,sourceId:"checked-worker-oracle",environment:{declared:true,layers:[invocation.executionDigest],capabilities:{}},concurrency:{steps:2}});
    const report=yield* scheduler.run(JSON.parse(invocation.planJson)).pipe(Effect.provide(PlanScheduler.layerExecutor(executor)));
    const answer=Product.decodeKeyedValue(report.results.result);
    assert.equal(JSON.stringify(answer),compute ? parallel ? '{"z":86,"a":4,"ok":true}' : "86" : parallel ? '{"z":42,"a":3}' : "43");
    if(fresh)assert.equal(maximum,2);
    if(!fresh&&(parallel||phase==="resume-again")){assert.equal(calls,0);assert.ok(report.settlements.every(value=>value.outcome==="clean"));}
    if(!fresh&&!parallel&&phase==="resume")assert.equal(report.settlements.find(value=>value.nodeId==="action/0").outcome,"clean");
    return {phase,mode,runId,planId:invocation.planId,planDigest:invocation.planDigest,approvalDigest:card.digest,calls,maximum,answer,settlements:report.settlements};
  }).pipe(Effect.scoped,Effect.provide(services),Effect.timeout("40 seconds"));
  console.log(JSON.stringify(await Effect.runPromise(program)));
}
