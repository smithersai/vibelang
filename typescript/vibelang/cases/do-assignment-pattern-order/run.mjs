import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { run } from './out/main.js'
const native = JSON.parse(execFileSync(process.execPath, ['native.ts'], { encoding: 'utf8' }))
const actual = run()
for (let i = 0; i < actual.length; i++) {
  if (JSON.stringify(actual[i]) !== JSON.stringify(native[i])) console.error(JSON.stringify({ scenario: actual[i][0], actual: actual[i][1], native: native[i][1] }))
}
assert.deepEqual(actual, native)
assert.deepEqual(native[0][1], { events: ['rhs'], value: 2, error: null })
assert.deepEqual(native[1][1], { events: ['rhs', 'default'], value: 9, error: null })
console.log(actual.length + ' assignment patterns match native IIFEs')
