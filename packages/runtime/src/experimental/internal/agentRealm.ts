/**
 * The realm a cell runs in (VIP-63): one QuickJS interpreter per agent run,
 * inside its own WebAssembly memory.
 *
 * A cell is JavaScript a model wrote, so it never runs in the host's realm.
 * It runs here, where its only way to act is a tool the run was handed:
 *
 * - The interpreter has no module loader, file system, network, timers,
 *   `Date` or `Math.random`. The host installs `tools`, `done` and `console`
 *   and nothing else.
 * - A tool call leaves the realm as a name and JSON text. The realm refuses a
 *   name it was not handed before the host is asked, and the host checks the
 *   name again.
 * - The memory ceiling is the size of the WebAssembly memory itself, so it
 *   also bounds strings, which the interpreter's own accounting skips. A
 *   realm that ran out of memory, or whose interpreter failed, is spent: it
 *   runs no further cell, and the run opens a fresh one.
 * - The compute ceiling is an interrupt the interpreter polls, read from the
 *   real clock: a test clock that never moves must not let a loop run forever.
 * - Calls settle one at a time, in the order the cell issued them, so a cell
 *   that is run again reaches the same calls in the same order.
 *
 * Ported from the QuickJS binding of Smithers' agent harness.
 *
 * @internal
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Scope from "effect/Scope"
import type * as QuickJSCore from "quickjs-emscripten-core"
import type { QuickJSContext, QuickJSDeferredPromise, QuickJSHandle, QuickJSRuntime } from "quickjs-emscripten-core"

/** The ceilings a realm enforces. Every one is always set. */
export interface Limits {
  /** Tool calls one cell may make. */
  readonly calls: number
  /** Milliseconds one cell may compute. Time spent waiting on a tool is not counted. */
  readonly timeMs: number
  /** Milliseconds one tool call may take. */
  readonly callMs: number
  /** Bytes of memory the whole run may hold. */
  readonly memoryBytes: number
}

const page = 65536

/**
 * The smallest memory a realm opens with: the interpreter's own 16 MiB and
 * room to run.
 */
export const minimumMemoryBytes = 32 * 1024 * 1024

/** The largest memory a realm opens with: all a 32-bit WebAssembly memory can address. */
export const maximumMemoryBytes = 65536 * page

/** What one cell may print before the rest is counted instead of kept. */
export const printBytes = 64 * 1024

const stackBytes = 128 * 1024

/**
 * The interpreter a realm runs: `quickjs-emscripten-core`'s two constructors
 * and one synchronous build of QuickJS.
 */
export interface Build {
  readonly core: Pick<typeof QuickJSCore, "newQuickJSWASMModuleFromVariant" | "newVariant">
  readonly variant: QuickJSCore.QuickJSSyncVariant
}

const packages = ["quickjs-emscripten-core", "@jitl/quickjs-singlefile-browser-release-sync"]

/**
 * Loads the build `vibelang-runtime` depends on. The package names are not
 * literals in the import call, so a bundler does not pull the interpreter
 * into a program that never runs an agent. A bundled program names its build
 * instead.
 */
export const loadDefault = async (): Promise<Build> => {
  const [core, variant] = await Promise.all(
    packages.map((name) => import(/* @vite-ignore */ /* webpackIgnore: true */ name))
  )
  return { core, variant: variant.default }
}

/** The realm could not be opened, or it broke. */
export class RealmError extends Data.TaggedError("RealmError")<{
  readonly reason: "unavailable" | "failed"
  readonly message: string
  readonly cause?: unknown
}> {}

/** One tool call a cell issued. `ordinal` counts from zero within the cell. */
export interface Call {
  readonly ordinal: number
  readonly tool: string
  readonly input: unknown
}

/** A failed call, as the cell sees it. */
export interface CallError {
  readonly code: string
  readonly message: string
  readonly value?: unknown
}

/**
 * What a call resolves to. A failure resolves in the cell as
 * `{ ok: false, error }`; it does not throw.
 */
export type CallResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: CallError }

/** How a cell ended. */
export type Outcome =
  | { readonly _tag: "Continue" }
  | { readonly _tag: "Done"; readonly value: unknown }
  | { readonly _tag: "Raised"; readonly name: string; readonly message: string }
  | {
    readonly _tag: "Rejected"
    readonly code: "compile_failed" | "limit_exceeded" | "stalled" | "crashed"
    readonly limit?: "calls" | "time" | "memory"
    readonly message: string
  }

