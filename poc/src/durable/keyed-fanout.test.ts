import {expect,test} from "bun:test"
import {getNativeCompiler} from "../compiler/native.ts"
import {KeyedSourceInterpreter} from "./keyed-interpreter.ts"
import {decodeKeyedValue,type KeyedValue} from "./keyed-value.ts"
import {type JsonValue} from "./value.ts"

const header='import {Action,durable,fanOut,sequential} from "vibelang:flows";'
const work='class Work extends Action<(n:number)=>Result<number,never>>{};'
const provider=(name="Work"):Record<string,JsonValue>&{effects:{boundaryMode:string;reads:string[];writes:string[]}}=>({actionId:`flow.vibe#${name}`,implementationId:`${name}/v1`,implementationDigest:"a".repeat(64),
  tier:"sealed",effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]})
const request=(source:string,inputJson:string,providers=[provider()])=>({source:header+source,inputJson,
  fileName:"flow.vibe",flowId:"fanout/Flow",flowVersion:1,planId:"fanout/plan",providersJson:JSON.stringify(providers)})
const compile=(source:string,inputJson:string,providers=[provider()])=>{
  const got=getNativeCompiler().compileKeyedPlanSource(request(source,inputJson,providers))
  if(!got.ok)throw new Error(JSON.stringify(got.diagnostics))
  return new KeyedSourceInterpreter(got.planJson)
}

// Exercise DATA interpretation with test answers, not a scheduler or provider
// runtime. Reversed ready-node order deliberately differs from authored order.
function interpret(flow:KeyedSourceInterpreter,answer:(id:string,input:any)=>unknown) {
  const values=new Map<string,KeyedValue>(),calls:{id:string,input:any}[]=[],waves:string[][]=[]
  const plan=JSON.parse(flow.planJson),remaining=[...flow.nodes]
  while(remaining.length){
    const ready=remaining.filter(node=>node.dependsOn.every(id=>values.has(id))).reverse()
    if(ready.length===0)throw new Error("no ready test-data node")
    waves.push(ready.map(node=>node.id))
    for(const node of ready){
      const inputs=plan.nodes.find((item:any)=>item.id===node.id).material.inputs
        .filter((input:any)=>input._tag==="Ref").map((input:any)=>{
          let value:any=values.get(input.from)
          for(const key of input.path)value=value[key]
          return {from:input.from,path:input.path,value}
        })
      const prepared=flow.prepare(node.id,inputs)
      if(prepared.operation==="action"){
        calls.push({id:node.id,input:prepared.input})
        values.set(node.id,flow.encodeSuccess(node.id,answer(prepared.contract.id,prepared.input)))
      }else values.set(node.id,prepared.value)
      remaining.splice(remaining.indexOf(node),1)
    }
  }
  return {value:decodeKeyedValue(values.get("result")!),calls,waves}
}

const numbers=work+'export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Work.run(n))});'

test("Go fan-out publishes independent key-addressed children and preserves input result order",()=>{
  const flow=compile(numbers,"[3,1,2]")
  const got=interpret(flow,(_,n)=>n*10)
  expect(got.value).toEqual([30,10,20])
  expect(got.waves.map(wave=>wave.length)).toEqual([3,1])
  expect(got.calls.map(call=>call.input)).toEqual([3,2,1])
  expect(flow.nodes.slice(0,-1).every(node=>/^fanout\/0\/key1_[a-f0-9]{64}\/0$/.test(node.id))).toBe(true)
  const reordered=compile(numbers,"[2,3,1]")
  expect(reordered.nodes.slice(0,-1)).toEqual(flow.nodes.slice(0,-1))
  expect(reordered.digest).not.toBe(flow.digest)
})

test("empty fan-out produces an empty array and no child Action",()=>{
  const flow=compile(numbers,"[]")
  const got=interpret(flow,()=>{throw new Error("empty fan-out invoked work")})
  expect(got.value).toEqual([])
  expect(got.calls).toEqual([])
  expect(flow.nodes).toHaveLength(1)
})

test("literal collections and known structure carrying planned data need no callback execution",()=>{
  const literal=compile(work+'export const Flow=durable((n:number)=>{return fanOut([3,n,1],v=>v,v=>Work.run(v))});',"2")
  expect(interpret(literal,(_,n)=>n).value).toEqual([3,2,1])
  const flow=compile(work+`export const Flow=durable((n:number)=>{
    const value=Work.run(n)!;
    return fanOut([{id:"known",value}],item=>item.id,item=>Work.run(item.value));
  });`,"41")
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual([43])
  expect(got.waves.map(wave=>wave.length)).toEqual([1,1,1])
})

