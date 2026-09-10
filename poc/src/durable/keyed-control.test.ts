import {expect,test} from "bun:test"
import {KeyedControl,type KeyedControlNode,type KeyedControlTicket} from "./keyed-control.ts"
import {encodeKeyedValue} from "./keyed-value.ts"
import type {KeyedNodeExit} from "./keyed-executor.ts"

// Control-protocol tests, not native branch emission or durable host evidence.
// The complete graph is authored explicitly, independently of the demand walk.
const node=(id:string,dependencies:string[]=[]):KeyedControlNode=>({id,dependencies})
const branch=(id:string,condition:string,whenTrue:string,whenFalse:string,after:string[]=[]):KeyedControlNode=>({
  id,dependencies:[...new Set([condition,whenTrue,whenFalse,...after])],branch:{condition,whenTrue,whenFalse},
})
const success=(value:unknown=0):KeyedNodeExit=>({kind:"success",value:encodeKeyedValue(value)})
const ids=(tickets:readonly KeyedControlTicket[]):string[]=>tickets.map(ticket=>ticket.nodeId)
const status=(control:KeyedControl,id:string)=>control.inspect().nodes.find(node=>node.id===id)!
const basic=()=>new KeyedControl([node("condition"),node("yes"),node("no"),branch("select","condition","yes","no")],"select")
function claimOne(control:KeyedControl,id:string):KeyedControlTicket {
  const tickets=control.claim(1);expect(ids(tickets)).toEqual([id]);return tickets[0]
}

for(const choice of [true,false])test(`a ${choice} condition demands only its selected arm`,()=>{
  const control=basic(),condition=claimOne(control,"condition")
  expect(control.claim(10)).toEqual([])
  expect(status(control,"yes").status).toBe("dormant")
  expect(status(control,"no").status).toBe("dormant")
  control.complete(condition,success(choice))
  const selected=choice?"yes":"no",omitted=choice?"no":"yes"
  control.complete(claimOne(control,selected),success(42))
  const join=claimOne(control,"select")
  expect(join.dependencies).toEqual(["condition",selected])
  expect(status(control,omitted).status).toBe("dormant")
  control.complete(join,success(42))
  expect(control.inspect().terminal).toBe(true)
  expect(status(control,omitted).status).toBe("skipped")
  expect(status(control,"select").selected).toBe(selected)
  expect(control.inspect().cancel).toEqual([])
  expect(control.claim(10)).toEqual([])
})

test("independent nodes become ready together and claims apply backpressure",()=>{
  const control=new KeyedControl([node("b"),node("a"),node("root",["a","b"])],"root")
  const b=claimOne(control,"b"),a=claimOne(control,"a")
  expect(control.claim(10)).toEqual([])
  control.complete(a,success());expect(control.claim(10)).toEqual([])
  control.complete(b,success())
  control.complete(claimOne(control,"root"),success())
  expect(control.inspect().nodes.map(node=>node.status)).toEqual(["success","success","success"])
})

test("a diamond owns its shared work once and opens unrelated dependents immediately",()=>{
  const control=new KeyedControl([node("shared"),node("slow"),node("left",["shared"]),node("right",["shared","slow"]),node("root",["left","right"])],"root")
  const [shared,slow]=control.claim(10)
  expect(ids([shared,slow])).toEqual(["shared","slow"])
  control.complete(shared,success())
  control.complete(claimOne(control,"left"),success())
  expect(control.claim(10)).toEqual([])
  control.complete(slow,success());control.complete(claimOne(control,"right"),success())
  control.complete(claimOne(control,"root"),success())
  expect(control.inspect().nodes.every(node=>node.status==="success")).toBe(true)
})

test("branch ordering prerequisites gate every descendant of its chosen arm",()=>{
  const control=new KeyedControl([node("condition"),node("barrier"),node("leaf"),node("yes",["leaf"]),node("no"),
    branch("root","condition","yes","no",["barrier"])],"root")
  const [condition,barrier]=control.claim(10)
  expect(ids([condition,barrier])).toEqual(["condition","barrier"])
  control.complete(condition,success(true))
  expect(control.claim(10)).toEqual([])
  expect(status(control,"leaf").status).toBe("dormant")
  control.complete(barrier,success())
  control.complete(claimOne(control,"leaf"),success())
  control.complete(claimOne(control,"yes"),success())
  const root=claimOne(control,"root")
  expect(root.dependencies).toEqual(["condition","barrier","yes"])
  control.complete(root,success())
  expect(status(control,"no").status).toBe("skipped")
})

