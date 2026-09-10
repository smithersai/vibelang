import {expect,test} from "bun:test"
import {getNativeCompiler} from "../compiler/native.ts"
import {KeyedSourceInterpreter,KeyedSourceEvaluationError} from "./keyed-interpreter.ts"
import {decodeKeyedValue} from "./keyed-value.ts"
import {createKeyedComputationEvaluator,keyedOperatorArity} from "./keyed-computation.ts"

const header='import {Action,durable,fanOut} from "vibelang:flows";'

test("deferred keyed projection reads only present own data",()=>{
  const evaluate=createKeyedComputationEvaluator()
  expect(keyedOperatorArity("get")).toBe(2)
  expect(evaluate("get",index=>index===0?{z:41,a:1}:"z")).toBe(41)
  expect(evaluate("get",index=>index===0?[41,1]:"0")).toBe(41)
  expect(evaluate("get",index=>index===0?JSON.parse('{"__proto__":42}'):"__proto__")).toBe(42)
  for(const [value,key] of [[null,"x"],[1,"x"],["abc","0"],[{},"x"],[{},"toString"],[[1],"2"],[{x:1},0]]) {
    expect(()=>evaluate("get",index=>(index===0?value:key) as any)).toThrow(/present own data/)
  }
})

test("null equality admits records but never general object comparison or coercion",()=>{
  const evaluate=createKeyedComputationEvaluator(),record={x:1}
  for(const operator of ["equal","not-equal","loose-equal","loose-not-equal"] as const) {
    const negative=operator.includes("not-")
    expect(evaluate(operator,()=>null)).toBe(!negative)
    expect(evaluate(operator,index=>index===0?null:record)).toBe(negative)
    expect(evaluate(operator,index=>index===1?null:record)).toBe(negative)
    expect(()=>evaluate(operator,()=>record)).toThrow(/object identities/)
    expect(()=>evaluate(operator,index=>index===0?record:"[object Object]")).toThrow(/object identities/)
  }
})
const provider={actionId:"flow.vibe#Work",implementationId:"work/v1",implementationDigest:"a".repeat(64),tier:"sealed",
  effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}
const request=(source:string,inputJson:string,providers:unknown[]=[])=>({source:header+source,inputJson,
  fileName:"flow.vibe",flowId:"compute/Flow",flowVersion:1,planId:"compute/plan",providersJson:JSON.stringify(providers)})
function compile(source:string,inputJson:string,providers:unknown[]=[]) {
  const result=getNativeCompiler().compileKeyedPlanSource(request(source,inputJson,providers))
  if(!result.ok)throw new Error(JSON.stringify(result.diagnostics))
  return new KeyedSourceInterpreter(result.planJson)
}

// Authored operators are already TypeScript grammar. Expected answers below
// are independent constants, not evaluations of the compiler's expression IR.
for(const [expression,expected] of [
  ["n.a+n.b",9],["n.a-n.b",5],["n.a*n.b",14],["n.a/n.b",3.5],["n.a%n.b",1],["n.a**n.b",49],
  ["n.a&n.b",2],["n.a|n.b",7],["n.a^n.b",5],["n.a<<n.b",28],["n.a>>n.b",1],["n.a>>>n.b",1],
  ["n.a===n.b",false],["n.a!==n.b",true],["n.a>n.b",true],["n.a>=n.b",true],["n.a<n.b",false],["n.a<=n.b",false],
  ["-n.a",-7],["+n.a",7],["~n.a",-8],["!n.a",false],
] as const)test(`Go-derived pure value expression ${expression}`,()=>{
  const flow=compile(`export const Flow=durable((n:{a:number;b:number})=>{return ${expression}});`,'{"a":7,"b":2}')
  const result=flow.prepare("result",[])
  expect(result.operation).toBe("result")
  if(result.operation!=="result")throw new Error("unexpected Action")
  expect(decodeKeyedValue(result.value)).toEqual(expected)
})

test("scalar concatenation and logical values preserve authored JavaScript semantics",()=>{
  const flow=compile(`export const Flow=durable((n:{s:string;a:number;flag:boolean;optional:string|null})=>{
    return {text:n.s+":"+n.a,on:n.flag&&n.s,off:n.flag||n.s,fallback:n.optional??n.s,not:!n.flag};
  });`,'{"s":"answer","a":42,"flag":false,"optional":null}')
  const result=flow.prepare("result",[])
  if(result.operation!=="result")throw new Error("unexpected Action")
  expect(JSON.stringify(decodeKeyedValue(result.value))).toBe('{"text":"answer:42","on":false,"off":"answer","fallback":"answer","not":true}')
})

