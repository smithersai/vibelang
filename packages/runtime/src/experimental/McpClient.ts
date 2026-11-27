/**
 * MCP servers as toolkits (VIP-65).
 *
 * {@link toolkit} connects one Model Context Protocol server, over a child
 * process's stdio or over Streamable HTTP, lists its tools once, and gives
 * the tools the program named as an Effect `Toolkit` with handlers. The
 * client is Effect's `McpClient`; serving a toolkit is Effect's `McpServer`,
 * unchanged.
 *
 * Rules:
 *
 * - Tool names are prefixed `<server>__<tool>`, so two servers cannot
 *   collide and a transcript shows where a tool came from.
 * - `include` is required. It is an allowlist; `include: "all"` is the
 *   written opt-out. A tool the server adds later is not offered.
 * - The catalog is a snapshot taken at connect.
 * - A child gets a small environment: `PATH`, `HOME`, `USER`, `LANG`,
 *   `LC_*`, `TERM`, `TMPDIR`, `SHELL`, plus what `command` declares. Provider
 *   keys in the host's environment do not reach a server.
 * - A server is opaque code. The permission kernel checks what this module
 *   does: `proc:spawn` for the command line and `net:post` for the URL.
 * - A server's annotations are claims. They are copied into tool annotations
 *   only with `trustAnnotations`, and never grant approval.
 * - Errors withhold the server's text: an {@link McpError} carries a code,
 *   never the child's stderr or a remote error body.
 * - A tool's `isError: true` result is a result: it reaches the model as the
 *   server sent it.
 * - A lost reply is not retried: after a transport failure nobody knows
 *   whether the tool ran.
 * - Inside a workflow or one of its tasks, each call is a recorded step.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Context from "effect/Context"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as EffectMcpClient from "effect/ai/McpClient"
import type * as McpClientError from "effect/ai/McpClientError"
import * as McpProtocol from "effect/ai/McpProtocol"
import * as McpSchema from "effect/ai/McpSchema"
import * as Tool from "effect/ai/Tool"
import * as Toolkit from "effect/ai/Toolkit"
import type * as HttpClient from "effect/http/HttpClient"
import * as ChildProcess from "effect/process/ChildProcess"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import * as Capability from "./Capability.js"
import { commandResource } from "./internal/capabilityGuard.js"
import { recorded } from "./internal/toolsRecord.js"
import * as Text from "./internal/toolsText.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/McpClient"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/McpClient"

// -----------------------------------------------------------------------------
// Failures
// -----------------------------------------------------------------------------

/**
 * Why an MCP session failed. The server's own text is never kept.
 *
 * - `invalid_options`: the server name, `include` or the command is not one
 *   this module accepts. Nothing was started.
 * - `permission_denied`: the kernel refused `proc:spawn` or `net:post`.
 * - `tool_missing`: `include` names a tool the server does not list.
 * - `transport`, `protocol`, `http`, `timeout`, `closed`, `limit`,
 *   `unsupported`, `validation`, `configuration`: the corresponding
 *   `McpClientError` reason from Effect's client.
 *
 * @category errors
 * @since 0.0.13
 */
export const McpErrorCode = Schema.Literals([
  "invalid_options",
  "permission_denied",
  "tool_missing",
  "transport",
  "protocol",
  "http",
  "timeout",
  "closed",
  "limit",
  "unsupported",
  "validation",
  "configuration"
])

/**
 * @category errors
 * @since 0.0.13
 */
export type McpErrorCode = typeof McpErrorCode.Type

/**
 * A session or call that failed. `tool` names the prefixed tool for a
 * failed call.
 *
 * @category errors
 * @since 0.0.13
 */
export class McpError extends Schema.TaggedError<McpError>()("McpError", {
  server: Schema.String,
  code: McpErrorCode,
  message: Schema.String,
  tool: Schema.optional(Schema.String)
}) {}

