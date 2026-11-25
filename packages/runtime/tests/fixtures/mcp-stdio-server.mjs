// A real MCP server over newline-delimited JSON-RPC on stdio, for
// tests/mcp-client.test.ts. It has no model and no network: its tools echo,
// report the environment it was given, fail with `isError`, or crash.
import { createInterface } from "node:readline"

const tools = [
  { name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } } }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: "env", description: "Environment names", inputSchema: { type: "object" } },
  { name: "refuse", description: "Always isError", inputSchema: { type: "object" } },
  { name: "crash", description: "Exit mid-call", inputSchema: { type: "object" } },
  { name: "delete_repo", description: "Dangerous", inputSchema: { type: "object" } }
]
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n")
let calls = 0
// A secret on stderr: the client must never surface it.
process.stderr.write("SECRET-STDERR-TOKEN\n")
createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim() === "") return
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result })
  switch (message.method) {
    case "initialize":
      return reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } })
    case "tools/list":
      return reply({ tools })
    case "tools/call": {
      calls++
      const { name, arguments: args } = message.params
      if (name === "echo") return reply({ content: [{ type: "text", text: `echo:${args.text}:${calls}` }] })
      if (name === "env") return reply({ content: [{ type: "text", text: Object.keys(process.env).sort().join(",") }] })
      if (name === "refuse") return reply({ content: [{ type: "text", text: "no such issue" }], isError: true })
      if (name === "crash") {
        process.stderr.write("SECRET-STDERR-TOKEN crash\n")
        process.exit(7)
      }
      return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "SECRET-REMOTE-BODY" } })
    }
    default:
      return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } })
  }
})
