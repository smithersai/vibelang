/**
 * Interpreter for the native keyed-source/v2 DATA program. It reconstructs
 * Action inputs and result values; it does not load or invoke a provider, grant
 * authority, schedule work, or write a journal. The scheduler's NodeExecutor
 * adapter must separately authenticate code, approvals, effects and ownership.
 */
import { getNativeCompiler } from "../compiler/native.ts"
import { posix } from "node:path"
import { validateActionContractDescriptor, validateDurableSchema, validateDurableValue } from "./schema-runtime.ts"
import { decodeKeyedValue, encodeKeyedValue, snapshotKeyedJSON, type KeyedValue } from "./keyed-value.ts"
import { canonicalJson, deepFreeze, structuralSchema, type ActionDescriptor, type DurableSchema, type DurableTypeDescriptor, type JsonPrimitive, type JsonValue } from "./value.ts"
import {createKeyedComputationEvaluator, keyedOperatorArity, KeyedSourceEvaluationError, type KeyedOperator} from "./keyed-computation.ts"
import {KeyedControl} from "./keyed-control.ts"
export {KeyedSourceEvaluationError} from "./keyed-computation.ts"

const ABI = "vibelang/keyed-source/v2"
type Row = Record<string, JsonValue>
type Input = { _tag: "Literal"; value: JsonPrimitive }
  | { _tag: "Ref"; from: string; path: string[] }
  | { _tag: "Pending"; from: string }
type Expression = { kind: "slot"; index: number }
  | { kind: "compute"; operator: KeyedOperator; operands: Expression[] }
  | { kind: "array"; items: Expression[] }
  | { kind: "object"; entries: { name: string; value: Expression }[] }

export interface KeyedSourceEvidence {
  readonly fileName: string
  readonly exportName?: string
  readonly sourceDigest: string
  /** Present for an explicit multi-module source closure. */
  readonly projectDigest?: string
  readonly flowId: string
  readonly flowVersion: number
  readonly compilerRevision: string
  readonly compilerPatchSeries: string
  readonly compilerAPI: string
}

export interface KeyedSourceNodeInspection {
  readonly id: string
  readonly key: string
  readonly dependsOn: readonly string[]
  readonly operation: "action" | "value" | "branch" | "result"
  readonly tier: "sealed" | "compensable" | "irreversible"
  readonly effects: JsonValue
  readonly layers: readonly string[]
  readonly capabilities: readonly string[]
}

/** Exactly the scheduler's Ref-only resolved inputs, including duplicates. */
export interface KeyedResolvedInput {
  readonly from: string
  readonly path: readonly string[]
  readonly value: unknown
}

export type PreparedKeyedNode = {
  readonly operation: "action"
  readonly node: KeyedSourceNodeInspection
  readonly contract: ActionDescriptor
  readonly implementationId: string
  /** Claimed code commitment from the Plan, NOT authenticated provider code. */
  readonly implementationDigest: string
  /** Fresh, ordinary mutable data for the eventual authored implementation. */
  readonly input: JsonValue
} | {
  readonly operation: "result"
  readonly node: KeyedSourceNodeInspection
  /** Encoded for storage; use decodeKeyedValue when delivering to the author. */
  readonly value: KeyedValue
}

interface Program {
  readonly inspection: KeyedSourceNodeInspection
  readonly inputs: Input[]
  readonly expression?: Expression
  readonly control?: {readonly condition:string;readonly whenTrue:string;readonly whenFalse:string}
  readonly success: DurableSchema
  readonly action?: { readonly contract: ActionDescriptor; readonly implementationId: string; readonly implementationDigest: string }
}

