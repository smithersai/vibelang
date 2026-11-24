import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine"
import type * as Capability from "./experimental/Capability.js"

/**
 * Durable declarations (VIP-55). The parser writes
 *
 *     task FetchIssues { effect call(repo: string): Issues!string { … } }
 *     workflow Triage { effect call(repo: string) { … } }
 *
 * as
 *
 *     const FetchIssues = $task<(repo: string) => Issues!string>()("FetchIssues", {},
 *       { payload: { repo: Schema.String }, success: Issues, error: Schema.String }, effect function call(repo: string) { … })
 *     const Triage = $workflow("Triage", {}, { payload: { repo: Schema.String } }, effect function call(repo: string) { … },
 *       () => [FetchIssues], (): ReadonlyArray<unknown> => [Review])
 *
 * and these helpers run them on `Experimental.Durable` (VIP-60): a task is a
 * `Durable.task` whose payload is the call's arguments by parameter name, a
 * workflow a `Durable.workflow` whose handler is the body, and `W.layer` the
 * handler with the layers of the tasks and workflows the body reaches. The
 * durable module loads on first use, so a program without durable
 * declarations does not load it.
 *
 * A task's type argument is its written boundary: its parameters, success
 * and error. Its body's requirements stay inferred, and belong to the task's
 * layer, not to a caller.
 */

/** The `static readonly` members of a task or workflow, passed through by name. */
export interface DurableOptions {
  readonly key?: string | undefined
  readonly tier?: Capability.Tier | undefined
  readonly capabilities?: ReadonlyArray<Capability.Pattern | Capability.PatternText> | undefined
  readonly effects?: Capability.EffectEnvelope | undefined
  readonly [option: string]: unknown
}

export type WorkflowPlanTask = Capability.WorkflowPlanTask
export type WorkflowPlan = Capability.WorkflowPlan

/** The schemas of a durable boundary (VIP-44). */
export interface DurableSchemas {
  readonly payload: { readonly [parameter: string]: Schema.Top }
  readonly success?: Schema.Top
  readonly error?: Schema.Top
}

/** What `W.layer` composes: a declaration with a layer and the requirements of its implementation. */
interface Durable<R> {
  readonly "~durable": true
  readonly "~requirements"?: R
}

/** The implementation requirements of the declarations a workflow body reaches. */
type Reached<T> = T extends Durable<infer R> ? Exclude<R, undefined> : never

/** A task declaration (VIP-55): one recorded step of a workflow run. */
export interface Task<P extends ReadonlyArray<unknown>, A, E, R, S extends DurableSchemas = DurableSchemas> extends Durable<R> {
  /** A step of the enclosing workflow's run. A task runs only inside a workflow. */
  (...args: P): Effect.Effect<A, E, never>
  /** The declared name, or a written `static readonly key`. */
  readonly key: string
  /** The declared effect tier, defaulting to `"sealed"` (VIP-55, VIP-58). */
  readonly tier: Capability.Tier
  /** Whether the task wrote `static readonly tier` explicitly (VIP-58). */
  readonly tierDeclared: boolean
  /** The declared capability ceiling patterns in text form, or `undefined` when omitted. */
  readonly capabilities: ReadonlyArray<string> | undefined
  /** The declared effect envelope, if any. */
  readonly effects: Capability.EffectEnvelope | undefined
  readonly options: DurableOptions
  /** The boundary's schemas, derived from the written types. */
  readonly schemas: S
  /** The task's implementation, for a task whose `call` has a body. */
  readonly layer: Layer.Layer<never, never, R>
  /**
   * An implementation of the task: a task whose `call` has no body takes it here.
   * @throws {never}
   */
  toLayer<R2>(implementation: (...args: P) => Effect.Effect<A, E, R2>): Layer.Layer<never, never, R2>
}

/**
 * The end of a workflow round that starts the next one, `return W.to(…)`
 * (VIP-55): the workflow's key and the next round's arguments.
 */
export interface Handoff<P extends ReadonlyArray<unknown> = ReadonlyArray<unknown>> {
  readonly _tag: "Handoff"
  readonly key: string
  readonly args: P
}

/** Handoff, as the parser names it in a workflow's written return type. */
export type $Handoff = Handoff

