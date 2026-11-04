import type { Exit } from "effect"
export const defect = new TypeError("unexpected")
let calls = 0
/** @throws {RangeError} */
export const parse: typeof JSON.parse = (text: string) => {
 calls++
 if (text === "listed") throw new RangeError("listed")
 if (text === "defect") throw defect
 return JSON.parse(text)
}
/** @throws {never} */
export function describe(exit: Exit.Exit<unknown,unknown>) {
 if (exit._tag === "Success") return ["Success",exit.value]
 return ["Failure",exit.cause.reasons.map(reason => reason._tag)]
}
/** @throws {never} */
export function count() { return calls }
