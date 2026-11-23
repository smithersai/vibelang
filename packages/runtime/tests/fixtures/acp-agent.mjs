#!/usr/bin/env node
// A deterministic agent that speaks the Agent Client Protocol (ACP) on its
// stdio: one JSON-RPC 2.0 message per line. It does what the instruction
// lines of its prompt say, in order, so a test of an ACP client drives a real
// process with real streams and real file edits, and no model. It has no
// dependencies. Adapted from the test agent of Smithers' agent package.
//
// Instructions, one per line of the prompt (other lines are ignored):
//   write `FILE` `TEXT`        writes TEXT to FILE, relative to the session's cwd
//   add the line `X` to `FILE` appends X and a newline to FILE
//   delete `FILE`              removes FILE
//   say `TEXT`                 sends TEXT as message text
//   say env NAME               sends the value of environment variable NAME
//   say cwd                    sends the process's working directory
//   ask permission             asks session/request_permission and says which option the client chose
//   read a file                asks the client fs/read_text_file and says the error code it got
//   open a terminal            asks the client terminal/create and says the error code it got
//   say garbage                writes a line that is not JSON, an update that is not one, a response to
//                              nothing and an unknown notification, then goes on
//   refuse                     ends the turn with stop reason refusal
//   run out                    ends the turn with stop reason max_tokens
//   answer badly               answers the prompt with a stop reason the protocol does not have
//   fail the prompt            answers the prompt with JSON-RPC error -32000, as a missing login does
//   exit                       the process exits with code 3 in the middle of the turn
//   wait                       never ends the turn; session/cancel ends it with stop reason cancelled
//   wait forever               never ends the turn, whatever the client asks
//   say `TEXT` N times         sends TEXT as message text N times, as one chunk
//   say `TEXT` as another session  sends TEXT as message text of a session the client never opened
//   write an endless line      writes 17,000,000 characters with no end of line, and never ends the turn
//   answer with no id          answers with a JSON-RPC error whose id is null, as an agent that could not
//                              read a request does, and never ends the turn
//
// ACP_AGENT_PID_FILE names a file the agent writes its pid to, so a test can
// check that the process is gone. ACP_AGENT_CANCEL_FILE names a file it
// writes when it is asked to cancel. ACP_AGENT_MODE=bad-initialize answers
// initialize with no protocol version, other-version answers with protocol
// version 2, mute answers nothing and stays alive, and stubborn ignores the
// signal that asks it to stop.
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { createInterface } from "node:readline"

if (process.env.ACP_AGENT_MODE === "stubborn") {
  // Stays alive after its input closes, and ignores the signal that asks it to stop.
  process.on("SIGTERM", () => {})
  setInterval(() => {}, 1000)
}
if (process.env.ACP_AGENT_PID_FILE) writeFileSync(process.env.ACP_AGENT_PID_FILE, String(process.pid))

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n")
const update = (sessionId, body) => send({ method: "session/update", params: { sessionId, update: body } })
const say = (sessionId, text) => update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } })

const sessions = new Map()
const asked = new Map()
const waiting = new Map()
let nextRequest = 1000
let nextSession = 1

// A request to the client: resolves with its result, or { error } when it refused.
const ask = (method, params) =>
  new Promise((done) => {
    const id = nextRequest++
    asked.set(id, done)
    send({ id, method, params })
  })

const edit = (sessionId, title, change) => {
  const toolCallId = `call-${nextRequest++}`
  update(sessionId, { sessionUpdate: "tool_call", toolCallId, title, kind: "edit", status: "in_progress" })
  change()
  update(sessionId, { sessionUpdate: "tool_call_update", toolCallId, status: "completed" })
}

