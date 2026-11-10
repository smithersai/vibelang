/**
 * Memory that outlives a run: facts a program writes now and recalls in a
 * later run, ranked by a query and cut to a byte budget so the answer fits
 * in a prompt (VIP-66).
 *
 * A fact lives in a bank, the public spelling of a namespace: `kind-id`,
 * where the kind is `flow`, `agent`, `user` or `global` (`global-notes`,
 * `agent-reviewer`). A bank with no kind prefix is a `flow` bank.
 *
 * The store and the ranking are chosen by a layer. {@link test} keeps facts
 * in this process; {@link layerStore} runs over any {@link Store}, which is
 * how a host brings its own database. There is no default store: a program
 * that calls {@link remember} with none provided has a missing requirement.
 *
 * Guarantees:
 *
 * - Every recall is cut to its byte budget: the answer is empty or,
 *   serialized as JSON, at most `maxBytes` UTF-8 bytes (2,048 unless given).
 * - Recalled text is data. It grants no capability, and a fact a model wrote
 *   is an assertion, not an instruction.
 * - Every failure is a {@link MemoryError} with a stable `code`.
 * - Nothing is deleted unless the program asks.
 *
 * This module ports `@smthrs/memory`: the namespaces, the limits, keyword
 * ranking and the byte cap are Smithers' own.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as inProcess from "./internal/memoryStore.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Memory"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Memory"

/**
 * The four namespace lifetimes.
 *
 * @category models
 * @since 0.0.13
 */
export const kinds = ["flow", "agent", "user", "global"] as const

/**
 * A namespace lifetime: `flow`, `agent`, `user` or `global`.
 *
 * @category models
 * @since 0.0.13
 */
export type Kind = typeof kinds[number]

/**
 * A structured namespace. Its bank is `${kind}-${id}`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Namespace {
  readonly kind: Kind
  readonly id: string
}

/**
 * A stable failure code: Smithers' eleven.
 *
 * @category errors
 * @since 0.0.13
 */
export type MemoryErrorCode =
  | "not_found"
  | "fts_not_enabled"
  | "invalid_namespace"
  | "invalid_tag"
  | "invalid_argument"
  | "supersede_conflict"
  | "idempotency_conflict"
  | "compaction_conflict"
  | "embedding_unavailable"
  | "vector_model_mismatch"
  | "store"

/**
 * Every memory failure: a stable `code`, a message, and the path of the
 * input field at fault when there is one.
 *
 * @category errors
 * @since 0.0.13
 */
export class MemoryError extends /* @__PURE__ */ Data.TaggedError("MemoryError")<{
  readonly code: MemoryErrorCode
  readonly message: string
  readonly path?: ReadonlyArray<string> | undefined
  readonly cause?: unknown
}> {}

/**
 * A row recall ranks: a fact's key, text and last update.
 *
 * @category models
 * @since 0.0.13
 */
export interface SearchRow {
  readonly key: string
  readonly text: string
  readonly updatedAtMs: number
}

/**
 * The storage memory reads and writes. Implement it to keep memory in
 * another database. A store reports its own failures as a
 * {@link MemoryError} with the code `store`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Store {
  /** Writes a fact, replacing the one under the same namespace and key. */
  readonly putFact: (fact: {
    readonly namespace: Namespace
    readonly key: string
    readonly text: string
    readonly at: number
  }) => Effect.Effect<void, MemoryError>
  /** Every row recall may return from one namespace. */
  readonly searchRows: (namespace: Namespace) => Effect.Effect<ReadonlyArray<SearchRow>, MemoryError>
}

/**
 * A store in this process's memory, gone at exit. A real store, not a mock:
 * layers built over one share its facts, which is how a test restarts a
 * program and recalls what it remembered.
 *
 * @category constructors
 * @since 0.0.13
 */
export const makeMemoryStore: () => Store = inProcess.makeMemory

/**
 * One recalled row.
 *
 * @category models
 * @since 0.0.13
 */
export interface Recalled {
  readonly bank: string
  readonly key: string
  readonly text: string
  readonly score: number
  readonly updatedAtMs: number
}

/**
 * Ranks the rows of the requested banks for a query. It returns them best
 * first; {@link recall} applies the byte budget afterward, so no ranking can
 * exceed it. A ranking reads only through the store it is given.
 *
 * @category models
 * @since 0.0.13
 */
export type Recall = (
  request: {
    readonly banks: ReadonlyArray<{ readonly bank: string; readonly namespace: Namespace }>
    readonly query: string
  },
  store: Store
) => Effect.Effect<ReadonlyArray<Recalled>, MemoryError>

/**
 * The memory a program reads and writes: a store and its ranking.
 *
 * @category services
 * @since 0.0.13
 */
