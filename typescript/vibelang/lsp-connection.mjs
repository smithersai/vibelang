import { spawn } from "node:child_process"
import { encodeFrame, FrameDecoder, FramingError } from "./lsp-framing.mjs"

export class Connection {
  constructor(command, args, cwd, { requestTimeoutMs = 60_000, shutdownTimeoutMs = 5_000 } = {}) {
    this.requestTimeoutMs = requestTimeoutMs
    this.shutdownTimeoutMs = shutdownTimeoutMs
    this.failure = null
    this.exit = null
    this.process = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
    this.decoder = new FrameDecoder()
    this.nextId = 1
    this.pending = new Map()
    this.registrations = []
    this.log = []
    // close follows the final stdout/stderr data, and also fires after a failed spawn.
    this.exited = new Promise((resolve) => this.process.on("close", (code, signal) => {
      this.exit = { code, signal }
      this.fail(new Error("language server exited (code " + code + ", signal " + signal + ")"))
      resolve(this.exit)
    }))
    this.process.on("error", (error) => this.fail(error))
    this.process.stdin.on("error", (error) => this.fail(error))
    this.process.stderr.on("data", (chunk) => this.remember(`stderr: ${chunk}`))
    this.process.stdout.on("data", (chunk) => this.receive(chunk))
  }

  fail(error) {
    this.failure ??= error
    for (const [id, waiter] of this.pending) {
      waiter.reject(new Error(waiter.method + " (#" + id + "): " + this.failure.message))
    }
  }

  remember(line) {
    this.log.push(line.trimEnd())
    if (this.log.length > 40) this.log.shift()
  }

  receive(chunk) {
    try {
      for (const message of this.decoder.push(chunk)) this.dispatch(message)
    } catch (error) {
      if (!(error instanceof FramingError)) throw error
      this.fail(error)
    }
  }

  dispatch(message) {
    if (message.method === undefined) {
      const waiter = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) waiter?.reject(new Error(`${waiter.method}: ${message.error.message}`))
      else waiter?.resolve(message.result)
      return
    }
    if (message.method === "window/logMessage") this.remember(message.params.message)
    if (message.id === undefined) return
    // A request from the server. Answer the ones a minimal editor answers.
    let result = null
    if (message.method === "workspace/configuration") result = message.params.items.map(() => null)
    if (message.method === "client/registerCapability") this.registrations.push(...message.params.registrations)
    this.send({ jsonrpc: "2.0", id: message.id, result })
  }

  send(message) {
    this.process.stdin.write(encodeFrame(message))
  }

  request(method, params) {
    const id = this.nextId++
    const identity = method + " (#" + id + ")"
    if (this.failure) return Promise.reject(new Error(identity + ": " + this.failure.message))
    return new Promise((resolve, reject) => {
      const settle = (callback, value) => {
        clearTimeout(timer)
        this.pending.delete(id)
        callback(value)
      }
      const timer = setTimeout(() => {
        this.pending.get(id)?.reject(new Error(identity + ": no response in " + this.requestTimeoutMs + " ms"))
      }, this.requestTimeoutMs)
      this.pending.set(id, {
        method,
        resolve: (value) => settle(resolve, value),
        reject: (error) => settle(reject, error)
      })
      try { this.send({ jsonrpc: "2.0", id, method, params }) }
      catch (error) { this.fail(error) }
    })
  }

  notify(method, params) {
    if (!this.failure) this.send({ jsonrpc: "2.0", method, params })
  }

  // close asks the server to shut down and exit, and returns how it exited.
  async close() {
    if (this.exit) return this.exit
    try {
      await this.request("shutdown")
      this.notify("exit")
    } finally {
      this.process.stdin.end()
      const timer = setTimeout(() => this.process.kill("SIGKILL"), this.shutdownTimeoutMs)
      const exit = await this.exited
      clearTimeout(timer)
      return exit
    }
  }
}