const prompt = async (id, sessionId, text) => {
  const cwd = sessions.get(sessionId)
  const end = (stopReason) => send({ id, result: { stopReason } })
  update(sessionId, { sessionUpdate: "user_message_chunk", content: { type: "text", text } })
  for (const line of text.split("\n")) {
    let match
    if ((match = /^write `([^`]+)` `([^`]*)`$/.exec(line))) {
      const file = resolve(cwd, match[1])
      edit(sessionId, "Write a file", () => {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, match[2])
      })
    } else if ((match = /^add the line `([^`]*)` to `([^`]+)`$/.exec(line))) {
      const file = resolve(cwd, match[2])
      edit(sessionId, "Edit a file", () => {
        mkdirSync(dirname(file), { recursive: true })
        appendFileSync(file, match[1] + "\n")
      })
    } else if ((match = /^delete `([^`]+)`$/.exec(line))) {
      edit(sessionId, "Delete a file", () => rmSync(resolve(cwd, match[1]), { force: true }))
    } else if ((match = /^say `([^`]*)`$/.exec(line))) {
      say(sessionId, match[1])
    } else if ((match = /^say env (\w+)$/.exec(line))) {
      say(sessionId, `${match[1]}=${process.env[match[1]] ?? "(unset)"}`)
    } else if (line === "say cwd") {
      say(sessionId, process.cwd())
    } else if (line === "ask permission") {
      const answer = await ask("session/request_permission", {
        sessionId,
        toolCall: { toolCallId: "call-permission" },
        options: [
          { optionId: "no", name: "Reject", kind: "reject_once" },
          { optionId: "always", name: "Always allow", kind: "allow_always" },
          { optionId: "yes", name: "Allow", kind: "allow_once" }
        ]
      })
      say(sessionId, `permission: ${answer?.outcome?.outcome === "selected" ? answer.outcome.optionId : "cancelled"}`)
    } else if (line === "read a file") {
      const answer = await ask("fs/read_text_file", { sessionId, path: resolve(cwd, "README.md") })
      say(sessionId, `fs/read_text_file: ${answer?.error?.code ?? "served"}`)
    } else if (line === "open a terminal") {
      const answer = await ask("terminal/create", { sessionId, command: "id" })
      say(sessionId, `terminal/create: ${answer?.error?.code ?? "served"}`)
    } else if (line === "say garbage") {
      process.stdout.write("this line is not JSON\n")
      send({ method: "session/update", params: { sessionId, update: "not an update" } })
      send({ id: 424242, result: {} })
      send({ method: "session/unknown_notification", params: {} })
    } else if (line === "refuse") {
      return end("refusal")
    } else if (line === "run out") {
      return end("max_tokens")
    } else if (line === "answer badly") {
      return end("nonsense")
    } else if (line === "fail the prompt") {
      return send({ id, error: { code: -32000, message: "Authentication required: the task was " + text } })
    } else if (line === "exit") {
      process.exit(3)
    } else if (line === "wait forever") {
      return void (await new Promise(() => {}))
    } else if ((match = /^say `([^`]*)` (\d+) times$/.exec(line))) {
      say(sessionId, match[1].repeat(Number(match[2])))
    } else if ((match = /^say `([^`]*)` as another session$/.exec(line))) {
      say("session-of-someone-else", match[1])
    } else if (line === "write an endless line") {
      process.stdout.write("x".repeat(17_000_000))
      return void (await new Promise(() => {}))
    } else if (line === "answer with no id") {
      send({ id: null, error: { code: -32700, message: "Parse error" } })
      return void (await new Promise(() => {}))
    } else if (line === "wait") {
      await new Promise((cancelled) => waiting.set(sessionId, cancelled))
      return end("cancelled")
    }
  }
  say(sessionId, "Done.")
  end("end_turn")
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === undefined) {
    const done = asked.get(message.id)
    asked.delete(message.id)
    return done?.(message.error === undefined ? message.result : { error: message.error })
  }
  const { id, method, params } = message
  if (process.env.ACP_AGENT_MODE === "mute") return
  if (method === "initialize") {
    return send({
      id,
      result: process.env.ACP_AGENT_MODE === "bad-initialize"
        ? {}
        : {
          protocolVersion: process.env.ACP_AGENT_MODE === "other-version" ? 2 : 1,
          agentCapabilities: { loadSession: false }
        }
    })
  }
  if (method === "session/new") {
    const sessionId = `session-${nextSession++}`
    sessions.set(sessionId, params.cwd)
    return send({ id, result: { sessionId } })
  }
  if (method === "session/prompt") {
    return void prompt(id, params.sessionId, params.prompt.map((part) => part.text ?? "").join(""))
  }
  if (method === "session/cancel") {
    if (process.env.ACP_AGENT_CANCEL_FILE) writeFileSync(process.env.ACP_AGENT_CANCEL_FILE, params.sessionId)
    return waiting.get(params.sessionId)?.()
  }
  if (id !== undefined) send({ id, error: { code: -32601, message: "Method not found" } })
})