test("a later independent Action does not inherit an implicit fan-out barrier",()=>{
  const flow=compile(work+`export const Flow=durable((items:readonly number[])=>{
    const values=fanOut(items,n=>n,n=>Work.run(n));const other=Work.run(99)!;return {values,other};
  });`,"[2,1]")
  const got=interpret(flow,(_,n)=>n)
  expect(got.value).toEqual({values:[2,1],other:99})
  expect(got.waves.map(wave=>wave.length)).toEqual([3,1])
  expect(flow.nodes.find(node=>node.id==="action/1")?.dependsOn).toEqual([])
})

test("fan-out joins and later literals retain data slots before ordering-only inputs",()=>{
  const flow=compile(work+`export const Flow=durable((items:readonly number[])=>{
    const first=fanOut(items,n=>n,n=>Work.run(n));
    const second=fanOut([5],n=>n,n=>Work.run(n));return {first,tail:7,second,again:first};
  });`,"[2,1]")
  expect(interpret(flow,(_,n)=>n).value).toEqual({first:[2,1],tail:7,second:[5],again:[2,1]})
})

test("a fan-out consumer joins unused child bindings without sequencing independent siblings",()=>{
  const flow=compile(work+`class Sum extends Action<(n:readonly number[])=>Result<number,never>>{};
    export const Flow=durable((items:readonly number[])=>{
      const values=fanOut(items,n=>n,n=>{const ignored=Work.run(9)!;return Work.run(n)});
      return Sum.run(values);
    });`,"[1,2]",[provider(),provider("Sum")])
  const got=interpret(flow,(_,n)=>Array.isArray(n)?n.reduce((a,b)=>a+b,0):n)
  expect(got.value).toBe(3)
  expect(got.waves.map(wave=>wave.length)).toEqual([4,1,1])
  expect(flow.nodes.find(node=>node.id==="action/1")?.dependsOn).toHaveLength(4)
})

test("fan-out Action-result data edges preserve per-item dependencies",()=>{
  const flow=compile(work+`export const Flow=durable((items:readonly number[])=>{
    return fanOut(items,n=>n,n=>{const first=Work.run(n)!;return Work.run(first)});
  });`,"[2,1]")
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual([4,3])
  expect(got.waves.map(wave=>wave.length)).toEqual([2,2,1])
})

test("an unproven fan-out array index cannot become an Action's required input",()=>{
  const got=getNativeCompiler().compileKeyedPlanSource(request(work+`export const Flow=durable((items:readonly number[])=>{
    const values=fanOut(items,n=>n,n=>Work.run(n));return Work.run(values[0]);
  });`,"[2,1]"))
  expect(got.ok).toBe(false)
  expect(got.planJson).toBe("")
  expect(got.diagnostics.map(issue=>issue.message).join("\n")).toContain("not assignable")
})

test("ignoring the group value cannot discard declared fan-out work",()=>{
  const flow=compile(work+`export const Flow=durable((items:readonly number[])=>{
    const ignored=fanOut(items,n=>n,n=>Work.run(n));return 7;
  });`,"[2,1]")
  const got=interpret(flow,(_,n)=>n)
  expect(got.value).toBe(7)
  expect(got.calls).toHaveLength(2)
  expect(got.waves.map(wave=>wave.length)).toEqual([2,1])
})

test("fan-out key identity distinguishes scalar types and original Unicode",()=>{
  const items=[1,"1",true,"true",false,"false","é","e\u0301","__proto__"].map((key,value)=>({key,value}))
  const source=work+`export const Flow=durable((items:readonly {key:string|number|boolean;value:number}[])=>{
    return fanOut(items,item=>item.key,item=>Work.run(item.value));
  });`
  const flow=compile(source,JSON.stringify(items))
  expect(new Set(flow.nodes.map(node=>node.id)).size).toBe(items.length+1)
  expect(interpret(flow,(_,n)=>n).value).toEqual(items.map(item=>item.value))
  const reverse=compile(source,JSON.stringify([...items].reverse()))
  expect(reverse.nodes.slice(0,-1)).toEqual(flow.nodes.slice(0,-1))
})

