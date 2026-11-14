/**
 * Orchestration patterns as plain Effect code (VIP-73): each pattern takes
 * its stages as functions that return Effects and returns one Effect. They
 * port the run forms of the reference patterns library. Nothing here is durable
 * by itself: a stage that calls a `task` inside a `workflow` is a durable
 * step, and a stage that is an ordinary Effect is not.
 *
 * @experimental
 * @since 0.0.13
 */
export * as Panel from "./patterns/Panel.js"
export { PatternError } from "./patterns/PatternError.js"
export type { PatternErrorCode } from "./patterns/PatternError.js"
export * as ReviewLoop from "./patterns/ReviewLoop.js"
export * as Stall from "./patterns/Stall.js"
