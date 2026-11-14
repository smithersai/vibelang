/**
 * A bounded recursion: a tree of inputs expands level by level inside a
 * depth, fan-out and fuel envelope, and a nested recursion may narrow its
 * parent's envelope but never widen it.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { PatternError } from "./PatternError.js"
import type * as Trellis from "./Trellis.js"

/**
 * The bounds of a recursion: `fuel` is the total child calls of the whole
 * tree, `depth` the levels, and `fanout` the most children of one branch.
 *
 * @category models
 * @since 0.0.13
 */
export type Envelope = Trellis.Envelope

/**
 * One branch of the input tree. A value with an own `input` is a branch; its
 * `children`, when present, expand below it. Any other value is a leaf.
 *
 * @category models
 * @since 0.0.13
 */
export interface Branch {
  readonly input: unknown
  readonly children?: ReadonlyArray<Branch> | undefined
}

/**
 * What the child stage receives: the branch's input and the envelope left for
 * the levels below it.
 *
 * @category models
 * @since 0.0.13
 */
export interface Call {
  readonly input: unknown
  readonly envelope: Envelope
}

/**
 * The stages of {@link run}. `parent` is the envelope of an enclosing
 * recursion; the bounds here must fit inside it.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<A, E, R> extends Envelope {
  readonly child: (call: Call) => Effect.Effect<A, E, R>
  readonly parent?: Envelope | undefined
}

/**
 * What a recursion gives: a leaf's child result, or for a branch the record of
 * its children's results keyed `child-0`, `child-1` and so on. A branch's own
 * child result is not kept.
 *
 * @category models
 * @since 0.0.13
 */
export type Result<A> = A | { readonly [key: string]: Result<A> }

const valid = (value: number): boolean => Number.isSafeInteger(value) && value >= 1

const bound = (message: string): PatternError => new PatternError({ code: "recursion_bound", message })

// One admitted node: its call and the nodes admitted below it.
interface Admitted {
  readonly call: Call
  readonly children: ReadonlyArray<Admitted>
}

/**
 * Checks the whole tree against the envelope, then runs `child` for every
 * node: a branch's children start after its own call succeeds and run
 * together. Fuel is shared by the whole tree and spent in depth-first order,
 * depth falls by one each level, and every child list is checked against
 * `fanout`. No child runs when any part of the tree is refused.
 *
 * Fails with `PatternError` (`recursion_bound`) when a bound is not a positive
 * safe integer, a bound widens `parent`, the tree spends more than `fuel`
 * calls, a branch has more than `fanout` children or nests deeper than
 * `depth`, or a branch's `children` is not an array.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <A, E, R>(tree: unknown, options: Options<A, E, R>): Effect.Effect<Result<A>, E | PatternError, R> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const envelope: Envelope = { fuel: options.fuel, depth: options.depth, fanout: options.fanout }
  const child = options.child
  const parent = options.parent
  if (!valid(envelope.fuel) || !valid(envelope.depth) || !valid(envelope.fanout)) {
    return Effect.fail(bound("Recursion bounds must be positive safe integers"))
  }
  if (parent !== undefined) {
    for (const field of ["fuel", "depth", "fanout"] as const) {
      if (!valid(parent[field])) {
        return Effect.fail(bound(`Recursion parent ${field} must be a positive safe integer, received ${parent[field]}`))
      }
    }
    if (envelope.fuel > parent.fuel || envelope.depth > parent.depth || envelope.fanout > parent.fanout) {
      return Effect.fail(bound("Nested recursion may attenuate but cannot widen its parent envelope"))
    }
  }
  let remaining = envelope.fuel
  const admit = (value: unknown, depth: number): Admitted | PatternError => {
    if (remaining < 1) return bound("Recursion fuel is exhausted")
    const branch: Branch = typeof value === "object" && value !== null && Object.hasOwn(value, "input")
      ? value as Branch
      : { input: value }
    let children: ReadonlyArray<unknown> = []
    if (Object.hasOwn(branch, "children")) {
      const declared = (branch as { readonly children?: unknown }).children
      if (!Array.isArray(declared)) {
        return bound(`Recursive branch children must be an array when present, received ${typeof declared}`)
      }
      children = declared
    }
    if (children.length > envelope.fanout) return bound("Recursive child fan-out exceeds the envelope")
    if (children.length > 0 && depth <= 1) return bound("Recursive child depth exceeds the envelope")
    remaining--
    const call: Call = { input: branch.input, envelope: { fuel: remaining, depth: depth - 1, fanout: envelope.fanout } }
    const admitted: Array<Admitted> = []
    for (const member of children) {
      const below = admit(member, depth - 1)
      if (below instanceof PatternError) return below
      admitted.push(below)
    }
    return { call, children: admitted }
  }
  const root = admit(tree, envelope.depth)
  if (root instanceof PatternError) return Effect.fail(root)
  const visit = (node: Admitted): Effect.Effect<Result<A>, E, R> => {
    if (node.children.length === 0) return child(node.call)
    return Effect.andThen(
      child(node.call),
      Effect.map(
        Effect.forEach(node.children, visit, { concurrency: "unbounded" }),
        (results) => Object.fromEntries(results.map((result, index) => [`child-${index}`, result]))
      )
    )
  }
  return visit(root)
}
