// This file is the only module loaded by the sandbox process. It deliberately
// has no imports: generated JavaScript arrives as a data URL and host calls use
// a JSON-lines RPC bridge over stdin/stdout.

const runtime = globalThis.Deno
const stdout = runtime.stdout
const reader = runtime.stdin.readable.pipeThrough(new TextDecoderStream()).getReader()
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const safeStringify = JSON.stringify.bind(JSON)
const safeParse = JSON.parse.bind(JSON)
const encode = encoder.encode.bind(encoder)
const decode = decoder.decode.bind(decoder)
const stdoutWrite = stdout.write.bind(stdout)
const readerRead = reader.read.bind(reader)
const getPrototypeOf = Object.getPrototypeOf.bind(Object)
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor.bind(Object)
const ownKeys = Reflect.ownKeys.bind(Reflect)
const hasOwn = Object.hasOwn.bind(Object)
const isArray = Array.isArray.bind(Array)
const isFiniteNumber = Number.isFinite.bind(Number)
const objectEntries = Object.entries.bind(Object)
const objectFromEntries = Object.fromEntries.bind(Object)
const defineProperty = Object.defineProperty.bind(Object)
const createObject = Object.create.bind(Object)

let writeTail = Promise.resolve()
function send(message) {
  const bytes = encode(`${safeStringify(message)}\n`)
  writeTail = writeTail.then(() => stdoutWrite(bytes))
  return writeTail
}

function strictJson(value, path = "Agent boundary value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!isFiniteNumber(value)) throw new TypeError(`${path} is not JSON: non-finite number`)
    return value
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not JSON: ${typeof value}`)
  if (seen.has(value)) throw new TypeError(`${path} is not JSON: cyclic value`)

  const prototype = getPrototypeOf(value)
  if (isArray(value)) {
    if (prototype !== Array.prototype) throw new TypeError(`${path} is not JSON: exotic array`)
    for (const key of ownKeys(value)) {
      if (key === "length") continue
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
        throw new TypeError(`${path} is not JSON: unsupported array property ${String(key)}`)
      }
    }
    seen.add(value)
    try {
      const output = []
      for (let index = 0; index < value.length; index++) {
        if (!hasOwn(value, index)) throw new TypeError(`${path}[${index}] is not JSON: array hole`)
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
    const output = createObject(null)
    for (const key of ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${path} is not JSON: symbol property`)
      const descriptor = getOwnPropertyDescriptor(value, key)
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
    const next = await readerRead()
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
  if (isArray(value)) return value.map((item) => safeLogValue(item, seen))
  return objectFromEntries(
    objectEntries(value).map(([key, item]) => [key, safeLogValue(item, seen)]),
  )
}

function serializeError(error) {
  const value = error instanceof Error ? error : new Error(String(error))
  const fields = objectFromEntries(
    objectEntries(value).map(([key, item]) => [key, safeLogValue(item)]),
  )
  return {
    name: value.name,
    message: value.message,
    stack: value.stack,
    fields,
  }
}

const pending = new Map()
function startResponseReader() {
  void (async () => {
    try {
      while (true) {
        const line = await readLine()
        if (line === undefined) throw new Error("Host RPC channel closed")
        if (!line) continue
        const response = safeParse(line)
        if (
          response === null || typeof response !== "object" ||
          !Number.isSafeInteger(response.id) || typeof response.ok !== "boolean"
        ) throw new Error("Host sent an invalid RPC response")
        const waiter = pending.get(response.id)
        if (!waiter) throw new Error("Host responded to an unknown RPC call")
        pending.delete(response.id)
        if (response.ok) waiter.resolve(response.result)
        else {
          const error = new Error(response.error?.message ?? "Host function failed")
          error.name = response.error?.name ?? "HostFunctionError"
          if (response.error?.stack) error.stack = response.error.stack
          if (response.error?.fields && typeof response.error.fields === "object") {
            for (const [key, value] of objectEntries(response.error.fields)) {
              defineProperty(error, key, {
                value,
                configurable: true,
                enumerable: true,
                writable: true,
              })
            }
          }
          waiter.reject(error)
        }
      }
    } catch (error) {
      for (const waiter of pending.values()) waiter.reject(error)
      pending.clear()
    }
  })()
}

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
  defineProperty(globalThis, name, {
    value: undefined,
    configurable: false,
    enumerable: false,
    writable: false,
  })
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
  "ShadowRealm",
  "BroadcastChannel",
  "crypto",
  "performance",
  "navigator",
  "Intl",
  "Temporal",
  "localStorage",
  "sessionStorage",
  "setTimeout",
  "setInterval",
]) {
  hide(name)
}