for(const outer of [true,false])for(const inner of [true,false])test(`nested selection ${outer}/${inner} has distinct subjects`,()=>{
  const control=new KeyedControl([node("outer"),node("inner"),node("inner-yes"),node("inner-no"),
    branch("nested","inner","inner-yes","inner-no"),node("outer-no"),branch("root","outer","nested","outer-no")],"root")
  control.complete(claimOne(control,"outer"),success(outer))
  if(outer) {
    control.complete(claimOne(control,"inner"),success(inner))
    control.complete(claimOne(control,inner?"inner-yes":"inner-no"),success())
    control.complete(claimOne(control,"nested"),success())
  } else control.complete(claimOne(control,"outer-no"),success())
  control.complete(claimOne(control,"root"),success())
  expect(status(control,"inner").status).toBe(outer?"success":"skipped")
  expect(status(control,"inner-yes").status).toBe(outer&&inner?"success":"skipped")
  expect(status(control,"inner-no").status).toBe(outer&&!inner?"success":"skipped")
})

test("a shared node demanded outside the untaken arm still executes once",()=>{
  const control=new KeyedControl([node("condition"),node("shared"),node("yes"),node("no",["shared"]),
    branch("select","condition","yes","no"),node("root",["select","shared"])],"root")
  const [condition,shared]=control.claim(10)
  expect(ids([condition,shared])).toEqual(["condition","shared"])
  control.complete(shared,success());control.complete(condition,success(true))
  control.complete(claimOne(control,"yes"),success());control.complete(claimOne(control,"select"),success())
  control.complete(claimOne(control,"root"),success())
  expect(status(control,"shared").status).toBe("success")
  expect(status(control,"no").status).toBe("skipped")
})

test("two branches can select the same running arm without starting it twice",()=>{
  const control=new KeyedControl([node("a"),node("b"),node("shared"),node("left-no"),node("right-no"),
    branch("left","a","shared","left-no"),branch("right","b","shared","right-no"),node("root",["left","right"])],"root")
  const [a,b]=control.claim(10)
  control.complete(a,success(true));const shared=claimOne(control,"shared")
  control.complete(b,success(true));expect(control.claim(10)).toEqual([])
  control.complete(shared,success());const joins=control.claim(10)
  expect(ids(joins)).toEqual(["left","right"])
  for(const join of joins)control.complete(join,success())
  control.complete(claimOne(control,"root"),success())
  expect(status(control,"shared").status).toBe("success")
})

test("identical branch arms and a condition reused as a value are legal dependencies",()=>{
  const control=new KeyedControl([node("condition"),branch("root","condition","condition","condition")],"root")
  control.complete(claimOne(control,"condition"),success(false))
  const join=claimOne(control,"root");expect(join.dependencies).toEqual(["condition"])
  control.complete(join,success(false));expect(control.inspect().terminal).toBe(true)
})

for(const exit of [
  {kind:"failure",error:encodeKeyedValue({failure:"typed"})},
  {kind:"defect",defect:{name:"Defect",message:"broken",stack:"trace"}},
  {kind:"interrupted"},
] as const)test(`a ${exit.kind} condition selects no arm and preserves its exit category`,()=>{
  const control=basic()
  control.complete(claimOne(control,"condition"),exit)
  expect(control.inspect().terminal).toBe(true)
  expect(status(control,"condition").status).toBe(exit.kind)
  expect(status(control,"select")).toEqual({id:"select",status:"blocked",blockedBy:"condition"})
  expect(status(control,"yes").status).toBe("skipped")
  expect(status(control,"no").status).toBe("skipped")
  expect(control.claim(10)).toEqual([])
})

test("a selected arm's failure never recovers by executing the other arm",()=>{
  const control=basic();control.complete(claimOne(control,"condition"),success(false))
  control.complete(claimOne(control,"no"),{kind:"failure",error:encodeKeyedValue("typed failure")})
  expect(control.inspect().terminal).toBe(true)
  expect(status(control,"select").blockedBy).toBe("no")
  expect(status(control,"yes").status).toBe("skipped")
})

for(const value of [null,0,1,"true",[],{}, {kind:"boolean",value:true}])test(`nonboolean branch subject ${JSON.stringify(value)} is a control defect`,()=>{
  const control=basic();control.complete(claimOne(control,"condition"),success(value))
  expect(status(control,"select")).toEqual({id:"select",status:"defect",invalidCondition:true})
  expect(control.claim(10)).toEqual([])
  expect(status(control,"yes").status).toBe("skipped")
  expect(status(control,"no").status).toBe("skipped")
})

