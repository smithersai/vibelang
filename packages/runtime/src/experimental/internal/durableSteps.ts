/**
 * Stable names for the steps a run does not name itself: a task's calls and
 * unnamed timers are numbered 1, 2, 3 in the order a replay reaches them.
 *
 * The number must be the same on every replay. Two things break that. A
 * recorded race returns its recorded winner on a replay without running its
 * arms, so a step inside an arm stops counting, and Effect runs a race's arms
 * on a copy of the workflow instance. So each named race is its own scope
 * with its own counts: what happens inside it never moves a number outside
 * it. A numbered step in a copy that no named race made, which is what
 * Effect's own `DurableDeferred.raceAll` and `into` produce, has no stable
 * number, and is refused.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { WorkflowEngine } from "effect/workflow"

type Instance = WorkflowEngine.WorkflowInstance["Service"]

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** True when `text` holds no half of a surrogate pair on its own. */
export const isWellFormed = (text: string): boolean => text.search(loneSurrogate) === -1

/** A name as part of a journal key: no "/" or "#", and never a throw on malformed text. */
export const encodeName = (name: string): string => encodeURIComponent(name.replace(loneSurrogate, "\uFFFD"))

/** A step whose number would change on a replay. */
export class UnstableStep extends Schema.TaggedError<UnstableStep>()("UnstableStep", {
  message: Schema.String
}) {}

// The scope of the instance copy a named race runs its arms on: the names of
// the races around it, each followed by "/".
const scopes = new WeakMap<object, string>()

/** The scope `instance` runs in: "" outside every named race. */
export const scopeOf = (instance: Instance): string => scopes.get(instance) ?? ""

/** Marks `instance`, the copy a named race's arms run on, with the race's scope. */
export const enterScope = (instance: Instance, scope: string): void => {
  scopes.set(instance, scope)
}

// The instance a workflow's body starts on, and the replay it belongs to.
// Only a workflow declared with `Experimental.Durable.workflow` marks them.
const roots = new WeakSet<object>()
const rootedReplays = new WeakSet<object>()

/**
 * Makes the body `workflow.toLayer` registers mark the instance it starts on
 * as the run's own, so a numbered step can tell the body from a copy of it.
 * The override is not enumerable: a copy `annotate` makes is an ordinary
 * workflow again.
 */
export const rooted = <W extends object>(workflow: W): W => {
  const toLayer = (workflow as { toLayer: (execute: Body) => unknown }).toLayer
  Object.defineProperty(workflow, "toLayer", {
    configurable: true,
    writable: true,
    enumerable: false,
    value: (execute: Body) =>
      toLayer.call(workflow, (payload: unknown, executionId: string) =>
        Effect.flatMap(Effect.service(WorkflowEngine.WorkflowInstance), (root) => {
          roots.add(root)
          rootedReplays.add(root.awaitedDeferreds)
          return execute(payload, executionId)
        }))
  })
  return workflow
}

type Body = (payload: any, executionId: string) => Effect.Effect<any, any, any>

interface Count {
  n: number
  readonly owner: Instance
}

// One replay's counts. Every copy of an instance shares `awaitedDeferreds`,
// and each replay starts a new instance, so the map is the replay's.
const counts = new WeakMap<object, Map<string, Count>>()

/**
 * The next number of `key` in the scope `instance` runs in, with the scope in
 * front: "1", "2", and "payment/1" inside the race named "payment". `what`
 * names the step in a refusal, and `remedy` adds what else would fix it.
 */
export const nextOccurrence = (instance: Instance, key: string, what: string, remedy = ""): string => {
  const marked = scopes.get(instance)
  if (marked === undefined && rootedReplays.has(instance.awaitedDeferreds) && !roots.has(instance)) {
    throw new UnstableStep({
      message: `${what} is reached inside a DurableDeferred.raceAll or into. ` +
        "A recorded race skips its body on a replay, so a step it numbers would shift the numbers after it. " +
        `Race with Experimental.Durable.race, which numbers its own steps${remedy}.`
    })
  }
  let byKey = counts.get(instance.awaitedDeferreds)
  if (byKey === undefined) {
    byKey = new Map()
    counts.set(instance.awaitedDeferreds, byKey)
  }
  const scope = marked ?? ""
  const id = `${scope}\u0000${key}`
  const count = byKey.get(id)
  if (count === undefined) {
    byKey.set(id, { n: 1, owner: instance })
    return `${scope}1`
  }
  // A workflow that Effect's `Workflow.make` declares marks no instance, so
  // a copy shows only when it and the body both number the same step.
  if (count.owner !== instance) {
    throw new UnstableStep({
      message: `${what} is reached both inside and outside a DurableDeferred.raceAll or into of one run. ` +
        "A recorded race skips its body on a replay, so the step's number would change. " +
        `Race with Experimental.Durable.race, which numbers its own steps${remedy}.`
    })
  }
  count.n++
  return `${scope}${count.n}`
}
