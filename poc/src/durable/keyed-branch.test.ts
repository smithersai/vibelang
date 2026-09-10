import {expect,test} from "bun:test"
import {getNativeCompiler} from "../compiler/native.ts"
import {KeyedSourceInterpreter,type KeyedResolvedInput} from "./keyed-interpreter.ts"
import {decodeKeyedValue,type KeyedValue} from "./keyed-value.ts"

const header='import {Action,durable,fanOut,sequential} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};'
const provider={actionId:"flow.vibe#Work",implementationId:"work/v1",implementationDigest:"a".repeat(64),tier:"sealed",
  effects:{boundaryMode:"hard",reads:[],writes:[]},layers:[],capabilities:[]}
function compile(source:string,inputJson="1",providers:unknown[]=[provider]) {
  const result=getNativeCompiler().compileKeyedPlanSource({source,fileName:"flow.vibe",flowId:"branch/Flow",flowVersion:1,planId:"branch/plan",inputJson,providersJson:JSON.stringify(providers)})
  if(!result.ok)throw new Error(JSON.stringify(result.diagnostics))
  return new KeyedSourceInterpreter(result.planJson)
}
function references(node:any,dependencies:readonly string[],answers:Map<string,KeyedValue>):KeyedResolvedInput[] {
  return node.material.inputs.filter((input:any)=>input._tag==="Ref"&&dependencies.includes(input.from)).map((input:any)=>{
    expect(answers.has(input.from)).toBe(true)
    let value:any=answers.get(input.from)
    for(const key of input.path){expect(Object.hasOwn(value,key)).toBe(true);value=value[key]}
    return {from:input.from,path:input.path,value}
  })
}

// Native data + control interpretation with explicit test answers. Separate
// authenticated-worker tests exercise real providers; this is not a journal.
function drive(interpreter:KeyedSourceInterpreter,answer=(input:number,_actionId:string):unknown=>input+1) {
  const plan=JSON.parse(interpreter.planJson),control=interpreter.createControl(),answers=new Map<string,KeyedValue>(),calls:number[]=[]
  for(let round=0;!control.inspect().terminal;round++){
    if(round>plan.nodes.length)throw new Error("branch graph did not settle")
    const ready=control.claim(10000);expect(ready.length).toBeGreaterThan(0)
    for(const ticket of ready){
      const node=plan.nodes.find((node:any)=>node.id===ticket.nodeId)
      const prepared=interpreter.prepareSelected(ticket.nodeId,references(node,ticket.dependencies,answers),ticket.dependencies)
      let value:KeyedValue
      if(prepared.operation==="action"){
        expect(typeof prepared.input).toBe("number")
        calls.push(prepared.input as number);value=interpreter.encodeSuccess(ticket.nodeId,answer(prepared.input as number,prepared.contract.id))
      }else value=prepared.value
      answers.set(ticket.nodeId,value);control.complete(ticket,{kind:"success",value})
    }
  }
  return {value:decodeKeyedValue(answers.get("result")),calls,control,answers,plan}
}

for(const [body,nullable] of [
  ["const value=Work.run(n)!;if(value===null)return 0;return value+1",false],
  ["const value=Work.run(n)!;if(value!==null)return value+1;return 0",false],
  ["const value=Work.run(n)!;return value===null?0:value+1",false],
  ["const value=Work.run(n)!;const copy=value;if(copy===null)return 0;return copy+1",false],
  ["const value:number|null=Work.run(n)!;if(value===null)return value;return value+1",true],
  ["if(const value=Work.run(n)!;value===null){return 0}else{return value+1}",false],
  ["const value=Work.run(n)!;if(n>0){if(value===null)return 0;return value+1}return 0",false],
  ["const value=Work.run(n)!;if(value!==null)return Work.run(value);return 0",false],
] as const)for(const answer of [null,2])test(`nullable Action success ${body} on ${answer}`,()=>{
  const source='import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number|null,never>>{};'+
    `export const Flow=durable((n:number)=>{${body}})`
  const result=drive(compile(source),input=>input===1?answer:input+1)
  expect(result.value).toBe(answer===null?(nullable?null:0):3)
  expect(result.calls).toEqual(body.includes("Work.run(value)")&&answer!==null?[1,2]:[1])
})

