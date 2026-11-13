import { test } from "bun:test"
import { cases, withExample } from "./convert-examples-fixture"


test("every worked conversion example compiles as a complete module", async () => {
  for (const example of cases()) {
    await withExample(example.expected, "vibe")
  }
}, 120000)
