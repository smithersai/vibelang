import { expect, test } from "bun:test"
import fc from "fast-check"
import { Cause, Effect, Fiber, Latch, Result } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as KanbanModule from "vibelang-runtime/experimental/patterns/Kanban"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { Kanban, PatternError } = Patterns

const items = [{ id: "a" }, { id: "b" }, { id: "c" }]
const columns = [{ name: "triage" }, { name: "build" }]

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

test("Kanban: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(KanbanModule.run).toBe(Kanban.run)
})

test("Kanban.run finishes a column for every item before the next column starts", async () => {
  const trace: Array<string> = []
  const result = await run(Kanban.run(items, {
    concurrency: 3,
    columns: columns.map((column) => ({
      name: column.name,
      run: ({ column: name, item, previous }: { readonly column: string; readonly item: { readonly id: string }; readonly previous: string | undefined }) =>
        Effect.gen(function*() {
          trace.push(`start ${name}:${item.id}`)
          yield* Effect.yieldNow
          trace.push(`end ${name}:${item.id}`)
          return previous === undefined ? name : `${previous}>${name}`
        })
    }))
  }))
  expect(trace.indexOf("end triage:a")).toBeLessThan(trace.indexOf("start build:a"))
  expect(trace.indexOf("end triage:c")).toBeLessThan(trace.indexOf("start build:a"))
  expect(result.completed).toEqual(["a", "b", "c"])
  expect(result.board["a"]).toEqual({ triage: "triage", build: "triage>build" })
  expect(result.failed).toEqual([])
  expect(result.iterations).toBe(1)
})

test("Kanban.run never runs more items at once than the per-column concurrency bound", async () => {
  const program = Effect.gen(function*() {
    // Every started item waits on `held`, so what runs at once is what the
    // bound admits, not what the scheduler interleaved.
    const held = yield* Latch.make()
    const saturated = yield* Latch.make()
    const entered: Array<string> = []
    let inFlight = 0
    let peak = 0
    const running = yield* Kanban.run([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], {
      concurrency: 2,
      columns: [{
        name: "triage",
        run: ({ item }) =>
          Effect.gen(function*() {
            inFlight += 1
            peak = Math.max(peak, inFlight)
            entered.push(item.id)
            if (entered.length === 2) yield* Latch.open(saturated)
            yield* Latch.await(held)
            inFlight -= 1
            return "ok"
          })
      }]
    }).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Latch.await(saturated)
    const whileHeld = { entered: [...entered], inFlight }
    yield* Latch.open(held)
    const result = yield* Fiber.join(running)
    return { whileHeld, result, entered, peak }
  })
  const { whileHeld, result, entered, peak } = await run(program)
  expect(whileHeld).toEqual({ entered: ["a", "b"], inFlight: 2 })
  expect(result.completed).toEqual(["a", "b", "c", "d"])
  expect(entered).toEqual(["a", "b", "c", "d"])
  expect(peak).toBe(2)
})

test("Kanban.run drops a failed item and lets the rest finish the board", async () => {
  const seen: Array<string> = []
  const result = await run(Kanban.run(items, {
    concurrency: 3,
    columns: columns.map((column) => ({
      name: column.name,
      run: ({ column: name, item }: { readonly column: string; readonly item: { readonly id: string } }) =>
        Effect.suspend(() => {
          seen.push(`${name}:${item.id}`)
          return item.id === "b" && name === "triage" ? Effect.fail("b is blocked") : Effect.succeed(name)
        })
    }))
  }))
  expect(result.completed).toEqual(["a", "c"])
  expect(result.failed).toEqual([{ id: "b", column: "triage", error: "b is blocked" }])
  expect(seen).toEqual(["triage:a", "triage:b", "triage:c", "build:a", "build:c"])
  expect(result.board["b"]).toEqual(undefined)
})

test("Kanban.run propagates a card defect instead of dropping the item from the board", async () => {
  const defect = new Error("the card threw")
  const exit = await Effect.runPromiseExit(Kanban.run([{ id: "a" }, { id: "b" }], {
    concurrency: 2,
    columns: [{ name: "triage", run: ({ item }) => item.id === "b" ? Effect.die(defect) : Effect.succeed("ok") }]
  }))
  expect(exit._tag).toBe("Failure")
  if (exit._tag === "Failure") {
    expect(Cause.hasDies(exit.cause)).toBe(true)
    expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(defect)
  }
})

test("Kanban.run does not admit a column appended while a pass is in flight", async () => {
  const trace: Array<string> = []
  const runtimeColumns: Array<Patterns.Kanban.RuntimeColumn<Patterns.Kanban.Item, string, never, never>> = []
  const late: Patterns.Kanban.RuntimeColumn<Patterns.Kanban.Item, string, never, never> = {
    name: "late",
    run: () => Effect.sync(() => (trace.push("late"), "late-done"))
  }
  runtimeColumns.push({
    name: "first",
    run: () => Effect.sync(() => (trace.push("first"), runtimeColumns.push(late), "first-done"))
  })
  const result = await run(Kanban.run([{ id: "a" }], { columns: runtimeColumns, concurrency: 1 }))
  expect(trace).toEqual(["first"])
  expect(result).toEqual({ board: { a: { first: "first-done" } }, completed: ["a"], failed: [], iterations: 1 })
})

