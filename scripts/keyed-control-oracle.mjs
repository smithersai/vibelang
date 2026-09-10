// Explicit control-semantics comparison with the reviewed external interpreter.
// This does not vendor a runtime, compile branch source or exercise a journal.
// Node >=22.19 supplies registerHooks for the isolated reference dependencies.
// brand-gate: allow-start
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";

const args=process.argv.slice(2),options=new Map();
for(let index=0;index<args.length;index+=2){
  const name=args[index],value=args[index+1];
  assert.ok(["--reference","--dependencies"].includes(name)&&value&&!value.startsWith("--")&&!options.has(name),"expected unique --reference and --dependencies paths");
  options.set(name,resolve(value));
}
assert.equal(options.size,2);
const reference=options.get("--reference"),dependencies=options.get("--dependencies");
assert.equal(execFileSync("git",["-C",reference,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),"6bcbaa2d03a10afe8fe59934dabe262f55f012e7");
assert.equal(JSON.parse(readFileSync(join(dependencies,"node_modules/effect/package.json"),"utf8")).version,"4.0.0-rc.112");
const packages=new Map();
for(const file of execFileSync("rg",["--files",join(reference,"packages"),"-g","package.json"],{encoding:"utf8"}).trim().split("\n")){
  const metadata=JSON.parse(readFileSync(file,"utf8"));
  if(metadata.name?.startsWith("@smthrs/")){
    assert.equal(packages.has(metadata.name),false);packages.set(metadata.name,pathToFileURL(file).href);
  }
}
const dependencyParent=pathToFileURL(join(dependencies,"package.json")).href;
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith("@smthrs/")){
    const parentURL=packages.get(specifier.split("/").slice(0,2).join("/"));assert.ok(parentURL,specifier);
    return next(specifier,{...context,parentURL});
  }
  if(!specifier.startsWith(".")&&!specifier.startsWith("/")&&!specifier.includes(":"))return next(specifier,{...context,parentURL:dependencyParent});
  return next(specifier,context);
}});
const [Effect,Crypto,Node,Graph,Interpreter,Action,Product,Codec]=await Promise.all([
  "effect/Effect","effect/Crypto","@smthrs/plan/Node","@smthrs/flow/Graph","@smthrs/flow/Interpreter","@smthrs/flow/Action",
  new URL("../poc/dist/durable/keyed-control.js",import.meta.url).href,
  new URL("../poc/dist/durable/keyed-value.js",import.meta.url).href,
].map(name=>import(name)));
const crypto=Crypto.make({randomBytes(){throw new Error("control comparison requested randomness")},digest(algorithm,data){
  assert.equal(algorithm,"SHA-256");return Effect.sync(()=>new Uint8Array(createHash("sha256").update(data).digest()));
}});
const run=program=>Effect.runPromise(program.pipe(Effect.provide(Action.layerImplementations),Effect.provideService(Crypto.Crypto,crypto)));
const select=(condition,yes,no)=>Node.branch(condition,{if:value=>value,then:()=>yes,else:()=>no});
const cases=[];
for(const choice of [true,false]){
  cases.push({name:`branch-${choice}`,value:select(Node.succeed(choice),Node.succeed(41),Node.succeed(42))});
  cases.push({name:`branch-all-${choice}`,value:select(Node.succeed(choice),Node.all({a:Node.succeed(1),b:Node.succeed(2)}),Node.all({x:Node.succeed(3),y:Node.succeed(4)}))});
  cases.push({name:`nested-both-${choice}`,value:select(Node.succeed(choice),select(Node.succeed(false),Node.succeed("inner-yes"),Node.succeed("inner-no")),Node.succeed("outer-no"))});
  const shared=Node.succeed(19);
  cases.push({name:`shared-outside-${choice}`,value:Node.all({selected:select(Node.succeed(choice),Node.succeed(1),shared),independent:shared})});
  cases.push({name:`sequence-branch-${choice}`,value:Node.andThen(Node.succeed("barrier"),select(Node.succeed(choice),Node.all({a:Node.succeed(2),b:Node.succeed(3)}),Node.succeed(4)))});
}
for(const a of [true,false])for(const b of [true,false]){
  cases.push({name:`nested-${a}-${b}`,value:select(Node.succeed(a),select(Node.succeed(b),Node.succeed(10),Node.succeed(20)),Node.succeed(30))});
  cases.push({name:`independent-${a}-${b}`,value:Node.all({left:select(Node.succeed(a),Node.succeed(1),Node.succeed(2)),right:select(Node.succeed(b),Node.succeed(3),Node.succeed(4))})});
}
cases.push({name:"ordered-value",value:select(Node.succeed(true),Node.succeed({z:41,a:2}),Node.succeed({a:9,z:8}))});

const reports=[];
for(const fixture of cases){
  const graph=Graph.build(fixture.value);assert.equal(graph.diagnostics.length,0,fixture.name);
  const topology=Graph.nodes(graph).map(node=>{
    if(node.ast._tag!=="Branch")return {id:node.id,dependencies:node.dependencies};
    const inputs=node.draft.material.inputs.filter(input=>input._tag==="Ref");
    assert.equal(inputs.length,3,fixture.name);
    return {id:node.id,dependencies:node.dependencies,branch:{condition:inputs[0].from,whenTrue:inputs[1].from,whenFalse:inputs[2].from}};
  });
  const expected=await run(Interpreter.interpret(fixture.value));
  assert.equal(expected.failed.size,0,fixture.name);
  const control=new Product.KeyedControl(topology,"root"),executed=[];
  // Reference outcomes are the evidence input, not a callback execution in the
  // product. A demand for any untaken node immediately fails this comparison.
  for(let turns=0;!control.inspect().terminal;turns++){
    assert.ok(turns<=topology.length,`${fixture.name}: demand did not terminate`);
    const ready=control.claim(10_000);assert.ok(ready.length,`${fixture.name}: lost readiness`);
    for(const ticket of [...ready].reverse()){
      assert.ok(expected.settled.has(ticket.nodeId),`${fixture.name}: demanded untaken ${ticket.nodeId}`);
      const pending=topology.find(node=>node.id===ticket.nodeId).branch;
      if(pending){
        const value=expected.settled.get(pending.condition);assert.equal(typeof value,"boolean");
        const selected=value?pending.whenTrue:pending.whenFalse;
        assert.ok(ticket.dependencies.includes(selected));
        assert.equal(ticket.dependencies.includes(value?pending.whenFalse:pending.whenTrue),false);
      }
      control.complete(ticket,{kind:"success",value:Codec.encodeKeyedValue(expected.settled.get(ticket.nodeId))});
      executed.push(ticket.nodeId);
    }
  }
  const inspection=control.inspect(),skipped=inspection.nodes.filter(node=>node.status==="skipped").map(node=>node.id).sort();
  assert.deepEqual(executed.sort(),[...expected.settled.keys()].sort(),fixture.name);
  assert.deepEqual(skipped,[...expected.skipped].sort(),fixture.name);
  assert.deepEqual(inspection.cancel,[],fixture.name);
  reports.push({name:fixture.name,nodes:topology.length,settled:executed.length,skipped:skipped.length,matches:true});
}
console.log(JSON.stringify({scope:"data-only demand control versus actual reviewed Flow Interpreter; no native branch source or durable host claim",
  revision:"6bcbaa2d03a10afe8fe59934dabe262f55f012e7",cases:reports.length,reports},null,2));
// brand-gate: allow-end