for(const [answer,expected] of [[null,0],[{kind:"a",x:41},42],[{kind:"b",y:42},43]] as const)test(`nullable discriminated Action success ${JSON.stringify(answer)}`,()=>{
  const source='import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<{kind:"a";x:number}|{kind:"b";y:number}|null,never>>{};'+
    'export const Flow=durable((n:number)=>{const value=Work.run(n)!;if(value===null)return 0;if(value.kind==="a")return value.x+1;return value.y+1})'
  const result=drive(compile(source),()=>answer)
  expect(result.value).toBe(expected);expect(result.calls).toEqual([1])
})

for(const [body,expected] of [
  ['const Child=durable((n:number)=>{return Work.run(n)});export const Flow=durable((n:number)=>{const value=Child.run(n)!;if(value===null)return 0;return value+1})',3],
  ['const Child=durable((n:number)=>{const value=Work.run(n)!;if(value===null)return 0;return value+1});export const Flow=durable((n:number)=>{return Child.run(n)})',3],
  ['const Child=durable((n:number)=>{const value=Work.run(n)!;if(value===null)return 0;return value+1});export const Flow=durable((n:number)=>{return fanOut([1,2],v=>v,v=>Child.run(v))})',[3,3]],
] as const)for(const answer of [null,2])test(`nullable source composition ${body} on ${answer}`,()=>{
  const source='import {Action,durable,fanOut} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number|null,never>>{};'+body
  const result=drive(compile(source),()=>answer)
  expect(result.value).toEqual(typeof expected==="number"?(answer===null?0:expected):(answer===null?[0,0]:[...expected]))
})

for(const body of [
  "const value=Work.run(n)!;return value+1",
  "const value=Work.run(n)!;if(value===null)return value+1;return 0",
  "const value=Work.run(n)!;if(value!==null){Work.run(value)!}return value+1",
  "const value=Work.run(n)!;if(value!==null){const value=Work.run(n)!;return value+1}return 0",
  "const value=Work.run(n)!;return (value as number)+1",
])test(`nullable Action guard cannot authorize an unsafe path: ${body}`,()=>{
  const source='import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number|null,never>>{};'+
    `export const Flow=durable((n:number)=>{${body}})`
  expect(()=>compile(source)).toThrow()
})

for(const [body,input,expected,calls] of [
  ["if(n>0)return Work.run(n);return Work.run(-n)","1",2,[1]],
  ["if(n>0)return Work.run(n);return Work.run(-n)","-2",3,[2]],
  ["if(n>0){return Work.run(n)!}else{return Work.run(-n)!}","-2",3,[2]],
  ["if(n>0){Work.run(1)!}else{Work.run(2)!}return Work.run(n)","3",4,[1,3]],
  ["if(n>0){Work.run(1)!}else{Work.run(2)!}return Work.run(n)","-3",-2,[-3,2]],
  ["if(n>0)Work.run(1)!;return Work.run(n)","-3",-2,[-3]],
  ["if(n>0)return 1;else if(n<0)return 2;else return 3","0",3,[]],
  ["if(n>0)return 1;else if(n<0)return 2;else return 3","-1",2,[]],
  ["if(n>0)return 1;else if(n<0)return 2;else return 3","1",1,[]],
  ["const value=n;if(n>0){const value=Work.run(n)!;if(value>0)return value}return Work.run(value)","2",3,[2]],
  ["const value=n;if(n>0){const value=Work.run(n)!;if(value>0)return value}return Work.run(value)","-2",-1,[-2]],
  ["if(const value=Work.run(n)!;value>0){return value}else{return Work.run(n)}","1",2,[1]],
  ["if(const value=Work.run(n)!;value>0){return value}else{return Work.run(n)}","-2",-1,[-2,-2]],
  ["const value=n;if(const value=Work.run(n)!;value>0){Work.run(value)!}else{Work.run(2)!}return value","1",1,[1,2]],
  ["const value=n;{const value=Work.run(1)!;Work.run(value)!}return Work.run(value)","9",10,[1,2,9]],
  ["Work.run(n)!;return n","1",1,[1]],
  ["if(n>0)return n;{const value=Work.run(n)!;return value}","-2",-1,[-2]],
  ["if(n>0)return n;{const value=Work.run(n)!;return value}","2",2,[]],
  ["if(n>0){}else{}return n","1",1,[]],
  ["if(n>0){if(n>1)return 1}else{if(n<0)return 2}return Work.run(n)","2",1,[]],
  ["if(n>0){if(n>1)return 1}else{if(n<0)return 2}return Work.run(n)","1",2,[1]],
  ["if(n>0){if(n>1)return 1}else{if(n<0)return 2}return Work.run(n)","-1",2,[]],
  ["if(n>0){if(n>1)return 1}else{if(n<0)return 2}return Work.run(n)","0",1,[0]],
  ["if(n>0){const value=Work.run(n)!;return value>0?Work.run(value)!:0}return 0","1",3,[1,2]],
  ["if(n>0){const value=Work.run(n)!;return value>0&&Work.run(value+1)!}return 0","1",4,[1,3]],
  ["if(n>0){const value=Work.run(n)!;if(n>1){if(n>2)return Work.run(value+1)!}return value}return 0","3",6,[3,5]],
] as const)test(`statement Flow ${body} on ${input}`,()=>{
  const result=drive(compile(header+`export const Flow=durable((n:number)=>{${body}})`,input,body.includes("Work.run")?[provider]:[]))
  expect(result.value).toEqual(expected)
  // Independent ready work is allowed to settle in either order.
  expect([...result.calls].sort((a,b)=>a-b)).toEqual([...calls].sort((a,b)=>a-b))
})

