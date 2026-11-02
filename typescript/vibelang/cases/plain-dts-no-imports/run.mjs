// Runs double as TypeScript would: as a function that returns an Effect.
const { Effect } = await import("effect")
const { double } = await import("./out/main.js")

console.log(await Effect.runPromise(double(4)))
