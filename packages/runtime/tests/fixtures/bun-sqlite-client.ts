// A SqlClient over bun:sqlite for the durable store tests: a real SQLite
// database through Effect's own client machinery (SqlClient.make and its
// SQLite acquirers), as @effect/sql-sqlite-bun builds one. The runtime does
// not depend on an Effect SQL client package, so its tests bring this one.
// `fault` injects a database failure: a statement it answers true for fails
// with a SqlError before it runs.
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, ManagedRuntime, Semaphore, Stream } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient, SqlError, Statement } from "effect/sql"
import { Durable } from "vibelang-runtime/experimental"

export const layer = (filename: string, options: { readonly fault?: ((sql: string) => boolean) | undefined } = {}) =>
  Layer.effect(
    SqlClient.SqlClient,
    Effect.gen(function*() {
      const db = yield* Effect.acquireRelease(
        Effect.sync(() => new Database(filename, { create: true })),
        (db) => Effect.sync(() => db.close())
      )
      db.run("PRAGMA busy_timeout = 5000")
      db.run("PRAGMA journal_mode = WAL")
      const fail = (cause: unknown) =>
        new SqlError.SqlError({ reason: new SqlError.UnknownError({ cause, message: String(cause), operation: "execute" }) })
      const check = (sql: string) => {
        if (options.fault?.(sql)) throw new Error(`injected fault: ${sql}`)
      }
      const all = (sql: string, params: ReadonlyArray<unknown>) =>
        Effect.try({ try: () => (check(sql), db.query(sql).all(...(params as Array<never>)) as ReadonlyArray<any>), catch: fail })
      const values = (sql: string, params: ReadonlyArray<unknown>) =>
        Effect.try({ try: () => (check(sql), db.query(sql).values(...(params as Array<never>)) as ReadonlyArray<ReadonlyArray<unknown>>), catch: fail })
      const run = (sql: string, params: ReadonlyArray<unknown>, transform?: (rows: ReadonlyArray<any>) => ReadonlyArray<any>) =>
        transform ? Effect.map(all(sql, params), transform) : all(sql, params)
      const connection = {
        execute: run,
        executeRaw: all,
        executeStream: () => Stream.die("executeStream is not implemented"),
        executeValues: values,
        executeValuesUnprepared: values,
        executeUnprepared: (sql: string, params: ReadonlyArray<unknown> | undefined, transform?: (rows: ReadonlyArray<any>) => ReadonlyArray<any>) =>
          run(sql, params ?? [], transform)
      }
      const { acquirer, borrower, onCommitFailure, transactionAcquirer, isTransaction } = SqlClient.makeSqliteAcquirers({
        connection: Effect.succeed(connection),
        semaphore: yield* Semaphore.make(1),
        isTransaction: () => db.inTransaction
      })
      return yield* SqlClient.make({
        acquirer,
        borrower,
        transactionAcquirer,
        onCommitFailure,
        isTransaction,
        compiler: Statement.makeCompilerSqlite(),
        driver: "bun-sqlite-test",
        spanAttributes: [],
        beginTransaction: "BEGIN IMMEDIATE",
        releaseSavepoint: (name) => `RELEASE SAVEPOINT ${name}`
      })
    })
  ).pipe(Layer.provide(Reactivity.layer))

let scratch: string | undefined
let files = 0
/** A new database file in a temporary directory removed when the process exits. */
export const databaseFile = () => {
  if (scratch === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "durable-sqlite-"))
    scratch = dir
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }))
  }
  return join(scratch, `runs-${++files}.db`)
}

/**
 * The store an engine sees over a SQLite file, read through the engine's own
 * `Durable.layerSql`. Each call opens its own connection, so two calls on one
 * file are two engines' connections contending through SQLite's lock.
 */
export const sqliteStore = (filename: string): Promise<Durable.Store> =>
  ManagedRuntime.make(Durable.layerSql.pipe(Layer.provide(layer(filename)))).runPromise(
    Effect.map(Effect.service(Durable.Durable), (durable) => durable.internals.store)
  )

/**
 * A place two engines share. `store` is the first engine's view; `another`
 * gives a second engine its own view of the same runs: the same object for
 * memory, a second connection to the same file for SQLite.
 */
export interface SharedStore {
  readonly store: Durable.Store
  readonly another: () => Promise<Durable.Store>
}

/** The stores engine-level tests run over: the in-memory store and SQLite. */
export const storeFactories: ReadonlyArray<readonly [name: string, make: () => Promise<SharedStore>]> = [
  ["memory", async () => {
    const store = Durable.makeMemoryStore()
    return { store, another: async () => store }
  }],
  ["SQLite", async () => {
    const file = databaseFile()
    return { store: await sqliteStore(file), another: () => sqliteStore(file) }
  }]
]
