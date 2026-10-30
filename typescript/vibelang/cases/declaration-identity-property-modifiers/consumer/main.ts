import type { Shape, Optional, Dictionary, Literal, Nested, Fields, Explicit, ReadonlyDictionary } from "../out/main.js"
declare let shape: Shape
declare let optional: Optional
declare let dictionary: Dictionary
declare let literal: Literal
declare let nested: Nested
declare let fields: Fields
declare let explicit: Explicit
declare let frozen: ReadonlyDictionary
shape.value = 1
optional.value = 1
dictionary["value"] = 1
literal.value = 1
literal.optional = "updated"
nested.inner.value = 1
nested.fixed.value = 1
fields.value = 1
fields.optional = "updated"
// @ts-expect-error: a written readonly stays readonly.
explicit.value = 1
// @ts-expect-error: a written readonly index signature stays readonly.
frozen["value"] = 1
// @ts-expect-error: a written readonly optional property stays readonly.
optional.fixed = "updated"
// @ts-expect-error: a written readonly class field stays readonly.
fields.fixed = 1