const reasonCodes: Readonly<Record<string, McpErrorCode>> = {
  TransportError: "transport",
  ProtocolError: "protocol",
  HttpError: "http",
  TimeoutError: "timeout",
  ClosedError: "closed",
  LimitError: "limit",
  UnsupportedError: "unsupported",
  ValidationError: "validation",
  ConfigurationError: "configuration"
}

// The message names the code and what this module was doing. The reason's
// own description can quote the child's output or a remote body, so it is
// dropped.
const withheld = (server: string, doing: string, tool?: string) => (error: McpClientError.McpClientError): McpError => {
  const tag = (error.reason as { readonly _tag?: string } | undefined)?._tag ?? ""
  const code = reasonCodes[tag.split("/").pop() ?? ""] ?? "transport"
  return new McpError({
    server,
    code,
    message: `The ${server} MCP server failed while ${doing} (${code}).`,
    ...(tool === undefined ? {} : { tool })
  })
}

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

/**
 * The options shared by both transports.
 *
 * @category options
 * @since 0.0.13
 */
export interface CommonOptions {
  /** The server's tools to offer, by their own names, or `"all"`. Required. */
  readonly include: ReadonlyArray<string> | "all"
  /** A bound on connecting and listing, and on each call. 60 seconds unless set. */
  readonly timeout?: Duration.Input | undefined
  /** Copy the server's annotation hints into tool annotations. Off unless set. */
  readonly trustAnnotations?: boolean | undefined
  /** The protocol version to speak. `"2025-11-25"` unless set. */
  readonly protocol?: EffectMcpClient.ProtocolVersion | undefined
}

/**
 * A server started as a child process. Its environment is the small set plus
 * what `command` declares in its `env`.
 *
 * @category options
 * @since 0.0.13
 */
export interface StdioOptions extends CommonOptions {
  readonly command: ChildProcess.Command
}

/**
 * A server reached over Streamable HTTP.
 *
 * @category options
 * @since 0.0.13
 */
export interface HttpOptions extends CommonOptions {
  readonly url: string
  readonly headers?: Readonly<Record<string, string>> | undefined
}

/**
 * The tools a connected server gives: each one's parameters are the server's
 * JSON Schema, and its result is the server's `CallToolResult`.
 *
 * @category models
 * @since 0.0.13
 */
export type RemoteTool = Tool.Tool<string, {
  readonly parameters: typeof Schema.Unknown
  readonly success: typeof McpSchema.CallToolResult
  readonly failure: typeof McpError
  readonly failureMode: "return"
}>

// -----------------------------------------------------------------------------
// Connecting
// -----------------------------------------------------------------------------

const serverName = /^[A-Za-z0-9_-]{1,32}$/

const invalid = (server: string, message: string) =>
  Effect.fail(new McpError({ server, code: "invalid_options", message }))

const permission = (server: string, capability: Capability.CapabilityText) =>
  Effect.mapError(Capability.check(capability), () =>
    new McpError({ server, code: "permission_denied", message: `Permission was not granted for ${capability}.` }))

// The command again, with the small environment and nothing inherited.
const confined = (command: ChildProcess.StandardCommand): ChildProcess.StandardCommand => {
  const declared: Record<string, string> = {}
  for (const [name, value] of Object.entries(command.options.env ?? {})) {
    if (typeof value === "string") declared[name] = value
  }
  const secrets = Object.fromEntries(
    Object.entries(command.options.env ?? {}).filter(([, value]) => value !== undefined && typeof value !== "string")
  )
  return ChildProcess.make(command.command, [...command.args] as Array<string>, {
    ...command.options,
    env: { ...Text.childEnvironment(Text.hostEnvironment(), { env: declared }), ...secrets } as Record<string, string | undefined>,
    extendEnv: false
  }) as ChildProcess.StandardCommand
}

/**
 * Picks the descriptors `include` allows, and fails on a name the server
 * does not list. Pure.
 *
 * @category models
 * @since 0.0.13
 */
