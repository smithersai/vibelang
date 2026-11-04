import {Schema} from "effect"
/** @throws {never} @rethrows f */
export function each<T>(xs: readonly T[], f: (x:T)=>void): void { xs.forEach(f) }
/** @throws {never} */
export function later(): Promise<never> { return new Promise(()=>{ throw new Error("executor") }) }

export const User=Schema.Struct({name:Schema.String})

/** @throws {string} */
export function failCallback(): never { throw "callback" }