export interface Memory {
  readonly [TypeId]: TypeId
  readonly store: Store
  readonly recall: Recall
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.13
 */
export const Memory: Context.Service<Memory, Memory> = /* @__PURE__ */ Context.Service<Memory>(
  "vibelang/experimental/Memory"
)

/**
 * The most banks one recall reads.
 *
 * @category constants
 * @since 0.0.13
 */
export const MAX_RECALL_BANKS = 16

/**
 * The longest bank name, in UTF-16 code units.
 *
 * @category constants
 * @since 0.0.13
 */
export const MAX_BANK_NAME_LENGTH = 128

/**
 * The longest query and the longest remembered text, in UTF-8 bytes.
 *
 * @category constants
 * @since 0.0.13
 */
export const MAX_TEXT_BYTES = 16 * 1_024

/**
 * The longest remembered key, in UTF-8 bytes.
 *
 * @category constants
 * @since 0.0.13
 */
export const MAX_KEY_BYTES = 1_024

/**
 * The largest byte budget one recall accepts.
 *
 * @category constants
 * @since 0.0.13
 */
export const MAX_RECALL_BYTES = 64 * 1_024

/**
 * The byte budget of a recall that names none.
 *
 * @category constants
 * @since 0.0.13
 */
export const DEFAULT_RECALL_BYTES = 2_048

const utf8 = new TextEncoder()
const bytes = (text: string): number => utf8.encode(text).byteLength

const invalid = (message: string, path: ReadonlyArray<string | number>) =>
  new MemoryError({ code: "invalid_argument", message, path: path.map(String) })

/**
 * Reads a bank as a namespace: `kind-id` for a known kind with a non-empty
 * id, otherwise a `flow` namespace named by the whole bank.
 *
 * @category namespaces
 * @since 0.0.13
 */
export const namespaceOf = (bank: string): Namespace => {
  for (const kind of kinds) {
    const prefix = `${kind}-`
    if (bank.startsWith(prefix) && bank.length > prefix.length) return { kind, id: bank.slice(prefix.length) }
  }
  return { kind: "flow", id: bank }
}

/**
 * The bank of a namespace, the inverse of {@link namespaceOf} for every
 * prefixed bank.
 *
 * @category namespaces
 * @since 0.0.13
 */
export const bankOf = (namespace: Namespace): string => `${namespace.kind}-${namespace.id}`

const resolveBank = (bank: unknown, path: ReadonlyArray<string | number>) => {
  if (typeof bank !== "string" || bank.length === 0) {
    return Effect.fail(
      new MemoryError({ code: "invalid_namespace", message: "memory bank must be a non-empty string", path: path.map(String) })
    )
  }
  if (bank.length > MAX_BANK_NAME_LENGTH) {
    return Effect.fail(invalid(`memory bank is longer than ${MAX_BANK_NAME_LENGTH} characters`, path))
  }
  return Effect.succeed({ bank, namespace: namespaceOf(bank) })
}

/**
 * Splits a query into the lower-case terms keyword ranking matches.
 *
 * @category recall
 * @since 0.0.13
 */
export const queryTerms = (query: string): ReadonlyArray<string> =>
  query.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean)

/**
 * The order every ranking ends in: score descending, newest update, key,
 * then bank, so the order never depends on the order banks were named in.
 *
 * @category recall
 * @since 0.0.13
 */
export const compareRecalled = (left: Recalled, right: Recalled): number =>
  right.score - left.score || right.updatedAtMs - left.updatedAtMs ||
  compareText(left.key, right.key) || compareText(left.bank, right.bank)

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

/**
 * Keyword ranking, the default: a row scores one for each query term its key
 * or text contains, and rows that match no term are left out.
 *
 * @category recall
 * @since 0.0.13
 */
export const keyword: Recall = ({ banks, query }, store) =>
  Effect.gen(function*() {
    const terms = queryTerms(query)
    if (banks.length === 0 || terms.length === 0) return []
    const rows = yield* Effect.forEach(banks, ({ namespace }) => store.searchRows(namespace), { concurrency: 4 })
    const ranked = rows.flatMap((bankRows, index) =>
      bankRows.flatMap((row) => {
        const haystack = `${row.key} ${row.text}`.normalize("NFKC").toLowerCase()
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0)
        return score > 0 ? [{ bank: banks[index]!.bank, key: row.key, text: row.text, score, updatedAtMs: row.updatedAtMs }] : []
      })
    )
    return ranked.sort(compareRecalled)
  })

const ARRAY_BRACKETS_BYTES = 2
const SEPARATOR_BYTES = 1

/**
 * Smithers' byte cap: rows are taken whole, best first, while they fit; the
 * first row that does not fit is cut to the longest prefix of its text that
 * does, and nothing after it is taken. Rows with empty text are dropped. The
 * result is empty or, serialized as JSON, at most `maxBytes` UTF-8 bytes.
 *
 * @category recall
 * @since 0.0.13
 */
export const capRecalled = (rows: ReadonlyArray<Recalled>, maxBytes: number): Array<Recalled> => {
  const budget = Math.max(0, Math.floor(maxBytes))
  const selected: Array<Recalled> = []
  let used = ARRAY_BRACKETS_BYTES
  for (const row of rows) {
    if (row.text.length === 0) continue
    const separator = selected.length > 0 ? SEPARATOR_BYTES : 0
    const room = budget - used - separator
    const size = bytes(JSON.stringify(row))
    if (size <= room) {
      selected.push(row)
      used += separator + size
      continue
    }
    const characters = [...row.text]
    let low = 0
    let high = characters.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (bytes(JSON.stringify({ ...row, text: characters.slice(0, middle).join("") })) <= room) low = middle
      else high = middle - 1
    }
    if (low > 0) selected.push({ ...row, text: characters.slice(0, low).join("") })
    break
  }
  return selected
}

