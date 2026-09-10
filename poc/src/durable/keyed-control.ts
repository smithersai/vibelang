/**
 * Internal, data-only demand control for a keyed Plan interpreter.
 *
 * This is the control half of branch execution, not an execution authority or
 * a durable scheduler. The host still authenticates the complete Plan, admits
 * work, owns attempts, validates producer contracts and commits outcomes. It
 * feeds committed/restored outcomes back here. No authored predicate, provider,
 * source callback, clock, journal or replacement runtime runs in this module.
 *
 * Both alternatives belong to the static dependency graph. At run time a branch
 * first demands its condition and ordering prerequisites, then only its selected
 * arm. Shared work has one owner even when several demands join it. Claimed work
 * has a one-shot local completion token; cancellation invalidates every token.
 *
 * The native source interpreter supplies the topology. Authenticated workers
 * bind live reservations to that invocation; their eager NodeExecutor method
 * refuses branch graphs. Neither path grants scheduler or commit authority.
 */
import {decodeKeyedValue,snapshotKeyedJSON} from "./keyed-value.ts"
import type {KeyedNodeExit} from "./keyed-executor.ts"
import {deepFreeze,type JsonValue} from "./value.ts"

export interface KeyedControlNode {
  readonly id: string
  readonly dependencies: readonly string[]
  readonly branch?: {readonly condition: string; readonly whenTrue: string; readonly whenFalse: string}
}

/** A local demand reservation, never proof of approval, execution or commit. */
export interface KeyedControlTicket {
  readonly nodeId: string
  /** The selected runtime prerequisites, not the complete approval graph. */
  readonly dependencies: readonly string[]
}

export type KeyedControlStatus = "dormant" | "waiting" | "ready" | "running"
  | "success" | "failure" | "defect" | "interrupted" | "blocked" | "cancelled" | "skipped"

export interface KeyedControlInspection {
  readonly root: string
  readonly terminal: boolean
  /** Running work whose owning host must interrupt/drain after termination. */
  readonly cancel: readonly string[]
  readonly nodes: readonly {
    readonly id: string
    readonly status: KeyedControlStatus
    readonly selected?: string
    readonly blockedBy?: string
    readonly invalidCondition?: true
  }[]
}

type Row = Record<string,JsonValue>
type State = {
  readonly node: KeyedControlNode
  readonly ordinal: number
  readonly needed: Set<string>
  readonly dependents: Set<string>
  status: KeyedControlStatus
  selected?: string
  blockedBy?: string
  condition?: boolean
  invalidCondition?: true
}
const reservations=new WeakMap<object,{owner:KeyedControl;state:State;ticket:KeyedControlTicket}>()

/** @internal Read a live reservation without invoking a caller method/getter.
 * A worker additionally checks that it created the owning control instance. */
export function requireKeyedControlReservation(owner:KeyedControl,ticket:KeyedControlTicket):KeyedControlTicket {
  const issued=reservations.get(ticket)
  if(!issued||issued.owner!==owner||issued.state.status!=="running")fail("control completion is foreign, consumed or cancelled")
  return issued.ticket
}

export class KeyedControlError extends TypeError {
  constructor(message: string) {super(message);this.name="KeyedControlError"}
}
function fail(message: string): never {throw new KeyedControlError(message)}
const object=(value:JsonValue|undefined,label:string):Row=>{
  if(value===null||typeof value!=="object"||Array.isArray(value))return fail(`${label} must be an object`)
  return value
}
function exact(row:Row,keys:readonly string[],label:string):void {
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))fail(`${label} has missing or unknown fields`)
}
function address(value:JsonValue|undefined):string {
  if(typeof value!=="string"||value.trim()===""||value.includes("\0")||Buffer.byteLength(value,"utf8")>16*1024)fail("invalid control node address")
  return value
}
const settled=(state:State):boolean=>!["dormant","waiting","ready","running"].includes(state.status)

/**
 * Closed-graph demand protocol. A caller cannot supply a selection function or
 * expand the graph during a run. Append/reapproval belongs to the durable host.
 * This class accepts checked topology data, not a signed invocation proof.
 */
export class KeyedControl {
  readonly #states=new Map<string,State>()
  readonly #tickets=new WeakMap<object,State>()
  readonly #ready=new Set<State>()
  readonly #queue:State[]=[]
  readonly #queued=new Set<State>()
  readonly #conditions=new Set<string>()
  readonly #root:string
  readonly #cancel:string[]=[]
  #terminal=false