export class KeyedSourceInterpreterError extends TypeError {
  constructor(message: string) { super(message); this.name = "KeyedSourceInterpreterError" }
}
function refuse(message: string): never { throw new KeyedSourceInterpreterError(message) }
const row = (value: JsonValue | undefined, label: string): Row => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return refuse(`${label} must be an object`)
  return value
}
const exact = (value: Row, names: string[], label: string): void => {
  if (!sameStrings(Object.keys(value).sort(), names.sort())) refuse(`${label} has unexpected fields`)
}
const sameStrings = (left: readonly unknown[], right: readonly unknown[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])
const sourceAddress = (id: JsonValue | undefined): "action"|"value"|"branch"|undefined => {
  if (typeof id !== "string") return undefined
  const parts = id.split("/")
  const ordinal = (part: string | undefined, limit: number): boolean =>
    part !== undefined && /^(0|[1-9][0-9]*)$/.test(part) && Number(part) < limit && String(Number(part)) === part
  let scopes = 0, branches = 0, offset = 0
  while (offset < parts.length) {
    if (parts[offset] === "action") return offset+2 === parts.length && ordinal(parts[offset+1],10_000)?"action":undefined
    if (parts[offset] === "flow") {
      if (++scopes >= 8 || !ordinal(parts[offset+1],10_000)) return undefined
      offset += 2
    } else if (parts[offset] === "fanout") {
      const key = parts[offset+2]
      if (!ordinal(parts[offset+1],10_000) || key?.length !== 69 || !/^key1_[a-f0-9]{64}$/.test(key) || !ordinal(parts[offset+3],16)) return undefined
      offset += 4
      if (offset === parts.length) return "action" // An Action step, not a child boundary.
      if (++scopes >= 8) return undefined
    } else if(parts[offset]==="branch") {
      if(++branches>64||!ordinal(parts[offset+1],10_000))return undefined
      offset+=2
      if(offset===parts.length)return "branch"
      if(offset+1===parts.length&&parts[offset]==="condition")return "value"
      if(parts[offset]!=="then"&&parts[offset]!=="else")return undefined
      offset++
      if(offset+1===parts.length&&parts[offset]==="result")return "value"
    } else return undefined
  }
  return undefined
}
const structural = (value: JsonValue, role: DurableSchema["role"]): DurableSchema => {
  const schema = validateDurableSchema(value, role)
  if (schema.shape !== "structural") refuse("keyed execution requires a structural codec, not a legacy JSON schema")
  return schema
}

// Ref inputs are already projected by the scheduler. Validate that SUBTREE
// against its producer, not just the consumer's final value: `wrong === 1`
// would otherwise mask a malformed number result as a valid boolean.
function projectedSuccess(schema:DurableSchema, wirePath:readonly string[]):DurableSchema {
  if(schema.shape !== "structural")return refuse("resolved Ref producer has no structural contract")
  if(wirePath.length === 0)return schema
  const path=wirePath.filter((_,index)=>index%2===1)
  let visited=0
  const project=(descriptor:DurableTypeDescriptor,offset:number):DurableTypeDescriptor=>{
    if(++visited>100_000)return refuse("resolved Ref schema exceeds its projection budget")
    if(offset===path.length || descriptor.kind==="never")return descriptor
    const key=path[offset]
    if(descriptor.kind==="union") {
      const variants=new Map<string,DurableTypeDescriptor>()
      const add=(value:DurableTypeDescriptor):void=>{
        if(value.kind==="union")value.variants.forEach(add)
        else if(value.kind!=="never")variants.set(canonicalJson(value as unknown as JsonValue),value)
      }
      descriptor.variants.forEach(value=>add(project(value,offset)))
      const sorted=[...variants].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,value])=>value)
      return sorted.length===0?{kind:"never"}:sorted.length===1?sorted[0]:{kind:"union",variants:sorted}
    }
    if(descriptor.kind==="object") {
      const field=descriptor.fields.find(field=>field.name===key)
      if(field)return project(field.value,offset+1)
    }
    if(/^(0|[1-9][0-9]*)$/.test(key)) {
      if(descriptor.kind==="array")return project(descriptor.element,offset+1)
      if(descriptor.kind==="tuple" && Number(key)<descriptor.items.length)return project(descriptor.items[Number(key)],offset+1)
    }
    return refuse("resolved Ref path has no producer contract")
  }
  return structuralSchema("success",project(schema.descriptor,0))
}

/**
 * Verified graph + validated interpreter ABI, NOT a signed or approved program.
 * Native Go reconstructs graph keys/edges before any interpreter data is used.
 * Source evidence inside the graph still needs deployment authentication.
 */
export class KeyedSourceInterpreter {
  readonly planJson: string
  readonly planId: string
  readonly digest: string
  readonly source: KeyedSourceEvidence
  readonly nodes: readonly KeyedSourceNodeInspection[]
  readonly #programs = new Map<string, Program>()
  readonly #refSchemas = new Map<string, DurableSchema>()

