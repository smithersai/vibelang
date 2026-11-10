import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Schema from "effect/Schema"
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine"

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
export type DurableOptions = { readonly [option: string]: unknown }

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

/** One value per declaration, built on first use. */
const once = <A>(make: (durable: DurableModule) => A): Effect.Effect<A> => {
  let made: A | undefined
  return Effect.map(loadDurable(), (durable) => (made ??= make(durable)))
}

const tagOf = (name: string, options: DurableOptions) => (typeof options.key === "string" ? options.key : name)

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
  return (name, options, schemas, implementation) => {
    const key = tagOf(name, options)
    const durable = once((Durable) =>
      Durable.task(key, { ...passed(options), payload: schemas.payload, success: schemas.success, error: schemas.error } as any)
    )
    const task: any = (...args: ReadonlyArray<unknown>) => Effect.flatMap(durable, (t: any) => t(payloadOf(schemas, args)))
    task.toLayer = (run: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown, unknown>) =>
      Layer.unwrap(Effect.map(durable, (t: any) => t.toLayer((payload: Record<string, unknown>) => run(...argsOf(schemas, payload)))))
    task.layer = implementation === undefined ? Layer.empty : task.toLayer(implementation)
    return define(task, key, options, schemas)
  }
}

/**
 * A workflow declaration's value. `reached` lists the tasks declared before
 * it in its file that its body runs, whose requirements W.layer's type
 * carries; `others`, the other names its body calls, which W.layer also
 * composes when they are tasks or workflows.
 */
export function $workflow<P extends ReadonlyArray<unknown>, A, E, R, const Sc extends DurableSchemas, T = never>(
  name: string,
  options: DurableOptions,
  schemas: Sc,
  body: (...args: P) => Effect.Effect<A, E, R>,
  reached?: () => ReadonlyArray<T>,
  others?: () => ReadonlyArray<unknown>
): Workflow<P, Exclude<A, Handoff>, E, Sc, Reached<T>> {
  const key = tagOf(name, options)
  const durable = once((Durable) =>
    Durable.workflow(key, { ...passed(options), payload: schemas.payload, success: schemas.success, error: schemas.error } as any)
  )
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
    const layers = [...(reached?.() ?? []), ...(others?.() ?? [])].flatMap((value: any) =>
      value !== workflow && value?.["~durable"] === true && value.layer !== undefined ? [value.layer] : []
    )
    const handler = w.toLayer((payload: Record<string, unknown>) => rounds(argsOf(schemas, payload)))
    return layers.length === 0 ? handler : Layer.provide(handler, Layer.mergeAll(...(layers as [any, ...Array<any>])))
  }))
  return define(workflow, key, options, schemas)
}

/**
 * `return W.to(…)` in W's own body, which the parser writes with W's
 * parameter types so the handoff's type does not depend on W's (VIP-55).
 * @throws {never}
 */
export function $handoff<P extends ReadonlyArray<unknown>>(key: string, ...args: P): Handoff<P> {
  return { _tag: "Handoff", key, args }
}