for(const [type,input,expected] of [
  ["number","0",3],["number","1",2],["number","-1",2],
  ["string",'""',3],["string",'"kept"',2],
  ["boolean","false",3],["boolean","true",2],
  ["{value:number}|null","null",3],["{value:number}|null",'{"value":0}',2],
] as const)test(`statement truthiness ${type} on ${input}`,()=>{
  const result=drive(compile(header+`export const Flow=durable((n:${type})=>{if(n)return Work.run(1);return Work.run(2)})`,input))
  expect(result.value).toBe(expected);expect(result.calls).toEqual([expected-1])
})

for(const [type,body,input,expected,calls] of [
  ["number|null","if(n===null)return 0;return Work.run(n)","null",0,[]],
  ["number|null","if(n===null)return 0;return Work.run(n)","2",3,[2]],
  ["number|null","if(n!==null){return Work.run(n)}return 0","null",0,[]],
  ["number|null","if(n!==null){return Work.run(n)}return 0","2",3,[2]],
  ['{kind:"a";x:number}|{kind:"b";y:number}', 'if(n.kind==="a")return Work.run(n.x);return Work.run(n.y)', '{"kind":"a","x":2}',3,[2]],
  ['{kind:"a";x:number}|{kind:"b";y:number}', 'if(n.kind==="a")return Work.run(n.x);return Work.run(n.y)', '{"kind":"b","y":3}',4,[3]],
] as const)test(`statement narrowing ${body} on ${input}`,()=>{
  const result=drive(compile(header+`export const Flow=durable((n:${type})=>{${body}})`,input))
  expect(result.value).toBe(expected);expect(result.calls).toEqual([...calls])
})

test("fallthrough-only statements leave common work independently ready",()=>{
  const interpreter=compile(header+'export const Flow=durable((n:number)=>{if(n>0){Work.run(1)!}else{Work.run(2)!}return Work.run(9)})')
  expect(interpreter.createControl().claim(10000).map(ticket=>ticket.nodeId)).toEqual(["branch/0/condition","action/1"])
  expect(drive(interpreter).value).toBe(10)
})

for(const body of [
  "if(n===null)return Work.run(n);return 0",
  "if(n!==null){Work.run(n)!}return Work.run(n)",
  "if(n!==null)return Work.run(n);return Work.run(n)",
  "if(n===null)return 0;return Work.run(n as number)",
])test(`checked narrowing does not authorize an unsafe path or assertion: ${body}`,()=>{
  expect(()=>compile(header+`export const Flow=durable((n:number|null)=>{${body}})`,"2")).toThrow()
})