test("sixteen Action bindings per item are admitted without implicit step ordering",()=>{
  const bindings=Array.from({length:15},(_,i)=>`const step${i}=Work.run(n)!;`).join("")
  const flow=compile(work+`export const Flow=durable((items:readonly number[])=>{
    return fanOut(items,n=>n,n=>{${bindings}return Work.run(n)});
  });`,"[1,2]")
  expect(flow.nodes).toHaveLength(33)
  const got=interpret(flow,(_,n)=>n)
  expect(got.waves.map(wave=>wave.length)).toEqual([32,1])
  expect(got.value).toEqual([1,2])
})

test("fan-out retains explicit sequencing inherited from the enclosing Flow",()=>{
  const flow=compile(work+`export const Flow=durable((items:readonly number[])=>{
    sequential(Work.run(8),Work.run(9));return fanOut(items,n=>n,n=>Work.run(n));
  });`,"[1,2]")
  const got=interpret(flow,(_,n)=>n)
  expect(got.value).toEqual([1,2])
  expect(got.waves.map(wave=>wave.length)).toEqual([1,1,2,1])
})

test("fan-out templates retain authored object order across Action bindings",()=>{
  const source=`class Work extends Action<(n:{z:number;a:number})=>Result<{z:number;a:number},never>>{};
  export const Flow=durable((items:readonly {id:string;value:number}[])=>{
    return fanOut(items,item=>item.id,item=>{const read=Work.run({z:item.value,a:1})!;return Work.run({z:read.z,a:read.a})});
  });`
  const got=interpret(compile(source,'[{"id":"b","value":2},{"id":"a","value":1}]'),(_,n)=>n)
  expect(JSON.stringify(got.value)).toBe('[{"z":2,"a":1},{"z":1,"a":1}]')
  expect(got.calls.every(call=>JSON.stringify(Object.keys(call.input))==='["z","a"]')).toBe(true)
})

test("changed item keys change child addresses even for constant Action inputs",()=>{
  const source=work+'export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Work.run(0))});'
  const a=compile(source,"[1]"),b=compile(source,"[2]")
  expect(a.nodes[0].id).not.toBe(b.nodes[0].id)
  expect(a.digest).not.toBe(b.digest)
  // These sealed Actions still declare the same consumed data. Structural
  // identity is not additional input or permission to use a cached result.
  expect(a.nodes[0].key).toBe(b.nodes[0].key)
})

for(const [name,source,input,reason] of [
  ["duplicate keys",numbers,"[1,1]","duplicate fan-out item key"],
  ["future keys",work+'export const Flow=durable((n:number)=>{const v:number=Work.run(n)!;return fanOut([v],v=>v,v=>Work.run(v))});',"41","bounded round"],
  ["future size",'class Work extends Action<(n:number)=>Result<readonly number[],never>>{};export const Flow=durable((n:number)=>{const items:readonly number[]=Work.run(n)!;return fanOut(items,n=>n,n=>Work.run(n))});',"41","bounded round"],
  ["prototype setter",'class Work extends Action<(n:{__proto__:null})=>Result<number,never>>{};export const Flow=durable((n:readonly number[])=>{return fanOut(n,x=>x,x=>Work.run({__proto__:null}))});',"[1]","prototype-setting"],
  ["wrong propagated Action type",work+'class Read extends Action<(n:number)=>Result<string,never>>{};export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>{const value=Read.run(n)!;return Work.run(value)})});',"[1]","not assignable"],
  ["more than sixteen bindings",work+`export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>{${Array.from({length:16},(_,i)=>`const step${i}=Work.run(n)!;`).join("")}return Work.run(n)})});`,"[1]","at most 16"],
] as const)test(`fan-out refuses ${name} without a partial graph`,()=>{
  const got=getNativeCompiler().compileKeyedPlanSource(request(source,input))
  expect(got.ok).toBe(false)
  expect(got.planJson).toBe("")
  expect(got.diagnostics.map(issue=>issue.message).join("\n")).toContain(reason)
})

test("empty fan-out cannot hide malformed provider effects",()=>{
  const p=provider();p.effects.writes=["../escape"]
  const got=getNativeCompiler().compileKeyedPlanSource(request(numbers,"[]",[p]))
  expect(got.ok).toBe(false)
  expect(got.diagnostics.some(issue=>issue.message.includes("provider effects"))).toBe(true)
})