export const select = (
  server: string,
  listed: ReadonlyArray<McpSchema.Tool>,
  include: ReadonlyArray<string> | "all"
): Effect.Effect<ReadonlyArray<McpSchema.Tool>, McpError> => {
  if (include === "all") return Effect.succeed(listed)
  const byName = new Map(listed.map((tool) => [tool.name, tool]))
  const chosen: Array<McpSchema.Tool> = []
  for (const name of new Set(include)) {
    const found = byName.get(name)
    if (found === undefined) {
      return Effect.fail(
        new McpError({ server, code: "tool_missing", message: `The ${server} MCP server lists no tool named ${JSON.stringify(name)}.` })
      )
    }
    chosen.push(found)
  }
  return Effect.succeed(chosen)
}

const callTimeoutDefault = "60 seconds"

/**
 * Connects an MCP server and gives the tools `include` names as a toolkit
 * with handlers, named `<server>__<tool>`. Scoped: the session, and a child
 * process, end with the scope.
 *
 * **Example** (A stdio server)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { ChildProcess } from "effect/process"
 * import { McpClient } from "vibelang-runtime/experimental"
 *
 * const github = McpClient.toolkit("github", {
 *   command: ChildProcess.make("mcp-server-github", []),
 *   include: ["get_issue", "list_issues"]
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.13
 */
export const toolkit: {
  (server: string, options: StdioOptions): Effect.Effect<
    Toolkit.WithHandler<Record<string, RemoteTool>>,
    McpError,
    Scope.Scope | ChildProcessSpawner
  >
  (server: string, options: HttpOptions): Effect.Effect<
    Toolkit.WithHandler<Record<string, RemoteTool>>,
    McpError,
    Scope.Scope | HttpClient.HttpClient
  >
} = ((server: string, options: StdioOptions | HttpOptions) =>
  Effect.gen(function*() {
    if (!serverName.test(server)) {
      return yield* invalid(server, "A server name is 1 to 32 ASCII letters, digits, underscores or hyphens.")
    }
    const include = (options as Partial<CommonOptions>).include
    if (include !== "all" && !Array.isArray(include)) {
      return yield* invalid(server, "include is required: name the tools to offer, or write include: \"all\".")
    }
    const protocol = options.protocol === "2026-07-28" ? McpProtocol.v2026_07_28 : McpProtocol.v2025_11_25
    const timeout = options.timeout ?? callTimeoutDefault
    let transport: Effect.Effect<EffectMcpClient.Transport, McpClientError.McpClientError, unknown>
    if ("command" in options) {
      if (!ChildProcess.isStandardCommand(options.command)) {
        return yield* invalid(server, "command must be one command, not a pipeline.")
      }
      const command = confined(options.command)
      const line = commandResource({
        command: command.command,
        args: command.args as ReadonlyArray<string>,
        shell: command.options.shell,
        env: command.options.env as Record<string, string | undefined>,
        extendEnv: false
      }, command.options.cwd)
      yield* permission(server, `proc:spawn:${line.resource}`)
      transport = EffectMcpClient.stdio({ command, protocol })
    } else {
      let url: URL
      try {
        url = new URL(options.url)
      } catch {
        return yield* invalid(server, "url must be an absolute http or https URL.")
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return yield* invalid(server, "url must be an absolute http or https URL.")
      }
      const host = url.hostname.toLowerCase().replace(/(.)\.$/, "$1")
      yield* permission(server, `net:post:${url.protocol}//${host}${url.port === "" ? "" : `:${url.port}`}${url.pathname}${url.search}`)
      transport = EffectMcpClient.http({ url, protocol, headers: options.headers })
    }
    const connected = yield* transport.pipe(
      Effect.flatMap((made) =>
        Effect.provideService(
          EffectMcpClient.make({ name: "vibelang-runtime", version: "0.0.13", timeout }),
          EffectMcpClient.Transport,
          made
        )
      ),
      Effect.mapError(withheld(server, "connecting"))
    )
    // The catalog is listed once. A server that changes it changes nothing until the next connect.
    const listed = yield* Effect.mapError(connected.listTools(), withheld(server, "listing its tools"))
    const chosen = yield* select(server, listed, include)
    return yield* build(server, connected, chosen, options.trustAnnotations === true, timeout)
  })) as unknown as typeof toolkit

