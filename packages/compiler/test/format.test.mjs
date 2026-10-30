import assert from "node:assert/strict"
import { test } from "node:test"
import { formatSource } from "../format.mjs"

// A repository's sort-imports lint rule decides the order of the names in an
// import; the formatter keeps the order it is given.
test("formatting keeps the order of the names within an import and an export", () => {
  const source = 'import {\n  Order as EffectOrder,\n  type Equivalence as Equivalence_,\n  Function,\n} from "effect"\nimport { String, flow } from "effect"\nconst b = 1\nconst a = 2\nexport { b, a }\n'
  const formatted = formatSource(source, "order.vibe")
  assert.equal(formatted, 'import { Order as EffectOrder, type Equivalence as Equivalence_, Function } from "effect"\nimport { String, flow } from "effect"\nconst b = 1\nconst a = 2\nexport { b, a }\n')
  assert.equal(formatSource(formatted, "order.vibe"), formatted)
})
