// opencode's stats/core declared "./runtime.js" where its sources and published .d.ts say "./runtime".
export * as Runtime from "./runtime"
export * as Plain from './plain'
export { find } from './runtime'
export type { NotFound } from "./runtime"
export type Missing = import("./runtime").NotFound
export type Lazy = typeof import('./runtime')
