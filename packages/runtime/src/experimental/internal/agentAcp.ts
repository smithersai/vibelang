/**
 * A client of the Agent Client Protocol (ACP): JSON-RPC 2.0 between a client
 * and an agent, one message per line on the agent's stdio
 * (https://agentclientprotocol.com). VIP-63's `Experimental.Agent.cli` drives
 * a coding-agent CLI with it.
 *
 * {@link make} speaks to one agent over a {@link Transport}, two plain values
 * a host builds from a child process's stdout and stdin, so this module names
 * no platform and no vendor. It covers what driving an agent through one task
 * needs: `initialize`, `session/new` or `session/load`, `session/prompt` and
 * its stop reason, `session/cancel`, and every `session/update` the agent
 * streams, passed on as it arrived. The client offers the agent no file
 * system and no terminal, so the agent works with its own tools, and it
 * answers a permission request with the agent's first option of the kind its
 * `permission` policy picks.
 *
 * Errors carry codes only: an agent's error message can quote its task.
 *
 * @internal
 */

import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"

/**
 * The protocol version this client speaks.
 *
 * @category constants
 */
export const PROTOCOL_VERSION = 1

/**
 * The longest line this client reads from an agent, in characters. A
 * message is one line, and an agent's output is untrusted, so a line past
 * this ends the conversation as `protocol`.
 *
 * @category constants
 */
export const MAX_LINE_CHARS = 16 * 1024 * 1024

/**
 * Why a prompt turn ended, as the agent said.
 *
 * @category constants
 */
export const STOP_REASONS = ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"] as const

/**
 * Why a prompt turn ended, decoded.
 *
 * @category models
 */
export type StopReason = (typeof STOP_REASONS)[number]

/**
 * The conversation with the agent failed: `closed` (its output ended or could
 * not be written), `protocol` (it sent what the protocol doesn't allow, or
 * agreed to a version this client does not speak), or
 * `remote` (it answered a request with an error, whose JSON-RPC code is
 * `rpcCode`). The agent's own message is never kept.
 *
 * @category errors
 */
export class AcpError extends Schema.TaggedError<AcpError>()("AcpError", {
  code: Schema.Literals(["closed", "protocol", "remote"]),
  method: Schema.String,
  rpcCode: Schema.optional(Schema.Int)
}) {}

/**
 * The two ends of an agent's stdio: the lines it writes, and how to write one
 * line to it (without its newline).
 *
 * @category models
 */
export interface Transport<E = never, R = never> {
  readonly incoming: Stream.Stream<string, E, R>
  readonly send: (line: string) => Effect.Effect<void, unknown>
}

/**
 * One `session/update` as the agent sent it: its session, its kind (the
 * `sessionUpdate` discriminator, such as `agent_message_chunk`, `tool_call`
 * or `usage_update`), and the whole update object.
 *
 * @category models
 */
export interface Update {
  readonly sessionId: string
  readonly kind: string
  readonly update: Readonly<Record<string, unknown>>
}

/**
 * What the agent said of itself at `initialize`: the version it agreed to,
 * and whether it can load a session it ran before.
 *
 * @category models
 */
export interface Initialized {
  readonly protocolVersion: number
  readonly loadSession: boolean
}

/**
 * The client of one agent.
 *
 * @category models
 */
export interface Client {
  readonly initialize: Effect.Effect<Initialized, AcpError>
  readonly newSession: (cwd: string) => Effect.Effect<string, AcpError>
  readonly loadSession: (sessionId: string, cwd: string) => Effect.Effect<void, AcpError>
  /** Sends `text` as one prompt turn and answers its stop reason once the turn ends. */
  readonly prompt: (sessionId: string, text: string) => Effect.Effect<StopReason, AcpError>
  /** Asks the agent to end the session's turn; its prompt then answers `cancelled`. */
  readonly cancel: (sessionId: string) => Effect.Effect<void, AcpError>
}

/**
 * How the client answers the agent's permission requests: `allow` picks the
 * first `allow_once` option, else the first `allow_always` one; `reject` the
 * first `reject_once` option, else the first `reject_always` one. A grant
 * for one use is preferred because an agent can keep an `always` grant after
 * the session. A request with no such option is answered `cancelled`.
 *
 * @category models
 */
export type Permission = "allow" | "reject"

/**
 * How {@link make} is set up.
 *
 * @category models
 */
export interface Options {
  /** Runs for each `session/update`, in order; a failure it raises is logged by kind and dropped. */
  readonly onUpdate: (update: Update) => Effect.Effect<void>
  /** `allow` unless set. */
  readonly permission?: Permission | undefined
  /** The client's name and version, as `initialize` sends them. */
  readonly clientInfo?: { readonly name: string; readonly version: string } | undefined
}