/** A workflow declaration (VIP-55): a plan over tasks, run by a durable engine. */
export interface Workflow<P extends ReadonlyArray<unknown>, A, E, S extends DurableSchemas = DurableSchemas, R = never>
  extends Durable<R>
{
  /** Runs the workflow to completion. Equal input joins the run that input already started. */
  (...args: P): Effect.Effect<A, E, WorkflowEngine>
  /**
   * In a workflow's body, runs this workflow as a separate run, and this run waits for it.
   * @throws {never}
   */
  child(...args: P): Effect.Effect<A, E, never>
  /**
   * Ends this round of the workflow and starts the next with these arguments: `return W.to(…)`.
   * @throws {never}
   */
  to(...args: P): Handoff<P>
  /** The declared name, or a written `static readonly key`. */
  readonly key: string
  /** The workflow's own declared tier, if written. */
  readonly tier: Capability.Tier | undefined
  /** The workflow's own declared capability ceiling patterns in text form, or `undefined` when omitted. */
  readonly capabilities: ReadonlyArray<string> | undefined
  /** The workflow's own declared effect envelope, if any. */
  readonly effects: Capability.EffectEnvelope | undefined
  /** The derived static plan listing each reached task's declared `tier` and `capabilities` (VIP-58). */
  readonly plan: WorkflowPlan
  readonly options: DurableOptions
  /** The boundary's schemas, derived from the written types. */
  readonly schemas: S
  /** The workflow's handler with the layers of the tasks and workflows its body reaches. */
  readonly layer: Layer.Layer<never, never, WorkflowEngine | R>
}

type Boundary = (...args: any) => Effect.Effect<any, any, any>

type DurableModule = typeof import("./experimental/Durable.js")
let durableModule: Promise<DurableModule> | undefined
const loadDurable = (): Effect.Effect<DurableModule> =>
  Effect.promise(() => (durableModule ??= import("./experimental/Durable.js")))

type CapabilityModule = typeof import("./experimental/Capability.js")
let capabilityModule: Promise<CapabilityModule> | undefined
const loadCapability = (): Effect.Effect<CapabilityModule> =>
  Effect.promise(() => (capabilityModule ??= import("./experimental/Capability.js")))

/** One value per declaration, built on first use. */
const once = <A>(make: (durable: DurableModule) => A): Effect.Effect<A> => {
  let made: A | undefined
  return Effect.map(loadDurable(), (durable) => (made ??= make(durable)))
}

const tagOf = (name: string, options: DurableOptions) => (typeof options.key === "string" ? options.key : name)

const formatPattern = (pattern: Capability.Pattern | Capability.PatternText): string =>
  typeof pattern === "string" ? pattern : `${pattern.action}:${pattern.resource}`

const declaredTier = (options: DurableOptions): Capability.Tier | undefined =>
  options.tier === "sealed" || options.tier === "compensable" || options.tier === "irreversible"
    ? options.tier
    : undefined

const freezeOptions = (options: DurableOptions): DurableOptions => {
  if (Array.isArray(options.capabilities)) {
    const capabilities = Object.freeze(
      options.capabilities.map((p) => (typeof p === "string" ? p : Object.freeze({ ...p })))
    )
    return Object.freeze({ ...options, capabilities })
  }
  return Object.freeze({ ...options })
}

const rawCapabilities = (
  options: DurableOptions
): ReadonlyArray<Capability.Pattern | Capability.PatternText> | undefined =>
  Array.isArray(options.capabilities)
    ? (options.capabilities as ReadonlyArray<Capability.Pattern | Capability.PatternText>)
    : undefined

const declaredCapabilities = (options: DurableOptions): ReadonlyArray<string> | undefined => {
  const patterns = rawCapabilities(options)
  return patterns === undefined ? undefined : Object.freeze(patterns.map(formatPattern))
}

const attenuateEffect = (
  patterns: ReadonlyArray<Capability.Pattern | Capability.PatternText> | undefined,
  effect: Effect.Effect<unknown, unknown, unknown>
): Effect.Effect<unknown, unknown, unknown> =>
  patterns === undefined
    ? effect
    : Effect.flatMap(loadCapability(), (Capability) => Capability.attenuate(patterns)(effect))

/** The options a declaration passes to `Experimental.Durable`: every written member but `key`. */
const passed = (options: DurableOptions) => {
  const { key: _key, ...rest } = options
  return rest
}

const payloadOf = (schemas: DurableSchemas, args: ReadonlyArray<unknown>) => {
  const payload: Record<string, unknown> = {}
  Object.keys(schemas.payload).forEach((name, i) => (payload[name] = args[i]))
  return payload
}
const argsOf = (schemas: DurableSchemas, payload: Record<string, unknown>) => Object.keys(schemas.payload).map((name) => payload[name])

