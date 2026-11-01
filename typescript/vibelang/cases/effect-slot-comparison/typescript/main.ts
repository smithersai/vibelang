import type { Effect } from "effect"
import { take, right, trace } from "./foreign.js"
export const receipts: Array<readonly [string, boolean | number, string]> = []
trace.length = 0
const value0 = take() as Effect.Effect<number, never, never> < right()
if (value0 !== true || trace.join(",") !== "left,right,coerce") throw new Error("as:plain")
receipts.push(["as:plain", value0, trace.join(",")])
trace.length = 0
const value1 = (take() as Effect.Effect<number, never, never>) < right()
if (value1 !== true || trace.join(",") !== "left,right,coerce") throw new Error("as:whole-parentheses")
receipts.push(["as:whole-parentheses", value1, trace.join(",")])
trace.length = 0
const value2 = take() as Effect.Effect<number, never, never> /*comparison*/ < right()
if (value2 !== true || trace.join(",") !== "left,right,coerce") throw new Error("as:comment")
receipts.push(["as:comment", value2, trace.join(",")])
trace.length = 0
const value3 = take() as Effect.Effect<number, never, never> 
< right()
if (value3 !== true || trace.join(",") !== "left,right,coerce") throw new Error("as:newline")
receipts.push(["as:newline", value3, trace.join(",")])
trace.length = 0
const value4 = take() as Effect.Effect<number, never, -1> < right()
if (value4 !== true || trace.join(",") !== "left,right,coerce") throw new Error("as:negative-R")
receipts.push(["as:negative-R", value4, trace.join(",")])
trace.length = 0
const value5 = take() as Effect.Effect<number, never, [0]> < right()
if (value5 !== true || trace.join(",") !== "left,right,coerce") throw new Error("as:tuple-R")
receipts.push(["as:tuple-R", value5, trace.join(",")])
trace.length = 0
const value6 = take() as Effect.Effect<number, never, (<T>() => T)> < right()
if (value6 !== true || trace.join(",") !== "left,right,coerce") throw new Error("as:generic-R")
receipts.push(["as:generic-R", value6, trace.join(",")])
trace.length = 0
const value7 = take() as Effect.Effect<number, never, never> <= right()
if (value7 !== true || trace.join(",") !== "left,right,coerce") throw new Error("as:less-equal")
receipts.push(["as:less-equal", value7, trace.join(",")])
trace.length = 0
const value8 = take() as Effect.Effect<number, never, never> > right()
if (value8 !== false || trace.join(",") !== "left,right,coerce") throw new Error("as:greater")
receipts.push(["as:greater", value8, trace.join(",")])
trace.length = 0
const value9 = take() as Effect.Effect<number, never, never> << right()
if (value9 !== 16 || trace.join(",") !== "left,right,coerce") throw new Error("as:left-shift")
receipts.push(["as:left-shift", value9, trace.join(",")])
trace.length = 0
const value10 = take() satisfies Effect.Effect<number, never, never> < right()
if (value10 !== true || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:plain")
receipts.push(["satisfies:plain", value10, trace.join(",")])
trace.length = 0
const value11 = (take() satisfies Effect.Effect<number, never, never>) < right()
if (value11 !== true || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:whole-parentheses")
receipts.push(["satisfies:whole-parentheses", value11, trace.join(",")])
trace.length = 0
const value12 = take() satisfies Effect.Effect<number, never, never> /*comparison*/ < right()
if (value12 !== true || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:comment")
receipts.push(["satisfies:comment", value12, trace.join(",")])
trace.length = 0
const value13 = take() satisfies Effect.Effect<number, never, never> 
< right()
if (value13 !== true || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:newline")
receipts.push(["satisfies:newline", value13, trace.join(",")])
trace.length = 0
const value14 = take() satisfies Effect.Effect<number, never, -1> < right()
if (value14 !== true || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:negative-R")
receipts.push(["satisfies:negative-R", value14, trace.join(",")])
trace.length = 0
const value15 = take() satisfies Effect.Effect<number, never, [0]> < right()
if (value15 !== true || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:tuple-R")
receipts.push(["satisfies:tuple-R", value15, trace.join(",")])
trace.length = 0
const value16 = take() satisfies Effect.Effect<number, never, (<T>() => T)> < right()
if (value16 !== true || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:generic-R")
receipts.push(["satisfies:generic-R", value16, trace.join(",")])
trace.length = 0
const value17 = take() satisfies Effect.Effect<number, never, never> <= right()
if (value17 !== true || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:less-equal")
receipts.push(["satisfies:less-equal", value17, trace.join(",")])
trace.length = 0
const value18 = take() satisfies Effect.Effect<number, never, never> > right()
if (value18 !== false || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:greater")
receipts.push(["satisfies:greater", value18, trace.join(",")])
trace.length = 0
const value19 = take() satisfies Effect.Effect<number, never, never> << right()
if (value19 !== 16 || trace.join(",") !== "left,right,coerce") throw new Error("satisfies:left-shift")
receipts.push(["satisfies:left-shift", value19, trace.join(",")])
console.log(JSON.stringify(receipts))
