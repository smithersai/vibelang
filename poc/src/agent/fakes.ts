import type {
  AgentFunction,
  AgentFunctionTable,
  ComponentIdentity,
  JsonValue,
  JournalEvent,
  JournalArtifact,
  ModelAdapter,
  ModelDescriptor,
  ModelRequest,
  ModelResponse,
  TurnJournal,
} from "./types.ts"
import { snapshotFunctionTable } from "./bindings.ts"
import {
  canonicalIdentityJson,
  sha256File,
  snapshotComponentIdentity,
} from "./identity.ts"
import { defineModelIdentity, jsonSnapshot, snapshotModelDescriptor } from "./model.ts"

const SCRIPTED_MODEL_ARTIFACT = sha256File(new URL(import.meta.url))
const SCRIPTED_MODEL: ModelDescriptor = Object.freeze({
  provider: "scripted",
  name: "scripted",
  version: "1",
})

export interface ScriptedModelOptions {
  readonly name?: string
  readonly config?: JsonValue
  /** Provider/model/version this fake claims to serve. */
  readonly model?: ModelDescriptor
}

/**
 * The model is still fake. It replays a fixed script instead of calling a
 * provider, but it goes through the same `ModelAdapter` boundary a real client
 * would implement, so replacing it is a drop-in.
 */
export class ScriptedModel implements ModelAdapter {
  readonly identity: ComponentIdentity
  readonly model: ModelDescriptor
  readonly requests: ModelRequest[] = []
  #responses: Array<string | ModelResponse>

  constructor(responses: Array<string | ModelResponse>, options: ScriptedModelOptions = {}) {
    const canonicalResponses = canonicalIdentityJson(
      jsonSnapshot(responses, "ScriptedModel responses"),
      "ScriptedModel responses",
    )
    this.#responses = JSON.parse(canonicalResponses) as Array<string | ModelResponse>
    this.model = options.model === undefined
      ? SCRIPTED_MODEL
      : snapshotModelDescriptor(options.model, "ScriptedModel model")
    this.identity = defineModelIdentity({
      name: options.name ?? "model/scripted",
      artifactDigest: SCRIPTED_MODEL_ARTIFACT,
      model: this.model,
      config: {
        responses: jsonSnapshot(this.#responses, "ScriptedModel responses"),
        config: options.config ?? null,
      },
    })
  }

  generate(request: ModelRequest): string | ModelResponse {
    this.requests.push(request)
    const response = this.#responses.shift()
    if (response === undefined) throw new Error("ScriptedModel ran out of responses")
    return response
  }
}

/**
 * Restart evidence. It impersonates another adapter's identity and model
 * version so the turn id is unchanged, then fails if the model is invoked at
 * all: a turn that completes through it completed entirely from the journal.
 */
export class PoisonModel implements ModelAdapter {
  readonly identity: ComponentIdentity
  readonly model: ModelDescriptor
  readonly #reason: string

  constructor(impersonated: ModelAdapter, reason = "the model must not be invoked during replay") {
    this.identity = snapshotComponentIdentity(impersonated.identity, "PoisonModel identity")
    this.model = snapshotModelDescriptor(impersonated.model, "PoisonModel model")
    this.#reason = reason
  }

  generate(request: ModelRequest): never {
    throw new Error(`${this.#reason} (turn ${request.turnId}, attempt ${request.attempt})`)
  }
}

/**
 * The same restart evidence for host functions: identical identities,
 * signatures, and Action contracts, but every callback fails if it is invoked.
 */
export function poisonFunctionTable(
  functions: AgentFunctionTable,
  reason = "host function must not be invoked during replay",
): AgentFunctionTable {
  const snapshot = snapshotFunctionTable(functions)
  const table: Record<string, AgentFunction<any, any>> = Object.create(null) as Record<string, AgentFunction<any, any>>
  for (const [name, fn] of Object.entries(snapshot)) {
    table[name] = {
      identity: fn.identity,
      signature: fn.signature,
      ...(fn.description === undefined ? {} : { description: fn.description }),
      ...(fn.actionContract === undefined ? {} : { actionContract: fn.actionContract }),
      ...(fn.flowContract === undefined ? {} : { flowContract: fn.flowContract }),
      invoke: () => {
        throw new Error(`${reason}: ${name}`)
      },
    }
  }
  return snapshotFunctionTable(table)
}

/** Observation-only journal: it records events but never replays a turn. */
export class MemoryTurnJournal implements TurnJournal {
  readonly events: JournalEvent[] = []
  readonly artifacts: JournalArtifact[] = []

  append(event: JournalEvent): void {
    this.events.push(structuredClone(event))
  }

  putArtifact(artifact: JournalArtifact): void {
    this.artifacts.push(structuredClone(artifact))
  }
}
