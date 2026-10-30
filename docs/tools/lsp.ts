// A dependency-free JSON-RPC client for a language server on stdio, such as
// `vibelang --lsp --stdio`. It frames messages with Content-Length headers,
// matches responses to requests, and answers the server's own requests.
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
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  let nextId = 1
  let stderr = ""
  let failure: Error | undefined
  const send = (message: object) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    child.stdin.write(body)
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
    let buffer = Buffer.alloc(0)
    for await (const chunk of child.stdout) {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const head = buffer.indexOf("\r\n\r\n")
        if (head < 0) break
        const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, head).toString())?.[1])
        if (buffer.length < head + 4 + length) break
        const message = JSON.parse(buffer.subarray(head + 4, head + 4 + length).toString())
        buffer = buffer.subarray(head + 4 + length)
        receive(message)
      }
    }
  })()
  void child.exited.then(code => {
    failure = new Error(`${command[0]} exited with ${code}${stderr ? `:\n${stderr}` : ""}`)
    for (const waiter of pending.values()) waiter.reject(failure)
    pending.clear()
  })
  return {
    request(method, params) {
      if (failure) return Promise.reject(failure)
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
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
      }
      const timer = setTimeout(() => child.kill(), 2000)
      await child.exited
      clearTimeout(timer)
    }
  }
}