test("fan-out captures enclosing input and const data without evaluating a closure",()=>{
  const source=`class Work extends Action<(n:{z:number;a:number;b:number})=>Result<{z:number;a:number;b:number},never>>{};
    export const Flow=durable((input:{items:readonly number[];value:number})=>{
      const payload={z:input.value,a:7};
      return fanOut(input.items,n=>n,n=>Work.run({z:payload.z,a:payload.a,b:n}));
    });`
  const got=interpret(compile(source,'{"items":[2,1],"value":41}'),(_,n)=>n)
  expect(JSON.stringify(got.value)).toBe('[{"z":41,"a":7,"b":2},{"z":41,"a":7,"b":1}]')
  expect(got.waves.map(wave=>wave.length)).toEqual([2,1])
})

test("fan-out captured Action values retain shared data edges without serializing siblings",()=>{
  const source=work+`export const Flow=durable((input:{items:readonly number[];value:number})=>{
    const upstream=Work.run(input.value)!;const alias={value:upstream};
    const values=fanOut(input.items,n=>n,n=>Work.run(alias.value));
    const independent=Work.run(9)!;return {values,independent};
  });`
  const flow=compile(source,'{"items":[2,1],"value":41}')
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual({values:[43,43],independent:10})
  expect(got.waves.map(wave=>wave.length)).toEqual([2,2,1])
  expect(flow.nodes.filter(node=>node.id.startsWith("fanout/")).map(node=>node.dependsOn)).toEqual([["action/0"],["action/0"]])
  expect(flow.nodes.find(node=>node.id==="action/2")?.dependsOn).toEqual([])
})

test("fan-out capture uses lexical symbols rather than identifier text",()=>{
  const flow=compile(work+`export const Flow=durable((n:number)=>{
    const value=Work.run(n)!;
    return fanOut([1,2],n=>n,n=>{const value=Work.run(n)!;return Work.run(value)});
  });`,"41")
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual([3,4])
  expect(got.waves.map(wave=>wave.length)).toEqual([3,2,1])
  expect(flow.nodes.filter(node=>node.id.startsWith("fanout/")).every(node=>!node.dependsOn.includes("action/0"))).toBe(true)
})

test("capturing a child Flow's known output cannot drop its completion join",()=>{
  const flow=compile(work+`const Child=durable((n:number)=>{const ignored=Work.run(9)!;return {value:n}});
    export const Flow=durable((input:{items:readonly number[];value:number})=>{
      const captured=Child.run(input.value)!;
      return fanOut(input.items,n=>n,n=>Work.run(captured.value));
    });`,'{"items":[2,1],"value":41}')
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual([42,42])
  expect(got.waves.map(wave=>wave.length)).toEqual([1,2,1])
  expect(flow.nodes.filter(node=>node.id.startsWith("fanout/")).map(node=>node.dependsOn)).toEqual([["flow/0/action/0"],["flow/0/action/0"]])
})

test("captures inside composed fan-out children bind to each child's input and node scope",()=>{
  const flow=compile(work+`const Grandchild=durable((n:number)=>{return Work.run(n)});
    const Child=durable((input:{items:readonly number[];value:number})=>{
      const previous=Work.run(input.value)!;
      return fanOut(input.items,n=>n,n=>Grandchild.run(previous));
    });
    export const Flow=durable((items:readonly number[])=>{
      return fanOut(items,n=>n,n=>Child.run({items:[2,1],value:n}));
    });`,"[41,9]")
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual([[43,43],[11,11]])
  expect(got.waves.map(wave=>wave.length)).toEqual([2,4,1])
  expect(got.calls.filter(call=>call.input===42)).toHaveLength(2)
  expect(got.calls.filter(call=>call.input===10)).toHaveLength(2)
})

test("an empty fan-out still retains the enclosing captured Action",()=>{
  const flow=compile(work+`export const Flow=durable((input:{items:readonly number[];value:number})=>{
    const captured=Work.run(input.value)!;return fanOut(input.items,n=>n,n=>Work.run(captured));
  });`,'{"items":[],"value":41}')
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual([])
  expect(got.calls.map(call=>call.input)).toEqual([41])
  expect(got.waves.map(wave=>wave.length)).toEqual([1,1])
})