const isHandoff = (value: unknown): value is Handoff =>
  typeof value === "object" && value !== null && (value as Handoff)._tag === "Handoff"

const define = <F extends Function>(fn: F, key: string, options: DurableOptions, schemas: DurableSchemas): F =>
  Object.defineProperties(fn, {
    "~durable": { value: true },
    key: { value: key, enumerable: true },
    options: { value: options, enumerable: true },
    schemas: { value: schemas, enumerable: true },
    name: { value: key }
  })

/** A task declaration's value; `S` is its written boundary signature. */
export function $task<S extends Boundary>(): <const Sc extends DurableSchemas, R = never>(
  key: string,
  options: DurableOptions,
  schemas: Sc,
  implementation?: (...args: Parameters<S>) => Effect.Effect<Effect.Success<ReturnType<S>>, Effect.Error<ReturnType<S>>, R>
) => Task<Parameters<S>, Effect.Success<ReturnType<S>>, Effect.Error<ReturnType<S>>, R, Sc> {
  return (name, rawOptions, schemas, implementation) => {
    const options = freezeOptions(rawOptions)
    const key = tagOf(name, options)
    const explicitTier = declaredTier(options)
    const tier: Capability.Tier = explicitTier ?? "sealed"
    const tierDeclared = explicitTier !== undefined
    const capabilities = declaredCapabilities(options)
    const ceiling = rawCapabilities(options)
    const durable = once((Durable) =>
      Durable.task(key, { ...passed(options), payload: schemas.payload, success: schemas.success, error: schemas.error } as any)
    )
    const task: any = (...args: ReadonlyArray<unknown>) => Effect.flatMap(durable, (t: any) => t(payloadOf(schemas, args)))
    task.toLayer = (run: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown, unknown>) =>
      Layer.unwrap(Effect.map(durable, (t: any) =>
        t.toLayer((payload: Record<string, unknown>) => attenuateEffect(ceiling, run(...argsOf(schemas, payload))))
      ))
    task.layer = implementation === undefined ? Layer.empty : task.toLayer(implementation)
    Object.defineProperties(task, {
      "~task": { value: true },
      tier: { value: tier, enumerable: true },
      tierDeclared: { value: tierDeclared, enumerable: true },
      capabilities: { value: capabilities, enumerable: true },
      effects: { value: options.effects, enumerable: true }
    })
    return define(task, key, options, schemas)
  }
}

/**
 * Walks reached tasks and nested workflows in discovery order, cycle-safe for
 * mutually recursive workflows, without inferring authority from `R`.
 */
const collectReachedTasks = (
  roots: () => ReadonlyArray<unknown>,
  self: unknown
): ReadonlyArray<WorkflowPlanTask> => {
  const seenWorkflows = new Set<unknown>([self])
  const seenTasks = new Set<unknown>()
  const tasks: Array<WorkflowPlanTask> = []
  const visit = (items: ReadonlyArray<unknown>) => {
    for (const value of items) {
      if (typeof value !== "function") continue
      const record = value as any
      if (record["~durable"] !== true) continue
      if (record["~task"] === true) {
        if (seenTasks.has(value)) continue
        seenTasks.add(value)
        const entry: WorkflowPlanTask = {
          key: record.key,
          tier: record.tier ?? "sealed",
          tierDeclared: record.tierDeclared === true,
          capabilities: record.capabilities,
          ...(record.effects === undefined ? {} : { effects: record.effects })
        }
        tasks.push(Object.freeze(entry))
      } else if (record["~engine"] !== undefined && !seenWorkflows.has(value)) {
        seenWorkflows.add(value)
        if (typeof record["~children"] === "function") {
          visit(record["~children"]())
        }
      }
    }
  }
  visit(roots())
  return Object.freeze(tasks)
}

/**
 * A workflow declaration's value. `reached` lists the tasks declared before
 * it in its file that its body runs, whose requirements W.layer's type
 * carries; `others`, the other names its body calls, which W.layer also
 * composes when they are tasks or workflows.
 */