const build = (
  server: string,
  client: EffectMcpClient.McpClient,
  descriptors: ReadonlyArray<McpSchema.Tool>,
  trust: boolean,
  timeout: Duration.Input
): Effect.Effect<Toolkit.WithHandler<Record<string, RemoteTool>>, McpError> =>
  Effect.gen(function*() {
    const tools: Array<Tool.Any> = []
    const handlers: Record<string, (params: unknown) => Effect.Effect<McpSchema.CallToolResult, McpError>> = {}
    for (const descriptor of descriptors) {
      const name = `${server}__${descriptor.name}`
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || Object.hasOwn(handlers, name)) {
        return yield* Effect.fail(
          new McpError({
            server,
            code: "configuration",
            message: `${JSON.stringify(name)} is not a usable tool name: it must be 1 to 64 letters, digits, underscores or hyphens, and unique.`
          })
        )
      }
      let tool: Tool.Any = Tool.dynamic(name, {
        parameters: descriptor.inputSchema as Record<string, unknown>,
        description: descriptor.description,
        success: McpSchema.CallToolResult,
        failure: McpError,
        failureMode: "return"
      }).annotate(Tool.Strict, false).annotate(EffectMcpClient.ToolDescriptor, descriptor)
      // A server's hints are claims: they are copied only when asked, and they never set approval.
      if (trust && descriptor.annotations !== undefined) {
        const hints = descriptor.annotations
        if (hints.readOnlyHint !== undefined) tool = tool.annotate(Tool.Readonly, hints.readOnlyHint)
        if (hints.destructiveHint !== undefined) tool = tool.annotate(Tool.Destructive, hints.destructiveHint)
        if (hints.idempotentHint !== undefined) tool = tool.annotate(Tool.Idempotent, hints.idempotentHint)
        if (hints.openWorldHint !== undefined) tool = tool.annotate(Tool.OpenWorld, hints.openWorldHint)
      } else {
        // An untrusted tool declares the widest authority.
        tool = tool.annotate(Tool.Readonly, false).annotate(Tool.Destructive, true).annotate(Tool.OpenWorld, true)
      }
      tools.push(tool)
      handlers[name] = (params: unknown) => {
        const args = params !== null && typeof params === "object" && !Array.isArray(params)
          ? params as Record<string, unknown>
          : undefined
        if (args === undefined) {
          return Effect.fail(
            new McpError({ server, code: "validation", message: "MCP tool arguments must be a JSON object.", tool: name })
          )
        }
        return recorded({
          kind: "mcp",
          request: [server, descriptor.name, args],
          success: McpSchema.CallToolResult,
          error: McpError,
          // `isError: true` is a result: it is returned, not failed.
          execute: Effect.mapError(
            client.callTool({ tool: descriptor, arguments: args }, { timeout }),
            withheld(server, `calling ${descriptor.name}`, name)
          )
        })
      }
    }
    const made = Toolkit.make(...tools) as unknown as {
      readonly pipe: (fn: unknown) => Effect.Effect<Toolkit.WithHandler<Record<string, RemoteTool>>, McpError>
      readonly toHandlers: (h: Record<string, (params: unknown) => Effect.Effect<unknown, McpError>>) => Effect.Effect<Context.Context<never>>
    }
    return yield* made.pipe(Effect.provideContext(yield* made.toHandlers(handlers)))
  }) as unknown as Effect.Effect<Toolkit.WithHandler<Record<string, RemoteTool>>, McpError>

/**
 * The server-side descriptor of a tool in a toolkit from {@link toolkit}.
 * It came from the server and is untrusted.
 *
 * @category models
 * @since 0.0.13
 */
export const descriptorOf = (tool: Tool.Any): McpSchema.Tool | undefined =>
  Context.getOrUndefined((tool as { readonly annotations: Context.Context<never> }).annotations, EffectMcpClient.ToolDescriptor)