test("whole input captures retain object order and known tuple projections",()=>{
  const source=`class Work extends Action<(n:{payload:{z:number;a:number};value:number})=>Result<{payload:{z:number;a:number};value:number},never>>{};
    export const Flow=durable((input:{z:number;a:number})=>{
      const pair:[number,number]=[7,9];
      return fanOut([2,1],n=>n,n=>Work.run({payload:input,value:pair[0]}));
    });`
  const got=interpret(compile(source,'{"z":41,"a":2}'),(_,n)=>n)
  expect(JSON.stringify(got.value)).toBe('[{"payload":{"z":41,"a":2},"value":7},{"payload":{"z":41,"a":2},"value":7}]')
  expect(got.waves.map(wave=>wave.length)).toEqual([2,1])
})

test("a captured earlier fan-out result preserves every child join",()=>{
  const source=work+`class Sum extends Action<(n:readonly number[])=>Result<number,never>>{};
    export const Flow=durable((items:readonly number[])=>{
      const captured=fanOut(items,n=>n,n=>{const ignored=Work.run(9)!;return Work.run(n)});
      return fanOut([2,1],n=>n,n=>Sum.run(captured));
    });`
  const got=interpret(compile(source,"[4,3]",[provider(),provider("Sum")]),(_,n)=>Array.isArray(n)?n.reduce((a,b)=>a+b,0):n)
  expect(got.value).toEqual([7,7])
  expect(got.waves.map(wave=>wave.length)).toEqual([4,2,1])
})

test("captured object projections keep duplicate Ref slots in authored field order",()=>{
  const source=`class Work extends Action<(n:{z:number;a:number})=>Result<{z:number;a:number},never>>{};
    export const Flow=durable((n:number)=>{
      const captured=Work.run({z:n,a:1})!;
      return fanOut([2,1],n=>n,n=>Work.run({z:captured.z,a:captured.z}));
    });`
  const flow=compile(source,"41"),got=interpret(flow,(_,n)=>n)
  expect(JSON.stringify(got.value)).toBe('[{"z":41,"a":41},{"z":41,"a":41}]')
  expect(got.waves.map(wave=>wave.length)).toEqual([1,2,1])
  for(const node of JSON.parse(flow.planJson).nodes.filter((node:any)=>node.id.startsWith("fanout/"))){
    expect(node.material.inputs).toEqual([
      {_tag:"Ref",from:"action/0",path:["items","z"]},
      {_tag:"Ref",from:"action/0",path:["items","z"]},
    ])
  }
})

test("changing a captured input changes consumed material without changing item addresses",()=>{
  const source=work+`export const Flow=durable((input:{items:readonly number[];value:number})=>{
    return fanOut(input.items,n=>n,n=>Work.run(input.value));
  });`
  const first=compile(source,'{"items":[2,1],"value":41}'),next=compile(source,'{"items":[2,1],"value":42}')
  expect(next.nodes.map(node=>node.id)).toEqual(first.nodes.map(node=>node.id))
  expect(next.nodes.map(node=>node.key)).not.toEqual(first.nodes.map(node=>node.key))
  expect(next.digest).not.toBe(first.digest)
  expect(interpret(first,(_,n)=>n).value).toEqual([41,41])
  expect(interpret(next,(_,n)=>n).value).toEqual([42,42])
})

for(const [name,source,input] of [
  ["module state",work+'const captured=41;export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Work.run(captured))});',"[1]"],
  ["forward binding",work+'export const Flow=durable((items:readonly number[])=>{const values=fanOut(items,n=>n,n=>Work.run(captured));const captured=41;return values});',"[1]"],
  ["mutable binding",work+'export const Flow=durable((items:readonly number[])=>{let captured=41;return fanOut(items,n=>n,n=>Work.run(captured))});',"[1]"],
  ["mutated object",work+'export const Flow=durable((items:readonly number[])=>{const captured={value:41};captured.value=9;return fanOut(items,n=>n,n=>Work.run(captured.value))});',"[1]"],
  ["unproven input index",work+'export const Flow=durable((input:{items:readonly number[];values:readonly number[]})=>{return fanOut(input.items,n=>n,n=>Work.run(input.values[0]))});','{"items":[1],"values":[]}'],
  ["unproven aliased index",work+'export const Flow=durable((input:{items:readonly number[];values:readonly number[]})=>{const captured=input.values[0];return fanOut(input.items,n=>n,n=>Work.run(captured))});','{"items":[1],"values":[]}'],
  ["optional input field",work+'export const Flow=durable((input:{items:readonly number[];value?:number})=>{return fanOut(input.items,n=>n,n=>Work.run(input.value))});','{"items":[1]}'],
  ["wrong captured Action type",work+'class Read extends Action<(n:number)=>Result<string,never>>{};export const Flow=durable((items:readonly number[])=>{const captured=Read.run(41)!;return fanOut(items,n=>n,n=>Work.run(captured))});',"[1]"],
  ["key capture",work+'export const Flow=durable((input:{items:readonly number[];value:number})=>{return fanOut(input.items,n=>input.value,n=>Work.run(n))});','{"items":[1],"value":2}'],
] as const)test(`fan-out capture refuses ${name} without a partial graph`,()=>{
  const got=getNativeCompiler().compileKeyedPlanSource(request(source,input))
  expect(got.ok).toBe(false)
  expect(got.planJson).toBe("")
  expect(got.diagnostics.length).toBeGreaterThan(0)
})

