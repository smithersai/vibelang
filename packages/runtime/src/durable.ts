import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"

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
 *     const Triage = $workflow("Triage", {}, { payload: { repo: Schema.String } }, effect function call(repo: string) { … })
 *
 * A task's type argument is its written boundary: its parameters, success and
 * error. Its body's requirements stay inferred, and belong to the task's
 * implementation, not to a caller. A workflow takes its boundary from its body.
 * The schemas are the boundary's, derived from the written types (VIP-44): a
 * payload field for each parameter, and the success and error of a written
 * `A!E`.
 */

/** The schemas of a durable boundary (VIP-44). */
export interface DurableSchemas {
  readonly payload: { readonly [parameter: string]: Schema.Top }
  readonly success?: Schema.Top
  readonly error?: Schema.Top
}

/** The `static readonly` members of a task or workflow, passed through by name. */
export type DurableOptions = { readonly [option: string]: unknown }

/** A task declaration (VIP-55): one recorded step of a workflow run. */
export interface Task<P extends ReadonlyArray<unknown>, A, E, R, S extends DurableSchemas = DurableSchemas> {
  /** A step of the enclosing workflow's plan. A task runs only inside a workflow. */
  (...args: P): Effect.Effect<A, E, never>
  /** The declared name, or a written `static readonly key`. */
  readonly key: string
  readonly options: DurableOptions
  /** The boundary's schemas, derived from the written types. */
  readonly schemas: S
  /** The implementation's own requirements. */
  readonly "~requirements"?: R
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
export interface Workflow<P extends ReadonlyArray<unknown>, A, E, S extends DurableSchemas = DurableSchemas> {
  /** Runs the workflow to completion. Equal input joins the run that input already started. */
  (...args: P): Effect.Effect<A, E, DurableEngine>
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
}

/**
 * The durable engine a workflow runs on (VIP-60, `Experimental.Durable`). A
 * program that runs a workflow without one has a missing requirement.
 */
export class DurableEngine extends /* @__PURE__ */ Context.Service<DurableEngine, {
  readonly execute: (workflow: Workflow<ReadonlyArray<unknown>, unknown, unknown>, args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>
}>()("vibelang/Durable/Engine") {}

type Boundary = (...args: any) => Effect.Effect<any, any, any>

// A written `static readonly key` replaces the declared name.
const define = <F extends Function>(fn: F, name: string, options: DurableOptions, schemas: DurableSchemas): F => {
  const key = typeof options.key === "string" ? options.key : name
  return Object.defineProperties(fn, {
    key: { value: key, enumerable: true },
    options: { value: options, enumerable: true },
    schemas: { value: schemas, enumerable: true },
    name: { value: key }
  })
}

/** A task declaration's value; `S` is its written boundary signature. */
export function $task<S extends Boundary>(): <const Sc extends DurableSchemas, R = never>(
  key: string,
  options: DurableOptions,
  schemas: Sc,
  implementation?: (...args: Parameters<S>) => Effect.Effect<Effect.Success<ReturnType<S>>, Effect.Error<ReturnType<S>>, R>
) => Task<Parameters<S>, Effect.Success<ReturnType<S>>, Effect.Error<ReturnType<S>>, R, Sc> {
  return (key, options, schemas, implementation) => {
    const task: any = (..._args: ReadonlyArray<unknown>) =>
      Effect.die(new TypeError(`task ${key} runs only as a step of a workflow`))
    task.implementation = implementation
    return define(task, key, options, schemas)
  }
}

/** A workflow declaration's value. */
export function $workflow<P extends ReadonlyArray<unknown>, A, E, R, const Sc extends DurableSchemas>(
  key: string,
  options: DurableOptions,
  schemas: Sc,
  body: (...args: P) => Effect.Effect<A, E, R>
): Workflow<P, Exclude<A, Handoff>, E, Sc> {
  const workflow: any = (...args: P) =>
    Effect.flatMap(Effect.service(DurableEngine), (engine) => engine.execute(workflow, args)) as Effect.Effect<A, E, DurableEngine>
  workflow.body = body
  workflow.child = (..._args: P) => Effect.die(new TypeError(`${workflow.key}.child runs only as a step of a workflow`))
  workflow.to = (...args: P): Handoff<P> => ({ _tag: "Handoff", key: workflow.key, args })
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
