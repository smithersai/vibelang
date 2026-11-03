let calls = 0
/** @throws {never} */
export function poison() { calls++; return -999 }
/** @throws {never} */
export function poisonCalls() { return calls }