const JsonObject = Schema.Record(Schema.String, Schema.Unknown)
const Message = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(Schema.Union([Schema.Int, Schema.String, Schema.Null])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.Unknown) }))
})
const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(Message))
const SessionUpdate = Schema.Struct({
  sessionId: Schema.String,
  update: Schema.Struct({ sessionUpdate: Schema.String })
})
const decodeUpdate = Schema.decodeUnknownOption(SessionUpdate)
const isObject = Schema.is(JsonObject)
const InitializeResult = Schema.Struct({
  protocolVersion: Schema.Int,
  agentCapabilities: Schema.optional(Schema.Struct({ loadSession: Schema.optional(Schema.Boolean) }))
})
const NewSessionResult = Schema.Struct({ sessionId: Schema.String })
const PromptResult = Schema.Struct({ stopReason: Schema.Literals(STOP_REASONS) })
const PermissionRequest = Schema.Struct({
  options: Schema.Array(Schema.Struct({ optionId: Schema.String, kind: Schema.String }))
})
const decodePermission = Schema.decodeUnknownOption(PermissionRequest)

type Pending = Deferred.Deferred<unknown, AcpError>

/** The option a permission request is answered with, by policy: the first of the policy's kinds, in order. */
const chosen = (request: unknown, permission: Permission): Option.Option<string> =>
  Option.flatMap(decodePermission(request), ({ options }) => {
    const kinds = permission === "allow" ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"]
    for (const kind of kinds) {
      const option = options.find((each) => each.kind === kind)
      if (option !== undefined) return Option.some(option.optionId)
    }
    return Option.none()
  })

/**
 * Splits an agent's decoded output into lines. It fails `protocol` once one
 * line passes {@link MAX_LINE_CHARS}, so an agent that never ends a line
 * cannot make the client hold it all.
 *
 * @category constructors
 */
export const lines = <E, R>(text: Stream.Stream<string, E, R>, limit: number = MAX_LINE_CHARS): Stream.Stream<string, E | AcpError, R> =>
  Stream.suspend(() => {
    // Characters of the line still open at the end of the last chunk.
    let open = 0
    return text.pipe(
      Stream.mapEffect((chunk) => {
        let start = 0
        for (;;) {
          const end = chunk.indexOf("\n", start)
          open += (end === -1 ? chunk.length : end) - start
          if (open > limit) return Effect.fail(new AcpError({ code: "protocol", method: "output" }))
          if (end === -1) return Effect.succeed(chunk)
          open = 0
          start = end + 1
        }
      }),
      Stream.splitLines
    )
  })

/**
 * Starts a client of the agent at the other end of `transport`, reading its
 * lines on a fiber in the current scope. Requests in flight when the agent's
 * output ends fail `closed`, or `protocol` when the output ended because it
 * broke the protocol.
 *
 * @category constructors
 */
