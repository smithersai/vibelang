// Tracing helpers: name compiled-function frames and print machine state.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { asInternals, contA, contAll, contE, type FiberInternals, identifier } from "./internals.js"

const generatorNames = new WeakMap<object, string>()

// What the compiler would emit for a function that may suspend: a generator
// body run as one heap frame per activation (Effect's Iterator primitive).
// The wrapper only records the function name for traces.
export const compiled = <Args extends ReadonlyArray<unknown>, A>(
  name: string,
  body: (...args: Args) => Generator<Effect.Effect<unknown, unknown, unknown>, A, never>
): (...args: Args) => Effect.Effect<A, unknown, unknown> =>
  Effect.fnUntraced(function(this: unknown, ...args: Args) {
    const iterator = Reflect.apply(body, this, args)
    generatorNames.set(iterator, name)
    return iterator
  })

export const frameLabel = (frame: unknown): string => {
  if (frame !== null && typeof frame === "object") {
    const record = frame as Record<PropertyKey, unknown>
    if (typeof record.esFrame === "string") return record.esFrame
    const it = record.iterator
    if (it !== null && typeof it === "object" && generatorNames.has(it)) return `fn ${generatorNames.get(it)}`
    const id = record[identifier]
    if (typeof id === "string") return id
    if (contAll in record && !(contA in record) && !(contE in record)) return "RestoreInterruptible"
  }
  return "Frame"
}

export const stackLabels = (frames: ReadonlyArray<unknown>) => frames.map(frameLabel)

// Service keys present in a Context, minus Effect's built-in references.
export const contextLabels = (context: Context.Context<never>, show: (key: string, value: unknown) => string | undefined) => {
  const out: Array<string> = []
  for (const [key, value] of (context as unknown as { readonly mapUnsafe: Map<string, unknown> }).mapUnsafe) {
    const label = show(key, value)
    if (label !== undefined) out.push(label)
  }
  return out
}

export const currentFiber = Effect.withFiber((f) => Effect.succeed(asInternals(f) as FiberInternals))
