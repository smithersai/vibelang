import type {
  JournalEvent,
  JournalArtifact,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  TurnJournal,
} from "./types.ts"

export class ScriptedModel implements ModelAdapter {
  readonly requests: ModelRequest[] = []
  #responses: Array<string | ModelResponse>

  constructor(responses: Array<string | ModelResponse>) {
    this.#responses = [...responses]
  }

  generate(request: ModelRequest): string | ModelResponse {
    this.requests.push(request)
    const response = this.#responses.shift()
    if (response === undefined) throw new Error("ScriptedModel ran out of responses")
    return response
  }
}

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
