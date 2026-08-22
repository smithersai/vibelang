import {
  Action,
  Deployment,
  DurableExecutor,
  DurableStore,
  Provider,
  Worker,
  compileActionContract,
  compileDurableSource,
  type ActionProvider,
  type BuiltDeployment,
  type ExecuteOptions,
} from "../../src/durable/index.ts"
import {
  CodingAgent,
  DenoSubprocessSandbox,
  InMemoryTypeScriptCompiler,
  compileActionTool,
  flowTool,
  textPrompt,
} from "../../src/agent/bun.ts"
import type {
  AgentFunction,
  AgentFunctionTable,
  JsonValue,
  ModelAdapter,
  TurnJournal,
} from "../../src/agent/bun.ts"

/**
 * A real compiled durable Flow passed into a coding agent's function table.
 *
 * Nothing here is agent-specific on the durable side: the Actions carry
 * compiler-derived contracts, the Flow is lowered from source by the durable
 * source compiler, and the deployment is an ordinary pinned deployment with
 * in-process workers. `flowTool` is the whole adapter.
 */

const FETCH_ACTION = `
import { Action } from "vibelang:flows"

type FetchRequest = { readonly path: string }
type FetchReply = { readonly path: string; readonly contents: string }

class DocumentMissing extends Error {
  constructor(readonly path: string) { super(path) }
}

export abstract class Fetch extends Action<
  (input: FetchRequest) => Promise<Result<FetchReply, DocumentMissing>>
> {}
`

const PUBLISH_ACTION = `
import { Action } from "vibelang:flows"

type PublishRequest = { readonly path: string; readonly contents: string }
type PublishReply = { readonly path: string; readonly bytes: number; readonly revision: number }

class PublishRejected extends Error {
  constructor(readonly path: string) { super(path) }
}

export abstract class Publish extends Action<
  (input: PublishRequest) => Promise<Result<PublishReply, PublishRejected>>
> {}
`

/** Two Actions, one data dependency: the second consumes the first's output. */
const FLOW_SOURCE = `
import { durable } from "vibelang:flows"
import { Fetch, Publish } from "demo:publishing-actions"

export const Publishing = durable(function Publishing(input: { path: string; target: string }) {
  const fetched = Fetch.run({ path: input.path }).unwrap()
  return Publish.run({ path: input.target, contents: fetched.contents })
})
`

export interface PublishingInput {
  readonly path: string
  readonly target: string
}

export interface PublishingSuccess {
  readonly path: string
  readonly bytes: number
  readonly revision: number
}

const fetchContract = compileActionContract(FETCH_ACTION, {
  fileName: "agent/flow-fetch.vibe",
  exportName: "Fetch",
  id: "vibelang/agent-flow/Fetch",
  version: 1,
})
if (!fetchContract.ok) throw new Error(JSON.stringify(fetchContract.diagnostics))

const publishContract = compileActionContract(PUBLISH_ACTION, {
  fileName: "agent/flow-publish.vibe",
  exportName: "Publish",
  id: "vibelang/agent-flow/Publish",
  version: 1,
})
if (!publishContract.ok) throw new Error(JSON.stringify(publishContract.diagnostics))

export const FetchAction = Action.fromDescriptor<
  { readonly path: string },
  { readonly path: string; readonly contents: string }
>(fetchContract.descriptor)

export const PublishAction = Action.fromDescriptor<
  { readonly path: string; readonly contents: string },
  PublishingSuccess
>(publishContract.descriptor)

const compiled = compileDurableSource(FLOW_SOURCE, {
  fileName: "agent/publishing.flow.vibe",
  flowId: "vibelang/agent-flow/Publishing",
  flowVersion: 1,
  actions: [
    {
      moduleSpecifier: "demo:publishing-actions",
      exportName: "Fetch",
      descriptor: fetchContract.descriptor,
    },
    {
      moduleSpecifier: "demo:publishing-actions",
      exportName: "Publish",
      descriptor: publishContract.descriptor,
    },
  ],
})
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))

/** The validated Plan artifact every deployment below is pinned to. */
export const publishingFlow = compiled.flow

export const FLOW_TURN_SOURCE = `
export default async function turn(functions: Functions) {
  const published = await functions.publishDocument({ path: "README.md", target: "PUBLISHED.md" })
  const note = await functions.note({ text: "published " + published.path })
  return { path: published.path, bytes: published.bytes, revision: published.revision, note: note.text }
}
`

export interface FlowProject {
  readonly documents: Map<string, string>
  readonly invocations: { fetch: number; publish: number }
  /** Monotonic host state: proves a joined execution does not re-publish. */
  revision: number
}

export function createFlowProject(
  seed: Readonly<Record<string, string>> = { "README.md": "# durable flow project\n" },
): FlowProject {
  return {
    documents: new Map(Object.entries(seed)),
    invocations: { fetch: 0, publish: 0 },
    revision: 0,
  }
}

export interface FlowProviders {
  readonly fetch: ActionProvider<any, any, any>
  readonly publish: ActionProvider<any, any, any>
}