const RealDate = Date
const parseDate = RealDate.parse.bind(RealDate)
const utcDate = RealDate.UTC.bind(RealDate)
function SandboxedDate() {
  throw new Error("Date construction is unavailable; pass a clock or date parser function")
}
defineProperty(SandboxedDate, "now", {
  value() { throw new Error("Ambient clock is unavailable; pass a clock function") },
  configurable: false,
  writable: false,
})
defineProperty(SandboxedDate, "parse", { value: parseDate, configurable: false, writable: false })
defineProperty(SandboxedDate, "UTC", { value: utcDate, configurable: false, writable: false })
Object.freeze(SandboxedDate.prototype)
Object.freeze(SandboxedDate)
defineProperty(globalThis, "Date", { value: SandboxedDate, configurable: false, writable: false })
defineProperty(Math, "random", {
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

Object.freeze(console)
for (const intrinsic of [
  Object, Array, Map, Set, WeakMap, WeakSet, Promise, JSON, Reflect, Math,
  Number, String, Boolean, BigInt, Symbol, RegExp, Error, TypeError, RangeError,
  SyntaxError, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, URL, URLSearchParams,
]) {
  if (intrinsic?.prototype && ![Error, TypeError, RangeError, SyntaxError].includes(intrinsic)) {
    Object.freeze(intrinsic.prototype)
  }
  Object.freeze(intrinsic)
}
for (const [name, intrinsic] of [
  ["Object", Object], ["Array", Array], ["Map", Map], ["Set", Set],
  ["WeakMap", WeakMap], ["WeakSet", WeakSet], ["Promise", Promise],
  ["JSON", JSON], ["Reflect", Reflect], ["Math", Math], ["Number", Number],
  ["String", String], ["Boolean", Boolean], ["BigInt", BigInt], ["Symbol", Symbol],
  ["RegExp", RegExp], ["Error", Error], ["TypeError", TypeError],
  ["RangeError", RangeError], ["SyntaxError", SyntaxError], ["Uint8Array", Uint8Array],
  ["ArrayBuffer", ArrayBuffer], ["TextEncoder", TextEncoder], ["TextDecoder", TextDecoder],
  ["URL", URL], ["URLSearchParams", URLSearchParams],
]) defineProperty(globalThis, name, { value: intrinsic, configurable: false, writable: false })

try {
  const initialLine = await readLine()
  if (initialLine === undefined) throw new Error("Host closed before sandbox initialization")
  const initial = safeParse(initialLine)
  if (
    initial?.type !== "init" || initial.protocol !== 1 ||
    typeof initial.sourceBase64 !== "string" || !isArray(initial.functionNames) ||
    initial.functionNames.some((name) => typeof name !== "string")
  ) throw new TypeError("Host sent invalid sandbox initialization")
  startResponseReader()

  const sourceBytes = Uint8Array.from(atob(initial.sourceBase64), (character) =>
    character.charCodeAt(0),
  )
  const source = decode(sourceBytes)
  const functions = objectFromEntries(
    initial.functionNames.map((name) => [name, (input) => callHost(name, input)]),
  )
  const moduleUrl = `data:text/javascript;base64,${initial.sourceBase64}`
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
