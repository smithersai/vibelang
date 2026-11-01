// An own `call` property on a method: a lowering that reaches the method
// through method.call(this, …) runs this instead of the method.
export const state = { calls: 0 }
export function poison(): number { state.calls++; return -1 }
