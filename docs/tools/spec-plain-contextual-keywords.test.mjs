import assert from "node:assert/strict"
import test from "node:test"
import { chapter } from "./spec-witness.mjs"

test("the plain-code principle admits the contextual declarations Appendix A already selects", () => {
  const appendix = chapter("900-appendices")
  const declarations = appendix.split("**Declaration keywords.**")[1].split("### Productions")[0]
  for (const keyword of ["service", "error", "schema", "data"]) {
    assert.ok(declarations.includes(`${keyword} as T;`), `${keyword}: the documented TypeScript assertion collision is retained`)
  }
  const principle = chapter("000-intro").split("4. **TypeScript")[1].split("\n\n")[0]
  assert.match(principle, /900-appendices\.md#contextual-keywords/)
  assert.match(principle, /including plain code/)
  assert.match(principle, /TypeScript statement.*parse differently/)
})