for(const [body,input,expected,calls] of [
  ["const value=n;if(value===null)return 0;return Work.run(value)","null",0,[]],
  ["const value=n;if(value===null)return 0;return Work.run(value)","2",3,[2]],
  ["if(n===null)return 0;return Work.run(n+1)","2",4,[3]],
  ["return n!==null?Work.run(n):Work.run(0)","null",1,[0]],
  ["return n!==null?Work.run(n):Work.run(0)","2",3,[2]],
] as const)test(`native narrowing composes with aliases and expressions: ${body} on ${input}`,()=>{
  const result=drive(compile(header+`export const Flow=durable((n:number|null)=>{${body}})`,input))
  expect(result.value).toBe(expected);expect(result.calls).toEqual([...calls])
})

test("statement continuations preserve explicit ordering after an early return",()=>{
  const source=header+'export const Flow=durable((n:number)=>{if(n>0){sequential(Work.run(1),Work.run(2));if(n>1)return 9}return Work.run(3)})'
  const selected=drive(compile(source,"1"))
  expect(selected.value).toBe(4);expect(selected.calls).toEqual([1,2,3])
  const returned=drive(compile(source,"2"))
  expect(returned.value).toBe(9);expect(returned.calls).toEqual([1,2])
  const unselected=drive(compile(source,"0"))
  expect(unselected.value).toBe(4);expect(unselected.calls).toEqual([3])
})

test("fallthrough preserves an explicit branch-local ordering barrier",()=>{
  const source=header+'export const Flow=durable((n:number)=>{if(n>0){sequential(Work.run(1),Work.run(2))}return Work.run(3)})'
  const interpreter=compile(source,"1")
  expect(interpreter.createControl().claim(10000).map(ticket=>ticket.nodeId)).toEqual(["branch/0/condition"])
  expect(drive(interpreter).calls).toEqual([1,2,3])
  const unselected=drive(compile(source,"0"))
  expect(unselected.calls).toEqual([3]);expect(unselected.value).toBe(4)
})

test("statement child Flows preserve per-item demand and early returns",()=>{
  const source=header+'const Child=durable((n:number)=>{if(n>0)return Work.run(n);return 0});export const Flow=durable((n:number)=>{return fanOut([2,-1,0],v=>v,v=>Child.run(v))})'
  const result=drive(compile(source));expect(result.value).toEqual([3,0,0]);expect(result.calls).toEqual([2])
})

for(const body of ["Child.run(n);return 0","const lost=Child.run(n);return 0","if(n>0){Child.run(n)}return 0"])
test(`statement Flow calls cannot discard an unconsumed Result: ${body}`,()=>{
  const source=header+`const Child=durable((n:number)=>{return Work.run(n)});export const Flow=durable((n:number)=>{${body}})`
  expect(()=>compile(source)).toThrow(/4115|1302|1301|consum|postfix/)
})

for(const body of ["Child.run(n)!;return 0","return Child.run(n)","return sequential(Child.run(n),Work.run(n))"])
test(`statement Flow calls retain owned consumption: ${body}`,()=>{
  const source=header+`const Child=durable((n:number)=>{return Work.run(n)});export const Flow=durable((n:number)=>{${body}})`
  const result=drive(compile(source));expect(result.calls).toEqual(body.includes("sequential")?[1,1]:[1])
})