/**
 * Memory over `store`, ranked by `recall` ({@link keyword} unless given).
 * Layers built over one store share its facts.
 *
 * @category layers
 * @since 0.0.13
 */
export const layerStore = (store: Store, options?: { readonly recall?: Recall | undefined }): Layer.Layer<Memory> =>
  Layer.succeed(Memory)({ [TypeId]: TypeId, store, recall: options?.recall ?? keyword })

/**
 * Memory over a fresh {@link makeMemoryStore}, with keyword ranking. Facts
 * last as long as the layer.
 *
 * @category layers
 * @since 0.0.13
 */
export const test: Layer.Layer<Memory> = /* @__PURE__ */ Layer.unwrap(
  /* @__PURE__ */ Effect.sync(() => layerStore(inProcess.makeMemory()))
)

/**
 * Writes a fact: `text` under `key` in `bank`, replacing what that key held.
 *
 * Fails with `invalid_namespace` for an empty bank, and `invalid_argument`
 * for an empty key, a key over {@link MAX_KEY_BYTES} or a text over
 * {@link MAX_TEXT_BYTES} UTF-8 bytes, before any write.
 *
 * @category operations
 * @since 0.0.13
 */
export const remember = (input: {
  readonly bank: string
  readonly key: string
  readonly text: string
}): Effect.Effect<{ readonly key: string }, MemoryError, Memory> =>
  Effect.gen(function*() {
    const { namespace } = yield* resolveBank(input.bank, ["bank"])
    if (typeof input.key !== "string" || input.key.length === 0) {
      return yield* Effect.fail(invalid("memory key must be a non-empty string", ["key"]))
    }
    if (bytes(input.key) > MAX_KEY_BYTES) {
      return yield* Effect.fail(invalid(`memory key exceeds ${MAX_KEY_BYTES} UTF-8 bytes`, ["key"]))
    }
    if (typeof input.text !== "string") return yield* Effect.fail(invalid("memory text must be a string", ["text"]))
    if (bytes(input.text) > MAX_TEXT_BYTES) {
      return yield* Effect.fail(invalid(`memory text exceeds ${MAX_TEXT_BYTES} UTF-8 bytes`, ["text"]))
    }
    const memory = yield* Memory
    const at = yield* Clock.currentTimeMillis
    yield* memory.store.putFact({ namespace, key: input.key, text: input.text, at })
    return { key: input.key }
  })

/**
 * Recalls the rows of `banks` that match `query`, best first, cut to
 * `maxBytes` (see {@link capRecalled}). A bank named twice is read once.
 *
 * Fails with `invalid_namespace` for an empty bank, and `invalid_argument`
 * for more than {@link MAX_RECALL_BANKS} banks, a query over
 * {@link MAX_TEXT_BYTES} UTF-8 bytes, or a `maxBytes` that is not an integer
 * from 0 to {@link MAX_RECALL_BYTES}, before any read.
 *
 * @category operations
 * @since 0.0.13
 */
export const recall = (input: {
  readonly banks: ReadonlyArray<string>
  readonly query: string
  readonly maxBytes?: number | undefined
}): Effect.Effect<ReadonlyArray<Recalled>, MemoryError, Memory> =>
  Effect.gen(function*() {
    if (!Array.isArray(input.banks)) return yield* Effect.fail(invalid("memory banks must be an array", ["banks"]))
    if (input.banks.length > MAX_RECALL_BANKS) {
      return yield* Effect.fail(invalid(`recall reads at most ${MAX_RECALL_BANKS} banks`, ["banks"]))
    }
    const resolved = yield* Effect.forEach(input.banks, (bank, index) => resolveBank(bank, ["banks", index]))
    if (typeof input.query !== "string") return yield* Effect.fail(invalid("recall query must be a string", ["query"]))
    if (bytes(input.query) > MAX_TEXT_BYTES) {
      return yield* Effect.fail(invalid(`recall query exceeds ${MAX_TEXT_BYTES} UTF-8 bytes`, ["query"]))
    }
    const maxBytes = input.maxBytes ?? DEFAULT_RECALL_BYTES
    if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_RECALL_BYTES) {
      return yield* Effect.fail(invalid(`maxBytes must be an integer from 0 to ${MAX_RECALL_BYTES}`, ["maxBytes"]))
    }
    const unique = new Map<string, { readonly bank: string; readonly namespace: Namespace }>()
    for (const entry of resolved) {
      const identity = `${entry.namespace.kind}\u0000${entry.namespace.id}`
      if (!unique.has(identity)) unique.set(identity, entry)
    }
    const memory = yield* Memory
    const ranked = yield* memory.recall({ banks: [...unique.values()], query: input.query }, memory.store)
    return capRecalled(ranked, maxBytes)
  })