test("planned arithmetic preserves dependencies and duplicate Ref slots",()=>{
  const flow=compile(`class Work extends Action<(n:number)=>Result<number,never>>{};
    export const Flow=durable((n:number)=>{const first=Work.run(n)!;return Work.run(first+first*2)});`,"7",[provider])
  // Data refs precede the ordering-only suffix. Both predecessors still join.
  expect(flow.nodes.map(node=>node.dependsOn)).toEqual([[],["action/0"],["action/1","action/0"]])
  const prepared=flow.prepare("action/1",[{from:"action/0",path:[],value:7},{from:"action/0",path:[],value:7}])
  if(prepared.operation!=="action")throw new Error("missing Action")
  expect(prepared.input).toBe(21)
})

test("a short-circuit operand declares an explicit conditional graph, never eager Actions",()=>{
  const result=getNativeCompiler().compileKeyedPlanSource(request(`class Work extends Action<(n:number)=>Result<boolean,never>>{};
    export const Flow=durable((n:boolean)=>{return n&&Work.run(1)!});`,"false",[provider]))
  expect(result.ok).toBe(true)
  const interpreter=new KeyedSourceInterpreter(result.planJson)
  expect(interpreter.nodes.some(node=>node.operation==="branch")).toBe(true)
  expect(interpreter.createControl().claim(10000).map(ticket=>ticket.nodeId)).toEqual(["branch/0/condition"])
})

test("identity-sensitive object equality is not reinterpreted as wire-value equality",()=>{
  const result=getNativeCompiler().compileKeyedPlanSource(request(`export const Flow=durable((n:{a:number})=>{return n===n});`,'{"a":1}'))
  expect(result.ok).toBe(false)
  expect(result.planJson).toBe("")
})

for(const [expression,input,expected] of [
  ["n===null","null",true],["n===null",'{"x":1}',false],
  ["null===n","null",true],["null===n",'{"x":1}',false],
  ["n!==null","null",false],["n!==null",'{"x":1}',true],
  ["n==null","null",true],["n==null",'{"x":1}',false],
  ["n!=null","null",false],["n!=null",'{"x":1}',true],
] as const)test(`null comparison needs no transported object identity: ${expression} on ${input}`,()=>{
  const flow=compile(`export const Flow=durable((n:{x:number}|null)=>{return ${expression}})`,input)
  const result=flow.prepare("result",[])
  if(result.operation!=="result")throw new Error("unexpected Action")
  expect(decodeKeyedValue(result.value)).toBe(expected)
})

for(const [expression,input,expected] of [
  ["n.a%n.b",'{"a":-5,"b":2}',-1],
  ["n.a>>>n.b",'{"a":-5,"b":1}',2147483645],
  ["n.a<<n.b",'{"a":3.9,"b":33}',6],
  ["n.a**n.b",'{"a":9,"b":0.5}',3],
  ["(n.a/n.b)>0",'{"a":1,"b":0}',true],
  ["(n.a/n.b)===(n.a/n.b)",'{"a":0,"b":0}',false],
  ["(n.a/n.b)!==(n.a/n.b)",'{"a":0,"b":0}',true],
  ["(n.a/n.b)|0",'{"a":1,"b":0}',0],
  ["n.a+n.b",'{"a":0.1,"b":0.2}',0.30000000000000004],
] as const)test(`IEEE/bitwise computation ${expression} on ${input}`,()=>{
  const flow=compile(`export const Flow=durable((n:{a:number;b:number})=>{return ${expression}});`,input)
  const result=flow.prepare("result",[])
  if(result.operation!=="result")throw new Error("unexpected Action")
  expect(decodeKeyedValue(result.value)).toBe(expected)
})

