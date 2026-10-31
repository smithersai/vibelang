// Runs each match of main.vibe with both zeros and prints what it chose.
import * as Effect from "effect/Effect"
import * as m from "./out/main.js"

const zeros = [0, -0]
const run = (f, values) => values.map((n) => Effect.runSync(f(n)))
console.log(JSON.stringify({
  negative: run(m.negative, zeros),
  positive: run(m.positive, zeros),
  spellings: run(m.spellings, zeros),
  underflow: run(m.underflow, zeros),
  unsigned: run(m.unsigned, zeros),
  negativeOne: run(m.negativeOne, [-1, 1]),
  big: run(m.big, [0n, -0n]),
  isNegativeZero: run(m.isNegativeZero, zeros)
}))