test("fan-out composes source child Flows without evaluating callbacks",()=>{
  const source=work+`const Child=durable((n:number):Result<number,never>=>{return Work.run(n)!});
    export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Child.run(n))});`
  const flow=compile(source,"[2,1]")
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual([3,2])
  expect(got.waves.map(wave=>wave.length)).toEqual([2,1])
  expect(compile(source,"[1,2]").nodes.slice(0,-1)).toEqual(flow.nodes.slice(0,-1))
  expect(interpret(compile(source,"[]"),()=>{throw new Error("empty group ran a child")}).value).toEqual([])
})

test("fan-out child results keep data edges across mixed Action and Flow steps",()=>{
  const flow=compile(work+`const Child=durable((n:number)=>{const ignored=Work.run(9)!;return Work.run(n)});
    export const Flow=durable((items:readonly number[])=>{
      return fanOut(items,n=>n,n=>{const first=Work.run(n)!;return Child.run(first)!});
    });`,"[2,1]")
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual([4,3])
  expect(got.waves.map(wave=>wave.length)).toEqual([4,2,1])
  expect(got.calls).toHaveLength(6)
})

test("a fan-out child returning known data still joins its declared work",()=>{
  const flow=compile(work+`const Child=durable((n:number)=>{const ignored=Work.run(9)!;return {z:n,a:1}});
    export const Flow=durable((items:readonly number[])=>{
      const values=fanOut(items,n=>n,n=>{const child=Child.run(n)!;return Work.run(child.z)});
      const other=Work.run(42)!;return {values,other};
    });`,"[2,1]")
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual({values:[3,2],other:43})
  expect(got.waves.map(wave=>wave.length)).toEqual([3,2,1])
})

test("a child Flow can contribute a nested static fan-out per outer key",()=>{
  const source=work+`const Child=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Work.run(n))});
    export const Flow=durable((items:readonly {key:string;values:readonly number[]}[])=>{
      return fanOut(items,item=>item.key,item=>Child.run(item.values));
    });`
  const flow=compile(source,'[{"key":"b","values":[1,2]},{"key":"a","values":[3]}]')
  const got=interpret(flow,(_,n)=>n+1)
  expect(got.value).toEqual([[2,3],[4]])
  expect(got.waves.map(wave=>wave.length)).toEqual([3,1])
  expect(new Set(flow.nodes.map(node=>node.id)).size).toBe(4)
  const reordered=compile(source,'[{"key":"a","values":[3]},{"key":"b","values":[1,2]}]')
  expect(reordered.nodes.slice(0,-1)).toEqual(flow.nodes.slice(0,-1))
})

test("pure source children in fan-out publish values with no invented work",()=>{
  const flow=compile(`const Child=durable((n:number)=>{return {z:n,a:1}});
    export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Child.run(n)!)});`,"[2,1]",[])
  const got=interpret(flow,()=>{throw new Error("pure child acquired an Action")})
  expect(JSON.stringify(got.value)).toBe('[{"z":2,"a":1},{"z":1,"a":1}]')
  expect(flow.nodes).toHaveLength(1)
  expect(got.calls).toEqual([])
})

test("fan-out child composition cannot erase nominal failure rows",()=>{
  const source=`class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};
    const Child=durable((n:number)=>{return Work.run(n)});
    export const Flow=durable((items:readonly number[]):Result<readonly number[],never>=>{
      return fanOut(items,n=>n,n=>Child.run(n));
    });`
  const got=getNativeCompiler().compileKeyedPlanSource(request(source,"[1]"))
  expect(got.ok).toBe(false)
  expect(got.planJson).toBe("")
  expect(got.diagnostics.map(issue=>issue.code)).toContain("VIBE1104")
})

