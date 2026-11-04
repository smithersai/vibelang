// opencode's stats/core declared "./runtime.js" where its sources and published .d.ts say "./runtime.ts".
export * as Runtime from "./runtime.ts"
export * as Plain from './plain'
export { find } from './runtime.ts'
export type { NotFound } from "./runtime.ts"
export type Missing = import("./runtime.ts").NotFound
export type Lazy = typeof import('./runtime.ts')
