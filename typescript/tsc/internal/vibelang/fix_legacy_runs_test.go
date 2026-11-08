// docs/design/vips/0034-compiler-and-tooling.md#aad064991d073aa1
// VIP-34: VIP-only migration writes function kind markers and explicit try at legacy run positions.
package vibelang

import ()

// legacyRunsPrelude declares what the position cases call: an Effect
// function, a plain function, and a plain function that returns an Effect.
const legacyRunsPrelude = `error Missing { id: number }

effect function load(n: number) {
  try yieldNow
  return n
}

function plainId(n: number): number {
  return n
}

function factory(n: number) {
  return Effect.succeed(n * 10)
}

`