for(const [expression,type,input,expected,calls] of [
  ["n&&Work.run(2)!","boolean","false",false,[]],
  ["n&&Work.run(2)!","boolean","true",3,[2]],
  ["n||Work.run(2)!","boolean","true",true,[]],
  ["n||Work.run(2)!","boolean","false",3,[2]],
  ["n??Work.run(2)!","number|null","null",3,[2]],
  ["n??Work.run(2)!","number|null","0",0,[]],
  ["n??Work.run(2)!","number|null","9",9,[]],
  ["n&&Work.run(2)!","number","0",0,[]],
  ["n&&Work.run(2)!","number","7",3,[2]],
  ["n||Work.run(2)!","number","0",3,[2]],
  ["n||Work.run(2)!","number","7",7,[]],
  ["n&&Work.run(2)!","string",'""',"",[]],
  ["n||Work.run(2)!","string",'"kept"',"kept",[]],
  ["n??Work.run(2)!","string|null",'""',"",[]],
  ["Work.run(n)!&&Work.run(2)!","number","-1",0,[-1]],
  ["Work.run(n)!&&Work.run(2)!","number","0",3,[0,2]],
  ["Work.run(n)!||Work.run(2)!","number","-1",3,[-1,2]],
  ["Work.run(n)!||Work.run(2)!","number","0",1,[0]],
  ["(n*-1)||Work.run(2)!","number","0",3,[2]],
  ["(n/(n-n))||Work.run(2)!","number","0",3,[2]],
  ["(n/(n-n))&&Work.run(2)!","number","1",3,[2]],
  ["(n>0&&Work.run(2)!)||Work.run(3)!","number","-1",4,[3]],
  ["(n>0&&Work.run(2)!)||Work.run(3)!","number","1",3,[2]],
  ["n&&Work.run(2)","boolean","true",3,[2]],
] as const)test(`conditional work ${expression} on ${input}`,()=>{
  const interpreter=compile(header+`export const Flow=durable((n:${type})=>{return ${expression}})`,input)
  expect(interpreter.nodes.some(node=>node.operation==="branch")).toBe(true)
  const result=drive(interpreter)
  expect(result.value).toEqual(expected);expect(result.calls).toEqual([...calls])
})

for(const operator of ["||","??"])test(`a retained object operand of ${operator} keeps its original order`,()=>{
  const interpreter=compile(header+`export const Flow=durable((n:{z:number;a:number}|null)=>{return n${operator}Work.run(2)!})`,'{"z":1,"a":2}')
  const result=drive(interpreter)
  expect(JSON.stringify(result.value)).toBe('{"z":1,"a":2}');expect(result.calls).toEqual([])
})

test("an immutable logical-success binding does not recreate a consumed Result",()=>{
  const interpreter=compile(header+'export const Flow=durable((n:number)=>{const chosen=n>0&&Work.run(2)!;return chosen})')
  expect(drive(interpreter).value).toBe(3)
})

test("a logical choice cannot erase an unconsumed Result",()=>{
  expect(()=>compile(header+'export const Flow=durable((n:number)=>{const lost=n>0&&Work.run(2);return 0})')).toThrow(/1302|never consumed|must be consumed/)
})

test("logical work retains independent readiness after the expression",()=>{
  const interpreter=compile(header+'export const Flow=durable((n:number)=>{const chosen=n>0&&Work.run(2)!;const other=Work.run(9)!;return {chosen,other}})')
  expect(interpreter.createControl().claim(10000).map(ticket=>ticket.nodeId)).toEqual(["branch/0/condition","action/1"])
  expect(drive(interpreter).value).toEqual({chosen:3,other:10})
})

for(const [operator,input,expected,calls] of [
  ["&&","1",3,[2]],["&&","0",0,[]],
  ["||","1",1,[]],["||","0",3,[2]],
  ["??","null",3,[2]],["??","0",0,[]],
] as const)test(`source child ${operator} keeps enclosing argument ${input}`,()=>{
  const source=header+`const Child=durable((n:number|null)=>{return n${operator}Work.run(2)!});export const Flow=durable((n:number|null)=>{return Child.run(n)!})`
  const result=drive(compile(source,input))
  expect(result.value).toBe(expected);expect(result.calls).toEqual([...calls])
})

test("fan-out source children retain per-item short-circuit demand",()=>{
  const source=header+'const Child=durable((n:number)=>{return n>0&&Work.run(n)!});export const Flow=durable((n:number)=>{return fanOut([2,-1,0],v=>v,v=>Child.run(v))})'
  const result=drive(compile(source))
  expect(result.value).toEqual([3,false,false]);expect(result.calls).toEqual([2])
})

test("a short-circuited fan-out does not open its provider nodes",()=>{
  const source=header+'export const Flow=durable((n:number)=>{return n>0&&fanOut([1,2],v=>v,v=>Work.run(v))})'
  expect(drive(compile(source,"-1")).calls).toEqual([])
  const result=drive(compile(source,"1"))
  expect(result.value).toEqual([2,3]);expect(result.calls).toEqual([1,2])
})