test("Kanban.run materialises prototype-shaped item and column names as own data properties", async () => {
  const names = ["__proto__", "constructor", "toString", "normal"]
  const result = await run(Kanban.run(names.map((id) => ({ id })), {
    concurrency: 4,
    columns: names.map((name) => ({ name, run: ({ item }: { readonly item: { readonly id: string } }) => Effect.succeed(`${item.id}:${name}`) }))
  }))
  expect(Object.getPrototypeOf(result.board)).toBe(Object.prototype)
  for (const id of names) {
    expect(Object.hasOwn(result.board, id)).toBe(true)
    const row = result.board[id]!
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
    for (const column of names) {
      expect(Object.hasOwn(row, column)).toBe(true)
      expect(row[column]).toBe(`${id}:${column}`)
    }
  }
})

test("Kanban.run stops the until loop at maxIterations", async () => {
  let passes = 0
  const result = await run(Kanban.run([{ id: "a" }], {
    concurrency: 1,
    maxIterations: 3,
    until: () => false,
    columns: [{ name: "triage", run: () => Effect.sync(() => (passes += 1, "ok")) }]
  }))
  expect(passes).toBe(3)
  expect(result.iterations).toBe(3)
})

test("Kanban.run evaluates until on the final allowed pass", async () => {
  let calls = 0
  const result = await run(Kanban.run([{ id: "a" }], {
    concurrency: 1,
    maxIterations: 1,
    until: () => (calls += 1, true),
    columns: [{ name: "triage", run: () => Effect.succeed("ok") }]
  }))
  expect(result.iterations).toBe(1)
  expect(calls).toBe(1)
})

test("Kanban.run evaluates until once per completed pass before stopping on pass two", async () => {
  let calls = 0
  const result = await run(Kanban.run([{ id: "a" }], {
    concurrency: 1,
    maxIterations: 3,
    until: () => (calls += 1, calls === 2),
    columns: [{ name: "triage", run: () => Effect.succeed("ok") }]
  }))
  expect(result.iterations).toBe(2)
  expect(calls).toBe(2)
})

test("Kanban.run stops the until loop as soon as the predicate holds", async () => {
  let passes = 0
  const result = await run(Kanban.run([{ id: "a" }], {
    concurrency: 1,
    maxIterations: 5,
    until: (board) => board.iterations === 2,
    columns: [{ name: "triage", run: () => Effect.sync(() => (passes += 1, "ok")) }]
  }))
  expect(passes).toBe(2)
  expect(result.iterations).toBe(2)
})

test("Kanban.run runs maxIterations passes when no predicate is given, and one pass by default", async () => {
  let passes = 0
  const column = { name: "triage", run: () => Effect.sync(() => (passes += 1, "ok")) }
  const bounded = await run(Kanban.run([{ id: "a" }], { concurrency: 1, maxIterations: 3, columns: [column] }))
  expect(passes).toBe(3)
  expect(bounded.iterations).toBe(3)
  passes = 0
  const once = await run(Kanban.run([{ id: "a" }], { concurrency: 1, columns: [column] }))
  expect(passes).toBe(1)
  expect(once.iterations).toBe(1)
})

test("Kanban.run calls onComplete exactly once with the items and the final board", async () => {
  const seen: Array<unknown> = []
  const declaredItems = [{ id: "a" }]
  const result = await run(Kanban.run(declaredItems, {
    concurrency: 1,
    maxIterations: 2,
    columns: [{ name: "triage", run: () => Effect.succeed("ok") }],
    onComplete: (input) => Effect.sync(() => seen.push(input))
  }))
  expect(seen).toHaveLength(1)
  expect(seen[0]).toEqual({ items: declaredItems, board: result })
  const without = await run(Kanban.run(declaredItems, {
    concurrency: 1,
    columns: [{ name: "triage", run: () => Effect.succeed("ok") }]
  }))
  expect(without).toEqual({ board: { a: { triage: "ok" } }, completed: ["a"], failed: [], iterations: 1 })
})

test("Kanban.run uses an onComplete failure as the run failure", async () => {
  const failure = await run(Effect.flip(Kanban.run([{ id: "a" }], {
    concurrency: 1,
    columns: [{ name: "triage", run: () => Effect.succeed("ok") }],
    onComplete: () => Effect.fail("report failed")
  })))
  expect(failure).toBe("report failed")
})

