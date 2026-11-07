export const failure = { reason: "foreign" }
export async function rejects(): Promise<number> { throw failure }
export function throwsFirst(): Promise<number> { throw failure }
export function boom(): number { throw failure }
export async function load(): Promise<number> { return 7 }
