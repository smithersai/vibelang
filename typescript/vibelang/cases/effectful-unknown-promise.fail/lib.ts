export function raw(): Promise<number> { return Promise.resolve(1) }
/** @throws {never} */
export function safe(): Promise<number> { return Promise.resolve(1) }