for(const [expression,type,input,expected] of [
  ["n.a==n.b","{a:string|number;b:string|number}",'{"a":"42","b":42}',true],
  ["n.a!=n.b","{a:string|number;b:string|number}",'{"a":"42","b":42}',false],
  ["n.a===n.b","{a:string|number;b:string|number}",'{"a":"42","b":42}',false],
  ["n.a<n.b","{a:string;b:string}",'{"a":"10","b":"2"}',true],
  ["n.a<n.b","{a:string|number;b:string|number}",'{"a":"10","b":2}',false],
  ["n.a+n.b","{a:string;b:boolean|null}",'{"a":"answer:","b":null}',"answer:null"],
  ["n.a+n.b","{a:string;b:boolean|null}",'{"a":"answer:","b":false}',"answer:false"],
  ["n.a??n.b","{a:number|null;b:number}",'{"a":0,"b":42}',0],
  ["n.a&&n.b","{a:number;b:number}",'{"a":0,"b":42}',0],
  ["n.a||n.b","{a:number;b:number}",'{"a":0,"b":42}',42],
] as const)test(`scalar conversion/selection ${expression} on ${input}`,()=>{
  const flow=compile(`export const Flow=durable((n:${type})=>{return ${expression}});`,input)
  const result=flow.prepare("result",[])
  if(result.operation!=="result")throw new Error("unexpected Action")
  expect(decodeKeyedValue(result.value)).toBe(expected)
})

for(const expression of ["n/0","0/0","-n","n/(-1)","n*1e308*1e308"])
  test(`noncanonical computed node output is a defect: ${expression}`,()=>{
    const flow=compile(`export const Flow=durable((n:number)=>{return ${expression}});`,expression.includes("1e308")?"2":"0")
    expect(()=>flow.prepare("result",[])).toThrow(KeyedSourceEvaluationError)
    expect(()=>flow.prepare("result",[])).toThrow(/finite number other than negative zero/)
  })

test("short-circuit evaluation does not allocate an untaken oversized string computation",()=>{
  const source=`export const Flow=durable((n:{skip:boolean;text:string})=>{return n.skip||(n.text+n.text+n.text==="")});`
  const text="x".repeat(1_000_000)
  const skipped=compile(source,JSON.stringify({skip:true,text})).prepare("result",[])
  if(skipped.operation!=="result")throw new Error("unexpected Action")
  expect(skipped.value).toBe(true)
  const taken=compile(source,JSON.stringify({skip:false,text}))
  expect(()=>taken.prepare("result",[])).toThrow(/string production budget/)
})

test("computed booleans cannot conceal an invalid producer Ref type",()=>{
  const flow=compile(`class Work extends Action<(n:number)=>Result<number,never>>{};
    export const Flow=durable((n:number)=>{const value=Work.run(n)!;return value===value});`,"1",[provider])
  expect(()=>flow.prepare("result",[{from:"action/0",path:[],value:"bad"},{from:"action/0",path:[],value:"bad"}])).toThrow(/durable number/)
  const valid=flow.prepare("result",[{from:"action/0",path:[],value:42},{from:"action/0",path:[],value:42}])
  expect(valid.operation==="result"&&valid.value).toBe(true)
})

test("computed comparisons validate the producer's projected subtree before evaluating",()=>{
  const flow=compile(`class Work extends Action<(n:number)=>Result<{nested:[{value:number}]},never>>{};
    export const Flow=durable((n:number)=>{const value=Work.run(n)!;return value.nested[0].value>0});`,"1",[provider])
  const path=["items","nested","items","0","items","value"]
  expect(()=>flow.prepare("result",[{from:"action/0",path,value:"bad"}])).toThrow(/durable number/)
  const valid=flow.prepare("result",[{from:"action/0",path,value:42}])
  expect(valid.operation==="result"&&valid.value).toBe(true)
})

test("projected union Ref contracts are checked before a scalar comparison",()=>{
  const flow=compile(`class Work extends Action<(n:number)=>Result<{value:number}|{value:string},never>>{};
    export const Flow=durable((n:number)=>{const value=Work.run(n)!;return value.value===42});`,"1",[provider])
  const ref={from:"action/0",path:["items","value"]}
  expect(()=>flow.prepare("result",[{...ref,value:true}])).toThrow()
  const number=flow.prepare("result",[{...ref,value:42}]),string=flow.prepare("result",[{...ref,value:"42"}])
  expect(number.operation==="result"&&number.value).toBe(true)
  expect(string.operation==="result"&&string.value).toBe(false)
})

