import test from "node:test"
import { assert, fc, temp, put, relativeApiFiles } from "./api-inputs-fixture.mjs"

test("relative API fixture inputs retain transitive helpers and URL assets", t => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.constantFrom("static", "dynamic", "bare", "url"), fc.boolean(), (depth, form, cycle) => {
    const root = temp(t, "api-input-closure-")
    const statement = spec => {
      const name = JSON.stringify(spec)
      if (form === "static") return "import { value as nextValue } from " + name + ";"
      if (form === "dynamic") return "void import(" + name + ");"
      if (form === "bare") return "import " + name + ";"
      return "new URL(" + name + ", import.meta.url);"
    }
    const expected = ["scripts/api-identity.mjs", "scripts/nested/rules.json"]
    put(root, expected[0], statement("./nested/helper-1.mjs") + "\nexport const value = 1;")
    for (let i = 1; i <= depth; i++) {
      const file = "scripts/nested/helper-" + i + ".mjs"
      const next = i < depth ? statement("./helper-" + (i+1) + ".mjs") : cycle ? statement("../api-identity.mjs") : ""
      put(root, file, '// import "./comment-only.mjs";\n' + next + '\nnew URL("./rules.json", import.meta.url);\nexport const value = 1;')
      expected.push(file)
    }
    put(root, "scripts/nested/rules.json", "{}")
    put(root, "scripts/nested/comment-only.mjs", "export const ignored = 1")
    assert.deepEqual(relativeApiFiles([expected[0]], root), expected.sort())
  }), { seed: 186016, numRuns: 120 })
})
