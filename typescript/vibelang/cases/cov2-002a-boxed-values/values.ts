/** @throws {never} */
export function values() { const state = {n:0}; const promise: unknown = Promise.resolve(9); const thenable: unknown = { then(resolve: (x:number) => void) { state.n++; resolve(9) } }; return { promise, thenable, state } }
