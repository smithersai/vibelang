
import { Cause, Exit } from "effect"
/** @throws {never} */
export function reject(): Promise<never> { return Promise.reject("reject") }
/** @throws {unknown} */
export function throws(): Promise<never> { throw "throw" }
/** @throws {never} */
export function summary(value: Exit.Exit<unknown, unknown>): string {
 if (Exit.isSuccess(value)) return "Success"
 const reason = value.cause.reasons[0]
 if (Cause.isFailReason(reason)) return "Fail:" + String((reason.error as {cause:unknown}).cause)
 if (Cause.isDieReason(reason)) return "Die:" + String(reason.defect)
 return "Interrupt"
}

