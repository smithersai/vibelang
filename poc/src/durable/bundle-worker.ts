import { DenoSubprocessSandbox } from "../agent/sandbox.ts"
import {
  canonicalJson,
  deepFreeze,
  digest,
  type DeploymentManifest,
  type Invocation,
  type WorkerExit
} from "./ir.ts"
import {
  bundleInvocationDriver,
  validateWorkerPoolBundle,
  type WorkerPoolBundle
} from "./pool-bundle.ts"
import {
  LocalWorker,
  WORKER_BUDGET_GRACE_MS,
  withInvocationBudget,
  type ActionProvider,
  type DurableWorker,
  type WorkerPool
} from "./provider.ts"

/**
 * Executes a tree-shaken, digest-pinned pool bundle in a fresh zero-permission
 * Deno process and dispatches ANY Action routed to the pool through it. The
 * bundle's SHA-256 must equal the signed manifest's pool `bundleDigest`, so a
 * worker cannot be admitted with different bytes than the deployment signature
 * covers. The host provider table is used only to authenticate the invocation
 * envelope; provider callbacks never run on this path — the checked,
 * compiler-emitted bundle code does.
 *
 * If the signed pool placement carries a `denoSandboxIdentity` object, the
 * actual sandbox runtime identity must match it exactly, binding the runtime
 * binary/runner identity into the signature as well. Without it, the bundle
 * digest pins code bytes only, not the executing runtime.
 */
export class DenoBundleWorker implements DurableWorker {
  readonly bundle: WorkerPoolBundle
  readonly bundleDigest: string
  readonly #gate: LocalWorker
  readonly #sandbox: DenoSubprocessSandbox
  /** The admitted bundle identity, out of reach of anything holding the instance. */
  readonly #pinnedBundleDigest: string

  constructor(
    pool: WorkerPool,
    manifest: DeploymentManifest,
    providers: ReadonlyMap<string, ActionProvider<any, any, any>>,
    options: {
      readonly bundle: WorkerPoolBundle
      readonly sandbox: DenoSubprocessSandbox
    }
  ) {
    if (!(options.sandbox instanceof DenoSubprocessSandbox)) {
      throw new TypeError("DenoBundleWorker requires the authenticated Deno subprocess sandbox")
    }
    this.#sandbox = options.sandbox
    this.bundle = validateWorkerPoolBundle(options.bundle)
    const poolManifest = manifest.pools.find((candidate) => candidate.id === pool.id)
    if (poolManifest === undefined) throw new TypeError(`Pool ${pool.id} absent from deployment manifest`)
    if (poolManifest.bundleDigest === undefined) {
      throw new TypeError(`Pool ${pool.id} was not built with bundle emission; its manifest pins no bundleDigest`)
    }
    if (poolManifest.bundleDigest !== this.bundle.digest) {
      throw new TypeError(
        `Pool ${pool.id} bundle digest mismatch: manifest pins ${poolManifest.bundleDigest}, ` +
        `supplied bundle is ${this.bundle.digest}`
      )
    }
    if (this.bundle.poolId !== pool.id ||
      canonicalJson(this.bundle.actionIds) !== canonicalJson(poolManifest.actionIds)) {
      throw new TypeError(`Bundle identity does not match pool ${pool.id} manifest`)
    }
    if (pool.sandbox !== this.#sandbox.kind) {
      throw new TypeError(`Pool ${pool.id} sandbox ${pool.sandbox} does not match the Deno runtime ${this.#sandbox.kind}`)
    }
    const pinnedIdentity = poolManifest.placement["denoSandboxIdentity"]
    if (pinnedIdentity !== undefined &&
      canonicalJson(pinnedIdentity) !== canonicalJson(this.#sandbox.identity)) {
      throw new TypeError(`Pool ${pool.id} signed sandbox identity does not match the local Deno runtime`)
    }
    this.bundleDigest = this.bundle.digest
    this.#pinnedBundleDigest = this.bundle.digest
    this.#gate = new LocalWorker(pool, manifest, providers)
    deepFreeze(this)
  }

  async invoke(
    rawInvocation: Invocation,
    signal: AbortSignal = new AbortController().signal
  ): Promise<WorkerExit> {
    const prepared = this.#gate.prepare(rawInvocation, signal)
    if (!prepared.ready) return prepared.exit
    const invocation: Invocation = deepFreeze({
      ...prepared.invocation,
      input: prepared.input
    })
    return withInvocationBudget(
      invocation,
      {
        label: "bundle",
        route: prepared.route,
        protocolDefectName: "BundleProtocolDefect",
        signal,
        graceMs: WORKER_BUDGET_GRACE_MS
      },
      (budgetSignal) => this.#execute(invocation, budgetSignal)
    )
  }

  async #execute(invocation: Invocation, signal: AbortSignal): Promise<unknown> {
    // Digest-verify the exact bytes about to execute, immediately before
    // composition, so a mutated bundle object cannot slip past construction.
    const verified = validateWorkerPoolBundle(this.bundle)
    if (verified.digest !== this.#pinnedBundleDigest) {
      return {
        kind: "defect",
        defect: {
          name: "BundleArtifactMismatch",
          message: `Bundle ${verified.digest} is not the admitted ${this.#pinnedBundleDigest}`
        }
      }
    }
    const source = verified.javascript + bundleInvocationDriver(canonicalJson(invocation))
    // The sandbox's own `timeoutMs` bounds this process independently of
    // `Invocation.budget`, deliberately; see the note on the same call in
    // `isolated-worker.ts`. Here the runtime identity carrying it is pinned only
    // when the signed pool placement declares `denoSandboxIdentity`.
    const execution = await this.#sandbox.execute(source, {}, {
      sourceDigest: verified.digest,
      turnId: digest({
        executionId: invocation.executionId,
        nodeId: invocation.nodeId,
        attempt: invocation.attempt,
        fencingToken: invocation.fencingToken
      }),
      signal
    })
    if (!execution.ok) {
      return {
        kind: "defect",
        defect: {
          name: execution.error?.name ?? "BundleWorkerDefect",
          message: execution.error?.message ?? "Bundle worker exited without a result",
          ...(execution.error?.stack === undefined ? {} : { stack: execution.error.stack })
        }
      }
    }
    // Whatever the sandbox produced is untrusted: `withInvocationBudget` is the
    // only way out of this transport and it decodes against the route's exact
    // discriminant and structural Action codecs.
    return execution.result
  }
}
