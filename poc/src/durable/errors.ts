/**
 * Durable coordinator failure identities.
 *
 * These classes carry no behaviour beyond their identity: a caller `instanceof`
 * checks them to decide whether an execution is still resumable. That decision
 * is needed in places that must never open a database — the agent sandbox on
 * `smthrs/agent` is one — so the identities live in a leaf module with no
 * dependency on the executor, the store, or any runtime-specific specifier.
 *
 * The rule this module exists to keep: importing an error must not pull in a
 * database driver. `engine.ts` reaches `store.ts`, which imports `bun:sqlite`,
 * so an `import { CoordinatorCrash } from "./engine.ts"` from a Node-loadable
 * subpath drags Bun's SQLite binding onto the Node import graph and the module
 * fails to load with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Import identities from
 * here; import the executor from `./engine.ts`.
 *
 * The only import below is type-only, so this module emits with no imports at
 * all and is loadable under every runtime.
 */
import type { JsonValue } from "./ir.ts"

/** A durable Action reported a typed failure from its declared failure union. */
export class DurableActionFailure extends Error {
  constructor(
    readonly nodeId: string,
    readonly failure: JsonValue
  ) {
    super(`Durable Action ${nodeId} failed with a typed failure`)
    this.name = "DurableActionFailure"
  }
}

/** A durable Action terminated with a defect rather than a declared failure. */
export class DurableActionDefect extends Error {
  constructor(
    readonly nodeId: string,
    readonly defect: JsonValue
  ) {
    super(`Durable Action ${nodeId} terminated with a defect`)
    this.name = "DurableActionDefect"
  }
}

/** The execution already holds a committed terminal failure. */
export class DurableExecutionAlreadyFailed extends Error {
  constructor(readonly storedError: JsonValue) {
    super("Durable execution already has a terminal failure")
    this.name = "DurableExecutionAlreadyFailed"
  }
}

/** The execution was cancelled before it could reach a terminal result. */
export class DurableExecutionCancelled extends Error {
  constructor(readonly reason: JsonValue) {
    super("Durable execution was cancelled")
    this.name = "DurableExecutionCancelled"
  }
}

/**
 * Coordinator death after a durable commit: the execution is resumable, so
 * nothing that escapes it may be recorded as a replayable result.
 *
 * Used by tests and the demo to model process death at a chosen commit point,
 * and matched by identity wherever "this failure leaves work resumable" has to
 * be decided.
 */
export class CoordinatorCrash extends Error {
  constructor(readonly nodeId: string) {
    super(`Simulated coordinator crash after adopting ${nodeId}`)
    this.name = "CoordinatorCrash"
  }
}
