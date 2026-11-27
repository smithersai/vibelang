import typedErrors from "./categories/01-typed-errors.mjs"
import servicesLayers from "./categories/02-services-layers.mjs"
import structuredConcurrency from "./categories/03-structured-concurrency.mjs"
import resourcesStreams from "./categories/04-resources-streams.mjs"
import platformBoundaries from "./categories/05-platform-boundaries.mjs"
import effectUi from "./categories/06-effect-ui.mjs"

export const BENCHMARK_VERSION = "benchmark-30/v1"

export const CATEGORIES = [
  { id: "typed-errors", label: "Typed Errors & Recovery" },
  { id: "services-layers", label: "Services & Layers" },
  { id: "structured-concurrency", label: "Structured Concurrency" },
  { id: "resources-streams", label: "Resource Safety & Streams" },
  { id: "platform-boundaries", label: "Platform & Boundary Soundness" },
  { id: "effect-ui", label: "Effect UI Components" },
]

export const TASKS = [
  ...typedErrors,
  ...servicesLayers,
  ...structuredConcurrency,
  ...resourcesStreams,
  ...platformBoundaries,
  ...effectUi,
]

export function getTask(id) {
  return TASKS.find((t) => t.id === id)
}

export function tasksByCategory(category) {
  return TASKS.filter((t) => t.category === category)
}
