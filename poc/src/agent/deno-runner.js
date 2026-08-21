// This file is the only module loaded by the sandbox process. It deliberately
// has no imports: generated JavaScript arrives as a data URL and host calls use
// a JSON-lines RPC bridge over stdin/stdout.

const runtime = globalThis.Deno
const stdout = runtime.stdout
const reader = runtime.stdin.readable.pipeThrough(new TextDecoderStream()).getReader()
const encoder = new TextEncoder()
const decoder = new TextDecoder()

let writeTail = Promise.resolve()
function send(message) {
  const bytes = encoder.encode(`${JSON.stringify(message)}\n`)
  writeTail = writeTail.then(() => stdout.write(bytes))
  return writeTail
}

function strictJson(value, path = "Agent boundary value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not JSON: non-finite number`)
    return value
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not JSON: ${typeof value}`)
  if (seen.has(value)) throw new TypeError(`${path} is not JSON: cyclic value`)

  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new TypeError(`${path} is not JSON: exotic array`)
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
        throw new TypeError(`${path} is not JSON: unsupported array property ${String(key)}`)
      }
    }
    seen.add(value)
    try {
      const output = []
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is not JSON: array hole`)
        output.push(strictJson(value[index], `${path}[${index}]`, seen))
      }
      return output
    } finally {
      seen.delete(value)
    }
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} is not JSON: ${prototype?.constructor?.name ?? "exotic object"}`)
  }
  seen.add(value)
  try {
    const output = Object.create(null)
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${path} is not JSON: symbol property`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
        throw new TypeError(`${path}.${key} is not JSON: accessor or non-enumerable property`)
      }
      output[key] = strictJson(descriptor.value, `${path}.${key}`, seen)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

let inputBuffer = ""
async function readLine() {
  while (true) {
    const newline = inputBuffer.indexOf("\n")
    if (newline >= 0) {
      const line = inputBuffer.slice(0, newline)
      inputBuffer = inputBuffer.slice(newline + 1)
      return line
    }
    const next = await reader.read()
    if (next.done) return inputBuffer.length ? inputBuffer : undefined
    inputBuffer += next.value
  }
}

function safeLogValue(value, seen = new WeakSet()) {
  if (value === undefined) return "[undefined]"
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`
  if (typeof value === "symbol") return String(value)
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? "" }
  }
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => safeLogValue(item, seen))
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, safeLogValue(item, seen)]),
  )
}

function serializeError(error) {
  const value = error instanceof Error ? error : new Error(String(error))
  const fields = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, safeLogValue(item)]),
  )
  return {
    name: value.name,
    message: value.message,
    stack: value.stack,
    fields,
  }
}

const pending = new Map()
void (async () => {
  try {
    while (true) {
      const line = await readLine()
      if (line === undefined) throw new Error("Host RPC channel closed")
      if (!line) continue
      const response = JSON.parse(line)
      const waiter = pending.get(response.id)
      if (!waiter) continue
      pending.delete(response.id)
      if (response.ok) waiter.resolve(response.result)
      else {
        const error = new Error(response.error?.message ?? "Host function failed")
        error.name = response.error?.name ?? "HostFunctionError"
        if (response.error?.stack) error.stack = response.error.stack
        if (response.error?.fields) Object.assign(error, response.error.fields)
        waiter.reject(error)
      }
    }
  } catch (error) {
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }
})()

let nextCallId = 1
function callHost(name, input) {
  const durableInput = strictJson(input, `Function ${name} input`)
  const id = nextCallId++
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  void send({ type: "call", id, name, input: durableInput }).catch((error) => {
    const waiter = pending.get(id)
    pending.delete(id)
    waiter?.reject(error)
  })
  return result
}

function hide(name) {
  try {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: false,
      enumerable: false,
      writable: false,
    })
  } catch {
    // Deno's OS permission layer remains authoritative if a global cannot be hidden.
  }
}

for (const name of [
  "Deno",
  "process",
  "Buffer",
  "require",
  "module",
  "fetch",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "crypto",
  "performance",
  "setTimeout",
  "setInterval",
]) {
  hide(name)
}

const RealDate = Date
class SandboxedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) throw new Error("Ambient clock is unavailable; pass a clock function")
    super(...args)
  }
  static now() {
    throw new Error("Ambient clock is unavailable; pass a clock function")
  }
}
Object.defineProperty(globalThis, "Date", { value: SandboxedDate })
Object.defineProperty(Math, "random", {
  value() {
    throw new Error("Ambient random is unavailable; pass a random function")
  },
})

for (const level of ["log", "info", "warn", "error"]) {
  console[level] = (...values) => void send({
    type: "log",
    level,
    values: values.map((value) => safeLogValue(value)),
  })
}

try {
  const sourceBytes = Uint8Array.from(atob(runtime.args[0]), (character) =>
    character.charCodeAt(0),
  )
  const source = decoder.decode(sourceBytes)
  const names = JSON.parse(runtime.args[1])
  const functions = Object.fromEntries(
    names.map((name) => [name, (input) => callHost(name, input)]),
  )
  const moduleUrl = `data:text/javascript;base64,${runtime.args[0]}`
  const generated = await import(moduleUrl)
  if (typeof generated.default !== "function") {
    throw new TypeError("Generated module must default-export a turn function")
  }
  const result = await generated.default(Object.freeze(functions))
  if (pending.size > 0) {
    const error = new Error(
      `Generated turn returned with ${pending.size} unawaited host call${pending.size === 1 ? "" : "s"}`,
    )
    error.name = "UnawaitedHostCalls"
    error.callIds = [...pending.keys()]
    throw error
  }
  await send({ type: "complete", result: strictJson(result, "Generated turn result") })
  runtime.exit(0)
} catch (error) {
  await send({ type: "failed", error: serializeError(error) })
  runtime.exit(1)
}
