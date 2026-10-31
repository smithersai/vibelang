// alchemy-23: an inferred return type that meets its own anonymous type
// again, as alchemy's packages/aws builders do, declares it /*elided*/ any,
// as TypeScript 5.9 and 7.0.2 do (decision 6); expected/lib.d.ts is 7.0.2's.
export const from = (value: string) => makeBuilder({ value })
const makeBuilder = (state: { value: string }) => ({
  state,
  named: (value: string) => makeBuilder({ value }),
})
export type Builder = ReturnType<typeof makeBuilder>

// Two functions that build each other's results.
export const start = () => ping(1)
const ping = (n: number) => ({ n, next: () => pong(n + 1) })
const pong = (n: number) => ({ n, back: () => ping(n - 1) })

// A method that returns its own builder.
export function chain(count: number) {
  return { count, more() { return chain(count + 1) } }
}
