// Runs each match of main.vibe with both zeros and prints what it chose.
import * as m from "./out/main.js"

const zeros = [0, -0]
const run = (f, values) => values.map((n) => f(n))
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


// Native SameValue is an independent oracle, captured outside the source's
// deliberately shadowed Object scopes. Include values with infinite
// reciprocals that are not zero, plus values arithmetic must never coerce.
const sameValue = Object.is
const subjects = [0, -0, 1, -1, Number.MIN_VALUE, -Number.MIN_VALUE, NaN,
  Infinity, -Infinity, 0n, "0", null, undefined, {}, new Number(-0), Symbol("s")]
const expected = subjects.map(x => sameValue(x,-0) ? "minus" : sameValue(x,0) ? "plus" : "other")
const got = run(m.shadowed, subjects)
const is = run(x => m.shadowedIs(x, {}), subjects)
if (JSON.stringify(got) !== JSON.stringify(expected.map(x => [x,0]))) throw new Error("shadowed SameValue mismatch: got " + JSON.stringify(got) + "; want " + JSON.stringify(expected.map(x => [x,0])))
if (JSON.stringify(is) !== JSON.stringify(subjects.map(x => [sameValue(x,-0),sameValue(x,0)]))) throw new Error("shadowed is mismatch: " + JSON.stringify(is))
if (JSON.stringify(run(m.onceShadow, [undefined])[0]) !== "[true,1]") throw new Error("subject evaluated twice")
console.log(JSON.stringify({shadowed:got,is,once:run(m.onceShadow, [undefined])[0]}))
if (JSON.stringify(run(m.nestedShadow, [-0])[0]) !== '["minus",1]') throw new Error("nested signed-zero subject evaluated twice")
if (JSON.stringify(run(m.onceNestedIs, [undefined])[0]) !== '[true,1,"source"]') throw new Error("inline nested signed-zero read was repeated")