test("fan-out source children retain imported and re-exported nominal contracts",()=>{
  const got=getNativeCompiler().compileKeyedPlanSource({...request(`import * as API from "./api";
    export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>API.Child.run(n)!)});`,"[2,1]"),
    dependencies:[{fileName:"api.vibe",source:'export {Child} from "./child";'},
      {fileName:"child.vibe",source:header+work+'export const Child=durable((n:number)=>{return Work.run(n)});'}],
    providersJson:JSON.stringify([{...provider(),actionId:"child.vibe#Work"}])})
  expect(got.ok).toBe(true)
  const flow=new KeyedSourceInterpreter(got.planJson),seen:string[]=[]
  expect(interpret(flow,(id,n)=>{seen.push(id);return n+1}).value).toEqual([3,2])
  expect(seen).toEqual(["child.vibe#Work","child.vibe#Work"])
})

test("fan-out child scope identity is distinct from a sealed Action's consumed material",()=>{
  const source=work+`const Child=durable((n:number)=>{return Work.run(0)});
    export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Child.run(n))});`
  const a=compile(source,"[1]"),b=compile(source,"[2]")
  expect(a.nodes[0].id).not.toBe(b.nodes[0].id)
  expect(a.nodes[0].key).toBe(b.nodes[0].key)
  expect(a.digest).not.toBe(b.digest)
})

for(const [name,child,callback,reason] of [
  ["recursive source child",`const Child=durable((n:number):Result<number,never>=>{
    const ignored=fanOut([n],v=>v,v=>Child.run(v));return Work.run(n)});`,"n=>Child.run(n)","recursive source Flow composition"],
  ["wrong child input",'const Child=durable((n:string)=>{return n});',"n=>Child.run(n)","not assignable"],
  ["wrong projected child success",'const Child=durable((n:number)=>{return {text:"wrong"}});',
    "n=>{const first=Child.run(n)!;return Work.run(first.text)}","not assignable"],
  ["mutable child",'let Child=durable((n:number)=>{return Work.run(n)});',"n=>Child.run(n)","module-level value initializers"],
  ["unused invalid child local",'const Child=durable((n:number)=>{const ignored:string=n;return Work.run(n)});',
    "n=>Child.run(n)","not assignable"],
  ["opaque lookalike",'const Child={run(n:number):Result<number,never>{return n}};',"n=>Child.run(n)","module-level value initializers"],
] as const)test(`fan-out refuses ${name} without partially publishing a child`,()=>{
  const got=getNativeCompiler().compileKeyedPlanSource(request(work+child+
    `export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,${callback})});`,"[1]"))
  expect(got.ok).toBe(false)
  expect(got.planJson).toBe("")
  expect(got.diagnostics.map(issue=>issue.message).join("\n")).toContain(reason)
})

test("an empty fan-out cannot bypass child provider closure checking",()=>{
  const got=getNativeCompiler().compileKeyedPlanSource(request(work+`const Child=durable((n:number)=>{return Work.run(n)});
    export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Child.run(n))});`,"[]",[]))
  expect(got.ok).toBe(false)
  expect(got.planJson).toBe("")
  expect(got.diagnostics.map(issue=>issue.message).join("\n")).toContain("provider")
})

for(const row of ["API.Bad","never"])test(`imported fan-out child failure row must fit ${row}`,()=>{
  const got=getNativeCompiler().compileKeyedPlanSource({...request(`import * as API from "./api";
    export const Flow=durable((items:readonly number[]):Result<readonly number[],${row}>=>{
      return fanOut(items,n=>n,n=>API.Child.run(n));
    });`,"[2,1]"),dependencies:[{fileName:"api.vibe",source:'export {Child,Bad} from "./child";'},
      {fileName:"child.vibe",source:header+'export class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};export const Child=durable((n:number)=>{return Work.run(n)});'}],
    providersJson:JSON.stringify([{...provider(),actionId:"child.vibe#Work"}])})
  expect(got.ok).toBe(row==="API.Bad")
  if(row==="never"){
    expect(got.planJson).toBe("")
    expect(got.diagnostics.map(issue=>issue.code)).toContain("VIBE1104")
  }else expect(interpret(new KeyedSourceInterpreter(got.planJson),(_,n)=>n+1).value).toEqual([3,2])
})
