// A dependency-free JSON-RPC client for a language server on stdio, such as
// `vibelang --lsp --stdio`. It frames messages with Content-Length headers,
// matches responses to requests, and answers the server's own requests.
import { encodeFrame, FrameDecoder, FramingError } from "../../typescript/vibelang/lsp-framing.mjs"

export type Server = {
  request(method: string, params: unknown): Promise<any>
  notify(method: string, params: unknown): void
  // Sends shutdown and exit, then waits for the process to end.
  close(): Promise<void>
}

// The server answered a request with an error, such as a panic while it
// handled the request. The server itself is still running.
export class ResponseError extends Error {
  constructor(message: string, readonly code: number) { super(message) }
}

export function startServer(command: string[]): Server {
  const child = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const pending = new Map<number, { method: string; resolve: (value: any) => void; reject: (error: Error) => void }>()
  let nextId = 1
  let stderr = ""
  let failure: Error | undefined
  const fail = (error: Error) => {
    failure ??= error
    for (const [id, waiter] of pending) waiter.reject(new Error(`request ${id} (${waiter.method}): ${failure.message}`))
    pending.clear()
  }
  const send = (message: object) => {
    child.stdin.write(encodeFrame({ jsonrpc: "2.0", ...message }))
    child.stdin.flush()
  }
  // The server asks for settings and registrations; the defaults serve.
  const answer = (message: any) => send({ id: message.id, result: message.method === "workspace/configuration" ? message.params.items.map(() => null) : null })
  // Dispatch complete messages independently of how stdout chunks split frames.
  const receive = (message: any) => {
    if (message.method && message.id !== undefined) answer(message)
    else if (message.id !== undefined) {
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) waiter?.reject(new ResponseError(message.error.message, message.error.code))
      else waiter?.resolve(message.result)
    }
  }
  void (async () => {
    for await (const chunk of child.stderr) stderr = (stderr + new TextDecoder().decode(chunk)).slice(-4000)
  })()
  void (async () => {
    const decoder = new FrameDecoder()
    for await (const chunk of child.stdout) {
      if (failure) return
      try {
        for (const message of decoder.push(chunk)) receive(message)
      } catch (error) {
        // Reject the caller's requests so its finally can close the server;
        // never expose a malformed response's body through parser exceptions.
        fail(new Error(`server sent malformed LSP ${error instanceof FramingError ? error.stage : "message"}`))
        return
      }
    }
    fail(new Error("server stdout closed"))
  })().catch(() => fail(new Error("server stdout failed")))
  void child.exited.then(code => {
    fail(new Error(`${command[0]} exited with ${code}${stderr ? `:\n${stderr}` : ""}`))
  })
  return {
    request(method, params) {
      if (failure) return Promise.reject(failure)
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject })
        send({ id, method, params })
      })
    },
    notify(method, params) {
      if (!failure) send({ method, params })
    },
    async close() {
      if (!failure) {
        await this.request("shutdown", null).catch(() => {})
        this.notify("exit", null)
      } else child.kill()
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000)
      await child.exited
      clearTimeout(timer)
    }
  }
}
