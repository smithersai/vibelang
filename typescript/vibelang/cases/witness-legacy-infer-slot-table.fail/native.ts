// TypeScript code: invalid infer keeps TS1338, conditional inference keeps its meaning.
export let annotated: infer T
type Element<T> = T extends Array<infer U> ? U : never
export const element: Element<number[]> = "not a number"
