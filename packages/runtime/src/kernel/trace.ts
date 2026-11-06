// Tracing helpers: name compiled-function frames and print machine state.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { asInternals, contA, contAll, contE, type FiberInternals, identifier } from "./internals.js"

const generatorNames = new WeakMap<object, string>()

// What the compiler would emit for a function that may suspend: a generator
// body run as one heap frame per activation (Effect's Iterator primitive).
// The wrapper only records the function name for traces.
export const compiled = <Args extends Array<any>, A>(
  name: string,
  body: (...args: Args) => Generator<any, A, any>
): (...args: Args) => Effect.Effect<A, any, any> =>
  Effect.fnUntraced(function(this: unknown, ...args: Args) {
    const iterator = body.apply(this, args)
    generatorNames.set(iterator, name)
    return iterator
  } as any) as any

export const frameLabel = (frame: any): string => {
  if (frame && typeof frame.esFrame === "string") return frame.esFrame
  const it = frame?.iterator
  if (it && generatorNames.has(it)) return `fn ${generatorNames.get(it)}`
  const id = frame?.[identifier]
  if (typeof id === "string") return id
  if (frame && contAll in frame && !(contA in frame) && !(contE in frame)) return "RestoreInterruptible"
  return "Frame"
}

export const stackLabels = (frames: ReadonlyArray<any>) => frames.map(frameLabel)

// Service keys present in a Context, minus Effect's built-in references.
export const contextLabels = (context: Context.Context<never>, show: (key: string, value: any) => string | undefined) => {
  const out: Array<string> = []
  for (const [key, value] of (context as any).mapUnsafe as Map<string, any>) {
    const label = show(key, value)
    if (label !== undefined) out.push(label)
  }
  return out
}

export const currentFiber = Effect.withFiber((f) => Effect.succeed(asInternals(f) as FiberInternals))
