import type * as Actual from "./main.vibe"
import type * as Native from "./native.js"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<A extends true> = A
type pickContract = Assert<Equal<ReturnType<typeof Actual.pick>, ReturnType<typeof Native.pick>>>
type expressionContract = Assert<Equal<ReturnType<typeof Actual.expression>, ReturnType<typeof Native.expression>>>
type blockArrowContract = Assert<Equal<ReturnType<typeof Actual.blockArrow>, ReturnType<typeof Native.blockArrow>>>
type bareArrowContract = Assert<Equal<ReturnType<typeof Actual.bareArrow>, ReturnType<typeof Native.bareArrow>>>
type expressionArrowContract = Assert<Equal<ReturnType<typeof Actual.expressionArrow>, ReturnType<typeof Native.expressionArrow>>>
type coldContract = Assert<Equal<ReturnType<typeof Actual.cold>, ReturnType<typeof Native.cold>>>
type mainContract = Assert<Equal<ReturnType<typeof Actual.main>, ReturnType<typeof Native.main>>>
