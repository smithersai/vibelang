export const trace: string[] = []
export function take(): unknown { trace.push("left"); return { [Symbol.toPrimitive]() { trace.push("coerce"); return 2 } } }
export function right() { trace.push("right"); return 3 }