test("root failure invalidates active siblings and reports them for host interruption",()=>{
  const control=new KeyedControl([node("bad"),node("running"),node("waiting",["running"]),node("root",["bad","waiting"])],"root")
  const [bad,running]=control.claim(10)
  control.complete(bad,{kind:"failure",error:encodeKeyedValue("no")})
  expect(control.inspect().cancel).toEqual(["running"])
  expect(status(control,"running").status).toBe("cancelled")
  expect(status(control,"waiting").status).toBe("cancelled")
  expect(()=>control.complete(running,success())).toThrow(/consumed or cancelled/)
  expect(control.claim(10)).toEqual([])
})

test("root termination preserves the full demanded failure cone before cancelling independent work",()=>{
  const control=new KeyedControl([node("bad"),node("running"),node("child",["bad"]),node("grandchild",["child"]),
    node("root",["bad","running","grandchild"])],"root")
  const [bad]=control.claim(10)
  control.complete(bad,{kind:"failure",error:encodeKeyedValue("no")})
  expect(status(control,"root")).toMatchObject({status:"blocked",blockedBy:"bad"})
  expect(status(control,"child")).toMatchObject({status:"blocked",blockedBy:"bad"})
  expect(status(control,"grandchild")).toMatchObject({status:"blocked",blockedBy:"child"})
  expect(status(control,"running").status).toBe("cancelled")
  expect(control.inspect().cancel).toEqual(["running"])
})

test("cancellation before dispatch creates no attempt or ready reservation",()=>{
  const control=basic();control.cancel();control.cancel()
  expect(control.inspect().terminal).toBe(true)
  expect(control.inspect().cancel).toEqual([])
  expect(control.claim(10)).toEqual([])
  expect(status(control,"condition").status).toBe("cancelled")
  expect(status(control,"yes").status).toBe("skipped")
})

test("cancellation after reservation closes its one-shot completion channel",()=>{
  const control=basic(),ticket=claimOne(control,"condition")
  control.cancel()
  expect(control.inspect().cancel).toEqual(["condition"])
  expect(()=>control.complete(ticket,success(true))).toThrow(/consumed or cancelled/)
  control.cancel();expect(control.inspect().cancel).toEqual(["condition"])
})

test("completed control cannot be retroactively relabeled cancelled",()=>{
  const control=new KeyedControl([node("root")],"root")
  control.complete(claimOne(control,"root"),success(42));const before=control.inspect()
  control.cancel();expect(control.inspect()).toEqual(before)
})

test("completion tokens reject copies, prototypes, proxies, replays and foreign owners",()=>{
  const control=basic(),foreign=basic(),ticket=claimOne(control,"condition")
  let traps=0
  for(const fake of [{...ticket},Object.create(ticket),new Proxy(ticket,{get(){traps++;throw new Error("trap")}}),null,0]) {
    expect(()=>control.complete(fake as KeyedControlTicket,success(true))).toThrow(/foreign, consumed or cancelled/)
  }
  expect(()=>foreign.complete(ticket,success(true))).toThrow(/foreign, consumed or cancelled/)
  expect(traps).toBe(0)
  control.complete(ticket,success(true))
  expect(()=>control.complete(ticket,success(true))).toThrow(/foreign, consumed or cancelled/)
})

for(const outcome of [
  {},{kind:"success"},{kind:"success",value:1,approved:true},{kind:"failure",value:"wrong"},
  {kind:"failure",error:{kind:"object",items:{x:1},order:[]}},
  {kind:"defect",defect:{name:"Bad",message:"bad",extra:true}},
  {kind:"defect",defect:{name:"Bad",message:"bad",stack:3}},
  {kind:"interrupted",value:null},{kind:"cancelled"},
])test(`malformed completion does not consume a valid reservation: ${JSON.stringify(outcome)}`,()=>{
  const control=basic(),ticket=claimOne(control,"condition")
  expect(()=>control.complete(ticket,outcome as KeyedNodeExit)).toThrow()
  expect(status(control,"condition").status).toBe("running")
  control.complete(ticket,success(true));expect(ids(control.claim(10))).toEqual(["yes"])
})

