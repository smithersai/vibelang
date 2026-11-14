import { expect, test } from "bun:test"
import fc from "fast-check"
import { Deferred, Effect, Fiber } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as RecursionModule from "vibelang-runtime/experimental/patterns/Recursion"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { PatternError, Recursion } = Patterns
type Call = Patterns.Recursion.Call

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

// A child stage that records each call and answers its input.
const recorded = () => {
  const calls: Array<Call> = []
  const child = (call: Call) => Effect.sync(() => (calls.push(call), call.input))
  return { calls, child }
}

const refusal = async (tree: unknown, options: Omit<Patterns.Recursion.Options<unknown, never, never>, "child">) => {
  const { calls, child } = recorded()
  const failure = await run(Effect.flip(Recursion.run(tree, { ...options, child })))
  expect(failure).toBeInstanceOf(PatternError)
  expect(calls).toEqual([])
  return failure
}

test("Recursion: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(RecursionModule.run).toBe(Recursion.run)
})

test("Recursion.run calls the child for every node under an attenuated envelope, and gives the children's results", async () => {
  const { calls, child } = recorded()
  const result = await run(Recursion.run({
    input: "root",
    children: [{ input: "left", children: [{ input: "leaf" }] }, { input: "right" }]
  }, { child, fuel: 4, depth: 3, fanout: 2 }))
  expect(calls).toEqual([
    { input: "root", envelope: { fuel: 3, depth: 2, fanout: 2 } },
    { input: "left", envelope: { fuel: 2, depth: 1, fanout: 2 } },
    { input: "leaf", envelope: { fuel: 1, depth: 0, fanout: 2 } },
    { input: "right", envelope: { fuel: 0, depth: 1, fanout: 2 } }
  ])
  expect(result).toEqual({ "child-0": { "child-0": "leaf" }, "child-1": "right" })
})

test("Recursion.run gives a plain input's child result as a leaf", async () => {
  const { calls, child } = recorded()
  expect(await run(Recursion.run("root", { child, fuel: 1, depth: 1, fanout: 1 }))).toBe("root")
  expect(calls).toEqual([{ input: "root", envelope: { fuel: 0, depth: 0, fanout: 1 } }])
})

test("Recursion.run starts a branch's children after its own call succeeds, together", async () => {
  const program = Effect.gen(function*() {
    const gate = yield* Deferred.make<void>()
    const both = [yield* Deferred.make<void>(), yield* Deferred.make<void>()]
    const order: Array<string> = []
    const fiber = yield* Effect.forkChild(Recursion.run({ input: "root", children: [{ input: 0 }, { input: 1 }] }, {
      fuel: 3,
      depth: 2,
      fanout: 2,
      child: ({ input }) =>
        Effect.gen(function*() {
          order.push(String(input))
          if (input === "root") return "root"
          yield* Deferred.succeed(both[input as number]!, undefined)
          yield* Deferred.await(gate)
          return input
        })
    }))
    yield* Effect.all(both.map((arrived) => Deferred.await(arrived)))
    yield* Deferred.succeed(gate, undefined)
    return { order, result: yield* Fiber.join(fiber) }
  })
  expect(await run(program)).toEqual({ order: ["root", "0", "1"], result: { "child-0": 0, "child-1": 1 } })
})

test("Recursion.run never calls the children of a branch whose own call failed", async () => {
  const calls: Array<unknown> = []
  const failure = await run(Effect.flip(Recursion.run({ input: "root", children: [{ input: "a" }] }, {
    fuel: 2,
    depth: 2,
    fanout: 1,
    child: ({ input }) => Effect.suspend(() => (calls.push(input), input === "root" ? Effect.fail("root broke") : Effect.succeed(input)))
  })))
  expect(failure).toBe("root broke")
  expect(calls).toEqual(["root"])
})

test("Recursion.run refuses exhausted and widened bounds before any child runs", async () => {
  for (const bounds of [{ fuel: 0, depth: 1, fanout: 1 }, { fuel: 1, depth: 1.5, fanout: 1 }, { fuel: 1, depth: 1, fanout: Number.NaN }]) {
    expect(await refusal("x", bounds)).toMatchObject({ code: "recursion_bound", message: "Recursion bounds must be positive safe integers" })
  }
  const parent = { fuel: 2, depth: 2, fanout: 2 }
  for (const bounds of [{ fuel: 3, depth: 2, fanout: 2 }, { fuel: 2, depth: 3, fanout: 2 }, { fuel: 2, depth: 2, fanout: 3 }]) {
    expect(await refusal("x", { ...bounds, parent })).toMatchObject({
      code: "recursion_bound",
      message: "Nested recursion may attenuate but cannot widen its parent envelope"
    })
  }
  expect(await refusal({ input: "root", children: [{ input: "a" }, { input: "b" }] }, { fuel: 3, depth: 3, fanout: 1 }))
    .toMatchObject({ code: "recursion_bound", message: "Recursive child fan-out exceeds the envelope" })
  expect(await refusal({ input: "root", children: [{ input: "a", children: [{ input: "b" }] }] }, { fuel: 2, depth: 3, fanout: 2 }))
    .toMatchObject({ code: "recursion_bound", message: "Recursion fuel is exhausted" })
})

