import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import { compare } from "../../test/cov-ch004-twin.mjs"
await compare(fileURLToPath(new URL(".", import.meta.url)), Effect, [[true, false], [true, false], false])

import assert from "node:assert/strict"
import {customMatcher} from "vibelang-runtime"
assert.equal(Object.hasOwn(Function.prototype,customMatcher),false)