/**
 * Live providers over a project snapshot. Implementation *identity* is fixed
 * (`implementationId`/`implementationVersion`), so a poisoned rebuild produces
 * a byte-identical deployment manifest and can join an execution the live
 * deployment started — that is what makes the restart test meaningful.
 */
export function liveProviders(project: FlowProject): FlowProviders {
  return {
    fetch: Provider.provide(FetchAction, ({ path }) => {
      project.invocations.fetch += 1
      const contents = project.documents.get(path)
      if (contents === undefined) throw new Error(`missing document: ${path}`)
      return { path, contents }
    }, { implementationId: "vibelang/agent-flow/fetch-live", implementationVersion: "1" }),
    publish: Provider.provide(PublishAction, ({ path, contents }) => {
      project.invocations.publish += 1
      project.revision += 1
      project.documents.set(path, contents)
      return { path, bytes: contents.length, revision: project.revision }
    }, { implementationId: "vibelang/agent-flow/publish-live", implementationVersion: "1" }),
  }
}

/**
 * The same deployment identity with implementations that fail if they run at
 * all: restart evidence for Actions, mirroring `poisonFunctionTable` for agent
 * bindings and `PoisonModel` for the model.
 */
export function poisonProviders(
  live: FlowProviders,
  poisoned: readonly ("fetch" | "publish")[] = ["fetch", "publish"],
  reason = "durable Action must not re-run after the execution is joined",
): FlowProviders {
  const poison = (name: string) => (): never => {
    throw new Error(`${reason}: ${name}`)
  }
  return {
    fetch: poisoned.includes("fetch")
      ? Provider.provide(FetchAction, poison("Fetch"), {
        implementationId: "vibelang/agent-flow/fetch-live",
        implementationVersion: "1",
      })
      : live.fetch,
    publish: poisoned.includes("publish")
      ? Provider.provide(PublishAction, poison("Publish"), {
        implementationId: "vibelang/agent-flow/publish-live",
        implementationVersion: "1",
      })
      : live.publish,
  }
}

export const FLOW_DEPLOYMENT_ID = "vibelang/agent-flow/publishing@1"

export function buildFlowDeployment(providers: FlowProviders): BuiltDeployment<unknown, unknown> {
  return Deployment.build({
    id: FLOW_DEPLOYMENT_ID,
    flow: publishingFlow,
    pools: [Worker.pool("agent-flow-worker", {
      target: "typescript-bun",
      providers: [providers.fetch, providers.publish],
    })],
  })
}

/**
 * A `flowTool` target that adds one durable execute hook. `flowTool` only ever
 * needs `plan` plus `execute(input, { executionId })`, so a test can inject
 * coordinator-crash behavior without the agent library knowing about it.
 */
export function flowTarget(
  executor: DurableExecutor<unknown, unknown>,
  hooks: Omit<ExecuteOptions, "executionId"> = {},
) {
  return {
    plan: executor.deployment.flow.plan,
    execute: (input: unknown, options: { readonly executionId: string }) =>
      executor.execute(input, { ...hooks, executionId: options.executionId }),
  }
}

export interface FlowAgentOptions {
  readonly model: ModelAdapter
  readonly functions: AgentFunctionTable
  readonly journal?: TurnJournal
  readonly maxRepairs?: number
}

export function createFlowAgent(options: FlowAgentOptions): CodingAgent<{ task: string }, JsonValue> {
  return CodingAgent.make<{ task: string }, JsonValue>({
    model: options.model,
    prompt: textPrompt({
      system: "You are a coding agent. Return one TypeScript module.",
      task: ({ task }) => task,
    }),
    functions: options.functions,
    compiler: new InMemoryTypeScriptCompiler(),
    sandbox: new DenoSubprocessSandbox({ timeoutMs: 20_000 }),
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    maxRepairs: options.maxRepairs ?? 0,
  })
}

const NOTE_ACTION = `
import { Action } from "vibelang:flows"

type NoteRequest = { readonly text: string }
type NoteReply = { readonly text: string }

class NoteRejected extends Error {
  constructor(readonly text: string) { super(text) }
}

export abstract class Note extends Action<
  (input: NoteRequest) => Promise<Result<NoteReply, NoteRejected>>
> {}
`

/** An ordinary Action tool, so a turn mixes Action and Flow members. */
export function noteTool(sink: string[]): AgentFunction<{ readonly text: string }, { readonly text: string }> {
  return compileActionTool<{ readonly text: string }, { readonly text: string }>(
    {
      source: NOTE_ACTION,
      fileName: "agent/flow-note.vibe",
      exportName: "Note",
      id: "vibelang/agent-flow/Note",
      version: 1,
      description: "record a note about the published document",
    },
    async ({ text }) => {
      sink.push(text)
      return { text }
    },
  )
}

export function publishingTool(
  target: Parameters<typeof flowTool>[0],
): AgentFunction<PublishingInput, PublishingSuccess> {
  return flowTool<PublishingInput, PublishingSuccess>(target, {
    description: "fetch a document and publish it, as one durable execution",
  })
}

export { DurableExecutor, DurableStore }
