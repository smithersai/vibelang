import {
  DurableExecutor,
  type DurableExecutorOptions
} from "./engine.ts"
import { LocalWorker } from "./provider.ts"
import {
  requireAuthenticatedDeployment,
  type AuthenticatedDeployment
} from "./signed-deployment.ts"
import type { DurableStore } from "./store.ts"

const LOCAL_SANDBOX = "in-process-poc"
const trustedWorkerTransportBrand: unique symbol = Symbol("smithers.trusted-worker-transport.v1")

export class AuthenticatedCoordinatorTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthenticatedCoordinatorTransportError"
  }
}

export type AuthenticatedWorkerFactory = NonNullable<DurableExecutorOptions["workerFactory"]>

/**
 * Opaque host-issued routing evidence for one exact signed sandbox spelling.
 * It records an explicit trust decision; it does not attest that the supplied
 * factory really implements that isolation boundary.
 */
export interface TrustedWorkerTransport {
  readonly [trustedWorkerTransportBrand]: true
  readonly sandbox: string
}

interface IssuedWorkerTransport {
  readonly sandbox: string
  readonly factory: AuthenticatedWorkerFactory
}

const issuedWorkerTransports = new WeakMap<object, IssuedWorkerTransport>()

export const trustWorkerTransport = (
  sandbox: string,
  factory: AuthenticatedWorkerFactory
): TrustedWorkerTransport => {
  if (typeof sandbox !== "string" || sandbox.trim() === "") {
    throw new AuthenticatedCoordinatorTransportError("trusted worker transport sandbox must be non-empty")
  }
  if (sandbox === LOCAL_SANDBOX) {
    throw new AuthenticatedCoordinatorTransportError(
      `${LOCAL_SANDBOX} is coordinator-owned and does not accept a custom transport`
    )
  }
  if (typeof factory !== "function") {
    throw new AuthenticatedCoordinatorTransportError("trusted worker transport factory must be callable")
  }
  const token = Object.freeze({
    [trustedWorkerTransportBrand]: true as const,
    sandbox
  })
  issuedWorkerTransports.set(token, { sandbox, factory })
  return token
}

export interface AuthenticatedCoordinatorOptions {
  /** Exact non-local sandbox transports explicitly trusted by this host. */
  readonly transports?: readonly TrustedWorkerTransport[]
}

const configuredTransports = (
  options: AuthenticatedCoordinatorOptions
): ReadonlyMap<string, IssuedWorkerTransport> => {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new AuthenticatedCoordinatorTransportError("authenticated coordinator options must be an object")
  }
  const keys = Reflect.ownKeys(options)
  if (keys.some((key) => key !== "transports")) {
    throw new AuthenticatedCoordinatorTransportError("authenticated coordinator options have unknown fields")
  }
  const descriptor = Object.getOwnPropertyDescriptor(options, "transports")
  if (descriptor !== undefined && (!("value" in descriptor) || !descriptor.enumerable)) {
    throw new AuthenticatedCoordinatorTransportError(
      "authenticated coordinator transports must be an enumerable data field"
    )
  }
  const values = descriptor === undefined ? [] : descriptor.value
  if (!Array.isArray(values)) {
    throw new AuthenticatedCoordinatorTransportError("authenticated coordinator transports must be an array")
  }
  const configured = new Map<string, IssuedWorkerTransport>()
  for (const token of values) {
    if (token === null || typeof token !== "object") {
      throw new AuthenticatedCoordinatorTransportError("worker transport proof was not issued by this host")
    }
    const issued = issuedWorkerTransports.get(token)
    if (issued === undefined) {
      throw new AuthenticatedCoordinatorTransportError("worker transport proof was not issued by this host")
    }
    if (configured.has(issued.sandbox)) {
      throw new AuthenticatedCoordinatorTransportError(
        `worker transport for sandbox ${issued.sandbox} is duplicated`
      )
    }
    configured.set(issued.sandbox, issued)
  }
  return configured
}

/**
 * Production-shaped coordinator entry point. Authentication is consumed before
 * DurableExecutor's constructor is entered, so no local, isolated, or remote
 * worker transport can be created from an unsigned or structurally forged
 * deployment. The legacy constructor remains available for POC tests and local
 * development.
 */
export const createAuthenticatedDurableExecutor = <Input, Success>(
  authentication: AuthenticatedDeployment<Input, Success>,
  store: DurableStore,
  options: AuthenticatedCoordinatorOptions = {}
): DurableExecutor<Input, Success> => {
  const deployment = requireAuthenticatedDeployment(authentication)
  const transports = configuredTransports(options)
  const requiredSandboxes = new Set<string>()
  for (const pool of deployment.pools.values()) {
    if (pool.sandbox !== LOCAL_SANDBOX) requiredSandboxes.add(pool.sandbox)
  }
  for (const sandbox of requiredSandboxes) {
    if (!transports.has(sandbox)) {
      throw new AuthenticatedCoordinatorTransportError(
        `signed sandbox ${sandbox} has no exact trusted worker transport`
      )
    }
  }
  for (const sandbox of transports.keys()) {
    if (!requiredSandboxes.has(sandbox)) {
      throw new AuthenticatedCoordinatorTransportError(
        `trusted worker transport ${sandbox} is not required by the signed deployment`
      )
    }
  }

  // The complete routing table is checked before DurableExecutor can iterate
  // pools and invoke even the first factory.
  return new DurableExecutor(deployment, store, {
    workerFactory: (pool, manifest, providers) => {
      if (pool.sandbox === LOCAL_SANDBOX) return new LocalWorker(pool, manifest, providers)
      const transport = transports.get(pool.sandbox)
      if (transport === undefined) {
        throw new AuthenticatedCoordinatorTransportError(
          `signed sandbox ${pool.sandbox} lost its trusted worker transport`
        )
      }
      return transport.factory(pool, manifest, providers)
    }
  })
}

export const AuthenticatedCoordinator = Object.freeze({
  create: createAuthenticatedDurableExecutor,
  trustTransport: trustWorkerTransport
})
