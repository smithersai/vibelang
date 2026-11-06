import assert from "node:assert/strict"
import { resolve, join } from "node:path"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
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
      comment: fc.constantFrom("/* plain */", "/*😀𝒜*/", "/* open", "// comment", "// 😀", "//plain", "//# directive", "/// reference", "//path/to/excerpt", "//path/to/excerpt.vibe"),
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

test("missing UNC source listings remain files after the file list starts", () => {
  const root = resolve("project")
  const unc = ["", "", "fixture-server", "share", "main.vibe"].join("/")
  const parsed = parseOutput("warning EK9204: warning\n" + join(root, "main.vibe") + "\n" + unc, root)
  assert.deepEqual(parsed.files, [join(root, "main.vibe"), unc])
  assert.equal(parsed.diagnostics[0].text, "warning")
})


test("a network-path-shaped source comment stays in the warning", () => {
  const root = resolve("project")
  const parsed = parseOutput([
    "warning EK9204: effect {", "//path/to/excerpt.vibe", "return 1", "} cannot fail",
    join(root, "main.vibe")
  ].join("\n"), root)
  assert.deepEqual(parsed.files, [join(root, "main.vibe")])
  assert.equal(parsed.diagnostics[0].text, "effect {\n//path/to/excerpt.vibe\nreturn 1\n} cannot fail")
})


test("an existing listed input remains a file immediately after a warning", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-listed-input-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, "main.vibe")
  writeFileSync(file, "export const value = 1")
  const listed = process.platform === "win32" ? file : "/" + file
  const parsed = parseOutput("warning EK9204: warning\n" + listed, root)
  assert.deepEqual(parsed.files, [listed])
  assert.equal(parsed.diagnostics[0].text, "warning")
})
