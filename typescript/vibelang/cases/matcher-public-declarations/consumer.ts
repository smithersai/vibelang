/// <reference path="./augment.d.ts" />
import type { E, S } from "./main.d.vibe.ts"
import type { Shadow } from "./shadow.d.vibe.ts"
import type { Box } from "./nested.d.vibe.ts"
type NestedMatcher = (typeof Box.Nested)[typeof Symbol.customMatcher]
type NestedSchemaMatcher = (typeof Box.NestedSchema)[typeof Symbol.customMatcher]
declare const nested: NestedMatcher, nestedSchema: NestedSchemaMatcher
const d: boolean | readonly [unknown] = nested(null)
const f: boolean | readonly [unknown] = nestedSchema(null)
type EMatcher = (typeof E)[typeof Symbol.customMatcher]
type SMatcher = (typeof S)[typeof Symbol.customMatcher]
type ShadowMatcher = (typeof Shadow)[typeof Symbol.customMatcher]
declare const e: EMatcher, s: SMatcher, shadow: ShadowMatcher
const a: boolean | readonly [unknown] = e(null, { matchType: "extractor" })
const b: boolean | readonly [unknown] = s(null, { matchType: "boolean" })
const c: boolean | readonly [unknown] = shadow(null)
export { a, b, c, d, f }