/** One evaluated cell. */
export interface Frame {
  readonly outcome: Outcome
  /** What the cell printed, with a notice when lines were dropped. */
  readonly prints: string
  /** How many tool calls reached the host. */
  readonly calls: number
  /**
   * Whether the realm is spent: it ran out of memory, its interpreter
   * failed, or the cell left jobs behind. It runs no further cell.
   */
  readonly spent: boolean
}

export interface Realm {
  /**
   * Runs one cell. `handler` settles each tool call. A handler that fails or
   * is interrupted tears the cell down, and the failure is the evaluation's.
   *
   * `around` wraps each call after its time limit is applied, so what it
   * returns is what the cell reads. A caller that records calls records
   * there, and a timeout is then recorded like any other result.
   */
  readonly evaluate: <E, R>(
    source: string,
    handler: (call: Call) => Effect.Effect<CallResult, E, R>,
    around?: (call: Call, result: Effect.Effect<CallResult, E, R>) => Effect.Effect<CallResult, E, R>
  ) => Effect.Effect<Frame, E | RealmError, R>
}

// The realm-side half. The intrinsics it reads by name (`JSON`, `Object`,
// `Promise`, `Array`) are captured before a cell runs, so a cell that rebinds
// one breaks only its own later code. Methods it reaches through a prototype
// (`then`, `forEach`, `indexOf`, `map`, `join`) are looked up when called. A
// cell that replaces one of those runs its own code in its own cell, on the
// cell's clock, and the host still checks every name and parses every text
// that crosses the boundary.
const prelude = (names: ReadonlyArray<string>): string =>
  `(function () {
  var bridge = globalThis.__call
  var print = globalThis.__print
  var finish = globalThis.__done
  delete globalThis.__call
  delete globalThis.__print
  delete globalThis.__done
  // A cell that is run again must reach the same calls, so the two sources
  // of nondeterminism the interpreter ships with are removed.
  delete globalThis.Date
  delete Math.random
  var keysOf = Object.keys
  var prototypeOf = Object.getPrototypeOf
  var objectPrototype = Object.prototype
  var define = Object.defineProperty
  var freeze = Object.freeze
  var isArray = Array.isArray
  var stringify = JSON.stringify
  var parse = JSON.parse
  var finite = Number.isFinite
  var render = String
  var Fault = TypeError
  var Failure = Error
  var Deferred = Promise
  var Bytes = ArrayBuffer
  var slice = Array.prototype.slice
  var encode = function (label, input) {
    var seen = []
    var visit = function (value) {
      if (value === null || typeof value === "string" || typeof value === "boolean") return
      if (typeof value === "number" && finite(value)) return
      if (typeof value !== "object") throw new Fault(label + " must be JSON: it holds a " + typeof value)
      if (seen.indexOf(value) >= 0) throw new Fault(label + " must be JSON: it holds a cycle")
      var prototype = prototypeOf(value)
      if (!isArray(value) && prototype !== objectPrototype && prototype !== null) {
        throw new Fault(label + " must be JSON: it holds a class instance")
      }
      seen.push(value)
      keysOf(value).forEach(function (key) { visit(value[key]) })
      seen.pop()
    }
    visit(input)
    var text = stringify(input)
    // A toJSON the cell wrote can turn a value into no JSON at all.
    if (typeof text !== "string") throw new Fault(label + " must be JSON: its toJSON gave no value")
    return text
  }
  var sealed = false
  var sealedResult = freeze({ ok: false, error: freeze({ code: "run_completed", message: "done(answer) was already called in this cell, so no further tool call runs." }) })
  // The host answers a call with JSON text. A string has no "then" for the
  // interpreter to look up, so the host's answer runs no code of the cell's;
  // the text is parsed here, in the cell's own job.
  var settle = function (text) {
    var settled = parse(text)
    if (settled.aborted) throw new Failure(settled.message)
    return settled.ok ? settled.value : { ok: false, error: settled.error }
  }
  var tools = {}
  parse(${JSON.stringify(JSON.stringify(names))}).forEach(function (name) {
    define(tools, name, {
      enumerable: true,
      writable: false,
      configurable: false,
      value: function (input) {
        if (sealed) return Deferred.resolve(sealedResult)
        var encoded
        try {
          encoded = encode("The input of tools." + name, input === undefined ? {} : input)
        } catch (error) {
          return Deferred.reject(error)
        }
        // Encoding can run a getter the cell wrote, so the seal is read again.
        if (sealed) return Deferred.resolve(sealedResult)
        return bridge(name, encoded).then(settle)
      }
    })
  })
  var show = function (value) {
    if (typeof value === "string") return value
    if (value === undefined) return "undefined"
    var encoded
    try { encoded = stringify(value) } catch (error) { return "[unprintable " + typeof value + "]" }
    return encoded === undefined ? render(value) : encoded
  }
  var line = function () { print(slice.call(arguments).map(show).join(" ")) }
  var host = function (name, value) {
    define(globalThis, name, { value: value, writable: false, enumerable: true, configurable: false })
  }
  host("tools", freeze(tools))
  host("console", freeze({ log: line, info: line, warn: line, error: line, debug: line }))
  host("done", function (answer) {
    if (sealed) return
    if (arguments.length === 0) throw new Fault("done(answer) takes the run's answer")
    var encoded = encode("The answer", answer === undefined ? null : answer)
    // Encoding can run a getter the cell wrote, and that getter can call done.
    if (sealed) return
    sealed = true
    finish(encoded)
  })
  return {
    open: function () { sealed = false },
    // Whether this many bytes can be allocated right now. The buffer is
    // released as the function returns, so the host's next allocation fits.
    room: function (bytes) { try { new Bytes(bytes); return true } catch (error) { return false } }
  }
})()`

