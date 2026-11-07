// An unchanged .ts file: each inferred type meets its own anonymous type again.
export const from = (value: string) => makeBuilder({ value })
const makeBuilder = (state: { value: string }) => ({ state, named: (value: string) => makeBuilder({ value }) })
export function chain(count: number) {
  return { count, more() { return chain(count + 1) } }
}