test("nullable short-circuit Action declaration publishes the explicit condition before work",()=>{
  const result=getNativeCompiler().compileKeyedPlanSource(request(`class Work extends Action<(n:number)=>Result<number,never>>{};
    export const Flow=durable((n:{value:number|null;other:number})=>{return n.value??Work.run(n.other)!});`,'{"value":null,"other":1}',[provider]))
  expect(result.ok).toBe(true)
  const interpreter=new KeyedSourceInterpreter(result.planJson)
  expect(interpreter.nodes.some(node=>node.operation==="branch")).toBe(true)
  expect(interpreter.createControl().claim(10000).map(ticket=>ticket.nodeId)).toEqual(["branch/0/condition"])
})

test("a previously declared Action still joins when a pure right operand is skipped",()=>{
  const flow=compile(`class Work extends Action<(n:number)=>Result<number,never>>{};
    export const Flow=durable((n:number)=>{const started=Work.run(n)!;return false&&(started>0)});`,"7",[provider])
  expect(flow.nodes.map(node=>node.dependsOn)).toEqual([[],["action/0"]])
  expect(()=>flow.prepare("result",[])).toThrow(/resolved Ref/)
  const result=flow.prepare("result",[{from:"action/0",path:[],value:7}])
  expect(result.operation==="result"&&result.value).toBe(false)
})

test("captured planned computation binds into each static fan-out Action",()=>{
  const flow=compile(`class Work extends Action<(n:number)=>Result<number,never>>{};
    export const Flow=durable((n:{value:number;items:readonly number[]})=>{
      const captured=Work.run(n.value)!;return fanOut(n.items,x=>x,x=>Work.run(x+captured*2));
    });`,'{"value":7,"items":[2,1]}',[provider])
  expect(flow.nodes.length).toBe(4)
  const values=[]
  for(const node of flow.nodes.slice(1,3)) {
    expect(node.dependsOn).toEqual(["action/0"])
    const input=flow.prepare(node.id,[{from:"action/0",path:[],value:7}])
    if(input.operation!=="action")throw new Error("expected Action")
    values.push(input.input)
  }
  expect(values).toEqual([15,16])
})

test("child Flow result computations compose without evaluating the child body",()=>{
  const flow=compile(`class Work extends Action<(n:number)=>Result<number,never>>{};
    const Child=durable((n:number)=>{const first=Work.run(n)!;return first+1});
    export const Flow=durable((n:number)=>{const value=Child.run(n)!;return Work.run(value*2)});`,"7",[provider])
  expect(flow.nodes.map(node=>node.id)).toEqual(["flow/0/action/0","action/1","result"])
  const value=flow.prepare("action/1",[{from:"flow/0/action/0",path:[],value:7}])
  expect(value.operation==="action"&&value.input).toBe(16)
})

for(const [name,edit] of [
  ["unknown operator",(value:any)=>{value.operator="eval"}],
  ["prototype operator",(value:any)=>{value.operator="constructor"}],
  ["missing operand",(value:any)=>{value.operands.pop()}],
  ["extra operand",(value:any)=>{value.operands.push({kind:"slot",index:0})}],
  ["duplicated slot",(value:any)=>{value.operands[1].index=0}],
  ["executable field",(value:any)=>{value.javascript="while(true){}"}],
] as const)test(`even rekeyed computation data refuses ${name}`,()=>{
  const flow=compile(`export const Flow=durable((n:number)=>{return n+1});`,"7")
  const plan=JSON.parse(flow.planJson);edit(plan.nodes[0].material.body.expression)
  const rebuilt=getNativeCompiler().keyedPlan({operation:"compile",inputJson:JSON.stringify(plan)})
  expect(rebuilt.ok).toBe(true)
  expect(()=>new KeyedSourceInterpreter(rebuilt.planJson)).toThrow()
})

for(const source of [
  `export const Flow=durable((n:number)=>{n++;return n});`,
  `function helper(n:number){return n+1} export const Flow=durable((n:number)=>{return helper(n)});`,
  `export const Flow=durable((n:number)=>{return {value:n}+""});`,
])test(`unsupported source remains fail-closed: ${source}`,()=>{
  const result=getNativeCompiler().compileKeyedPlanSource(request(source,source.includes("n:boolean")?"true":"7",source.includes("class Work")?[provider]:[]))
  expect(result.ok).toBe(false)
  expect(result.planJson).toBe("")
})