test("graph and completion snapshots never invoke accessors or proxy traps",()=>{
  let effects=0
  const getter={get id(){effects++;return "root"},dependencies:[]}
  expect(()=>new KeyedControl([getter],"root")).toThrow()
  expect(()=>new KeyedControl(new Proxy([],{get(){effects++;throw new Error("trap")}}),"root")).toThrow()
  const control=basic(),ticket=claimOne(control,"condition")
  const completion={kind:"success",get value(){effects++;return true}}
  expect(()=>control.complete(ticket,completion as KeyedNodeExit)).toThrow()
  expect(effects).toBe(0)
  control.complete(ticket,success(false));expect(ids(control.claim(10))).toEqual(["no"])
})

test("later caller mutation cannot replace the graph or its chosen arm",()=>{
  const yes=node("yes"),selection=branch("root","condition","yes","no")
  const nodes=[node("condition"),yes,node("no"),selection]
  const control=new KeyedControl(nodes,"root")
  ;(selection.branch as {whenTrue:string}).whenTrue="no"
  ;(yes.dependencies as string[]).push("root")
  nodes.length=0
  control.complete(claimOne(control,"condition"),success(true))
  expect(ids(control.claim(10))).toEqual(["yes"])
})

test("tickets and inspection snapshots are immutable and independent",()=>{
  const control=basic(),ticket=claimOne(control,"condition"),before=control.inspect()
  expect(Object.isFrozen(ticket)).toBe(true)
  expect(Object.isFrozen(ticket.dependencies)).toBe(true)
  expect(Object.isFrozen(before.nodes[0])).toBe(true)
  control.complete(ticket,success(true))
  expect(before.nodes.find(node=>node.id==="condition")!.status).toBe("running")
  expect(status(control,"condition").status).toBe("success")
})

for(const [label,nodes,root] of [
  ["empty",[],"root"],
  ["missing root",[node("a")],"root"],
  ["duplicate node",[node("root"),node("root")],"root"],
  ["missing dependency",[node("root",["absent"])],"root"],
  ["duplicate dependency",[node("a"),node("root",["a","a"])],"root"],
  ["orphan",[node("a"),node("root")],"root"],
  ["self cycle",[node("root",["root"])],"root"],
  ["cycle in dormant arm",[node("condition"),node("yes"),node("no",["no"]),branch("root","condition","yes","no")],"root"],
  ["missing branch declaration",[node("condition"),node("yes"),node("no"),{...branch("root","condition","yes","no"),dependencies:["condition","yes"]}],"root"],
  ["executable selection",[node("root",[]),{id:"orphan",dependencies:[],branch:()=>true}],"root"],
  ["unknown node field",[{...node("root"),approved:true}],"root"],
  ["unknown branch field",[node("condition"),node("yes"),node("no"),{...branch("root","condition","yes","no"),branch:{condition:"condition",whenTrue:"yes",whenFalse:"no",predicate:"code"}}],"root"],
  ["empty id",[node("")],""],
  ["NUL id",[node("root\0")],"root\0"],
] as const)test(`invalid complete control graph refuses before demand: ${label}`,()=>{
  expect(()=>new KeyedControl(nodes as readonly KeyedControlNode[],root)).toThrow()
})

for(const limit of [0,-1,0.5,NaN,Infinity,10001])test(`invalid claim limit ${limit} cannot create a reservation`,()=>{
  const control=basic();expect(()=>control.claim(limit)).toThrow(/claim limit/)
  expect(ids(control.claim(1))).toEqual(["condition"])
})

test("prototype-like addresses remain ordinary identities",()=>{
  const control=new KeyedControl([node("__proto__"),node("constructor"),branch("toString","__proto__","constructor","constructor")],"toString")
  control.complete(claimOne(control,"__proto__"),success(true))
  control.complete(claimOne(control,"constructor"),success())
  control.complete(claimOne(control,"toString"),success())
  expect(control.inspect().terminal).toBe(true)
})

test("a 10000-node chain validates and drains without recursive stack growth",()=>{
  const count=10000,nodes=Array.from({length:count},(_,index)=>node(String(index),index===0?[]:[String(index-1)]))
  const control=new KeyedControl(nodes,String(count-1))
  for(let index=0;index<count;index++) {
    const tickets=control.claim();if(tickets.length!==1||tickets[0].nodeId!==String(index))throw new Error("chain order changed")
    control.complete(tickets[0],success(index))
  }
  expect(control.inspect().nodes.every(node=>node.status==="success")).toBe(true)
})

test("an oversized graph is refused without a partial demand result",()=>{
  expect(()=>new KeyedControl(Array.from({length:10001},(_,index)=>node(String(index))),"0")).toThrow()
})
