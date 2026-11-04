import * as Effect from "effect/Effect"
/** @throws {Error} */
export function risky(_text:string):unknown {throw new Error("bad")}
/** @throws {never} */
export function safe(_text:string):number {return 1}
/** @throws {Error} */
export function fx(_text:string):Effect.Effect<number> {return Effect.succeed(1)}
/** @throws {never} @rethrows cb */
export function invoke(cb:(text:string)=>unknown):unknown {return cb("")}
/** @throws {never} @rethrows cb */
export function tag(_parts:TemplateStringsArray,cb:(text:string)=>unknown):unknown {return cb("")}
/** @throws {Error} */
export function overloaded(text:number):unknown
/** @throws {never} */
export function overloaded(text:string):unknown
export function overloaded(text:number|string):unknown {return text}
