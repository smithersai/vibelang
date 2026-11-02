import assert from 'node:assert/strict'
import * as actual from './out/main.js'
import { vectors, completion } from './out/reference.js'
const comparisons = []
for (const [i, [name, source, expected]] of vectors.entries()) {
  const native = completion(source)
  assert.equal(native === undefined ? null : native, expected, name + ' native oracle')
  comparisons.push([name, actual['probe' + i](), native])
}
if (comparisons.some(([, value, native]) => value !== native)) for (const [name, value, native] of comparisons) console.log(name + ': actual=' + String(value) + ' native=' + String(native))
assert.deepEqual(comparisons.map(([name, value]) => [name, value]), comparisons.map(([name, , native]) => [name, native]))
assert.equal(actual.returnOverride(), 7, 'finally return')
assert.equal(actual.throwOverride(), 8, 'finally throw')
assert.equal(actual.continueOverride(), 2, 'finally continue')
assert.equal(actual.differentNormalType(), 1, 'discarded finalizer type')
assert.equal(actual.differentAbruptType(), 'final', 'abrupt finalizer type')
assert.equal(actual.nestedDoBreak(), 7, 'nested do abrupt expression')
console.log('26 finally completions match native JavaScript')