test("Kanban.run refuses bad options with PatternError before a column runs", async () => {
  let ran = 0
  const column = { name: "triage", run: () => Effect.sync(() => (ran += 1, "ok")) }
  const refusal = async (effect: Effect.Effect<unknown, unknown>) => {
    const error = await run(Effect.flip(effect))
    expect(error).toBeInstanceOf(PatternError)
    expect((error as InstanceType<typeof PatternError>).code).toBe("invalid_decorator")
    return (error as InstanceType<typeof PatternError>).message
  }
  expect(await refusal(Kanban.run(items, { concurrency: 0, columns: [column] })))
    .toBe("Kanban concurrency must be a positive safe integer")
  expect(await refusal(Kanban.run([{ id: "a" }, { id: "a" }], { concurrency: 2, columns: [column] })))
    .toBe("Kanban item ids must be unique")
  expect(await refusal(Kanban.run([{ id: "a" }], { concurrency: 1, columns: [column, column] })))
    .toBe("Kanban column names must be unique")
  expect(await refusal(Kanban.run([], { concurrency: 1, columns: [column] })))
    .toBe("Kanban requires at least one item")
  expect(await refusal(Kanban.run(items, { concurrency: 1, until: () => false, columns: [column] })))
    .toBe("Kanban until requires maxIterations")
  expect(await refusal(Kanban.run(items, { concurrency: 1, maxIterations: 0, until: () => false, columns: [column] })))
    .toBe("Kanban maxIterations must be a positive safe integer")
  expect(await refusal(Kanban.run(items, { concurrency: 1, columns: [] })))
    .toBe("Kanban requires at least one column")
  expect(ran).toBe(0)
})

test("Kanban.run reads its items, columns and options at the call, not when the Effect runs", async () => {
  const seen: Array<string> = []
  const column: Patterns.Kanban.RuntimeColumn<Patterns.Kanban.Item, string, never, never> = {
    name: "triage",
    run: ({ item }) => Effect.sync(() => (seen.push(item.id), "ok"))
  }
  const mutableItems = [{ id: "a" }]
  const mutableColumns = [column]
  const options = { columns: mutableColumns, concurrency: 1 }
  const board = Kanban.run(mutableItems, options)
  mutableItems.push({ id: "a" })
  mutableColumns[0] = { name: "triage", run: () => Effect.sync(() => (seen.push("swapped"), "swapped")) }
  mutableColumns.push({ name: "late", run: () => Effect.sync(() => (seen.push("late"), "late")) })
  options.concurrency = 5
  const result = await run(board)
  expect(seen).toEqual(["a"])
  expect(result).toEqual({ board: { a: { triage: "ok" } }, completed: ["a"], failed: [], iterations: 1 })
})

test("Kanban.run keys the board by the id an item carried when run was called", async () => {
  const item = { id: "a" }
  const board = Kanban.run([item], {
    concurrency: 1,
    columns: [{ name: "triage", run: ({ item: card }) => Effect.succeed(card === item) }]
  })
  item.id = "renamed"
  const result = await run(board)
  expect(result.board).toEqual({ a: { triage: true } })
  expect(result.completed).toEqual(["a"])
})

test("property: a kanban card completes exactly when no column rejects it, and fails at the first column that does", async () => {
  await checkProperty(fc, {
    name: "patterns-kanban-first-rejection",
    rule: "VIP-73: Kanban.run moves every item through the columns in order; a column that rejects an item drops it from later columns and lists it in failed",
    command: "bun test tests/experimental-patterns-kanban.test.ts",
    arbitrary: fc.record({
      // rejects[item][column]: whether that column rejects that item.
      rejects: fc.array(fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }), { minLength: 1, maxLength: 6 }),
      concurrency: fc.integer({ min: 1, max: 4 })
    }),
    numRuns: 200,
    check: async ({ rejects, concurrency }: { readonly rejects: ReadonlyArray<ReadonlyArray<boolean>>; readonly concurrency: number }) => {
      const ids = rejects.map((_, index) => `i${index}`)
      const names = ["c0", "c1", "c2"]
      const result = await run(Kanban.run(ids.map((id) => ({ id })), {
        concurrency,
        columns: names.map((name, column) => ({
          name,
          run: ({ item, previous }: { readonly item: { readonly id: string }; readonly previous: number | undefined }) =>
            rejects[Number(item.id.slice(1))]![column] ? Effect.fail(name) : Effect.succeed((previous ?? 0) + 1)
        }))
      }))
      const firstRejection = rejects.map((row) => row.indexOf(true))
      expect(result.completed).toEqual(ids.filter((_, index) => firstRejection[index] === -1))
      expect([...result.failed].sort((a, b) => a.id.localeCompare(b.id)))
        .toEqual(ids.flatMap((id, index) => firstRejection[index] === -1 ? [] : [{ id, column: names[firstRejection[index]!]!, error: names[firstRejection[index]!]! }]).sort((a, b) => a.id.localeCompare(b.id)))
      for (const [index, id] of ids.entries()) {
        const cleared = firstRejection[index] === -1 ? 3 : firstRejection[index]!
        expect(Object.keys(result.board[id] ?? {})).toEqual(names.slice(0, cleared))
        if (cleared > 0) expect(result.board[id]![names[cleared - 1]!]).toBe(cleared)
      }
    }
  })
})
