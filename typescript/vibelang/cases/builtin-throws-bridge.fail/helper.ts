import type { Exit } from "effect"
/** @throws {never} */
export function describe(exit: Exit.Exit<unknown,unknown>) {
 if (exit._tag === "Success") return ["Success",exit.value]
 return ["Failure",exit.cause.reasons.map(reason => reason._tag)]
}