test("explicit sequencing survives an untaken logical child",()=>{
  const source=header+'const Child=durable((n:number)=>{return n>0&&Work.run(10)!});export const Flow=durable((n:number)=>{const pair=sequential(Work.run(n),Child.run(n));const last=Work.run(30)!;return {pair,last}})'
  const interpreter=compile(source,"-1")
  expect(interpreter.createControl().claim(10000).map(ticket=>ticket.nodeId)).toEqual(["action/0"])
  const result=drive(interpreter)
  expect(result.value).toEqual({pair:[0,false],last:31});expect(result.calls).toEqual([-1,30])
})

for(const [type,body,input,expected] of [
  ["boolean","return n&&Work.run(2)!","false",false],
  ["boolean","return n&&Work.run(2)!","true",3],
  ["number|null","return n??Work.run(2)!","null",3],
] as const)test(`logical descriptors preserve a precise Result annotation: ${body} on ${input}`,()=>{
  const success=type==="boolean"?"false|number":"number"
  const result=drive(compile(header+`export const Flow=durable((n:${type}):Result<${success},never>=>{${body}})`,input))
  expect(result.value).toBe(expected)
})

test("an untaken logical provider remains part of the publication contract",()=>{
  expect(()=>compile(header+'export const Flow=durable((n:number)=>{return n<0&&Work.run(n)!})',"1",[])).toThrow(/provider|implementation/)
})

for(const body of ["return n>0&&Work.run(n)!","return n<0||Work.run(n)!"])
test(`logical work cannot erase its failure row: ${body}`,()=>{
  const source='import {Action,durable} from "vibelang:flows";class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};'
    +`export const Flow=durable((n:number):Result<number|boolean,never>=>{${body}})`
  expect(()=>compile(source)).toThrow(/failure|1101|2322/)
})

test("logical cross-arm filesystem ordering cannot open an untaken provider",()=>{
  const source=header+'export const Flow=durable((n:number)=>{const chosen=n>0&&Work.run(n)!;return Work.run(3)})'
  expect(()=>compile(source,"-1",[{...provider,effects:{boundaryMode:"hard",reads:[],writes:["shared"]}}])).toThrow(/conditional arm/)
})

for(const [name,change] of [
  ["unknown operator",(expression:any)=>{expression.operator="eval"}],
  ["missing operand",(expression:any)=>{expression.operands=[]}],
  ["extra operand",(expression:any)=>{expression.operands.push({kind:"literal",value:null})}],
] as const)test(`nullish condition IR refuses ${name}, even after re-keying`,()=>{
  const interpreter=compile(header+'export const Flow=durable((n:number|null)=>{return n??Work.run(2)!})',"null")
  const plan=JSON.parse(interpreter.planJson)
  const condition=plan.nodes.find((node:any)=>node.id==="branch/0/condition")
  expect(condition.material.body.expression.operator).toBe("is-null")
  change(condition.material.body.expression)
  const rebuilt=getNativeCompiler().keyedPlan({operation:"compile",inputJson:JSON.stringify(plan)})
  expect(rebuilt.ok).toBe(true)
  expect(()=>new KeyedSourceInterpreter(rebuilt.planJson)).toThrow()
})

for(const [body,input,expected,calls] of [
  ["return n>0?Work.run(1):Work.run(2)","1",2,[1]],
  ["return n>0?Work.run(1):Work.run(2)","-1",3,[2]],
  ["const selected=n>0?Work.run(1)!:Work.run(2)!;return Work.run(selected)","1",3,[1,2]],
  ["return n>0?(n>1?Work.run(1)!:Work.run(2)!):Work.run(3)!","2",2,[1]],
  ["return n>0?(n>1?Work.run(1)!:Work.run(2)!):Work.run(3)!","1",3,[2]],
  ["return n>0?(n>1?Work.run(1)!:Work.run(2)!):Work.run(3)!","-1",4,[3]],
  ["const shared=Work.run(n)!;return n>0?Work.run(shared+1):Work.run(shared+2)","1",4,[1,3]],
  ["const shared=Work.run(n)!;return n>0?Work.run(shared+1):Work.run(shared+2)","-1",3,[-1,2]],
  ["const chosen=n>0?true:false;return chosen?Work.run(1):Work.run(2)","-1",3,[2]],
] as const)test(`Go-derived branch ${body} on ${input}`,()=>{
  const interpreter=compile(header+`export const Flow=durable((n:number)=>{${body}})`,input)
  expect(interpreter.nodes.some(node=>node.operation==="branch")).toBe(true)
  const driven=drive(interpreter)
  expect(driven.value).toEqual(expected);expect(driven.calls).toEqual([...calls])
  expect(driven.control.inspect().nodes.some(node=>node.status==="skipped")).toBe(true)
})