const describe = (dumped: unknown): { readonly name: string; readonly message: string } => {
  if (typeof dumped === "object" && dumped !== null) {
    const record = dumped as { readonly name?: unknown; readonly message?: unknown }
    return {
      name: typeof record.name === "string" ? bounded(record.name, 200) : "Error",
      message: bounded(typeof record.message === "string" ? record.message : safeJson(dumped))
    }
  }
  return { name: "Error", message: bounded(String(dumped)) }
}

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const bounded = (text: string, length = 2000): string => text.length > length ? `${text.slice(0, length)}…` : text

interface Pending {
  readonly call: Call
  readonly deferred: QuickJSDeferredPromise
}

const unavailable = (cause: unknown): RealmError =>
  new RealmError({
    reason: "unavailable",
    message: "The QuickJS sandbox could not be loaded. Check that WebAssembly and the QuickJS build are available.",
    cause
  })

/**
 * Opens a realm that lives as long as the scope. `tools` are the names a
 * cell may call.
 */
export const open = (options: {
  readonly tools: ReadonlyArray<string>
  readonly limits: Limits
  readonly load?: (() => Promise<Build>) | undefined
}): Effect.Effect<Realm, RealmError, Scope.Scope> =>
  Effect.gen(function*() {
    const limits = { ...options.limits }
    const handed = new Set(options.tools)
    if (!Number.isSafeInteger(limits.calls) || limits.calls < 0) {
      return yield* new RealmError({ reason: "failed", message: "The tool call limit must be a non-negative safe integer." })
    }
    if (![limits.timeMs, limits.callMs].every((ms) => Number.isFinite(ms) && ms >= 0)) {
      return yield* new RealmError({ reason: "failed", message: "Time limits must be finite, non-negative milliseconds." })
    }
    if (!(limits.memoryBytes >= minimumMemoryBytes && limits.memoryBytes <= maximumMemoryBytes)) {
      return yield* new RealmError({
        reason: "failed",
        message: `A realm's memory is between ${minimumMemoryBytes} and ${maximumMemoryBytes} bytes, not ${limits.memoryBytes}.`
      })
    }

    const loaded = yield* Effect.tryPromise({
      try: async () => {
        const { core, variant } = await (options.load ?? loadDefault)()
        const wasmMemory = new WebAssembly.Memory({ initial: 256, maximum: Math.floor(limits.memoryBytes / page) })
        const module = await core.newQuickJSWASMModuleFromVariant(core.newVariant(variant, { wasmMemory }))
        return { module, wasmMemory }
      },
      catch: unavailable
    })
    const { module, wasmMemory } = loaded
    const memoryCeiling = Math.floor(limits.memoryBytes / page) * page
    // The memory grows in steps of at least a twentieth of its size, so it is
    // as large as it will get once one more step would pass the ceiling.
    const fullyGrown = (): boolean => wasmMemory.buffer.byteLength * 1.05 + page > memoryCeiling
    const outOfMemory = (hint: string): Outcome => ({
      _tag: "Rejected",
      code: "limit_exceeded",
      limit: "memory",
      message: `The run used all ${limits.memoryBytes} bytes of its memory. ${hint}`
    })

    // Set once the interpreter threw into the host. Nothing enters it again,
    // and nothing is disposed: the whole memory is dropped with the run.
    let broken = false
    // Set once the realm ran out of memory. Its state cannot be trusted to
    // run another cell.
    let spent = false
    let closing = false
    let armed = false
    let used = 0
    let enteredAt = 0
    let exhausted: Outcome | undefined
    let pending: Array<Pending> = []
    let ordinal = 0
    // Set once the cell issued a call past its limit. The call was refused.
    let overflowed = false
    let issuedChars = 0
    let answer: { readonly value: unknown } | undefined
    let lines: Array<string> = []
    let retained = 0
    let dropped = 0
    let frames = 0

    const enter = <A>(call: () => A): A => {
      enteredAt = performance.now()
      armed = true
      try {
        return call()
      } catch (error) {
        broken = true
        throw error
      } finally {
        armed = false
        used += performance.now() - enteredAt
      }
    }

    const release = (dispose: () => void) =>
      Effect.sync(() => {
        if (broken) return
        try {
          dispose()
        } catch {
          broken = true
        }
      })

    const runtime: QuickJSRuntime = yield* Effect.acquireRelease(
      Effect.try({ try: () => module.newRuntime(), catch: unavailable }),
      (runtime) => release(() => runtime.dispose())
    )
    runtime.setMaxStackSize(stackBytes)
    runtime.setInterruptHandler(() => {
      if (closing) return true
      if (!armed || used + (performance.now() - enteredAt) < limits.timeMs) return false
      exhausted = exhausted ?? {
        _tag: "Rejected",
        code: "limit_exceeded",
        limit: "time",
        message: `The cell computed for more than its limit of ${limits.timeMs} milliseconds.`
      }
      return true
    })
    const context: QuickJSContext = yield* Effect.acquireRelease(
      Effect.try({ try: () => runtime.newContext(), catch: unavailable }),
      (context) => release(() => context.dispose())
    )

    const install = (name: string, implementation: (...args: Array<QuickJSHandle>) => QuickJSHandle): void => {
      const handle = context.newFunction(name, implementation)
      context.setProp(context.global, name, handle)
      handle.dispose()
    }
    install("__call", (nameHandle, inputHandle) => {
      const tool = context.getString(nameHandle)
      // The realm's own table already refused other names. This is the same
      // check on the host's side of the boundary.
      if (closing || !handed.has(tool)) throw new Error(`No tool named ${tool} was handed to this run`)
      // A cell can issue calls without awaiting them, so both bounds hold
      // when a call is issued: what waits on the host's side of the boundary
      // is bounded like the realm itself.
      if (ordinal >= limits.calls) {
        overflowed = true
        throw new Error(`The cell made more than its limit of ${limits.calls} tool calls`)
      }
      const text = context.getString(inputHandle)
      issuedChars += text.length
      if (issuedChars > limits.memoryBytes) {
        exhausted = exhausted ?? outOfMemory("The inputs of the cell's tool calls are larger than that.")
        throw new Error("The inputs of this cell's tool calls are larger than the run's memory")
      }
      const input: unknown = JSON.parse(text)
      const deferred = context.newPromise()
      pending.push({ call: { ordinal: ordinal++, tool, input }, deferred })
      return deferred.handle
    })
    install("__print", (textHandle) => {
      const text = context.getString(textHandle)
      if (retained + text.length > printBytes) dropped++
      else {
        retained += text.length + 1
        lines.push(text)
      }
      return context.undefined
    })
    install("__done", (answerHandle) => {
      answer = { value: JSON.parse(context.getString(answerHandle)) }
      return context.undefined
    })

    const installed = yield* Effect.try({
      try: () => {
        const result = context.evalCode(prelude(options.tools), "prelude.js")
        if (result.error !== undefined) {
          const failure = describe(context.dump(result.error))
          result.error.dispose()
          throw new Error(`${failure.name}: ${failure.message}`)
        }
        const openFrame = context.getProp(result.value, "open")
        const room = context.getProp(result.value, "room")
        result.value.dispose()
        return { openFrame, room }
      },
      catch: (cause) => new RealmError({ reason: "failed", message: "The sandbox prelude did not install.", cause })
    })
    yield* Effect.addFinalizer(() =>
      release(() => {
        installed.openFrame.dispose()
        installed.room.dispose()
      })
    )

    // A string the host hands to the realm is first copied into the realm's
    // memory by an allocation that is not checked, so room for it is proven
    // first: the text as UTF-8, and the interpreter's own copy of it.
    const hasRoom = (text: string): boolean => {
      const bytes = context.newNumber(text.length * 5 + 4096)
      const answered = enter(() => context.callFunction(installed.room, context.undefined, bytes))
      bytes.dispose()
      if (answered.error !== undefined) {
        answered.error.dispose()
        return false
      }
      const fits = context.dump(answered.value) === true
      answered.value.dispose()
      return fits
    }

    // Hands a settled call back to the cell as JSON text. Resolving a promise
    // with an object makes the interpreter read the object's `then`, which a
    // cell can define on `Object.prototype`; a string has none, so the host's
    // answer runs no code of the cell's. The realm's own glue parses the text
    // in the cell's next job, on the cell's clock and under its memory ceiling.
    const reply = (deferred: QuickJSDeferredPromise, payload: unknown): void => {
      const send = (json: string): boolean => {
        if (!hasRoom(json)) return false
        const text = context.newString(json)
        enter(() => deferred.resolve(text))
        text.dispose()
        return true
      }
      try {
        const sent = send(safeJson(payload)) || send(JSON.stringify({
          ok: false,
          error: {
            code: "result_too_large",
            message: "The tool's result does not fit in what is left of this run's memory. Ask for less."
          }
        }))
        if (!sent) {
          spent = true
          exhausted = exhausted ?? outOfMemory("The tool's result could not be delivered.")
          enter(() => deferred.resolve(context.undefined))
        }
      } finally {
        deferred.dispose()
      }
    }

    // Answers every open call with a throw, then closes the realm to the
    // cell: from here the interrupt handler stops whatever code is left.
    const abort = (message: string): void => {
      closing = false
      for (const next of pending.splice(0)) reply(next.deferred, { aborted: true, message })
      closing = true
    }

    const prints = (): string => {
      const text = lines.join("\n")
      if (dropped === 0) return text
      const notice = `[${dropped} more printed ${dropped === 1 ? "line was" : "lines were"} dropped: a cell keeps ${printBytes} characters of output]`
      return text === "" ? notice : `${text}\n${notice}`
    }

    // Reads an error the cell raised. Reading it can run a getter or a
    // `toJSON` the cell wrote, so it is on the cell's clock like the cell.
    const dump = (handle: QuickJSHandle): unknown => enter(() => context.dump(handle))

    const evaluate = <E, R>(
      source: string,
      handler: (call: Call) => Effect.Effect<CallResult, E, R>,
      around?: (call: Call, result: Effect.Effect<CallResult, E, R>) => Effect.Effect<CallResult, E, R>
    ): Effect.Effect<Frame, E | RealmError, R> =>
      Effect.suspend((): Effect.Effect<Frame, E | RealmError, R> => {
        if (broken || spent) {
          return Effect.fail(new RealmError({ reason: "failed", message: "This sandbox is spent and runs no further cell." }))
        }
        closing = false
        used = 0
        exhausted = undefined
        pending = []
        ordinal = 0
        overflowed = false
        issuedChars = 0
        answer = undefined
        lines = []
        retained = 0
        dropped = 0
        let calls = 0
        const frame = (outcome: Outcome): Frame => ({ outcome, prints: prints(), calls, spent: spent || broken })

        const outcomeOfMemory = (): Outcome => outOfMemory("The cell was stopped.")

        return Effect.gen(function*() {
          enter(() => context.unwrapResult(context.callFunction(installed.openFrame, context.undefined))).dispose()
          if (!hasRoom(source)) {
            spent = true
            return frame(outcomeOfMemory())
          }
          // 128 is the interpreter's async flag: a script with top-level await,
          // whose value is a promise.
          const started = enter(() => context.evalCode(source, `cell-${++frames}.js`, 128 as never))
          if (started.error !== undefined) {
            const failure = describe(dump(started.error))
            started.error.dispose()
            if (exhausted !== undefined) return frame(exhausted)
            return frame({
              _tag: "Rejected",
              code: "compile_failed",
              message: `The cell did not compile. ${failure.name}: ${failure.message}`
            })
          }
          const cell = started.value

          let settled: Outcome | undefined
          const poll = (): void => {
            const jobs = enter(() => runtime.executePendingJobs())
            if (jobs.error !== undefined) jobs.error.dispose()
            if (exhausted !== undefined) {
              settled = exhausted
              return
            }
            const state = context.getPromiseState(cell)
            if (state.type === "pending") return
            if (state.type === "fulfilled") {
              state.value.dispose()
              settled = answer === undefined ? { _tag: "Continue" } : { _tag: "Done", value: answer.value }
              return
            }
            const dumped = dump(state.error)
            state.error.dispose()
            if (exhausted !== undefined) {
              settled = exhausted
              return
            }
            const failure = describe(dumped)
            // With no memory left the interpreter cannot build the error it
            // means to throw, and throws null.
            const starved = dumped === null && fullyGrown()
            if (starved || (failure.name === "InternalError" && failure.message === "out of memory")) {
              spent = true
              settled = outcomeOfMemory()
            } else settled = { _tag: "Raised", name: failure.name, message: bounded(failure.message) }
          }

          const drive = Effect.gen(function*() {
            for (;;) {
              if (exhausted !== undefined) return exhausted
              // A call the cell issued runs even when the cell did not await
              // it, so issued calls are settled before the cell's end is read.
              const next = pending.shift()
              if (next === undefined) {
                poll()
                if (pending.length > 0) continue
                if (exhausted !== undefined) return exhausted
                if (overflowed) {
                  return {
                    _tag: "Rejected",
                    code: "limit_exceeded",
                    limit: "calls",
                    message: `The cell made more than its limit of ${limits.calls} tool calls. The calls past the limit did not run.`
                  } satisfies Outcome
                }
                if (settled !== undefined) return settled
                return {
                  _tag: "Rejected",
                  code: "stalled",
                  message: "The cell awaited something that never settles. Inside a cell the only thing worth awaiting is a tool call."
                } satisfies Outcome
              }
              calls++
              const limited = handler(next.call).pipe(
                Effect.timeoutOrElse({
                  duration: limits.callMs,
                  orElse: () =>
                    Effect.succeed<CallResult>({
                      ok: false,
                      error: {
                        code: "timeout",
                        message: `tools.${next.call.tool} took longer than its limit of ${limits.callMs} milliseconds.`
                      }
                    })
                })
              )
              const result = yield* (around === undefined ? limited : around(next.call, limited)).pipe(
                Effect.onExit((exit) =>
                  Exit.isSuccess(exit) ? Effect.void : Effect.sync(() => {
                    pending.unshift(next)
                  })
                )
              )
              reply(next.deferred, result)
              poll()
            }
          })

          const outcome = yield* drive.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (broken) return
                // Whatever the cell would do next is cut off: its open calls
                // are answered with a throw, and the interrupt handler stops
                // any code that catches it.
                try {
                  abort("The cell was stopped")
                  for (let jobs = 0; jobs < 1024 && runtime.hasPendingJob(); jobs++) {
                    const ran = runtime.executePendingJobs(1)
                    if (ran.error !== undefined) ran.error.dispose()
                    abort("The cell was stopped")
                  }
                  // Jobs the cell left behind would run on the next cell's
                  // clock, so a realm that still has some runs no further cell.
                  if (runtime.hasPendingJob()) spent = true
                  cell.dispose()
                } catch {
                  broken = true
                }
              })
            )
          )
          return frame(outcome)
        }).pipe(
          // The interpreter threw into the host: a native stack overflow or a
          // failed allocation. It is contained in the realm's own memory.
          Effect.catchDefect((defect) =>
            broken
              ? Effect.succeed(frame({
                _tag: "Rejected",
                code: "crashed",
                message: "The cell crashed the sandbox's interpreter."
              }))
              : Effect.die(defect)
          )
        )
      })

    return { evaluate }
  })