test("Recursion.run admits an equal or attenuated parent envelope", async () => {
  const { child } = recorded()
  expect(await run(Recursion.run("x", { child, fuel: 2, depth: 1, fanout: 1, parent: { fuel: 2, depth: 2, fanout: 2 } }))).toBe("x")
  expect(await run(Recursion.run("x", { child, fuel: 2, depth: 2, fanout: 2, parent: { fuel: 2, depth: 2, fanout: 2 } }))).toBe("x")
})

test("Recursion.run refuses invalid parent envelope fields before attenuation", async () => {
  for (const [field, value] of [["fuel", Number.NaN], ["depth", Number.POSITIVE_INFINITY], ["fanout", 1.5]] as const) {
    const parent = { fuel: 2, depth: 2, fanout: 2, [field]: value }
    expect(await refusal("x", { fuel: 1, depth: 1, fanout: 1, parent })).toMatchObject({
      code: "recursion_bound",
      message: `Recursion parent ${field} must be a positive safe integer, received ${value}`
    })
  }
})

test("Recursion.run refuses non-array branch children", async () => {
  for (const [children, received] of [["x", "string"], [{ input: "nested" }, "object"]] as const) {
    expect(await refusal({ input: "root", children }, { fuel: 3, depth: 3, fanout: 2 })).toMatchObject({
      code: "recursion_bound",
      message: `Recursive branch children must be an array when present, received ${received}`
    })
  }
})

test("Recursion.run treats a value without an own input property as an opaque leaf", async () => {
  const { calls, child } = recorded()
  const leaf = { children: [{ input: "nested" }] }
  expect(await run(Recursion.run(leaf, { child, fuel: 3, depth: 3, fanout: 2 }))).toBe(leaf)
  const inherited = Object.create({ input: "forged", children: [{ input: "nested" }] })
  expect(await run(Recursion.run(inherited, { child, fuel: 3, depth: 3, fanout: 2 }))).toBe(inherited)
  expect(calls).toHaveLength(2)
})

test("Recursion.run admits the declared depth and refuses one level past it", async () => {
  const { calls, child } = recorded()
  await run(Recursion.run({ input: "root", children: [{ input: "middle", children: [{ input: "leaf" }] }] }, { child, fuel: 4, depth: 3, fanout: 1 }))
  expect(calls).toHaveLength(3)
  const pastBound = { input: "root", children: [{ input: "middle", children: [{ input: "leaf", children: [{ input: "past" }] }] }] }
  expect(await refusal(pastBound, { fuel: 4, depth: 3, fanout: 1 })).toMatchObject({
    code: "recursion_bound",
    message: "Recursive child depth exceeds the envelope"
  })
})

test("Recursion.run reads its tree and options at the call, not when the Effect runs", async () => {
  const { calls, child } = recorded()
  const children = [{ input: "a" }]
  const options = { child, fuel: 2, depth: 2, fanout: 1 }
  const program = Recursion.run({ input: "root", children }, options)
  children.push({ input: "late" })
  options.fuel = 9
  await run(program)
  expect(calls.map((call) => call.input)).toEqual(["root", "a"])
})

interface Tree {
  readonly input: number
  readonly children?: ReadonlyArray<Tree>
}

const treeArbitrary: fc.Arbitrary<Tree> = fc.letrec<{ readonly tree: Tree }>((tie) => ({
  tree: fc.record({
    input: fc.nat(9),
    // An absent key is a leaf; a present key is always an array.
    children: fc.array(tie("tree"), { maxLength: 3, depthIdentifier: "tree" })
  }, { requiredKeys: ["input"] }) as fc.Arbitrary<Tree>
})).tree

const measure = (tree: Tree): { readonly nodes: number; readonly depth: number; readonly widest: number } => {
  const below = (tree.children ?? []).map(measure)
  return {
    nodes: 1 + below.reduce((sum, child) => sum + child.nodes, 0),
    depth: 1 + Math.max(0, ...below.map((child) => child.depth)),
    widest: Math.max(tree.children?.length ?? 0, ...below.map((child) => child.widest))
  }
}

test("property: a recursion runs exactly when the tree fits its envelope, and then calls the child once per node", async () => {
  await checkProperty(fc, {
    name: "patterns-recursion-envelope",
    rule: "VIP-73: Recursion.run expands a tree recursively inside a depth and fan-out envelope, with fuel shared by the whole tree",
    command: "bun test tests/experimental-patterns-recursion.test.ts",
    arbitrary: fc.record({
      tree: treeArbitrary,
      fuel: fc.integer({ min: 1, max: 12 }),
      depth: fc.integer({ min: 1, max: 4 }),
      fanout: fc.integer({ min: 1, max: 3 })
    }),
    numRuns: 200,
    check: async ({ tree, fuel, depth, fanout }: { readonly tree: Tree; readonly fuel: number; readonly depth: number; readonly fanout: number }) => {
      const { calls, child } = recorded()
      const shape = measure(tree)
      // A node with an empty child list counts as a leaf for depth.
      const fits = shape.nodes <= fuel && shape.depth <= depth && shape.widest <= fanout
      const exit = await Effect.runPromiseExit(Recursion.run(tree, { child, fuel, depth, fanout }))
      expect(exit._tag).toBe(fits ? "Success" : "Failure")
      expect(calls).toHaveLength(fits ? shape.nodes : 0)
    }
  })
})