test("a branch does not serialize a later independent Action",()=>{
  const interpreter=compile(header+'export const Flow=durable((n:number)=>{const chosen=n>0?Work.run(1)!:Work.run(2)!;const other=Work.run(9)!;return {chosen,other}})')
  expect(interpreter.createControl().claim(10000).map(ticket=>ticket.nodeId)).toEqual(["branch/0/condition","action/1"])
  const result=drive(interpreter)
  expect(result.value).toEqual({chosen:2,other:10})
  expect(result.calls.sort((a,b)=>a-b)).toEqual([1,9])
})

for(const input of ["1","-1"])test(`pure branch values preserve object construction order on ${input}`,()=>{
  const interpreter=compile('import {durable} from "vibelang:flows";export const Flow=durable((n:number)=>{return n>0?{z:n,a:n+1}:{a:n,z:n-1}})',input,[])
  const result=drive(interpreter)
  expect(JSON.stringify(result.value)).toBe(input==="1"?'{"z":1,"a":2}':'{"a":-1,"z":-2}')
  expect(result.calls).toEqual([])
})

test("a source child Flow retains its complete branch and enclosing argument",()=>{
  const source=header+'const Child=durable((n:number)=>{return n>0?Work.run(n):Work.run(-n)});export const Flow=durable((n:number)=>{return Child.run(n)})'
  expect(drive(compile(source,"-3")).value).toBe(4)
})

test("static fan-out source children retain per-item branch demand",()=>{
  const source=header+'const Child=durable((n:number)=>{return n>0?Work.run(n):Work.run(-n)});export const Flow=durable((n:number)=>{return fanOut([2,-1],item=>item,item=>Child.run(item))})'
  const result=drive(compile(source))
  expect(result.value).toEqual([3,2]);expect(result.calls.sort((a,b)=>a-b)).toEqual([1,2])
})

for(const input of ["1","-1"])test(`an Action boolean success selects the branch on ${input}`,()=>{
  const source=header+'class Decide extends Action<(n:number)=>Result<boolean,never>>{};export const Flow=durable((n:number)=>{return Decide.run(n)!?Work.run(10):Work.run(20)})'
  const interpreter=compile(source,input,[provider,{...provider,actionId:"flow.vibe#Decide",implementationId:"decide/v1"}])
  const result=drive(interpreter,(value,id)=>id.endsWith("#Decide")?value>0:value+1)
  expect(result.value).toBe(input==="1"?11:21)
  expect(result.calls).toEqual(input==="1"?[1,10]:[-1,20])
})

test("a selected arm completes even when the final output discards its value",()=>{
  const result=drive(compile(header+'export const Flow=durable((n:number)=>{const unused=n>0?Work.run(1)!:Work.run(2)!;return 0})'))
  expect(result.value).toBe(0);expect(result.calls).toEqual([1])
  expect(result.control.inspect().nodes.find(node=>node.id==="branch/0")?.status).toBe("success")
})

test("explicit sequential barriers gate all descendants of a child branch",()=>{
  const interpreter=compile(header+'const Child=durable((n:number)=>{return n>0?Work.run(10):Work.run(20)});export const Flow=durable((n:number)=>{const pair=sequential(Work.run(n),Child.run(n));const last=Work.run(30)!;return {pair,last}})')
  expect(interpreter.createControl().claim(10000).map(ticket=>ticket.nodeId)).toEqual(["action/0"])
  const result=drive(interpreter)
  expect(result.calls).toEqual([1,10,30]);expect(result.value).toEqual({pair:[2,11],last:31})
})

