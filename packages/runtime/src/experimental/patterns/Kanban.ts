/**
 * A kanban board: every item moves through an ordered list of columns, with a
 * concurrency bound inside each column.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { PatternError } from "./PatternError.js"

/**
 * One card on the board. `id` keys the card's board row and its failure
 * entry, so it is unique across the items.
 *
 * @category models
 * @since 0.0.13
 */
export interface Item {
  readonly id: string
}

/**
 * One column. `previous` is what the same item produced in the column before,
 * and is `undefined` in the first column.
 *
 * @category models
 * @since 0.0.13
 */
export interface RuntimeColumn<It extends Item, Out, E, R> {
  readonly name: string
  readonly run: (args: {
    readonly item: It
    readonly column: string
    readonly previous: Out | undefined
  }) => Effect.Effect<Out, E, R>
}

/**
 * One item that a column rejected, and the error the column failed with.
 *
 * @category models
 * @since 0.0.13
 */
export interface Failure<E> {
  readonly id: string
  readonly column: string
  readonly error: E
}

/**
 * The board after the last pass. `board` holds one row per item that cleared
 * at least one column, keyed by item id, then column name. `completed` lists
 * the items that cleared every column, in declaration order. `failed` lists
 * the column that rejected an item and its error.
 *
 * @category models
 * @since 0.0.13
 */
export interface Board<Out, E> {
  readonly board: Record<string, Record<string, Out>>
  readonly completed: ReadonlyArray<string>
  readonly failed: ReadonlyArray<Failure<E>>
  readonly iterations: number
}

/**
 * The stages of {@link run}. `maxIterations` is how many passes the board
 * runs, one when absent. `until` stops the board after the pass whose board
 * satisfies it, and needs `maxIterations`. `onComplete` runs once after the
 * last pass; its answer is discarded and its failure is the run's failure.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<It extends Item, Out, E, R, E2, R2> {
  readonly columns: ReadonlyArray<RuntimeColumn<It, Out, E, R>>
  readonly concurrency: number
  readonly onComplete?:
    | ((args: { readonly items: ReadonlyArray<It>; readonly board: Board<Out, E> }) => Effect.Effect<unknown, E2, R2>)
    | undefined
  readonly until?: ((board: Board<Out, E>) => boolean) | undefined
  readonly maxIterations?: number | undefined
}

const bound = (value: number): boolean => Number.isSafeInteger(value) && value >= 1

const refuse = (message: string): Effect.Effect<never, PatternError> =>
  Effect.fail(new PatternError({ code: "invalid_decorator", message }))

// A card pairs the id read at the call with the caller's own item record, so
// the board is keyed by a name that cannot move under it.
interface Card<It> {
  readonly id: string
  readonly item: It
}

const pass = <It extends Item, Out, E, R>(
  cards: ReadonlyArray<Card<It>>,
  columns: ReadonlyArray<RuntimeColumn<It, Out, E, R>>,
  concurrency: number
): Effect.Effect<Omit<Board<Out, E>, "iterations">, never, R> =>
  Effect.gen(function*() {
    const board = new Map<string, Map<string, Out>>()
    const failed: Array<Failure<E>> = []
    const latest = new Map<string, Out>()
    let active: ReadonlyArray<Card<It>> = cards
    for (const column of columns) {
      const outcomes = yield* Effect.forEach(
        active,
        (card) =>
          column.run({ item: card.item, column: column.name, previous: latest.get(card.id) }).pipe(
            Effect.map((output) => ({ ok: true, card, output } as const)),
            Effect.catch((error: E) => Effect.succeed({ ok: false, card, error } as const))
          ),
        { concurrency }
      )
      const next: Array<Card<It>> = []
      for (const outcome of outcomes) {
        if (outcome.ok) {
          const row = board.get(outcome.card.id) ?? new Map<string, Out>()
          row.set(column.name, outcome.output)
          board.set(outcome.card.id, row)
          latest.set(outcome.card.id, outcome.output)
          next.push(outcome.card)
        } else {
          failed.push({ id: outcome.card.id, column: column.name, error: outcome.error })
        }
      }
      active = next
    }
    return {
      board: Object.fromEntries(Array.from(board, ([id, row]) => [id, Object.fromEntries(row)])),
      completed: active.map((card) => card.id),
      failed
    }
  })

/**
 * Moves every item through the columns in order. A column runs at most
 * `concurrency` items at once, and starts only after the column before it has
 * settled for every item. A column rejects an item by failing: the item
 * leaves the board and is listed in `failed`, and the other items keep
 * moving. A defect fails the run. Each pass starts from an empty board, and
 * the result is the last pass's board.
 *
 * Fails with `PatternError` (`invalid_decorator`) when there is no column or
 * no item, two items share an id, two columns share a name, `concurrency` or
 * `maxIterations` is not a positive safe integer, or `until` has no
 * `maxIterations`.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <It extends Item, Out, E = never, R = never, E2 = never, R2 = never>(
  items: ReadonlyArray<It>,
  options: Options<It, Out, E, R, E2, R2>
): Effect.Effect<Board<Out, E>, PatternError | E2, R | R2> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the arrays or the options in between must not reach it. Each item's id
  // is read here; the record itself stays the caller's.
  const columns = options.columns.map((column) => ({ name: column.name, run: column.run }))
  const cards = items.map((item): Card<It> => ({ id: item.id, item }))
  const snapshot: ReadonlyArray<It> = cards.map((card) => card.item)
  const concurrency = options.concurrency
  const until = options.until
  const onComplete = options.onComplete
  const maxIterations = options.maxIterations
  if (columns.length === 0) return refuse("Kanban requires at least one column")
  if (cards.length === 0) return refuse("Kanban requires at least one item")
  if (!bound(concurrency)) return refuse("Kanban concurrency must be a positive safe integer")
  const ids = cards.map((card) => card.id)
  if (new Set(ids).size !== ids.length) return refuse("Kanban item ids must be unique")
  const names = columns.map((column) => column.name)
  if (new Set(names).size !== names.length) return refuse("Kanban column names must be unique")
  if (until !== undefined && maxIterations === undefined) return refuse("Kanban until requires maxIterations")
  if (maxIterations !== undefined && !bound(maxIterations)) {
    return refuse("Kanban maxIterations must be a positive safe integer")
  }
  const limit = maxIterations ?? 1
  return Effect.gen(function*() {
    let iterations = 0
    while (true) {
      const settled = yield* pass(cards, columns, concurrency)
      iterations += 1
      const result: Board<Out, E> = { ...settled, iterations }
      const done = until !== undefined && until(result)
      if (done || iterations >= limit) {
        if (onComplete !== undefined) yield* onComplete({ items: snapshot, board: result })
        return result
      }
    }
  })
}
