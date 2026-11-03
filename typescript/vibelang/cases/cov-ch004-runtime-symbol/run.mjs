// Chapter 004, global matcher symbol: docs/design/src/004-match.md#5e4afaf62d0739be
// Where an engine lacks `Symbol.customMatcher`, the runtime defines the symbol ([Runtime guarantees](008-runtime.md)).
import assert from "node:assert/strict"
import {customMatcher} from "vibelang-runtime"
assert.equal(typeof Symbol.customMatcher,"symbol")
assert.equal(Symbol.customMatcher,customMatcher)
console.log("global matcher symbol installed")
