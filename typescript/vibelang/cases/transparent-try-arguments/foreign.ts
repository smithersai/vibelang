export const sentinel = new RangeError("input")
export const events: string[] = []
/** @throws {RangeError} */
export function risky(label: string, bad: boolean): number { events.push(label); if(bad) throw sentinel; return label.length }
/** @throws {RangeError} */
export function later(label: string, bad: boolean): Promise<number> { events.push(label); if(bad) throw sentinel; return Promise.resolve(label.length) }
