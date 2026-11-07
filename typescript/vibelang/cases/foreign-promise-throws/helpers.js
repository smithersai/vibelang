/** @throws {Error} */
export function risky() { throw new Error("before-promise"); }
/** @throws {never} */
export function safe() { return Promise.resolve(1); }
export function unannotated() { return Promise.resolve(1); }
