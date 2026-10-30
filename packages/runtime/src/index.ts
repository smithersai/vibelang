import "./version.js"
// Runtime ABI used by generated VibeLang modules.
// Capture the intrinsics outside user scopes, where Object may be shadowed.
export const $freeze = Object.freeze
export const $defineProperty = Object.defineProperty
// The global object, for a global such as SyntaxError that a binding of the
// generated module shadows where generated code names it.
export const $global: typeof globalThis = globalThis
export * from "./calls.js"
export { $direct, $done, $eager, $fast, $isRun, $settle } from "./fastcalls.js"
export type { Fast } from "./fastcalls.js"
export * from "./regions.js"
export * from "./fork.js"
export { $Context, $control, $reference, $service, Control, wire } from "./services.js"
export type { ReferenceKey, ServiceKey } from "./services.js"
export * from "./handlers.js"
export * from "./producers.js"
export { $iteratorFrame } from "./iterators.js"
export * from "./boundaries.js"
export * from "./hatches.js"
export * from "./fibers.js"
export { $provideEntries, $provideService } from "./provide.js"
export * from "./primitives.js"
export * from "./match.js"
export * from "./main.js"
export * from "./prelude.js"

// Effect's acquisitions, as `using` adopts their releases (D401).
export { acquireDisposable, acquireRelease } from "./resources.js"

// TypeScript adapters for asynchronous sources (D43).
export { suspend, handoff, HandoffProtocolViolation, type Resumer } from "./kernel/kernel.js"


// Migration-only symbols have no runtime exports.
export type { $awaitAll, $awaitAllSettled, $awaitRace, $awaitAny, AwaitElement } from "./legacy-await-types.js"