test("branch-local fan-out cannot start in the untaken alternative",()=>{
  const source=header+'export const Flow=durable((n:number)=>{return n>0?fanOut([1,2],v=>v,v=>Work.run(v)):fanOut([3,4],v=>v,v=>Work.run(v))})'
  const result=drive(compile(source,"-1"))
  expect(result.value).toEqual([4,5]);expect(result.calls).toEqual([3,4])
})

test("nonboolean branch subjects refuse before publication",()=>{
  expect(()=>compile(header+'export const Flow=durable((n:number)=>{return n?Work.run(1):Work.run(2)})')).toThrow(/boolean/)
})

test("conditional execution cannot erase an Action failure row",()=>{
  const source='import {Action,durable} from "vibelang:flows";class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};export const Flow=durable((n:number):Result<number,never>=>{return n>0?Work.run(1)!:Work.run(2)!})'
  expect(()=>compile(source)).toThrow(/failure|1101|2322/)
})

test("conflict ordering cannot silently demand an untaken provider",()=>{
  const source=header+'export const Flow=durable((n:number)=>{return n>0?Work.run(1):Work.run(2)})'
  expect(()=>compile(source,"-1",[{...provider,effects:{boundaryMode:"hard",reads:[],writes:["shared"]}}])).toThrow(/conditional arm/)
})

for(const [consumer,dependency] of [["branch/0/else/action/0","branch/0/then/action/0"],["result","branch/0/then/action/0"]])
test(`a re-keyed graph cannot bypass branch demand via ${consumer}`,()=>{
  const source=header+'export const Flow=durable((n:number)=>{return n>0?Work.run(1):Work.run(2)})'
  const plan=JSON.parse(compile(source).planJson)
  plan.nodes.find((node:any)=>node.id===consumer).material.inputs.push({_tag:"Pending",from:dependency})
  const changed=getNativeCompiler().keyedPlan({operation:"compile",inputJson:JSON.stringify(plan)})
  expect(changed.ok).toBe(true)
  expect(()=>new KeyedSourceInterpreter(changed.planJson)).toThrow(/conditional arm/)
})

test("an untaken branch still requires its provider before publication",()=>{
  const source=header+'class Other extends Action<(n:number)=>Result<number,never>>{};export const Flow=durable((n:number)=>{return n>0?Work.run(1):Other.run(2)})'
  expect(()=>compile(source)).toThrow(/provider|implementation/)
})

test("a genuinely unconsumed conditional Result is not erased by the success-choice correction",()=>{
  const source=header+'export const Flow=durable((n:number)=>{const unconsumed=n>0?Work.run(1):Work.run(2);return 0})'
  expect(()=>compile(source)).toThrow(/1302|never consumed/)
})

test("an already-selected branch cannot be prepared by the eager full-input API",()=>{
  const interpreter=compile(header+'export const Flow=durable((n:number)=>{return n>0?Work.run(1):Work.run(2)})')
  const id=interpreter.nodes.find(node=>node.operation==="branch")!.id
  expect(()=>interpreter.prepare(id,[])).toThrow(/selected demand dependencies/)
})

test("selected preparation binds the actual boolean and refuses untaken Ref evidence",()=>{
  const interpreter=compile(header+'export const Flow=durable((n:number)=>{return n>0?Work.run(1):Work.run(2)})')
  const id="branch/0",condition=`${id}/condition`,yes=`${id}/then/result`,no=`${id}/else/result`
  const refs=[{from:condition,path:[],value:true},{from:yes,path:[],value:2}]
  expect(interpreter.prepareSelected(id,refs,[condition,yes])).toMatchObject({operation:"result",value:2})
  expect(()=>interpreter.prepareSelected(id,refs,[condition,yes,no])).toThrow()
  expect(()=>interpreter.prepareSelected(id,[refs[0],{from:no,path:[],value:3}],[condition,no])).toThrow(/actual branch condition/)
  expect(()=>interpreter.prepareSelected(id,[refs[0],{...refs[1],value:"wrong"}],[condition,yes])).toThrow(/durable number/)
  expect(()=>interpreter.prepareSelected(id,refs,[yes])).toThrow(/mandatory dependency/)
  expect(()=>interpreter.prepareSelected(id,refs,[condition,yes,yes])).toThrow(/dependency list/)
})
