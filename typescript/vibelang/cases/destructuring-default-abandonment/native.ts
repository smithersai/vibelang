/** @throws {never} */
export function holes(log: string[]) { return (function* () { try { log.push("start"); yield undefined; yield 2 } finally { log.push("closed") } })() }
/** @throws {never} */
export function numbers(log: string[]): Generator<number> { return (function* () { try { log.push("start"); yield 1; log.push("second"); yield 2; log.push("done") } finally { if (!log.includes("done")) log.push("closed") } })() }
