/** @throws {Error} */
export function risky():Promise<number> {throw new Error("before-promise")}
/** @throws {never} */
export function safe():Promise<number> {return Promise.resolve(1)}
export function unannotated():Promise<number> {return Promise.resolve(1)}
