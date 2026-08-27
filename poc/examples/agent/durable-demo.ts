import {
  CodingAgent,
  DenoSubprocessSandbox,
  InMemoryTypeScriptCompiler,
  compileActionTool,
  sha256Json,
  textPrompt,
} from "../../src/agent/index.ts"
import type {
  AgentFunction,
  AgentFunctionTable,
  JsonValue,
  ModelAdapter,
  TurnJournal,
} from "../../src/agent/index.ts"

/**
 * A tiny coding task whose tools are real durable Actions: their wire types
 * come from the durable contract compiler, and their calls are recorded and
 * replayed through the turn journal.
 */
const READ_FILE_ACTION = `
import { Action } from "smithers:flows"

type ReadRequest = { readonly path: string }
type ReadReply = { readonly path: string; readonly contents: string }

class FileMissing extends Error {
  constructor(readonly path: string) { super(path) }
}

export abstract class ReadFile extends Action<
  (input: ReadRequest) => Promise<Result<ReadReply, FileMissing>>
> {}
`

const WRITE_FILE_ACTION = `
import { Action } from "smithers:flows"

type WriteRequest = { readonly path: string; readonly contents: string }
type WriteReply = { readonly path: string; readonly bytes: number; readonly revision: number }

class WriteRejected extends Error {
  constructor(readonly path: string) { super(path) }
}

export abstract class WriteFile extends Action<
  (input: WriteRequest) => Promise<Result<WriteReply, WriteRejected>>
> {}
`

export const FIRST_TURN_SOURCE = `
export default async function turn(functions: Functions) {
  const readme = await functions.readFile({ path: "README.md" })
  const written = await functions.writeFile({
    path: "GREETING.md",
    contents: "# greeting\\n" + readme.contents,
  })
  return { wrote: written.path, bytes: written.bytes, revision: written.revision }
}
`

export const SECOND_TURN_SOURCE = `
export default async function turn(functions: Functions) {
  const greeting = await functions.readFile({ path: "GREETING.md" })
  const readme = await functions.readFile({ path: "README.md" })
  return {
    files: [readme.path, greeting.path],
    greetingLines: greeting.contents.split("\\n").length,
  }
}
`

export interface DurableProject {
  readonly files: Map<string, string>
  readonly invocations: { readFile: number; writeFile: number }
  readonly functions: AgentFunctionTable
  /** Monotonic host state: proves a replayed write is not repeated. */
  revision(): number
}

export function createProject(
  seed: Readonly<Record<string, string>> = { "README.md": "# tiny durable project\n" },
  options: { readonly projectId?: string } = {},
): DurableProject {
  const files = new Map(Object.entries(seed))
  const invocations = { readFile: 0, writeFile: 0 }
  let revision = 0
  // The tools below close over `files`, `invocations`, and `revision`. None of
  // that is visible to `Function.prototype.toString()`, so the deployment has
  // to say which project it is: two `createProject` calls are two different
  // implementations of the same Action contract, and a turn journal keyed on a
  // shared identity would answer one project's readFile with the other's file.
  const projectId = options.projectId ?? `snapshot-${sha256Json(seed).slice(0, 16)}`

  const readFile: AgentFunction<{ readonly path: string }, { readonly path: string; readonly contents: string }> =
    compileActionTool(
      {
        source: READ_FILE_ACTION,
        fileName: "agent/read-file.sm",
        exportName: "ReadFile",
        id: "smthrs/agent-demo/ReadFile",
        version: 1,
        description: "read one file from the project snapshot",
        implementationId: `demo/agent-project/${projectId}/read-file`,
        implementationVersion: "1",
      },
      async ({ path }) => {
        invocations.readFile += 1
        const contents = files.get(path)
        if (contents === undefined) throw new Error(`missing file: ${path}`)
        return { path, contents }
      },
    )

  const writeFile: AgentFunction<
    { readonly path: string; readonly contents: string },
    { readonly path: string; readonly bytes: number; readonly revision: number }
  > = compileActionTool(
    {
      source: WRITE_FILE_ACTION,
      fileName: "agent/write-file.sm",
      exportName: "WriteFile",
      id: "smthrs/agent-demo/WriteFile",
      version: 1,
      description: "write one file into the project snapshot",
      implementationId: `demo/agent-project/${projectId}/write-file`,
      implementationVersion: "1",
    },
    async ({ path, contents }) => {
      invocations.writeFile += 1
      revision += 1
      files.set(path, contents)
      return { path, bytes: contents.length, revision }
    },
  )

  return {
    files,
    invocations,
    functions: { readFile, writeFile },
    revision: () => revision,
  }
}

export interface DurableAgentOptions {
  readonly project: DurableProject
  readonly model: ModelAdapter
  readonly journal?: TurnJournal
  readonly functions?: AgentFunctionTable
  readonly maxRepairs?: number
}

export function createDurableAgent(
  options: DurableAgentOptions,
): CodingAgent<{ task: string }, JsonValue> {
  return CodingAgent.make<{ task: string }, JsonValue>({
    model: options.model,
    prompt: textPrompt({
      system: "You are a coding agent. Return one TypeScript module.",
      task: ({ task }) => task,
    }),
    functions: options.functions ?? options.project.functions,
    compiler: new InMemoryTypeScriptCompiler(),
    sandbox: new DenoSubprocessSandbox({ timeoutMs: 20_000 }),
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    maxRepairs: options.maxRepairs ?? 0,
  })
}
