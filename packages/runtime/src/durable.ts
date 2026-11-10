import * as Context from "effect/Context"
import * as Effect from "effect/Effect"

/**
 * Durable declarations (VIP-55). The parser writes
 *
 *     task FetchIssues { effect call(repo: string): Issues!string { … } }
 *     workflow Triage { effect call(repo: string) { … } }
 *
 * as
 *
 *     const FetchIssues = $task<(repo: string) => Issues!string>()("FetchIssues", {}, effect function call(repo: string) { … })
 *     const Triage = $workflow("Triage", {}, effect function call(repo: string) { … })
 *
 * A task's type argument is its written boundary: its parameters, success and
 * error. Its body's requirements stay inferred, and belong to the task's
 * implementation, not to a caller. A workflow takes its boundary from its body.
 */

/** The `static readonly` members of a task or workflow, passed through by name. */
export type DurableOptions = { readonly [option: string]: unknown }

/** A task declaration (VIP-55): one recorded step of a workflow run. */
export interface Task<P extends ReadonlyArray<unknown>, A, E, R> {
  /** A step of the enclosing workflow's plan. A task runs only inside a workflow. */
  (...args: P): Effect.Effect<A, E, never>
  /** The declared name, or a written `static readonly key`. */
  readonly key: string
  readonly options: DurableOptions
  /** The implementation's own requirements. */
  readonly "~requirements"?: R
}

/** A workflow declaration (VIP-55): a plan over tasks, run by a durable engine. */
export interface Workflow<P extends ReadonlyArray<unknown>, A, E> {
  /** Runs the workflow to completion. Equal input joins the run that input already started. */
  (...args: P): Effect.Effect<A, E, DurableEngine>
  /** The declared name, or a written `static readonly key`. */
  readonly key: string
  readonly options: DurableOptions
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
const define = <F extends Function>(fn: F, name: string, options: DurableOptions): F => {
  const key = typeof options.key === "string" ? options.key : name
  return Object.defineProperties(fn, {
    key: { value: key, enumerable: true },
    options: { value: options, enumerable: true },
    name: { value: key }
  })
}

/** A task declaration's value; `S` is its written boundary signature. */
export function $task<S extends Boundary>(): <R = never>(
  key: string,
  options: DurableOptions,
  implementation?: (...args: Parameters<S>) => Effect.Effect<Effect.Success<ReturnType<S>>, Effect.Error<ReturnType<S>>, R>
) => Task<Parameters<S>, Effect.Success<ReturnType<S>>, Effect.Error<ReturnType<S>>, R> {
  return (key, options, implementation) => {
    const task: any = (..._args: ReadonlyArray<unknown>) =>
      Effect.die(new TypeError(`task ${key} runs only as a step of a workflow`))
    task.implementation = implementation
    return define(task, key, options)
  }
}

/** A workflow declaration's value. */
export function $workflow<P extends ReadonlyArray<unknown>, A, E, R>(
  key: string,
  options: DurableOptions,
  body: (...args: P) => Effect.Effect<A, E, R>
): Workflow<P, A, E> {
  const workflow: any = (...args: P) =>
    Effect.flatMap(Effect.service(DurableEngine), (engine) => engine.execute(workflow, args)) as Effect.Effect<A, E, DurableEngine>
  workflow.body = body
  return define(workflow, key, options)
}