export function $workflow<P extends ReadonlyArray<unknown>, A, E, R, const Sc extends DurableSchemas, T = never>(
  name: string,
  rawOptions: DurableOptions,
  schemas: Sc,
  body: (...args: P) => Effect.Effect<A, E, R>,
  reached?: () => ReadonlyArray<T>,
  others?: () => ReadonlyArray<unknown>
): Workflow<P, Exclude<A, Handoff>, E, Sc, Reached<T>> {
  const options = freezeOptions(rawOptions)
  const key = tagOf(name, options)
  const tier = declaredTier(options)
  const capabilities = declaredCapabilities(options)
  const ceiling = rawCapabilities(options)
  const children = () => [...(reached?.() ?? []), ...(others?.() ?? [])]
  const buildPlan = (): WorkflowPlan => {
    const tasks = collectReachedTasks(children, workflow)
    return Object.freeze({
      workflow: key,
      ...(tier === undefined ? {} : { tier }),
      ...(capabilities === undefined ? {} : { capabilities }),
      ...(options.effects === undefined ? {} : { effects: options.effects }),
      tasks,
      nodes: tasks
    })
  }
  const durable = once((Durable) => {
    const opts = passed(options)
    return Durable.workflow(key, {
      ...opts,
      payload: schemas.payload,
      success: schemas.success ?? Schema.Unknown,
      error: schemas.error ?? Schema.Unknown,
      plan: typeof opts.plan === "function" ? opts.plan : () => buildPlan()
    } as any)
  })
  const run = (args: ReadonlyArray<unknown>) => Effect.flatMap(durable, (w: any) => w.execute(payloadOf(schemas, args)))
  const workflow: any = (...args: P) => run(args)
  workflow.child = (...args: P) => run(args)
  workflow.to = (...args: P): Handoff<P> => ({ _tag: "Handoff", key, args })
  workflow.body = body
  // A round that returns W.to(…) starts the next round in the same run;
  // maxRounds, when written, bounds them.
  const rounds = (first: ReadonlyArray<unknown>) =>
    Effect.gen(function*() {
      let args = first
      for (let round = 1; ; round++) {
        const result: unknown = yield* (body as any)(...args)
        if (!isHandoff(result)) return result
        const max = options.maxRounds
        if (typeof max === "number" && round >= max) {
          return yield* Effect.die(new RangeError(`workflow ${key} handed off after its last round (maxRounds ${max})`))
        }
        args = result.args
      }
    })
  workflow.layer = Layer.unwrap(Effect.map(durable, (w: any) => {
    const layers = children().flatMap((value: any) =>
      value !== workflow && value?.["~durable"] === true && value.layer !== undefined ? [value.layer] : []
    )
    const handler = w.toLayer((payload: Record<string, unknown>) => attenuateEffect(ceiling, rounds(argsOf(schemas, payload))))
    return layers.length === 0 ? handler : Layer.provide(handler, Layer.mergeAll(...(layers as [any, ...Array<any>])))
  }))
  Object.defineProperties(workflow, {
    "~engine": { value: durable },
    "~children": { value: children },
    tier: { value: tier, enumerable: true },
    capabilities: { value: capabilities, enumerable: true },
    effects: { value: options.effects, enumerable: true },
    plan: { get: buildPlan, enumerable: true }
  })
  return define(workflow, key, options, schemas)
}

/**
 * The Effect workflow a declared `workflow` runs as, and the payload its
 * engine executes for these arguments: each argument under its parameter's
 * name. For modules that start runs of a declaration, such as
 * `Experimental.Trigger`.
 * @throws {never}
 */
export const engineLaunch = (
  declared: Workflow<ReadonlyArray<unknown>, unknown, unknown>,
  args: ReadonlyArray<unknown>
): Effect.Effect<{ readonly workflow: import("effect/workflow").Workflow.Any; readonly payload: Record<string, unknown> }> =>
  Effect.map((declared as any)["~engine"] as Effect.Effect<import("effect/workflow").Workflow.Any>, (workflow) => ({
    workflow,
    payload: payloadOf(declared.schemas, args)
  }))

/** The Effect workflow a declared `workflow` runs as. */
export const engineWorkflow = (
  declared: Workflow<ReadonlyArray<unknown>, unknown, unknown>
): Effect.Effect<import("effect/workflow").Workflow.Any> =>
  (declared as any)["~engine"] as Effect.Effect<import("effect/workflow").Workflow.Any>

/** Whether a value is a declared `workflow` (VIP-55). */
export const isDeclaredWorkflow = (value: unknown): value is Workflow<ReadonlyArray<any>, unknown, unknown> =>
  typeof value === "function" && (value as any)["~durable"] === true && (value as any)["~engine"] !== undefined

/**
 * `return W.to(…)` in W's own body, which the parser writes with W's
 * parameter types so the handoff's type does not depend on W's (VIP-55).
 * @throws {never}
 */
export function $handoff<P extends ReadonlyArray<unknown>>(key: string, ...args: P): Handoff<P> {
  return { _tag: "Handoff", key, args }
}