export const make = <E, R>(
  transport: Transport<E, R>,
  options: Options
): Effect.Effect<Client, never, R | Scope.Scope> =>
  Effect.gen(function*() {
    const permission = options.permission ?? "allow"
    const pending = new Map<number, { readonly method: string; readonly deferred: Pending }>()
    const nextId = yield* Ref.make(0)
    const closed = yield* Ref.make(false)
    // Why the conversation ended, once it has.
    let ending: AcpError["code"] = "closed"
    const write = (method: string, value: unknown) =>
      transport.send(JSON.stringify(value)).pipe(Effect.mapError(() => new AcpError({ code: "closed", method })))
    const answer = (id: number | string, method: string, result: unknown) =>
      write(method, { jsonrpc: "2.0", id, result }).pipe(Effect.ignore)
    const refuse = (id: number | string, method: string, code: number) =>
      write(method, { jsonrpc: "2.0", id, error: { code, message: "Not supported by this client" } }).pipe(
        Effect.ignore
      )
    // Suspended: the requests to settle are the ones pending when the input ends, not when this is built.
    const settleAll = (error: (method: string) => AcpError) =>
      Effect.suspend(() =>
        Effect.forEach([...pending.values()], ({ deferred, method }) => Deferred.fail(deferred, error(method)), {
          discard: true
        })
      ).pipe(Effect.ensuring(Effect.sync(() => pending.clear())))
    const onLine = (line: string): Effect.Effect<void> =>
      Effect.gen(function*() {
        if (line.trim() === "") return
        const decoded = decodeMessage(line)
        if (Option.isNone(decoded)) {
          yield* Effect.logWarning("acp.message").pipe(Effect.annotateLogs({ outcome: "undecodable" }))
          return
        }
        const message = decoded.value
        if (message.method === undefined) {
          // An error with no id answers a request the agent could not read. It names no request, so every
          // request in flight fails rather than waits for an answer that will not come.
          if ((message.id === null || message.id === undefined) && message.error !== undefined) {
            yield* settleAll((method) => new AcpError({ code: "protocol", method }))
            return
          }
          // A response: settle the request it answers. An id this client never sent is dropped.
          const entry = typeof message.id === "number" ? pending.get(message.id) : undefined
          if (entry === undefined) return
          pending.delete(message.id as number)
          if (message.error !== undefined) {
            const rpcCode = message.error.code
            yield* Deferred.fail(
              entry.deferred,
              new AcpError({
                code: "remote",
                method: entry.method,
                ...(typeof rpcCode === "number" && Number.isSafeInteger(rpcCode) ? { rpcCode } : {})
              })
            )
          } else {
            yield* Deferred.succeed(entry.deferred, message.result ?? null)
          }
          return
        }
        if (message.id === undefined || message.id === null) {
          if (message.method !== "session/update") return
          const update = decodeUpdate(message.params)
          if (Option.isNone(update) || !isObject((message.params as { update: unknown }).update)) {
            yield* Effect.logWarning("acp.update").pipe(Effect.annotateLogs({ outcome: "undecodable" }))
            return
          }
          const raw = (message.params as { update: Record<string, unknown> }).update
          const kind = update.value.update.sessionUpdate
          yield* options.onUpdate({ sessionId: update.value.sessionId, kind, update: raw }).pipe(
            // A handler's failure is dropped and logged by kind, never its cause, which can quote the update. The
            // fiber's own interruption never reaches here; an interrupt inside the handler is logged as such.
            Effect.catchCause((cause) =>
              Effect.logWarning("acp.update").pipe(
                Effect.annotateLogs({ outcome: "handler_failed", kind, interrupted: Cause.hasInterruptsOnly(cause) })
              )
            )
          )
          return
        }
        // A request from the agent. Only a permission request is served; the client offered no file system or
        // terminal, so any other method is not found.
        if (message.method === "session/request_permission") {
          const option = chosen(message.params, permission)
          yield* answer(
            message.id,
            message.method,
            Option.isSome(option)
              ? { outcome: { outcome: "selected", optionId: option.value } }
              : { outcome: { outcome: "cancelled" } }
          )
          return
        }
        yield* refuse(message.id, message.method, -32601)
      })
    yield* Stream.runForEach(transport.incoming, onLine).pipe(
      // The agent's output ending, however it ended, closes the client: every request in flight fails `closed`,
      // or `protocol` when the transport ended the output for breaking the protocol.
      Effect.catch((error) =>
        Effect.sync(() => {
          if (error instanceof AcpError) ending = error.code
        })
      ),
      Effect.catchCause((cause) =>
        Effect.logDebug("acp.output").pipe(
          Effect.annotateLogs({ outcome: "failed", interrupted: Cause.hasInterruptsOnly(cause) })
        )
      ),
      Effect.ensuring(
        Ref.set(closed, true).pipe(Effect.andThen(settleAll((method) => new AcpError({ code: ending, method }))))
      ),
      Effect.forkScoped
    )
    const request = (method: string, params: unknown): Effect.Effect<unknown, AcpError> =>
      Effect.gen(function*() {
        const id = yield* Ref.getAndUpdate(nextId, (n) => n + 1)
        const deferred = yield* Deferred.make<unknown, AcpError>()
        pending.set(id, { method, deferred })
        // Read after the request is registered: the reader marks the client closed before it fails the
        // registered requests, so a request is either refused here or failed there, never left waiting.
        if (yield* Ref.get(closed)) {
          pending.delete(id)
          return yield* new AcpError({ code: ending, method })
        }
        yield* write(method, { jsonrpc: "2.0", id, method, params }).pipe(
          Effect.tapError(() => Effect.sync(() => pending.delete(id)))
        )
        return yield* Deferred.await(deferred)
      })
    const decoded = <A>(method: string, schema: Schema.Decoder<A>) => (value: unknown) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError(() => new AcpError({ code: "protocol", method }))
      )
    const client: Client = {
      initialize: request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        ...(options.clientInfo === undefined ? {} : { clientInfo: options.clientInfo })
      }).pipe(
        Effect.flatMap(decoded("initialize", InitializeResult)),
        // An agent that does not speak the version asked for answers with one it does. This client speaks one.
        Effect.filterOrFail(
          (result) => result.protocolVersion === PROTOCOL_VERSION,
          () => new AcpError({ code: "protocol", method: "initialize" })
        ),
        Effect.map((result) => ({
          protocolVersion: result.protocolVersion,
          loadSession: result.agentCapabilities?.loadSession === true
        }))
      ),
      newSession: (cwd) =>
        request("session/new", { cwd, mcpServers: [] }).pipe(
          Effect.flatMap(decoded("session/new", NewSessionResult)),
          Effect.map((result) => result.sessionId)
        ),
      loadSession: (sessionId, cwd) => Effect.asVoid(request("session/load", { sessionId, cwd, mcpServers: [] })),
      prompt: (sessionId, text) =>
        request("session/prompt", { sessionId, prompt: [{ type: "text", text }] }).pipe(
          Effect.flatMap(decoded("session/prompt", PromptResult)),
          Effect.map((result) => result.stopReason)
        ),
      cancel: (sessionId) =>
        write("session/cancel", { jsonrpc: "2.0", method: "session/cancel", params: { sessionId } })
    }
    return client
  })

/**
 * The text of an `agent_message_chunk` update whose content is text, else
 * none.
 *
 * @category getters
 */
export const messageText = (update: Update): Option.Option<string> => {
  if (update.kind !== "agent_message_chunk") return Option.none()
  const content = update.update.content
  return isObject(content) && content.type === "text" && typeof content.text === "string"
    ? Option.some(content.text)
    : Option.none()
}
