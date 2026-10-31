import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("EK0706 codes every jump out of an async match and keeps nested owners", () => {
  const match = chapter("004-match")
  for (const text of [
    "`EK0706` reports a jump out of an `async match`",
    "including a `do` expression in them",
    "A `return` in a nested function belongs to that function",
    "whose target is inside the `async match` follows the ordinary rules",
    "Ownership and targets come from the source",
  ]) assert.ok(match.includes(text), text)
  assert.match(match, /do \{ return 1 \}; default: 0; \} \/\/ EK0706/)
  assert.match(match, /do \{ break \}; default: 0; \} \/\/ EK0706/)
  assert.ok(match.includes("| a `return`, `break` or `continue` that leaves an `async match` ([Async jumps](#async-match-jumps)) | `EK0706` |"))
  assert.match(chapter("900-appendices"), /\| `EK0706` \| a `return`, `break` or `continue` that leaves an `async match`/)
  assert.match(read("docs/design/vips/0007-match.md"), /leaving an `async match` is `EK0706`/)
  const result = run(block(match, "const inwardExit") + `
import { Exit } from "effect"
if (!Exit.isSuccess(inwardExit) || inwardExit.value !== 1) throw new Error("nested owners")
`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