  constructor(planJson: string) {
    if (typeof planJson !== "string") refuse("keyed interpreter requires Plan JSON bytes")
    const native = getNativeCompiler()
    const checked = native.keyedPlan({ operation: "verify", inputJson: planJson })
    if (!checked.ok) refuse(`keyed Plan verification failed: ${checked.errorCode}: ${checked.message}`)
    this.planJson = checked.planJson
    // This JSON was decoded, bounded, reconstructed and encoded by native Go.
    const plan = JSON.parse(checked.planJson) as Row
    if (plan.generation !== 0 || !Array.isArray(plan.nodes) || plan.nodes.length === 0) refuse("keyed interpreter currently requires a nonempty generation-zero source Plan")
    this.planId = plan.planId as string
    this.digest = plan.digest as string
    const nodes = plan.nodes as Row[], inspections: KeyedSourceNodeInspection[] = []
    const actionBindings = new Map<string, string>()
    let evidence: KeyedSourceEvidence | undefined, evidenceJSON = "", visited = 0
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index], material = row(node.material, "node material"), body = row(material.body, "node body")
      const last = index === nodes.length - 1, operation = body.operation
      if ((last ? node.id !== "result"||operation!=="result" : sourceAddress(node.id)!==operation) ||
        body.abi !== ABI || !["action","value","branch","result"].includes(operation as string)) {
        refuse("unknown keyed source ABI, operation or structural address")
      }
      exact(body, operation === "action"
        ? ["abi", "operation", "source", "expression", "contract", "implementationId", "implementationDigest"]
        : operation === "branch" ? ["abi","operation","source","control","successSchema"]
        : ["abi", "operation", "source", "expression", ...(operation==="result"?["inputSchema"]:[]), "successSchema"], "node body")
      const source = row(body.source, "source evidence")
      exact(source, ["fileName", "sourceDigest", "flowId", "flowVersion", "compilerRevision", "compilerPatchSeries", "compilerAPI",
        ...(Object.hasOwn(source, "projectDigest") ? ["projectDigest"] : []),
        ...(Object.hasOwn(source, "exportName") ? ["exportName"] : [])], "source evidence")
      if (Object.hasOwn(source, "exportName") && (typeof source.exportName !== "string" || source.exportName.trim() === "" ||
        Buffer.byteLength(source.exportName, "utf8") > 16*1024 || source.exportName.includes("\0"))) refuse("invalid source export name")
      if (Object.hasOwn(source, "projectDigest") && (typeof source.projectDigest !== "string" || !/^[a-f0-9]{64}$/.test(source.projectDigest))) refuse("invalid source project digest")
      if (typeof source.fileName !== "string" || !source.fileName.endsWith(".vibe") ||
        posix.normalize(source.fileName) !== source.fileName || posix.isAbsolute(source.fileName) ||
        source.fileName.startsWith("../") || /[\\\0]/.test(source.fileName) ||
        typeof source.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(source.sourceDigest) ||
        source.flowId !== plan.flow || !Number.isSafeInteger(source.flowVersion) || (source.flowVersion as number) < 1 ||
        source.compilerAPI !== String(native.identity.apiVersion) || source.compilerRevision !== native.identity.revision ||
        source.compilerPatchSeries !== native.identity.patchSeries) refuse("source evidence does not match this interpreter/compiler identity")
      if (evidence === undefined) {
        evidence = deepFreeze(source as unknown as KeyedSourceEvidence)
        evidenceJSON = JSON.stringify(source)
      } else if (JSON.stringify(source) !== evidenceJSON) refuse("keyed source nodes disagree on their source identity")
      const inputs = material.inputs as unknown as Input[]
      let pending = false
      for (const input of inputs) {
        if (input._tag === "Pending") pending = true
        else {
          if (pending) refuse("source data inputs cannot follow ordering-only inputs")
          if (input._tag === "Literal" && input.value !== null && typeof input.value === "object") refuse("source literals must be scalar; ordered containers use expressions")
          if (input._tag === "Ref" && (input.path.length > 128 || input.path.length % 2 !== 0 ||
            input.path.some((key, index) => index % 2 === 0 && key !== "items"))) refuse("source Ref does not use the ordered value projection codec")
        }
      }
      const slots = new Set<number>()
      const expression = (value: JsonValue, depth: number): Expression => {
        if (++visited > 100_000 || depth > 128) return refuse("keyed expression exceeds its traversal budget")
        const item = row(value, "expression")
        switch (item.kind) {
          case "compute": {
            exact(item,["kind","operator","operands"],"compute expression")
            const arity=keyedOperatorArity(item.operator)
            if(!arity || !Array.isArray(item.operands) || item.operands.length!==arity)return refuse("compute expression has an unknown operator or invalid arity")
            return {kind:"compute",operator:item.operator as KeyedOperator,operands:item.operands.map(child=>expression(child,depth+1))}
          }
          case "slot":
            exact(item, ["kind", "index"], "slot expression")
            if (!Number.isSafeInteger(item.index) || (item.index as number) < 0 || (item.index as number) >= inputs.length ||
              inputs[item.index as number]._tag === "Pending" || slots.has(item.index as number)) refuse("expression has an invalid, duplicated or ordering-only slot")
            slots.add(item.index as number)
            return { kind: "slot", index: item.index as number }
          case "array":
            exact(item, ["kind", "items"], "array expression")
            if (!Array.isArray(item.items)) return refuse("array expression requires items")
            return { kind: "array", items: item.items.map(child => expression(child, depth + 1)) }
          case "object": {
            exact(item, ["kind", "entries"], "object expression")
            if (!Array.isArray(item.entries)) return refuse("object expression requires ordered entries")
            const names = new Set<string>()
            return {kind: "object", entries: item.entries.map(child => {
              const entry = row(child, "object entry")
              exact(entry, ["name", "value"], "object entry")
              if (typeof entry.name !== "string" || names.has(entry.name)) return refuse("object expression repeats an entry name")
              names.add(entry.name)
              return { name: entry.name, value: expression(entry.value, depth + 1) }
            })}
          }
          default: return refuse("unknown keyed expression kind")
        }
      }
      let control:Program["control"],expr:Expression|undefined
      if(operation==="branch") {
        const selection=row(body.control,"branch control")
        exact(selection,["condition","whenTrue","whenFalse"],"branch control")
        const expected=[`${node.id}/condition`,`${node.id}/then/result`,`${node.id}/else/result`]
        if(!sameStrings([selection.condition,selection.whenTrue,selection.whenFalse],expected)||inputs.length<3||
          inputs.some((input,index)=>index<3?input._tag!=="Ref"||input.from!==expected[index]||input.path.length!==0:input._tag!=="Pending")) {
          refuse("branch control and exact condition/arm references do not agree")
        }
        control=selection as unknown as NonNullable<Program["control"]>
      } else {
        expr=expression(body.expression,0)
        if (inputs.some((input, index) => input._tag !== "Pending" && !slots.has(index))) refuse("source expression leaves a declared data input unconsumed")
      }
      const inspection = deepFreeze({ id: node.id, key: node.key, dependsOn: node.dependsOn, operation,
        tier: material.kind, effects: node.effects, layers: material.layers, capabilities: material.capabilities } as unknown as KeyedSourceNodeInspection)
      let program: Program
      if (operation === "action") {
        const contract = validateActionContractDescriptor(body.contract)
        if ([contract.inputSchema, contract.successSchema, contract.errorSchema].some(schema => schema.shape !== "structural")) refuse("Action requires structural contracts")
        if (typeof body.implementationId !== "string" || body.implementationId.trim() === "" ||
          typeof body.implementationDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.implementationDigest)) refuse("Action has no explicit implementation code commitment")
        const binding = canonicalJson({contract, implementationId: body.implementationId, implementationDigest: body.implementationDigest,
          tier: material.kind, layers: material.layers, capabilities: material.capabilities, effects: node.effects})
        const previous = actionBindings.get(contract.id)
        if (previous !== undefined && previous !== binding) refuse("source Action has inconsistent contracts or provider declarations")
        actionBindings.set(contract.id, binding)
        program = { inspection, inputs, expression: expr, success: contract.successSchema,
          action: { contract, implementationId: body.implementationId, implementationDigest: body.implementationDigest } }
      } else {
        if(operation==="result")structural(body.inputSchema, "input")
        if (material.kind !== "sealed" || (material.layers as JsonValue[]).length || (material.capabilities as JsonValue[]).length ||
          JSON.stringify(node.effects) !== '{"boundaryMode":"hard","reads":[],"writes":[]}') refuse("value/result/branch nodes must be pure")
        program = { inspection, inputs, expression: expr, ...(control?{control}:{}), success: structural(body.successSchema, "success") }
      }
      this.#programs.set(inspection.id, deepFreeze(program))
      inspections.push(inspection)
    }
    for(const program of this.#programs.values())for(const input of program.inputs)if(input._tag==="Ref") {
      const identity=JSON.stringify([input.from,input.path])
      if(!this.#refSchemas.has(identity))this.#refSchemas.set(identity,projectedSuccess(this.#program(input.from).success,input.path))
    }
    this.nodes = Object.freeze(inspections)
    this.source = evidence!
    // A generic re-keyed Plan can contain conflict edges that bypass a branch
    // join. Never let those edges turn an untaken alternative into demanded
    // work. Native publication enforces the same current adapter boundary.
    const owners=new Map<string,{prefix:string;join:string}[]>()
    for(const node of this.nodes) {
      const parts=node.id.split("/"),arms:{prefix:string;join:string}[]=[]
      for(let index=0;index+2<parts.length;index++)if(parts[index]==="branch"&&(parts[index+2]==="then"||parts[index+2]==="else")) {
        arms.push({prefix:parts.slice(0,index+3).join("/")+"/",join:parts.slice(0,index+2).join("/")})
      }
      owners.set(node.id,arms)
    }
    for(const node of this.nodes)for(const dependency of node.dependsOn)for(const owner of owners.get(dependency)??[]) {
      if(!node.id.startsWith(owner.prefix)&&!(node.id===owner.join&&dependency===owner.prefix+"result")) {
        refuse("keyed branch ordering crosses a conditional arm; a branch-aware effect adapter is required")
      }
    }
    // The root must cover the entire STATIC graph, including untaken arms.
    // Completion demand uses branch selection instead of waiting on both arms.
    this.createControl()
    Object.freeze(this)
  }

  #program(id: string): Program {
    if (typeof id !== "string") return refuse("keyed source node id must be a string")
    return this.#programs.get(id) ?? refuse(`unknown keyed source node: ${id}`)
  }

  /** Local demand state for this verified graph. This does not authenticate an
   * invocation or grant admission, attempts, persisted outcomes or ownership.
   * Both branch alternatives remain in the approved static graph. */
  createControl():KeyedControl {
    return new KeyedControl(this.nodes.map(node=>{
      const control=this.#program(node.id).control
      return {id:node.id,dependencies:node.dependsOn,...(control?{branch:control}:{})}
    }),"result")
  }

  /** Does not establish readiness; the owning scheduler supplies settled Ref values. */
  prepare(id: string, resolvedInputs: readonly KeyedResolvedInput[]): PreparedKeyedNode {
    return this.#prepare(id,resolvedInputs)
  }

  /** @internal A worker's locally issued demand reservation supplies the active
   * dependencies. The reservation is checked at the authenticated worker seam. */
  prepareSelected(id:string,resolvedInputs:readonly KeyedResolvedInput[],dependencies:readonly string[]):PreparedKeyedNode {
    return this.#prepare(id,resolvedInputs,dependencies)
  }

  #prepare(id:string,resolvedInputs:readonly KeyedResolvedInput[],dependencies?:readonly string[]):PreparedKeyedNode {
    const program = this.#program(id), resolved = snapshotKeyedJSON(resolvedInputs)
    if (!Array.isArray(resolved)) return refuse("resolved inputs must be an array")
    if(program.control&&dependencies===undefined)refuse("branch preparation requires selected demand dependencies")
    let active:Set<string>|undefined
    if(dependencies!==undefined) {
      const selected=snapshotKeyedJSON(dependencies)
      if(!Array.isArray(selected)||selected.some(id=>typeof id!=="string")||new Set(selected).size!==selected.length)refuse("invalid selected dependency list")
      active=new Set(selected as string[])
      if([...active].some(id=>!program.inspection.dependsOn.includes(id)))refuse("selected dependency is not declared by the node")
      const optional=program.control?[program.control.whenTrue,program.control.whenFalse]:[]
      if(program.inspection.dependsOn.some(id=>!optional.includes(id)&&!active!.has(id)))refuse("selected demand omitted a mandatory dependency")
    }
    const slots: JsonValue[] = []
    const repeated = new Map<string, string>()
    let position = 0
    for (const input of program.inputs) {
      if (input._tag === "Literal") slots.push(input.value)
      else if (input._tag === "Pending") slots.push(null) // validated never to be read
      else {
        if(active&&!active.has(input.from)) {slots.push(null);continue}
        const supplied = row(resolved[position++], "resolved Ref")
        exact(supplied, ["from", "path", "value"], "resolved Ref")
        if (supplied.from !== input.from || !Array.isArray(supplied.path) || !sameStrings(supplied.path, input.path)) refuse("resolved Ref identity/path/order does not match the Plan")
        const value = decodeKeyedValue(supplied.value)
        const identity = JSON.stringify([input.from, input.path]), bytes = canonicalJson(supplied.value)
        if (repeated.has(identity) && repeated.get(identity) !== bytes) refuse("duplicate resolved Ref carries inconsistent values")
        repeated.set(identity, bytes)
        validateDurableValue(this.#refSchemas.get(identity)!,value,"resolved Ref producer success")
        slots.push(value)
      }
    }
    if (position !== resolved.length) refuse("resolved input list includes extra data or Pending values")
    if(program.control) {
      const condition=slots[0]
      if(typeof condition!=="boolean")refuse("branch condition is not a boolean producer success")
      const chosen=condition?program.control.whenTrue:program.control.whenFalse
      const omitted=condition?program.control.whenFalse:program.control.whenTrue
      if(!active!.has(chosen)||active!.has(omitted))refuse("selected dependencies disagree with the actual branch condition")
      return Object.freeze({operation:"result",node:program.inspection,value:this.encodeSuccess(id,slots[condition?1:2])})
    }
    const compute=createKeyedComputationEvaluator()
    const evaluate = (expression: Expression): JsonValue => {
      switch (expression.kind) {
        case "compute": return compute(expression.operator,index=>evaluate(expression.operands[index]))
        case "slot": return slots[expression.index]
        case "array": return expression.items.map(evaluate)
        case "object": {
          const result: Record<string, JsonValue> = {}
          for (const entry of expression.entries) Object.defineProperty(result, entry.name,
            {value: evaluate(entry.value), enumerable: true, configurable: true, writable: true})
          return result
        }
      }
    }
    try {
      const value = evaluate(program.expression!)
      if (program.action) {
        // Literal-backed input can be larger than the resolved-input list.
        // Charge its complete codec expansion before handing it to a provider.
        encodeKeyedValue(value)
        // Validate the safe reconstructed value, but do not substitute the legacy
        // validator's sorted snapshot for the author's ordered input.
        validateDurableValue(program.action.contract.inputSchema, value, "keyed Action input")
        return Object.freeze({ operation: "action", node: program.inspection, ...program.action, input: value })
      }
      return Object.freeze({ operation: "result", node: program.inspection, value: this.encodeSuccess(id, value) })
    } catch(error) {
      if(error instanceof KeyedSourceEvaluationError)throw error
      throw new KeyedSourceEvaluationError(error instanceof Error ? error.message : "keyed value evaluation failed")
    }
  }

  /** Validate/encode an answer; this is data checking, not a commit or a receipt. */
  encodeSuccess(id: string, value: unknown): KeyedValue {
    const program = this.#program(id), encoded = encodeKeyedValue(value)
    validateDurableValue(program.success, decodeKeyedValue(encoded), "keyed node success")
    return encoded
  }

  /** Typed failure payload only. Defects/cancellation are separate scheduler exits. */
  encodeFailure(id: string, value: unknown): KeyedValue {
    const program = this.#program(id)
    if (!program.action) return refuse("result projection has no recoverable failure channel")
    const encoded = encodeKeyedValue(value)
    validateDurableValue(program.action.contract.errorSchema, decodeKeyedValue(encoded), "keyed Action failure")
    return encoded
  }
}
