import assert from "node:assert/strict"
import { resolve, join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { parseOutput } from "../project.mjs"

test("warning source excerpts stay diagnostics and never become watched inputs", async () => {
  const root = resolve("project")
  await checkProperty(fc, {
    name: "project-diagnostic-excerpts",
    rule: "Only listed source files become watched project inputs.",
    command: "node --test packages/compiler/test/project-diagnostic-excerpts.property.test.mjs",
    numRuns: 100,
    arbitrary: fc.record({
      comment: fc.constantFrom("/* plain */", "/*😀𝒜*/", "/* open", "// comment", "// 😀", "//plain", "//# directive", "/// reference"),
      statement: fc.constantFrom("const kept = 1;", "return kept;", "})"),
      indent: fc.constantFrom("", " ", "\t"),
      eol: fc.constantFrom("\n", "\r\n")
    }),
    check: ({ comment, statement, indent, eol }) => {
      const excerpt = indent + comment + " " + statement
      const files = [join(root, "main.vibe"), join(root, "missing dependency.ts")]
      const output = [
        "main.vibe(3,2): warning EK9204: effect {",
        excerpt, "} has no expected errors", ...files, "ordinary banner"
      ].join(eol)
      const parsed = parseOutput(output, root)
      assert.deepEqual(parsed.files, files)
      assert.equal(parsed.diagnostics.length, 1)
      assert.equal(parsed.diagnostics[0].text, "effect {\n" + excerpt + "\n} has no expected errors")
    }
  })
})

test("a following diagnostic starts its own multiline message", () => {
  const root = resolve("project")
  const parsed = parseOutput([
    "warning EK9204: effect {", "/*😀*/ return 1", "} cannot fail",
    "main.vibe(5,1): error TS2322: wrong type", "unindented type detail",
    join(root, "main.vibe")
  ].join("\n"), root)
  assert.equal(parsed.diagnostics[0].text, "effect {\n/*😀*/ return 1\n} cannot fail")
  assert.equal(parsed.diagnostics[1].text, "wrong type\nunindented type detail")
  assert.deepEqual(parsed.files, [join(root, "main.vibe")])
})

test("UNC source listings remain files after a warning", () => {
  const root = resolve("project")
  const unc = ["", "", "fixture-server", "share", "main.vibe"].join("/")
  const parsed = parseOutput("warning EK9204: warning\n" + unc + "\n" + join(root, "main.vibe"), root)
  assert.deepEqual(parsed.files, [unc, join(root, "main.vibe")])
  assert.equal(parsed.diagnostics[0].text, "warning")
})
