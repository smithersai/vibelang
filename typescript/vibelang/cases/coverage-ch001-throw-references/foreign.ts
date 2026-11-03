import { Cause, Exit } from "effect"
/** @throws {never} @rethrows f */
export function each(f:{ /** @throws {unknown} */ (): number }) { return f() }
export function callback(): number { throw "callback" }
/** @throws {never} */
export function summary(value: Exit.Exit<unknown,unknown>): string {
 if(Exit.isSuccess(value))return "Success"
 const reason=value.cause.reasons[0]
 if(Cause.isDieReason(reason))return "Die:"+String(reason.defect)
 if(Cause.isFailReason(reason))return "Fail:"+String((reason.error as {cause:unknown}).cause)
 return "Interrupt"
}

