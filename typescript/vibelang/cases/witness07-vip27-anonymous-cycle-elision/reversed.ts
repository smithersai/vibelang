// A reverse mapped type met again, in an unchanged .ts file.
type Deep<T> = { [K in keyof T]: Deep<T[K]> }
declare function deep<T>(x: Deep<T>): T
declare const node: { n: number; self: typeof node }
export const reversed = deep(node)