  constructor(nodes:readonly KeyedControlNode[],root:string) {
    // Snapshot before property access. A getter, proxy or caller mutation must
    // not change the demand graph while it is being validated or driven.
    const input=snapshotKeyedJSON({nodes,root}),program=object(input,"control graph")
    this.#root=address(program.root)
    if(!Array.isArray(program.nodes)||program.nodes.length===0||program.nodes.length>10_000)fail("control graph requires 1–10000 nodes")
    let edges=0
    for(const [ordinal,value] of program.nodes.entries()) {
      const row=object(value,"control node")
      exact(row,["id","dependencies",...(Object.hasOwn(row,"branch")?["branch"]:[])],"control node")
      const id=address(row.id)
      if(this.#states.has(id))fail("duplicate control node address")
      if(!Array.isArray(row.dependencies))fail("control dependencies must be an array")
      const dependencies=row.dependencies.map(address)
      if(new Set(dependencies).size!==dependencies.length)fail("duplicate control dependency")
      edges+=dependencies.length
      if(edges>100_000)fail("control graph exceeds its edge budget")
      let branch:KeyedControlNode["branch"]
      if(Object.hasOwn(row,"branch")) {
        const selection=object(row.branch,"branch control")
        exact(selection,["condition","whenTrue","whenFalse"],"branch control")
        branch={condition:address(selection.condition),whenTrue:address(selection.whenTrue),whenFalse:address(selection.whenFalse)}
        if(Object.values(branch).some(dependency=>!dependencies.includes(dependency)))fail("branch alternatives and condition must be declared dependencies")
        this.#conditions.add(branch.condition)
      }
      const node=deepFreeze({id,dependencies,...(branch?{branch}:{})})
      this.#states.set(id,{node,ordinal,needed:new Set(),dependents:new Set(),status:"dormant"})
    }
    if(!this.#states.has(this.#root))fail("control root is absent")
    for(const {node} of this.#states.values())for(const dependency of node.dependencies) {
      if(!this.#states.has(dependency))fail("control dependency is absent")
    }
    // Iterative DFS: a long, valid chain must not consume the JavaScript call
    // stack. Validate dormant arms too, including cycles the chosen arm hides.
    const colors=new Map<string,number>(),stack:{id:string;next:number}[]=[{id:this.#root,next:0}]
    colors.set(this.#root,1)
    while(stack.length) {
      const top=stack[stack.length-1],dependencies=this.#states.get(top.id)!.node.dependencies
      if(top.next===dependencies.length) {colors.set(top.id,2);stack.pop();continue}
      const dependency=dependencies[top.next++],color=colors.get(dependency)
      if(color===1)fail("control graph contains a cycle")
      if(color!==2) {colors.set(dependency,1);stack.push({id:dependency,next:0})}
    }
    if(colors.size!==this.#states.size)fail("control graph contains work outside its declared root")
    this.#demand(this.#root)
    this.#drain()
    Object.freeze(this)
  }

  #enqueue(state:State):void {
    if(this.#queued.has(state))return
    this.#queued.add(state);this.#queue.push(state)
  }

  #demand(id:string):State {
    const state=this.#states.get(id)!
    if(state.status==="dormant") {state.status="waiting";this.#enqueue(state)}
    return state
  }

  #need(state:State,id:string):void {
    if(state.needed.has(id))return
    state.needed.add(id)
    const dependency=this.#demand(id)
    dependency.dependents.add(state.node.id)
  }

  #notify(state:State):void {
    for(const id of state.dependents)this.#enqueue(this.#states.get(id)!)
  }

  #halt():void {
    this.#terminal=true
    // Root failure may be observed before a more distant consumer is visited
    // by the readiness queue. Preserve that demanded failure cone first: those
    // nodes are blocked by failed work, not independent cancellation victims.
    // Dormant alternatives have no active dependents and remain branch skips.
    const failed=[...this.#states.values()].filter(state=>["failure","defect","interrupted","blocked"].includes(state.status))
    for(let next=0;next<failed.length;next++)for(const id of failed[next].dependents) {
      const dependent=this.#states.get(id)!
      if(dependent.status!=="waiting")continue
      dependent.status="blocked";dependent.blockedBy=failed[next].node.id;failed.push(dependent)
    }
    for(const state of this.#states.values()) {
      if(state.status==="running")this.#cancel.push(state.node.id)
      if(state.status==="waiting"||state.status==="ready"||state.status==="running")state.status="cancelled"
    }
    this.#ready.clear()
  }

  #drain():void {
    // Each newly demanded prerequisite or settlement queues its consumers;
    // no full-graph rescan occurs for each Action in a long chain.
    for(let next=0;next<this.#queue.length;next++) {
      const state=this.#queue[next];this.#queued.delete(state)
      if(this.#terminal||state.status!=="waiting")continue
      const branch=state.node.branch
      for(const id of state.node.dependencies) {
        if(!branch||id===branch.condition||(id!==branch.whenTrue&&id!==branch.whenFalse))this.#need(state,id)
      }
      const needed=[...state.needed].map(id=>this.#states.get(id)!)
      const failed=needed.find(dependency=>settled(dependency)&&dependency.status!=="success")
      if(failed) {
        state.status="blocked";state.blockedBy=failed.node.id;this.#notify(state)
        if(state.node.id===this.#root)this.#halt()
        continue
      }
      if(needed.some(dependency=>dependency.status!=="success"))continue
      if(branch&&state.selected===undefined) {
        const condition=this.#states.get(branch.condition)!.condition
        if(condition===undefined) {
          state.status="defect";state.invalidCondition=true;this.#notify(state)
          if(state.node.id===this.#root)this.#halt()
          continue
        }
        state.selected=condition?branch.whenTrue:branch.whenFalse
        this.#need(state,state.selected)
        // The arm may already be settled through a shared, independent demand.
        this.#enqueue(state)
        continue
      }
      state.status="ready";this.#ready.add(state)
    }
    this.#queue.length=0;this.#queued.clear()
  }

  /** Reserve up to `limit` ready nodes in declared graph order. No dispatch. */
  claim(limit=1):readonly KeyedControlTicket[] {
    if(!Number.isSafeInteger(limit)||limit<1||limit>10_000)fail("control claim limit must be a positive bounded integer")
    if(this.#terminal)return Object.freeze([])
    const claimed:KeyedControlTicket[]=[]
    for(const state of [...this.#ready].sort((left,right)=>left.ordinal-right.ordinal).slice(0,limit)) {
      state.status="running";this.#ready.delete(state)
      const ticket=Object.freeze({nodeId:state.node.id,dependencies:Object.freeze([...state.needed])})
      this.#tickets.set(ticket,state);reservations.set(ticket,{owner:this,state,ticket});claimed.push(ticket)
    }
    return Object.freeze(claimed)
  }

  /**
   * Consume one local reservation after the host's commit/adoption. Outcomes
   * remain host-owned; only the exit tag and a possible boolean branch subject
   * are retained here. This cannot turn an answer into a durable receipt.
   */
  complete(ticket:KeyedControlTicket,outcome:KeyedNodeExit):void {
    const state=this.#tickets.get(ticket)
    if(!state||state.status!=="running"||this.#terminal)fail("control completion is foreign, consumed or cancelled")
    const exit=object(snapshotKeyedJSON(outcome),"control completion")
    if(exit.kind==="success"||exit.kind==="failure") {
      exact(exit,["kind",exit.kind==="success"?"value":"error"],"control completion")
      const value=decodeKeyedValue(exit.kind==="success"?exit.value:exit.error)
      if(exit.kind==="success"&&this.#conditions.has(state.node.id)&&typeof value==="boolean")state.condition=value
    } else if(exit.kind==="defect") {
      exact(exit,["kind","defect"],"control completion")
      const defect=object(exit.defect,"control defect")
      exact(defect,["name","message",...(Object.hasOwn(defect,"stack")?["stack"]:[])],"control defect")
      if(typeof defect.name!=="string"||typeof defect.message!=="string"||Object.hasOwn(defect,"stack")&&typeof defect.stack!=="string")fail("control defect requires string fields")
    } else if(exit.kind==="interrupted")exact(exit,["kind"],"control completion")
    else fail("unknown control completion kind")
    this.#tickets.delete(ticket)
    reservations.delete(ticket)
    state.status=exit.kind as "success"|"failure"|"defect"|"interrupted"
    this.#notify(state)
    if(state.node.id===this.#root)this.#halt()
    this.#drain()
  }

  /** Invalidate every reservation. The host must interrupt/drain `cancel`. */
  cancel():void {
    if(this.#terminal)return
    this.#halt();this.#queue.length=0;this.#queued.clear()
  }

  inspect():KeyedControlInspection {
    return deepFreeze({root:this.#root,terminal:this.#terminal,cancel:[...this.#cancel],nodes:[...this.#states.values()].map(state=>({
      id:state.node.id,status:this.#terminal&&state.status==="dormant"?"skipped":state.status,
      ...(state.selected===undefined?{}:{selected:state.selected}),
      ...(state.blockedBy===undefined?{}:{blockedBy:state.blockedBy}),
      ...(state.invalidCondition===undefined?{}:{invalidCondition:state.invalidCondition}),
    }))})
  }
}
