type Quiet = never
type Empty<T> = Exclude<T, T>
/** @throws {Quiet} */
export const read: typeof JSON.parse = JSON.parse
/** @throws {Empty<string>} */
export const largest: typeof Math.max = Math.max
/** @throws {Extract<string, number>} */
export function identity(value: number): number { return value }
